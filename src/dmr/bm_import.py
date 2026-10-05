import time
import json
import logging
import asyncio
import urllib.request
import urllib.error
from typing import Optional, Callable, Awaitable

logger = logging.getLogger("proxdmr.bm_import")


class BmImportTask:
    def __init__(
        self,
        task_id: str,
        user_id: int,
        hotspot_id: str,
        slot: int,
        talkgroups: list[int],
        filename: str = "",
        action: str = "add"
    ):
        self.task_id = task_id
        self.user_id = user_id
        self.hotspot_id = hotspot_id
        self.slot = slot
        self.talkgroups = talkgroups
        self.filename = filename
        self.action = action if action in ("add", "delete") else "add"
        self.total = len(talkgroups)
        self.current = 0
        self.current_tg: Optional[int] = None
        self.added: list[int] = []
        self.deleted: list[int] = []
        self.errors: list[str] = []
        self.status = "running"  # running, completed, error, cancelled
        self.cancelled = False
        self.message = ""
        self.started_at = time.time()
        self.finished_at: Optional[float] = None

    @property
    def percent(self) -> int:
        if self.total <= 0:
            return 0
        return int(round((self.current / self.total) * 100))

    def cancel(self):
        self.cancelled = True
        self.status = "cancelled"
        if self.action == "delete":
            self.message = f"Удаление отменено. Удалено: {len(self.deleted)} из {self.total}"
        else:
            self.message = f"Импорт отменен. Добавлено: {len(self.added)} из {self.total}"

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "user_id": self.user_id,
            "hotspot_id": self.hotspot_id,
            "slot": self.slot,
            "filename": self.filename,
            "action": self.action,
            "total": self.total,
            "current": self.current,
            "current_tg": self.current_tg,
            "percent": self.percent,
            "added_count": len(self.added),
            "deleted_count": len(self.deleted),
            "error_count": len(self.errors),
            "errors": self.errors[-5:] if self.errors else [],
            "status": self.status,
            "message": self.message,
            "started_at": self.started_at,
            "finished_at": self.finished_at
        }


_bm_import_tasks: dict[str, BmImportTask] = {}
_user_active_bm_import: dict[int, str] = {}


async def execute_bm_import(
    task: BmImportTask,
    device_id: str,
    api_key: str,
    broadcast_fn: Optional[Callable[[int, dict], Awaitable[None]]] = None,
    reconnect_fn: Optional[Callable[[str, int], None]] = None
):
    action_label = "delete" if task.action == "delete" else "import"
    logger.info(
        f"[BM_TASK] Started background {action_label} task {task.task_id} for user {task.user_id}: "
        f"{task.total} groups ({task.action}) in slot {task.slot}"
    )

    if broadcast_fn:
        await broadcast_fn(task.user_id, {
            "type": "bm_import_progress",
            "task": task.to_dict()
        })

    def _add_single_tg(tg_num: int):
        url = f"https://api.brandmeister.network/v2/device/{device_id}/talkgroup"
        req_data = json.dumps({"slot": task.slot, "group": tg_num}).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=req_data,
            headers={
                "User-Agent": "ProxDMR/1.0",
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "Accept": "application/json"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp.read()
                return True, None
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            return False, f"TG {tg_num}: HTTP {e.code} ({msg or e.reason})"
        except Exception as e:
            return False, f"TG {tg_num}: {e}"

    def _delete_single_tg(tg_num: int):
        url = f"https://api.brandmeister.network/v2/device/{device_id}/talkgroup/{task.slot}/{tg_num}"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "ProxDMR/1.0",
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json"
            },
            method="DELETE"
        )
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                resp.read()
                return True, None
        except urllib.error.HTTPError as e:
            msg = e.read().decode("utf-8", errors="ignore")
            return False, f"TG {tg_num}: HTTP {e.code} ({msg or e.reason})"
        except Exception as e:
            return False, f"TG {tg_num}: {e}"

    try:
        is_delete = (task.action == "delete")

        for i, tg in enumerate(task.talkgroups):
            if task.cancelled:
                task.status = "cancelled"
                if is_delete:
                    task.message = f"Удаление отменено. Удалено: {len(task.deleted)} из {task.total}"
                else:
                    task.message = f"Импорт отменен. Добавлено: {len(task.added)} из {task.total}"
                break

            task.current_tg = tg
            if is_delete:
                ok, err_msg = await asyncio.to_thread(_delete_single_tg, tg)
                if ok:
                    task.deleted.append(tg)
                else:
                    task.errors.append(err_msg)
            else:
                ok, err_msg = await asyncio.to_thread(_add_single_tg, tg)
                if ok:
                    task.added.append(tg)
                else:
                    task.errors.append(err_msg)

            task.current = i + 1

            if broadcast_fn:
                await broadcast_fn(task.user_id, {
                    "type": "bm_import_progress",
                    "task": task.to_dict()
                })

            if i < task.total - 1 and not task.cancelled:
                await asyncio.sleep(0.06)  # Rate limiting for BrandMeister

        if not task.cancelled:
            task.status = "completed"
            if is_delete:
                task.message = f"Успешно удалено {len(task.deleted)} из {task.total} групп из TS{task.slot}"
            else:
                task.message = f"Успешно добавлено {len(task.added)} из {task.total} групп в TS{task.slot}"
            if task.errors:
                task.message += f" ({len(task.errors)} ошибок)"

    except Exception as e:
        logger.error(f"[BM_TASK] Task {task.task_id} failed: {e}")
        task.status = "error"
        action_name = "удаления" if task.action == "delete" else "импорта"
        task.message = f"Ошибка {action_name}: {e}"
    finally:
        task.finished_at = time.time()
        logger.info(
            f"[BM_TASK] Finished task {task.task_id}: {task.status}, "
            f"added={len(task.added)}, deleted={len(task.deleted)}, errors={len(task.errors)}"
        )

        if (task.added or task.deleted) and reconnect_fn:
            try:
                reconnect_fn(task.hotspot_id, user_id=task.user_id)
            except Exception as e:
                logger.warning(f"[BM_TASK] Error scheduling reconnect: {e}")

        if broadcast_fn:
            await broadcast_fn(task.user_id, {
                "type": "bm_import_finished",
                "task": task.to_dict()
            })

        # Очистка завершенных задач для предотвращения утечки памяти
        try:
            now_ts = time.time()
            if len(_bm_import_tasks) > 100:
                for tid in list(_bm_import_tasks.keys())[:-30]:
                    t_cand = _bm_import_tasks.get(tid)
                    if t_cand and t_cand.status in ("completed", "error"):
                        _bm_import_tasks.pop(tid, None)

            for uid_k, tid_v in list(_user_active_bm_import.items()):
                t_obj = _bm_import_tasks.get(tid_v)
                if not t_obj or (t_obj.finished_at and (now_ts - t_obj.finished_at > 300.0)):
                    _user_active_bm_import.pop(uid_k, None)
        except Exception:
            pass
