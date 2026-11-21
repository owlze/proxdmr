# -*- coding: utf-8 -*-
"""
dstar_client.py - D-STAR Reflector Network Client & Adapter for ProxDMR.
Supports DExtra (UDP 30001), DCS (UDP 30051), and DPlus (UDP 20001).
Handles 20ms AMBE 3600x2400 audio frames, Slow Data 20-char text,
carrier tracking, and full bidirectional audio pipeline.
"""

import asyncio
import logging
import math
import random
import socket
import struct
import time
from typing import Any, Callable, Dict, Optional, Tuple

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

try:
    from dmr.dstar_frame import (
        build_dstar_header,
        parse_dstar_header,
        build_dsvt_header_packet,
        build_dsvt_voice_frame,
        parse_dsvt_packet,
        DStarSlowDataCodec,
        build_dextra_connect,
        build_dextra_disconnect,
        build_dextra_poll,
        is_dextra_ack,
        build_dcs_connect,
        build_dcs_disconnect,
        build_dcs_ping,
        build_dcs_voice_packet,
        parse_dcs_voice_packet,
        DPLUS_INIT_STEP1,
        DPLUS_POLL,
        DPLUS_DISCONNECT,
        build_dplus_auth_step2,
        parse_dplus_auth_response,
    )
except ImportError:
    from src.dmr.dstar_frame import (
        build_dstar_header,
        parse_dstar_header,
        build_dsvt_header_packet,
        build_dsvt_voice_frame,
        parse_dsvt_packet,
        DStarSlowDataCodec,
        build_dextra_connect,
        build_dextra_disconnect,
        build_dextra_poll,
        is_dextra_ack,
        build_dcs_connect,
        build_dcs_disconnect,
        build_dcs_ping,
        build_dcs_voice_packet,
        parse_dcs_voice_packet,
        DPLUS_INIT_STEP1,
        DPLUS_POLL,
        DPLUS_DISCONNECT,
        build_dplus_auth_step2,
        parse_dplus_auth_response,
    )

logger = logging.getLogger("proxdmr.dstar_client")


