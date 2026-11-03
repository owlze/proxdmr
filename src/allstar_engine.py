"""
ProxDMR - AllStarLink (IAX2) Protocol Engine & Audio Gateway

Implements RFC 5456 (IAX2) client for connecting ProxDMR to AllStarLink nodes,
analog repeaters, and Asterisk hubs.

Features:
- Zero-dependency asynchronous UDP transport (asyncio.DatagramProtocol)
- Pure-Python / table-accelerated ITU-T G.711 u-law (PCMU) codec
- Full session handshake with MD5 authentication (NEW -> AUTHREQ -> AUTHREP -> ACCEPT)
- Bidirectional 8kHz PCM streaming with 20ms jitter buffering
- PTT transmission keying and DTMF command dispatch (*3<node>, *1<node>, etc.)
- Periodic keep-alive pinging (PING -> PONG)
"""

import asyncio
import hashlib
import logging
import math
import struct
import time
from typing import Callable, Optional, Dict, Any

logger = logging.getLogger("proxdmr.allstar")

# ----------------------------------------------------------------------------
# G.711 u-law (PCMU) Codec with Table Acceleration (Zero External Dependencies)
# ----------------------------------------------------------------------------

def _build_g711_tables():
    """Builds precomputed lookup tables for O(1) PCM16 <-> G.711 u-law conversion."""
    bias = 0x84
    # 256 entries for u-law -> 16-bit linear PCM (-32768..32767)
    dec_table = []
    for i in range(256):
        u = ~i & 0xFF
        sign = u & 0x80
        exponent = (u >> 4) & 0x07
        mantissa = u & 0x0F
        sample = ((mantissa << 3) + bias) << exponent
        sample -= bias
        dec_table.append(-sample if sign else sample)

    # 65536 entries for 16-bit linear PCM -> u-law
    enc_table = bytearray(65536)
    for sample in range(-32768, 32768):
        s = sample
        sign = 0x80 if s < 0 else 0
        if s < 0:
            s = -s
        if s > 32635:
            s = 32635
        s += bias
        exp = 7
        if s < 0x100: exp = 0
        elif s < 0x200: exp = 1
        elif s < 0x400: exp = 2
        elif s < 0x800: exp = 3
        elif s < 0x1000: exp = 4
        elif s < 0x2000: exp = 5
        elif s < 0x4000: exp = 6
        mantissa = (s >> (exp + 3)) & 0x0F
        enc_table[sample + 32768] = ~(sign | (exp << 4) | mantissa) & 0xFF

    return dec_table, bytes(enc_table)

ULAW_DECODE_TABLE, ULAW_ENCODE_TABLE = _build_g711_tables()

