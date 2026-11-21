"""
jitter_buffer.py - Pre-Decoder AMBE+2 Jitter Buffer with Packet Loss Concealment (PLC)
for ProxDMR RX audio pipeline.

Buffers incoming HomeBrew DMRD voice bursts before vocoder decoding to eliminate
network jitter, reorder out-of-order UDP datagrams, and synthesize continuous
AMBE+2 erasure frames via mbelib-neo when packets are dropped in transit.
"""

import asyncio
import logging
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.dmr.jitter_buffer")


def seq_diff(a: int, b: int) -> int:
    """
    Computes difference between DMR frame sequence numbers (a - b)
    with 8-bit wrap-around (-128 .. +127).
    Positive return value indicates that 'a' is strictly newer than 'b'.
    """
    return ((a - b + 128) % 256) - 128


class DMRRxJitterBuffer:
    """
    Pre-Decoder AMBE+2 Jitter Buffer with Packet Loss Concealment (PLC).
    """

    def __init__(
        self,
        slot: int,
        vocoder: Any,
        on_audio_out: Callable[[int, bytes, List[dict], Any], None],
        cushion_packets: int = 2,
        max_plc_bursts: int = 2,
        max_queue_depth: int = 6,
    ):
        self.slot = slot
        self.vocoder = vocoder
        self.on_audio_out = on_audio_out
        self.cushion_packets = max(1, cushion_packets)
        self.max_plc_bursts = max_plc_bursts
        self.max_queue_depth = max_queue_depth

        self._queue: Dict[int, Any] = {}
        self._expected_seq: Optional[int] = None
        self._current_stream_id: Optional[int] = None
        self._last_valid_frame: Optional[Any] = None
        self._consecutive_erasures: int = 0
        self._is_buffering: bool = True
        self._first_packet_time: float = 0.0

        self._consumer_task: Optional[asyncio.Task] = None
        self._active: bool = False

    def push(self, frame: Any):
        """
        Receives an incoming raw DMR voice burst from network.
        Handles stream switches, late packets, and kicks off playout consumer.
        """
        now = time.monotonic()
        seq = getattr(frame, "seq_no", 0) & 0xFF
        stream_id = getattr(frame, "stream_id", 0)

        # Detect new voice transmission stream
        if self._current_stream_id != stream_id:
            self._current_stream_id = stream_id
            self._expected_seq = seq
            self._queue.clear()
            self._consecutive_erasures = 0
            self._is_buffering = True
            self._first_packet_time = now

        self._last_valid_frame = frame

        # Drop late or duplicate packets if we already moved past this seq
        if self._expected_seq is not None:
            diff = seq_diff(seq, self._expected_seq)
            if diff < 0:
                logger.debug(f"[JB_SLOT{self.slot}] Discarding late burst seq={seq} (expected={self._expected_seq})")
                return

        self._queue[seq] = frame

        # Prevent queue overflow (latency cap): fast-forward expected_seq if backlog exceeds max_queue_depth
        if len(self._queue) > self.max_queue_depth:
            oldest_seq = min(self._queue.keys(), key=lambda s: seq_diff(s, self._expected_seq))
            del self._queue[oldest_seq]
            if oldest_seq == self._expected_seq:
                self._expected_seq = (self._expected_seq + 1) % 256

        # Check if cushion reached or initial buffering timeout (120ms) elapsed
        buffered_count = len(self._queue)
        if self._is_buffering:
            if buffered_count >= self.cushion_packets or (now - self._first_packet_time) >= (self.cushion_packets * 0.060):
                self._is_buffering = False

        # Ensure consumer loop is active
        if not self._is_buffering and (self._consumer_task is None or self._consumer_task.done()):
            self._start_consumer()

    def _start_consumer(self):
        self._active = True
        try:
            loop = asyncio.get_running_loop()
            self._consumer_task = loop.create_task(self._consumer_loop())
        except RuntimeError:
            pass

    async def _consumer_loop(self):
        """
        Strict 60.0ms consumer cadence. Decodes real voice bursts or generates
        AMBE+2 PLC erasures on loss/jitter underruns.
        """
        next_tick = time.monotonic()
        try:
            while self._active:
                if self._is_buffering:
                    # Still gathering initial cushion
                    if (time.monotonic() - self._first_packet_time) >= (self.cushion_packets * 0.060) or len(self._queue) >= self.cushion_packets:
                        self._is_buffering = False
                    else:
                        await asyncio.sleep(0.010)
                        continue

                item = self._pop_step()
                if item is None:
                    # Starvation exceeded max_plc_bursts -> stop active loop until new bursts arrive
                    self._active = False
                    break

                kind, payload_frame = item
                if kind == "VOICE":
                    pcm_8k, meta_list = self.vocoder.decode_burst_with_meta(payload_frame.payload, slot=self.slot)
                    if pcm_8k:
                        self.on_audio_out(self.slot, pcm_8k, meta_list, payload_frame)
                elif kind == "PLC":
                    pcm_8k, meta_list = self.vocoder.decode_erasure_burst(slot=self.slot)
                    if pcm_8k:
                        ref_frame = payload_frame or self._last_valid_frame
                        self.on_audio_out(self.slot, pcm_8k, meta_list, ref_frame)

                next_tick += 0.060
                now_m = time.monotonic()
                sleep_dur = next_tick - now_m
                if sleep_dur > 0.002:
                    await asyncio.sleep(sleep_dur)
                elif sleep_dur < -0.100:
                    # Event loop delay > 100ms: re-anchor next_tick to prevent clumping
                    next_tick = now_m
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[JB_SLOT{self.slot}] Error in consumer loop: {e}", exc_info=True)
        finally:
            self._active = False

    def _pop_step(self) -> Optional[Tuple[str, Any]]:
        """
        Pulls the next expected burst.
        Returns:
            ("VOICE", frame) when in-order burst is available.
            ("PLC", ref_frame) when burst is lost or short jitter underrun occurs.
            None when stream is starved for > max_plc_bursts (silence / transmission ended).
        """
        if self._expected_seq is None:
            return None

        # 1. Exact expected packet present in queue
        if self._expected_seq in self._queue:
            frame = self._queue.pop(self._expected_seq)
            self._expected_seq = (self._expected_seq + 1) % 256
            self._consecutive_erasures = 0
            return ("VOICE", frame)

        # 2. Check if a NEWER packet exists in queue -> packet loss confirmed!
        newer_seqs = [s for s in self._queue.keys() if seq_diff(s, self._expected_seq) > 0]
        if newer_seqs:
            lost_seq = self._expected_seq
            self._expected_seq = (self._expected_seq + 1) % 256
            self._consecutive_erasures += 1
            logger.debug(f"[JB_SLOT{self.slot}] Packet loss detected: seq={lost_seq} missing; synthesized AMBE+2 PLC")
            return ("PLC", self._last_valid_frame)

        # 3. Queue is empty -> momentary network underrun
        if self._consecutive_erasures < self.max_plc_bursts:
            self._consecutive_erasures += 1
            self._expected_seq = (self._expected_seq + 1) % 256
            logger.debug(f"[JB_SLOT{self.slot}] Jitter underrun: synthesizing AMBE+2 PLC ({self._consecutive_erasures}/{self.max_plc_bursts})")
            return ("PLC", self._last_valid_frame)

        # 4. Stream starved > max_plc_bursts (120ms) -> pause
        return None

    def drain_sync(self):
        """
        Drains all remaining queued packets synchronously in order through vocoder
        (called when terminator frame arrives so tail audio is never lost).
        """
        self._active = False
        if self._consumer_task and not self._consumer_task.done():
            self._consumer_task.cancel()

        if self._queue and self._expected_seq is not None:
            sorted_seqs = sorted(self._queue.keys(), key=lambda s: seq_diff(s, self._expected_seq))
            for s in sorted_seqs:
                f = self._queue[s]
                pcm_8k, meta_list = self.vocoder.decode_burst_with_meta(f.payload, slot=self.slot)
                if pcm_8k:
                    self.on_audio_out(self.slot, pcm_8k, meta_list, f)
            self._queue.clear()

    def reset(self):
        """Resets jitter buffer state for slot."""
        self._active = False
        if self._consumer_task and not self._consumer_task.done():
            self._consumer_task.cancel()
        self._queue.clear()
        self._expected_seq = None
        self._current_stream_id = None
        self._last_valid_frame = None
        self._consecutive_erasures = 0
        self._is_buffering = True
