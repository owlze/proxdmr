import asyncio
import os
import tempfile
import unittest
from pathlib import Path

# Note: Guard pydantic/fastapi if run on host Python without dependencies
try:
    import aiosqlite
    import pydantic
    HAS_DEPS = True
except ImportError:
    HAS_DEPS = False

if not HAS_DEPS:
    class TestSwl(unittest.TestCase):
        @unittest.skip("aiosqlite or pydantic not installed on host python")
        def test_swl_skipped(self):
            pass
else:
    import src.database as db_mod

    class TestSwlLogic(unittest.TestCase):
        def setUp(self):
            self.temp_dir = tempfile.TemporaryDirectory()
            self.db_path = Path(self.temp_dir.name) / "test_swl.db"
            self.orig_db_file = db_mod.DB_FILE
            db_mod.DB_FILE = self.db_path
            asyncio.run(db_mod.init_db())

        def tearDown(self):
            db_mod.DB_FILE = self.orig_db_file
            self.temp_dir.cleanup()

        def test_swl_flag_workflow(self):
            async def run_test():
                # 1. Default superadmin user (id=1)
                u1 = await db_mod.get_user_by_id(1)
                self.assertIsNotNone(u1)
                self.assertEqual(u1["role"], "superadmin")
                self.assertFalse(await db_mod.is_user_swl(1))

                # 2. Cannot set SWL on superadmin
                res_sa = await db_mod.set_user_swl(1, True)
                self.assertFalse(res_sa)
                self.assertFalse(await db_mod.is_user_swl(1))

                # 3. Create regular user
                u2_id = await db_mod.create_user("listener", "hash123")
                self.assertEqual(await db_mod.get_user_role(u2_id), "user")
                self.assertFalse(await db_mod.is_user_swl(u2_id))

                # 4. Set SWL on regular user
                res_user = await db_mod.set_user_swl(u2_id, True)
                self.assertTrue(res_user)
                self.assertTrue(await db_mod.is_user_swl(u2_id))

                # 5. Check in list_users
                all_users = await db_mod.list_users()
                u2_dict = next(u for u in all_users if u["id"] == u2_id)
                self.assertTrue(u2_dict["is_swl"])

                # 6. If user promoted to admin, SWL must automatically reset to False
                await db_mod.set_user_role(u2_id, "admin")
                self.assertFalse(await db_mod.is_user_swl(u2_id))

                # 7. Cannot set SWL on admin
                res_adm = await db_mod.set_user_swl(u2_id, True)
                self.assertFalse(res_adm)
                self.assertFalse(await db_mod.is_user_swl(u2_id))

                # 8. Demote back to user -> still False until explicitly set
                await db_mod.set_user_role(u2_id, "user")
                self.assertFalse(await db_mod.is_user_swl(u2_id))
                await db_mod.set_user_swl(u2_id, True)
                self.assertTrue(await db_mod.is_user_swl(u2_id))

            asyncio.run(run_test())

if __name__ == "__main__":
    unittest.main()
