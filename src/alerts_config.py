# -*- coding: utf-8 -*-
"""
alerts_config.py — управление конфигурацией Telegram-оповещений,
взаимодействие с watchdog-контейнером через shared-volume и прямой fallback.
"""
import copy
import json
import logging
import os
import ssl
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("proxdmr.alerts")

def _default_server_icon() -> str:
    is_demo = str(os.environ.get("DEMO_MODE", "")).strip().lower() in ("1", "true", "yes", "on")
    srv_lbl = str(os.environ.get("SERVER_LABEL", "")).strip().lower()
    if is_demo or "demo" in srv_lbl:
        return "🟧"
    return "🟦"


def _default_server_label() -> str:
    return str(os.environ.get("SERVER_LABEL", "") or "").strip()


DEFAULT_ALERTS_CONFIG: Dict[str, Any] = {
    "enabled": False,
    "bot_token": "",
    "chat_id": "",
    "thread_id": None,
    "language": "ru",
    "server_icon": _default_server_icon(),
    "server_label": _default_server_label(),
    "notify_on": {
        "offline": True,
        "restart": True,
        "oom": True,
        "hang": True,
        "cmem_high": True,
        "leak_suspected": True,
        "host_ram_high": False,
        "host_swap_high": False,
        "host_disk_high": False,
    },
    "thresholds": {
        "cmem_percent": 85,
        "leak_mb_per_hour": 150,
        "host_ram_percent": 90,
        "host_swap_percent": 50,
        "host_disk_percent": 90,
        "hang_timeout_sec": 60,
    },
    "silence_hours": {
        "enabled": False,
        "start": "23:00",
        "end": "07:00",
        "tz": "UTC",
        "allow_critical": True,
    },
    "rate_limit_per_hour": 10,
}

VALID_LANGUAGES = ("ru", "en", "uk", "de", "es", "fr", "it")


def get_default_data_dir() -> Path:
    p_data = Path("/data")
    if p_data.is_dir():
        return p_data
    p_src = Path(__file__).resolve().parent / "data"
    if (p_src / "ping_history.json").exists():
        return p_src
    p_parent = Path(__file__).resolve().parent.parent / "data"
    if (p_parent / "ping_history.json").exists():
        return p_parent
    p_src.mkdir(parents=True, exist_ok=True)
    return p_src


def _deep_merge_defaults(target: dict, defaults: dict) -> dict:
    for k, v in defaults.items():
        if k not in target:
            target[k] = copy.deepcopy(v)
        elif isinstance(v, dict) and isinstance(target.get(k), dict):
            _deep_merge_defaults(target[k], v)
    return target


