# -*- coding: utf-8 -*-
import unittest
import json
import os

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
LOCALES_DIR = os.path.join(ROOT_DIR, "src", "static", "locales")

try:
    import pydantic
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False


class TestHotspotSsid(unittest.TestCase):
    def test_ssid_locales_presence(self):
        """All languages must have hs_edit.ssid_title mentioning 1..99 and hotspots.invalid_ssid."""
        languages = ["ru", "en", "es", "uk", "de", "fr", "it"]
        for lang in languages:
            p = os.path.join(LOCALES_DIR, f"{lang}.json")
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
            self.assertIn("hs_edit.ssid_title", data)
            self.assertIn("1", data["hs_edit.ssid_title"])
            self.assertIn("99", data["hs_edit.ssid_title"])
            self.assertIn("hotspots.invalid_ssid", data)
            self.assertTrue(len(data["hotspots.invalid_ssid"]) > 0)

    @unittest.skipUnless(HAS_PYDANTIC, "pydantic is not installed in current interpreter")
    def test_hotspot_config_ssid_clamping(self):
        from src.config import HotspotConfig

        h_default = HotspotConfig()
        self.assertEqual(h_default.bm_ssid, 1)

        # 0 must never be allowed, must clamp to 1
        h0 = HotspotConfig(bm_ssid=0)
        self.assertEqual(h0.bm_ssid, 1)

        # Negative must clamp to 1
        h_neg = HotspotConfig(bm_ssid=-10)
        self.assertEqual(h_neg.bm_ssid, 1)

        # > 99 must clamp to 99
        h_high = HotspotConfig(bm_ssid=150)
        self.assertEqual(h_high.bm_ssid, 99)

        # Strings should parse and clamp
        h_str0 = HotspotConfig(bm_ssid="0")
        self.assertEqual(h_str0.bm_ssid, 1)

        h_str15 = HotspotConfig(bm_ssid="15")
        self.assertEqual(h_str15.bm_ssid, 15)

        h_valid = HotspotConfig(bm_ssid=42)
        self.assertEqual(h_valid.bm_ssid, 42)
