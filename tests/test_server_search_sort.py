# -*- coding: utf-8 -*-
import os
import json
import re
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CACHE_PATH = os.path.join(ROOT_DIR, "data", "xlx_hosts_cache.json")


def extract_server_number(s):
    if not s:
        return 999999
    id_str = str(s.get("id") or s.get("name") or "").strip().upper()
    
    # 1. Standard numeric XLX000..XLX999
    m_xlx_num = re.match(r"^XLX(\d{3})$", id_str)
    if m_xlx_num:
        return int(m_xlx_num.group(1))

    # 2. Hex XLX like XLX00A..XLX00F (placed after XLX009)
    m_xlx_hex = re.match(r"^XLX([0-9A-F]{3})$", id_str)
    if m_xlx_hex:
        hex_part = m_xlx_hex.group(1)
        if hex_part[:2].isdigit():
            prefix_num = int(hex_part[:2])
            offset = ord(hex_part[2]) - 64  # 'A' -> 1
            return prefix_num * 10 + 9 + (offset * 0.01)

    # 3. BrandMeister 4-5 digit master numbers (e.g. 2502)
    m_bm = re.match(r"^(?:BM\s*)?(\d{4,5})$", id_str)
    if m_bm:
        return int(m_bm.group(1))

    # 4. Fallback standalone number
    m_any = re.search(r"\b\d+\b", id_str)
    if m_any:
        return int(m_any.group(0))

    return 999999


def filter_servers(servers, query):
    trimmed = (query or "").strip().lower()
    if not trimmed:
        return servers
    tokens = [t for t in trimmed.split() if t]
    if not tokens:
        return servers

    results = []
    for s in servers:
        haystack = " ".join([
            str(s.get("id", "")),
            str(s.get("name", "")),
            str(s.get("host", "")),
            str(s.get("ip", "")),
            str(s.get("country", "")),
            str(s.get("country_name", "")),
            str(s.get("comment", ""))
        ]).lower()
        if all(tok in haystack for tok in tokens):
            results.append(s)
    return results


def sort_servers(servers, mode="number", direction="asc"):
    copy = list(servers)
    if mode == "number":
        copy.sort(key=lambda s: extract_server_number(s), reverse=(direction == "desc"))
    elif mode == "name":
        copy.sort(key=lambda s: str(s.get("name") or s.get("id") or "").lower(), reverse=(direction == "desc"))
    elif mode == "address":
        copy.sort(key=lambda s: str(s.get("host") or s.get("ip") or "").lower(), reverse=(direction == "desc"))
    elif mode == "country":
        copy.sort(key=lambda s: (str(s.get("country_name") or s.get("country") or "").lower(), extract_server_number(s)), reverse=(direction == "desc"))
    return copy


class TestServerSearchSort(unittest.TestCase):
    def setUp(self):
        self.assertTrue(os.path.exists(CACHE_PATH), f"Cache not found: {CACHE_PATH}")
        with open(CACHE_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        self.servers = data.get("servers", [])
        self.assertGreater(len(self.servers), 100, "Too few XLX servers in cache")

    def test_filter_exact_number(self):
        """Typing '270' must find XLX270."""
        matched = filter_servers(self.servers, "270")
        ids = [s.get("id") for s in matched]
        self.assertIn("XLX270", ids, f"XLX270 not found when filtering by '270'. Found: {ids}")

    def test_filter_multi_word_and(self):
        """Multi-token search '270 ru' or '270 br' must narrow results with AND logic."""
        matched_br = filter_servers(self.servers, "270 br")
        for s in matched_br:
            haystack = (str(s.get("id")) + " " + str(s.get("country")) + " " + str(s.get("name"))).lower()
            self.assertIn("270", haystack)
            self.assertTrue("br" in haystack or "бразилия" in haystack)

    def test_filter_by_ip(self):
        """Filtering by partial IP must match server host/ip."""
        sample = self.servers[0]
        ip_part = sample.get("ip", "").split(".")[0]
        if ip_part:
            matched = filter_servers(self.servers, ip_part)
            self.assertIn(sample.get("id"), [s.get("id") for s in matched])

    def test_sort_by_number_asc(self):
        """Numeric sort ascending must start with XLX000, XLX001, XLX002..."""
        sorted_list = sort_servers(self.servers, mode="number", direction="asc")
        self.assertEqual(sorted_list[0].get("id"), "XLX000")
        self.assertEqual(sorted_list[1].get("id"), "XLX001")
        self.assertEqual(sorted_list[2].get("id"), "XLX002")
        self.assertEqual(sorted_list[3].get("id"), "XLX003")
        self.assertEqual(sorted_list[4].get("id"), "XLX004")
        self.assertEqual(sorted_list[9].get("id"), "XLX009")
        self.assertEqual(sorted_list[10].get("id"), "XLX00A")
        self.assertEqual(sorted_list[11].get("id"), "XLX00B")
        self.assertEqual(sorted_list[12].get("id"), "XLX00C")
        self.assertEqual(sorted_list[13].get("id"), "XLX010")

    def test_sort_by_number_desc(self):
        """Numeric sort descending must put highest XLX numbers first."""
        sorted_list = sort_servers(self.servers, mode="number", direction="desc")
        nums = [extract_server_number(s) for s in sorted_list[:10]]
        self.assertEqual(nums, sorted(nums, reverse=True), f"First 10 numbers are not descending: {nums}")
        self.assertGreater(nums[0], 900)

    def test_sort_by_name(self):
        """Sort by name must order alphabetically."""
        sorted_list = sort_servers(self.servers, mode="name", direction="asc")
        names = [str(s.get("name") or "").lower() for s in sorted_list[:20]]
        self.assertEqual(names, sorted(names))

    def test_sort_by_address(self):
        """Sort by address must order alphabetically by host/ip."""
        sorted_list = sort_servers(self.servers, mode="address", direction="asc")
        addrs = [str(s.get("host") or s.get("ip") or "").lower() for s in sorted_list[:20]]
        self.assertEqual(addrs, sorted(addrs))


if __name__ == "__main__":
    unittest.main()
