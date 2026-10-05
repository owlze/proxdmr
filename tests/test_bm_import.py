import unittest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock
from src.dmr.bm_import import (
    BmImportTask,
    _bm_import_tasks,
    _user_active_bm_import,
    execute_bm_import
)


class TestBmImportTask(unittest.TestCase):
    def setUp(self):
        _bm_import_tasks.clear()
        _user_active_bm_import.clear()

    def test_bm_import_task_progress_calculation(self):
        task = BmImportTask(
            task_id="task-123",
            user_id=1,
            hotspot_id="hs-1",
            slot=1,
            talkgroups=[100, 200, 300, 400],
            filename="groups.txt"
        )
        self.assertEqual(task.total, 4)
        self.assertEqual(task.current, 0)
        self.assertEqual(task.percent, 0)

        task.current = 2
        self.assertEqual(task.percent, 50)

        task.current = 4
        self.assertEqual(task.percent, 100)

        d = task.to_dict()
        self.assertEqual(d["task_id"], "task-123")
        self.assertEqual(d["user_id"], 1)
        self.assertEqual(d["hotspot_id"], "hs-1")
        self.assertEqual(d["slot"], 1)
        self.assertEqual(d["filename"], "groups.txt")
        self.assertEqual(d["total"], 4)
        self.assertEqual(d["status"], "running")

    def test_bm_import_task_cancel(self):
        task = BmImportTask(
            task_id="task-456",
            user_id=2,
            hotspot_id="hs-2",
            slot=2,
            talkgroups=[10, 20, 30]
        )
        self.assertFalse(task.cancelled)
        task.cancel()
        self.assertTrue(task.cancelled)
        self.assertEqual(task.status, "cancelled")

    def test_execute_bm_import_flow(self):
        async def run_test():
            task = BmImportTask(
                task_id="task-test-1",
                user_id=1,
                hotspot_id="hs-1",
                slot=1,
                talkgroups=[2501, 2502]
            )

            mock_broadcast = AsyncMock()
            mock_reconnect = MagicMock()

            # Mock urllib.request.urlopen to simulate BM API success
            mock_resp = MagicMock()
            mock_resp.read.return_value = b'{"status":"successful"}'
            mock_resp.__enter__.return_value = mock_resp
            mock_resp.__exit__.return_value = None

            with patch("urllib.request.urlopen", return_value=mock_resp):
                await execute_bm_import(
                    task=task,
                    device_id="1234567",
                    api_key="fake_key",
                    broadcast_fn=mock_broadcast,
                    reconnect_fn=mock_reconnect
                )

                self.assertEqual(task.status, "completed")
                self.assertEqual(task.total, 2)
                self.assertEqual(len(task.added), 2)
                self.assertEqual(task.current, 2)
                self.assertEqual(len(task.errors), 0)
                self.assertGreater(mock_broadcast.call_count, 1)
                mock_reconnect.assert_called_once_with("hs-1", user_id=1)

        asyncio.run(run_test())

    def test_execute_bm_import_cancellation_midway(self):
        async def run_test():
            task = BmImportTask(
                task_id="task-test-2",
                user_id=1,
                hotspot_id="hs-1",
                slot=2,
                talkgroups=[1, 2, 3, 4, 5]
            )

            call_count = 0
            def fake_urlopen(*args, **kwargs):
                nonlocal call_count
                call_count += 1
                if call_count >= 2:
                    task.cancel()
                mock_resp = MagicMock()
                mock_resp.read.return_value = b'{"status":"successful"}'
                mock_resp.__enter__.return_value = mock_resp
                mock_resp.__exit__.return_value = None
                return mock_resp

            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                await execute_bm_import(
                    task=task,
                    device_id="1234567",
                    api_key="fake_key"
                )

                self.assertEqual(task.status, "cancelled")
                self.assertEqual(task.current, 2)
                self.assertEqual(len(task.added), 2)

        asyncio.run(run_test())

    def test_bm_delete_task_cancel(self):
        task = BmImportTask(
            task_id="task-del-cancel",
            user_id=2,
            hotspot_id="hs-2",
            slot=1,
            talkgroups=[10, 20, 30],
            action="delete"
        )
        self.assertEqual(task.action, "delete")
        self.assertFalse(task.cancelled)
        task.cancel()
        self.assertTrue(task.cancelled)
        self.assertEqual(task.status, "cancelled")
        self.assertIn("Удаление отменено", task.message)

    def test_execute_bm_delete_flow(self):
        async def run_test():
            task = BmImportTask(
                task_id="task-del-flow",
                user_id=1,
                hotspot_id="hs-1",
                slot=2,
                talkgroups=[2501, 2502, 2503, 2504, 2505, 2506],
                action="delete"
            )

            mock_broadcast = AsyncMock()
            mock_reconnect = MagicMock()

            mock_resp = MagicMock()
            mock_resp.read.return_value = b'{"status":"deleted"}'
            mock_resp.__enter__.return_value = mock_resp
            mock_resp.__exit__.return_value = None

            captured_methods = []
            def fake_urlopen(req, *args, **kwargs):
                captured_methods.append(req.get_method())
                return mock_resp

            with patch("urllib.request.urlopen", side_effect=fake_urlopen):
                await execute_bm_import(
                    task=task,
                    device_id="1234567",
                    api_key="fake_key",
                    broadcast_fn=mock_broadcast,
                    reconnect_fn=mock_reconnect
                )

                self.assertEqual(task.status, "completed")
                self.assertEqual(task.total, 6)
                self.assertEqual(len(task.deleted), 6)
                self.assertEqual(task.current, 6)
                self.assertEqual(len(task.errors), 0)
                self.assertIn("Успешно удалено 6", task.message)
                self.assertEqual(len(captured_methods), 6)
                self.assertTrue(all(m == "DELETE" for m in captured_methods))
                self.assertGreater(mock_broadcast.call_count, 1)
                mock_reconnect.assert_called_once_with("hs-1", user_id=1)

                d = task.to_dict()
                self.assertEqual(d["action"], "delete")
                self.assertEqual(d["deleted_count"], 6)

        asyncio.run(run_test())


if __name__ == "__main__":
    unittest.main()
