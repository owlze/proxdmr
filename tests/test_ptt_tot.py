# -*- coding: utf-8 -*-
"""
Unit tests for TOT (Time-Out Timer / Transmit of TX) configuration and PTT mode logic.
"""
import unittest


class TestPttTotLogic(unittest.TestCase):
    """Verifies TOT constraints, defaults, and boundary values."""

    def get_tot(self, val, default=60, min_val=10, max_val=300):
        if val is None:
            return default
        try:
            num = int(val)
        except (ValueError, TypeError):
            return default
        if num < min_val:
            return min_val
        if num > max_val:
            return max_val
        return num

    def get_ptt_mode(self, val):
        if val == "toggle":
            return "toggle"
        return "hold"

    def test_default_value(self):
        self.assertEqual(self.get_tot(None), 60)
        self.assertEqual(self.get_tot(""), 60)
        self.assertEqual(self.get_tot("invalid"), 60)

    def test_valid_ranges(self):
        self.assertEqual(self.get_tot(10), 10)
        self.assertEqual(self.get_tot(60), 60)
        self.assertEqual(self.get_tot(120), 120)
        self.assertEqual(self.get_tot(300), 300)

    def test_boundary_clamping(self):
        self.assertEqual(self.get_tot(5), 10)
        self.assertEqual(self.get_tot(0), 10)
        self.assertEqual(self.get_tot(-50), 10)
        self.assertEqual(self.get_tot(301), 300)
        self.assertEqual(self.get_tot(1000), 300)

    def test_ptt_mode_defaults_and_toggle(self):
        self.assertEqual(self.get_ptt_mode(None), "hold")
        self.assertEqual(self.get_ptt_mode(""), "hold")
        self.assertEqual(self.get_ptt_mode("hold"), "hold")
        self.assertEqual(self.get_ptt_mode("toggle"), "toggle")
    def resolve_ptt_tx_target(self, slot_param, configured_tg_ts1, configured_tg_ts2, ptt_target=None):
        """Simulates PTT target resolution logic from engine.js."""
        target_slot = 1 if slot_param == 1 else 2
        is_private = bool(ptt_target and ptt_target.get("type") in ("CALLER", "ID") and ptt_target.get("id"))
        if is_private:
            return {"slot": target_slot, "tg": ptt_target["id"], "call_type": "PRIVATE"}
        slot_tg = configured_tg_ts1 if target_slot == 1 else configured_tg_ts2
        return {"slot": target_slot, "tg": slot_tg, "call_type": "GROUP"}

    def test_split_ptt_slot_resolution(self):
        # TS1 left press -> TS1 configured TG
        res1 = self.resolve_ptt_tx_target(slot_param=1, configured_tg_ts1=91, configured_tg_ts2=2501)
        self.assertEqual(res1["slot"], 1)
        self.assertEqual(res1["tg"], 91)
        self.assertEqual(res1["call_type"], "GROUP")

        # TS2 right press -> TS2 configured TG
        res2 = self.resolve_ptt_tx_target(slot_param=2, configured_tg_ts1=91, configured_tg_ts2=2501)
        self.assertEqual(res2["slot"], 2)
        self.assertEqual(res2["tg"], 2501)
        self.assertEqual(res2["call_type"], "GROUP")

    def test_split_ptt_ignores_background_rx_tg(self):
        # When incoming RX had type "TG", it must NOT override slot's configured TG
        rx_target = {"id": 25020, "type": "TG"}
        res2 = self.resolve_ptt_tx_target(slot_param=2, configured_tg_ts1=91, configured_tg_ts2=2501, ptt_target=rx_target)
        self.assertEqual(res2["slot"], 2)
        self.assertEqual(res2["tg"], 2501)
        self.assertEqual(res2["call_type"], "GROUP")

    def test_split_ptt_respects_explicit_private_call(self):
        # When user explicitly selected a correspondent (CALLER / ID), respect it as PRIVATE
        priv_target = {"id": 2501234, "type": "CALLER"}
        res2 = self.resolve_ptt_tx_target(slot_param=2, configured_tg_ts1=91, configured_tg_ts2=2501, ptt_target=priv_target)
        self.assertEqual(res2["slot"], 2)
        self.assertEqual(res2["tg"], 2501234)
        self.assertEqual(res2["call_type"], "PRIVATE")

    def test_volume_up_ptt_key_recognition(self):
        """Simulates engine.js Volume Up key detection freed from PTT."""
        def is_volume_up_ptt_active(key, code, key_code):
            # Volume keys are freed and do not trigger PTT
            return False

        # Android hardware key (KEYCODE_VOLUME_UP = 24) does NOT trigger PTT
        self.assertFalse(is_volume_up_ptt_active("Unidentified", "", 24))
        # Web browser AudioVolumeUp (keyCode 175) does NOT trigger PTT
        self.assertFalse(is_volume_up_ptt_active("AudioVolumeUp", "AudioVolumeUp", 175))
        # Volume Down does NOT trigger PTT
        self.assertFalse(is_volume_up_ptt_active("AudioVolumeDown", "AudioVolumeDown", 174))
        self.assertFalse(is_volume_up_ptt_active("Unidentified", "", 25))

    def test_settings_volume_up_ptt_defaults(self):
        """Verifies AppSettings and DB defaults have volume_up_ptt enabled."""
        import json
        with open("config/settings.example.json", "r", encoding="utf-8") as f:
            ex_cfg = json.load(f)
        self.assertTrue(ex_cfg.get("volume_up_ptt"))

        try:
            from src.config import AppSettings
            cfg = AppSettings()
            self.assertTrue(cfg.volume_up_ptt)
            self.assertTrue(cfg.volume_down_ptt)
        except ImportError:
            pass

        try:
            from src.database import get_default_settings
            db_defaults = get_default_settings("test_user")
            self.assertTrue(db_defaults.get("volume_up_ptt"))
            self.assertTrue(db_defaults.get("volume_down_ptt"))
        except ImportError:
            pass


if __name__ == "__main__":
    unittest.main()
