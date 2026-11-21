# -*- coding: utf-8 -*-
"""
svx_client.py - Full TCP + UDP Protocol Client and Adapter for SVXReflector (SvxLink).
Implements protocol negotiation (V2/V1), HMAC-SHA1 challenge-response auth,
TalkGroup selection and monitoring, and bidirectional Opus audio pipeline.
"""

import asyncio
from collections import deque
import hashlib
import hmac
import json
import logging
import math
import os
import random
import socket
import struct
import time
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

try:
    from dmr.svx_opus import SvxOpusCodec
except ImportError:
    from src.dmr.svx_opus import SvxOpusCodec

logger = logging.getLogger("proxdmr.svx_client")

# TCP Message Types
MSG_HEARTBEAT = 1
MSG_PROTO_VER = 5
MSG_PROTO_VER_DOWNGRADE = 6
MSG_AUTH_CHALLENGE = 10
MSG_AUTH_RESPONSE = 11
MSG_AUTH_OK = 12
MSG_ERROR = 13
MSG_SERVER_INFO = 100
MSG_NODE_LIST = 101
MSG_NODE_JOINED = 102
MSG_NODE_LEFT = 103
MSG_TALKER_START = 104
MSG_TALKER_STOP = 105
MSG_SELECT_TG = 106
MSG_TG_MONITOR = 107
MSG_REQUEST_QSY = 109
MSG_NODE_INFO_V2 = 111

# UDP Message Types
UDP_MSG_HEARTBEAT = 1
UDP_MSG_AUDIO = 101
UDP_MSG_FLUSH_SAMPLES = 102
UDP_MSG_ALL_SAMPLES_FLUSHED = 103


def _pack_string(s: str) -> bytes:
    encoded = (s or "").encode("utf-8")
    return struct.pack(">H", len(encoded)) + encoded


def _unpack_string(data: bytes, offset: int = 0) -> Tuple[str, int]:
    if len(data) < offset + 2:
        return "", offset
    length = struct.unpack_from(">H", data, offset)[0]
    offset += 2
    raw = data[offset:offset + length]
    return raw.decode("utf-8", errors="replace"), offset + length


def _pack_bytes(b: bytes) -> bytes:
    return struct.pack(">H", len(b)) + b


def _unpack_bytes(data: bytes, offset: int = 0) -> Tuple[bytes, int]:
    if len(data) < offset + 2:
        return b"", offset
    length = struct.unpack_from(">H", data, offset)[0]
    offset += 2
    return data[offset:offset + length], offset + length


def _pack_string_list(strings: List[str]) -> bytes:
    body = bytearray(struct.pack(">H", len(strings)))
    for s in strings:
        body.extend(_pack_string(s))
    return bytes(body)


def _unpack_string_list(data: bytes, offset: int = 0) -> Tuple[List[str], int]:
    if len(data) < offset + 2:
        return [], offset
    count = struct.unpack_from(">H", data, offset)[0]
    offset += 2
    items = []
    for _ in range(count):
        s, offset = _unpack_string(data, offset)
        items.append(s)
    return items, offset


def _pack_tg_set(tgs: Set[int]) -> bytes:
    sorted_tgs = sorted(list(tgs))
    body = bytearray(struct.pack(">H", len(sorted_tgs)))
    for tg in sorted_tgs:
        body.extend(struct.pack(">I", tg & 0xFFFFFFFF))
    return bytes(body)


def _read_system_dns_servers() -> List[str]:
    servers: List[str] = []
    try:
        if os.path.isfile("/etc/resolv.conf"):
            with open("/etc/resolv.conf", "r", encoding="utf-8", errors="ignore") as f:
                for line in f:
                    s = line.strip()
                    if s.startswith("nameserver"):
                        parts = s.split()
                        if len(parts) >= 2 and ":" not in parts[1]:
                            servers.append(parts[1])
    except Exception:
        pass
    for fb in ("1.1.1.1", "8.8.8.8"):
        if fb not in servers:
            servers.append(fb)
    return servers[:3]