class DStarClient(asyncio.DatagramProtocol):
    """Asynchronous UDP Protocol Client for D-STAR Reflectors."""

    def __init__(
        self,
        host: str = "",
        port: int = 30001,
        callsign: str = "N0CALL",
        suffix: str = "D",
        my2: str = "PROX",
        reflector: str = "XLX250",
        reflector_name: str = "",
        module: str = "D",
        local_module: str = "D",
        protocol: str = "auto",
        urcall: str = "CQCQCQ  ",
        text: str = "",
        rx_only: bool = False,
        vocoder: Any = None,
        vocoder_encoder: Any = None,
        on_state_change: Optional[Callable[[str, str], None]] = None,
        on_rx_audio: Optional[Callable[[bytes, float, str, str], None]] = None,
        on_carrier_change: Optional[Callable[[bool, dict], None]] = None,
        on_proc_step: Optional[Callable[[str, str, str, str], None]] = None,
        user_id: Optional[int] = None,
    ):
        self.host = (host or "").strip()
        self.port = int(port or 30001)
        self.callsign = (callsign or "N0CALL").strip().upper()
        self.suffix = (suffix or "D").strip().upper()[:1]
        self.my2 = (my2 or "PROX").strip().upper()[:4]
        self.reflector = (reflector or "XLX250").strip().upper()
        self.reflector_name = reflector_name or self.reflector
        self.module = (module or "D").strip().upper()[:1]
        self.local_module = (local_module or self.suffix or "D").strip().upper()[:1]
        self.protocol_setting = (protocol or "auto").strip().lower()
        self.effective_protocol = "dextra"
        self.urcall = (urcall or "CQCQCQ  ").strip().upper()[:8].ljust(8)
        self.text = (text or "")[:20]
        self.rx_only = bool(rx_only)
        self.server_ro = False

        self.vocoder = vocoder
        self.vocoder_encoder = vocoder_encoder
        self.on_state_change = on_state_change
        self.on_rx_audio = on_rx_audio
        self.on_carrier_change = on_carrier_change
        self.on_proc_step = on_proc_step
        self.user_id = user_id

        self.transport: Optional[asyncio.DatagramTransport] = None
        self.state = "OFFLINE"
        self.state_text = _tr("dstar.state_offline", "Offline", user_id=self.user_id)
        self.resolved_addr: Optional[Tuple[str, int]] = None

        self._poll_task: Optional[asyncio.Task] = None
        self._hang_task: Optional[asyncio.Task] = None
        self._last_rx_packet_time: float = 0.0

        self.slow_data_codec = DStarSlowDataCodec(self.text)
        self.current_rx_caller = ""
        self.current_rx_my2 = ""
        self.current_rx_urcall = ""
        self.current_rx_text = ""
        self.current_rx_stream_id = 0
        self.is_carrier_active = False

        # TX State
        self.tx_stream_id = 0
        self.tx_seq = 0
        self.tx_counter = 0
        self.is_tx_active = False

    def _determine_effective_protocol(self) -> Tuple[str, int]:
        p = self.protocol_setting
        desig = self.reflector.upper()
        if p in ("dextra", "dcs", "dplus"):
            proto = p
        else:
            if desig.startswith("DCS"):
                proto = "dcs"
            elif desig.startswith("REF"):
                proto = "dplus"
            else:
                proto = "dextra"

        port = self.port
        if port in (0, 30001, 30051, 20001):
            if proto == "dcs":
                port = 30051
            elif proto == "dplus":
                port = 20001
            else:
                port = 30001
        return proto, port

    def _set_state(self, new_state: str, text: str = ""):
        self.state = new_state
        self.state_text = text or new_state
        if self.on_state_change:
            try:
                self.on_state_change(self.state, self.state_text)
            except Exception as e:
                logger.debug(f"[DSTAR] on_state_change error: {e}")

    def _emit_proc_step(self, step_id: str, label: str, icon: str = "info", desc: str = ""):
        if self.on_proc_step:
            try:
                self.on_proc_step(step_id, label, icon, desc)
            except Exception as e:
                logger.debug(f"[DSTAR] proc_step error: {e}")

    async def connect(self, force: bool = False) -> bool:
        if self.state in ("CONNECTING", "ONLINE") and not force:
            return True

        self._set_state("CONNECTING", _tr("dstar.state_connecting", "Connecting...", user_id=self.user_id))
        proto, port = self._determine_effective_protocol()
        self.effective_protocol = proto
        self.port = port
        self.server_ro = False

        self._emit_proc_step(
            "lookup",
            _tr("dstar.step_lookup", f"Lookup {self.reflector} ({self.effective_protocol.upper()})", user_id=self.user_id),
            "info"
        )

        loop = asyncio.get_running_loop()
        try:
            addr_info = await loop.getaddrinfo(self.host, self.port, family=socket.AF_INET, type=socket.SOCK_DGRAM)
            if not addr_info:
                raise ValueError(f"Could not resolve {self.host}")
            self.resolved_addr = (addr_info[0][4][0], self.port)
        except Exception as e:
            logger.error(f"[DSTAR] Host resolution failed for {self.host}: {e}")
            self._set_state("OFFLINE", f"DNS error: {e}")
            self._emit_proc_step("lookup", f"DNS error: {e}", "error")
            return False

        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: self,
                remote_addr=self.resolved_addr
            )
            self.transport = transport
        except Exception as e:
            logger.error(f"[DSTAR] Endpoint creation failed: {e}")
            self._set_state("OFFLINE", f"Socket error: {e}")
            self._emit_proc_step("lookup", f"Socket error: {e}", "error")
            return False

        self._emit_proc_step(
            "handshake",
            _tr("dstar.step_handshake", f"Connecting to {self.reflector} {self.module}", user_id=self.user_id),
            "info"
        )

        # Send initial protocol handshake
        self._send_connect_packet()

        # Start background polling task
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
        self._poll_task = asyncio.create_task(self._poll_loop())
        return True

    def _send_connect_packet(self):
        if not self.transport:
            return
        proto = self.effective_protocol
        try:
            if proto == "dextra":
                pkt = build_dextra_connect(self.callsign, self.local_module, self.module)
                self.transport.sendto(pkt)
            elif proto == "dcs":
                pkt = build_dcs_connect(self.callsign, self.local_module, self.reflector, self.module)
                self.transport.sendto(pkt)
            elif proto == "dplus":
                self.transport.sendto(DPLUS_INIT_STEP1)
        except Exception as e:
            logger.error(f"[DSTAR] Error sending connect packet: {e}")

    def _send_poll_packet(self):
        if not self.transport:
            return
        proto = self.effective_protocol
        try:
            if proto == "dextra":
                pkt = build_dextra_poll(self.callsign, self.local_module)
                self.transport.sendto(pkt)
            elif proto == "dcs":
                pkt = build_dcs_ping(self.callsign, self.local_module, self.reflector, self.module)
                self.transport.sendto(pkt)
            elif proto == "dplus":
                self.transport.sendto(DPLUS_POLL)
        except Exception as e:
            logger.debug(f"[DSTAR] Error sending poll packet: {e}")

    async def _poll_loop(self):
        proto = self.effective_protocol
        interval = 5.0 if proto in ("dcs", "dplus") else 9.0

        # Wait initial short delay for ACK
        await asyncio.sleep(1.0)
        if self.state == "CONNECTING":
            # For DExtra/DCS, if no explicit NAK arrived, assume online
            if proto in ("dextra", "dcs"):
                self._set_state("ONLINE", f"{self.reflector} {self.module} ({proto.upper()})")
                self._emit_proc_step("ackn", _tr("dstar.step_ackn", f"Connected to {self.reflector} {self.module}", user_id=self.user_id), "success")

        while True:
            try:
                await asyncio.sleep(interval)
                if self.state in ("ONLINE", "CONNECTING"):
                    self._send_poll_packet()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[DSTAR] Poll loop exception: {e}")

    def datagram_received(self, data: bytes, addr: Tuple[str, int]):
        self._last_rx_packet_time = time.time()
        proto = self.effective_protocol

        # 1. DPlus Handshake Sequence
        if proto == "dplus":
            if data == DPLUS_INIT_STEP1 or len(data) == 5:
                # Step 1 echo received -> send step 2 auth
                step2_pkt = build_dplus_auth_step2(self.callsign)
                if self.transport:
                    self.transport.sendto(step2_pkt)
                return
            elif len(data) >= 8 and (b"OK" in data or b"FAIL" in data or b"BUSY" in data):
                status = parse_dplus_auth_response(data)
                if status == "OKRW":
                    self.server_ro = False
                    self._set_state("ONLINE", f"{self.reflector} {self.module} (DPlus)")
                    self._emit_proc_step("ackn", _tr("dstar.step_ackn", f"Connected to {self.reflector} {self.module}", user_id=self.user_id), "success")
                elif status == "OKRO":
                    self.server_ro = True
                    self._set_state("ONLINE", f"{self.reflector} {self.module} (DPlus RX-Only)")
                    self._emit_proc_step("ro", _tr("dstar.step_ro", f"Connected RX-Only (US-TRUST required for TX)", user_id=self.user_id), "warning")
                elif status in ("FAIL", "BUSY"):
                    self._set_state("OFFLINE", f"Reflector returned {status}")
                    self._emit_proc_step("nack", f"Reflector rejected connection ({status})", "error")
                return

        # 2. DExtra ACK check
        if proto == "dextra":
            if is_dextra_ack(data):
                if self.state != "ONLINE":
                    self._set_state("ONLINE", f"{self.reflector} {self.module} (DExtra)")
                    self._emit_proc_step("ackn", _tr("dstar.step_ackn", f"Connected to {self.reflector} {self.module}", user_id=self.user_id), "success")

        # 3. DCS ACK check
        if proto == "dcs":
            if len(data) == 14 and b"ACK" in data:
                if self.state != "ONLINE":
                    self._set_state("ONLINE", f"{self.reflector} {self.module} (DCS)")
                    self._emit_proc_step("ackn", _tr("dstar.step_ackn", f"Connected to {self.reflector} {self.module}", user_id=self.user_id), "success")
            elif len(data) == 14 and b"NAK" in data:
                self._set_state("OFFLINE", "DCS Reflector NAK")
                self._emit_proc_step("nack", "DCS connection refused (NAK)", "error")
                return

        # 4. Audio Frames Parsing
        if proto in ("dextra", "dplus"):
            parsed = parse_dsvt_packet(data)
            if parsed:
                if parsed["type"] == "header":
                    hdr = parsed.get("header") or {}
                    self.current_rx_caller = (hdr.get("my1") or "UNKNOWN").strip().upper()
                    self.current_rx_my2 = (hdr.get("my2") or "").strip().upper()
                    self.current_rx_urcall = (hdr.get("urcall") or "").strip().upper()
                    self.current_rx_stream_id = parsed.get("stream_id", 0)
                    self.slow_data_codec.reset_rx()
                    self._start_carrier()
                elif parsed["type"] == "voice":
                    if not self.is_carrier_active:
                        self._start_carrier()
                    ambe9 = parsed.get("ambe", b"")
                    slow3 = parsed.get("slow", b"")
                    seq = parsed.get("seq", 0)
                    is_last = parsed.get("is_last", False)

                    # Slow Data text decode
                    new_text = self.slow_data_codec.decode_frame(seq, slow3)
                    if new_text and new_text != self.current_rx_text:
                        self.current_rx_text = new_text
                        self._update_carrier_meta()

                    # Vocoder decode
                    self._decode_and_feed_rx(ambe9)

                    if is_last:
                        self._stop_carrier(delay=0.1)
                    else:
                        self._reset_hang_timer()

        elif proto == "dcs":
            parsed = parse_dcs_voice_packet(data)
            if parsed:
                self.current_rx_caller = (parsed.get("my1") or "UNKNOWN").strip().upper()
                self.current_rx_my2 = (parsed.get("my2") or "").strip().upper()
                self.current_rx_urcall = (parsed.get("urcall") or "").strip().upper()
                self.current_rx_stream_id = parsed.get("stream_id", 0)

                if not self.is_carrier_active:
                    self._start_carrier()

                ambe9 = parsed.get("ambe", b"")
                slow3 = parsed.get("slow", b"")
                seq = parsed.get("seq", 0)
                is_last = parsed.get("is_last", False)

                new_text = self.slow_data_codec.decode_frame(seq, slow3)
                if new_text and new_text != self.current_rx_text:
                    self.current_rx_text = new_text
                    self._update_carrier_meta()

                self._decode_and_feed_rx(ambe9)

                if is_last:
                    self._stop_carrier(delay=0.1)
                else:
                    self._reset_hang_timer()

    def _decode_and_feed_rx(self, ambe9: bytes):
        if not ambe9 or len(ambe9) < 9:
            return
        pcm320 = b""
        if self.vocoder and hasattr(self.vocoder, "decode_dstar_frame"):
            pcm320 = self.vocoder.decode_dstar_frame(1, ambe9)
        else:
            pcm320 = b"\x00" * 320

        # Calculate approximate RMS for meter
        rms = 0.0
        if pcm320:
            try:
                samples = struct.unpack(f"<{len(pcm320)//2}h", pcm320)
                s_sum = sum(s * s for s in samples)
                rms = math.sqrt(s_sum / len(samples))
            except Exception:
                rms = 0.0

        if self.on_rx_audio:
            try:
                room_str = f"{self.reflector} {self.module}"
                self.on_rx_audio(pcm320, rms, self.current_rx_caller, room_str)
            except Exception as e:
                logger.debug(f"[DSTAR] on_rx_audio error: {e}")

    def _start_carrier(self):
        self.is_carrier_active = True
        self._update_carrier_meta(is_active=True)
        self._reset_hang_timer()

    def _stop_carrier(self, delay: float = 0.0):
        if delay > 0:
            if self._hang_task and not self._hang_task.done():
                self._hang_task.cancel()
            self._hang_task = asyncio.create_task(self._hang_worker(delay))
        else:
            self.is_carrier_active = False
            self._update_carrier_meta(is_active=False)

    def _reset_hang_timer(self):
        if self._hang_task and not self._hang_task.done():
            self._hang_task.cancel()
        self._hang_task = asyncio.create_task(self._hang_worker(0.8))

    async def _hang_worker(self, timeout: float):
        try:
            await asyncio.sleep(timeout)
            self.is_carrier_active = False
            self._update_carrier_meta(is_active=False)
        except asyncio.CancelledError:
            pass

    def _update_carrier_meta(self, is_active: Optional[bool] = None):
        if is_active is None:
            is_active = self.is_carrier_active
        if self.on_carrier_change:
            meta = {
                "caller": self.current_rx_caller,
                "my2": self.current_rx_my2,
                "urcall": self.current_rx_urcall,
                "text": self.current_rx_text,
                "reflector": self.reflector,
                "module": self.module,
                "protocol": self.effective_protocol,
                "rx_only": self.rx_only or self.server_ro,
            }
            try:
                self.on_carrier_change(is_active, meta)
            except Exception as e:
                logger.debug(f"[DSTAR] on_carrier_change error: {e}")

    # =========================================================================
    # TX Pipeline
    # =========================================================================

    def start_tx(self) -> bool:
        """Start a new transmission if online and not RX-only."""
        if self.state != "ONLINE" or not self.transport:
            return False
        if self.rx_only or self.server_ro:
            logger.info("[DSTAR] TX denied: client or server is in RX-Only mode.")
            return False

        self.tx_stream_id = random.randint(1, 0xFFFF)
        self.tx_seq = 0
        self.tx_counter = 0
        self.is_tx_active = True

        if self.vocoder_encoder and hasattr(self.vocoder_encoder, "reset_dstar"):
            self.vocoder_encoder.reset_dstar()

        # Build and send initial header packet
        proto = self.effective_protocol
        r2 = f"{self.reflector[:7].ljust(7)}G"
        r1 = f"{self.reflector[:7].ljust(7)}{self.module}"
        hdr_41 = build_dstar_header(
            my1=self.callsign,
            my2=self.my2,
            urcall=self.urcall,
            rpt1=r1,
            rpt2=r2
        )

        if proto in ("dextra", "dplus"):
            is_dp = (proto == "dplus")
            pkt = build_dsvt_header_packet(self.tx_stream_id, hdr_41, is_dplus=is_dp)
            try:
                self.transport.sendto(pkt)
            except Exception as e:
                logger.error(f"[DSTAR] TX header send error: {e}")
                self.is_tx_active = False
                return False

        return True

    def send_tx_audio_chunk(self, pcm320: bytes, is_last: bool = False):
        """Encodes and sends 20ms of audio (160 samples = 320 bytes)."""
        if not self.is_tx_active or not self.transport:
            return

        ambe9 = b"\x00" * 9
        if self.vocoder_encoder and hasattr(self.vocoder_encoder, "encode_dstar_frame"):
            ambe9 = self.vocoder_encoder.encode_dstar_frame(pcm320) or (b"\x00" * 9)

        slow3 = self.slow_data_codec.encode_frame(self.tx_seq)
        proto = self.effective_protocol

        if proto in ("dextra", "dplus"):
            is_dp = (proto == "dplus")
            pkt = build_dsvt_voice_frame(
                self.tx_stream_id,
                self.tx_seq,
                ambe9,
                slow3,
                is_last=is_last,
                is_dplus=is_dp
            )
            try:
                self.transport.sendto(pkt)
            except Exception as e:
                logger.debug(f"[DSTAR] TX voice frame error: {e}")

        elif proto == "dcs":
            r2 = f"{self.reflector[:7].ljust(7)}G"
            r1 = f"{self.reflector[:7].ljust(7)}{self.module}"
            pkt = build_dcs_voice_packet(
                my1=self.callsign,
                my2=self.my2,
                urcall=self.urcall,
                rpt1=r1,
                rpt2=r2,
                stream_id=self.tx_stream_id,
                frame_seq=self.tx_seq,
                ambe9=ambe9,
                slow3=slow3,
                pkt_counter=self.tx_counter,
                is_last=is_last
            )
            self.tx_counter += 1
            try:
                self.transport.sendto(pkt)
            except Exception as e:
                logger.debug(f"[DSTAR] TX DCS voice error: {e}")

        self.tx_seq = (self.tx_seq + 1) % 21

    def stop_tx(self):
        """Finish current transmission by sending final frame."""
        if not self.is_tx_active:
            return
        # Send silence frame with is_last flag
        self.send_tx_audio_chunk(b"\x00" * 320, is_last=True)
        self.is_tx_active = False

    def disconnect(self, is_retry: bool = False):
        cur_task = None
        try:
            cur_task = asyncio.current_task()
        except RuntimeError:
            pass
        if self._poll_task and not self._poll_task.done() and self._poll_task is not cur_task:
            self._poll_task.cancel()
        if self._hang_task and not self._hang_task.done() and self._hang_task is not cur_task:
            self._hang_task.cancel()

        if self.transport:
            proto = self.effective_protocol
            try:
                if proto == "dextra":
                    self.transport.sendto(build_dextra_disconnect(self.callsign, self.local_module))
                elif proto == "dcs":
                    self.transport.sendto(build_dcs_disconnect(self.callsign, self.local_module, self.reflector))
                elif proto == "dplus":
                    self.transport.sendto(DPLUS_DISCONNECT)
            except Exception:
                pass
            try:
                self.transport.close()
            except Exception:
                pass
            self.transport = None

        self.is_carrier_active = False
        self.is_tx_active = False
        if not is_retry:
            self._set_state("OFFLINE", _tr("dstar.state_offline", "Offline", user_id=self.user_id))
            self._emit_proc_step("disconnect", _tr("dstar.step_disc", "Disconnected", user_id=self.user_id), "info")

    def retarget(
        self,
        reflector: str,
        host: str,
        port: int,
        module: str,
        protocol: str = "auto",
        reflector_name: str = "",
        rx_only: Optional[bool] = None,
    ):
        self.reflector = (reflector or self.reflector).strip().upper()
        self.host = (host or self.host).strip()
        self.port = int(port or self.port)
        self.module = (module or self.module).strip().upper()[:1]
        self.protocol_setting = (protocol or self.protocol_setting).strip().lower()
        if reflector_name:
            self.reflector_name = reflector_name
        if rx_only is not None:
            self.rx_only = bool(rx_only)

    def switch_module_live(self, new_module: str, new_protocol: Optional[str] = None):
        self.module = (new_module or self.module).strip().upper()[:1]
        if new_protocol:
            self.protocol_setting = new_protocol.strip().lower()
        # Resend connect packet to switch module
        self._send_connect_packet()
        self._set_state("ONLINE", f"{self.reflector} {self.module} ({self.effective_protocol.upper()})")


