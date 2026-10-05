"""
DMR Air-Interface TX Framer for ProxDMR
Constructs standard ETSI TS 102 361-1 / TS 102 361-2 compliant DMR bursts:
- Voice Header (BPTC 196,96 LC + Golay 20,8 Slot Type + BS Voice Sync)
- Voice Bursts A-F (3x AMBE+2 frames + BS Voice Sync / EMB + Embedded LC)
- Voice Terminator (BPTC 196,96 Terminator LC + Golay 20,8 Slot Type + BS Voice Sync)
"""

import logging
from typing import List, Optional, Dict

logger = logging.getLogger("proxdmr.tx_framer")

try:
    import dmr_utils3.bptc as bptc
    import dmr_utils3.golay as golay
    import dmr_utils3.qr as qr
    import dmr_utils3.const as const
    from bitarray import bitarray
    DMR_UTILS_AVAILABLE = True
except ImportError:
    bptc = None
    golay = None
    qr = None
    const = None
    bitarray = None
    DMR_UTILS_AVAILABLE = False

try:
    from dmr.talker_alias import build_talker_alias_blocks
except ImportError:
    try:
        from src.dmr.talker_alias import build_talker_alias_blocks
    except ImportError:
        def build_talker_alias_blocks(alias: str):
            return []


def build_full_lc(src_id: int, dst_id: int, call_type: str = "GROUP") -> bytes:
    """
    Builds standard 9-byte (72-bit) Full Link Control (LC) word.
    FLCO: 0x00 for Group Call, 0x03 for Private Call
    FID: 0x00 (Standard)
    Service Options: 0x00 (Voice, non-emergency)
    Target: 3 bytes
    Source: 3 bytes
    """
    lc = bytearray(9)
    lc[0] = 0x03 if call_type.upper() == "PRIVATE" else 0x00
    lc[1] = 0x00
    lc[2] = 0x00
    lc[3] = (dst_id >> 16) & 0xFF
    lc[4] = (dst_id >> 8) & 0xFF
    lc[5] = dst_id & 0xFF
    lc[6] = (src_id >> 16) & 0xFF
    lc[7] = (src_id >> 8) & 0xFF
    lc[8] = src_id & 0xFF
    return bytes(lc)