def pcm16_to_ulaw(pcm_bytes: bytes) -> bytes:
    """Converts 16-bit Little-Endian signed linear PCM (8kHz) to 8-bit G.711 u-law."""
    out = bytearray(len(pcm_bytes) // 2)
    enc = ULAW_ENCODE_TABLE
    for i in range(0, len(pcm_bytes), 2):
        s = pcm_bytes[i] | (pcm_bytes[i+1] << 8)
        if s >= 32768:
            s -= 65536
        out[i // 2] = enc[s + 32768]
    return bytes(out)

def ulaw_to_pcm16(ulaw_bytes: bytes) -> bytes:
    """Converts 8-bit G.711 u-law to 16-bit Little-Endian signed linear PCM (8kHz)."""
    out = bytearray(len(ulaw_bytes) * 2)
    dec = ULAW_DECODE_TABLE
    idx = 0
    for b in ulaw_bytes:
        s = dec[b]
        if s < 0:
            s += 65536
        out[idx] = s & 0xFF
        out[idx+1] = (s >> 8) & 0xFF
        idx += 2
    return bytes(out)

# ----------------------------------------------------------------------------

# ----------------------------------------------------------------------------
# DTMF Dual-Tone Multi-Frequency (ITU-T Q.23) Audio Synthesizer
# ----------------------------------------------------------------------------

DTMF_FREQS = {
    '1': (697.0, 1209.0), '2': (697.0, 1336.0), '3': (697.0, 1477.0), 'A': (697.0, 1633.0),
    '4': (770.0, 1209.0), '5': (770.0, 1336.0), '6': (770.0, 1477.0), 'B': (770.0, 1633.0),
    '7': (852.0, 1209.0), '8': (852.0, 1336.0), '9': (852.0, 1477.0), 'C': (852.0, 1633.0),
    '*': (941.0, 1209.0), '0': (941.0, 1336.0), '#': (941.0, 1477.0), 'D': (941.0, 1633.0),
}

def generate_dtmf_pcm16_frames(digit: str, tone_ms: int = 100, pause_ms: int = 60, sample_rate: int = 8000) -> list[bytes]:
    ch = str(digit or "").upper()
    if ch not in DTMF_FREQS:
        return []
    f_low, f_high = DTMF_FREQS[ch]
    tone_samples = int(sample_rate * (tone_ms / 1000.0))
    pause_samples = int(sample_rate * (pause_ms / 1000.0))
    samples = []
    amp = 9000.0
    two_pi = 2.0 * math.pi
    for i in range(tone_samples):
        t = i / float(sample_rate)
        env = (i / 24.0) if i < 24 else (((tone_samples - i) / 24.0) if i > tone_samples - 24 else 1.0)
        val = int(env * amp * (math.sin(two_pi * f_low * t) + math.sin(two_pi * f_high * t)))
        samples.append(max(-32767, min(32767, val)))
    samples.extend([0] * pause_samples)
    raw_bytes = struct.pack(f"<{len(samples)}h", *samples)
    return [raw_bytes[i:i + 320] for i in range(0, len(raw_bytes), 320) if len(raw_bytes[i:i + 320]) == 320]

# IAX2 Protocol Definitions (RFC 5456)
# ----------------------------------------------------------------------------

IAX_TYPE_DTMF    = 1
IAX_TYPE_VOICE   = 2
IAX_TYPE_CONTROL = 4
IAX_TYPE_IAX     = 6
IAX_TYPE_TEXT    = 7

IAX_CMD_NEW     = 1
IAX_CMD_PING    = 2
IAX_CMD_PONG    = 3
IAX_CMD_ACK     = 4
IAX_CMD_HANGUP  = 5
IAX_CMD_REJECT  = 6
IAX_CMD_ACCEPT  = 7
IAX_CMD_AUTHREQ = 8
IAX_CMD_AUTHREP = 9
IAX_CMD_INVAL   = 10
IAX_CMD_LAGRQ   = 11
IAX_CMD_LAGRP   = 12
IAX_CMD_REGREQ  = 13
IAX_CMD_REGACK  = 15
IAX_CMD_REGREJ  = 16
IAX_CMD_POKE    = 30

IAX_CTRL_HANGUP      = 1
IAX_CTRL_RINGING     = 3
IAX_CTRL_ANSWER      = 4
IAX_CTRL_BUSY        = 5
IAX_CTRL_CONGESTION  = 8
IAX_CTRL_KEY_RADIO   = 12
IAX_CTRL_UNKEY_RADIO = 13

IAX_FORMAT_ULAW = 4  # G.711 u-law bitmask (4)

IAX_IE_CALLED_NUMBER  = 1
IAX_IE_CALLING_NUMBER = 2
IAX_IE_CALLING_NAME   = 4
IAX_IE_CALLED_CONTEXT = 5
IAX_IE_USERNAME       = 6
IAX_IE_PASSWORD       = 7
IAX_IE_CAPABILITY     = 8
IAX_IE_FORMAT         = 9
IAX_IE_VERSION        = 11
IAX_IE_AUTHMETHODS    = 14
IAX_IE_CHALLENGE      = 15
IAX_IE_MD5_RESULT     = 16
IAX_IE_REFRESH        = 19
IAX_IE_CAUSE          = 22

def _encode_ie_str(ie_type: int, s: str) -> bytes:
    data = s.encode("utf-8")
    return struct.pack("!BB", ie_type, len(data)) + data

def _encode_ie_uint16(ie_type: int, val: int) -> bytes:
    return struct.pack("!BBH", ie_type, 2, val)

def _encode_ie_uint32(ie_type: int, val: int) -> bytes:
    return struct.pack("!BBI", ie_type, 4, val)

def _build_full_frame(src_call: int, dst_call: int, ts_ms: int, oseq: int, iseq: int,
                      ftype: int, subclass: int, ies: bytes = b"") -> bytes:
    h0 = 0x8000 | (src_call & 0x7fff)
    h1 = (dst_call & 0x7fff)
    header = struct.pack("!HHIBBB", h0, h1, ts_ms & 0xffffffff, oseq & 0xff, iseq & 0xff, ftype & 0xff)
    return header + bytes([subclass & 0xff]) + ies

def _build_mini_frame(src_call: int, ts_ms: int, payload: bytes) -> bytes:
    h0 = src_call & 0x7fff
    header = struct.pack("!HH", h0, ts_ms & 0xffff)
    return header + payload

def _parse_iax_packet(data: bytes) -> Optional[Dict[str, Any]]:
    if len(data) < 4:
        return None
    h0 = struct.unpack("!H", data[:2])[0]
    is_full = bool(h0 & 0x8000)
    src_call = h0 & 0x7fff

    if not is_full:
        ts = struct.unpack("!H", data[2:4])[0]
        return {"type": "MINI", "src_call": src_call, "ts": ts, "payload": data[4:]}

    if len(data) < 12:
        return None
    h0, h1, ts, oseq, iseq, ftype, subclass = struct.unpack("!HHIBBBB", data[:12])
    dst_call = h1 & 0x7fff
    retrans = bool(h1 & 0x8000)

    ies = {}
    idx = 12
    while idx + 2 <= len(data):
        ie_type, ie_len = struct.unpack("!BB", data[idx:idx+2])
        idx += 2
        ie_val = data[idx:idx+ie_len]
        idx += ie_len
        ies[ie_type] = ie_val

    return {
        "type": "FULL",
        "src_call": src_call,
        "dst_call": dst_call,
        "retrans": retrans,
        "ts": ts,
        "oseq": oseq,
        "iseq": iseq,
        "ftype": ftype,
        "subclass": subclass,
        "ies": ies
    }

# ----------------------------------------------------------------------------
# Asynchronous IAX2 Client & Engine
# ----------------------------------------------------------------------------

class AllStarProtocol(asyncio.DatagramProtocol):
    """Low-level UDP transport protocol for IAX2 communication."""

    def __init__(self, on_packet_cb: Callable[[bytes, tuple], None]):
        self._on_packet_cb = on_packet_cb
        self.transport: Optional[asyncio.DatagramTransport] = None

    def connection_made(self, transport: asyncio.DatagramTransport):
        self.transport = transport

    def datagram_received(self, data: bytes, addr: tuple):
        try:
            self._on_packet_cb(data, addr)
        except Exception as e:
            logger.debug(f"[ALLSTAR] Datagram processing error: {e}")

    def error_received(self, exc):
        logger.debug(f"[ALLSTAR] UDP socket error: {exc}")

    def connection_lost(self, exc):
        self.transport = None


class AllStarClient:
    """High-level AllStarLink / IAX2 client for ProxDMR."""

    def __init__(self,
                 host: str = "127.0.0.1",
                 port: int = 4569,
                 node: str = "1999",
                 username: str = "proxdmr",
                 password: str = "proxdmr_secret_iax",
                 callsign: str = "N0CALL",
                 context: str = "iaxrpt",
                 asl_password: str = ""):
        self.host = host
        self.port = port
        self.node = node
        self.username = username
        self.password = password or "proxdmr_secret_iax"
        self.callsign = callsign
        self.context = context
        self.asl_password = asl_password

        # State
        self.state: str = "IDLE"  # IDLE, CONNECTING, ACTIVE, DISCONNECTED
        self.is_connected: bool = False
        self.is_rx: bool = False
        self.is_tx: bool = False
        self._tx_voice_header_sent: bool = False

        # Protocol numbers
        self.my_call: int = 100 + (int(time.time() * 1000) % 30000)
        self.dst_call: int = 0
        self.oseq: int = 0
        self.iseq: int = 0
        self.start_time: float = time.time()
        self.last_rx_audio_time: float = 0.0
        self.last_voice_time: float = 0.0
        # VAD & Radio Carrier State
        self.vad_threshold: float = 0.0055        # ~180 in int16 PCM - captures normal and quiet ASL speech
        self.vad_hang_time_keyed: float = 1.20    # Carrier hold during natural breath pauses (2.8s)
        self.vad_hang_time_unkeyed: float = 0.35  # Fast release ONLY after explicit UNKEY signal
        self.min_speech_duration: float = 0.28    # Min voice speech duration (sec) for single short transmission
        self._remote_radio_keyed: bool = False
        self.tx_key_ack_event: asyncio.Event = asyncio.Event()
        self._last_unkey_time: float = 0.0
        self.voice_frames_count: int = 0          # Number of 20ms voiced frames in current call
        self.total_rx_frames_count: int = 0
        self._consecutive_voice_frames: int = 0   # Require >=2 consecutive voice frames (40ms) to open carrier
        self._zcr_samples: list = []
        self._rms_samples: list = []
        self.on_link_telemetry: Optional[Callable[[str], None]] = None

        # Network latency & jitter telemetry
        self.current_rtt_ms: float = 0.0
        self.current_jitter_ms: float = 0.0
        self._ping_send_ts: Optional[float] = None
        self._last_rx_pkt_ts: Optional[int] = None
        self._last_rx_arrival_ts: Optional[float] = None
        self.on_telemetry: Optional[Callable[[float, float], None]] = None
        self._pending_key_ack_seq: Optional[int] = None
        self._key_sent_ts: float = 0.0
        self.on_tx_key_ack: Optional[Callable[[float], None]] = None

        # Async tasks & networking
        self._transport: Optional[asyncio.DatagramTransport] = None
        self._protocol: Optional[AllStarProtocol] = None
        self._ping_task: Optional[asyncio.Task] = None
        self._carrier_watchdog_task: Optional[asyncio.Task] = None
        self._handshake_task: Optional[asyncio.Task] = None
        self._remote_addr: tuple = (self.host, self.port)  # обновляется в connect()

        # Callbacks (assigned by caller / hotspot adapter)
        self.on_state_change: Optional[Callable[[str], None]] = None
        self.on_rx_audio: Optional[Callable[[bytes, float], None]] = None
        self.on_carrier_change: Optional[Callable[[bool], None]] = None

    def _ts_ms(self) -> int:
        return int((time.time() - self.start_time) * 1000) & 0xFFFFFFFF

    def _send_full(self, ftype: int, subclass: int, ies: bytes = b"", inc_oseq: bool = False, ts: Optional[int] = None):
        if not self._transport:
            return
        timestamp = ts if ts is not None else self._ts_ms()
        pkt = _build_full_frame(self.my_call, self.dst_call, timestamp,
                                self.oseq, self.iseq, ftype, subclass, ies)
        if inc_oseq:
            self.oseq = (self.oseq + 1) & 0xFF
        # Всегда указываем адрес явно — сокет unconnected, принимает пакеты с любого порта
        self._transport.sendto(pkt, self._remote_addr)

    def _send_ack(self, ts: Optional[int] = None):
        """Acknowledges the last received Full Frame."""
        self._send_full(IAX_TYPE_IAX, IAX_CMD_ACK, inc_oseq=False, ts=ts)

    async def connect(self):
        """Initiates an asynchronous IAX2 call connection."""
        if self.state in ("CONNECTING", "ACTIVE"):
            return

        self._set_state("CONNECTING")
        self.start_time = time.time()
        self.oseq = 0
        self.iseq = 0
        self.dst_call = 0
        self._remote_addr = (self.host, self.port)

        loop = asyncio.get_running_loop()
        try:
            # Открываем UNCONNECTED UDP сокет (local_addr вместо remote_addr).
            # Это позволяет принимать пакеты от Asterisk с любого source-порта,
            # а не только с порта 4569 (Asterisk может отвечать с рандомного порта).
            transport, protocol = await loop.create_datagram_endpoint(
                lambda: AllStarProtocol(self._on_packet),
                local_addr=("0.0.0.0", 0)
            )
            self._transport = transport
            self._protocol = protocol
        except Exception as e:
            logger.error(f"[ALLSTAR] Failed to open UDP socket to {self.host}:{self.port}: {e}")
            self._set_state("IDLE")
            return

        # Send initial NEW frame with retry loop
        new_ies = (
            _encode_ie_str(IAX_IE_CALLED_NUMBER, self.node) +
            _encode_ie_str(IAX_IE_CALLING_NUMBER, self.callsign) +
            _encode_ie_str(IAX_IE_CALLING_NAME, f"{self.callsign} ProxDMR") +
            _encode_ie_str(IAX_IE_CALLED_CONTEXT, self.context) +
            _encode_ie_str(IAX_IE_USERNAME, self.username) +
            _encode_ie_uint16(IAX_IE_VERSION, 2) +
            _encode_ie_uint32(IAX_IE_FORMAT, IAX_FORMAT_ULAW) +
            _encode_ie_uint32(IAX_IE_CAPABILITY, IAX_FORMAT_ULAW)
        )
        logger.info(f"[ALLSTAR] Connecting to node {self.node} at {self.host}:{self.port}...")

        async def _handshake_loop():
            for attempt in range(6):
                if self.state != "CONNECTING":
                    break
                self._send_full(IAX_TYPE_IAX, IAX_CMD_NEW, new_ies, inc_oseq=True)
                await asyncio.sleep(0.9)
            if self.state == "CONNECTING":
                logger.warning(f"[ALLSTAR] Connection handshake timed out for node {self.node}")
                self._cleanup()
                self._set_state("IDLE")

        self._handshake_task = asyncio.create_task(_handshake_loop())

        # Start background watchdog and keep-alive tasks
        self._ping_task = asyncio.create_task(self._ping_loop())
        self._carrier_watchdog_task = asyncio.create_task(self._carrier_watchdog_loop())

    async def disconnect(self):
        """Disconnects cleanly from the AllStarLink node."""
        if self.state in ("ACTIVE", "CONNECTING"):
            try:
                self._send_full(IAX_TYPE_IAX, IAX_CMD_HANGUP, inc_oseq=True)
            except Exception:
                pass

        self._cleanup()
        self._set_state("IDLE")
        logger.info("[ALLSTAR] Disconnected cleanly from node.")

    def _cleanup(self):
        if self._handshake_task and not self._handshake_task.done():
            self._handshake_task.cancel()
            self._handshake_task = None
        if self._ping_task and not self._ping_task.done():
            self._ping_task.cancel()
        if self._carrier_watchdog_task and not self._carrier_watchdog_task.done():
            self._carrier_watchdog_task.cancel()
        if self._transport and not self._transport.is_closing():
            self._transport.close()
        self._transport = None
        self._protocol = None
        self.is_connected = False
        self._update_carrier(False)

    def _set_state(self, new_state: str):
        if self.state != new_state:
            self.state = new_state
            self.is_connected = (new_state == "ACTIVE")
            if self.on_state_change:
                try:
                    self.on_state_change(new_state)
                except Exception as e:
                    logger.debug(f"[ALLSTAR] on_state_change callback error: {e}")

    def _update_carrier(self, is_rx: bool):
        if self.is_rx != is_rx:
            self.is_rx = is_rx
            if is_rx:
                # Do not reset voice_frames_count to 0; preserve accumulated initial voiced frames
                self.voice_frames_count = max(self.voice_frames_count, self._consecutive_voice_frames)
                self.total_rx_frames_count = max(self.total_rx_frames_count, self._consecutive_voice_frames)
            else:
                self._consecutive_voice_frames = 0
            if self.on_carrier_change:
                try:
                    self.on_carrier_change(is_rx)
                except Exception as e:
                    logger.debug(f"[ALLSTAR] on_carrier_change callback error: {e}")

    def _on_packet(self, data: bytes, addr: tuple):
        pkt = _parse_iax_packet(data)
        if not pkt:
            return

        if pkt["type"] == "MINI":
            if self.state == "ACTIVE" and len(pkt["payload"]) > 0:
                self._handle_audio_rx(pkt["payload"])
            return

        # Full frame: update remote call and incoming sequence
        self.dst_call = pkt["src_call"]
        self.iseq = (pkt["oseq"] + 1) & 0xFF

        ftype = pkt["ftype"]
        subclass = pkt["subclass"]

        if ftype == IAX_TYPE_IAX:
            if subclass == IAX_CMD_AUTHREQ:
                if self._handshake_task and not self._handshake_task.done():
                    self._handshake_task.cancel()
                    self._handshake_task = None
                # Challenge received from Asterisk: compute MD5 hash and send AUTHREP
                challenge = pkt["ies"].get(IAX_IE_CHALLENGE, b"").decode("latin1", "ignore")
                md5_hash = hashlib.md5((challenge + self.password).encode("utf-8")).hexdigest()
                auth_ies = _encode_ie_str(IAX_IE_MD5_RESULT, md5_hash)
                logger.debug(f"[ALLSTAR] Sending MD5 AUTHREP response...")
                self._send_full(IAX_TYPE_IAX, IAX_CMD_AUTHREP, auth_ies, inc_oseq=True)

            elif subclass == IAX_CMD_ACCEPT:
                if self._handshake_task and not self._handshake_task.done():
                    self._handshake_task.cancel()
                    self._handshake_task = None
                logger.info(f"[ALLSTAR] Call accepted by node {self.node}. Call is now ACTIVE.")
                self._send_ack(pkt["ts"])
                self._set_state("ACTIVE")

            elif subclass == IAX_CMD_REJECT:
                cause = pkt["ies"].get(IAX_IE_CAUSE, b"Rejected").decode("utf-8", "ignore")
                logger.warning(f"[ALLSTAR] Call rejected by node: {cause}")
                self._cleanup()
                self._set_state("IDLE")

            elif subclass == IAX_CMD_HANGUP:
                logger.info("[ALLSTAR] Node hung up.")
                self._send_ack(pkt["ts"])
                self._cleanup()
                self._set_state("IDLE")

            elif subclass == IAX_CMD_PING:
                self._send_full(IAX_TYPE_IAX, IAX_CMD_PONG, inc_oseq=False, ts=pkt["ts"])

            elif subclass == IAX_CMD_PONG:
                self._send_ack(pkt["ts"])
                if self._ping_send_ts is not None:
                    self.current_rtt_ms = max(1.0, round((time.time() - self._ping_send_ts) * 1000.0, 1))
                    self._ping_send_ts = None
                    if self.on_telemetry:
                        try:
                            self.on_telemetry(self.current_rtt_ms, self.current_jitter_ms)
                        except Exception:
                            pass

            elif subclass == IAX_CMD_LAGRQ:
                # Reply to Asterisk lag measurement with LAGRP echoing back the timestamp
                self._send_full(IAX_TYPE_IAX, IAX_CMD_LAGRP, inc_oseq=False, ts=pkt["ts"])

            elif subclass == IAX_CMD_LAGRP:
                self._send_ack(pkt["ts"])

            elif subclass == IAX_CMD_ACK:
                if self.is_tx and self._pending_key_ack_seq is not None:
                    ack_iseq = pkt.get("iseq", -1)
                    if ack_iseq == self._pending_key_ack_seq or ((ack_iseq - self._pending_key_ack_seq) & 0xFF) < 8:
                        self._pending_key_ack_seq = None
                        ack_rtt_ms = max(1.0, round((time.time() - self._key_sent_ts) * 1000.0, 1))
                        if hasattr(self, "tx_key_ack_event") and self.tx_key_ack_event:
                            self.tx_key_ack_event.set()
                        if self.on_tx_key_ack:
                            try:
                                self.on_tx_key_ack(ack_rtt_ms)
                            except Exception as e:
                                logger.debug(f"[ALLSTAR] on_tx_key_ack error: {e}")

            else:
                self._send_ack(pkt["ts"])

        elif ftype == IAX_TYPE_CONTROL:
            self._send_ack(pkt["ts"])
            if subclass == IAX_CTRL_ANSWER:
                logger.debug("[ALLSTAR] Channel answered.")
                self._set_state("ACTIVE")
            elif subclass == IAX_CTRL_KEY_RADIO:
                self._remote_radio_keyed = True
                self.last_rx_audio_time = time.time()
                logger.debug(f"[ALLSTAR] IAX_CTRL_KEY_RADIO: remote radio keyed on node {self.node}")
            elif subclass == IAX_CTRL_UNKEY_RADIO:
                self._remote_radio_keyed = False
                self._last_unkey_time = time.time()
                logger.debug(f"[ALLSTAR] IAX_CTRL_UNKEY_RADIO: remote radio unkeyed on node {self.node}")
                if self.is_rx and (time.time() - self.last_voice_time) >= 0.25:
                    self._update_carrier(False)
            elif subclass == IAX_CTRL_HANGUP:
                self._remote_radio_keyed = False
                self._update_carrier(False)
                self._cleanup()
                self._set_state("IDLE")

        elif ftype == IAX_TYPE_VOICE:
            self._send_ack(pkt["ts"])
            if len(pkt["ies"]) > 0:
                pass
            # Full voice payload
            payload = data[12:]
            if len(payload) > 0:
                self._handle_audio_rx(payload)

        elif ftype == IAX_TYPE_TEXT:
            self._send_ack(pkt["ts"])
            payload = data[12:]
            try:
                txt = payload.rstrip(b"\x00").decode("utf-8", errors="ignore").strip()
                if txt and self.on_link_telemetry:
                    self.on_link_telemetry(txt)
            except Exception as e:
                logger.debug(f"[ALLSTAR] Text frame telemetry parse error: {e}")

        else:
            logger.debug(f"[ALLSTAR] Unhandled frame ftype={ftype} subclass={subclass}, sending ACK")
            self._send_ack(pkt["ts"])

    def _analyze_frame_acoustics(self, pcm16: bytes, rms_float: float) -> None:
        """Collects Zero-Crossing Rate (ZCR) statistics during voiced frames for voice pitch estimation."""
        rms_int = int(rms_float * 32768.0)
        if rms_int < 180 or len(pcm16) < 64:
            return
        count = len(pcm16) // 2
        samples = struct.unpack(f"<{count}h", pcm16[:count * 2])
        zc = 0
        prev = samples[0]
        for s in samples[1:]:
            if (prev >= 0 and s < 0) or (prev < 0 and s >= 0):
                zc += 1
            prev = s
        zcr_hz = (zc * 8000.0) / (2.0 * count)
        if 70.0 <= zcr_hz <= 1800.0 and len(self._zcr_samples) < 400:
            self._zcr_samples.append(zcr_hz)
            self._rms_samples.append(rms_int)

    def get_current_voice_profile(self) -> dict:
        """Returns voice acoustic estimate for current transmission (pitch: low/medium/high, median ZCR, voice duration)."""
        voice_sec = round(self.voice_frames_count * 0.02, 2)
        if not self._zcr_samples:
            return {"voice_sec": voice_sec, "zcr_median": 0.0, "pitch": "medium"}
        s_sorted = sorted(self._zcr_samples)
        median_zcr = s_sorted[len(s_sorted) // 2]
        if median_zcr < 360.0:
            pitch = "low"
        elif median_zcr > 520.0:
            pitch = "high"
        else:
            pitch = "medium"
        return {
            "voice_sec": voice_sec,
            "zcr_median": round(median_zcr, 1),
            "pitch": pitch,
        }

    def _handle_audio_rx(self, ulaw_payload: bytes):
        """Processes incoming G.711 u-law audio with dual-mode VAD hang time and acoustic profiling."""
        now = time.time()
        self.last_rx_audio_time = now
        self.total_rx_frames_count += 1
        pcm16 = ulaw_to_pcm16(ulaw_payload)

        # Fast RMS calculation for VU meter and VAD
        sum_sq = 0
        samples_count = len(pcm16) // 2
        for i in range(0, len(pcm16), 2):
            s = pcm16[i] | (pcm16[i+1] << 8)
            if s >= 32768:
                s -= 65536
            sum_sq += s * s

        rms = math.sqrt(sum_sq / max(1, samples_count)) / 32768.0

        if rms >= self.vad_threshold:
            self.last_voice_time = now
            self.voice_frames_count += 1
            self._consecutive_voice_frames += 1
            self._analyze_frame_acoustics(pcm16, rms)

            # Open carrier only after >=2 consecutive voice frames (40 ms),
            # preventing short line clicks/squelch bursts from creating false calls
            if not self.is_rx and self._consecutive_voice_frames >= 2:
                self._update_carrier(True)

            if self.on_rx_audio:
                try:
                    self.on_rx_audio(pcm16, min(1.0, rms * 2.5))
                except Exception as e:
                    logger.debug(f"[ALLSTAR] on_rx_audio callback error: {e}")
        else:
            self._consecutive_voice_frames = 0
            if self.is_rx:
                explicit_unkey = (not self._remote_radio_keyed) and (self._last_unkey_time > self.last_voice_time)
                hang_time = self.vad_hang_time_unkeyed if explicit_unkey else self.vad_hang_time_keyed
                if (now - self.last_voice_time) <= hang_time:
                    if self.on_rx_audio:
                        try:
                            self.on_rx_audio(pcm16, min(1.0, rms * 2.5))
                        except Exception as e:
                            logger.debug(f"[ALLSTAR] on_rx_audio callback error: {e}")
                else:
                    self._update_carrier(False)

    def start_ptt(self):
        """Signals start of PTT transmission with explicit IAX_CTRL_KEY_RADIO frame."""
        self.is_tx = True
        if hasattr(self, "tx_key_ack_event") and self.tx_key_ack_event:
            self.tx_key_ack_event.clear()
        self._tx_voice_header_sent = False
        if self.state == "ACTIVE" and self._transport:
            self._key_sent_ts = time.time()
            expected_iseq = (self.oseq + 1) & 0xFF
            self._pending_key_ack_seq = expected_iseq
            self._send_full(IAX_TYPE_CONTROL, IAX_CTRL_KEY_RADIO, inc_oseq=True)

    def stop_ptt(self):
        """Signals end of PTT transmission with explicit IAX_CTRL_UNKEY_RADIO frame."""
        was_tx = self.is_tx
        self.is_tx = False
        self._tx_voice_header_sent = False
        self._pending_key_ack_seq = None
        if was_tx and self.state == "ACTIVE" and self._transport:
            self._send_full(IAX_TYPE_CONTROL, IAX_CTRL_UNKEY_RADIO, inc_oseq=True)

    def send_tx_audio_chunk(self, pcm16_chunk: bytes):
        """Sends a 20ms chunk (320 bytes = 160 samples 16-bit 8kHz) of audio over PTT."""
        if self.state != "ACTIVE" or not self._transport:
            return

        ulaw_payload = pcm16_to_ulaw(pcm16_chunk)

        # In IAX2, the first voice packet of a talk burst must be a Full Voice Frame (subclass=4 for u-law)
        # so the receiver locks onto the codec format. Subsequent frames are Mini Frames.
        if not self._tx_voice_header_sent:
            self._tx_voice_header_sent = True
            self.is_tx = True
            self._send_full(IAX_TYPE_VOICE, IAX_FORMAT_ULAW, ulaw_payload, inc_oseq=True)
        else:
            mini_pkt = _build_mini_frame(self.my_call, self._ts_ms(), ulaw_payload)
            self._transport.sendto(mini_pkt, self._remote_addr)

    def send_dtmf(self, digits: str):
        """Sends one or more DTMF characters ('0'-'9', '*', '#', 'A'-'D') to the node."""
        if self.state != "ACTIVE" or not self._transport:
            return

        for ch in digits:
            if ch in "0123456789*#ABCDabcd":
                subclass = ord(ch.upper())
                logger.info(f"[ALLSTAR] Sending DTMF key: '{ch.upper()}'")
                self._send_full(IAX_TYPE_DTMF, subclass, inc_oseq=True)

    async def _ping_loop(self):
        """Sends keep-alive PING frames to prevent NAT timeouts and measure RTT."""
        while self.state in ("ACTIVE", "CONNECTING"):
            await asyncio.sleep(10.0)
            if self.state == "ACTIVE" and self._transport:
                self._ping_send_ts = time.time()
                self._send_full(IAX_TYPE_IAX, IAX_CMD_PING, inc_oseq=True)

    async def _carrier_watchdog_loop(self):
        """Detects end-of-transmission (carrier unkey) when audio stops arriving or silence persists."""
        while self.state in ("ACTIVE", "CONNECTING"):
            await asyncio.sleep(0.08)
            now = time.time()
            if self.is_rx:
                if (now - self.last_rx_audio_time > 1.35):
                    self._update_carrier(False)
                else:
                    explicit_unkey = (not self._remote_radio_keyed) and (self._last_unkey_time > self.last_voice_time)
                    hang_time = self.vad_hang_time_unkeyed if explicit_unkey else self.vad_hang_time_keyed
                    if (now - self.last_voice_time > hang_time):
                        self._update_carrier(False)


class AllStarClientAdapter:
    """
    Adapter bridging AllStarClient with ProxDMR HotspotManager runtime.
    Duck-types HomeBrewClient so all existing ProxDMR connection, audio routing,
    and UI mechanisms work natively with AllStarLink.
    """
    def __init__(self, client: AllStarClient, hotspot_id: str, user_id: int, manager: Any):
        self.client = client
        self.hotspot_id = hotspot_id
        self.user_id = user_id
        self.manager = manager
        self._is_manual_disconnect: bool = False
        self.failed_cycles: int = 0
        self.color_code: int = 1

        # CTCSS sub-audible tone filter (HPF 300 Hz)
        self.ctcss_filter_enabled: bool = True
        self._ctcss_biquad: Optional[Any] = None
        self._init_ctcss_filter()

        self._active_asl_call_id: Optional[str] = None
        self._active_asl_start_ts: float = 0.0
        self._active_asl_node: str = ""
        self._last_asl_node: str = ""
        self._active_asl_info: Optional[Dict[str, Any]] = None

        # Session & dialogue separation state
        self._last_ended_call_id: Optional[str] = None
        self._last_ended_node_id: int = 0
        self._last_ended_time: float = 0.0
        self._last_voice_profile: dict = {}
        self._dialogue_speaker_turn: int = 1
        self._rx_alinks_poll_task: Optional[asyncio.Task] = None

        # Bind event callbacks
        self.client.on_state_change = self._on_asl_state_change
        self.client.on_carrier_change = self._on_asl_carrier_change
        self.client.on_rx_audio = self._on_asl_rx_audio
        self.client.on_telemetry = self._on_asl_telemetry
        self.client.on_tx_key_ack = self._on_asl_tx_key_ack
        self.client.on_link_telemetry = self._on_asl_link_telemetry

        # Parrot Repeater (1999) recording & playback state
        self._parrot_tx_buffer: bytearray = bytearray()
        self._parrot_active_node: Optional[str] = None
        self._parrot_playback_task: Optional[asyncio.Task] = None
        self._forced_echo_node: Optional[str] = None
        self._tx_ready_task: Optional[asyncio.Task] = None
        self._accumulated_voice_sec: float = 0.0
        self._deferred_discard_task: Optional[asyncio.Task] = None
        self._netstats_poll_in_flight: bool = False
        self._dtmf_macro_in_progress: bool = False
        self._dtmf_macro_lock: asyncio.Lock = asyncio.Lock()

    def _on_asl_link_telemetry(self, text: str):
        """
        Parses link telemetry text frames from app_rpt.
        NOTE: Standard 'L R2560,R2462,TN0CALL' frames represent RPT_LINKS where R/T is link mode
        (Receive vs Transceive), NOT keyed state! Only explicit 'K' tokens indicate keying.
        """
        try:
            if not text:
                return
            # Match only explicit Keyed tokens: e.g. '2462TK', '2462RK', or 'K2462'
            keyed_matches = re.findall(r'\b(\d{4,7})[TRCtrc]K\b|\bK(\d{4,7})\b', text)
            keyed_nodes = [m[0] or m[1] for m in keyed_matches if (m[0] or m[1])]
            if keyed_nodes:
                self.client._remote_radio_keyed = True
                new_node = str(keyed_nodes[0]).strip()
                if (
                    self.client.is_rx
                    and new_node
                    and self._active_asl_node
                    and str(new_node) != str(self._active_asl_node)
                ):
                    self._split_call_on_node_change(new_node)
        except Exception as e:
            logger.debug(f"[ALLSTAR] Telemetry parse error: {e}")

    def _split_call_on_node_change(self, new_node: str):
        """Gracefully finishes previous node call and starts a new call for the newly keyed node."""
        if not self._active_asl_call_id or not self.client.is_rx:
            return
        logger.info(f"[ALLSTAR] Talking node changed during continuous RX from {self._active_asl_node} to {new_node}. Splitting call.")
        old_call_id = self._active_asl_call_id
        if hasattr(self.manager, "recorder") and self.manager.recorder:
            self.manager.recorder.on_rx_call_ended(self.hotspot_id, 1, call_id=old_call_id)
        if self.manager.transcriber and self.manager.transcriber.is_slot_enabled(self.hotspot_id, 1):
            self.manager.transcriber.on_call_ended(self.hotspot_id, 1, call_id=old_call_id)
        self._on_asl_carrier_change(False)
        self._active_asl_node = str(new_node)
        self._last_asl_node = str(new_node)
        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        if rt:
            rt._active_asl_node = str(new_node)
            rt._last_asl_node = str(new_node)
        self._on_asl_carrier_change(True)

    def _on_asl_telemetry(self, rtt: float, jitter: float):
        if getattr(self, "_netstats_poll_in_flight", False):
            return
        self._netstats_poll_in_flight = True

        async def _poll_and_notify():
            try:
                target_node = self._active_asl_node or self._last_asl_node
                rtt_val = rtt
                jitter_val = jitter
                if target_node:
                    try:
                        from asl_container_manager import asl_container_mgr
                        loop = asyncio.get_running_loop()
                        uid_str = str(self.user_id)
                        local_node_str = str(self.client.node if self.client else "")
                        netstats = await loop.run_in_executor(
                            None,
                            lambda: asl_container_mgr.get_node_netstats(uid_str, local_node_str)
                        )
                        if isinstance(netstats, dict):
                            node_stat = netstats.get(str(target_node))
                            if node_stat and node_stat.get("rtt"):
                                rtt_val = float(node_stat["rtt"])
                                jitter_val = float(node_stat.get("jitter", jitter_val))
                                if self.client:
                                    self.client.current_rtt_ms = rtt_val
                                    self.client.current_jitter_ms = jitter_val
                    except Exception as e:
                        logger.debug(f"[ASL:{self.hotspot_id}] Netstats query error: {e}")

                self.manager._notify_async({
                    "type": "allstar_telemetry",
                    "hotspot_id": self.hotspot_id,
                    "rtt": rtt_val,
                    "jitter": jitter_val,
                    "node": self._active_asl_node or (self.client.node if self.client else ""),
                    "user_id": self.user_id,
                }, user_id=self.user_id)
            except Exception as e:
                logger.debug(f"[ALLSTAR] Telemetry notify error: {e}")
            finally:
                self._netstats_poll_in_flight = False

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_poll_and_notify())
        except RuntimeError:
            self._netstats_poll_in_flight = False

    def _init_ctcss_filter(self):
        try:
            from dmr.audio_equalizer import BiquadFilter
            bf = BiquadFilter()
            bf.setup_highpass(300.0, Q=0.7071, fs=8000.0)
            self._ctcss_biquad = bf
        except Exception as e:
            logger.warning(f"[ALLSTAR] Failed to initialize CTCSS Biquad filter: {e}")

    @property
    def is_connected(self) -> bool:
        return self.client.is_connected

    async def connect(self, force: bool = False) -> bool:
        self._is_manual_disconnect = False
        try:
            import os
            from asl_container_manager import asl_container_mgr
            uid_str = str(self.user_id)
            node_str = str(self.client.node)
            callsign = getattr(self.client, "callsign", "N0CALL")
            password = getattr(self.client, "asl_password", "")
            
            info = asl_container_mgr.start_instance(
                user_id=uid_str,
                node_number=node_str,
                node_password=password,
                callsign=callsign
            )
            if info.get("running"):
                c_name = info.get("container_name")
                c_ip = info.get("ip_address")
                if os.path.exists("/.dockerenv"):
                    self.client.host = c_ip or c_name or self.client.host
                    self.client.port = 4569
                else:
                    self.client.host = "127.0.0.1"
                    self.client.port = info.get("iax_port", 4569)
                # Wait until Asterisk core is fully booted (prevents 'PBX requires Asterisk to be fully booted')
                loop = asyncio.get_running_loop()
                await loop.run_in_executor(None, asl_container_mgr.wait_until_ready, uid_str, node_str, 8.0)
        except Exception as e:
            logger.warning(f"[ALLSTAR] Container orchestration warning during connect: {e}")

        # Ensure auto_record is enabled for AllStarLink runtime if global auto-recording is active
        try:
            rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
            if rt and hasattr(rt, "config"):
                rec_enabled = getattr(getattr(self.manager, "recorder", None), "auto_rx_enabled", True)
                if rec_enabled and not getattr(rt.config, "auto_record", True):
                    rt.config.auto_record = True
        except Exception:
            pass

        await self.client.connect()
        return True

    async def disconnect(self, is_retry: bool = False, force_stop_container: bool = False):
        if not is_retry:
            self._is_manual_disconnect = True
        await self.client.disconnect()
        if self._is_manual_disconnect:
            always_online = True
            try:
                rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
                if rt and hasattr(rt, "config"):
                    always_online = bool(getattr(rt.config, "allstar_always_online", True))
            except Exception:
                pass

            if force_stop_container or not always_online:
                try:
                    from asl_container_manager import asl_container_mgr
                    asl_container_mgr.stop_instance(str(self.user_id), str(self.client.node))
                except Exception as e:
                    logger.warning(f"[ALLSTAR] Error stopping container on disconnect: {e}")
            else:
                logger.info(f"[ALLSTAR] Keeping ASL3 core container alive for node {self.client.node} (allstar_always_online=True)")

    def _get_linked_echo_node(self) -> Optional[str]:
        try:
            rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
            if not rt:
                return None
            links = getattr(rt, "asl_links", None) or []
            for lk in links:
                n = str(lk.get("node", "")).strip()
                if n in ("1999", "9999") and lk.get("mode") == "*3":
                    return "1999"
            for lk in links:
                n = str(lk.get("node", "")).strip()
                if n in ("1999", "9999"):
                    return "1999"
            conn = str(getattr(rt, "connected_node", "") or "").strip()
            if conn in ("1999", "9999"):
                return "1999"
        except Exception:
            pass
        return None

    async def _play_parrot_buffer(self, pcm_data: bytes, echo_node: str = "1999"):
        """Plays recorded TX audio back through the full ASL RX pipeline as node 1999 (Parrot)."""
        try:
            await asyncio.sleep(0.60)
            self._forced_echo_node = echo_node
            self._on_asl_carrier_change(True)

            chunk_size = 320  # 20ms @ 8000Hz 16-bit mono = 160 samples = 320 bytes
            offset = 0
            total = len(pcm_data)
            next_frame_time = time.monotonic()

            while offset < total:
                chunk = pcm_data[offset:offset + chunk_size]
                if len(chunk) < chunk_size:
                    chunk = chunk + b"\x00" * (chunk_size - len(chunk))
                offset += chunk_size

                sc = len(chunk) // 2
                samples = struct.unpack(f"<{sc}h", chunk)
                sum_sq = sum(s * s for s in samples)
                rms = math.sqrt(sum_sq / max(1, sc)) / 32768.0

                if self.client:
                    self.client.last_rx_audio_time = time.time()
                    self.client.total_rx_frames_count += 1
                    if rms >= self.client.vad_threshold:
                        self.client.last_voice_time = self.client.last_rx_audio_time
                        self.client.voice_frames_count += 1
                        self.client._analyze_frame_acoustics(chunk, rms)

                self._on_asl_rx_audio(chunk, min(1.0, rms * 2.5))

                next_frame_time += 0.020
                sleep_dur = next_frame_time - time.monotonic()
                if sleep_dur > 0:
                    await asyncio.sleep(sleep_dur)
                else:
                    next_frame_time = time.monotonic()

            await asyncio.sleep(0.15)
        except asyncio.CancelledError:
            logger.debug(f"[ALLSTAR] Parrot playback cancelled for node {echo_node}")
        except Exception as e:
            logger.warning(f"[ALLSTAR] Parrot playback error: {e}")
        finally:
            self._forced_echo_node = None
            if getattr(self, "_active_asl_call_id", None):
                self._on_asl_carrier_change(False)

    def _on_asl_tx_key_ack(self, ack_rtt_ms: float):
        """
        Triggered when Asterisk/app_rpt responds with IAX_CMD_ACK to IAX_CTRL_KEY_RADIO.
        Calculates network delay + jitter buffer + PLL opening time and notifies frontend.
        """
        if self._tx_ready_task and not self._tx_ready_task.done():
            self._tx_ready_task.cancel()

        async def _notify_tx_ready():
            try:
                rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
                links = (getattr(rt, "asl_links", None) or []) if rt else []
                tx_nodes = [str(lk.get("node", "")).strip() for lk in links if lk.get("mode") == "*3" and lk.get("node")]

                if tx_nodes and all(n in ("1999", "9999") for n in tx_nodes):
                    wait_sec = 0.08
                else:
                    net_rtt_sec = max(ack_rtt_ms, getattr(self.client, "current_rtt_ms", 40.0)) / 1000.0
                    net_jit_sec = getattr(self.client, "current_jitter_ms", 10.0) / 1000.0
                    wait_sec = min(1.1, max(0.38, net_rtt_sec + net_jit_sec + 0.38))

                await asyncio.sleep(wait_sec)
                if not self.client.is_tx:
                    return

                self.manager._notify_async({
                    "type": "allstar_tx_ready",
                    "hotspot_id": self.hotspot_id,
                    "ack_rtt_ms": ack_rtt_ms,
                    "total_ready_ms": int((ack_rtt_ms / 1000.0 + wait_sec) * 1000),
                    "user_id": self.user_id,
                }, user_id=self.user_id)
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.debug(f"[ALLSTAR] _notify_tx_ready error: {e}")

        try:
            loop = asyncio.get_running_loop()
            self._tx_ready_task = loop.create_task(_notify_tx_ready())
        except Exception:
            pass

    def send_options(self, opts: str):
        pass

    def send_dmrd(self, *args, **kwargs):
        pass

    def send_dtmf(self, digits: str):
        self.client.send_dtmf(digits)

    def start_ptt(self):
        if self._parrot_playback_task and not self._parrot_playback_task.done():
            self._parrot_playback_task.cancel()
        self._parrot_tx_buffer.clear()
        self._parrot_active_node = self._get_linked_echo_node()

        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        links = (getattr(rt, "asl_links", None) or []) if rt else []
        tx_nodes = [str(lk.get("node", "")).strip() for lk in links if lk.get("mode") == "*3" and lk.get("node")]
        target_node = tx_nodes[0] if tx_nodes else (getattr(rt, "connected_node", None) or (links[0].get("node") if links else None))
        if target_node:
            self._active_asl_node = str(target_node)
            self._last_asl_node = str(target_node)
            if rt:
                rt._active_asl_node = str(target_node)
                rt._last_asl_node = str(target_node)
        self.client.start_ptt()

    def stop_ptt(self):
        if self._tx_ready_task and not self._tx_ready_task.done():
            self._tx_ready_task.cancel()
        self.client.stop_ptt()
        rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
        if self._active_asl_node:
            self._last_asl_node = str(self._active_asl_node)
        self._active_asl_node = ""
        if rt:
            rt._active_asl_node = ""
            if self._last_asl_node:
                rt._last_asl_node = self._last_asl_node
        if self._parrot_active_node == "1999" and len(self._parrot_tx_buffer) >= 4800:
            recorded_pcm = bytes(self._parrot_tx_buffer)
            self._parrot_tx_buffer.clear()
            self._parrot_active_node = None
            try:
                loop = asyncio.get_running_loop()
                self._parrot_playback_task = loop.create_task(self._play_parrot_buffer(recorded_pcm, "1999"))
            except Exception as e:
                logger.debug(f"[ALLSTAR] Parrot playback schedule error: {e}")
        else:
            self._parrot_tx_buffer.clear()
            self._parrot_active_node = None

    def send_tx_audio_chunk(self, pcm_chunk: bytes, from_macro: bool = False):
        if self._dtmf_macro_in_progress and not from_macro:
            return
        if self._parrot_active_node == "1999" and pcm_chunk and len(self._parrot_tx_buffer) < 960000:
            self._parrot_tx_buffer.extend(pcm_chunk)
        self.client.send_tx_audio_chunk(pcm_chunk)

    async def execute_dtmf_macro(self, digits: str, notify_cb=None) -> dict:
        clean_digits = "".join(ch.upper() for ch in str(digits or "") if ch.upper() in DTMF_FREQS)
        if not clean_digits:
            return {"status": "error", "reason": "empty_digits"}
        if not self.client or self.client.state != "ACTIVE":
            return {"status": "error", "reason": "not_connected"}

        async with self._dtmf_macro_lock:
            was_already_tx = bool(self.client.is_tx)
            self._dtmf_macro_in_progress = True
            try:
                if not was_already_tx:
                    self.start_ptt()
                    if notify_cb:
                        await notify_cb("tx_start", clean_digits)
                    try:
                        if hasattr(self.client, "tx_key_ack_event"):
                            await asyncio.wait_for(self.client.tx_key_ack_event.wait(), timeout=0.6)
                    except (asyncio.TimeoutError, Exception):
                        pass
                    await asyncio.sleep(0.35)
                else:
                    if notify_cb:
                        await notify_cb("tx_inject", clean_digits)

                for ch in clean_digits:
                    self.client.send_dtmf(ch)
                    frames = generate_dtmf_pcm16_frames(ch, tone_ms=100, pause_ms=60)
                    for frame in frames:
                        self.send_tx_audio_chunk(frame, from_macro=True)
                        await asyncio.sleep(0.02)

                if not was_already_tx:
                    await asyncio.sleep(0.15)
                    self.stop_ptt()
                    if notify_cb:
                        await notify_cb("tx_stop", clean_digits)
                else:
                    if notify_cb:
                        await notify_cb("tx_inject_done", clean_digits)

                return {"status": "ok", "digits": clean_digits, "auto_tx": not was_already_tx}
            finally:
                self._dtmf_macro_in_progress = False

    def _on_asl_state_change(self, new_state: str):
        try:
            from dmr.homebrew import BMState
            if new_state == "ACTIVE":
                self.manager._on_client_status(self.hotspot_id, BMState.ONLINE, "AllStarLink IAX2 активен", user_id=self.user_id)
            elif new_state == "CONNECTING":
                self.manager._on_client_status(self.hotspot_id, BMState.CONNECTING, "Подключение к AllStarLink...", user_id=self.user_id)
            else:
                self.manager._on_client_status(self.hotspot_id, BMState.DISCONNECTED, "Отключен", user_id=self.user_id)
        except Exception as e:
            logger.error(f"[ALLSTAR-ADAPTER] State change notification error: {e}")

    async def _poll_active_rx_links(self, initial_call_id: str):
        """
        Polls RPT_ALINKS non-blockingly in thread executor during RX to detect talking node switches.
        Runs at 0.15s, then every 1.5s while client.is_rx is True.
        """
        try:
            from asl_container_manager import asl_container_mgr
            loop = asyncio.get_running_loop()
            await asyncio.sleep(0.15)
            first_poll = True

            while self.client.is_rx and self._active_asl_call_id == initial_call_id:
                rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
                own_n = str(getattr(rt.config, "allstar_node", "1999") if rt else self.client.node).strip()

                live_links = await loop.run_in_executor(
                    None, asl_container_mgr.get_connected_links, str(self.user_id), own_n
                )
                if not self.client.is_rx or self._active_asl_call_id != initial_call_id:
                    break

                if rt is not None and live_links:
                    rt.asl_links = live_links

                keyed_nodes = []
                for lk in (live_links or []):
                    if lk.get("keyed") and lk.get("node"):
                        keyed_nodes.append(str(lk["node"]).strip())

                if keyed_nodes:
                    keyed_node = keyed_nodes[0]
                    call_dur = time.time() - (self._active_asl_start_ts or time.time())
                    if first_poll and call_dur < 2.5 and keyed_node != self._active_asl_node:
                        # Refine talking node metadata for current call early on
                        self._active_asl_node = keyed_node
                        from allstar_directory import allstar_dir_mgr
                        info = allstar_dir_mgr.get_node_info(keyed_node)
                        self._active_asl_info = info
                        src_callsign = info.get("callsign") or f"Node {keyed_node}"
                        src_name = info.get("name") or src_callsign
                        talker_alias = f"{src_callsign} · {info.get('city', '')}".strip(" ·")
                        active_calls = self.manager._get_user_active_calls(self.user_id)
                        call_key = f"{self.hotspot_id}_1"
                        cur_call = active_calls.get(call_key)
                        if cur_call and cur_call.id == initial_call_id:
                            cur_call.src_id = int(keyed_node) if keyed_node.isdigit() else 1999
                            cur_call.src_callsign = src_callsign
                            cur_call.src_name = src_name
                            cur_call.talker_alias = talker_alias
                            cur_call.city = info.get("city", "")
                            cur_call.country = info.get("country", "")

                        self.manager._notify_async({
                            "type": "caller_resolved",
                            "hotspot_id": self.hotspot_id,
                            "slot": 1,
                            "call_id": initial_call_id,
                            "src_id": int(keyed_node) if keyed_node.isdigit() else 1999,
                            "src_callsign": src_callsign,
                            "src_name": src_name,
                            "talker_alias": talker_alias,
                            "user_id": self.user_id,
                        }, user_id=self.user_id)
                    elif call_dur >= 2.5 and keyed_node != self._active_asl_node:
                        # Another node keyed up without pause: split call
                        self._split_call_on_node_change(keyed_node)
                        break

                first_poll = False
                await asyncio.sleep(1.5)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"[ALLSTAR] Background links poll error: {e}")

    async def _deferred_finalize_or_discard(self, call_id: str, target_call: Any, is_empty_kerchunk: bool):
        """
        Waits 2.8s for Re-key Merge. If speech does not resume within 2.8s,
        safely finalizes audio recording & transcription or discards empty kerchunk.
        """
        try:
            await asyncio.sleep(5.0)
            # If call was resumed via Re-key Merge, do nothing
            if self._active_asl_call_id == call_id:
                return

            # Check if this call was an empty kerchunk / courtesy tone / squelch tail
            dur = getattr(target_call, "duration", 0) if target_call else 0.0
            has_tx = bool(target_call and target_call.transcription)
            if is_empty_kerchunk and dur < 2.5 and not has_tx:
                logger.info(f"[ALLSTAR] Deferred discard of empty kerchunk [{call_id}] (dur={dur}s)")
                call_history = self.manager._get_user_call_history(self.user_id)
                call_history[:] = [c for c in call_history if c.id != call_id]
                self.manager._history_dirty.add(self.user_id)
                self.manager._save_calls_history(self.user_id)
                if hasattr(self.manager, "recorder") and self.manager.recorder:
                    if hasattr(self.manager.recorder, "discard_rx_call"):
                        self.manager.recorder.discard_rx_call(self.hotspot_id, 1, call_id=call_id)
                self.manager._notify_async({
                    "type": "calls_deleted",
                    "call_ids": [call_id],
                    "user_id": self.user_id,
                }, user_id=self.user_id)
                self.manager._notify_async({
                    "type": "dmr_activity",
                    "hotspot_id": self.hotspot_id,
                    "slot": 1,
                    "active": False,
                    "call_id": call_id,
                    "discard": True,
                    "user_id": self.user_id,
                    "network_type": "allstar",
                    "node": self._active_asl_node or self.client.node,
                }, user_id=self.user_id)
                return

            # Valid voice call: finalize recorder and transcriber now that re-key merge window has closed
            logger.info(f"[ALLSTAR] Finalizing voice call recording [{call_id}] (dur={dur}s)")
            if hasattr(self.manager, "recorder") and self.manager.recorder:
                self.manager.recorder.on_rx_call_ended(self.hotspot_id, 1, call_id=call_id)
            if self.manager.transcriber and self.manager.transcriber.is_slot_enabled(self.hotspot_id, 1):
                self.manager.transcriber.on_call_ended(self.hotspot_id, 1, call_id=call_id)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.debug(f"[ALLSTAR] Deferred finalize/discard error: {e}")

    def _on_asl_carrier_change(self, is_rx: bool):
        try:
            rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
            now_ts = time.time()

            if is_rx:
                if self._forced_echo_node:
                    conn_node = self._forced_echo_node
                    keyed_nodes = [self._forced_echo_node]
                else:
                    conn_node = getattr(rt, "connected_node", None) if rt else None
                    keyed_nodes = []
                    cached_links = (getattr(rt, "asl_links", None) or []) if rt else []
                    for lk in cached_links:
                        if lk.get("keyed") and lk.get("node"):
                            keyed_nodes.append(str(lk["node"]).strip())
                    if keyed_nodes:
                        conn_node = keyed_nodes[0]
                    elif cached_links and (not conn_node or conn_node == "0"):
                        conn_node = str(cached_links[0].get("node") or "")

                if not conn_node or conn_node == "0":
                    conn_node = str(getattr(rt.config, "allstar_node", "1999") if rt else self.client.node)

                from allstar_directory import allstar_dir_mgr
                fb_call = getattr(rt.config, "callsign", "") if rt else ""
                node_info = allstar_dir_mgr.get_node_info(conn_node, fallback_callsign=fb_call)
                self._active_asl_info = node_info
                self._active_asl_node = conn_node
                self._last_asl_node = conn_node
                self._active_asl_start_ts = now_ts
                if rt:
                    rt._active_asl_node = conn_node
                    rt._last_asl_node = conn_node

                node_id_int = int(conn_node) if str(conn_node).isdigit() else 1999
                active_calls = self.manager._get_user_active_calls(self.user_id)
                call_history = self.manager._get_user_call_history(self.user_id)
                call_key = f"{self.hotspot_id}_1"

                # Every transmission in AllStarLink is a distinct call (no re-key merge across correspondents)
                is_rekey_merge = False
                self._accumulated_voice_sec = 0.0
                if self.client:
                    self.client.voice_frames_count = max(1, getattr(self.client, "_consecutive_voice_frames", 1))
                    self.client._zcr_samples.clear()
                    self.client._rms_samples.clear()

                if self._last_ended_node_id == node_id_int and (now_ts - self._last_ended_time < 60.0):
                    # Alternate dialogue turn when multiple operators speak through the same repeater
                    self._dialogue_speaker_turn = 2 if self._dialogue_speaker_turn == 1 else 1
                else:
                    self._dialogue_speaker_turn = 1

                call_id = f"asl_{int(now_ts * 1000)}_{conn_node}"
                self._active_asl_call_id = call_id

                src_callsign = node_info.get("callsign") or f"Node {conn_node}"
                city = node_info.get("city") or ""
                flag = node_info.get("flag") or "🌐"
                country = node_info.get("country") or "INT"
                src_name = node_info.get("name") or src_callsign
                talker_alias = f"{src_callsign} · {city}" if city else src_callsign
                source_type = "VoIP"

                if rt:
                    rt.ts1.active = True
                    rt.ts1.src_id = node_id_int
                    rt.ts1.src_callsign = src_callsign
                    rt.ts1.src_name = src_name
                    rt.ts1.talker_alias = talker_alias
                    rt.ts1.last_seen = now_ts

                if not is_rekey_merge:
                    from dmr.manager import CallLogEntry
                    new_call = CallLogEntry(
                        id=call_id,
                        timestamp=now_ts,
                        hotspot_id=self.hotspot_id,
                        slot=1,
                        src_id=node_id_int,
                        src_callsign=src_callsign,
                        src_name=src_name,
                        talker_alias=talker_alias,
                        dst_id=int(self.client.node) if str(self.client.node).isdigit() else 1999,
                        dst_name=f"Node {self.client.node}",
                        city=city,
                        country=country,
                        call_type="RX",
                        active=True,
                        network_type="allstar",
                        source_type=source_type,
                    )
                    active_calls[call_key] = new_call
                    call_history.insert(0, new_call)
                    self.manager.prune_calls(user_id=self.user_id)

                    if hasattr(self.manager, "recorder") and self.manager.recorder:
                        rx_key = f"{str(self.hotspot_id).strip().lower()}_1"
                        active_buf = self.manager.recorder._rx_buffers.get(rx_key)
                        if active_buf:
                            active_buf.call_id = call_id
                            active_buf.is_auto_id = False
                            if src_callsign and not active_buf.src_callsign:
                                active_buf.src_callsign = src_callsign
                            if src_name and not active_buf.src_name:
                                active_buf.src_name = src_name
                            if talker_alias and not active_buf.talker_alias:
                                active_buf.talker_alias = talker_alias
                else:
                    new_call = active_calls.get(call_key)

                # Broadcast dmr_activity
                self.manager._notify_async({
                    "type": "dmr_activity",
                    "hotspot_id": self.hotspot_id,
                    "slot": 1,
                    "src_id": node_id_int,
                    "src_callsign": src_callsign,
                    "src_name": src_name,
                    "talker_alias": talker_alias,
                    "caller_display": f"{flag} {src_callsign}",
                    "city": city,
                    "country": country,
                    "dst_id": int(self.client.node) if str(self.client.node).isdigit() else 1999,
                    "dst_name": f"Node {self.client.node}",
                    "call_type": "RX",
                    "active": True,
                    "call_entry": new_call.to_dict() if new_call else None,
                    "user_id": self.user_id,
                    "network_type": "allstar",
                    "flag": flag,
                    "source_type": source_type,
                    "node": str(conn_node),
                    "rtt": getattr(self.client, "current_rtt_ms", 0),
                    "jitter": getattr(self.client, "current_jitter_ms", 0),
                }, user_id=self.user_id)

                self.manager._notify_async({
                    "type": "allstar_carrier",
                    "hotspot_id": self.hotspot_id,
                    "is_rx": True,
                    "node": str(conn_node),
                    "keyed_nodes": keyed_nodes,
                    "callsign": src_callsign,
                    "city": city,
                    "country": country,
                    "flag": flag,
                    "source_type": source_type,
                    "user_id": self.user_id,
                }, user_id=self.user_id)

                if not self._forced_echo_node:
                    if self._rx_alinks_poll_task and not self._rx_alinks_poll_task.done():
                        self._rx_alinks_poll_task.cancel()
                    self._rx_alinks_poll_task = asyncio.create_task(self._poll_active_rx_links(call_id))

            else:
                # RX Carrier Unkeyed
                if rt:
                    rt.ts1.active = False

                active_calls = self.manager._get_user_active_calls(self.user_id)
                call_key = f"{self.hotspot_id}_1"
                active_call = active_calls.pop(call_key, None)
                duration = 0.0

                # Voice profile inspection with accumulated voice duration across re-key merges
                profile = self.client.get_current_voice_profile() if self.client else {}
                chunk_voice_sec = profile.get("voice_sec", 0.0)
                self._accumulated_voice_sec = round(max(self._accumulated_voice_sec, chunk_voice_sec), 2)
                voice_sec = self._accumulated_voice_sec

                if active_call:
                    active_call.active = False
                    total_dur = round(now_ts - active_call.timestamp, 1)
                    active_call.duration = max(0.1, max(total_dur, round(voice_sec, 1)))
                    duration = active_call.duration

                call_id = active_call.id if active_call else (self._active_asl_call_id or "")

                # Record metadata for potential re-key merge
                self._last_ended_call_id = call_id or None
                self._last_ended_node_id = int(self._active_asl_node) if str(self._active_asl_node).isdigit() else 1999
                self._last_ended_time = now_ts
                self._last_voice_profile = profile

                # Determine minimum duration from recorder settings (or default to 3.0s, 0.4s for Parrot 1999)
                is_echo_call = str(self._active_asl_node or "") in ("1999", "9999")
                min_dur = 0.4 if is_echo_call else 3.0
                if not is_echo_call and hasattr(self.manager, "recorder") and self.manager.recorder:
                    min_dur = float(getattr(self.manager.recorder, "min_duration_sec", 3.0) or 3.0)

                # Skip/discard short transmissions (< min_dur) unless transcription already captured text
                is_discard = (duration < min_dur) and not (active_call and active_call.transcription)

                info = self._active_asl_info or {}

                if is_discard:
                    logger.info(f"[ALLSTAR] Discarding short transmission [{call_id}] ({duration:.1f}s < min_dur {min_dur:.1f}s)")
                    call_history = self.manager._get_user_call_history(self.user_id)
                    call_history[:] = [c for c in call_history if c.id != call_id]
                    self.manager._history_dirty.add(self.user_id)
                    self.manager._save_calls_history(self.user_id)
                    if hasattr(self.manager, "recorder") and self.manager.recorder:
                        if hasattr(self.manager.recorder, "discard_rx_call"):
                            self.manager.recorder.discard_rx_call(self.hotspot_id, 1, call_id=call_id)
                    self.manager._notify_async({
                        "type": "calls_deleted",
                        "call_ids": [call_id],
                        "user_id": self.user_id,
                    }, user_id=self.user_id)
                    self.manager._notify_async({
                        "type": "dmr_activity",
                        "hotspot_id": self.hotspot_id,
                        "slot": 1,
                        "active": False,
                        "call_id": call_id,
                        "duration": round(duration, 1),
                        "discard": True,
                        "user_id": self.user_id,
                        "network_type": "allstar",
                        "node": self._active_asl_node or (self.client.node if self.client else ""),
                        "callsign": info.get("callsign", ""),
                        "city": info.get("city", ""),
                        "flag": info.get("flag", "🌐"),
                        "source_type": "VoIP",
                    }, user_id=self.user_id)
                    self.manager._notify_async({
                        "type": "allstar_carrier",
                        "hotspot_id": self.hotspot_id,
                        "is_rx": False,
                        "node": self._active_asl_node or (self.client.node if self.client else ""),
                        "keyed_nodes": [],
                        "callsign": info.get("callsign", ""),
                        "city": info.get("city", ""),
                        "flag": info.get("flag", "🌐"),
                        "source_type": "VoIP",
                        "duration": round(duration, 1),
                        "user_id": self.user_id,
                    }, user_id=self.user_id)
                else:
                    logger.info(f"[ALLSTAR] Finalizing voice call recording [{call_id}] ({duration:.1f}s >= min_dur {min_dur:.1f}s)")
                    if active_call:
                        self.manager._history_dirty.add(self.user_id)
                        self.manager._save_calls_history(self.user_id)

                    # Flush any remaining coalesced tail audio (< 960 bytes)
                    if rt and hasattr(rt, "asl_rx_pcm_accum") and rt.asl_rx_pcm_accum:
                        tail = bytes(rt.asl_rx_pcm_accum)
                        rt.asl_rx_pcm_accum.clear()
                        if len(tail) % 2 != 0:
                            tail += b"\x00"
                        if tail:
                            self._process_coalesced_rx_chunk(rt, tail)

                    if hasattr(self.manager, "recorder") and self.manager.recorder:
                        self.manager.recorder.on_rx_call_ended(self.hotspot_id, 1, call_id=call_id)
                    if self.manager.transcriber and self.manager.transcriber.is_slot_enabled(self.hotspot_id, 1):
                        self.manager.transcriber.on_call_ended(self.hotspot_id, 1, call_id=call_id)

                    dmr_act_payload = {
                        "type": "dmr_activity",
                        "hotspot_id": self.hotspot_id,
                        "slot": 1,
                        "active": False,
                        "call_id": call_id,
                        "duration": round(duration, 1),
                        "discard": False,
                        "user_id": self.user_id,
                        "network_type": "allstar",
                        "node": self._active_asl_node or (self.client.node if self.client else ""),
                        "callsign": info.get("callsign", ""),
                        "city": info.get("city", ""),
                        "flag": info.get("flag", "🌐"),
                        "source_type": "VoIP",
                    }
                    carrier_payload = {
                        "type": "allstar_carrier",
                        "hotspot_id": self.hotspot_id,
                        "is_rx": False,
                        "node": self._active_asl_node or (self.client.node if self.client else ""),
                        "keyed_nodes": [],
                        "callsign": info.get("callsign", ""),
                        "city": info.get("city", ""),
                        "flag": info.get("flag", "🌐"),
                        "source_type": "VoIP",
                        "duration": round(duration, 1),
                        "user_id": self.user_id,
                    }
                    self.manager._notify_call_ended(
                        self.user_id,
                        rt,
                        1,
                        dmr_act_payload,
                        extra_cb=lambda: self.manager._notify_async(carrier_payload, user_id=self.user_id)
                    )

                self._active_asl_call_id = None
                if self._active_asl_node:
                    self._last_asl_node = str(self._active_asl_node)
                self._active_asl_node = ""
                if rt:
                    rt._active_asl_node = ""
                    if self._last_asl_node:
                        rt._last_asl_node = self._last_asl_node
        except Exception as e:
            logger.error(f"[ALLSTAR-ADAPTER] Carrier change error: {e}", exc_info=True)

    def _process_coalesced_rx_chunk(self, rt, chunk_960: bytes):
        rt.ts1.last_seen = time.time()
        # Apply AGC if enabled
        if hasattr(rt, "agc") and rt.agc and rt.agc.enabled:
            chunk_960 = rt.agc.process_burst(chunk_960, slot=1)
        # Apply equalizer if enabled
        if hasattr(rt, "equalizer") and rt.equalizer:
            chunk_960 = rt.equalizer.process_burst(chunk_960, slot=1)

        hid_bytes = self.hotspot_id.encode("utf-8")
        tagged_audio = bytes([1, len(hid_bytes)]) + hid_bytes + chunk_960
        self.manager._enqueue_or_send_rx_audio(self.user_id, rt, 1, tagged_audio)

        # Route to transcriber if enabled
        if self.manager.transcriber and self.manager.transcriber.is_slot_enabled(self.hotspot_id, 1):
            active_n = str(self._active_asl_node or (self.client.node if self.client else 1999))
            node_id = int(active_n) if active_n.isdigit() else 1999
            active_cs = (self._active_asl_info or {}).get("callsign") or f"Node {active_n}"
            voice_prof = self.client.get_current_voice_profile() if self.client else {}
            self.manager.transcriber.feed_audio(
                self.hotspot_id,
                1,
                node_id,
                active_cs,
                chunk_960,
                call_id=self._active_asl_call_id or "",
                speaker_turn=self._dialogue_speaker_turn,
                acoustic_pitch=voice_prof.get("pitch", "medium")
            )

        # Route to recorder if active
        if hasattr(self.manager, "recorder") and self.manager.recorder:
            if (self.client and self.client.is_rx) or self._active_asl_call_id:
                conn_node = self._active_asl_node or (self.client.node if self.client else 1999)
                node_id = int(conn_node) if str(conn_node).isdigit() else 1999
                auto_rec = getattr(rt.config, "auto_record", True) if rt else True
                info = self._active_asl_info or {}
                src_callsign = info.get("callsign") or f"Node {conn_node}"
                src_name = info.get("name") or "AllStarLink"
                talker_alias = f"{info.get('flag', '🌐')} {src_callsign}"
                self.manager.recorder.feed_rx(
                    hotspot_id=self.hotspot_id,
                    slot=1,
                    src_id=node_id,
                    src_callsign=src_callsign,
                    src_name=src_name,
                    talker_alias=talker_alias,
                    dst_id=int(self.client.node) if (self.client and str(self.client.node).isdigit()) else 1999,
                    pcm_bytes=chunk_960,
                    call_id=self._active_asl_call_id or "",
                    user_id=self.user_id,
                    auto_record=auto_rec,
                )

    def _on_asl_rx_audio(self, pcm16: bytes, rms: float):
        try:
            # Apply CTCSS High-Pass Filter (< 300 Hz) to eliminate subaudible tone hum (67-254 Hz)
            if self.ctcss_filter_enabled and self._ctcss_biquad and pcm16:
                sample_count = len(pcm16) // 2
                samples = struct.unpack(f"<{sample_count}h", pcm16)
                bf = self._ctcss_biquad
                filtered = [int(max(-32768.0, min(32767.0, bf.process_sample(float(s))))) for s in samples]
                pcm16 = struct.pack(f"<{sample_count}h", *filtered)

            rt = self.manager.get_runtime(self.user_id, self.hotspot_id)
            if not rt:
                return

            if not hasattr(rt, "asl_rx_pcm_accum"):
                rt.asl_rx_pcm_accum = bytearray()

            rt.asl_rx_pcm_accum.extend(pcm16)
            while len(rt.asl_rx_pcm_accum) >= 960:
                chunk_960 = bytes(rt.asl_rx_pcm_accum[:960])
                del rt.asl_rx_pcm_accum[:960]
                self._process_coalesced_rx_chunk(rt, chunk_960)
        except Exception as e:
            logger.debug(f"[ALLSTAR-ADAPTER] RX audio processing error: {e}")

