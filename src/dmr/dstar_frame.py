"""
dstar_frame.py - D-STAR packet framing, CRC calculation, Slow Data codec,
and DExtra/DCS/DPlus protocol encoders/decoders for ProxDMR.
"""

import struct
from typing import Optional, Tuple, List, Dict, Any

SLOW_DATA_SYNC = bytes([0x55, 0x2D, 0x16])
SLOW_DATA_MASK = bytes([0x70, 0x4F, 0x93])


def dstar_crc16(data: bytes) -> int:
    """
    Standard D-STAR FCS CRC-16/CCITT (reflected poly 0x8408, init 0xFFFF, final NOT).
    Returns 16-bit integer.
    """
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            if crc & 1:
                crc = (crc >> 1) ^ 0x8408
            else:
                crc >>= 1
    return (~crc) & 0xFFFF


def pad_callsign(call: str, length: int = 8) -> bytes:
    """Pad or truncate callsign to exactly length ASCII bytes, uppercase."""
    clean = (call or "").strip().upper()
    return clean[:length].ljust(length).encode("ascii", errors="replace")


def build_dstar_header(
    my1: str,
    my2: str = "PROX",
    urcall: str = "CQCQCQ  ",
    rpt1: str = "",
    rpt2: str = "",
    flags: bytes = b"\x00\x00\x00"
) -> bytes:
    """
    Build 41-byte D-STAR radio header:
    - flags: 3 bytes
    - rpt2: 8 bytes
    - rpt1: 8 bytes
    - urcall: 8 bytes
    - my1: 8 bytes
    - my2: 4 bytes
    - crc16: 2 bytes (little-endian)
    Total: 41 bytes.
    """
    b_flags = flags[:3].ljust(3, b"\x00")
    b_rpt2 = pad_callsign(rpt2, 8)
    b_rpt1 = pad_callsign(rpt1, 8)
    b_urcall = pad_callsign(urcall, 8)
    b_my1 = pad_callsign(my1, 8)
    b_my2 = pad_callsign(my2, 4)

    payload = b_flags + b_rpt2 + b_rpt1 + b_urcall + b_my1 + b_my2
    crc = dstar_crc16(payload)
    return payload + struct.pack("<H", crc)


def parse_dstar_header(data: bytes) -> Optional[Dict[str, Any]]:
    """
    Parse 41-byte D-STAR header and verify CRC.
    """
    if len(data) < 41:
        return None
    header = data[:41]
    crc_calc = dstar_crc16(header[:39])
    crc_recv = struct.unpack("<H", header[39:41])[0]

    flags = header[:3]
    rpt2 = header[3:11].decode("ascii", errors="replace").strip()
    rpt1 = header[11:19].decode("ascii", errors="replace").strip()
    urcall = header[19:27].decode("ascii", errors="replace").strip()
    my1 = header[27:35].decode("ascii", errors="replace").strip()
    my2 = header[35:39].decode("ascii", errors="replace").strip()

    return {
        "flags": flags,
        "rpt2": rpt2,
        "rpt1": rpt1,
        "urcall": urcall,
        "my1": my1,
        "my2": my2,
        "crc_ok": (crc_calc == crc_recv)
    }


def build_dsvt_header_packet(stream_id: int, header_41: bytes, is_dplus: bool = False) -> bytes:
    """
    Build 56-byte DSVT header packet (or 58-byte for DPlus with 0x3A 0x80 prefix).
    """
    prefix = b"\x3a\x80" if is_dplus else b""
    body = (
        b"DSVT"
        + b"\x10\x00\x00\x00\x20\x00\x01\x01"
        + struct.pack(">H", stream_id & 0xFFFF)
        + b"\x80"
        + header_41[:41].ljust(41, b"\x00")
    )
    return prefix + body


