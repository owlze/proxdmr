"""
M17 Binary Protocol Framing & Base-40 Callsign Encoding/Decoding.
Stateless helpers for M17 UDP control packets (CONN, LSTN, ACKN, NACK, PING, PONG, DISC)
and 54-byte voice stream frames (Magic 'M17 ', SID, LICH, FN, 16B Payload, CRC-16/M17).
"""

import re
import struct
from typing import Optional

M17_ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-/."
M17_ALPHABET_MAP = {ch: idx for idx, ch in enumerate(M17_ALPHABET)}
M17_BROADCAST_RAW = b"\xff\xff\xff\xff\xff\xff"
M17_MAGIC = b"M17 "


def m17_crc16(data: bytes) -> int:
    """CRC-16/M17: poly=0x5935, init=0xFFFF, xorout=0x0000, MSB-first (no reflection)."""
    crc = 0xFFFF
    for b in data:
        crc ^= (b << 8)
        for _ in range(8):
            if crc & 0x8000:
                crc = ((crc << 1) ^ 0x5935) & 0xFFFF
            else:
                crc = (crc << 1) & 0xFFFF
    return crc & 0xFFFF


def encode_m17_callsign(text: str) -> bytes:
    """Encode callsign / designator (up to 9 chars) to 6-byte big-endian Base-40."""
    raw = str(text or "").strip().upper()
    if raw == "@ALL" or raw == "ALL":
        return M17_BROADCAST_RAW
    if not raw:
        return b"\x00" * 6
    s = raw[:9]
    val = 0
    for ch in reversed(s):
        idx = M17_ALPHABET_MAP.get(ch, 0)
        val = val * 40 + idx
    return val.to_bytes(6, "big")


def decode_m17_callsign(raw6: bytes) -> str:
    """Decode 6-byte big-endian Base-40 callsign."""
    if not raw6 or len(raw6) < 6:
        return ""
    b6 = raw6[:6]
    if b6 == M17_BROADCAST_RAW:
        return "@ALL"
    val = int.from_bytes(b6, "big")
    if val == 0:
        return ""
    chars = []
    while val > 0 and len(chars) < 9:
        chars.append(M17_ALPHABET[val % 40])
        val //= 40
    return "".join(chars).rstrip()


def format_m17_client_callsign(callsign: str, suffix: str = "D") -> str:
    """Format client callsign with optional 1-char suffix at 9th position (e.g. 'R1ABC   D')."""
    base = re.sub(r"[^A-Z0-9\-/.]", "", str(callsign or "N0CALL").strip().upper()) or "N0CALL"
    suf = re.sub(r"[^A-Z0-9]", "", str(suffix or "").strip().upper())[:1]
    if suf:
        return base[:8].ljust(8) + suf
    return base[:9]


def normalize_m17_module(module: str, default: str = "C") -> str:
    m = re.sub(r"[^A-Z]", "", str(module or default).strip().upper())
    return m[0] if m else default


def format_m17_reflector_dst(designator: str, module: str) -> str:
    """Format reflector DST (8-char padded designator + 1-char module, e.g. 'M17-M17 C')."""
    des = str(designator or "M17-M17").strip().upper()[:8]
    mod = normalize_m17_module(module, "C")
    return des.ljust(8) + mod


def build_conn_packet(client_cs: str, module: str) -> bytes:
    mod_b = normalize_m17_module(module, "C").encode("ascii")[:1]
    return b"CONN" + encode_m17_callsign(client_cs) + mod_b


def build_lstn_packet(client_cs: str, module: str) -> bytes:
    mod_b = normalize_m17_module(module, "C").encode("ascii")[:1]
    return b"LSTN" + encode_m17_callsign(client_cs) + mod_b


def build_pong_packet(client_cs: str) -> bytes:
    return b"PONG" + encode_m17_callsign(client_cs)


def build_disc_packet(client_cs: str) -> bytes:
    return b"DISC" + encode_m17_callsign(client_cs)


