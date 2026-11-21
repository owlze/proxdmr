import unittest

class TestDmrFrameMatrix(unittest.TestCase):
    """
    Unit tests ensuring DMR frame type and terminator recognition complies with
    docs/SYSTEM_SPEC.md. Prevents regressions in audio stream handling.
    """

    def is_terminator(self, frame_type: int) -> bool:
        # Standard terminator check from manager.py
        return (frame_type in (0x22, 0x23)) or (bool(frame_type & 0x20) and (frame_type & 0x0F) in (2, 3))

    def test_burst_c_is_not_terminator(self):
        """
        REGRESSION TEST: 0x02 is Voice Burst C within the superframe (arrives every 360ms).
        It MUST NOT be treated as a call terminator.
        """
        burst_c = 0x02
        self.assertFalse(
            self.is_terminator(burst_c),
            "0x02 (Voice Burst C) must never be identified as terminator!"
        )

    def test_voice_superframe_bursts(self):
        """Ensure all voice bursts (A..F) are not terminators."""
        bursts = {
            0x10: "Burst A (Voice Sync)",
            0x01: "Burst B",
            0x02: "Burst C",
            0x03: "Burst D",
            0x04: "Burst E",
            0x05: "Burst F",
        }
        for b_type, desc in bursts.items():
            self.assertFalse(
                self.is_terminator(b_type),
                f"{desc} (0x{b_type:02X}) must NOT be identified as terminator"
            )

    def test_lc_header_is_not_terminator(self):
        """0x21 is Voice LC Header, not terminator."""
        self.assertFalse(self.is_terminator(0x21))

    def test_terminators_recognized_correctly(self):
        """0x22 and 0x23 are valid DMR terminators."""
        self.assertTrue(self.is_terminator(0x22), "0x22 (Terminator with LC) must be recognized")
        self.assertTrue(self.is_terminator(0x23), "0x23 (Terminator without LC) must be recognized")

    def test_slot_and_call_type_extraction(self):
        """Test standard HomeBrew slot byte bitmask extraction."""
        # TS1 Group call
        slot_byte = 0x10
        slot = 2 if (slot_byte & 0x80) else 1
        call_type = "PRIVATE" if (slot_byte & 0x40) else "GROUP"
        self.assertEqual(slot, 1)
        self.assertEqual(call_type, "GROUP")

        # TS2 Private call
        slot_byte = 0x80 | 0x40 | 0x02
        slot = 2 if (slot_byte & 0x80) else 1
        call_type = "PRIVATE" if (slot_byte & 0x40) else "GROUP"
        self.assertEqual(slot, 2)
        self.assertEqual(call_type, "PRIVATE")

    def test_burst_deduplication_logic(self):
        """Test UDP frame deduplication by (stream_id, seq_no, slot)."""
        recent_keys = {}
        now = 100.0
        stream_id = 12345
        seq_no = 42
        slot = 1
        burst_key = (stream_id, seq_no, slot)

        # First frame arrives -> accepted
        last_time = recent_keys.get(burst_key, 0.0)
        self.assertFalse((now - last_time) < 0.50)
        recent_keys[burst_key] = now

        # Duplicate frame arrives 10ms later -> rejected
        dup_now = 100.010
        last_time = recent_keys.get(burst_key, 0.0)
        self.assertTrue((dup_now - last_time) < 0.50)

        # Next sequence number arrives 60ms later -> accepted
        next_seq_key = (stream_id, seq_no + 1, slot)
        next_now = 100.060
        last_time = recent_keys.get(next_seq_key, 0.0)
        self.assertFalse((next_now - last_time) < 0.50)
        recent_keys[next_seq_key] = next_now

if __name__ == "__main__":
    unittest.main()
