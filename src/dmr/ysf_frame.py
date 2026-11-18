"""
YSF Frame Processing, FICH FEC Codec, and VD1/VD2 AMBE+2 Extraction/Packing for ProxDMR.
Standards and reference implementation based on Jonathan G4KLX (MMDVMHost / YSFGateway).
"""

from typing import Dict, List, Optional, Tuple
import logging

logger = logging.getLogger("proxdmr.ysf_frame")

YSF_SYNC_BYTES: bytes = bytes([0xD4, 0x71, 0xC9, 0x63, 0x4D])

YSF_FI_HEADER = 0
YSF_FI_COMMUNICATIONS = 1
YSF_FI_TERMINATOR = 2
YSF_FI_TEST = 3

YSF_DT_VD_MODE1 = 0
YSF_DT_DATA_FR_MODE = 1
YSF_DT_VD_MODE2 = 2
YSF_DT_VOICE_FR_MODE = 3

# 26x4 bit interleaving table for YSF VD2 VCH (104 individual bits)
INTERLEAVE_TABLE_26_4: List[int] = [
    0,   4,   8,  12,  16,  20,  24,  28,  32,  36,  40,  44,  48,  52,  56,  60,  64,  68,  72,  76,  80,  84,  88,  92,  96, 100,
    1,   5,   9,  13,  17,  21,  25,  29,  33,  37,  41,  45,  49,  53,  57,  61,  65,  69,  73,  77,  81,  85,  89,  93,  97, 101,
    2,   6,  10,  14,  18,  22,  26,  30,  34,  38,  42,  46,  50,  54,  58,  62,  66,  70,  74,  78,  82,  86,  90,  94,  98, 102,
    3,   7,  11,  15,  19,  23,  27,  31,  35,  39,  43,  47,  51,  55,  59,  63,  67,  71,  75,  79,  83,  87,  91,  95,  99, 103
]

# 5x20 dibit interleaving table for FICH (200 bits = 100 dibits) and VD2 DCH
INTERLEAVE_TABLE_5_20: List[int] = [
    col + row * 2 for row in range(20) for col in (0, 40, 80, 120, 160)
]

# 9x20 dibit interleaving table for Header/Terminator CSD (360 bits = 180 dibits)
INTERLEAVE_TABLE_9_20: List[int] = [
    col + row * 2 for row in range(20) for col in (0, 40, 80, 120, 160, 200, 240, 280, 320)
]

# Whitening / scrambling pseudorandom sequence (20 bytes)
WHITENING_DATA: bytes = bytes([
    0x93, 0xD7, 0x51, 0x21, 0x9C, 0x2F, 0x6C, 0xD0, 0xEF, 0x0F,
    0xF8, 0x3D, 0xF1, 0x73, 0x20, 0x94, 0xED, 0x1E, 0x7C, 0xD8,
])

_BRANCH1 = (0, 0, 0, 0, 1, 1, 1, 1)
_BRANCH2 = (0, 1, 1, 0, 0, 1, 1, 0)


