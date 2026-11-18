import os
import sys

# Ensure src is in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "src")))

from dmr.ysf_frame import (
    INTERLEAVE_TABLE_26_4,
    WHITENING_DATA,
    parse_ysf_header_and_control,
    extract_ysf_vd2_ambe
)


def test_interleave_and_whitening_tables():
    assert len(INTERLEAVE_TABLE_26_4) == 104
    assert sorted(INTERLEAVE_TABLE_26_4) == list(range(104))
    assert len(WHITENING_DATA) == 20
    assert WHITENING_DATA[0] == 0x93
    assert WHITENING_DATA[1] == 0xD7
    assert WHITENING_DATA[19] == 0xD8


def test_control_byte_eot_flag():
    # Byte 34: Bit 0 is EOT, Bits 1..7 is frame sequence counter
    # Frame sequence 1, not EOT: (1 << 1) | 0 = 2 (0x02)
    # Notice: bit 0x02 must NOT trigger EOT!
    dummy_pkt_normal = bytearray(155)
    dummy_pkt_normal[:4] = b"YSFD"
    dummy_pkt_normal[34] = 0x02  # seq=1, eot=0
    res = parse_ysf_header_and_control(dummy_pkt_normal)
    assert res["valid"] is True
    assert res["is_eot"] is False
    assert res["frame_seq"] == 1

    # Frame sequence 1, with EOT: (1 << 1) | 1 = 3 (0x03)
    dummy_pkt_eot = bytearray(155)
    dummy_pkt_eot[:4] = b"YSFD"
    dummy_pkt_eot[34] = 0x03  # seq=1, eot=1
    res_eot = parse_ysf_header_and_control(dummy_pkt_eot)
    assert res_eot["is_eot"] is True
    assert res_eot["frame_seq"] == 1

    # Frame sequence 0, with EOT: 0x01
    dummy_pkt_eot0 = bytearray(155)
    dummy_pkt_eot0[:4] = b"YSFD"
    dummy_pkt_eot0[34] = 0x01
    res_eot0 = parse_ysf_header_and_control(dummy_pkt_eot0)
    assert res_eot0["is_eot"] is True
    assert res_eot0["frame_seq"] == 0


def test_extract_ysf_vd2_ambe():
    # Construct a valid synthetic 155-byte YSFD packet
    pkt = bytearray(155)
    pkt[:4] = b"YSFD"
    pkt[4:14] = b"REPEATER  "
    pkt[14:24] = b"N0CALL    "
    pkt[24:34] = b"ALL       "
    pkt[34] = 0x00  # not EOT

    # Fill payload bytes 65..154 with repeating pattern
    for i in range(65, 155):
        pkt[i] = (i * 37) & 0xFF

    vectors = extract_ysf_vd2_ambe(bytes(pkt))
    assert len(vectors) == 5, f"Expected 5 AMBE vectors, got {len(vectors)}"
    for idx, v in enumerate(vectors):
        assert len(v) == 49, f"Vector {idx} length is {len(v)}, expected 49"
        for bit in v:
            assert bit in (0, 1), f"Vector bit {bit} is not 0 or 1"


if __name__ == "__main__":
    test_interleave_and_whitening_tables()
    test_control_byte_eot_flag()
    test_extract_ysf_vd2_ambe()
    print("[SUCCESS] All YSF frame unit tests passed!")