def build_dsvt_voice_frame(
    stream_id: int,
    frame_seq: int,
    ambe9: bytes,
    slow_data3: bytes = b"\x70\x4f\x93",
    is_last: bool = False,
    is_dplus: bool = False
) -> bytes:
    """
    Build 27-byte DSVT voice frame (or 29-byte for DPlus with 0x1D 0x80 prefix).
    """
    prefix = b"\x1d\x80" if is_dplus else b""
    seq_byte = (frame_seq % 21) | (0x40 if is_last else 0x00)
    body = (
        b"DSVT"
        + b"\x20\x00\x00\x00\x20\x00\x01\x01"
        + struct.pack(">H", stream_id & 0xFFFF)
        + struct.pack("B", seq_byte)
        + ambe9[:9].ljust(9, b"\x00")
        + slow_data3[:3].ljust(3, b"\x00")
    )
    return prefix + body


def parse_dsvt_packet(data: bytes) -> Optional[Dict[str, Any]]:
    """
    Parse incoming DSVT packet (DExtra or DPlus).
    Returns dict with type ("header" or "voice"), stream_id, and payload.
    """
    p = data
    if p.startswith(b"\x3a\x80") or p.startswith(b"\x1d\x80"):
        p = p[2:]

    if not p.startswith(b"DSVT") or len(p) < 15:
        return None

    pkt_type = p[4]
    stream_id = struct.unpack(">H", p[12:14])[0]

    if pkt_type == 0x10 and len(p) >= 56:
        # Header packet
        parsed_hdr = parse_dstar_header(p[15:56])
        return {
            "type": "header",
            "stream_id": stream_id,
            "header": parsed_hdr,
            "raw_header": p[15:56]
        }
    elif pkt_type == 0x20 and len(p) >= 27:
        seq_byte = p[14]
        seq = seq_byte & 0x1F
        is_last = bool(seq_byte & 0x40)
        ambe9 = p[15:24]
        slow3 = p[24:27]
        return {
            "type": "voice",
            "stream_id": stream_id,
            "seq": seq,
            "is_last": is_last,
            "ambe": ambe9,
            "slow": slow3
        }
    return None


class DStarSlowDataCodec:
    """
    D-STAR Slow Data 20-character message encoder and decoder.
    Message is split into four 5-character blocks (tags 0x40..0x43).
    Each superframe consists of 21 frames (seq 0..20).
    seq 0: sync pattern 0x55 0x2D 0x16
    seq 1..8: blocks 0..3 (2 frames per block, XORed with 0x70 0x4F 0x93)
    """

    def __init__(self, tx_text: str = ""):
        self.tx_text = tx_text[:20]
        self._rx_blocks: Dict[int, str] = {}
        self.last_decoded_text = ""

    def set_tx_text(self, text: str):
        self.tx_text = (text or "")[:20]

    def encode_frame(self, frame_seq: int) -> bytes:
        seq = frame_seq % 21
        if seq == 0:
            return SLOW_DATA_SYNC

        text = self.tx_text.ljust(20)
        if 1 <= seq <= 8:
            block_idx = (seq - 1) // 2
            is_first_half = ((seq - 1) % 2) == 0
            tag = 0x40 + block_idx
            block_str = text[block_idx * 5:(block_idx + 1) * 5]
            raw_chars = block_str.encode("ascii", errors="replace")

            if is_first_half:
                # [tag, c0, c1]
                b0 = tag
                b1 = raw_chars[0] if len(raw_chars) > 0 else 0x20
                b2 = raw_chars[1] if len(raw_chars) > 1 else 0x20
            else:
                # [c2, c3, c4]
                b0 = raw_chars[2] if len(raw_chars) > 2 else 0x20
                b1 = raw_chars[3] if len(raw_chars) > 3 else 0x20
                b2 = raw_chars[4] if len(raw_chars) > 4 else 0x20

            return bytes([
                b0 ^ SLOW_DATA_MASK[0],
                b1 ^ SLOW_DATA_MASK[1],
                b2 ^ SLOW_DATA_MASK[2]
            ])
        else:
            # Idle / null slow data
            return SLOW_DATA_MASK

    def decode_frame(self, frame_seq: int, slow3: bytes) -> Optional[str]:
        if len(slow3) < 3:
            return None
        seq = frame_seq % 21
        if slow3 == SLOW_DATA_SYNC or seq == 0:
            return None

        unmasked = bytes([
            slow3[0] ^ SLOW_DATA_MASK[0],
            slow3[1] ^ SLOW_DATA_MASK[1],
            slow3[2] ^ SLOW_DATA_MASK[2]
        ])

        tag = unmasked[0]
        if 0x40 <= tag <= 0x43:
            # Tag detected in first half of block
            block_idx = tag - 0x40
            chars_part1 = unmasked[1:3].decode("ascii", errors="replace")
            self._rx_blocks[block_idx * 2] = chars_part1
            return None
        elif 1 <= seq <= 8 and (seq % 2) == 0:
            # Second half of block
            block_idx = (seq - 1) // 2
            chars_part2 = unmasked[0:3].decode("ascii", errors="replace")
            self._rx_blocks[block_idx * 2 + 1] = chars_part2

            if all(k in self._rx_blocks for k in range(8)):
                assembled = "".join(self._rx_blocks[k] for k in range(8))
                clean_text = "".join(c for c in assembled if 32 <= ord(c) <= 126).strip()
                if clean_text:
                    self.last_decoded_text = clean_text
                    return clean_text
        return None

    def reset_rx(self):
        self._rx_blocks.clear()


