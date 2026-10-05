import unittest

try:
    import pydantic
    HAS_PYDANTIC = True
except ImportError:
    HAS_PYDANTIC = False

if not HAS_PYDANTIC:
    class TestMultiTenant(unittest.TestCase):
        @unittest.skip("pydantic is not installed in the local host Python environment (runs inside docker)")
        def test_multi_tenant_skipped(self):
            pass
else:
    import asyncio
    from src.dmr.manager import HotspotManager, UserTxState
    from src.dmr.config import AppSettings, HotspotConfig
    from src.dmr.call_log import CallLogEntry

    class TestMultiTenant(unittest.TestCase):
        def setUp(self):
            self.settings = AppSettings()
            self.manager = HotspotManager(self.settings)

        def test_user_runtimes_parallel_isolation(self):
            user1_settings = AppSettings()
            user1_settings.hotspots = [
                HotspotConfig(id="hs_1", name="User1 Main", callsign="CALL1", dmr_id=111111)
            ]
            user2_settings = AppSettings()
            user2_settings.hotspots = [
                HotspotConfig(id="hs_2", name="User2 Main", callsign="CALL2", dmr_id=222222)
            ]
            asyncio.run(self.manager.ensure_user_runtimes(1, user1_settings))
            rts1 = self.manager.get_user_runtimes(1)
            self.assertEqual(len(rts1), 1)
            self.assertIn("hs_1", rts1)

            asyncio.run(self.manager.ensure_user_runtimes(2, user2_settings))
            rts2 = self.manager.get_user_runtimes(2)
            self.assertEqual(len(rts2), 1)
            self.assertIn("hs_2", rts2)

            rts1_after = self.manager.get_user_runtimes(1)
            self.assertEqual(len(rts1_after), 1)
            self.assertIn("hs_1", rts1_after)

        def test_user_tx_state_isolation(self):
            tx1 = self.manager.get_user_tx_state(user_id=1)
            tx2 = self.manager.get_user_tx_state(user_id=2)
            self.assertFalse(tx1.is_transmitting)
            self.assertFalse(tx2.is_transmitting)

            tx1.is_transmitting = True
            tx1.active_tg = 91

            self.assertFalse(self.manager.get_user_tx_state(user_id=2).is_transmitting)
            self.assertTrue(self.manager.get_user_tx_state(user_id=1).is_transmitting)

        def test_call_history_per_user_isolation(self):
            entry_u1 = CallLogEntry(slot=1, src_id=1234567, src_callsign="USER1_CALL", dst_id=91, user_id=1)
            entry_u2 = CallLogEntry(slot=2, src_id=7654321, src_callsign="USER2_CALL", dst_id=2501, user_id=2)
            self.manager.call_history.append(entry_u1)
            self.manager.call_history.append(entry_u2)

            calls_u1 = self.manager.get_calls_history(user_id=1)
            calls_u2 = self.manager.get_calls_history(user_id=2)

            self.assertEqual(len(calls_u1), 1)
            self.assertEqual(calls_u1[0].src_callsign, "USER1_CALL")
            self.assertEqual(len(calls_u2), 1)
            self.assertEqual(calls_u2[0].src_callsign, "USER2_CALL")

        def test_bm_device_id_and_ssid_per_user(self):
            # User 1: dmr_id=1234567, bm_ssid=0 -> device_id="1234567"
            cfg_u1 = HotspotConfig(id="hs_1", name="Main", dmr_id=1234567, bm_ssid=0, bm_api_key="key1")
            # User 2: dmr_id=1234567, bm_ssid=7 -> device_id="123456707"
            cfg_u2 = HotspotConfig(id="hs_2", name="Main", dmr_id=1234567, bm_ssid=7, bm_api_key="key2")

            dev_id_u1 = f"{cfg_u1.dmr_id}{cfg_u1.bm_ssid:02d}" if cfg_u1.bm_ssid > 0 else str(cfg_u1.dmr_id)
            dev_id_u2 = f"{cfg_u2.dmr_id}{cfg_u2.bm_ssid:02d}" if cfg_u2.bm_ssid > 0 else str(cfg_u2.dmr_id)

            self.assertEqual(dev_id_u1, "1234567")
            self.assertEqual(dev_id_u2, "123456707")

            user1_sett = AppSettings()
            user1_sett.hotspots = [cfg_u1]
            user2_sett = AppSettings()
            user2_sett.hotspots = [cfg_u2]

            asyncio.run(self.manager.ensure_user_runtimes(1, user1_sett))
            asyncio.run(self.manager.ensure_user_runtimes(2, user2_sett))

            rt_u1 = self.manager.get_runtime(1, "hs_1")
            rt_u2 = self.manager.get_runtime(2, "hs_2")

            self.assertIsNotNone(rt_u1)
            self.assertIsNotNone(rt_u2)
            self.assertEqual(rt_u1.config.bm_ssid, 0)
            self.assertEqual(rt_u2.config.bm_ssid, 7)
            self.assertEqual(rt_u1.config.bm_api_key, "key1")
            self.assertEqual(rt_u2.config.bm_api_key, "key2")

        def test_default_auto_record_is_false(self):
            new_hs = HotspotConfig(id="new_hs", name="New Hotspot")
            self.assertFalse(new_hs.auto_record)

        def test_collapse_default_hotspot_does_not_affect_active_secondary(self):
            user_sett = AppSettings()
            user_sett.hotspots = [
                HotspotConfig(id="default", name="Main HS", callsign="CALL1", dmr_id=111111, collapsed=False),
                HotspotConfig(id="hs_2", name="Secondary HS", callsign="CALL2", dmr_id=222222, collapsed=False),
            ]
            user_sett.active_hotspot_id = "hs_2"
            asyncio.run(self.manager.ensure_user_runtimes(1, user_sett))

            # When hs_2 is active, get_runtime for "default" must return the "default" hotspot, NOT hs_2!
            rt_default = self.manager.get_runtime(1, "default")
            self.assertIsNotNone(rt_default)
            self.assertEqual(rt_default.config.id, "default")

            # Collapsing "default" must collapse "default" and leave hs_2 uncollapsed
            asyncio.run(self.manager.set_hotspot_collapsed("default", True, user_id=1))
            self.assertTrue(rt_default.config.collapsed)
            rt_hs2 = self.manager.get_runtime(1, "hs_2")
            self.assertIsNotNone(rt_hs2)
            self.assertFalse(rt_hs2.config.collapsed)


if __name__ == "__main__":
    unittest.main()