def build_m17_stream_packet(
    stream_id: int,
    dst_callsign: str,
    src_callsign: str,
    fn: int,
    payload16: bytes,
    is_eot: bool = False,
    codec_mode: str = "3200",
    can: int = 0,
    meta_text: str = "",
) -> bytes:
    """Build 54-byte M17 UDP voice stream frame with CRC-16/M17."""
    sid = int(stream_id) & 0xFFFF
    dst6 = encode_m17_callsign(dst_callsign)
    src6 = encode_m17_callsign(src_callsign)

    # Bit 0 = 1 (stream); bits 1..2: 2 (3200) or 3 (1600); bits 3..4 = 0 (no enc);
    # bits 5..6 = 0 (text meta); bits 7..10 = CAN (0..15)
    data_type = 3 if str(codec_mode) == "1600" else 2
    can_val = max(0, min(15, int(can or 0)))
    type_val = 1 | (data_type << 1) | (can_val << 7)

    meta_raw = str(meta_text or "").strip().encode("utf-8", errors="ignore")[:14].ljust(14, b"\x00")
    fn_val = (int(fn) & 0x7FFF) | (0x8000 if is_eot else 0)
    pay = (payload16 or b"")[:16].ljust(16, b"\x00")

    body = struct.pack(">4sH", M17_MAGIC, sid) + dst6 + src6 + struct.pack(">H", type_val) + meta_raw + struct.pack(">H", fn_val) + pay
    crc = m17_crc16(body)
    return body + struct.pack(">H", crc)


def _clean_meta_text(raw14: bytes) -> str:
    txt = raw14.split(b"\x00", 1)[0].decode("utf-8", errors="ignore")
    cleaned = "".join(ch for ch in txt if ch.isprintable() and ch not in ("\r", "\n", "\t")).strip()
    return cleaned


def parse_m17_stream_packet(data: bytes) -> Optional[dict]:
    """
    Parse 54-byte M17 UDP voice stream frame.
    Tolerates zero/mismatched CRC on RX because transcoding reflectors (urfd/xlxd)
    often rewrite LICH and leave CRC16 = 0x0000.
    """
    if not data or len(data) < 54 or data[:4] != M17_MAGIC:
        return None

    sid = struct.unpack(">H", data[4:6])[0]
    dst = decode_m17_callsign(data[6:12])
    src = decode_m17_callsign(data[12:18])
    type_val = struct.unpack(">H", data[18:20])[0]
    meta_raw = data[20:34]
    fn_raw = struct.unpack(">H", data[34:36])[0]
    payload16 = data[36:52]
    crc_rx = struct.unpack(">H", data[52:54])[0]

    stream_flag = bool(type_val & 0x0001)
    data_type = (type_val >> 1) & 0x03
    enc_type = (type_val >> 3) & 0x03
    meta_subtype = (type_val >> 5) & 0x03
    can = (type_val >> 7) & 0x0F

    codec_mode = "1600" if data_type == 3 else "3200"
    encrypted = enc_type != 0
    fn = fn_raw & 0x7FFF
    is_eot = bool(fn_raw & 0x8000)

    meta_text = ""
    ext_cf1 = ""
    ext_cf2 = ""
    if not encrypted:
        if meta_subtype == 0:
            meta_text = _clean_meta_text(meta_raw)
        elif meta_subtype == 2:
            ext_cf1 = decode_m17_callsign(meta_raw[0:6])
            ext_cf2 = decode_m17_callsign(meta_raw[6:12])

    return {
        "stream_id": sid,
        "dst": dst,
        "src": src,
        "type_val": type_val,
        "stream_flag": stream_flag,
        "data_type": data_type,
        "codec_mode": codec_mode,
        "enc_type": enc_type,
        "encrypted": encrypted,
        "meta_subtype": meta_subtype,
        "can": can,
        "fn": fn,
        "is_eot": is_eot,
        "payload16": payload16,
        "crc_rx": crc_rx,
        "meta_text": meta_text,
        "ext_cf1": ext_cf1,
        "ext_cf2": ext_cf2,
    }