# =========================================================================
# DExtra protocol helpers (UDP 30001)
# =========================================================================

def build_dextra_connect(my_call: str, local_mod: str, remote_mod: str) -> bytes:
    """
    DExtra 11-byte connect packet:
    Callsign (7 chars) + local_mod (1 char) + remote_mod (1 char) + remote_mod (1 char) + 0x00
    or callsign (8) + remote_mod (1) + 0x00 0x00.
    """
    call7 = (my_call or "").strip().upper()[:7].ljust(7)
    lmod = (local_mod or "D").strip().upper()[:1]
    rmod = (remote_mod or "A").strip().upper()[:1]
    return f"{call7}{lmod}{rmod}{rmod}\x00".encode("ascii", errors="replace")


def build_dextra_disconnect(my_call: str, local_mod: str) -> bytes:
    """DExtra 11-byte disconnect packet."""
    call7 = (my_call or "").strip().upper()[:7].ljust(7)
    lmod = (local_mod or "D").strip().upper()[:1]
    return f"{call7}{lmod}  \x00".encode("ascii", errors="replace")


def build_dextra_poll(my_call: str, local_mod: str) -> bytes:
    """DExtra keepalive poll packet (9 bytes)."""
    call7 = (my_call or "").strip().upper()[:7].ljust(7)
    lmod = (local_mod or "D").strip().upper()[:1]
    return f"{call7}{lmod}\x00".encode("ascii", errors="replace")


def is_dextra_ack(data: bytes) -> bool:
    """Verify if response is a DExtra ACK packet."""
    if len(data) >= 14 and b"ACK" in data:
        return True
    if len(data) == 11 and not data.startswith(b"\x00"):
        return True
    return False


# =========================================================================
# DCS protocol helpers (UDP 30051)
# =========================================================================

def build_dcs_connect(my_call: str, local_mod: str, reflector: str, remote_mod: str) -> bytes:
    """
    DCS connect packet (519 bytes).
    """
    call8 = pad_callsign(my_call, 8)
    lmod = (local_mod or "D").strip().upper()[:1].encode("ascii")
    rmod = (remote_mod or "A").strip().upper()[:1].encode("ascii")
    ref8 = pad_callsign(reflector, 8)
    banner = b"ProxDMR 2.9 DCS Client"

    buf = bytearray(519)
    buf[0:8] = call8
    buf[8:9] = lmod
    buf[9:10] = rmod
    buf[10:11] = b"\x00"
    buf[11:19] = ref8
    buf[19:19 + len(banner)] = banner
    return bytes(buf)


def build_dcs_disconnect(my_call: str, local_mod: str, reflector: str) -> bytes:
    """DCS disconnect packet (19 bytes)."""
    call8 = pad_callsign(my_call, 8)
    lmod = (local_mod or "D").strip().upper()[:1].encode("ascii")
    ref8 = pad_callsign(reflector, 8)
    return call8 + lmod + b"\x00 " + ref8