def _decode_dns_name(buf: bytes, offset: int) -> Tuple[str, int]:
    labels: List[str] = []
    jumped = False
    orig_offset = offset
    seen: Set[int] = set()
    while offset < len(buf):
        if offset in seen:
            break
        seen.add(offset)
        length = buf[offset]
        if length == 0:
            offset += 1
            break
        if (length & 0xC0) == 0xC0:
            if offset + 1 >= len(buf):
                break
            ptr = ((length & 0x3F) << 8) | buf[offset + 1]
            if not jumped:
                orig_offset = offset + 2
                jumped = True
            offset = ptr
        else:
            offset += 1
            labels.append(buf[offset:offset + length].decode("ascii", errors="ignore"))
            offset += length
    return ".".join(labels), (orig_offset if jumped else offset)


def resolve_svx_srv_sync(domain: str, timeout: float = 1.2) -> List[Tuple[str, int]]:
    """Resolve _svxreflector._tcp.<domain> SRV records without external dependencies."""
    clean = (domain or "").strip().rstrip(".")
    if not clean or "." not in clean:
        return []
    try:
        socket.inet_aton(clean)
        return []
    except OSError:
        pass

    qname = clean if clean.lower().startswith("_svxreflector._tcp.") else f"_svxreflector._tcp.{clean}"
    tid = random.randint(1, 65535)
    qbody = bytearray()
    for lbl in qname.split("."):
        b = lbl.encode("ascii", errors="ignore")
        if not b or len(b) > 63:
            return []
        qbody.append(len(b))
        qbody.extend(b)
    qbody.append(0)
    pkt = struct.pack(">HHHHHH", tid, 0x0100, 1, 0, 0, 0) + bytes(qbody) + struct.pack(">HH", 33, 1)

    for ns in _read_system_dns_servers():
        sock = None
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(timeout)
            sock.sendto(pkt, (ns, 53))
            resp, _ = sock.recvfrom(4096)
            if len(resp) < 12:
                continue
            rtid, flags, qdcount, ancount, _, _ = struct.unpack_from(">HHHHHH", resp, 0)
            if rtid != tid:
                continue
            if (flags & 0x0F) == 3 or ancount == 0:
                return []
            off = 12
            for _ in range(qdcount):
                _, off = _decode_dns_name(resp, off)
                off += 4
            records: List[Tuple[int, int, str, int]] = []
            for _ in range(ancount):
                _, off = _decode_dns_name(resp, off)
                if off + 10 > len(resp):
                    break
                rtype, _rclass, _ttl, rdlen = struct.unpack_from(">HHIH", resp, off)
                off += 10
                rdata_end = off + rdlen
                if rtype == 33 and rdlen >= 6 and rdata_end <= len(resp):
                    prio, weight, port = struct.unpack_from(">HHH", resp, off)
                    target, _ = _decode_dns_name(resp, off + 6)
                    if target and port > 0:
                        records.append((prio, -weight, target.rstrip("."), port))
                off = rdata_end
            records.sort(key=lambda x: (x[0], x[1]))
            return [(t, p) for _, _, t, p in records]
        except Exception:
            continue
        finally:
            if sock:
                try:
                    sock.close()
                except Exception:
                    pass
    return []


async def resolve_svx_srv(domain: str, timeout: float = 1.2) -> List[Tuple[str, int]]:
    return await asyncio.to_thread(resolve_svx_srv_sync, domain, timeout)


class SVXUdpProtocol(asyncio.DatagramProtocol):
    """Handles UDP voice frames and heartbeats."""

    def __init__(self, client: "SVXClient"):
        self.client = client

    def datagram_received(self, data: bytes, addr: Tuple[str, int]):
        self.client.handle_udp_packet(data)

    def error_received(self, exc: Exception):
        logger.debug(f"[SVX_UDP] Socket error: {exc}")