def load_alerts_config(data_dir: Optional[Path] = None) -> Dict[str, Any]:
    target_dir = data_dir or get_default_data_dir()
    cfg_file = target_dir / "alerts.json"
    if not cfg_file.is_file():
        return copy.deepcopy(DEFAULT_ALERTS_CONFIG)
    try:
        with open(cfg_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return copy.deepcopy(DEFAULT_ALERTS_CONFIG)
        _deep_merge_defaults(data, DEFAULT_ALERTS_CONFIG)
        return data
    except Exception as e:
        logger.warning(f"[ALERTS] Failed to load alerts.json: {e}")
        return copy.deepcopy(DEFAULT_ALERTS_CONFIG)


def save_alerts_config(data_dir: Optional[Path], cfg: Dict[str, Any]) -> None:
    target_dir = data_dir or get_default_data_dir()
    target_dir.mkdir(parents=True, exist_ok=True)

    # Валидация базовых полей
    sanitized = copy.deepcopy(DEFAULT_ALERTS_CONFIG)
    _deep_merge_defaults(sanitized, cfg)

    sanitized["enabled"] = bool(cfg.get("enabled", False))
    sanitized["bot_token"] = str(cfg.get("bot_token", "") or "").strip()
    sanitized["chat_id"] = str(cfg.get("chat_id", "") or "").strip()

    th_id = cfg.get("thread_id")
    if th_id not in (None, "", 0):
        try:
            sanitized["thread_id"] = int(th_id)
        except (ValueError, TypeError):
            sanitized["thread_id"] = None
    else:
        sanitized["thread_id"] = None

    lang = str(cfg.get("language", "ru") or "ru").strip().lower()
    sanitized["language"] = lang if lang in VALID_LANGUAGES else "ru"

    raw_icon = cfg.get("server_icon")
    if raw_icon is None:
        sanitized["server_icon"] = _default_server_icon()
    else:
        sanitized["server_icon"] = str(raw_icon).strip()[:16]

    raw_label = cfg.get("server_label")
    if raw_label is None:
        sanitized["server_label"] = _default_server_label()
    else:
        sanitized["server_label"] = str(raw_label).strip()[:64]

    if isinstance(cfg.get("notify_on"), dict):
        for k in sanitized["notify_on"]:
            if k in cfg["notify_on"]:
                sanitized["notify_on"][k] = bool(cfg["notify_on"][k])

    if isinstance(cfg.get("thresholds"), dict):
        for k in sanitized["thresholds"]:
            if k in cfg["thresholds"]:
                try:
                    sanitized["thresholds"][k] = int(cfg["thresholds"][k])
                except (ValueError, TypeError):
                    pass

    if isinstance(cfg.get("silence_hours"), dict):
        sh = cfg["silence_hours"]
        sanitized["silence_hours"]["enabled"] = bool(sh.get("enabled", False))
        sanitized["silence_hours"]["start"] = str(sh.get("start", "23:00") or "23:00")
        sanitized["silence_hours"]["end"] = str(sh.get("end", "07:00") or "07:00")
        sanitized["silence_hours"]["tz"] = str(sh.get("tz", "UTC") or "UTC")
        sanitized["silence_hours"]["allow_critical"] = bool(sh.get("allow_critical", True))

    try:
        sanitized["rate_limit_per_hour"] = max(1, min(120, int(cfg.get("rate_limit_per_hour", 10))))
    except (ValueError, TypeError):
        sanitized["rate_limit_per_hour"] = 10

    tmp_file = target_dir / "alerts.json.tmp"
    final_file = target_dir / "alerts.json"

    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(sanitized, f, ensure_ascii=False, indent=2)
        f.flush()
        os.fsync(f.fileno())

    try:
        os.chmod(tmp_file, 0o600)
    except Exception:
        pass

    os.replace(tmp_file, final_file)

    try:
        os.chmod(final_file, 0o600)
    except Exception:
        pass


def mask_token(token: str) -> str:
    if not token:
        return ""
    token = token.strip()
    if len(token) > 8:
        return f"••••••••••••{token[-4:]}"
    elif len(token) > 4:
        return f"••••{token[-2:]}"
    return "••••"


def sanitize_for_ui(cfg: Dict[str, Any]) -> Dict[str, Any]:
    res = copy.deepcopy(cfg)
    raw_token = str(res.get("bot_token", "") or "")
    res["bot_token"] = mask_token(raw_token)
    res["has_token"] = bool(raw_token)
    return res


def merge_ui_update(existing: Dict[str, Any], update: Dict[str, Any]) -> Dict[str, Any]:
    merged = copy.deepcopy(existing)
    _deep_merge_defaults(merged, update)

    # Обработка bot_token: если пришла маска или пусто при наличии старого — сохраняем старый
    if "bot_token" in update:
        new_token = str(update["bot_token"] or "").strip()
        if "•" in new_token or (new_token == "" and existing.get("bot_token")):
            merged["bot_token"] = existing.get("bot_token", "")
        else:
            merged["bot_token"] = new_token

    if "chat_id" in update:
        merged["chat_id"] = str(update["chat_id"] or "").strip()
    if "thread_id" in update:
        th = update["thread_id"]
        if th in (None, "", 0):
            merged["thread_id"] = None
        else:
            try:
                merged["thread_id"] = int(th)
            except (ValueError, TypeError):
                merged["thread_id"] = None
    if "language" in update:
        l_val = str(update["language"] or "ru").strip().lower()
        merged["language"] = l_val if l_val in VALID_LANGUAGES else "ru"
    if "server_icon" in update:
        merged["server_icon"] = str(update["server_icon"] or "").strip()[:16]
    if "server_label" in update:
        merged["server_label"] = str(update["server_label"] or "").strip()[:64]
    if "enabled" in update:
        merged["enabled"] = bool(update["enabled"])

    if isinstance(update.get("notify_on"), dict):
        merged.setdefault("notify_on", {})
        for k, v in update["notify_on"].items():
            merged["notify_on"][k] = bool(v)

    if isinstance(update.get("thresholds"), dict):
        merged.setdefault("thresholds", {})
        for k, v in update["thresholds"].items():
            try:
                merged["thresholds"][k] = int(v)
            except (ValueError, TypeError):
                pass

    if isinstance(update.get("silence_hours"), dict):
        merged.setdefault("silence_hours", {})
        for k, v in update["silence_hours"].items():
            merged["silence_hours"][k] = v

    if "rate_limit_per_hour" in update:
        try:
            merged["rate_limit_per_hour"] = int(update["rate_limit_per_hour"])
        except (ValueError, TypeError):
            pass

    return merged


def read_watchdog_status(data_dir: Optional[Path] = None) -> Dict[str, Any]:
    target_dir = data_dir or get_default_data_dir()
    status_file = target_dir / "watchdog_status.json"
    if not status_file.is_file():
        return {
            "status": "offline",
            "reason": "not_installed_or_stopped",
            "ts": 0,
            "version": "unknown",
            "uptime_sec": 0,
        }
    try:
        with open(status_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        if not isinstance(data, dict):
            return {"status": "offline", "reason": "invalid_format", "ts": 0}
        file_ts = float(data.get("ts", 0))
        if time.time() - file_ts > 60:
            data["status"] = "offline"
            data["reason"] = "heartbeat_timeout"
        return data
    except Exception as e:
        return {"status": "offline", "reason": f"read_error: {e}", "ts": 0}


def request_watchdog_test(data_dir: Optional[Path] = None) -> str:
    target_dir = data_dir or get_default_data_dir()
    target_dir.mkdir(parents=True, exist_ok=True)
    test_id = str(uuid.uuid4())
    cmd_file = target_dir / "watchdog_cmd.json"
    tmp_file = target_dir / "watchdog_cmd.json.tmp"
    data = {
        "cmd": "test_alert",
        "id": test_id,
        "ts": time.time(),
    }
    with open(tmp_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp_file, cmd_file)
    return test_id


def read_test_result(data_dir: Optional[Path] = None, test_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
    status = read_watchdog_status(data_dir)
    last_test = status.get("last_test")
    if isinstance(last_test, dict):
        if not test_id or last_test.get("id") == test_id:
            return last_test
    return None


def send_telegram_direct(cfg: Dict[str, Any], message: str) -> Tuple[bool, str]:
    token = str(cfg.get("bot_token", "") or "").strip()
    chat_id = str(cfg.get("chat_id", "") or "").strip()
    if not token or not chat_id:
        return False, "Bot token or chat ID is empty"

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: Dict[str, Any] = {
        "chat_id": chat_id,
        "text": message,
        "parse_mode": "HTML",
        "disable_web_page_preview": True,
    }
    thread_id = cfg.get("thread_id")
    if thread_id not in (None, "", 0):
        try:
            tid = int(thread_id)
            if tid > 0:
                payload["message_thread_id"] = tid
        except (ValueError, TypeError):
            pass

    body_bytes = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body_bytes,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "ProxDMR-Alerts/1.46",
        },
        method="POST",
    )
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            if resp_data.get("ok"):
                return True, ""
            return False, str(resp_data.get("description", "Unknown Telegram error"))
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_msg)
            return False, f"HTTP {e.code}: {err_json.get('description', err_msg)}"
        except Exception:
            return False, f"HTTP {e.code}: {err_msg}"
    except Exception as e:
        return False, str(e)

def format_server_prefix(cfg: Dict[str, Any], fallback_label: str = "") -> str:
    icon = str(cfg.get("server_icon", _default_server_icon()) or "").strip()
    label = str(cfg.get("server_label", "") or "").strip() or fallback_label or _default_server_label() or "ProxDMR"
    if icon:
        return f"{icon} [{label}]"
    return f"[{label}]"
