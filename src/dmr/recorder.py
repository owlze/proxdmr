"""
recorder.py - Audio Recorder and Session Manager for ProxDMR
Captures RX and TX DMR audio, stitches multi-over conversation sessions
with amateur-radio style seam beep markers, saves to standard WAV format,
and enforces storage quotas with automatic FIFO cleanup.
"""

import asyncio
import io
import logging
import math
import os
import re
import struct
import time
import uuid
import wave
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple, Any, Callable, Coroutine

try:
    from database import (
        get_recordings_dir,
        create_recording,
        get_recordings_stats,
        get_oldest_recordings,
        delete_recording,
    )
except ImportError:
    from src.database import (
        get_recordings_dir,
        create_recording,
        get_recordings_stats,
        get_oldest_recordings,
        delete_recording,
    )

logger = logging.getLogger("proxdmr.recorder")


class BeepMarkerGenerator:
    """
    Generates multi-tone seam markers (roger beeps) between stitched call segments
    at 8000 Hz 16-bit mono PCM with smooth cosine fade-in and fade-out.
    Supports up to 7 pairs of (freq_hz, dur_ms), e.g. "600,80, 800,100".
    Pre-computed in memory for 0 CPU overhead.
    """
    SAMPLE_RATE: int = 8000
    AMPLITUDE: float = 0.25  # ~ -12 dBFS
    _cache: Dict[str, bytes] = {}

    @classmethod
    def parse_pattern(cls, pattern_str: str) -> List[Tuple[float, int, float]]:
        if not pattern_str:
            return [(600.0, 110, 0.33), (840.0, 50, 0.15)]
        raw = re.sub(r"\s*-\s*", "-", str(pattern_str).strip())
        tokens = [t for t in re.split(r"[,;\s]+", raw) if t]
        tones: List[Tuple[float, int, float]] = []
        i = 0
        while i < len(tokens) and len(tones) < 7:
            t = tokens[i]
            if "-" in t:
                parts = [p for p in t.split("-") if p]
                try:
                    freq = float(parts[0])
                    dur = int(float(parts[1])) if len(parts) > 1 else 80
                    vol_pct = float(parts[2]) if len(parts) > 2 else 30.0
                    vol = max(0.01, min(1.0, vol_pct / 100.0))
                    dur = max(5, min(2000, dur))
                    tones.append((freq, dur, vol))
                except (ValueError, TypeError):
                    pass
                i += 1
            elif i + 1 < len(tokens) and "-" not in tokens[i + 1]:
                # Legacy pair: freq dur (or freq, dur)
                try:
                    freq = float(tokens[i])
                    dur = int(float(tokens[i + 1]))
                    tones.append((freq, min(dur, 2000), 0.30))
                    i += 2
                except (ValueError, TypeError):
                    i += 1
            else:
                i += 1
        return tones or [(600.0, 110, 0.33), (840.0, 50, 0.15)]

    @classmethod
    def get_marker_bytes(cls, pattern_str: str = "600-110-33, 840-50-15") -> bytes:
        key = (pattern_str or "600-110-33, 840-50-15").strip()
        if key in cls._cache:
            return cls._cache[key]

        pairs = cls.parse_pattern(key)
        all_samples = []

        for freq, dur_ms, vol in pairs:
            total_samples = int(cls.SAMPLE_RATE * dur_ms / 1000)
            fade_samples = min(int(cls.SAMPLE_RATE * 0.008), total_samples // 4)  # 8ms fade
            peak = 32767.0 * max(0.01, min(1.0, vol))

            if freq <= 0:
                all_samples.extend([0] * total_samples)
                continue

            for i in range(total_samples):
                t = i / cls.SAMPLE_RATE
                s = math.sin(2.0 * math.pi * freq * t)
                if fade_samples > 0:
                    if i < fade_samples:
                        w = 0.5 * (1.0 - math.cos(math.pi * i / fade_samples))
                    elif i >= total_samples - fade_samples:
                        idx = total_samples - 1 - i
                        w = 0.5 * (1.0 - math.cos(math.pi * idx / fade_samples))
                    else:
                        w = 1.0
                else:
                    w = 1.0
                val = int(s * w * peak)
                all_samples.append(max(-32768, min(32767, val)))

        marker_bytes = struct.pack(f"<{len(all_samples)}h", *all_samples)
        cls._cache[key] = marker_bytes
        logger.info(f"[RECORDER] Seam marker pre-computed for '{key}': {len(marker_bytes)} bytes ({len(all_samples)} samples, {len(pairs)} tones)")
        return marker_bytes


def save_pcm_to_wav(
    file_path: Path,
    pcm_bytes: bytes,
    sample_rate: int = 8000,
    channels: int = 1,
    sampwidth: int = 2
) -> int:
    """Save raw 16-bit PCM bytes to a standard RIFF WAV file."""
    file_path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(file_path), "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sampwidth)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes)
    return file_path.stat().st_size


class CallAudioBuffer:
    """Buffers PCM frames for a single DMR transmission (Auto-QSO)."""

    def __init__(
        self,
        call_id: str,
        hotspot_id: str,
        slot: int,
        src_id: int,
        src_callsign: str,
        src_name: str,
        talker_alias: str,
        dst_id: int,
        call_type: str = "RX",
        user_id: int = 1,
    ):
        self.call_id = call_id or f"call_{int(time.time() * 1000)}"
        self.hotspot_id = hotspot_id
        self.slot = slot
        self.src_id = src_id
        self.src_callsign = (src_callsign or "").strip()
        self.src_name = (src_name or "").strip()
        self.talker_alias = (talker_alias or "").strip()
        self.dst_id = dst_id
        self.call_type = call_type.upper()
        self.user_id = user_id
        self.start_time = time.time()
        self.last_activity = self.start_time
        self.buffer = bytearray()

    MAX_BYTES = 16000 * 60 * 30  # 30 минут на один вызов (защита RAM)

    def append(self, pcm_bytes: bytes) -> None:
        if len(self.buffer) < self.MAX_BYTES:
            self.buffer.extend(pcm_bytes)
        self.last_activity = time.time()

    def get_duration(self) -> float:
        # 8000 Hz, 16-bit mono = 16000 bytes per second
        return len(self.buffer) / 16000.0

    def finalize(self, min_duration_sec: float = 0.5) -> Optional[dict]:
        duration = self.get_duration()
        if duration < min_duration_sec or len(self.buffer) == 0:
            return None

        # Clean callsign for filename
        clean_call = re.sub(r"[^A-Za-z0-9_-]", "_", self.src_callsign.upper()) if self.src_callsign else str(self.src_id)
        if not clean_call or clean_call == "_":
            clean_call = str(self.src_id)

        time_tag = time.strftime("%Y%m%d_%H%M%S", time.localtime(self.start_time))
        rec_id = f"rec_{int(self.start_time * 1000)}_{self.src_id}_{uuid.uuid4().hex[:6]}"
        filename = f"{time_tag}_{self.call_type}_{clean_call}_TG{self.dst_id}_{rec_id[-6:]}.wav"

        recordings_dir = get_recordings_dir()
        file_path = recordings_dir / filename

        try:
            file_size = save_pcm_to_wav(file_path, self.buffer)
            rec_dict = {
                "id": rec_id,
                "user_id": self.user_id,
                "created_at": self.start_time,
                "filename": filename,
                "file_path": str(file_path),
                "file_size": file_size,
                "duration": round(duration, 2),
                "call_type": self.call_type,
                "hotspot_id": self.hotspot_id,
                "slot": self.slot,
                "src_id": self.src_id,
                "src_callsign": self.src_callsign,
                "src_name": self.src_name,
                "talker_alias": self.talker_alias,
                "dst_id": self.dst_id,
                "call_id": self.call_id,
            }
            logger.info(f"[RECORDER] Saved {self.call_type} call recording: {filename} ({duration:.1f}s, {file_size} bytes)")
            return rec_dict
        except Exception as e:
            logger.error(f"[RECORDER] Failed to save WAV {file_path}: {e}")
            return None


class SessionAudioRecorder:
    """
    Buffers continuous conversational sessions across multiple overs (Master REC).
    Excludes dead air and inserts an 80ms 600 Hz seam beep between discontinuous transmissions.
    """

    def __init__(
        self,
        session_id: str,
        user_id: int = 1,
        hotspot_id: str = "default",
        gap_threshold_sec: float = 1.2,
        seam_beep_enabled: bool = True,
        seam_beep_pattern: str = "600-110-33, 840-50-15",
    ):
        self.session_id = session_id
        self.user_id = user_id
        self.hotspot_id = hotspot_id
        self.gap_threshold_sec = gap_threshold_sec
        self.seam_beep_enabled = seam_beep_enabled
        self.seam_beep_pattern = seam_beep_pattern
        self.start_time = time.time()
        self.last_chunk_time: float = 0.0
        self.buffer = bytearray()
        self.transmissions_count: int = 0
        self.talkers: Set[str] = set()
        self.tgs: Set[int] = set()
        self.current_talker: str = ""

    MAX_BYTES = 16000 * 3600 * 3  # 3 часа максимум для сессионной записи (~172 МБ)

    def append_audio(
        self,
        pcm_bytes: bytes,
        src_callsign: str = "",
        dst_id: int = 0,
        is_tx: bool = False
    ) -> None:
        now = time.monotonic()

        if len(self.buffer) >= self.MAX_BYTES:
            self.last_chunk_time = now
            return

        # Check for gap between transmissions
        if self.last_chunk_time > 0:
            gap = now - self.last_chunk_time
            if gap >= self.gap_threshold_sec:
                self.transmissions_count += 1
                if self.seam_beep_enabled:
                    beep = BeepMarkerGenerator.get_marker_bytes(self.seam_beep_pattern)
                    self.buffer.extend(beep)
                    logger.debug(f"[RECORDER-SESSION] Inserted seam marker ({len(beep)} bytes, pattern '{self.seam_beep_pattern}', gap: {gap:.2f}s)")

        self.buffer.extend(pcm_bytes)
        self.last_chunk_time = now

        callsign = (src_callsign or "").strip()
        if is_tx:
            callsign = "ME (TX)"

        if callsign:
            self.talkers.add(callsign)
            self.current_talker = callsign
        if dst_id > 0:
            self.tgs.add(dst_id)

    def get_duration(self) -> float:
        return len(self.buffer) / 16000.0

    def get_status(self) -> dict:
        return {
            "session_id": self.session_id,
            "active": True,
            "start_time": self.start_time,
            "duration": round(self.get_duration(), 1),
            "size_bytes": len(self.buffer),
            "transmissions_count": max(1, self.transmissions_count),
            "talkers": sorted(list(self.talkers)),
            "tgs": sorted(list(self.tgs)),
            "current_talker": self.current_talker,
        }

    def finalize(self, min_duration_sec: float = 0.5) -> Optional[dict]:
        duration = self.get_duration()
        if duration < min_duration_sec or len(self.buffer) == 0:
            logger.info(f"[RECORDER-SESSION] Session {self.session_id} too short ({duration:.1f}s), discarded")
            return None

        time_tag = time.strftime("%Y%m%d_%H%M%S", time.localtime(self.start_time))
        rec_id = f"session_{int(self.start_time * 1000)}_{uuid.uuid4().hex[:6]}"
        filename = f"{time_tag}_SESSION_user{self.user_id}_{rec_id[-6:]}.wav"

        recordings_dir = get_recordings_dir()
        file_path = recordings_dir / filename

        try:
            file_size = save_pcm_to_wav(file_path, self.buffer)
            talkers_str = ", ".join(sorted(list(self.talkers))[:4])
            if len(self.talkers) > 4:
                talkers_str += f" +{len(self.talkers) - 4}"
            tgs_str = ", ".join(f"TG{t}" for t in sorted(list(self.tgs))[:3])

            primary_tg = list(self.tgs)[0] if self.tgs else 0

            rec_dict = {
                "id": rec_id,
                "user_id": self.user_id,
                "created_at": self.start_time,
                "filename": filename,
                "file_path": str(file_path),
                "file_size": file_size,
                "duration": round(duration, 2),
                "call_type": "SESSION",
                "hotspot_id": self.hotspot_id,
                "slot": 1,
                "src_id": 0,
                "src_callsign": f"Session ({max(1, self.transmissions_count)} overs)",
                "src_name": talkers_str or "Multi-over QSO",
                "talker_alias": tgs_str,
                "dst_id": primary_tg,
                "call_id": self.session_id,
            }
            logger.info(f"[RECORDER-SESSION] Saved master session: {filename} ({duration:.1f}s, {file_size} bytes)")
            return rec_dict
        except Exception as e:
            logger.error(f"[RECORDER-SESSION] Failed to save session WAV {file_path}: {e}")
            return None


class ServerAudioRecorder:
    """
    Master coordinator for audio recording in ProxDMR.
    Integrates with HotspotManager, respects slot mute states,
    handles auto-QSO recording, session recording, and storage quota management.
    """

    def __init__(self, broadcast_fn: Optional[Callable[[dict], Coroutine]] = None):
        self.broadcast_fn = broadcast_fn

        # Settings
        self.auto_rx_enabled: bool = True
        self.auto_tx_enabled: bool = True
        self.seam_beep_enabled: bool = True
        self.seam_beep_pattern: str = "600-110-33, 840-50-15"
        self.min_duration_sec: float = 0.5
        self.max_storage_mb: int = 2048  # Default 2 GB quota
        self.auto_cleanup_enabled: bool = True
        self.gap_threshold_sec: float = 1.2

        # Active buffers: key is "hid_slot"
        self._rx_buffers: Dict[str, CallAudioBuffer] = {}
        self._tx_buffer: Optional[CallAudioBuffer] = None

        # Active master recording sessions: key is user_id
        self._sessions: Dict[int, SessionAudioRecorder] = {}

        # Muted slots tracking: set of (hotspot_id_str, slot_int)
        self._muted_slots: Set[Tuple[str, int]] = set()
        self._muted_hotspots: Set[str] = set()

        self._last_recording_state: Optional[Any] = None

        # Ссылки на фоновые задачи (защита от GC)
        self._bg_tasks: Set[asyncio.Task] = set()

    def is_recording(self, user_id: int = 1) -> bool:
        """Returns True if any recording is currently taking place (session, RX call, or TX call)."""
        return bool(self.is_session_active(user_id) or self._rx_buffers or self._tx_buffer)

    def get_recording_hotspots(self) -> List[str]:
        """Returns list of hotspot IDs currently having active audio recording."""
        hids = set()
        for buf in self._rx_buffers.values():
            if buf.hotspot_id:
                hids.add(str(buf.hotspot_id))
        if self._tx_buffer and self._tx_buffer.hotspot_id:
            hids.add(str(self._tx_buffer.hotspot_id))
        return sorted(list(hids))

    def on_hotspot_auto_record_disabled(self, hotspot_id: str) -> None:
        """Immediately discard in-flight recordings for a hotspot when its auto-record is disabled."""
        hid_key = str(hotspot_id).strip().lower()
        to_del = [k for k in self._rx_buffers if k.startswith(f"{hid_key}_") or (hid_key == "default" and "_" in k)]
        for k in to_del:
            buf = self._rx_buffers.pop(k, None)
            if buf:
                logger.info(f"[RECORDER] Auto-record disabled for {hotspot_id}: cancelled in-flight RX call {k}")
        if self._tx_buffer and (str(self._tx_buffer.hotspot_id).lower() == hid_key or hid_key == "default"):
            self._tx_buffer = None
            logger.info(f"[RECORDER] Auto-record disabled for {hotspot_id}: cancelled in-flight TX call")
        self._check_and_notify_recording_state(1)

    def _check_and_notify_recording_state(self, user_id: int = 1) -> None:
        is_rec = self.is_recording(user_id)
        rec_hids = self.get_recording_hotspots()
        state_key = (is_rec, tuple(rec_hids), self.is_session_active(user_id))
        if self._last_recording_state != state_key:
            self._last_recording_state = state_key
            self._notify_async({
                "type": "recording_state",
                "active": is_rec,
                "session_active": self.is_session_active(user_id),
                "rx_active": bool(self._rx_buffers),
                "tx_active": bool(self._tx_buffer),
                "recording_hotspots": rec_hids,
            })

    # ─── Mute State Tracking ──────────────────────────────────────────

    def set_slot_mute(self, hotspot_id: str, slot: int, muted: bool) -> None:
        hid = str(hotspot_id).strip().lower()
        key = (hid, int(slot))
        if muted:
            self._muted_slots.add(key)
        else:
            self._muted_slots.discard(key)
        logger.debug(f"[RECORDER] Slot mute updated: {key} -> {muted}")

    def set_hotspot_mute(self, hotspot_id: str, muted: bool) -> None:
        hid = str(hotspot_id).strip().lower()
        if muted:
            self._muted_hotspots.add(hid)
            self._muted_slots.add((hid, 1))
            self._muted_slots.add((hid, 2))
        else:
            self._muted_hotspots.discard(hid)
            self._muted_slots.discard((hid, 1))
            self._muted_slots.discard((hid, 2))
        logger.debug(f"[RECORDER] Hotspot mute updated: {hid} -> {muted}")

    def is_slot_muted(self, hotspot_id: str, slot: int) -> bool:
        hid = str(hotspot_id).strip().lower()
        if hid in self._muted_hotspots:
            return True
        if (hid, int(slot)) in self._muted_slots:
            return True
        return False

    # ─── Settings Synchronization ──────────────────────────────────────

    def apply_settings(self, settings_dict: dict) -> None:
        if not settings_dict or not isinstance(settings_dict, dict):
            return

        rec_cfg = settings_dict.get("recordings_settings", {})
        if not rec_cfg:
            # Maybe top-level keys
            rec_cfg = settings_dict

        if "auto_record" in rec_cfg:
            val = bool(rec_cfg["auto_record"])
            self.auto_rx_enabled = val
            self.auto_tx_enabled = val
        if "auto_record_rx" in rec_cfg:
            self.auto_rx_enabled = bool(rec_cfg["auto_record_rx"])
        if "auto_record_tx" in rec_cfg:
            self.auto_tx_enabled = bool(rec_cfg["auto_record_tx"])
        if "seam_beep" in rec_cfg:
            self.seam_beep_enabled = bool(rec_cfg["seam_beep"])
        if "seam_beep_pattern" in rec_cfg:
            self.seam_beep_pattern = str(rec_cfg["seam_beep_pattern"]).strip() or "600-110-33, 840-50-15"
        if "min_duration_sec" in rec_cfg:
            self.min_duration_sec = float(rec_cfg["min_duration_sec"])
        if "max_storage_gb" in rec_cfg:
            self.max_storage_mb = int(float(rec_cfg["max_storage_gb"]) * 1024)
        elif "max_storage_mb" in rec_cfg:
            self.max_storage_mb = int(rec_cfg["max_storage_mb"])
        if "auto_cleanup" in rec_cfg:
            self.auto_cleanup_enabled = bool(rec_cfg["auto_cleanup"])
        if "gap_threshold_sec" in rec_cfg:
            self.gap_threshold_sec = float(rec_cfg["gap_threshold_sec"])

        logger.info(
            f"[RECORDER] Settings applied: auto_rx={self.auto_rx_enabled}, auto_tx={self.auto_tx_enabled}, "
            f"seam_beep={self.seam_beep_enabled} ('{self.seam_beep_pattern}'), min_dur={self.min_duration_sec}s, quota={self.max_storage_mb}MB"
        )

    # ─── RX Audio Feed ────────────────────────────────────────────────

    def feed_rx(
        self,
        hotspot_id: str,
        slot: int,
        src_id: int,
        src_callsign: str,
        src_name: str,
        talker_alias: str,
        dst_id: int,
        pcm_bytes: bytes,
        call_id: str = "",
        user_id: int = 1,
        auto_record: bool = True,
    ) -> None:
        hid_key = str(hotspot_id).strip().lower()
        rx_key = f"{hid_key}_{slot}"

        # 1. Per-Call Auto-Recording (Auto-QSO)
        if self.auto_rx_enabled and auto_record:
            buf = self._rx_buffers.get(rx_key)
            if not buf:
                buf = CallAudioBuffer(
                    call_id=call_id,
                    hotspot_id=hotspot_id,
                    slot=slot,
                    src_id=src_id,
                    src_callsign=src_callsign,
                    src_name=src_name,
                    talker_alias=talker_alias,
                    dst_id=dst_id,
                    call_type="RX",
                    user_id=user_id,
                )
                self._rx_buffers[rx_key] = buf
                self._check_and_notify_recording_state(user_id)
            else:
                # Update metadata if resolved later
                if src_callsign and not buf.src_callsign:
                    buf.src_callsign = src_callsign
                if src_name and not buf.src_name:
                    buf.src_name = src_name
                if talker_alias and not buf.talker_alias:
                    buf.talker_alias = talker_alias
                if call_id and not buf.call_id:
                    buf.call_id = call_id

            buf.append(pcm_bytes)

        # 2. Master Session Recording (if active)
        for s in self._sessions.values():
            s.append_audio(
                pcm_bytes,
                src_callsign=src_callsign or str(src_id),
                dst_id=dst_id,
                is_tx=False
            )

    def on_rx_call_ended(self, hotspot_id: str, slot: int, call_id: str = "") -> None:
        hid_key = str(hotspot_id).strip().lower()
        rx_key = f"{hid_key}_{slot}"
        buf = self._rx_buffers.pop(rx_key, None)
        self._check_and_notify_recording_state(1)
        if not buf:
            return

        if call_id and not buf.call_id:
            buf.call_id = call_id

        # Save WAV (в потоке, чтобы не блокировать event loop) и записать в БД
        self._spawn_bg(self._finalize_and_persist(buf, "RX", f"{hotspot_id}_TS{slot}"))

    # ─── TX Audio Feed ────────────────────────────────────────────────

    def start_tx(
        self,
        hotspot_id: str,
        slot: int,
        src_id: int,
        src_callsign: str,
        dst_id: int,
        call_id: str = "",
        user_id: int = 1,
        auto_record: bool = True,
    ) -> None:
        if self.auto_tx_enabled and auto_record:
            self._tx_buffer = CallAudioBuffer(
                call_id=call_id,
                hotspot_id=hotspot_id,
                slot=slot,
                src_id=src_id,
                src_callsign=src_callsign or "ME",
                src_name="ME (TX)",
                talker_alias=src_callsign or "ME",
                dst_id=dst_id,
                call_type="TX",
                user_id=user_id,
            )
            self._check_and_notify_recording_state(user_id)

    def feed_tx(self, pcm_bytes: bytes) -> None:
        if self._tx_buffer:
            self._tx_buffer.append(pcm_bytes)

        # Master Session
        for s in self._sessions.values():
            s.append_audio(
                pcm_bytes,
                src_callsign="ME (TX)",
                dst_id=self._tx_buffer.dst_id if self._tx_buffer else 0,
                is_tx=True
            )

    def stop_tx(self, call_id: str = "") -> None:
        buf = self._tx_buffer
        self._tx_buffer = None
        self._check_and_notify_recording_state(1)
        if not buf:
            return

        if call_id and not buf.call_id:
            buf.call_id = call_id

        self._spawn_bg(self._finalize_and_persist(buf, "TX", f"{buf.hotspot_id}_TS{buf.slot}"))

    def _spawn_bg(self, coro) -> None:
        """create_task с удержанием ссылки (иначе задачу может собрать GC) и логированием ошибок."""
        try:
            task = asyncio.get_running_loop().create_task(coro)
        except RuntimeError:
            coro.close()
            logger.warning("[RECORDER] No running loop, background task dropped")
            return
        self._bg_tasks.add(task)
        task.add_done_callback(self._bg_tasks.discard)

    async def _finalize_and_persist(self, buf: "CallAudioBuffer", kind: str, where: str) -> None:
        try:
            rec_data = await asyncio.to_thread(buf.finalize, self.min_duration_sec)
            if rec_data:
                await self._persist_and_broadcast(rec_data)
            else:
                logger.info(
                    f"[RECORDER] {kind} call {buf.src_callsign or buf.src_id} on {where} "
                    f"discarded: audio duration {buf.get_duration():.2f}s < min_duration {self.min_duration_sec}s"
                )
        except Exception as e:
            logger.error(f"[RECORDER] Failed to finalize {kind} call recording: {e}", exc_info=True)

    # ─── Master Session Recording ─────────────────────────────────────

    def start_session(self, user_id: int = 1, hotspot_id: str = "default") -> dict:
        session_id = f"sess_{int(time.time() * 1000)}_{uuid.uuid4().hex[:4]}"
        session = SessionAudioRecorder(
            session_id=session_id,
            user_id=user_id,
            hotspot_id=hotspot_id,
            gap_threshold_sec=self.gap_threshold_sec,
            seam_beep_enabled=self.seam_beep_enabled,
            seam_beep_pattern=self.seam_beep_pattern,
        )
        self._sessions[user_id] = session
        logger.info(f"[RECORDER-SESSION] Started session {session_id} for user {user_id}")

        status = session.get_status()
        self._notify_async({
            "type": "recording_session_state",
            "active": True,
            "session": status,
        })
        self._check_and_notify_recording_state(user_id)
        return status

    async def stop_session(self, user_id: int = 1) -> Optional[dict]:
        session = self._sessions.pop(user_id, None)
        if not session:
            self._notify_async({
                "type": "recording_session_state",
                "active": False,
                "session": None,
            })
            self._check_and_notify_recording_state(user_id)
            return None

        rec_data = await asyncio.to_thread(session.finalize, self.min_duration_sec)
        saved = None
        if rec_data:
            saved = await self._persist_and_broadcast(rec_data)

        self._notify_async({
            "type": "recording_session_state",
            "active": False,
            "session": None,
            "saved_recording": saved,
        })
        self._check_and_notify_recording_state(user_id)
        return saved

    def is_session_active(self, user_id: int = 1) -> bool:
        return user_id in self._sessions

    def get_session_status(self, user_id: int = 1) -> Optional[dict]:
        s = self._sessions.get(user_id)
        return s.get_status() if s else None

    # ─── Persistence, WS Notification & Quota Pruning ─────────────────

    async def _persist_and_broadcast(self, rec_dict: dict) -> dict:
        try:
            await create_recording(rec_dict)
            rec_id = rec_dict.get("id")
            logger.info(f"[RECORDER] Recording registered in DB: {rec_id} ({rec_dict.get('filename')})")

            # Broadcast WebSocket notification
            self._notify_async({
                "type": "recording_saved",
                "recording": rec_dict,
                "call_id": rec_dict.get("call_id", ""),
            })

            # Check and prune storage quota if enabled
            if self.auto_cleanup_enabled:
                asyncio.create_task(self.check_and_prune_quota(rec_dict.get("user_id", 1)))

            return rec_dict
        except Exception as e:
            logger.error(f"[RECORDER] Failed to persist recording to DB: {e}")
            return rec_dict

    async def check_and_prune_quota(self, user_id: int = 1) -> None:
        """Enforce maximum storage quota by removing oldest recordings (FIFO)."""
        try:
            stats = await get_recordings_stats(user_id)
            total_bytes = stats.get("total_size_bytes", 0)
            max_bytes = self.max_storage_mb * 1024 * 1024

            if total_bytes <= max_bytes:
                return

            excess_bytes = total_bytes - max_bytes
            logger.info(
                f"[RECORDER-QUOTA] Storage exceeded ({total_bytes / (1024*1024):.1f} MB > {self.max_storage_mb} MB). "
                f"Pruning ~{excess_bytes / (1024*1024):.1f} MB..."
            )

            oldest = await get_oldest_recordings(user_id, limit=100)
            freed_bytes = 0
            pruned_ids = []

            for r in oldest:
                rec_id = r["id"]
                file_path = Path(r["file_path"])
                file_size = r.get("file_size", 0)

                # Delete from DB
                await delete_recording(rec_id)

                # Delete file from disk
                try:
                    if file_path.exists():
                        file_path.unlink()
                    mp3_path = file_path.with_suffix(".mp3")
                    if mp3_path.exists():
                        mp3_path.unlink()
                except Exception as fe:
                    logger.warning(f"[RECORDER-QUOTA] Could not delete file {file_path}: {fe}")

                freed_bytes += file_size
                pruned_ids.append(rec_id)

                if total_bytes - freed_bytes <= max_bytes * 0.90:  # prune to 90%
                    break

            logger.info(f"[RECORDER-QUOTA] Pruned {len(pruned_ids)} recordings, freed {freed_bytes / (1024*1024):.1f} MB")
            self._notify_async({
                "type": "recordings_pruned",
                "pruned_count": len(pruned_ids),
                "freed_bytes": freed_bytes,
            })
        except Exception as e:
            logger.error(f"[RECORDER-QUOTA] Error pruning quota: {e}")

    def _notify_async(self, data: dict) -> None:
        if self.broadcast_fn:
            asyncio.create_task(self.broadcast_fn(data))
