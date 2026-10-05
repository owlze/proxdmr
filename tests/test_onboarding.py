# -*- coding: utf-8 -*-
"""
Tests for First-Run Onboarding Setup Wizard & Auth Status API.
"""
import unittest
import asyncio
from unittest.mock import patch, AsyncMock
try:
    import pydantic
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False

if not HAS_PYDANTIC:
    class TestOnboarding(unittest.TestCase):
        @unittest.skip("pydantic is not installed in the local host Python environment (runs inside docker)")
        def test_onboarding_skipped(self):
            pass
else:
    from src.main import AuthRegisterRequest, api_auth_status, auth_register

    class TestOnboarding(unittest.TestCase):
        def test_auth_register_request_model(self):
            req = AuthRegisterRequest(
                login="N0CALL",
                password="secretpassword",
                language="uk",
                dmr_id=1234567,
                bm_password="bm_secret_password",
                bm_master_host="2621.master.brandmeister.network"
            )
            self.assertEqual(req.login, "N0CALL")
            self.assertEqual(req.password, "secretpassword")
            self.assertEqual(req.language, "uk")
            self.assertEqual(req.dmr_id, 1234567)
            self.assertEqual(req.bm_password, "bm_secret_password")
            self.assertEqual(req.bm_master_host, "2621.master.brandmeister.network")

        def test_auth_status_first_run(self):
            with patch("src.main.user_count", new_callable=AsyncMock) as mock_uc:
                mock_uc.return_value = 0
                res = asyncio.run(api_auth_status())
                self.assertTrue(res["is_first_run"])
                self.assertTrue(res["allow_registration"])

        def test_auth_status_subsequent_runs(self):
            with patch("src.main.user_count", new_callable=AsyncMock) as mock_uc:
                mock_uc.return_value = 3
                res = asyncio.run(api_auth_status())
                self.assertFalse(res["is_first_run"])