class DMRTxFramer:
    """
    Assembles DMR voice frames and control headers into 33-byte (264-bit) payloads.
    """
    def __init__(self):
        self.is_ready = DMR_UTILS_AVAILABLE
        self._cached_lc: Optional[bytes] = None
        self._cached_emblc: Optional[Dict[int, bitarray]] = None

    def _get_emblc(self, lc_bytes: bytes) -> Dict[int, bitarray]:
        if self._cached_lc != lc_bytes:
            self._cached_lc = lc_bytes
            self._cached_emblc = bptc.encode_emblc(lc_bytes)
        return self._cached_emblc

    def create_header(
        self,
        src_id: int,
        dst_id: int,
        slot: int = 2,
        call_type: str = "GROUP",
        color_code: int = 1,
    ) -> bytes:
        """
        Builds a 33-byte DMR Voice Header.
        BPTC(196,96) LC + Golay(20,8) Slot Type + 48-bit BS_VOICE_SYNC
        """
        if not self.is_ready:
            raise RuntimeError("dmr_utils3 is required for DMR framing")

        lc = build_full_lc(src_id, dst_id, call_type)
        info_bits = bptc.encode_header_lc(lc)

        # Slot Type (CC: 4 bits, DTYPE: 4 bits = 1 for DMR_SLT_VHEAD)
        st_byte = ((color_code & 0x0F) << 4) | 0x01
        st_int = golay.encode_2087(bytes([st_byte]))
        st_bits = bitarray(endian="big")
        st_bits.frombytes(st_int.to_bytes(4, "big"))
        st_bits = st_bits[12:32]  # 20 bits

        sync_bits = const.BS_DATA_SYNC  # 48 bits (Voice LC Header uses BS Data Sync)

        # Assemble 264 bits: info[0:98] + st[0:10] + sync[0:48] + st[10:20] + info[98:196]
        burst = info_bits[0:98] + st_bits[0:10] + sync_bits + st_bits[10:20] + info_bits[98:196]
        return burst.tobytes()

    def create_terminator(
        self,
        src_id: int,
        dst_id: int,
        slot: int = 2,
        call_type: str = "GROUP",
        color_code: int = 1,
    ) -> bytes:
        """
        Builds a 33-byte DMR Voice Terminator.
        BPTC(196,96) LC + Golay(20,8) Slot Type + 48-bit BS_DATA_SYNC
        """
        if not self.is_ready:
            raise RuntimeError("dmr_utils3 is required for DMR framing")

        lc = build_full_lc(src_id, dst_id, call_type)
        info_bits = bptc.encode_terminator_lc(lc)

        # Slot Type (CC: 4 bits, DTYPE: 4 bits = 2 for DMR_SLT_VTERM)
        st_byte = ((color_code & 0x0F) << 4) | 0x02
        st_int = golay.encode_2087(bytes([st_byte]))
        st_bits = bitarray(endian="big")
        st_bits.frombytes(st_int.to_bytes(4, "big"))
        st_bits = st_bits[12:32]  # 20 bits

        sync_bits = const.BS_DATA_SYNC  # 48 bits (Terminator with LC uses BS Data Sync)

        burst = info_bits[0:98] + st_bits[0:10] + sync_bits + st_bits[10:20] + info_bits[98:196]
        return burst.tobytes()

    def create_burst(
        self,
        ambe_3_frames: List[bytes],
        burst_index: int,
        src_id: int,
        dst_id: int,
        slot: int = 2,
        call_type: str = "GROUP",
        color_code: int = 1,
        talker_alias: Optional[str] = None,
        superframe_index: int = 0,
    ) -> bytes:
        """
        Builds a 33-byte (264-bit) DMR Voice Burst from 3 AMBE+2 frames (9 bytes each).
        burst_index: 0..5 (0=A, 1=B, 2=C, 3=D, 4=E, 5=F).
        Interleaves Full LC and Talker Alias (ETSI TS 102 361-2 Annex B) across superframes.
        """
        if not self.is_ready:
            logger.warning("[TX_FRAMER] dmr_utils3 is required for DMR framing")
            return b""
        if len(ambe_3_frames) != 3 or any(len(f) != 9 for f in ambe_3_frames):
            logger.warning(f"[TX_FRAMER] Invalid AMBE frames: expected 3x9 bytes, got {len(ambe_3_frames)} frames")
            return b""

        f1 = bitarray(endian="big")
        f1.frombytes(ambe_3_frames[0])
        f2 = bitarray(endian="big")
        f2.frombytes(ambe_3_frames[1])
        f3 = bitarray(endian="big")
        f3.frombytes(ambe_3_frames[2])

        idx = burst_index % 6

        if idx == 0:
            # Burst A: Center is 48-bit BS Voice Sync
            center = const.BS_VOICE_SYNC
        else:
            # Bursts B..F: Center is EMB (16 bits) + Signalling / LC fragment (32 bits)
            # LCSS: 01=First (B), 10=Continuation (C, D), 11=Last (E), 00=No LC (F)
            if idx == 1:
                lcss = 1
            elif idx in (2, 3):
                lcss = 2
            elif idx == 4:
                lcss = 3
            else:
                lcss = 0

            # QR(16,7,6) encode 7-bit value: CC(4) + PI(1) + LCSS(2)
            pi = 0
            val7 = ((color_code & 0x0F) << 3) | ((pi & 0x01) << 2) | (lcss & 0x03)
            emb_in = bytearray([val7 << 1, 0])
            qr.encode(emb_in)
            emb_bits = bitarray(endian="big")
            emb_bits.frombytes(emb_in)  # 16 bits

            if idx in (1, 2, 3, 4):
                full_lc = build_full_lc(src_id, dst_id, call_type)
                ta_blocks = build_talker_alias_blocks(talker_alias) if talker_alias else []
                if ta_blocks:
                    # Sequence: Full LC (superframe 0), then TA blocks, then repeat Full LC
                    seq = [full_lc] + ta_blocks
                    active_lc = seq[superframe_index % len(seq)]
                else:
                    active_lc = full_lc

                emblc_dict = self._get_emblc(active_lc)
                emblc_frag = emblc_dict[idx]  # 32 bits
            else:
                # Burst F: 32 bits null / RC signalling
                emblc_frag = bitarray(32, endian="big")
                emblc_frag.setall(False)

            # Center 48 bits = EMB[0..7] + Fragment[0..31] + EMB[8..15]
            center = emb_bits[0:8] + emblc_frag + emb_bits[8:16]

        # 264 bits: f1 (72) + f2[0:36] + center (48) + f2[36:72] + f3 (72)
        burst = f1 + f2[0:36] + center + f2[36:72] + f3
        return burst.tobytes()