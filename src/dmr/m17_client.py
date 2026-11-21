# -*- coding: utf-8 -*-
"""
M17 Reflector Network Client & Adapter (mrefd / urfd / vex).
Implements UDP exchange on port 17000 (default): CONN / LSTN / ACKN / NACK / PING->PONG / DISC
and 54-byte 'M17 ' Codec2 voice stream packets (40ms / 640B PCM16 per packet).
"""

import asyncio
import logging
import math
import random
import socket
import struct
import time
from typing import Any, Callable, Dict, Optional

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

try:
    from dmr.m17_codec import M17Codec2
    from dmr.m17_frame import (
        build_conn_packet,
        build_disc_packet,
        build_lstn_packet,
        build_m17_stream_packet,
        build_pong_packet,
        format_m17_client_callsign,
        format_m17_reflector_dst,
        normalize_m17_module,
        parse_m17_stream_packet,
    )
except ImportError:
    from src.dmr.m17_codec import M17Codec2
    from src.dmr.m17_frame import (
        build_conn_packet,
        build_disc_packet,
        build_lstn_packet,
        build_m17_stream_packet,
        build_pong_packet,
        format_m17_client_callsign,
        format_m17_reflector_dst,
        normalize_m17_module,
        parse_m17_stream_packet,
    )

logger = logging.getLogger("proxdmr.m17_client")


