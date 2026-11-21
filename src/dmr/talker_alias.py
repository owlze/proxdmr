"""
DMR Talker Alias (TA) in-band decoder for ProxDMR
Decodes ETSI TS 102 361-2 Annex B Talker Alias carried in Embedded Link Control (EMB LC).
"""

import logging
from typing import Dict, Optional

logger = logging.getLogger("proxdmr.talker_alias")

try:
    import dmr_utils3.bptc as dmr_bptc
    import dmr_utils3.decode as dmr_decode
    from bitarray import bitarray
    DMR_UTILS_AVAILABLE = True
except ImportError:
    dmr_bptc = None
    dmr_decode = None
    bitarray = None
    DMR_UTILS_AVAILABLE = False


def patch_dmr_utils_bptc():
    """
    Fixes upstream bug in dmr_utils3.bptc.encode_emblc where _binlc[24]
    was duplicated instead of using _binlc[25] in row 9 of the interleaving matrix.
    """
    if not DMR_UTILS_AVAILABLE or not hasattr(dmr_bptc, "encode_emblc"):
        return
    try:
        import dmr_utils3.crc as _crc
        import dmr_utils3.hamming as _hamming

        def _fixed_encode_emblc(_lc):
            _csum = _crc.csum5(_lc)
            _binlc = bitarray(endian="big")
            _binlc.frombytes(_lc)
            _binlc.insert(32, _csum[0])
            _binlc.insert(43, _csum[1])
            _binlc.insert(54, _csum[2])
            _binlc.insert(65, _csum[3])
            _binlc.insert(76, _csum[4])
            for index in range(0, 112, 16):
                for hindex, hbit in zip(range(index + 11, index + 16), _hamming.enc_16114(_binlc[index:index + 11])):
                    _binlc.insert(hindex, hbit)
            for index in range(0, 16):
                _binlc.insert(index + 112, _binlc[index + 0] ^ _binlc[index + 16] ^ _binlc[index + 32] ^ _binlc[index + 48] ^ _binlc[index + 64] ^ _binlc[index + 80] ^ _binlc[index + 96])
            emblc_b = bitarray(endian="big")
            emblc_b.extend([_binlc[0], _binlc[16], _binlc[32], _binlc[48], _binlc[64], _binlc[80], _binlc[96], _binlc[112]])
            emblc_b.extend([_binlc[1], _binlc[17], _binlc[33], _binlc[49], _binlc[65], _binlc[81], _binlc[97], _binlc[113]])
            emblc_b.extend([_binlc[2], _binlc[18], _binlc[34], _binlc[50], _binlc[66], _binlc[82], _binlc[98], _binlc[114]])
            emblc_b.extend([_binlc[3], _binlc[19], _binlc[35], _binlc[51], _binlc[67], _binlc[83], _binlc[99], _binlc[115]])
            emblc_c = bitarray(endian="big")
            emblc_c.extend([_binlc[4], _binlc[20], _binlc[36], _binlc[52], _binlc[68], _binlc[84], _binlc[100], _binlc[116]])
            emblc_c.extend([_binlc[5], _binlc[21], _binlc[37], _binlc[53], _binlc[69], _binlc[85], _binlc[101], _binlc[117]])
            emblc_c.extend([_binlc[6], _binlc[22], _binlc[38], _binlc[54], _binlc[70], _binlc[86], _binlc[102], _binlc[118]])
            emblc_c.extend([_binlc[7], _binlc[23], _binlc[39], _binlc[55], _binlc[71], _binlc[87], _binlc[103], _binlc[119]])
            emblc_d = bitarray(endian="big")
            emblc_d.extend([_binlc[8], _binlc[24], _binlc[40], _binlc[56], _binlc[72], _binlc[88], _binlc[104], _binlc[120]])
            emblc_d.extend([_binlc[9], _binlc[25], _binlc[41], _binlc[57], _binlc[73], _binlc[89], _binlc[105], _binlc[121]])
            emblc_d.extend([_binlc[10], _binlc[26], _binlc[42], _binlc[58], _binlc[74], _binlc[90], _binlc[106], _binlc[122]])
            emblc_d.extend([_binlc[11], _binlc[27], _binlc[43], _binlc[59], _binlc[75], _binlc[91], _binlc[107], _binlc[123]])
            emblc_e = bitarray(endian="big")
            emblc_e.extend([_binlc[12], _binlc[28], _binlc[44], _binlc[60], _binlc[76], _binlc[92], _binlc[108], _binlc[124]])
            emblc_e.extend([_binlc[13], _binlc[29], _binlc[45], _binlc[61], _binlc[77], _binlc[93], _binlc[109], _binlc[125]])
            emblc_e.extend([_binlc[14], _binlc[30], _binlc[46], _binlc[62], _binlc[78], _binlc[94], _binlc[110], _binlc[126]])
            emblc_e.extend([_binlc[15], _binlc[31], _binlc[47], _binlc[63], _binlc[79], _binlc[95], _binlc[111], _binlc[127]])
            return {1: emblc_b, 2: emblc_c, 3: emblc_d, 4: emblc_e}

        dmr_bptc.encode_emblc = _fixed_encode_emblc
        logger.debug("[TA] Patched dmr_utils3.bptc.encode_emblc successfully")
    except Exception as e:
        logger.warning(f"[TA] Failed to patch encode_emblc: {e}")