class DStarClientAdapter:
    """Manager Adapter integrating DStarClient with ProxDMR runtime."""

    def __init__(self, manager: Any, hotspot_id: str, config: Any, user_id: Optional[int] = None):
        self.manager = manager
        self.hotspot_id = hotspot_id
        self.config = config
        self.user_id = user_id

        self.client = DStarClient(
            host=getattr(config, "dstar_host", "") or getattr(config, "bm_master_host", ""),
            port=getattr(config, "dstar_port", 30001) or getattr(config, "bm_master_port", 30001),
            callsign=getattr(config, "callsign", "N0CALL"),
            suffix=getattr(config, "dstar_local_module", "D"),
            my2=getattr(config, "dstar_my2", "PROX"),
            reflector=getattr(config, "dstar_reflector", "XLX250"),
            reflector_name=getattr(config, "dstar_reflector_name", ""),
            module=getattr(config, "dstar_module", "D"),
            local_module=getattr(config, "dstar_local_module", "D"),
            protocol=getattr(config, "dstar_protocol", "auto"),
            urcall=getattr(config, "dstar_urcall", "CQCQCQ  "),
            text=getattr(config, "dstar_text", ""),
            rx_only=getattr(config, "dstar_rx_only", False),
            vocoder=getattr(manager, "vocoder", None),
            vocoder_encoder=getattr(manager, "vocoder_encoder", None),
            on_state_change=self._on_state_change,
            on_rx_audio=self._on_rx_audio,
            on_carrier_change=self._on_carrier_change,
            on_proc_step=self._on_proc_step,
            user_id=user_id,
        )

        self._active_caller = ""
        self._current_call_id = ""

    async def connect(self, force: bool = False) -> bool:
        return await self.client.connect(force=force)

    async def disconnect(self, is_retry: bool = False, **kwargs):
        self.client.disconnect(is_retry=is_retry)

    def retarget(self, reflector: str, host: str, port: int, module: str, protocol: str = "auto", reflector_name: str = "", rx_only: Optional[bool] = None):
        self.client.retarget(reflector, host, port, module, protocol, reflector_name, rx_only)

    def switch_module_live(self, new_module: str, new_protocol: Optional[str] = None):
        self.client.switch_module_live(new_module, new_protocol)

    def start_tx(self) -> bool:
        return self.client.start_tx()

    def send_tx_pcm(self, pcm320: bytes, is_last: bool = False):
        self.client.send_tx_audio_chunk(pcm320, is_last=is_last)

    def send_tx_end(self):
        self.client.stop_tx()

    def _on_state_change(self, state: str, state_text: str):
        self.manager._notify_async({
            "type": "hotspot_updated",
            "hotspot_id": self.hotspot_id,
            "dstar_state": state,
            "dstar_state_text": state_text,
            "state": state,
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_proc_step(self, step_id: str, label: str, icon: str, desc: str):
        self.manager._notify_async({
            "type": "dstar_proc_step",
            "hotspot_id": self.hotspot_id,
            "step_id": step_id,
            "label": label,
            "icon": icon,
            "desc": desc,
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_carrier_change(self, is_carrier: bool, meta: dict):
        caller = meta.get("caller", "")
        if is_carrier:
            self._active_caller = caller
            self._current_call_id = f"dstar_{self.hotspot_id}_{int(time.time()*1000)}"
        else:
            self._active_caller = ""
            self._current_call_id = ""

        # Update last heard if completed
        if not is_carrier and caller:
            self.manager._record_last_heard(
                slot=1,
                src_id=0,
                dst_id=0,
                call_type="Group",
                src_callsign=caller,
                dst_name=f"{self.client.reflector} {self.client.module}",
                network="dstar",
                hotspot_id=self.hotspot_id,
                user_id=self.user_id
            )

        self.manager._notify_async({
            "type": "carrier_event",
            "hotspot_id": self.hotspot_id,
            "carrier": is_carrier,
            "is_rx": is_carrier,
            "caller": caller,
            "slot": 1,
            "network": "dstar",
            "meta": meta,
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_rx_audio(self, pcm16: bytes, rms: float, caller: str, room: str):
        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        if not rt:
            return
        if hasattr(rt, "ts1"):
            rt.ts1.last_seen = time.time()

        is_muted = False
        if hasattr(self.manager, "is_slot_muted"):
            try:
                is_muted = bool(self.manager.is_slot_muted(self.hotspot_id, 1))
            except Exception:
                is_muted = False
        if not is_muted:
            hid_bytes = self.hotspot_id.encode("utf-8")
            tagged_audio = bytes([1, len(hid_bytes)]) + hid_bytes + pcm16
            self.manager._broadcast_audio_async(tagged_audio, user_id=self.user_id)

        clean_caller = (caller or self._active_caller or "UNKNOWN").strip().upper()
        call_id = self._current_call_id or ""

        if hasattr(self.manager, "recorder") and self.manager.recorder and call_id:
            try:
                auto_rec = getattr(rt.config, "auto_record", False)
                self.manager.recorder.feed_rx(
                    hotspot_id=self.hotspot_id,
                    slot=1,
                    src_id=0,
                    src_callsign=clean_caller,
                    src_name="",
                    talker_alias=self.client.current_rx_text or room,
                    dst_id=0,
                    pcm_bytes=pcm16,
                    call_id=call_id,
                    user_id=self.user_id,
                    auto_record=auto_rec,
                )
            except Exception as e:
                logger.debug(f"[DSTAR] Recorder feed error: {e}")

        if (
            self.manager.transcriber
            and hasattr(self.manager.transcriber, "is_slot_enabled")
            and self.manager.transcriber.is_slot_enabled(self.hotspot_id, 1)
        ):
            try:
                self.manager.transcriber.feed_audio(
                    self.hotspot_id,
                    1,
                    0,
                    clean_caller,
                    pcm16,
                    call_id=call_id,
                )
            except Exception as e:
                logger.debug(f"[DSTAR] Transcriber feed error: {e}")