class M17Client(asyncio.DatagramProtocol):
    """Asynchronous UDP Protocol Client for M17 Reflectors (mrefd / urfd / vex)."""

    def __init__(
        self,
        host: str = "",
        port: int = 17000,
        callsign: str = "N0CALL",
        suffix: str = "D",
        reflector: str = "",
        reflector_name: str = "",
        module: str = "C",
        can: int = 0,
        link_mode: str = "conn",
        codec_mode: str = "3200",
        dst_mode: str = "reflector",
        meta_text: str = "",
        server_type: str = "mrefd",
        rx_only: bool = False,
        on_state_change: Optional[Callable[[str, str], None]] = None,
        on_rx_audio: Optional[Callable[[bytes, float, str, str], None]] = None,
        on_carrier_change: Optional[Callable[[bool, dict], None]] = None,
        on_proc_step: Optional[Callable[[str, str, str, str], None]] = None,
        user_id: Optional[int] = None,
        **kwargs,
    ):
        self.host = str(host or "").strip()
        self.port = int(port or 17000)
        self.callsign = str(callsign or "N0CALL").strip().upper()
        self.suffix = str(suffix if suffix is not None else "D").strip().upper()[:1]
        self.reflector = str(reflector or "").strip().upper()[:8]
        self.reflector_name = str(reflector_name or "").strip()
        self.module = normalize_m17_module(module, "C")
        self.can = max(0, min(15, int(can or 0)))
        self.link_mode = str(link_mode or "conn").strip().lower()
        if self.link_mode not in ("conn", "lstn"):
            self.link_mode = "conn"
        self.codec_mode = str(codec_mode or "3200").strip()
        if self.codec_mode not in ("3200", "1600"):
            self.codec_mode = "3200"
        self.dst_mode = str(dst_mode or "reflector").strip().lower()
        if self.dst_mode not in ("reflector", "broadcast"):
            self.dst_mode = "reflector"
        self.meta_text = str(meta_text or "").strip()[:14]
        self.server_type = str(server_type or "mrefd").strip().lower()
        self.rx_only = bool(rx_only or self.link_mode == "lstn")
        self.user_id = user_id

        self.on_state_change = on_state_change
        self.on_rx_audio = on_rx_audio
        self.on_carrier_change = on_carrier_change
        self.on_proc_step = on_proc_step

        self.codec = M17Codec2()
        self.state: str = "OFFLINE"
        self._transport: Optional[asyncio.DatagramTransport] = None
        self._remote_addr: Optional[tuple] = None
        self._watchdog_task: Optional[asyncio.Task] = None
        self._rx_watchdog_task: Optional[asyncio.Task] = None
        self._reconnect_task: Optional[asyncio.Task] = None
        self._handshake_event = asyncio.Event()
        self._handshake_result: str = ""  # "ACKN" | "NACK" | ""
        self._connect_gen: int = 0
        self._session_gen: int = 0
        self._manual_disconnect: bool = False

        self.last_server_ping_ts: float = 0.0
        self.last_rx_ts: float = 0.0
        self.is_rx: bool = False
        self.is_tx: bool = False
        self.online_count: int = 0
        self.last_heard: list = []

        self.current_caller: str = ""
        self.current_ext_caller: str = ""
        self.current_meta_text: str = ""
        self.current_rx_can: int = 0
        self.current_rx_codec: str = "3200"
        self.current_rx_encrypted: bool = False
        self._rx_stream_id: int = 0

        self._tx_stream_id: int = 0
        self._tx_fn: int = 0
        self._last_tx_pcm640: bytes = b"\x00" * 640
        self._last_tx_stop_ts: float = 0.0

    def _emit_proc_step(self, code: str, text: str, tone: str = "neutral", state: str = "active") -> None:
        if self.on_proc_step:
            try:
                self.on_proc_step(code, text, tone, state)
            except Exception as e:
                logger.debug(f"[M17] proc_step error: {e}")

    def _set_state(self, new_state: str, detail: str = "") -> None:
        self.state = new_state
        if self.on_state_change:
            try:
                self.on_state_change(new_state, detail)
            except Exception as e:
                logger.debug(f"[M17] state_change error: {e}")

    def _client_cs(self) -> str:
        return format_m17_client_callsign(self.callsign, self.suffix)

    def _target_dst(self) -> str:
        if self.dst_mode == "broadcast":
            return "@ALL"
        ref = self.reflector or "M17-M17"
        return format_m17_reflector_dst(ref, self.module)

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        self._transport = transport  # type: ignore[assignment]

    def error_received(self, exc: Exception) -> None:
        logger.debug(f"[M17:{self.callsign}] UDP error: {exc}")

    def connection_lost(self, exc: Optional[Exception]) -> None:
        if exc:
            logger.debug(f"[M17:{self.callsign}] UDP connection lost: {exc}")

    def datagram_received(self, data: bytes, addr: tuple) -> None:
        if not data or len(data) < 4:
            return
        magic = data[:4]
        now = time.time()

        if magic == b"ACKN":
            self._handshake_result = "ACKN"
            self.last_server_ping_ts = now
            self._handshake_event.set()
            return

        if magic == b"NACK":
            self._handshake_result = "NACK"
            self._handshake_event.set()
            return

        if magic == b"PING":
            self.last_server_ping_ts = now
            if self._transport and self._remote_addr:
                try:
                    self._transport.sendto(build_pong_packet(self._client_cs()), self._remote_addr)
                except Exception as e:
                    logger.debug(f"[M17] Send PONG error: {e}")
            return

        if magic == b"DISC":
            if self.is_rx:
                self._end_rx_carrier()
            if not self._manual_disconnect and self.state in ("ONLINE", "RX", "TX"):
                logger.warning(f"[M17:{self.callsign}] Reflector sent DISC on {self.reflector} {self.module}, scheduling reconnect...")
                self._schedule_reconnect("reflector DISC")
            return

        if magic == b"M17 " and len(data) >= 54:
            self.last_server_ping_ts = now
            parsed = parse_m17_stream_packet(data)
            if not parsed:
                return

            # Ignore immediate own TX loopback while allowing fast echo/parrot playback
            own_cs = self._client_cs().strip()
            rx_src = str(parsed.get("src") or "").strip()
            if self.is_tx and rx_src == own_cs:
                return
            if (now - self._last_tx_stop_ts) < 0.15 and rx_src == own_cs:
                return

            sid = int(parsed.get("stream_id") or 0)
            ext_cf1 = str(parsed.get("ext_cf1") or "").strip()
            meta_txt = str(parsed.get("meta_text") or "").strip()
            enc = bool(parsed.get("encrypted", False))
            can_val = int(parsed.get("can") or 0)
            c_mode = str(parsed.get("codec_mode") or "3200")
            is_eot = bool(parsed.get("is_eot", False))

            self.last_rx_ts = now
            if not self.is_rx or (sid and sid != self._rx_stream_id):
                if self.is_rx:
                    self._end_rx_carrier()
                self.codec.reset("rx")
                self.is_rx = True
                self._rx_stream_id = sid
                self.current_caller = rx_src or "UNKNOWN"
                self.current_ext_caller = ext_cf1
                self.current_meta_text = meta_txt
                self.current_rx_can = can_val
                self.current_rx_codec = c_mode
                self.current_rx_encrypted = enc
                self._set_state("RX", f"{self.reflector} {self.module}")
                self._emit_carrier(True)
            else:
                if ext_cf1 and not self.current_ext_caller:
                    self.current_ext_caller = ext_cf1
                if meta_txt and not self.current_meta_text:
                    self.current_meta_text = meta_txt

            if enc:
                pcm640 = b"\x00" * 640
            else:
                pcm640 = self.codec.decode_40ms(parsed["payload16"], mode=c_mode)

            if self.on_rx_audio and pcm640:
                rms = 0.0
                if not enc:
                    n = len(pcm640) // 2
                    if n > 0:
                        samples = struct.unpack(f"<{n}h", pcm640)
                        rms = math.sqrt(sum(s * s for s in samples) / n) / 32768.0
                try:
                    self.on_rx_audio(pcm640, rms, self.current_caller, f"{self.reflector} {self.module}")
                except Exception as e:
                    logger.debug(f"[M17] on_rx_audio error: {e}")

            if is_eot:
                self._end_rx_carrier()

    def _emit_carrier(self, active: bool) -> None:
        if not self.on_carrier_change:
            return
        meta = {
            "caller": self.current_caller or "UNKNOWN",
            "ext_caller": self.current_ext_caller,
            "meta_text": self.current_meta_text,
            "can": self.current_rx_can,
            "codec_mode": self.current_rx_codec,
            "encrypted": self.current_rx_encrypted,
            "reflector": self.reflector,
            "module": self.module,
        }
        try:
            self.on_carrier_change(active, meta)
        except Exception as e:
            logger.debug(f"[M17] on_carrier_change error: {e}")

    def _end_rx_carrier(self) -> None:
        if not self.is_rx:
            return
        self.is_rx = False
        self._rx_stream_id = 0
        self.codec.reset("rx")
        if self.state == "RX":
            self._set_state("ONLINE", f"{self.reflector} {self.module}")
        self._emit_carrier(False)
        self.current_caller = ""
        self.current_ext_caller = ""
        self.current_meta_text = ""
        self.current_rx_encrypted = False

    def retarget(
        self,
        host: str,
        port: int = 17000,
        reflector: str = "",
        reflector_name: str = "",
        module: str = "C",
        server_type: str = "mrefd",
        link_mode: Optional[str] = None,
        can: Optional[int] = None,
        codec_mode: Optional[str] = None,
        dst_mode: Optional[str] = None,
        meta_text: Optional[str] = None,
        suffix: Optional[str] = None,
        rx_only: Optional[bool] = None,
    ) -> None:
        self.host = str(host or "").strip()
        self.port = int(port or 17000)
        self.reflector = str(reflector or "").strip().upper()[:8]
        self.reflector_name = str(reflector_name or "").strip()
        self.module = normalize_m17_module(module, "C")
        self.server_type = str(server_type or "mrefd").strip().lower()
        if link_mode is not None:
            lm = str(link_mode).strip().lower()
            if lm in ("conn", "lstn"):
                self.link_mode = lm
        if can is not None:
            self.can = max(0, min(15, int(can)))
        if codec_mode is not None and str(codec_mode) in ("3200", "1600"):
            self.codec_mode = str(codec_mode)
        if dst_mode is not None and str(dst_mode).lower() in ("reflector", "broadcast"):
            self.dst_mode = str(dst_mode).lower()
        if meta_text is not None:
            self.meta_text = str(meta_text).strip()[:14]
        if suffix is not None:
            self.suffix = str(suffix).strip().upper()[:1]
        if rx_only is not None:
            self.rx_only = bool(rx_only)
        else:
            self.rx_only = (self.link_mode == "lstn")

    def clear_target(self) -> None:
        self.host = ""
        self.reflector = ""
        self.reflector_name = ""

    async def switch_module_live(self, module: str, link_mode: Optional[str] = None) -> bool:
        """Send DISC, wait 90ms, and reconnect on the same reflector with new module/link_mode."""
        self.module = normalize_m17_module(module, self.module)
        if link_mode in ("conn", "lstn"):
            self.link_mode = link_mode
            self.rx_only = (link_mode == "lstn")
        await self.disconnect(is_retry=True)
        await asyncio.sleep(0.09)
        return await self.connect()

    async def connect(self, _from_reconnect: bool = False) -> bool:
        clean_host = str(self.host or "").strip()
        if not clean_host:
            self._set_state("OFFLINE", _tr("m17.state_waiting_room", user_id=self.user_id, fallback="Standby (waiting for reflector selection)"))
            return False

        self._manual_disconnect = False
        if not _from_reconnect:
            self._session_gen += 1
            if self._reconnect_task and not self._reconnect_task.done():
                self._reconnect_task.cancel()
                self._reconnect_task = None
        self._connect_gen += 1
        my_gen = self._connect_gen
        self._set_state("CONNECTING", f"{self.reflector or clean_host} {self.module}")
        self._emit_proc_step("lookup", f"DNS lookup: {clean_host}:{self.port}", "neutral", "active")

        try:
            loop = asyncio.get_running_loop()
            addr_info = await loop.getaddrinfo(clean_host, self.port, family=socket.AF_INET, type=socket.SOCK_DGRAM)
            if self._manual_disconnect or my_gen != self._connect_gen or not addr_info:
                self._set_state("OFFLINE", "DNS lookup failed")
                self._emit_proc_step("failed", f"DNS lookup failed: {clean_host}", "negative", "failed")
                return False

            self._remote_addr = addr_info[0][4]
            transport, _ = await loop.create_datagram_endpoint(lambda: self, remote_addr=self._remote_addr)
            if self._manual_disconnect or my_gen != self._connect_gen:
                transport.close()
                return False
            self._transport = transport

            attempt_mode = "lstn" if self.link_mode == "lstn" else "conn"
            for try_idx in range(2):
                self._handshake_result = ""
                self._handshake_event.clear()
                pkt = build_lstn_packet(self._client_cs(), self.module) if attempt_mode == "lstn" else build_conn_packet(self._client_cs(), self.module)
                self._emit_proc_step("connect", f"Sending {attempt_mode.upper()} -> {self.reflector} {self.module}", "neutral", "active")
                self._transport.sendto(pkt, self._remote_addr)

                try:
                    await asyncio.wait_for(self._handshake_event.wait(), timeout=4.5)
                except asyncio.TimeoutError:
                    self._handshake_result = "TIMEOUT"

                if self._manual_disconnect or my_gen != self._connect_gen:
                    return False

                if self._handshake_result == "ACKN":
                    self._emit_proc_step("ackn", f"ACKN: {self.reflector} {self.module} ({attempt_mode.upper()})", "positive", "done")
                    break

                if self._handshake_result == "NACK" and attempt_mode == "lstn" and try_idx == 0:
                    # Fallback to CONN once on older servers that do not support LSTN, keeping local rx_only=True
                    self.rx_only = True
                    attempt_mode = "conn"
                    self._emit_proc_step("nack", "LSTN NACK -> fallback to CONN (RX-only)", "neutral", "active")
                    await asyncio.sleep(0.08)
                    continue

                err_code = "timeout" if self._handshake_result == "TIMEOUT" else "nack"
                err_msg = f"Reflector {self._handshake_result or 'NACK'} ({self.reflector} {self.module})"
                self._emit_proc_step(err_code, err_msg, "negative", "failed")
                self._set_state("OFFLINE", err_msg)
                if self._transport:
                    self._transport.close()
                    self._transport = None
                return False

            self.last_server_ping_ts = time.time()
            self._set_state("ONLINE", f"{self.reflector} {self.module}")

            if self._watchdog_task:
                self._watchdog_task.cancel()
            if self._rx_watchdog_task:
                self._rx_watchdog_task.cancel()
            self._watchdog_task = asyncio.create_task(self._watchdog_loop(my_gen))
            self._rx_watchdog_task = asyncio.create_task(self._rx_watchdog_loop(my_gen))
            return True
        except Exception as e:
            logger.error(f"[M17:{self.callsign}] Connect error: {e}")
            self._set_state("OFFLINE", f"Connect error: {e}")
            self._emit_proc_step("failed", f"Connect error: {e}", "negative", "failed")
            return False

    def _schedule_reconnect(self, reason: str = "keepalive timeout") -> None:
        if self._manual_disconnect or not str(self.host or "").strip():
            return
        if self._reconnect_task and not self._reconnect_task.done():
            return
        my_session = self._session_gen
        try:
            self._reconnect_task = asyncio.create_task(self._reconnect_loop(my_session, reason))
        except RuntimeError:
            pass

    async def _reconnect_loop(self, my_session: int, reason: str = "keepalive timeout") -> None:
        delays = [2.0, 4.0, 8.0, 15.0, 30.0]
        attempt = 0
        try:
            while my_session == self._session_gen and not self._manual_disconnect:
                if self._watchdog_task:
                    self._watchdog_task.cancel()
                    self._watchdog_task = None
                if self._rx_watchdog_task:
                    self._rx_watchdog_task.cancel()
                    self._rx_watchdog_task = None
                if self._transport:
                    try:
                        self._transport.close()
                    except Exception:
                        pass
                    self._transport = None

                delay = delays[min(attempt, len(delays) - 1)]
                attempt += 1
                self._set_state("CONNECTING", f"Reconnecting ({reason}, #{attempt})...")
                await asyncio.sleep(0.3 if attempt == 1 else delay)

                if my_session != self._session_gen or self._manual_disconnect:
                    break
                if not str(self.host or "").strip():
                    break

                ok = await self.connect(_from_reconnect=True)
                if ok:
                    logger.info(f"[M17:{self.callsign}] Reconnected to {self.reflector} {self.module} on attempt #{attempt}")
                    break
                logger.warning(f"[M17:{self.callsign}] Reconnect attempt #{attempt} failed on {self.reflector} {self.module}; retrying in {delays[min(attempt, len(delays) - 1)]:.0f}s")
        except asyncio.CancelledError:
            pass
        finally:
            if self._reconnect_task and self._reconnect_task.done():
                self._reconnect_task = None

    async def _watchdog_loop(self, my_gen: int) -> None:
        try:
            while my_gen == self._connect_gen and not self._manual_disconnect:
                await asyncio.sleep(2.0)
                if my_gen != self._connect_gen or self._manual_disconnect:
                    break
                if self.last_server_ping_ts > 0 and (time.time() - self.last_server_ping_ts) > 20.0:
                    logger.warning(f"[M17:{self.callsign}] Keepalive timeout (>20s without PING/RX) on {self.reflector} {self.module}, scheduling reconnect...")
                    self._schedule_reconnect("keepalive timeout")
                    break
        except asyncio.CancelledError:
            pass

    async def _rx_watchdog_loop(self, my_gen: int) -> None:
        try:
            while my_gen == self._connect_gen and not self._manual_disconnect:
                await asyncio.sleep(0.15)
                if self.is_rx and self.last_rx_ts > 0 and (time.time() - self.last_rx_ts) > 0.700:
                    self._end_rx_carrier()
        except asyncio.CancelledError:
            pass

    async def disconnect(self, is_retry: bool = False) -> None:
        if not is_retry:
            self._manual_disconnect = True
            self._session_gen += 1
        self._connect_gen += 1
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            self._reconnect_task = None
        if self._watchdog_task:
            self._watchdog_task.cancel()
            self._watchdog_task = None
        if self._rx_watchdog_task:
            self._rx_watchdog_task.cancel()
            self._rx_watchdog_task = None

        if self.is_rx:
            self._end_rx_carrier()

        if self._transport and self._remote_addr:
            try:
                self._transport.sendto(build_disc_packet(self._client_cs()), self._remote_addr)
            except Exception:
                pass
            try:
                self._transport.close()
            except Exception:
                pass
        self._transport = None
        if not is_retry:
            self._set_state("OFFLINE", _tr("m17.state_disconnected", user_id=self.user_id, fallback="Disconnected"))
            self._emit_proc_step("disconnect", f"DISC sent ({self.reflector})", "neutral", "done")

    def start_ptt(self) -> bool:
        if self.link_mode == "lstn" or self.rx_only:
            return False
        if not self._transport or not self._remote_addr or self.state not in ("ONLINE", "RX", "TX"):
            return False
        self.codec.reset("tx")
        self._tx_stream_id = random.randint(1, 65534)
        self._tx_fn = 0
        self._last_tx_pcm640 = b"\x00" * 640
        self.is_tx = True
        self._set_state("TX", f"{self.reflector} {self.module}")
        return True

    def send_tx_audio_chunk(self, pcm640: bytes) -> bool:
        if not self.is_tx or self.link_mode == "lstn" or self.rx_only:
            return False
        if not self._transport or not self._remote_addr:
            return False
        if len(pcm640) < 640:
            pcm640 = pcm640 + b"\x00" * (640 - len(pcm640))
        elif len(pcm640) > 640:
            pcm640 = pcm640[:640]
        self._last_tx_pcm640 = pcm640
        payload16 = self.codec.encode_40ms(pcm640, mode=self.codec_mode)
        pkt = build_m17_stream_packet(
            stream_id=self._tx_stream_id,
            dst_callsign=self._target_dst(),
            src_callsign=self._client_cs(),
            fn=self._tx_fn,
            payload16=payload16,
            is_eot=False,
            codec_mode=self.codec_mode,
            can=self.can,
            meta_text=self.meta_text,
        )
        try:
            self._transport.sendto(pkt, self._remote_addr)
            self._tx_fn = (self._tx_fn + 1) & 0x7FFF
            return True
        except Exception as e:
            logger.debug(f"[M17] Send TX chunk error: {e}")
            return False

    def stop_ptt(self) -> None:
        if not self.is_tx:
            return
        if self._transport and self._remote_addr and self._tx_stream_id:
            try:
                payload16 = self.codec.encode_40ms(self._last_tx_pcm640 or (b"\x00" * 640), mode=self.codec_mode)
                eot_pkt = build_m17_stream_packet(
                    stream_id=self._tx_stream_id,
                    dst_callsign=self._target_dst(),
                    src_callsign=self._client_cs(),
                    fn=self._tx_fn,
                    payload16=payload16,
                    is_eot=True,
                    codec_mode=self.codec_mode,
                    can=self.can,
                    meta_text=self.meta_text,
                )
                self._transport.sendto(eot_pkt, self._remote_addr)
            except Exception as e:
                logger.debug(f"[M17] Send EOT error: {e}")
        self.is_tx = False
        self._last_tx_stop_ts = time.time()
        self._tx_stream_id = 0
        self.codec.reset("tx")
        if self.state == "TX":
            self._set_state("ONLINE", f"{self.reflector} {self.module}")