# Apply monkeypatch
patch_dmr_utils_bptc()


def build_talker_alias_blocks(alias: str) -> list:
    """
    Constructs ETSI TS 102 361-2 Annex B compliant Talker Alias 9-byte LC blocks.
    - Block 0: Opcode 4 (TA Header) with format 1 (UTF-8/ISO), length (up to 28 bytes) + first 7 bytes.
    - Blocks 1..3: Opcodes 5..7 (TA Block 1, 2, 3) carrying up to 7 bytes each.
    """
    if not alias or not alias.strip():
        return []

    raw = alias.strip().encode("utf-8")[:28]
    length = len(raw)
    if length == 0:
        return []

    blocks = []

    # Block 0: Header (opcode 4)
    # Format: 0x01 (8-bit ISO/UTF-8) shifted by 6 | length (bits 4..0)
    b0 = bytearray(9)
    b0[0] = 0x04
    b0[1] = (0x01 << 6) | (length & 0x1F)
    chunk0 = raw[:7]
    b0[2:2 + len(chunk0)] = chunk0
    blocks.append(bytes(b0))

    # Blocks 1..3 (opcodes 5, 6, 7)
    offset = 7
    for op in (5, 6, 7):
        if offset >= length:
            break
        b = bytearray(9)
        b[0] = op
        b[1] = 0x00
        chunk = raw[offset:offset + 7]
        b[2:2 + len(chunk)] = chunk
        blocks.append(bytes(b))
        offset += 7

    return blocks


class TalkerAliasSession:
    def __init__(self, stream_id: int):
        self.stream_id = stream_id
        self.embed_bits = bitarray() if bitarray else None
        self.blocks_received = set()
        self.format: int = 0  # 0=7-bit, 1=UTF-8, 2=UTF-16LE, 3=UTF-16BE
        self.expected_length: int = 0
        self.raw_data: bytearray = bytearray()
        self.completed_alias: Optional[str] = None


