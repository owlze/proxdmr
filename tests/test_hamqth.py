import unittest
import asyncio
from unittest.mock import patch, MagicMock
from src.dmr.hamqth import HamQTHService


class TestHamQTH(unittest.TestCase):
    def setUp(self):
        self.service = HamQTHService()

    def test_no_credentials(self):
        res = self.service._sync_lookup("UB3DLP", username="", password="", session_key="")
        self.assertEqual(res["status"], "no_credentials")

    def test_empty_callsign(self):
        res = self.service._sync_lookup("", username="user", password="pwd")
        self.assertEqual(res["status"], "error")

    def test_ssid_stripping(self):
        # Verify that an SSID like UB3DLP-7 is stripped to UB3DLP
        with patch.object(self.service, "_sync_get_session", return_value="sess123"):
            with patch.object(self.service, "_http_get") as mock_http:
                mock_http.return_value = """<?xml version="1.0"?>
                <HamQTH version="2.0">
                    <search>
                        <callsign>UB3DLP</callsign>
                        <nick>Andy</nick>
                        <adr_city>Moscow</adr_city>
                        <adr_country>Russia</adr_country>
                    </search>
                </HamQTH>"""
                res = self.service._sync_lookup("UB3DLP-7", username="user", password="pwd")
                self.assertEqual(res["status"], "ok")
                self.assertTrue(res["found"])
                self.assertEqual(res["data"]["callsign"], "UB3DLP")
                self.assertEqual(res["data"]["nick"], "Andy")

    def test_mock_hamqth_not_found(self):
        with patch.object(self.service, "_sync_get_session", return_value="sess123"):
            with patch.object(self.service, "_http_get") as mock_http:
                mock_http.return_value = """<?xml version="1.0"?>
                <HamQTH version="2.0">
                    <error>Callsign not found</error>
                </HamQTH>"""
                res = self.service._sync_lookup("NOTFOUNDCALL", username="user", password="pwd")
                self.assertEqual(res["status"], "not_found")
                self.assertFalse(res["found"])


if __name__ == "__main__":
    unittest.main()
