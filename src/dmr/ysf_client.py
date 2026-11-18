# -*- coding: utf-8 -*-
"""
YSF (Yaesu System Fusion / C4FM) Reflector Network Client & Adapter.
Implements UDP exchange with YSFReflector on port 42000.
Handles YSFP (Poll/Keepalive), YSFI (Station Info), YSFU (Unlink) and YSFD (Voice/Data).
"""

import asyncio
import logging
import math
import socket
import struct
import time
from typing import Any, Callable, Dict, Optional

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

logger = logging.getLogger("proxdmr.ysf_client")


class YSFClient(asyncio.DatagramProtocol):
    """
    Asynchronous UDP Protocol Client for Yaesu System Fusion (YSFReflector).
    """

    def __init__(
        self,
        host: str,
        port: int = 42000,
        callsign: str = "N0CALL",
        room_id: str = "25000",
        on_state_change: Optional[Callable[[str, str], None]] = None,
        on_rx_audio: Optional[Callable[[bytes, float, str, str], None]] = None,
        on_carrier_change: Optional[Callable[[bool, str], None]] = None,
        description: str = "",
        qth_locator: str = "KO85VU",
        vocoder: Optional[Any] = None,
        tx_encoder: Optional[Any] = None,
        **kwargs
    ):
        self.host = host.strip()
        self.port = int(port)
        self.callsign = (callsign or "N0CALL").strip().upper()
        self.room_id = str(room_id).strip()
        self.room_name = str(kwargs.get("room_name") or kwargs.get("name") or "").strip()
        self.on_state_change = on_state_change
        self.on_rx_audio = on_rx_audio
        self.on_carrier_change = on_carrier_change
        self.on_status_change: Optional[Callable[[int], None]] = kwargs.get("on_status_change")
        self.on_proc_step: Optional[Callable[[str, str, str, str], None]] = kwargs.get("on_proc_step")
        self.description: str = str(description or kwargs.get("talker_alias") or "").strip()
        self.qth_locator: str = str(qth_locator or kwargs.get("locator") or "KO85VU").strip().upper()
        self.vocoder = vocoder
        self.tx_encoder = tx_encoder

        self.state: str = "OFFLINE"
        self._transport: Optional[asyncio.DatagramTransport] = None
        self._remote_addr: Optional[tuple] = None
        self._keepalive_task: Optional[asyncio.Task] = None
        self._watchdog_task: Optional[asyncio.Task] = None
        self._handshake_event: asyncio.Event = asyncio.Event()
        self._handshake_rx_ok: bool = False
        self._connect_error: str = ""
        self._connect_gen: int = 0
        self._manual_disconnect: bool = False
        self.last_rx_ts: float = 0.0
        self._last_tx_stop_ts: float = 0.0
        self.is_rx: bool = False
        self.is_tx: bool = False
        self.current_caller: str = ""
        self.current_dest: str = ""
        self.current_rx_dg_id: int = 0
        self.is_multiroom: bool = bool(kwargs.get("is_multiroom", False))
        self.room_type_override: str = str(kwargs.get("room_type_override") or "").strip().lower()
        self.reflector_type: str = str(kwargs.get("reflector_type") or ("multi_standard" if self.is_multiroom else "single")).strip().lower()
        self.multiroom_kind: str = str(kwargs.get("multiroom_kind") or "").strip().upper()
        self.dg_id: str = str(kwargs.get("dg_id") or ("01;02;03;05;09;10;13;20;24;65;79;90;" if self.is_multiroom else "00")).strip()[:36]
        raw_tx_dg = kwargs.get("tx_dg_id", None)
        self.tx_dg_id: Optional[int] = None
        if raw_tx_dg is not None and str(raw_tx_dg).strip() != "":
            try:
                _v = int(raw_tx_dg)
                if 1 <= _v <= 99:
                    self.tx_dg_id = _v
            except (ValueError, TypeError):
                self.tx_dg_id = None
        self.user_id: Optional[int] = kwargs.get("user_id")
        self.tx_seq: int = 0
        self._tx_frame_idx: int = 0
        self.online_count: int = 0
        self.last_heard: list = []

    def _emit_proc_step(self, code: str, text: str, tone: str = "neutral", state: str = "active"):
        if self.on_proc_step:
            try:
                self.on_proc_step(code, text, tone, state)
            except Exception as e:
                logger.debug(f"[YSF] on_proc_step callback error: {e}")

    def retarget(
        self,
        host: str,
        port: int,
        room_id: str,
        room_name: str = "",
        dg_id: Optional[str] = None,
        tx_dg_id: Any = "__KEEP__",
        is_multiroom: Optional[bool] = None,
        reflector_type: Optional[str] = None,
        multiroom_kind: Optional[str] = None,
        room_type_override: Optional[str] = None,
    ):
        self._connect_gen += 1
        self._manual_disconnect = False
        self.host = str(host or "").strip()
        self.port = int(port or 42000)
        self.room_id = str(room_id or "").strip()
        self.room_name = str(room_name or "").strip()
        if is_multiroom is not None:
            self.is_multiroom = bool(is_multiroom)
        if reflector_type is not None:
            self.reflector_type = str(reflector_type or "single").strip().lower()
        elif is_multiroom is not None:
            self.reflector_type = "multi_standard" if self.is_multiroom else "single"
        if multiroom_kind is not None:
            self.multiroom_kind = str(multiroom_kind or "").strip().upper()
        if room_type_override is not None:
            self.room_type_override = str(room_type_override or "").strip().lower()
        if dg_id is not None:
            self.dg_id = str(dg_id or "00").strip()[:36]
        if tx_dg_id != "__KEEP__":
            if tx_dg_id is not None and str(tx_dg_id).strip() != "":
                try:
                    _tv = int(tx_dg_id)
                    self.tx_dg_id = _tv if 1 <= _tv <= 99 else None
                except (ValueError, TypeError):
                    self.tx_dg_id = None
            else:
                self.tx_dg_id = None
        self._remote_addr = None
        self.online_count = 0
        self.last_heard = []
        self.is_rx = False
        self.is_tx = False
        self.current_caller = ""
        self.current_dest = ""
        self.current_rx_dg_id = 0
        self._handshake_rx_ok = False
        self._connect_error = ""
        self._handshake_event.clear()
        logger.info(f"[YSF:{self.callsign}] Retargeted to {self.host}:{self.port} (room #{self.room_id} {self.room_name}, dg_id={self.dg_id}, tx_dg={self.tx_dg_id})")

    def clear_target(self):
        """Полностью сбрасывает цель рефлектора при ручном отключении (Off / Standby)."""
        self._connect_gen += 1
        self._manual_disconnect = True
        self.host = ""
        self.room_id = ""
        self.room_name = ""
        self._remote_addr = None
        self.online_count = 0
        self.last_heard = []
        self.is_rx = False
        self.is_tx = False
        self.current_caller = ""
        self.current_dest = ""
        self.current_rx_dg_id = 0
        self._handshake_rx_ok = False
        self._connect_error = ""
        self._handshake_event.clear()
        self._set_state("OFFLINE", _tr("ysf.state_waiting_room", user_id=self.user_id, fallback="Disconnected (waiting for room selection)"))

    def set_dg_id_live(
        self,
        dg_id: Optional[str] = None,
        tx_dg_id: Any = "__KEEP__",
        is_multiroom: Optional[bool] = None,
        reflector_type: Optional[str] = None,
        multiroom_kind: Optional[str] = None,
    ) -> bool:
        """Обновляет DG-ID на лету и немедленно шлёт YSFO без разрыва UDP сокета."""
        if is_multiroom is not None:
            self.is_multiroom = bool(is_multiroom)
        if reflector_type is not None:
            self.reflector_type = str(reflector_type or "single").strip().lower()
        if multiroom_kind is not None:
            self.multiroom_kind = str(multiroom_kind or "").strip().upper()
        if dg_id is not None:
            self.dg_id = str(dg_id or "00").strip()[:36]
        if tx_dg_id != "__KEEP__":
            if tx_dg_id is not None and str(tx_dg_id).strip() != "":
                try:
                    _tv = int(tx_dg_id)
                    self.tx_dg_id = _tv if 1 <= _tv <= 99 else None
                except (ValueError, TypeError):
                    self.tx_dg_id = None
            else:
                self.tx_dg_id = None
        if self._transport and self._remote_addr:
            self.send_ysfo()
            logger.info(f"[YSF:{self.callsign}] Live YSFO sent: dg_id={self.dg_id}, tx_dg_id={self.tx_dg_id}")
            return True
        return False

    @property
    def is_connected(self) -> bool:
        return self.state in ("ONLINE", "RX", "TX")

    def _set_state(self, new_state: str, detail: str = ""):
        old_state = self.state
        self.state = new_state
        if old_state != new_state:
            logger.info(f"[YSF:{self.callsign}] State change: {old_state} -> {new_state} ({detail})")
            if self.on_state_change:
                try:
                    self.on_state_change(new_state, detail)
                except Exception as e:
                    logger.debug(f"[YSF] on_state_change callback error: {e}")

    def connection_made(self, transport: asyncio.DatagramTransport):
        self._transport = transport
        logger.info(f"[YSF:{self.callsign}] UDP Socket created, target: {self._remote_addr}")

    def error_received(self, exc: Exception):
        logger.warning(f"[YSF:{self.callsign}] UDP error received from {self._remote_addr}: {exc}")
        if self.state == "CONNECTING" and not self._handshake_rx_ok:
            self._connect_error = _tr("ysf.udp_unavailable", fallback="UDP unavailable ({error})", error=exc)
            self._handshake_event.set()

    def request_status(self):
        """Sends 4-byte YSFS datagram to poll current room peer count."""
        if self._transport and self._remote_addr:
            try:
                self._transport.sendto(b"YSFS", self._remote_addr)
            except Exception as e:
                logger.debug(f"[YSF] request_status send error: {e}")

    def _record_last_heard(self, callsign: str):
        now = time.time()
        callsign = callsign.strip().upper()
        # Обновляем или добавляем в начало списка
        self.last_heard = [item for item in self.last_heard if item.get("callsign") != callsign]
        self.last_heard.insert(0, {
            "callsign": callsign,
            "timestamp": now,
            "time_str": time.strftime("%H:%M:%S", time.localtime(now))
        })
        if len(self.last_heard) > 40:
            self.last_heard = self.last_heard[:40]

    def datagram_received(self, data: bytes, addr: tuple):
        if self._manual_disconnect:
            return
        self.last_rx_ts = time.time()
        if len(data) < 3:
            return

        sig = data[:4]
        upper_head = data[:8].upper()

        # 0. Явный отказ рефлектора / ошибка авторизации (YSFN, NAK, ERR, DENY, REJECT)
        if sig == b"YSFN" or upper_head.startswith((b"NAK", b"ERR", b"DENY", b"REJECT")):
            if self.state == "CONNECTING" and not self._handshake_rx_ok:
                self._connect_error = _tr("ysf.err_rejected", user_id=self.user_id, fallback="Reflector rejected connection / authorization")
                self._handshake_event.set()
            return

        # 1. YSFP: Poll echo / keepalive pong from reflector
        if sig == b"YSFP":
            self._handshake_rx_ok = True
            self._handshake_event.set()
            if self.state == "CONNECTING":
                self._set_state("ONLINE", _tr("ysf.state_connected", user_id=self.user_id, fallback="Connected to YSF reflector"))
                self.request_status()
            return

        # 1b. YSFS: Status response (42 bytes: YSFS + 5b ID + 16b Name + 14b Desc + 3b Count)
        if sig == b"YSFS" and len(data) >= 42:
            self._handshake_rx_ok = True
            self._handshake_event.set()
            if self.state == "CONNECTING":
                self._set_state("ONLINE", _tr("ysf.state_connected", user_id=self.user_id, fallback="Connected to YSF reflector"))
            try:
                count_str = data[39:42].decode("ascii", errors="ignore").strip()
                if count_str.isdigit():
                    self.online_count = int(count_str)
                    if hasattr(self, "on_status_change") and self.on_status_change:
                        try:
                            self.on_status_change(self.online_count)
                        except Exception:
                            pass
            except Exception:
                pass
            return

        # 2. YSFI: Station information packet
        if sig == b"YSFI":
            return

        # 3. YSFD: Voice and Data packet (155 bytes)
        if sig == b"YSFD" and len(data) >= 155:
            self._handshake_rx_ok = True
            self._handshake_event.set()
            if self.state == "CONNECTING":
                self._set_state("ONLINE", _tr("ysf.state_connected", user_id=self.user_id, fallback="Connected to YSF reflector"))
                self.request_status()
            self._handle_ysfd_packet(data)

    def _handle_ysfd_packet(self, data: bytes):
        now = time.time()
        try:
            source_call = data[14:24].decode("ascii", errors="ignore").strip()
            dest_call = data[24:34].decode("ascii", errors="ignore").strip()
        except Exception:
            source_call = "UNKNOWN"
            dest_call = ""

        # Suppress own TX echo packets reflected back by YSFReflector
        clean_src_u = source_call.split("-")[0].strip().upper()
        clean_own_u = self.callsign.split("-")[0].strip().upper()
        if self.is_tx or (clean_src_u and clean_own_u and clean_src_u == clean_own_u and (now - self._last_tx_stop_ts) < 0.8):
            return

        # Control byte 34: Bit 0 is End Of Transmission (EOT)
        control_byte = data[34] if len(data) > 34 else 0
        is_eot = bool(control_byte & 0x01)

        if not source_call or source_call == "UNKNOWN":
            source_call = getattr(self, "current_caller", "") or "UNKNOWN"

        # Decode FICH to distinguish Header / Communications (VD1/VD2/VW/DataFR) / Terminator
        try:
            from src.dmr.ysf_frame import (
                YSF_DT_DATA_FR_MODE,
                YSF_DT_VD_MODE1,
                YSF_DT_VD_MODE2,
                YSF_DT_VOICE_FR_MODE,
                YSF_FI_HEADER,
                YSF_FI_TERMINATOR,
                decode_ysf_fich,
                extract_ysf_vd1_ambe,
                extract_ysf_vd2_ambe,
                extract_ysf_vw_frames,
            )
            fich = decode_ysf_fich(data)
        except Exception as e:
            logger.debug(f"[YSF] FICH parse error: {e}")
            fich = None
            YSF_FI_HEADER, YSF_FI_TERMINATOR = 0, 2
            YSF_DT_VD_MODE1, YSF_DT_DATA_FR_MODE, YSF_DT_VD_MODE2, YSF_DT_VOICE_FR_MODE = 0, 1, 2, 3
            extract_ysf_vd1_ambe = None
            extract_ysf_vd2_ambe = None
            extract_ysf_vw_frames = None

        fi = fich["fi"] if fich else 1
        dt = fich["dt"] if fich else YSF_DT_VD_MODE2
        rx_dg = int(fich.get("dg_id", 0) or 0) if fich else 0

        # Ignore pure Data FR frames without opening audio carrier
        if fich and dt == YSF_DT_DATA_FR_MODE and fi != YSF_FI_HEADER and not is_eot and fi != YSF_FI_TERMINATOR:
            return

        if not (is_eot or fi == YSF_FI_TERMINATOR):
            prev_dg = self.current_rx_dg_id
            if rx_dg > 0 or not self.is_rx:
                self.current_rx_dg_id = rx_dg
            promoted_live_mutant = False
            if 1 <= rx_dg <= 99 and getattr(self, "room_type_override", "") != "single":
                if getattr(self, "reflector_type", "single") == "single" or not self.is_multiroom:
                    self.is_multiroom = True
                    self.reflector_type = "multi_mutant"
                    if not getattr(self, "multiroom_kind", ""):
                        self.multiroom_kind = "LIVE_DGID"
                    promoted_live_mutant = True
                    if self.room_id:
                        try:
                            from src.dmr.ysf_directory import ysf_dir_mgr
                        except ImportError:
                            from dmr.ysf_directory import ysf_dir_mgr
                        try:
                            ysf_dir_mgr.mark_runtime_mutant(self.room_id, self.multiroom_kind)
                        except Exception:
                            pass
            if not self.is_rx:
                self.is_rx = True
                self.current_caller = source_call
                self.current_dest = dest_call
                if self.vocoder and hasattr(self.vocoder, "reset_slot"):
                    try:
                        self.vocoder.reset_slot(1)
                    except Exception:
                        pass
                self._set_state("RX", _tr("ysf.rx_from", fallback="Receiving from {callsign}", callsign=source_call))
                if source_call and source_call != "UNKNOWN":
                    self._record_last_heard(source_call)
                if self.on_carrier_change:
                    try:
                        self.on_carrier_change(True, source_call)
                    except Exception as e:
                        logger.debug(f"[YSF] on_carrier_change error: {e}")
            elif (promoted_live_mutant or (rx_dg > 0 and rx_dg != prev_dg)) and self.on_status_change:
                try:
                    self.on_status_change(self.online_count)
                except Exception:
                    pass

        # Header frame carries CSD callsign metadata, not voice payload
        if fi != YSF_FI_HEADER:
            pcm_block = b""
            rms = 0.0
            if dt == YSF_DT_VD_MODE2 and not (is_eot or fi == YSF_FI_TERMINATOR) and extract_ysf_vd2_ambe:
                vectors = extract_ysf_vd2_ambe(data)
                if self.vocoder and hasattr(self.vocoder, "decode_ysf_vd2") and vectors:
                    pcm_block, rms = self.vocoder.decode_ysf_vd2(vectors, slot=1)
            elif dt == YSF_DT_VD_MODE1 and not (is_eot or fi == YSF_FI_TERMINATOR) and extract_ysf_vd1_ambe:
                vd1_frames = extract_ysf_vd1_ambe(data)
                if self.vocoder and hasattr(self.vocoder, "decode_ysf_vd1") and vd1_frames:
                    pcm_block, rms = self.vocoder.decode_ysf_vd1(vd1_frames, slot=1)
            elif dt == YSF_DT_VOICE_FR_MODE and extract_ysf_vw_frames:
                vw_frames = extract_ysf_vw_frames(data, fi=fi)
                if self.vocoder and hasattr(self.vocoder, "decode_ysf_vw") and vw_frames:
                    pcm_block, rms = self.vocoder.decode_ysf_vw(vw_frames, slot=1)

            if pcm_block and self.on_rx_audio:
                try:
                    self.on_rx_audio(pcm_block, rms, source_call, dest_call)
                except Exception as e:
                    logger.debug(f"[YSF] on_rx_audio error: {e}")

        if is_eot or fi == YSF_FI_TERMINATOR:
            if self.is_rx:
                caller = self.current_caller or source_call or "UNKNOWN"
                self.is_rx = False
                self.current_caller = ""
                self.current_rx_dg_id = 0
                self._set_state("ONLINE", _tr("ysf.state_ready", user_id=self.user_id, fallback="Ready"))
                if self.on_carrier_change:
                    try:
                        self.on_carrier_change(False, caller)
                    except Exception:
                        pass
            return

    def send_ysfp(self):
        """Sends 14-byte YSFP Poll packet."""
        if not self._transport or not self._remote_addr:
            return
        call_padded = f"{self.callsign:<10.10}".encode("ascii")
        pkt = b"YSFP" + call_padded
        try:
            self._transport.sendto(pkt, self._remote_addr)
        except Exception as e:
            logger.debug(f"[YSF] Send YSFP error: {e}")

    def send_ysfi(self):
        """Sends 80-byte YSFI Station Information packet."""
        if not self._transport or not self._remote_addr:
            return
        call_padded = f"{self.callsign:<10.10}".encode("ascii", errors="replace")
        rx_freq = b"438800000"
        tx_freq = b"438800000"
        loc_str = (self.qth_locator or "KO85VU")[:6]
        locator = f"{loc_str:<6.6}".encode("ascii", errors="replace")
        desc_str = (self.description or self.callsign or "ProxDMR Gateway")[:20]
        desc = f"{desc_str:<20.20}".encode("ascii", errors="replace")
        soft_type = f"{'ProxDMR':<12.12}".encode("ascii")
        ver = f"{'v2.9':<7.7}".encode("ascii")
        pad = b"   "
        pkt = b"YSFI" + call_padded + rx_freq + tx_freq + locator + desc + soft_type + ver + pad
        try:
            self._transport.sendto(pkt, self._remote_addr)
        except Exception as e:
            logger.debug(f"[YSF] Send YSFI error: {e}")

    def send_ysfu(self):
        """Sends 14-byte YSFU Unlink packet."""
        if not self._transport or not self._remote_addr:
            return
        call_padded = f"{self.callsign:<10.10}".encode("ascii")
        pkt = b"YSFU" + call_padded
        try:
            self._transport.sendto(pkt, self._remote_addr)
        except Exception as e:
            logger.debug(f"[YSF] Send YSFU error: {e}")

    def send_ysfo(self):
        """Sends 50-byte YSFO Options packet (DG-ID 00 = ALL, never numeric room_id)."""
        if not self._transport or not self._remote_addr:
            return
        call_padded = f"{self.callsign:<10.10}".encode("ascii", errors="replace")
        dg_opt = str(getattr(self, "dg_id", "00") or "00").strip()[:36]
        options = f"{dg_opt:<36.36}".encode("ascii", errors="replace")
        pkt = b"YSFO" + call_padded + options
        try:
            self._transport.sendto(pkt, self._remote_addr)
        except Exception as e:
            logger.debug(f"[YSF] Send YSFO error: {e}")

    async def connect(self) -> bool:
        clean_host = str(self.host or "").strip()
        clean_room = str(self.room_id or "").strip()
        if not clean_host or clean_host.isdigit() or clean_host == "ysf.brandmeister.ru":
            if clean_room:
                self._set_state("OFFLINE", _tr("ysf.reflector_addr_missing", user_id=self.user_id, fallback="Reflector address is not specified"))
                self._emit_proc_step("failed", _tr("ysf.step_reflector_addr_missing", user_id=self.user_id, fallback="✕ Reflector #{room} address is not specified", room=clean_room), "negative", "failed")
            else:
                self._set_state("OFFLINE", _tr("ysf.state_waiting_room", user_id=self.user_id, fallback="Disconnected (waiting for room selection)"))
            return False

        self._manual_disconnect = False
        self._connect_gen += 1
        my_gen = self._connect_gen

        self._set_state("CONNECTING", _tr("ysf.state_resolving", user_id=self.user_id, fallback="Resolving reflector address..."))
        self._handshake_rx_ok = False
        self._connect_error = ""
        self._handshake_event.clear()
        try:
            loop = asyncio.get_running_loop()
            addr_info = await loop.getaddrinfo(clean_host, self.port, family=socket.AF_INET, type=socket.SOCK_DGRAM)
            if self._manual_disconnect or my_gen != self._connect_gen:
                return False
            if not addr_info:
                self._set_state("OFFLINE", _tr("ysf.state_dns_error", user_id=self.user_id, fallback="DNS resolution error"))
                self._emit_proc_step("failed", _tr("ysf.step_dns_error", user_id=self.user_id, fallback="✕ DNS error: address not found ({host})", host=clean_host), "negative", "failed")
                return False
            self._remote_addr = addr_info[0][4]
            ip_str, port_int = self._remote_addr[0], self._remote_addr[1]
            self._emit_proc_step("dns", f"DNS OK: {ip_str}:{port_int}", "neutral", "active")

            transport, _ = await loop.create_datagram_endpoint(
                lambda: self,
                remote_addr=self._remote_addr
            )
            if self._manual_disconnect or my_gen != self._connect_gen:
                transport.close()
                return False
            self._transport = transport
            self._emit_proc_step("socket", _tr("ysf.step_socket_open", user_id=self.user_id, fallback="UDP socket opened -> {ip}:{port}", ip=ip_str, port=port_int), "neutral", "active")

            # Initial handshake: send YSFP, YSFI and YSFO options
            self.send_ysfp()
            self._emit_proc_step("ysfp", _tr("ysf.step_ysfp_sent", user_id=self.user_id, fallback="Poll sent (YSFP)"), "neutral", "active")
            await asyncio.sleep(0.05)
            if self._manual_disconnect or my_gen != self._connect_gen:
                return False
            self.send_ysfi()
            self._emit_proc_step("ysfi", _tr("ysf.step_ysfi_sent", user_id=self.user_id, fallback="Station registration ({callsign}, KO85VU, ProxDMR v2.9)", callsign=self.callsign), "neutral", "active")
            await asyncio.sleep(0.05)
            if self._manual_disconnect or my_gen != self._connect_gen:
                return False
            self.send_ysfo()
            dg_desc = "00 / ALL" if (not self.dg_id or self.dg_id == "00") else self.dg_id.rstrip(";")
            self._emit_proc_step("ysfo", _tr("ysf.step_ysfo_sent", user_id=self.user_id, fallback="Channel options: DG-ID {dg_desc} (YSFO)", dg_desc=dg_desc), "neutral", "active")

            # Wait for YSFP response up to 3.0s, resending YSFP each 1.0s
            handshake_ok = False
            for attempt in range(3):
                if my_gen != self._connect_gen or self._manual_disconnect:
                    return False
                if self._handshake_rx_ok:
                    handshake_ok = True
                    break
                if self._connect_error:
                    break
                try:
                    await asyncio.wait_for(self._handshake_event.wait(), timeout=1.0)
                    if my_gen != self._connect_gen or self._manual_disconnect:
                        return False
                    if self._handshake_rx_ok:
                        handshake_ok = True
                        break
                    if self._connect_error:
                        break
                    self._handshake_event.clear()
                except asyncio.TimeoutError:
                    if attempt < 2 and my_gen == self._connect_gen and not self._manual_disconnect:
                        self.send_ysfp()

            if my_gen != self._connect_gen or self._manual_disconnect:
                return False

            if not handshake_ok:
                err_detail = self._connect_error or _tr("ysf.err_no_response", user_id=self.user_id, fallback="Reflector is not responding ({host}:{port})", host=clean_host, port=self.port)
                logger.warning(f"[YSF:{self.callsign}] Handshake failed for {clean_host}:{self.port} ({ip_str}:{port_int}): {err_detail}")
                self._set_state("OFFLINE", err_detail)
                self._emit_proc_step("failed", _tr("ysf.step_failed_detail", user_id=self.user_id, fallback="✕ Reflector #{room}: {detail}", room=self.room_id, detail=err_detail), "negative", "failed")
                if self._transport:
                    self._transport.close()
                    self._transport = None
                return False

            # Start keepalive & watchdog tasks
            if self._keepalive_task:
                self._keepalive_task.cancel()
            if self._watchdog_task:
                self._watchdog_task.cancel()
            self._keepalive_task = asyncio.create_task(self._keepalive_loop())
            self._watchdog_task = asyncio.create_task(self._watchdog_loop(my_gen))

            self._emit_proc_step("ysfs", _tr("ysf.step_ysfs_sent", user_id=self.user_id, fallback="Requesting online users status (YSFS)"), "neutral", "active")
            self.request_status()
            for _ in range(15):
                if self.online_count > 0 or my_gen != self._connect_gen or self._manual_disconnect:
                    break
                await asyncio.sleep(0.1)

            if my_gen != self._connect_gen or self._manual_disconnect:
                return False

            room_label = f"#{self.room_id} {self.room_name}".strip()
            count_info = _tr("ysf.step_online_count", user_id=self.user_id, fallback=" ({count} online)", count=self.online_count) if self.online_count > 0 else ""
            self._emit_proc_step("done", _tr("ysf.step_connected", user_id=self.user_id, fallback="✓ Connected: {room}{count_info}", room=room_label, count_info=count_info), "positive", "done")
            return True
        except Exception as e:
            logger.error(f"[YSF:{self.callsign}] Connection error: {e}")
            self._set_state("OFFLINE", _tr("ysf.err_connect", user_id=self.user_id, fallback="Connection error: {error}", error=e))
            self._emit_proc_step("failed", _tr("ysf.step_connect_error", user_id=self.user_id, fallback="✕ Connection error: {error}", error=e), "negative", "failed")
            return False

    async def disconnect(self, is_retry: bool = False):
        self._manual_disconnect = not is_retry
        self._connect_gen += 1
        was_rx = self.is_rx
        caller = self.current_caller or "UNKNOWN"
        self.is_tx = False
        self.is_rx = False
        self.current_caller = ""
        self.current_dest = ""
        self.current_rx_dg_id = 0
        self.online_count = 0

        if was_rx and self.on_carrier_change:
            try:
                self.on_carrier_change(False, caller)
            except Exception:
                pass

        self._set_state(
            "OFFLINE",
            _tr("ysf.state_reconnecting", user_id=self.user_id, fallback="Reconnecting...")
            if is_retry
            else _tr("ysf.state_disconnecting", user_id=self.user_id, fallback="Disconnecting..."),
        )
        self._handshake_event.clear()
        if self._keepalive_task:
            self._keepalive_task.cancel()
            self._keepalive_task = None
        if self._watchdog_task:
            self._watchdog_task.cancel()
            self._watchdog_task = None

        self.send_ysfu()
        if self._transport:
            self._transport.close()
            self._transport = None

    async def _keepalive_loop(self):
        tick = 0
        while self.is_connected or self.state == "CONNECTING":
            await asyncio.sleep(5.0)
            if self.is_connected or self.state == "CONNECTING":
                self.send_ysfp()
                tick += 1
                if tick % 4 == 0 and str(getattr(self, "dg_id", "00") or "00") != "00":
                    self.send_ysfo()

    async def _watchdog_loop(self, expected_gen: int):
        while (self.is_connected or self.state == "CONNECTING") and expected_gen == self._connect_gen:
            await asyncio.sleep(0.25)
            if expected_gen != self._connect_gen or self._manual_disconnect:
                break
            now = time.time()
            if self.is_rx and (now - self.last_rx_ts > 0.8):
                # Carrier loss timeout: smooth unkey after 800ms silence (jitter-safe)
                caller = self.current_caller or "UNKNOWN"
                self.is_rx = False
                self.current_caller = ""
                self.current_rx_dg_id = 0
                self._set_state("ONLINE", _tr("ysf.state_ready", user_id=self.user_id, fallback="Ready"))
                if self.on_carrier_change:
                    try:
                        self.on_carrier_change(False, caller)
                    except Exception:
                        pass
            # Silence/lost link timeout: if ONLINE and no packets received for >30s
            if self.state in ("ONLINE", "RX") and self.last_rx_ts > 0 and (now - self.last_rx_ts > 30.0):
                logger.warning(f"[YSF:{self.callsign}] No packets for >30s from {self.host}:{self.port}. Link lost.")
                self._set_state("OFFLINE", _tr("ysf.state_link_lost", user_id=self.user_id, fallback="Reflector connection lost"))
                self._emit_proc_step("failed", _tr("ysf.step_link_lost", user_id=self.user_id, fallback="✕ Reflector connection lost (>30s)"), "negative", "failed")
                asyncio.create_task(self._reconnect_on_loss(expected_gen))
                break

    async def _reconnect_on_loss(self, expected_gen: int):
        if expected_gen != self._connect_gen or self._manual_disconnect or not str(self.host or "").strip():
            return
        await self.disconnect(is_retry=True)
        await asyncio.sleep(2.0)
        if not self._manual_disconnect and str(self.host or "").strip():
            await self.connect()

    def start_ptt(self):
        """Initiates PTT transmission in YSF simplex room and sends YSF Header frame."""
        if not self.is_connected:
            return
        if self.is_rx:
            caller = self.current_caller or "UNKNOWN"
            self.is_rx = False
            self.current_caller = ""
            if self.on_carrier_change:
                try:
                    self.on_carrier_change(False, caller)
                except Exception:
                    pass
        self.is_tx = True
        self.tx_seq = 0
        self._tx_frame_idx = 0
        if self.tx_encoder and hasattr(self.tx_encoder, "reset"):
            try:
                self.tx_encoder.reset()
            except Exception:
                pass
        self._set_state("TX", _tr("ysf.state_tx", user_id=self.user_id, fallback="Transmitting to YSF reflector"))
        self._send_tx_frame(pcm_chunk=b"", is_header=True)

    def stop_ptt(self):
        """Finishes PTT transmission with End-of-Transmission YSF Terminator frame."""
        if not self.is_tx:
            return
        self.is_tx = False
        self._last_tx_stop_ts = time.time()
        self._send_tx_frame(pcm_chunk=b"", is_end=True)
        self._set_state("ONLINE", _tr("ysf.state_ready", user_id=self.user_id, fallback="Ready"))

    def send_tx_audio_chunk(self, pcm_chunk: bytes):
        """Encodes 100ms PCM16 (1600 bytes) into VD2 AMBE+2 and transmits YSFD frame."""
        if not self.is_tx or not self._transport or not self._remote_addr:
            return
        self._send_tx_frame(pcm_chunk=pcm_chunk, is_end=False)

    def _send_tx_frame(self, pcm_chunk: bytes, is_end: bool = False, is_header: bool = False):
        if not self._transport or not self._remote_addr:
            return
        try:
            from src.dmr.ysf_frame import (
                YSF_FI_COMMUNICATIONS,
                YSF_FI_HEADER,
                YSF_FI_TERMINATOR,
                build_ysf_vd2_packet,
            )
            if is_header:
                fi = YSF_FI_HEADER
                fn = 0
                ambe_vecs = None
            elif is_end:
                fi = YSF_FI_TERMINATOR
                fn = 0
                ambe_vecs = None
            else:
                fi = YSF_FI_COMMUNICATIONS
                fn = self._tx_frame_idx % 2
                if self.tx_encoder and hasattr(self.tx_encoder, "encode_ysf_100ms_frame"):
                    ambe_vecs = self.tx_encoder.encode_ysf_100ms_frame(pcm_chunk)
                else:
                    ambe_vecs = None

            tx_dg_val = int(self.tx_dg_id) if (self.tx_dg_id is not None and 0 <= int(self.tx_dg_id) <= 99) else 0
            pkt = build_ysf_vd2_packet(
                rptr_call=self.callsign,
                src_call=self.callsign,
                dst_call="ALL",
                frame_seq=self.tx_seq,
                ambe_5x49=ambe_vecs,
                fi=fi,
                fn=fn,
                ft=1,
                is_end=is_end,
                dg_id=tx_dg_val,
            )
            self.tx_seq = (self.tx_seq + 1) & 0x7F
            if not is_header and not is_end:
                self._tx_frame_idx += 1
            self._transport.sendto(pkt, self._remote_addr)
        except Exception as e:
            logger.debug(f"[YSF] send_tx_frame error: {e}")