class TalkerAliasDecoder:
    """
    Tracks voice frames and extracts Talker Alias strings from EMB LC.
    Maintains separate sessions per timeslot.
    """

    def __init__(self):
        self.sessions: Dict[int, TalkerAliasSession] = {}  # slot -> session

    def reset_slot(self, slot: int):
        self.sessions.pop(slot, None)

    def process_frame(
        self,
        slot: int,
        stream_id: int,
        frame_type: int,
        payload: bytes,
    ) -> Optional[str]:
        """
        Process a DMR voice frame (A..F, frame_type 0..5).
        Returns decoded Talker Alias string when newly available, or None.
        """
        if not DMR_UTILS_AVAILABLE or len(payload) < 33:
            return None

        # Reset session on new stream
        sess = self.sessions.get(slot)
        if not sess or sess.stream_id != stream_id:
            sess = TalkerAliasSession(stream_id)
            self.sessions[slot] = sess

        # If already decoded for this stream, no need to re-decode
        if sess.completed_alias:
            return sess.completed_alias

        try:
            # Bursts B, C, D, E (types 1, 2, 3, 4) contain the EMB field
            # Burst A (type 0) has sync, Burst F (type 5) has signaling
            burst_dict = dmr_decode.voice(payload[:33])
            embed = burst_dict.get("EMBED")
            if embed is None:
                return None

            if frame_type == 1:  # Burst B - start of 128-bit EMB LC
                sess.embed_bits = bitarray()
                sess.embed_bits.extend(embed)
            elif frame_type in (2, 3):  # Bursts C, D
                if sess.embed_bits is not None and len(sess.embed_bits) < 128:
                    sess.embed_bits.extend(embed)
            elif frame_type == 4:  # Burst E - 4th burst, completes 128 bits
                if sess.embed_bits is not None:
                    sess.embed_bits.extend(embed)
                    if len(sess.embed_bits) == 128:
                        lc_bytes = dmr_bptc.decode_emblc(sess.embed_bits)
                        sess.embed_bits = bitarray()
                        alias = self._handle_emblc(sess, lc_bytes)
                        if alias:
                            sess.completed_alias = alias
                            return alias
        except Exception as e:
            logger.debug(f"[TA] Error decoding frame: {e}")

        return None

    def _handle_emblc(self, sess: TalkerAliasSession, lc_bytes: bytes) -> Optional[str]:
        if len(lc_bytes) < 9:
            return None

        opcode = lc_bytes[0] & 0x3F

        if opcode == 4:  # Talker Alias Header
            sess.format = (lc_bytes[1] >> 6) & 0x03
            sess.expected_length = lc_bytes[1] & 0x1F
            sess.raw_data = bytearray(lc_bytes[2:9])
            sess.blocks_received.add(0)

        elif opcode in (5, 6, 7):  # Talker Alias Blocks 1, 2, 3
            block_idx = opcode - 4
            if 0 in sess.blocks_received:  # Only append if header was seen
                sess.raw_data.extend(lc_bytes[2:9])
                sess.blocks_received.add(block_idx)

        # Check if we have gathered enough bytes
        if sess.expected_length > 0 and len(sess.raw_data) >= sess.expected_length:
            return self._decode_string(sess.format, bytes(sess.raw_data[:sess.expected_length]))

        return None

    def _decode_string(self, fmt: int, raw_bytes: bytes) -> Optional[str]:
        try:
            res = ""
            if fmt == 0:  # 7-bit ASCII
                res = raw_bytes.decode("ascii", errors="replace")
            elif fmt == 1:  # ISO-8859-1 or UTF-8
                try:
                    res = raw_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    res = raw_bytes.decode("latin1", errors="replace")
            elif fmt == 2:  # UTF-16LE
                res = raw_bytes.decode("utf-16le", errors="replace")
            elif fmt == 3:  # UTF-16BE
                res = raw_bytes.decode("utf-16be", errors="replace")
            else:
                res = raw_bytes.decode("utf-8", errors="replace")

            cleaned = res.strip("\x00 ").strip()
            # Санитизация: данные из эфира недоверенные (попадают в UI/логи).
            cleaned = "".join(ch for ch in cleaned if ch.isprintable() and ch not in '<>"&\'')
            cleaned = " ".join(cleaned.split())[:40]
            if cleaned and any(c.isalnum() for c in cleaned):
                logger.info(f"[TA] Decoded Talker Alias: '{cleaned}' (format={fmt})")
                return cleaned
        except Exception as e:
            logger.debug(f"[TA] String decoding failed: {e}")
        return None