def build_dcs_ping(my_call: str, local_mod: str, reflector: str, remote_mod: str) -> bytes:
    """DCS keepalive ping packet (22 bytes)."""
    call7 = (my_call or "").strip().upper()[:7].ljust(7).encode("ascii")
    lmod = (local_mod or "D").strip().upper()[:1].encode("ascii")
    rmod = (remote_mod or "A").strip().upper()[:1].encode("ascii")
    ref8 = pad_callsign(reflector, 8)
    return call7 + lmod + b"\x00" + ref8 + rmod + b"\x00\x00\x00\x00\x00"


def build_dcs_voice_packet(
    my1: str,
    my2: str,
    urcall: str,
    rpt1: str,
    rpt2: str,
    stream_id: int,
    frame_seq: int,
    ambe9: bytes,
    slow3: bytes,
    pkt_counter: int,
    is_last: bool = False
) -> bytes:
    """
    Build 100-byte DCS voice packet.
    """
    buf = bytearray(100)
    buf[0:4] = b"0001"
    buf[4:7] = b"\x00\x00\x00"
    buf[7:15] = pad_callsign(rpt2, 8)
    buf[15:23] = pad_callsign(rpt1, 8)
    buf[23:31] = pad_callsign(urcall, 8)
    buf[31:39] = pad_callsign(my1, 8)
    buf[39:43] = pad_callsign(my2, 4)
    buf[43:45] = struct.pack(">H", stream_id & 0xFFFF)

    seq_byte = (frame_seq % 21) | (0x40 if is_last else 0x00)
    buf[45] = seq_byte
    buf[46:55] = ambe9[:9].ljust(9, b"\x00")
    buf[55:58] = slow3[:3].ljust(3, b"\x00")

    # 24-bit counter at offset 58
    buf[58] = pkt_counter & 0xFF
    buf[59] = (pkt_counter >> 8) & 0xFF
    buf[60] = (pkt_counter >> 16) & 0xFF
    return bytes(buf)


def parse_dcs_voice_packet(data: bytes) -> Optional[Dict[str, Any]]:
    """Parse 100-byte DCS voice packet."""
    if len(data) < 58 or not data.startswith(b"0001"):
        return None
    rpt2 = data[7:15].decode("ascii", errors="replace").strip()
    rpt1 = data[15:23].decode("ascii", errors="replace").strip()
    urcall = data[23:31].decode("ascii", errors="replace").strip()
    my1 = data[31:39].decode("ascii", errors="replace").strip()
    my2 = data[39:43].decode("ascii", errors="replace").strip()
    stream_id = struct.unpack(">H", data[43:45])[0]

    seq_byte = data[45]
    seq = seq_byte & 0x1F
    is_last = bool(seq_byte & 0x40)
    ambe = data[46:55]
    slow = data[55:58]

    return {
        "type": "dcs_voice",
        "rpt2": rpt2,
        "rpt1": rpt1,
        "urcall": urcall,
        "my1": my1,
        "my2": my2,
        "stream_id": stream_id,
        "seq": seq,
        "is_last": is_last,
        "ambe": ambe,
        "slow": slow
    }


# =========================================================================
# DPlus protocol helpers (UDP 20001)
# =========================================================================

DPLUS_INIT_STEP1 = b"\x05\x00\x18\x00\x01"
DPLUS_POLL = b"\x03\x60\x00"
DPLUS_DISCONNECT = b"\x05\x00\x18\x00\x00"


def build_dplus_auth_step2(my_call: str) -> bytes:
    """DPlus step 2 28-byte authentication packet."""
    call16 = (my_call or "").strip().upper()[:8].ljust(16, " ").encode("ascii")
    return b"\x1c\xc0\x04\x00" + call16 + b"DV019999"


def parse_dplus_auth_response(data: bytes) -> str:
    """
    Returns auth status: "OKRW" (full access), "OKRO" (read-only), "BUSY", "FAIL", or "UNKNOWN".
    """
    if b"OKRW" in data:
        return "OKRW"
    if b"OKRO" in data:
        return "OKRO"
    if b"BUSY" in data:
        return "BUSY"
    if b"FAIL" in data or b"NAK" in data:
        return "FAIL"
    return "UNKNOWN"
