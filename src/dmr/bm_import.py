import time
import json
import logging
import asyncio
import urllib.request
import urllib.error
from typing import Optional, Callable, Awaitable

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

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
        action: str = "add",
        network_type: str = "bm"
    ):
        self.task_id = task_id
        self.user_id = user_id
        self.hotspot_id = hotspot_id
        self.slot = slot
        self.talkgroups = talkgroups
        self.filename = filename
        self.action = action if action in ("add", "delete") else "add"
        self.network_type = (network_type or "bm").strip().lower()
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
        uid = getattr(self, "user_id", None)
        if self.action == "delete":
            self.message = _tr(
                "bm_import.cancelled_deleted",
                user_id=uid,
                fallback="Deletion cancelled. Deleted: {deleted} of {total}",
                deleted=len(self.deleted),
                total=self.total,
            )
        else:
            self.message = _tr(
                "bm_import.cancelled_added",
                user_id=uid,
                fallback="Import cancelled. Added: {added} of {total}",
                added=len(self.added),
                total=self.total,
            )

    def to_dict(self) -> dict:
        return {
            "task_id": self.task_id,
            "user_id": self.user_id,
            "hotspot_id": self.hotspot_id,
            "slot": self.slot,
            "filename": self.filename,
            "action": self.action,
            "network_type": self.network_type,
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
    reconnect_fn: Optional[Callable[[str, int], None]] = None,
    hotspot_manager=None
):
    action_label = "delete" if task.action == "delete" else "import"
    net_tag = "TGIF" if task.network_type == "tgif" else "BM"
    logger.info(
        f"[{net_tag}_TASK] Started background {action_label} task {task.task_id} for user {task.user_id}: "
        f"{task.total} groups ({task.action}) in slot {task.slot}"
    )

    if broadcast_fn:
        await broadcast_fn(task.user_id, {
            "type": "bm_import_progress",
            "task": task.to_dict()
        })

    if task.network_type == "dmrplus":
        try:
            import sys
            from .constants import parse_dmrplus_rpto, build_dmrplus_rpto, DMRPLUS_MAX_STATIC_PER_SLOT, DMRPLUS_MAX_RPTO_BYTES
            hm = hotspot_manager
            if hm is None:
                for mod_name in ("main", "src.main", "__main__"):
                    mod = sys.modules.get(mod_name)
                    if mod and hasattr(mod, "hotspot_manager"):
                        hm = getattr(mod, "hotspot_manager")
                        break
            if hm is None:
                raise RuntimeError(_tr("bm_import.manager_not_init", fallback="Hotspot manager is not initialized"))
            rt = hm.get_runtime(task.user_id, task.hotspot_id)
            if not rt:
                task.status = "error"
                task.message = _tr("bm_import.hotspot_not_found", user_id=task.user_id, fallback="Hotspot '{hotspot_id}' not found", hotspot_id=task.hotspot_id)
                return

            parsed = parse_dmrplus_rpto(
                getattr(rt.config, "rpto_options", "") or "",
                fallback_reflector=getattr(rt.config, "dmrplus_reflector", "") or "",
            )
            target_list = parsed["ts1"] if task.slot == 1 else parsed["ts2"]
            is_delete = (task.action == "delete")
            for i, tg in enumerate(task.talkgroups):
                if task.cancelled:
                    task.status = "cancelled"
                    break
                task.current_tg = tg
                if is_delete:
                    if tg in target_list:
                        target_list.remove(tg)
                        task.deleted.append(tg)
                    else:
                        task.errors.append(_tr("bm_import.tg_not_in_slot", user_id=task.user_id, fallback="TG {tg} not found in slot {slot}", tg=tg, slot=task.slot))
                else:
                    if tg in (0, 4000, 5000, 9990, 9991, 9999) or (task.slot == 2 and (tg == 9 or 4001 <= tg <= 4999)):
                        task.errors.append(_tr("bm_import.service_tg", user_id=task.user_id, fallback="TG {tg}: service group", tg=tg))
                    elif tg in target_list:
                        task.added.append(tg)
                    elif len(target_list) >= DMRPLUS_MAX_STATIC_PER_SLOT:
                        task.errors.append(f"TG {tg}: max {DMRPLUS_MAX_STATIC_PER_SLOT} static groups per slot in DMR+ IPSC2")
                    else:
                        target_list.append(tg)
                        task.added.append(tg)
                task.current = i + 1
                if broadcast_fn:
                    await broadcast_fn(task.user_id, {"type": "bm_import_progress", "task": task.to_dict()})
                await asyncio.sleep(0.01)

            new_rpto = build_dmrplus_rpto(
                start_ref=parsed["start_ref"],
                ts1=parsed["ts1"],
                ts2=parsed["ts2"],
                relink_time=parsed["relink_time"],
                user_link=parsed["user_link"],
                extra_opts=parsed["opts"],
            )
            if len(new_rpto.encode("ascii", errors="ignore")) > DMRPLUS_MAX_RPTO_BYTES:
                task.status = "error"
                task.message = f"DMR+ RPTO length limit exceeded ({DMRPLUS_MAX_RPTO_BYTES} bytes)"
            else:
                await hm.set_hotspot_rpto(rt.config.id, rpto_options=new_rpto, user_id=task.user_id)
                task.status = "completed" if not task.cancelled else "cancelled"
                cnt = len(task.deleted) if is_delete else len(task.added)
                task.message = f"DMR+ TS{task.slot}: {cnt}/{task.total} updated"
        except Exception as e:
            logger.error(f"[DMR+_TASK] Task {task.task_id} failed: {e}")
            task.status = "error"
            task.message = f"DMR+ error: {e}"
        finally:
            task.finished_at = time.time()
            if _user_active_bm_import.get(task.user_id) == task.task_id:
                _user_active_bm_import.pop(task.user_id, None)
            if broadcast_fn:
                await broadcast_fn(task.user_id, {"type": "bm_import_finished", "task": task.to_dict()})
        return

    if task.network_type in ("freedmr", "adn"):
        is_adn = (task.network_type == "adn")
        log_prefix = "[ADN_TASK]" if is_adn else "[FREEDMR_TASK]"
        try:
            import sys
            from .constants import parse_freedmr_rpto, build_freedmr_rpto, FREEDMR_MAX_RPTO_BYTES, normalize_freedmr_slots
            hm = hotspot_manager
            if hm is None:
                for mod_name in ("main", "src.main", "__main__"):
                    mod = sys.modules.get(mod_name)
                    if mod and hasattr(mod, "hotspot_manager"):
                        hm = getattr(mod, "hotspot_manager")
                        break
            if hm is None:
                raise RuntimeError(_tr("bm_import.manager_not_init", fallback="Hotspot manager is not initialized"))

            rt = hm.get_runtime(task.user_id, task.hotspot_id)
            if not rt:
                task.status = "error"
                task.message = _tr("bm_import.hotspot_not_found", user_id=task.user_id, fallback="Hotspot '{hotspot_id}' not found", hotspot_id=task.hotspot_id)
                return

            is_delete = (task.action == "delete")
            is_duplex = getattr(rt.config, "duplex", True)
            effective_slot = 2 if not is_duplex else task.slot
            parsed = parse_freedmr_rpto(getattr(rt.config, "rpto_options", "") or "")
            target_list = parsed["ts1"] if effective_slot == 1 else parsed["ts2"]
            opp_list = parsed["ts2"] if effective_slot == 1 else parsed["ts1"]

            for i, tg in enumerate(task.talkgroups):
                if task.cancelled:
                    task.status = "cancelled"
                    break
                task.current_tg = tg
                if is_delete:
                    if tg in target_list:
                        target_list.remove(tg)
                        task.deleted.append(tg)
                    else:
                        task.errors.append(_tr("bm_import.tg_not_in_slot", user_id=task.user_id, fallback="TG {tg} not found in slot {slot}", tg=tg, slot=task.slot))
                else:
                    if tg in (0, 4000, 5000, 9990, 9991, 9999):
                        task.errors.append(_tr("bm_import.service_tg", user_id=task.user_id, fallback="TG {tg}: service group", tg=tg))
                    elif tg in target_list:
                        task.added.append(tg)
                    else:
                        cand_ts1 = list(parsed["ts1"]) + ([tg] if effective_slot == 1 else [])
                        cand_ts2 = list(parsed["ts2"]) + ([tg] if effective_slot == 2 else [])
                        cand_norm_ts1, cand_norm_ts2 = normalize_freedmr_slots(cand_ts1, cand_ts2, duplex=is_duplex)
                        cand_rpto = build_freedmr_rpto(cand_norm_ts1, cand_norm_ts2, parsed["opts"], prefer_slot=effective_slot)
                        if len(cand_rpto.encode("ascii", errors="ignore")) > FREEDMR_MAX_RPTO_BYTES:
                            task.errors.append(_tr("bm_import.rpto_limit_tg", user_id=task.user_id, fallback="TG {tg}: RPTO limit exceeded ({limit} B)", tg=tg, limit=FREEDMR_MAX_RPTO_BYTES))
                        else:
                            if tg in opp_list:
                                opp_list.remove(tg)
                            target_list.append(tg)
                            task.added.append(tg)

                task.current = i + 1
                if broadcast_fn:
                    await broadcast_fn(task.user_id, {"type": "bm_import_progress", "task": task.to_dict()})
                await asyncio.sleep(0.01)

            norm_ts1, norm_ts2 = normalize_freedmr_slots(parsed["ts1"], parsed["ts2"], duplex=is_duplex)
            new_rpto = build_freedmr_rpto(norm_ts1, norm_ts2, parsed["opts"], prefer_slot=effective_slot)
            if len(new_rpto.encode("ascii", errors="ignore")) > FREEDMR_MAX_RPTO_BYTES:
                task.status = "error"
                if is_adn:
                    task.message = _tr("bm_import.adn_rpto_limit", user_id=task.user_id, fallback="ADN Systems RPTO string length limit exceeded ({limit} bytes)", limit=FREEDMR_MAX_RPTO_BYTES)
                else:
                    task.message = _tr("bm_import.freedmr_rpto_limit", user_id=task.user_id, fallback="FreeDMR RPTO string length limit exceeded ({limit} bytes)", limit=FREEDMR_MAX_RPTO_BYTES)
            else:
                await hm.set_hotspot_rpto(rt.config.id, rpto_options=new_rpto, user_id=task.user_id)
                task.status = "completed" if not task.cancelled else "cancelled"
                if is_delete:
                    if is_adn:
                        task.message = _tr("bm_import.adn_deleted", user_id=task.user_id, fallback="Successfully deleted {count} of {total} groups from TS{slot} ADN Systems", count=len(task.deleted), total=task.total, slot=task.slot)
                    else:
                        task.message = _tr("bm_import.freedmr_deleted", user_id=task.user_id, fallback="Successfully deleted {count} of {total} groups from TS{slot} FreeDMR", count=len(task.deleted), total=task.total, slot=task.slot)
                else:
                    if is_adn:
                        task.message = _tr("bm_import.adn_added", user_id=task.user_id, fallback="Successfully added {count} of {total} groups to TS{slot} ADN Systems", count=len(task.added), total=task.total, slot=task.slot)
                    else:
                        task.message = _tr("bm_import.freedmr_added", user_id=task.user_id, fallback="Successfully added {count} of {total} groups to TS{slot} FreeDMR", count=len(task.added), total=task.total, slot=task.slot)
                if task.errors:
                    task.message += _tr("bm_import.errors_suffix", user_id=task.user_id, fallback=" ({count} errors)", count=len(task.errors))
        except Exception as e:
            logger.error(f"{log_prefix} Task {task.task_id} failed: {e}")
            task.status = "error"
            if is_adn:
                task.message = _tr("bm_import.adn_error", user_id=task.user_id, fallback="ADN Systems error: {error}", error=e)
            else:
                task.message = _tr("bm_import.freedmr_error", user_id=task.user_id, fallback="FreeDMR error: {error}", error=e)
        finally:
            task.finished_at = time.time()
            if _user_active_bm_import.get(task.user_id) == task.task_id:
                _user_active_bm_import.pop(task.user_id, None)
            if broadcast_fn:
                await broadcast_fn(task.user_id, {"type": "bm_import_finished", "task": task.to_dict()})
        return

    def _add_single_tg(tg_num: int):
        if task.network_type == "tgif":
            if tg_num in (9, 777, 4000, 9990, 31000):
                return False, _tr("bm_import.tgif_service_tg", user_id=task.user_id, fallback="TG {tg}: TGIF service group (cannot be static)", tg=tg_num)
            url = f"https://api.tgif.network/v1/static-talkgroups/{device_id}"
            req_data = json.dumps({"slot": task.slot, "timeslot": task.slot, "talkgroup": tg_num}).encode("utf-8")
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
                err_text = ""
                try:
                    err_json = json.loads(e.read().decode("utf-8", errors="ignore"))
                    err_text = err_json.get("message") or err_json.get("error") or ""
                except Exception:
                    pass
                return False, f"TG {tg_num}: HTTP {e.code} ({err_text or e.reason})"
            except Exception as e:
                return False, f"TG {tg_num}: {e}"

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
        if task.network_type == "tgif":
            url = f"https://api.tgif.network/v1/static-talkgroups/{device_id}"
            req_data = json.dumps({"slot": task.slot, "timeslot": task.slot, "talkgroup": tg_num}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={
                    "User-Agent": "ProxDMR/1.0",
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                method="DELETE"
            )
            try:
                with urllib.request.urlopen(req, timeout=8) as resp:
                    resp.read()
                    return True, None
            except urllib.error.HTTPError as e:
                err_text = ""
                try:
                    err_json = json.loads(e.read().decode("utf-8", errors="ignore"))
                    err_text = err_json.get("message") or err_json.get("error") or ""
                except Exception:
                    pass
                return False, f"TG {tg_num}: HTTP {e.code} ({err_text or e.reason})"
            except Exception as e:
                return False, f"TG {tg_num}: {e}"

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
                    task.message = _tr("bm_import.delete_cancelled", user_id=task.user_id, fallback="Deletion cancelled. Deleted: {count} of {total}", count=len(task.deleted), total=task.total)
                else:
                    task.message = _tr("bm_import.import_cancelled", user_id=task.user_id, fallback="Import cancelled. Added: {count} of {total}", count=len(task.added), total=task.total)
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
                task.message = _tr("bm_import.deleted_summary", user_id=task.user_id, fallback="Successfully deleted {count} of {total} groups from TS{slot}", count=len(task.deleted), total=task.total, slot=task.slot)
            else:
                task.message = _tr("bm_import.added_summary", user_id=task.user_id, fallback="Successfully added {count} of {total} groups to TS{slot}", count=len(task.added), total=task.total, slot=task.slot)
            if task.errors:
                task.message += _tr("bm_import.errors_suffix", user_id=task.user_id, fallback=" ({count} errors)", count=len(task.errors))

    except Exception as e:
        logger.error(f"[BM_TASK] Task {task.task_id} failed: {e}")
        task.status = "error"
        if task.action == "delete":
            task.message = _tr("bm_import.delete_error", user_id=task.user_id, fallback="Deletion error: {error}", error=e)
        else:
            task.message = _tr("bm_import.import_error", user_id=task.user_id, fallback="Import error: {error}", error=e)
    finally:
        task.finished_at = time.time()
        logger.info(
            f"[BM_TASK] Finished task {task.task_id}: {task.status}, "
            f"added={len(task.added)}, deleted={len(task.deleted)}, errors={len(task.errors)}"
        )

        if (task.added or task.deleted) and reconnect_fn and task.network_type == "bm":
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