class M17ClientAdapter:
    """Adapter bridging M17Client with ProxDMR HotspotManager, Recorder, Transcriber, and WS."""

    def __init__(self, manager: Any, hotspot_id: str, client: M17Client, user_id: int = 1):
        self.manager = manager
        self.hotspot_id = hotspot_id
        self.client = client
        self.user_id = user_id
        self._is_manual_disconnect = False
        self._call_start_ts: float = 0.0
        self._current_call_id: str = ""
        self._active_caller: str = ""

        self.client.on_state_change = self._on_m17_state_change
        self.client.on_carrier_change = self._on_m17_carrier_change
        self.client.on_rx_audio = self._on_m17_rx_audio
        self.client.on_proc_step = self._on_m17_proc_step

    @property
    def is_connected(self) -> bool:
        return self.client.state in ("ONLINE", "RX", "TX")

    @property
    def network_label(self) -> str:
        return "M17"

    async def connect(self, force: bool = False) -> bool:
        if force:
            self._is_manual_disconnect = False
        elif self._is_manual_disconnect:
            return False
        if not str(getattr(self.client, "host", "") or "").strip():
            return False
        return await self.client.connect()

    async def disconnect(self, is_retry: bool = False, *args, **kwargs) -> None:
        self._is_manual_disconnect = not is_retry
        await self.client.disconnect(is_retry=is_retry)

    def start_ptt(self, slot: int = 1) -> bool:
        return self.client.start_ptt()

    def stop_ptt(self, slot: int = 1) -> None:
        self.client.stop_ptt()

    def send_tx_audio_chunk(self, chunk: bytes, slot: int = 1) -> bool:
        return self.client.send_tx_audio_chunk(chunk)

    def _on_m17_proc_step(self, code: str, text: str, tone: str, state: str) -> None:
        self.manager._notify_async({
            "type": "m17_proc_step",
            "hotspot_id": self.hotspot_id,
            "code": code,
            "text": text,
            "tone": tone,
            "state": state,
            "reflector": self.client.reflector,
            "module": self.client.module,
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_m17_state_change(self, state: str, detail: str) -> None:
        from src.dmr.homebrew import BMState
        mapped = BMState.ONLINE if state in ("ONLINE", "RX", "TX") else (BMState.CONNECTING if state == "CONNECTING" else BMState.DISCONNECTED)
        self.manager._on_client_status(self.hotspot_id, mapped, detail, user_id=self.user_id)

    def _on_m17_carrier_change(self, is_carrier: bool, meta: dict) -> None:
        now = time.time()
        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        reflector = str(meta.get("reflector") or self.client.reflector or "M17").strip()
        module = str(meta.get("module") or self.client.module or "C").strip()
        dst_name = f"{reflector} {module}".strip()
        caller_raw = str(meta.get("caller") or "UNKNOWN").strip().upper()
        ext_caller = str(meta.get("ext_caller") or "").strip().upper()
        display_caller = ext_caller if ext_caller else caller_raw
        meta_text = str(meta.get("meta_text") or "").strip()
        talker_alias = meta_text or dst_name
        encrypted = bool(meta.get("encrypted", False))

        active_calls = self.manager._get_user_active_calls(self.user_id)
        call_history = self.manager._get_user_call_history(self.user_id)
        call_key = f"{self.hotspot_id}_1"

        if is_carrier:
            self._call_start_ts = now
            call_id = f"m17_{int(now * 1000)}_{self.hotspot_id}"
            self._current_call_id = call_id
            self._active_caller = display_caller

            if rt and hasattr(rt, "ts1"):
                rt.ts1.active = True
                rt.ts1.src_id = 0
                rt.ts1.src_callsign = display_caller
                rt.ts1.src_name = ""
                rt.ts1.talker_alias = talker_alias
                rt.ts1.dst_id = 0
                rt.ts1.last_seen = now

            from src.dmr.manager import CallLogEntry
            new_call = CallLogEntry(
                id=call_id,
                timestamp=now,
                hotspot_id=self.hotspot_id,
                slot=1,
                src_id=0,
                src_callsign=display_caller,
                src_name="",
                talker_alias=talker_alias,
                dst_id=0,
                dst_name=dst_name,
                call_type="GROUP",
                active=True,
                is_tx=False,
                network_type="m17",
                source_type="VoIP",
                user_id=self.user_id,
            )
            active_calls[call_key] = new_call
            call_history.insert(0, new_call)
            self.manager.prune_calls(user_id=self.user_id)

            self.manager._notify_async({
                "type": "dmr_activity",
                "hotspot_id": self.hotspot_id,
                "slot": 1,
                "active": True,
                "is_tx": False,
                "src_id": 0,
                "src_callsign": display_caller,
                "caller_display": display_caller,
                "ext_caller": ext_caller,
                "meta_text": meta_text,
                "encrypted": encrypted,
                "dst_id": 0,
                "dst_name": dst_name,
                "call_type": "GROUP",
                "call_id": call_id,
                "network_type": "m17",
                "source_type": "VoIP",
                "call_entry": new_call.to_dict(),
                "user_id": self.user_id,
            }, user_id=self.user_id)
        else:
            if rt and hasattr(rt, "ts1"):
                rt.ts1.active = False

            prev_call = active_calls.pop(call_key, None)
            call_id = prev_call.id if prev_call else (self._current_call_id or f"m17_{int(now * 1000)}_{self.hotspot_id}")
            duration = max(0.5, round(now - (prev_call.timestamp if prev_call else (self._call_start_ts or now)), 1))
            if prev_call:
                prev_call.active = False
                prev_call.duration = duration
                self.manager._history_dirty.add(self.user_id)
                self.manager._save_calls_history(self.user_id)

            if self.manager.transcriber and hasattr(self.manager.transcriber, "is_slot_enabled") and self.manager.transcriber.is_slot_enabled(self.hotspot_id, 1):
                try:
                    self.manager.transcriber.on_call_ended(self.hotspot_id, 1, call_id=call_id)
                except Exception:
                    pass
            if hasattr(self.manager, "recorder") and self.manager.recorder:
                try:
                    self.manager.recorder.on_rx_call_ended(self.hotspot_id, 1, call_id=call_id)
                except Exception:
                    pass

            self.manager._notify_async({
                "type": "dmr_activity",
                "hotspot_id": self.hotspot_id,
                "slot": 1,
                "active": False,
                "is_tx": False,
                "src_id": 0,
                "src_callsign": display_caller,
                "ext_caller": ext_caller,
                "meta_text": meta_text,
                "encrypted": encrypted,
                "dst_id": 0,
                "dst_name": dst_name,
                "call_id": call_id,
                "duration": duration,
                "network_type": "m17",
                "user_id": self.user_id,
            }, user_id=self.user_id)

        self.manager._notify_async({
            "type": "m17_carrier",
            "hotspot_id": self.hotspot_id,
            "carrier": is_carrier,
            "is_rx": is_carrier,
            "caller": caller_raw,
            "ext_caller": ext_caller,
            "meta_text": meta_text,
            "reflector": reflector,
            "module": module,
            "server_type": self.client.server_type,
            "can": int(meta.get("can") or 0),
            "codec_mode": str(meta.get("codec_mode") or self.client.codec_mode),
            "encrypted": encrypted,
            "link_mode": self.client.link_mode,
            "rx_only": self.client.rx_only,
            "online_count": getattr(self.client, "online_count", 0),
            "slot": 1,
            "network": "m17",
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_m17_rx_audio(self, pcm16: bytes, rms: float, caller: str, room: str) -> None:
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
        dst_name = f"{self.client.reflector} {self.client.module}".strip()
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
                    talker_alias=self.client.current_meta_text or dst_name,
                    dst_id=0,
                    pcm_bytes=pcm16,
                    call_id=call_id,
                    user_id=self.user_id,
                    auto_record=auto_rec,
                )
            except Exception as e:
                logger.debug(f"[M17] Recorder feed error: {e}")

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
                logger.debug(f"[M17] Transcriber feed error: {e}")