def _golay23_syndrome(pattern: int) -> int:
    aux = 0x00400000
    if pattern >= 0x00000800:
        while pattern & 0xFFFFF800:
            while not (aux & pattern):
                aux >>= 1
            pattern ^= (aux // 0x00000800) * 0x00000C75
    return pattern


def _build_golay_tables() -> Tuple[List[int], Dict[int, int]]:
    enc = [0] * 4096
    for d in range(4096):
        cw23 = (d << 11) ^ _golay23_syndrome(d << 11)
        parity = cw23.bit_count() & 1
        enc[d] = (cw23 << 1) | parity

    dec: Dict[int, int] = {0: 0}
    for i in range(23):
        err = 1 << i
        dec[_golay23_syndrome(err)] = err
    for i in range(23):
        for j in range(i + 1, 23):
            err = (1 << i) | (1 << j)
            dec[_golay23_syndrome(err)] = err
    for i in range(23):
        for j in range(i + 1, 23):
            for k in range(j + 1, 23):
                err = (1 << i) | (1 << j) | (1 << k)
                dec[_golay23_syndrome(err)] = err
    return enc, dec


_GOLAY24_ENC, _GOLAY23_DEC = _build_golay_tables()


def _golay24_decode(cw24: int) -> Tuple[bool, int]:
    syn = _golay23_syndrome(cw24 >> 1)
    err = _GOLAY23_DEC.get(syn, 0) << 1
    fixed = cw24 ^ err
    valid = (syn.bit_count() < 3) or ((fixed.bit_count() & 1) == 0)
    return valid, (fixed >> 12) & 0xFFF


def _ccitt162(data_bytes: bytes) -> bytes:
    """Computes G4KLX CCITT-16-2 CRC bytes for data_bytes."""
    crc = 0x0000
    for b in data_bytes:
        val = (((crc >> 8) & 0xFF) ^ b) << 8
        for _ in range(8):
            val = ((val << 1) ^ 0x1021) & 0xFFFF if (val & 0x8000) else (val << 1) & 0xFFFF
        crc = ((crc << 8) & 0xFFFF) ^ val
    crc ^= 0xFFFF
    return bytes([(crc >> 8) & 0xFF, crc & 0xFF])


def _conv_encode(in_bytes: bytes, n_bits: int) -> bytes:
    out = bytearray((n_bits * 2 + 7) // 8)
    d1 = d2 = d3 = d4 = 0
    k = 0
    for i in range(n_bits):
        d = 1 if (in_bytes[i >> 3] & (0x80 >> (i & 7))) else 0
        g1 = (d ^ d3 ^ d4) & 1
        g2 = (d ^ d1 ^ d2 ^ d4) & 1
        d4, d3, d2, d1 = d3, d2, d1, d
        if g1:
            out[k >> 3] |= (0x80 >> (k & 7))
        k += 1
        if g2:
            out[k >> 3] |= (0x80 >> (k & 7))
        k += 1
    return bytes(out)


def _viterbi_decode(pairs: List[Tuple[int, int]], n_out_bits: int) -> bytes:
    old_m = [0] * 16
    decisions: List[int] = []
    for s0, s1 in pairs:
        new_m = [0] * 16
        dec = 0
        for i in range(8):
            j = i * 2
            met = (_BRANCH1[i] ^ s0) + (_BRANCH2[i] ^ s1)
            m0 = old_m[i] + met
            m1 = old_m[i + 8] + (2 - met)
            d0 = 1 if m0 >= m1 else 0
            new_m[j] = m1 if d0 else m0

            m0b = old_m[i] + (2 - met)
            m1b = old_m[i + 8] + met
            d1 = 1 if m0b >= m1b else 0
            new_m[j + 1] = m1b if d1 else m0b

            dec |= (d1 << (j + 1)) | (d0 << j)
        decisions.append(dec)
        old_m = new_m

    out = bytearray((n_out_bits + 7) // 8)
    state = 0
    idx = len(decisions)
    for b in range(n_out_bits - 1, -1, -1):
        idx -= 1
        bit = (decisions[idx] >> (state >> 4)) & 1
        state = ((bit << 7) | (state >> 1)) & 0xFF
        if bit:
            out[b >> 3] |= (0x80 >> (b & 7))
    return bytes(out[: n_out_bits // 8])


def _majority_vote(b0: int, b1: int, b2: int) -> int:
    """Triple repetition decoding (3,1) with majority vote."""
    return 1 if (b0 + b1 + b2 >= 2) else 0


def parse_ysf_header_and_control(data: bytes) -> dict:
    """Parses common header fields from a 155-byte YSFD packet."""
    if len(data) < 35:
        return {"valid": False, "is_eot": False}

    control_byte = data[34]
    is_eot = bool(control_byte & 0x01)
    frame_seq = (control_byte >> 1) & 0x7F

    src_call = data[14:24].decode("ascii", errors="ignore").strip()
    dst_call = data[24:34].decode("ascii", errors="ignore").strip()

    return {
        "valid": True,
        "is_eot": is_eot,
        "frame_seq": frame_seq,
        "src_call": src_call,
        "dst_call": dst_call,
    }


def decode_ysf_fich(data: bytes) -> Optional[dict]:
    """
    Decodes 25-byte FICH block (UDP bytes 40..64, right after 5-byte YSF sync)
    via deinterleaving, K=5 Viterbi, Golay(24,12,8), and CCITT-16-2 CRC verification.
    """
    if len(data) < 65:
        return None
    fich_bytes = data[40:65]

    pairs: List[Tuple[int, int]] = []
    for n in INTERLEAVE_TABLE_5_20:
        s0 = 1 if (fich_bytes[n >> 3] & (0x80 >> (n & 7))) else 0
        s1 = 1 if (fich_bytes[(n + 1) >> 3] & (0x80 >> ((n + 1) & 7))) else 0
        pairs.append((s0, s1))

    dec12 = _viterbi_decode(pairs, 96)
    words: List[int] = []
    for c in range(4):
        w24 = (dec12[c * 3] << 16) | (dec12[c * 3 + 1] << 8) | dec12[c * 3 + 2]
        ok, val12 = _golay24_decode(w24)
        if not ok:
            return None
        words.append(val12)

    m_fich = bytes([
        (words[0] >> 4) & 0xFF,
        ((words[0] << 4) & 0xF0) | ((words[1] >> 8) & 0x0F),
        words[1] & 0xFF,
        (words[2] >> 4) & 0xFF,
        ((words[2] << 4) & 0xF0) | ((words[3] >> 8) & 0x0F),
        words[3] & 0xFF,
    ])

    if _ccitt162(m_fich[:4]) != m_fich[4:6]:
        return None

    return {
        "fi": (m_fich[0] >> 6) & 0x03,
        "cm": (m_fich[0] >> 2) & 0x03,
        "bn": m_fich[0] & 0x03,
        "bt": (m_fich[1] >> 6) & 0x03,
        "fn": (m_fich[1] >> 3) & 0x07,
        "ft": m_fich[1] & 0x07,
        "dt": m_fich[2] & 0x03,
        "voip": bool(m_fich[2] & 0x04),
        "mr": (m_fich[2] >> 3) & 0x03,
        "dev": bool(m_fich[2] & 0x40),
        "dg_id": m_fich[3] & 0x7F,
    }


def encode_ysf_fich(
    fi: int = YSF_FI_COMMUNICATIONS,
    dt: int = YSF_DT_VD_MODE2,
    fn: int = 0,
    ft: int = 1,
    cm: int = 0,
    bn: int = 0,
    bt: int = 0,
    mr: int = 0,
    voip: bool = False,
    dg_id: int = 0,
) -> bytes:
    """Encodes a 25-byte YSF FICH wire block with CCITT-16-2, Golay(24,12,8), K=5 Conv, and 5x20 interleave."""
    f0 = ((fi & 0x03) << 6) | ((cm & 0x03) << 2) | (bn & 0x03)
    f1 = ((bt & 0x03) << 6) | ((fn & 0x07) << 3) | (ft & 0x07)
    f2 = (dt & 0x03) | (0x04 if voip else 0) | ((mr & 0x03) << 3)
    f3 = dg_id & 0x7F
    raw4 = bytes([f0, f1, f2, f3])
    fich6 = raw4 + _ccitt162(raw4)

    b0 = ((fich6[0] << 4) & 0xFF0) | ((fich6[1] >> 4) & 0x00F)
    b1 = ((fich6[1] << 8) & 0xF00) | (fich6[2] & 0x0FF)
    b2 = ((fich6[3] << 4) & 0xFF0) | ((fich6[4] >> 4) & 0x00F)
    b3 = ((fich6[4] << 8) & 0xF00) | (fich6[5] & 0x0FF)

    conv_in = bytearray(13)
    for idx_c, bv in enumerate((b0, b1, b2, b3)):
        cw = _GOLAY24_ENC[bv]
        conv_in[idx_c * 3:idx_c * 3 + 3] = bytes([(cw >> 16) & 0xFF, (cw >> 8) & 0xFF, cw & 0xFF])

    convolved = _conv_encode(bytes(conv_in), 100)
    wire = bytearray(25)
    j = 0
    for n in INTERLEAVE_TABLE_5_20:
        if convolved[j >> 3] & (0x80 >> (j & 7)):
            wire[n >> 3] |= (0x80 >> (n & 7))
        j += 1
        if convolved[j >> 3] & (0x80 >> (j & 7)):
            wire[(n + 1) >> 3] |= (0x80 >> ((n + 1) & 7))
        j += 1
    return bytes(wire)


def extract_ysf_vd1_ambe(data: bytes) -> List[bytes]:
    """Extracts five 9-byte (72-bit) AMBE+2 frames from a VD Mode 1 YSFD packet."""
    if len(data) < 155:
        return []
    payload = data[65:155]
    return [payload[i * 18 + 9:i * 18 + 18] for i in range(5)]


def extract_ysf_vw_frames(data: bytes, fi: int = YSF_FI_COMMUNICATIONS) -> List[bytes]:
    """Extracts 18-byte (144-bit) Full-Rate IMBE VW frames from a 155-byte YSFD packet."""
    if len(data) < 155:
        return []
    payload = data[65:155]
    if fi == YSF_FI_COMMUNICATIONS:
        return [payload[i * 18:(i + 1) * 18] for i in range(5)]
    if fi == YSF_FI_TERMINATOR:
        tail = []
        for off in (54, 72):
            chunk = payload[off:off + 18]
            if any(chunk):
                tail.append(chunk)
        return tail
    return []


def extract_ysf_vd2_ambe(data: bytes) -> List[bytes]:
    """
    Extracts 5 AMBE+2 49-bit vectors from a 155-byte YSFD packet in VD mode 2.
    """
    if len(data) < 155:
        return []

    payload = data[65:155]
    if len(payload) < 90:
        return []

    vectors: List[bytes] = []

    for j in range(5):
        start_bit = 40 + j * 144

        raw_vch: List[int] = []
        for bit_idx in range(start_bit, start_bit + 104):
            byte_pos = bit_idx >> 3
            bit_in_byte = 7 - (bit_idx & 7)
            raw_vch.append((payload[byte_pos] >> bit_in_byte) & 1)

        deint: List[int] = [raw_vch[INTERLEAVE_TABLE_26_4[i]] for i in range(104)]

        unwhitened: List[int] = []
        for i in range(104):
            wh_byte = WHITENING_DATA[i >> 3]
            wh_bit = (wh_byte >> (7 - (i & 7))) & 1
            unwhitened.append(deint[i] ^ wh_bit)

        a = [_majority_vote(unwhitened[3 * k], unwhitened[3 * k + 1], unwhitened[3 * k + 2]) for k in range(12)]
        b = [_majority_vote(unwhitened[3 * k], unwhitened[3 * k + 1], unwhitened[3 * k + 2]) for k in range(12, 24)]
        c = [_majority_vote(unwhitened[3 * k], unwhitened[3 * k + 1], unwhitened[3 * k + 2]) for k in range(24, 27)]
        u = unwhitened[81:103]

        vectors.append(bytes(a + b + c + u))

    return vectors


def encode_ysf_vd2_vch(ambe49: bytes) -> bytes:
    """Packs one 49-bit AMBE+2 vector (49 bytes of 0/1) into 13 bytes of YSF VD2 VCH."""
    buf = [0] * 104
    for i in range(27):
        bit = 1 if (i < len(ambe49) and ambe49[i]) else 0
        buf[3 * i] = bit
        buf[3 * i + 1] = bit
        buf[3 * i + 2] = bit
    for i in range(22):
        idx = 27 + i
        buf[81 + i] = 1 if (idx < len(ambe49) and ambe49[idx]) else 0
    buf[103] = 0

    for i in range(104):
        wh_byte = WHITENING_DATA[i >> 3]
        wh_bit = (wh_byte >> (7 - (i & 7))) & 1
        buf[i] ^= wh_bit

    out_bits = [0] * 104
    for i in range(104):
        out_bits[INTERLEAVE_TABLE_26_4[i]] = buf[i]

    vch = bytearray(13)
    for i in range(13):
        val = 0
        for b in range(8):
            val = (val << 1) | (out_bits[i * 8 + b] & 1)
        vch[i] = val
    return bytes(vch)


def _encode_ysf_dch10(data10: bytes) -> bytes:
    """Encodes 10 bytes of VD2 DCH into 25 interleaved bytes (5 x 5-byte DCH slots)."""
    src = (data10[:10]).ljust(10, b" ")
    whitened = bytes([src[i] ^ WHITENING_DATA[i] for i in range(10)])
    conv_in = whitened + _ccitt162(whitened) + b"\x00"
    convolved = _conv_encode(conv_in, 100)
    wire = bytearray(25)
    j = 0
    for n in INTERLEAVE_TABLE_5_20:
        if convolved[j >> 3] & (0x80 >> (j & 7)):
            wire[n >> 3] |= (0x80 >> (n & 7))
        j += 1
        if convolved[j >> 3] & (0x80 >> (j & 7)):
            wire[(n + 1) >> 3] |= (0x80 >> ((n + 1) & 7))
        j += 1
    return bytes(wire)


def _encode_ysf_fr_dch20(data20: bytes) -> bytes:
    """Encodes 20 bytes of CSD1/CSD2 (Header/Terminator) into 45 interleaved bytes."""
    src = (data20[:20]).ljust(20, b" ")
    whitened = bytes([src[i] ^ WHITENING_DATA[i] for i in range(20)])
    conv_in = whitened + _ccitt162(whitened) + b"\x00"
    convolved = _conv_encode(conv_in, 180)
    wire = bytearray(45)
    j = 0
    for n in INTERLEAVE_TABLE_9_20:
        if convolved[j >> 3] & (0x80 >> (j & 7)):
            wire[n >> 3] |= (0x80 >> (n & 7))
        j += 1
        if convolved[j >> 3] & (0x80 >> (j & 7)):
            wire[(n + 1) >> 3] |= (0x80 >> ((n + 1) & 7))
        j += 1
    return bytes(wire)


def build_ysf_vd2_packet(
    rptr_call: str,
    src_call: str,
    dst_call: str = "ALL",
    frame_seq: int = 0,
    ambe_5x49: Optional[List[bytes]] = None,
    fi: int = YSF_FI_COMMUNICATIONS,
    fn: int = 0,
    ft: int = 1,
    is_end: bool = False,
    dg_id: int = 0,
) -> bytes:
    """Builds a standard 155-byte YSFReflector YSFD UDP packet (Header, VD2 Voice, or Terminator)."""
    rptr_b = f"{(rptr_call or 'N0CALL').upper():<10.10}".encode("ascii", errors="replace")
    src_b = f"{(src_call or 'N0CALL').upper():<10.10}".encode("ascii", errors="replace")
    dst_b = f"{(dst_call or 'ALL').upper():<10.10}".encode("ascii", errors="replace")
    ctrl = ((frame_seq & 0x7F) << 1) | (0x01 if is_end else 0x00)
    udp_hdr = b"YSFD" + rptr_b + src_b + dst_b + bytes([ctrl])

    fich = encode_ysf_fich(fi=fi, dt=YSF_DT_VD_MODE2, fn=fn, ft=ft, dg_id=int(dg_id or 0) & 0x7F)

    if fi in (YSF_FI_HEADER, YSF_FI_TERMINATOR):
        csd1 = dst_b + src_b
        csd2 = rptr_b + rptr_b
        dch1 = _encode_ysf_fr_dch20(csd1)
        dch2 = _encode_ysf_fr_dch20(csd2)
        payload = bytearray(90)
        for i in range(5):
            payload[i * 18:i * 18 + 9] = dch1[i * 9:i * 9 + 9]
            payload[i * 18 + 9:i * 18 + 18] = dch2[i * 9:i * 9 + 9]
        return udp_hdr + YSF_SYNC_BYTES + fich + bytes(payload)

    dch_src = dst_b if (fn % 2 == 0) else src_b
    dch25 = _encode_ysf_dch10(dch_src)
    vectors = ambe_5x49 or []
    silence = bytes(1 if i in (0, 1, 2, 3, 37) else 0 for i in range(49))
    payload = bytearray(90)
    for i in range(5):
        payload[i * 18:i * 18 + 5] = dch25[i * 5:i * 5 + 5]
        vec = vectors[i] if i < len(vectors) and len(vectors[i]) >= 49 else silence
        payload[i * 18 + 5:i * 18 + 18] = encode_ysf_vd2_vch(vec)

    return udp_hdr + YSF_SYNC_BYTES + fich + bytes(payload)