class SVXClient:
    """Full TCP+UDP SvxLink Reflector Protocol Client."""

    def __init__(
        self,
        host: str = "",
        port: int = 5300,
        callsign: str = "N0CALL",
        auth_key: str = "",
        server_name: str = "",
        tg: int = 1,
        monitor_tgs: Optional[List[int]] = None,
        proto_ver: int = 2,
        codec: str = "OPUS",
        node_info: str = "",
        rx_only: bool = False,
        on_state_change: Optional[Callable[[str, str], None]] = None,
        on_rx_audio: Optional[Callable[[bytes, float, str, str], None]] = None,
        on_carrier_change: Optional[Callable[[bool, dict], None]] = None,
        on_proc_step: Optional[Callable[[str, str, str, str], None]] = None,
        user_id: Optional[int] = None,
    ):
        self.host = (host or "").strip()
        self.port = int(port or 5300)
        self.callsign = (callsign or "N0CALL").strip().upper()
        self.auth_key = auth_key or ""
        self.server_name = server_name or self.host
        self.selected_tg = int(tg if tg is not None else 1)
        self.monitor_tgs: Set[int] = set(monitor_tgs or [1, 250])
        self._configured_proto_major = 2 if proto_ver == 2 else 1
        self.proto_major = self._configured_proto_major
        self.proto_minor = 0
        self._v1_fallback_attempted = False
        self._v1_fallback_pending = False
        self.codec_pref = (codec or "OPUS").upper()
        self.node_info = node_info or ""
        self.rx_only = bool(rx_only)

        self.on_state_change = on_state_change
        self.on_rx_audio = on_rx_audio
        self.on_carrier_change = on_carrier_change
        self.on_proc_step = on_proc_step
        self.user_id = user_id

        # Connection objects
        self.reader: Optional[asyncio.StreamReader] = None
        self.writer: Optional[asyncio.StreamWriter] = None
        self.udp_transport: Optional[asyncio.DatagramTransport] = None
        self.udp_protocol: Optional[SVXUdpProtocol] = None
        self.resolved_addr: Optional[Tuple[str, int]] = None

        self.client_id = 0
        self.udp_seq = 0
        self.udp_ready = False
        self.state = "OFFLINE"
        self.state_text = _tr("svx.state_offline", "Offline", user_id=self.user_id)

        # Dynamic state
        self.connected_nodes: Set[str] = set()
        self.active_talkers: Dict[int, str] = {}
        self.last_heard: deque = deque(maxlen=25)
        self.server_codecs: List[str] = []

        self.current_rx_talker = ""
        self.current_rx_tg = 0
        self.is_carrier_active = False

        self._tcp_loop_task: Optional[asyncio.Task] = None
        self._udp_heartbeat_task: Optional[asyncio.Task] = None
        self._hang_task: Optional[asyncio.Task] = None

        self.opus_codec = SvxOpusCodec()

    def _set_state(self, new_state: str, text: str = ""):
        self.state = new_state
        self.state_text = text or new_state
        if self.on_state_change:
            try:
                self.on_state_change(self.state, self.state_text)
            except Exception as e:
                logger.debug(f"[SVX] on_state_change error: {e}")

    def _emit_proc_step(self, step_id: str, label: str, icon: str = "info", desc: str = ""):
        if self.on_proc_step:
            try:
                self.on_proc_step(step_id, label, icon, desc)
            except Exception as e:
                logger.debug(f"[SVX] proc_step error: {e}")

    async def connect(self, force: bool = False, _preserve_proto: bool = False) -> bool:
        if self.state in ("CONNECTING", "ONLINE") and not force:
            return True

        if not _preserve_proto:
            self.proto_major = self._configured_proto_major
            self.proto_minor = 0
            self._v1_fallback_attempted = False
            self._v1_fallback_pending = False

        self._set_state("CONNECTING", _tr("svx.state_connecting", "Connecting...", user_id=self.user_id))

        srv_targets = await resolve_svx_srv(self.host)
        if srv_targets:
            logger.info(f"[SVX] DNS SRV for {self.host} -> {srv_targets}")
            targets = srv_targets
        else:
            targets = [(self.host, self.port)]

        loop = asyncio.get_running_loop()
        connected_target: Optional[Tuple[str, int]] = None
        last_err: Optional[Exception] = None

        for t_host, t_port in targets:
            self._emit_proc_step("tcp_connect", _tr("svx.step_tcp", f"TCP connect to {t_host}:{t_port}", user_id=self.user_id), "info")
            try:
                addr_info = await loop.getaddrinfo(t_host, t_port, family=socket.AF_INET, type=socket.SOCK_STREAM)
                if not addr_info:
                    raise ValueError(f"Could not resolve {t_host}")
                resolved_ip = addr_info[0][4][0]
            except Exception as e:
                last_err = e
                logger.warning(f"[SVX] DNS resolution failed for {t_host}: {e}")
                continue

            try:
                reader, writer = await asyncio.wait_for(asyncio.open_connection(resolved_ip, t_port), timeout=6.0)
                self.resolved_addr = (resolved_ip, t_port)
                self.reader = reader
                self.writer = writer
                connected_target = (t_host, t_port)
                break
            except Exception as e:
                last_err = e
                logger.warning(f"[SVX] TCP connect failed for {t_host}:{t_port}: {e}")
                continue

        if not connected_target:
            err_text = str(last_err or f"Could not connect to {self.host}:{self.port}")
            logger.error(f"[SVX] All targets failed for {self.host}: {err_text}")
            self._set_state("OFFLINE", f"Connection error: {err_text}")
            self._emit_proc_step("tcp_connect", f"Connection error: {err_text}", "error")
            return False

        # Start TCP reader loop
        if self._tcp_loop_task and not self._tcp_loop_task.done():
            self._tcp_loop_task.cancel()
        self._tcp_loop_task = asyncio.create_task(self._tcp_reader_loop())

        # Send MsgProtoVer
        self._emit_proc_step("proto_ver", _tr("svx.step_proto", f"Negotiate protocol V{self.proto_major}.{self.proto_minor}", user_id=self.user_id), "info")
        await self._send_tcp_msg(MSG_PROTO_VER, struct.pack(">HH", self.proto_major, self.proto_minor))
        return True

    async def _send_tcp_msg(self, msg_type: int, payload: bytes = b""):
        if not self.writer or self.writer.is_closing():
            return
        frame_len = 2 + len(payload)
        packet = struct.pack(">IH", frame_len, msg_type) + payload
        try:
            self.writer.write(packet)
            await self.writer.drain()
        except Exception as e:
            logger.debug(f"[SVX] TCP write error: {e}")

    async def _tcp_reader_loop(self):
        while True:
            try:
                header = await self.reader.readexactly(4)
                frame_len = struct.unpack(">I", header)[0]
                if frame_len < 2 or frame_len > 32768:
                    logger.warning(f"[SVX] Invalid frame length: {frame_len}")
                    break
                body = await self.reader.readexactly(frame_len)
                msg_type = struct.unpack_from(">H", body, 0)[0]
                payload = body[2:]
                await self._handle_tcp_msg(msg_type, payload)
                if self._v1_fallback_pending:
                    break
            except asyncio.CancelledError:
                break
            except asyncio.IncompleteReadError:
                logger.info("[SVX] TCP connection closed by server")
                break
            except Exception as e:
                logger.error(f"[SVX] TCP reader exception: {e}")
                break

        if self._v1_fallback_pending:
            self._v1_fallback_pending = False
            self.disconnect(is_retry=True)
            asyncio.create_task(self.connect(force=True, _preserve_proto=True))
            return

        self.disconnect(is_retry=False)

    async def _handle_tcp_msg(self, msg_type: int, payload: bytes):
        if msg_type == MSG_HEARTBEAT:
            # Reply to heartbeat
            await self._send_tcp_msg(MSG_HEARTBEAT)

        elif msg_type == MSG_PROTO_VER_DOWNGRADE:
            if len(payload) >= 4:
                major, minor = struct.unpack(">HH", payload[:4])
                logger.info(f"[SVX] Protocol downgrade to V{major}.{minor}")
                self.proto_major = major
                self.proto_minor = minor
                await self._send_tcp_msg(MSG_PROTO_VER, struct.pack(">HH", self.proto_major, self.proto_minor))

        elif msg_type == MSG_AUTH_CHALLENGE:
            self._emit_proc_step("auth", _tr("svx.step_auth", f"Authenticating as {self.callsign}", user_id=self.user_id), "info")
            challenge, _ = _unpack_bytes(payload, 0)
            digest = hmac.new(self.auth_key.encode("utf-8"), challenge, hashlib.sha1).digest()
            resp_body = _pack_string(self.callsign) + _pack_bytes(digest)
            await self._send_tcp_msg(MSG_AUTH_RESPONSE, resp_body)

        elif msg_type == MSG_AUTH_OK:
            self._emit_proc_step("auth", _tr("svx.step_auth_ok", "Authentication OK", user_id=self.user_id), "success")

        elif msg_type == MSG_ERROR:
            err_msg, _ = _unpack_string(payload, 0)
            err_low = err_msg.lower()
            if (
                self.proto_major >= 2
                and not self._v1_fallback_attempted
                and any(k in err_low for k in ("unsupported protocol", "protocol version", "proto ver"))
            ):
                logger.info(f"[SVX] Server {self.host} rejected V{self.proto_major}.{self.proto_minor} ({err_msg}) — retrying with V1.0")
                self._emit_proc_step("proto_ver", _tr("svx.step_proto", "Protocol V2 rejected, retrying V1.0...", user_id=self.user_id), "info")
                self.proto_major = 1
                self.proto_minor = 0
                self._v1_fallback_attempted = True
                self._v1_fallback_pending = True
                return
            logger.error(f"[SVX] Reflector error: {err_msg}")
            self._set_state("OFFLINE", f"Error: {err_msg}")
            self._emit_proc_step("error", f"Reflector: {err_msg}", "error")

        elif msg_type == MSG_SERVER_INFO:
            offset = 0
            if len(payload) >= 4:
                reserved, client_id = struct.unpack_from(">HH", payload, 0)
                offset = 4
                self.client_id = client_id

                nodes, offset = _unpack_string_list(payload, offset)
                self.connected_nodes = set(nodes)

                codecs, offset = _unpack_string_list(payload, offset)
                self.server_codecs = codecs

                self._emit_proc_step("server_info", _tr("svx.step_info", f"Online (ID {self.client_id}, {len(nodes)} nodes)", user_id=self.user_id), "info")

                # Initialize UDP channel
                await self._init_udp_channel()

                # Send NodeInfo if V2
                if self.proto_major >= 2 and self.node_info:
                    info_json = json.dumps({"sw": "ProxDMR", "swVer": "2.9", "nodeLocation": self.node_info})
                    await self._send_tcp_msg(MSG_NODE_INFO_V2, _pack_string(info_json))

                # Send TG subscriptions
                await self._send_tg_subscriptions()

        elif msg_type == MSG_NODE_LIST:
            nodes, _ = _unpack_string_list(payload, 0)
            self.connected_nodes = set(nodes)

        elif msg_type == MSG_NODE_JOINED:
            call, _ = _unpack_string(payload, 0)
            if call:
                self.connected_nodes.add(call)

        elif msg_type == MSG_NODE_LEFT:
            call, _ = _unpack_string(payload, 0)
            self.connected_nodes.discard(call)

        elif msg_type == MSG_TALKER_START:
            tg = self.selected_tg
            call = ""
            if self.proto_major >= 2 and len(payload) >= 6:
                tg = struct.unpack_from(">I", payload, 0)[0]
                call, _ = _unpack_string(payload, 4)
            else:
                call, _ = _unpack_string(payload, 0)

            clean_call = (call or "UNKNOWN").strip().upper()
            self.active_talkers[tg] = clean_call
            self.last_heard.append({"callsign": clean_call, "tg": tg, "time": time.strftime("%H:%M:%S")})

            # Start carrier if this TG is selected or monitored
            if tg == self.selected_tg or tg in self.monitor_tgs:
                self.current_rx_talker = clean_call
                self.current_rx_tg = tg
                self._start_carrier()

        elif msg_type == MSG_TALKER_STOP:
            tg = self.selected_tg
            call = ""
            if self.proto_major >= 2 and len(payload) >= 6:
                tg = struct.unpack_from(">I", payload, 0)[0]
                call, _ = _unpack_string(payload, 4)
            else:
                call, _ = _unpack_string(payload, 0)

            self.active_talkers.pop(tg, None)
            if tg == self.current_rx_tg:
                self._stop_carrier(delay=0.2)

        elif msg_type == MSG_REQUEST_QSY:
            if len(payload) >= 4:
                qsy_tg = struct.unpack_from(">I", payload, 0)[0]
                logger.info(f"[SVX] Server requested QSY to TG {qsy_tg}")

    async def _send_tg_subscriptions(self):
        if self.proto_major < 2:
            return
        # Select active TG
        await self._send_tcp_msg(MSG_SELECT_TG, struct.pack(">I", self.selected_tg & 0xFFFFFFFF))
        # Set monitor TGs
        await self._send_tcp_msg(MSG_TG_MONITOR, _pack_tg_set(self.monitor_tgs))

    async def _init_udp_channel(self):
        loop = asyncio.get_running_loop()
        try:
            transport, protocol = await loop.create_datagram_endpoint(
                lambda: SVXUdpProtocol(self),
                remote_addr=self.resolved_addr
            )
            self.udp_transport = transport
            self.udp_protocol = protocol
            self.udp_ready = True

            # Send first UDP heartbeat
            self._send_udp_heartbeat()

            if self._udp_heartbeat_task and not self._udp_heartbeat_task.done():
                self._udp_heartbeat_task.cancel()
            self._udp_heartbeat_task = asyncio.create_task(self._udp_heartbeat_loop())

            self._set_state("ONLINE", f"{self.server_name} TG {self.selected_tg}")
            self._emit_proc_step("udp_ready", _tr("svx.step_udp", f"Connected on TG {self.selected_tg}", user_id=self.user_id), "success")
        except Exception as e:
            logger.error(f"[SVX] UDP init failed: {e}")

    def _send_udp_heartbeat(self):
        if not self.udp_transport:
            return
        if self.proto_major >= 2:
            hdr = struct.pack(">HHH", UDP_MSG_HEARTBEAT, self.client_id, self.udp_seq & 0xFFFF)
            self.udp_seq += 1
            self.udp_transport.sendto(hdr)
        else:
            hdr = struct.pack(">H", UDP_MSG_HEARTBEAT)
            self.udp_transport.sendto(hdr)

    async def _udp_heartbeat_loop(self):
        while True:
            try:
                await asyncio.sleep(15.0)
                if self.udp_ready:
                    self._send_udp_heartbeat()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"[SVX] UDP heartbeat loop error: {e}")

    def handle_udp_packet(self, data: bytes):
        if len(data) < 2:
            return

        msg_type = 0
        payload = b""

        if self.proto_major >= 2:
            if len(data) < 6:
                return
            msg_type, client_id, seq = struct.unpack_from(">HHH", data, 0)
            payload = data[6:]
        else:
            msg_type = struct.unpack_from(">H", data, 0)[0]
            payload = data[2:]

        if msg_type == UDP_MSG_HEARTBEAT:
            # On first heartbeat received from server, ensure subscriptions
            pass

        elif msg_type == UDP_MSG_AUDIO:
            tg = self.selected_tg
            opus_frame = b""
            if self.proto_major >= 2:
                if len(payload) >= 6:
                    tg = struct.unpack_from(">I", payload, 0)[0]
                    opus_len = struct.unpack_from(">H", payload, 4)[0]
                    opus_frame = payload[6:6 + opus_len]
            else:
                if len(payload) >= 2:
                    opus_len = struct.unpack_from(">H", payload, 0)[0]
                    opus_frame = payload[2:2 + opus_len]

            # Filter by TG
            if tg == self.selected_tg or tg in self.monitor_tgs:
                if not self.is_carrier_active:
                    self.current_rx_tg = tg
                    self._start_carrier()
                self._reset_hang_timer()

                # Decode Opus
                pcm_bytes = self.opus_codec.decode(opus_frame)
                if pcm_bytes:
                    rms = 0.0
                    try:
                        samples = struct.unpack(f"<{len(pcm_bytes)//2}h", pcm_bytes)
                        s_sum = sum(s * s for s in samples)
                        rms = math.sqrt(s_sum / len(samples))
                    except Exception:
                        rms = 0.0

                    if self.on_rx_audio:
                        try:
                            room_label = f"TG {tg}"
                            self.on_rx_audio(pcm_bytes, rms, self.current_rx_talker, room_label)
                        except Exception as e:
                            logger.debug(f"[SVX] on_rx_audio error: {e}")

        elif msg_type == UDP_MSG_FLUSH_SAMPLES:
            # Release carrier and respond
            self._stop_carrier(delay=0.1)
            if self.udp_transport:
                if self.proto_major >= 2:
                    resp = struct.pack(">HHH", UDP_MSG_ALL_SAMPLES_FLUSHED, self.client_id, self.udp_seq & 0xFFFF)
                    self.udp_seq += 1
                    self.udp_transport.sendto(resp)
                else:
                    self.udp_transport.sendto(struct.pack(">H", UDP_MSG_ALL_SAMPLES_FLUSHED))

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
        self._hang_task = asyncio.create_task(self._hang_worker(0.6))

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
                "caller": self.current_rx_talker,
                "tg": self.current_rx_tg,
                "server": self.server_name,
                "proto_ver": f"V{self.proto_major}.{self.proto_minor}",
                "rx_only": self.rx_only,
            }
            try:
                self.on_carrier_change(is_active, meta)
            except Exception as e:
                logger.debug(f"[SVX] on_carrier_change error: {e}")

    # =========================================================================
    # TX Voice Pipeline
    # =========================================================================

    def start_tx(self) -> bool:
        if self.state != "ONLINE" or not self.udp_transport:
            return False
        if self.rx_only:
            logger.info("[SVX] TX denied: client in RX-Only mode.")
            return False
        if self.selected_tg == 0:
            logger.info("[SVX] TX denied: active TG is 0 (Standby). Select a TG > 0.")
            return False
        return True

    def send_tx_audio_chunk(self, pcm320: bytes):
        if not self.udp_transport or self.selected_tg == 0:
            return
        opus_frame = self.opus_codec.encode(pcm320)
        if not opus_frame:
            return

        if self.proto_major >= 2:
            hdr = struct.pack(">HHH", UDP_MSG_AUDIO, self.client_id, self.udp_seq & 0xFFFF)
            self.udp_seq += 1
            body = struct.pack(">IH", self.selected_tg & 0xFFFFFFFF, len(opus_frame)) + opus_frame
            self.udp_transport.sendto(hdr + body)
        else:
            hdr = struct.pack(">H", UDP_MSG_AUDIO)
            body = struct.pack(">H", len(opus_frame)) + opus_frame
            self.udp_transport.sendto(hdr + body)

    def stop_tx(self):
        if not self.udp_transport:
            return
        if self.proto_major >= 2:
            hdr = struct.pack(">HHH", UDP_MSG_FLUSH_SAMPLES, self.client_id, self.udp_seq & 0xFFFF)
            self.udp_seq += 1
            self.udp_transport.sendto(hdr)
        else:
            self.udp_transport.sendto(struct.pack(">H", UDP_MSG_FLUSH_SAMPLES))

    def select_tg(self, new_tg: int):
        self.selected_tg = int(new_tg)
        if self.proto_major >= 2 and self.writer and not self.writer.is_closing():
            asyncio.create_task(self._send_tcp_msg(MSG_SELECT_TG, struct.pack(">I", self.selected_tg & 0xFFFFFFFF)))
        self._set_state("ONLINE", f"{self.server_name} TG {self.selected_tg}")

    def set_monitor_tgs(self, tgs: List[int]):
        self.monitor_tgs = set(tgs)
        if self.proto_major >= 2 and self.writer and not self.writer.is_closing():
            asyncio.create_task(self._send_tcp_msg(MSG_TG_MONITOR, _pack_tg_set(self.monitor_tgs)))

    def get_live_snapshot(self) -> Dict[str, Any]:
        return {
            "nodes": sorted(list(self.connected_nodes)),
            "nodes_count": len(self.connected_nodes),
            "active_talkers": dict(self.active_talkers),
            "last_heard": list(self.last_heard),
            "proto_ver": f"V{self.proto_major}.{self.proto_minor}",
            "codec": self.codec_pref,
            "client_id": self.client_id,
            "selected_tg": self.selected_tg,
            "monitor_tgs": sorted(list(self.monitor_tgs)),
        }

    def retarget(self, host: str, port: int, auth_key: str, server_name: str = "", tg: Optional[int] = None):
        self.host = (host or self.host).strip()
        self.port = int(port or self.port)
        if auth_key is not None:
            self.auth_key = auth_key
        if server_name:
            self.server_name = server_name
        if tg is not None:
            self.selected_tg = int(tg)
        self.proto_major = self._configured_proto_major
        self.proto_minor = 0
        self._v1_fallback_attempted = False
        self._v1_fallback_pending = False

    def disconnect(self, is_retry: bool = False):
        cur_task = None
        try:
            cur_task = asyncio.current_task()
        except RuntimeError:
            pass
        if self._tcp_loop_task and not self._tcp_loop_task.done() and self._tcp_loop_task is not cur_task:
            self._tcp_loop_task.cancel()
        if self._udp_heartbeat_task and not self._udp_heartbeat_task.done() and self._udp_heartbeat_task is not cur_task:
            self._udp_heartbeat_task.cancel()
        if self._hang_task and not self._hang_task.done() and self._hang_task is not cur_task:
            self._hang_task.cancel()

        if self.writer:
            try:
                self.writer.close()
            except Exception:
                pass
            self.writer = None
        self.reader = None

        if self.udp_transport:
            try:
                self.udp_transport.close()
            except Exception:
                pass
            self.udp_transport = None

        self.udp_ready = False
        self.is_carrier_active = False

        if not is_retry:
            self._set_state("OFFLINE", _tr("svx.state_offline", "Offline", user_id=self.user_id))
            self._emit_proc_step("disconnect", _tr("svx.step_disc", "Disconnected", user_id=self.user_id), "info")


