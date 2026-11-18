# -*- coding: utf-8 -*-
"""
Automated unit tests for DMR+ / IPSC2 integration.
Tests hosts manager, country detection, tg_resolver isolation, and config models.
"""

import os
import sys
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(ROOT_DIR, "src"))

from dmr.dmrplus_hosts import dmrplus_hosts_mgr, detect_country
from dmr.tg_resolver import tg_resolver


class TestDmrPlus(unittest.TestCase):
    def test_country_detection(self):
        """Checks country code and name mapping from IPSC2 server names."""
        code, name = detect_country("IPSC2-DL-HOTSPOT")
        self.assertEqual(code, "DE")
        self.assertEqual(name, "Германия")

        code, name = detect_country("IPSC2-Austria")
        self.assertEqual(code, "AT")
        self.assertEqual(name, "Австрия")

        code, name = detect_country("IPSC2-DIG-ITALIA")
        self.assertEqual(code, "IT")
        self.assertEqual(name, "Италия")

        code, name = detect_country("IPSC2-ANDALUCIA")
        self.assertEqual(code, "ES")
        self.assertEqual(name, "Испания")

        code, name = detect_country("IPSC2-AmComm")
        self.assertEqual(code, "US")
        self.assertEqual(name, "США")

    def test_dmrplus_hosts_content(self):
        """Verifies hosts manager returns valid servers with port 55555."""
        hosts = dmrplus_hosts_mgr.get_hosts(enriched=False)
        self.assertGreaterEqual(len(hosts), 5, "Expected at least 5 DMR+ hosts")
        for h in hosts:
            self.assertEqual(h.get("port"), 55555, f"Expected port 55555 for DMR+, got {h.get('port')}")
            self.assertTrue(h.get("id"), "Missing server ID")
            self.assertTrue(h.get("host"), "Missing server host")

    def test_tg_resolver_dmrplus(self):
        """Verifies DMR+ specific TalkGroup and Reflector name resolution."""
        # TS1 TalkGroups
        self.assertEqual(tg_resolver.get_name(1, "dmrplus"), "Worldwide")
        self.assertEqual(tg_resolver.get_name(2, "dmrplus"), "Europe")
        self.assertEqual(tg_resolver.get_name(250, "dmrplus"), "Russia")
        self.assertEqual(tg_resolver.get_name(9, "dmrplus"), "Local (Voice / Reflector)")

        # TS2 Reflectors
        self.assertEqual(tg_resolver.get_name(4000, "dmrplus"), "Unlink (Отключение)")
        self.assertEqual(tg_resolver.get_name(5000, "dmrplus"), "Status (Проверка статуса)")
        self.assertEqual(tg_resolver.get_name(4530, "dmrplus"), "Reflector 4530 RU (Россия / СНГ)")
        self.assertEqual(tg_resolver.get_name(4001, "dmrplus"), "Reflector 4001 DL (Германия общий)")
        self.assertEqual(tg_resolver.get_name(4030, "dmrplus"), "Reflector 4030 OE (Австрия)")
        self.assertEqual(tg_resolver.get_name(4400, "dmrplus"), "Reflector 4400 UK (Великобритания)")
        self.assertEqual(tg_resolver.get_name(4999, "dmrplus"), "Reflector 4999")

    def test_tg_search_dmrplus(self):
        """Verifies searching talkgroups in DMR+ returns isolated catalog."""
        results = tg_resolver.search_talkgroups("4530", network_type="dmrplus")
        self.assertGreaterEqual(len(results), 1)
        self.assertEqual(results[0]["tg"], 4530)
        self.assertIn("4530", results[0]["name"])

        results_ru = tg_resolver.search_talkgroups("russia", network_type="dmrplus")
        tgs = [r["tg"] for r in results_ru]
        self.assertTrue(250 in tgs or 4530 in tgs, f"Expected 250 or 4530 in results: {tgs}")

    def test_hotspot_config_dmrplus(self):
        """Verifies HotspotConfig default values for DMR+ if pydantic available."""
        try:
            from dmr.config import HotspotConfig
            cfg = HotspotConfig(network_type="dmrplus")
            self.assertEqual(cfg.network_type, "dmrplus")
            self.assertEqual(cfg.dmrplus_reflector, "4530")
        except ImportError:
            self.skipTest("pydantic not installed in test environment")


if __name__ == "__main__":
    unittest.main()