class YSFClientAdapter:
    """
    Adapter bridging YSFClient with ProxDMR HotspotManager runtime.
    Duck-types HomeBrewClient so all audio routing, PTT, recording,
    and UI mechanisms work natively with Yaesu System Fusion.
    """

    def __init__(self, client: YSFClient, hotspot_id: str, user_id: int, manager: Any):
        self.client = client
        self.hotspot_id = hotspot_id
        self.user_id = user_id
        self.manager = manager
        self.color_code: int = 1
        self.failed_cycles: int = 0
        self.network_type: str = "ysf"
        self._is_manual_disconnect: bool = False

        self.client.on_state_change = self._on_ysf_state_change
        self.client.on_rx_audio = self._on_ysf_rx_audio
        self.client.on_carrier_change = self._on_ysf_carrier_change
        self.client.on_status_change = self._on_ysf_status_change

    def retarget(
        self,
        host: str,
        port: int,
        room_id: str,
        room_name: str = "",
        dg_id: Optional[str] = None,
        tx_dg_id: Any = "__KEEP__",
        is_multiroom: Optional[bool] = None,
        reflector_type: Optional[str] = None,
        multiroom_kind: Optional[str] = None,
        room_type_override: Optional[str] = None,
    ):
        self._is_manual_disconnect = False
        self.client.retarget(
            host,
            port,
            room_id,
            room_name,
            dg_id=dg_id,
            tx_dg_id=tx_dg_id,
            is_multiroom=is_multiroom,
            reflector_type=reflector_type,
            multiroom_kind=multiroom_kind,
            room_type_override=room_type_override,
        )

    def clear_target(self):
        self._is_manual_disconnect = True
        self.client.clear_target()

    @property
    def is_connected(self) -> bool:
        return self.client.is_connected

    @property
    def network_label(self) -> str:
        return "YSF"

    async def connect(self, force: bool = False) -> bool:
        if force:
            self._is_manual_disconnect = False
        elif self._is_manual_disconnect:
            return False
        if not str(getattr(self.client, "host", "") or "").strip():
            return False
        return await self.client.connect()

    async def disconnect(self, is_retry: bool = False, *args, **kwargs):
        self._is_manual_disconnect = not is_retry
        await self.client.disconnect(is_retry=is_retry)

    def start_ptt(self, slot: int = 1):
        self.client.start_ptt()

    def stop_ptt(self, slot: int = 1):
        self.client.stop_ptt()

    def send_tx_audio_chunk(self, chunk: bytes, slot: int = 1):
        self.client.send_tx_audio_chunk(chunk)

    def _on_ysf_state_change(self, state: str, detail: str):
        from src.dmr.homebrew import BMState
        mapped_state = BMState.ONLINE if state in ("ONLINE", "RX", "TX") else (BMState.CONNECTING if state == "CONNECTING" else BMState.DISCONNECTED)
        self.manager._on_client_status(self.hotspot_id, mapped_state, detail, user_id=self.user_id)

    def _on_ysf_carrier_change(self, is_carrier: bool, caller: str):
        now = time.time()
        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        room_id_str = str(getattr(self.client, "room_id", "") or "").strip()
        room_id_int = int(room_id_str) if room_id_str.isdigit() else 25000
        room_name = getattr(self.client, "room_name", "") or (f"YSF #{room_id_str}" if room_id_str else "YSF Room")
        clean_caller = (caller or "UNKNOWN").strip().upper()
        active_calls = self.manager._get_user_active_calls(self.user_id)
        call_history = self.manager._get_user_call_history(self.user_id)
        call_key = f"{self.hotspot_id}_1"

        if is_carrier:
            self._call_start_ts = now
            call_id = f"ysf_{int(now * 1000)}_{self.hotspot_id}"
            self._current_call_id = call_id
            self._active_caller = clean_caller

            if rt and hasattr(rt, "ts1"):
                rt.ts1.active = True
                rt.ts1.src_id = 0
                rt.ts1.src_callsign = clean_caller
                rt.ts1.src_name = ""
                rt.ts1.talker_alias = room_name
                rt.ts1.dst_id = room_id_int
                rt.ts1.last_seen = now

            from src.dmr.manager import CallLogEntry
            new_call = CallLogEntry(
                id=call_id,
                timestamp=now,
                hotspot_id=self.hotspot_id,
                slot=1,
                src_id=0,
                src_callsign=clean_caller,
                src_name="",
                talker_alias=room_name,
                dst_id=room_id_int,
                dst_name=room_name,
                call_type="GROUP",
                active=True,
                is_tx=False,
                network_type="ysf",
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
                "src_callsign": clean_caller,
                "caller_display": clean_caller,
                "dst_id": room_id_int,
                "dst_name": room_name,
                "call_type": "GROUP",
                "call_id": call_id,
                "network_type": "ysf",
                "source_type": "VoIP",
                "call_entry": new_call.to_dict(),
                "user_id": self.user_id,
            }, user_id=self.user_id)
        else:
            if rt and hasattr(rt, "ts1"):
                rt.ts1.active = False

            prev_call = active_calls.pop(call_key, None)
            call_id = prev_call.id if prev_call else getattr(self, "_current_call_id", f"ysf_{int(now * 1000)}_{self.hotspot_id}")
            duration = max(0.5, round(now - (prev_call.timestamp if prev_call else getattr(self, "_call_start_ts", now)), 1))
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
                "src_callsign": clean_caller,
                "dst_id": room_id_int,
                "dst_name": room_name,
                "call_id": call_id,
                "duration": duration,
                "network_type": "ysf",
                "user_id": self.user_id,
            }, user_id=self.user_id)

        # Broadcast ysf_carrier for matrix room keyed state and online counters
        self.manager._notify_async({
            "type": "ysf_carrier",
            "hotspot_id": self.hotspot_id,
            "carrier": is_carrier,
            "is_rx": is_carrier,
            "caller": clean_caller,
            "room": room_id_str,
            "dg_id": int(getattr(self.client, "current_rx_dg_id", 0) or 0),
            "is_multiroom": bool(getattr(self.client, "is_multiroom", False)),
            "reflector_type": str(getattr(self.client, "reflector_type", "single") or "single"),
            "multiroom_kind": str(getattr(self.client, "multiroom_kind", "") or ""),
            "online_count": getattr(self.client, "online_count", 0),
            "slot": 1,
            "network": "ysf",
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_ysf_status_change(self, online_count: int):
        self.manager._notify_async({
            "type": "ysf_carrier",
            "hotspot_id": self.hotspot_id,
            "carrier": self.client.is_rx,
            "is_rx": self.client.is_rx,
            "caller": self.client.current_caller,
            "room": getattr(self.client, "room_id", ""),
            "dg_id": int(getattr(self.client, "current_rx_dg_id", 0) or 0),
            "is_multiroom": bool(getattr(self.client, "is_multiroom", False)),
            "reflector_type": str(getattr(self.client, "reflector_type", "single") or "single"),
            "multiroom_kind": str(getattr(self.client, "multiroom_kind", "") or ""),
            "online_count": online_count,
            "slot": 1,
            "network": "ysf",
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_ysf_rx_audio(self, pcm16: bytes, rms: float, caller: str, room: str):
        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        if not rt:
            return

        # 1. Update slot last seen timestamp
        if hasattr(rt, "ts1"):
            rt.ts1.last_seen = time.time()

        # 2. Forward binary PCM16 stream to Web Audio unless hotspot/slot 1 is muted
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

        room_id_str = str(getattr(self.client, "room_id", "") or "").strip()
        room_id_int = int(room_id_str) if room_id_str.isdigit() else 25000
        room_name = getattr(self.client, "room_name", "") or f"YSF #{room_id_str}"
        clean_caller = (caller or getattr(self, "_active_caller", "") or "UNKNOWN").strip().upper()
        call_id = getattr(self, "_current_call_id", "") or ""

        # 3. Route to recorder if active
        if hasattr(self.manager, "recorder") and self.manager.recorder and call_id:
            try:
                auto_rec = getattr(rt.config, "auto_record", False)
                self.manager.recorder.feed_rx(
                    hotspot_id=self.hotspot_id,
                    slot=1,
                    src_id=0,
                    src_callsign=clean_caller,
                    src_name="",
                    talker_alias=room_name,
                    dst_id=room_id_int,
                    pcm_bytes=pcm16,
                    call_id=call_id,
                    user_id=self.user_id,
                    auto_record=auto_rec,
                )
            except Exception as e:
                logger.debug(f"[YSF] Recorder feed error: {e}")

        # 4. Route to speech transcriber if enabled for slot 1 (uses valid feed_audio method)
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
                logger.debug(f"[YSF] Transcriber feed error: {e}")