class SVXClientAdapter:
    """Manager Adapter integrating SVXClient with ProxDMR runtime."""

    def __init__(self, manager: Any, hotspot_id: str, config: Any, user_id: Optional[int] = None):
        self.manager = manager
        self.hotspot_id = hotspot_id
        self.config = config
        self.user_id = user_id

        self.client = SVXClient(
            host=getattr(config, "svx_host", "") or getattr(config, "bm_master_host", ""),
            port=getattr(config, "svx_port", 5300) or getattr(config, "bm_master_port", 5300),
            callsign=getattr(config, "callsign", "N0CALL"),
            auth_key=getattr(config, "svx_auth_key", "") or getattr(config, "bm_password", ""),
            server_name=getattr(config, "svx_server_name", ""),
            tg=getattr(config, "svx_tg", 1),
            monitor_tgs=getattr(config, "svx_monitor_tgs", [1, 250]),
            proto_ver=getattr(config, "svx_proto_ver", 2),
            codec=getattr(config, "svx_codec", "OPUS"),
            node_info=getattr(config, "svx_node_info", "") or getattr(config, "location", ""),
            rx_only=getattr(config, "svx_rx_only", False),
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

    def retarget(self, host: str, port: int, auth_key: str, server_name: str = "", tg: Optional[int] = None):
        self.client.retarget(host, port, auth_key, server_name, tg)

    def select_tg(self, tg: int):
        self.client.select_tg(tg)

    def set_monitor_tgs(self, tgs: List[int]):
        self.client.set_monitor_tgs(tgs)

    def get_live_snapshot(self) -> Dict[str, Any]:
        return self.client.get_live_snapshot()

    def start_tx(self) -> bool:
        return self.client.start_tx()

    def send_tx_pcm(self, pcm320: bytes, is_last: bool = False):
        self.client.send_tx_audio_chunk(pcm320)
        if is_last:
            self.client.stop_tx()

    def send_tx_end(self):
        self.client.stop_tx()

    def _on_state_change(self, state: str, state_text: str):
        self.manager._notify_async({
            "type": "hotspot_updated",
            "hotspot_id": self.hotspot_id,
            "svx_state": state,
            "svx_state_text": state_text,
            "state": state,
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_proc_step(self, step_id: str, label: str, icon: str, desc: str):
        self.manager._notify_async({
            "type": "svx_proc_step",
            "hotspot_id": self.hotspot_id,
            "step_id": step_id,
            "label": label,
            "icon": icon,
            "desc": desc,
            "user_id": self.user_id,
        }, user_id=self.user_id)

    def _on_carrier_change(self, is_carrier: bool, meta: dict):
        caller = meta.get("caller", "")
        tg = meta.get("tg", 0)
        if is_carrier:
            self._active_caller = caller
            self._current_call_id = f"svx_{self.hotspot_id}_{int(time.time()*1000)}"
        else:
            self._active_caller = ""
            self._current_call_id = ""

        if not is_carrier and caller:
            self.manager._record_last_heard(
                slot=1,
                src_id=0,
                dst_id=tg,
                call_type="Group",
                src_callsign=caller,
                dst_name=f"TG {tg}",
                network="svx",
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
            "network": "svx",
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
                    talker_alias=room,
                    dst_id=self.client.current_rx_tg,
                    pcm_bytes=pcm16,
                    call_id=call_id,
                    user_id=self.user_id,
                    auto_record=auto_rec,
                )
            except Exception as e:
                logger.debug(f"[SVX] Recorder feed error: {e}")

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
                logger.debug(f"[SVX] Transcriber feed error: {e}")
