# -*- coding: utf-8 -*-
"""
demo_mode.py — Управление демо-режимом ProxDMR:
конфигурация, пул активных демо-сессий, расчёт времени до ближайшего слота,
кулдаун по IP и маскировка секретов.
"""
import json
import logging
import os
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Tuple, Any

logger = logging.getLogger("proxdmr.demo")


def get_default_data_dir() -> Path:
    p_src = Path(__file__).resolve().parent / "data"
    if (p_src / "alerts.json").exists() or (p_src / "ping_history.json").exists():
        return p_src
    p_parent = Path(__file__).resolve().parent.parent / "data"
    if (p_parent / "alerts.json").exists() or (p_parent / "ping_history.json").exists():
        return p_parent
    p_data = Path("/data")
    if p_data.is_dir():
        return p_data
    p_src.mkdir(parents=True, exist_ok=True)
    return p_src


DATA_DIR = get_default_data_dir()
DEMO_CONFIG_FILE = DATA_DIR / "demo_config.json"


def _env_bool(key: str, default: bool = False) -> bool:
    val = os.environ.get(key)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on")


def _env_int(key: str, default: int) -> int:
    try:
        return int(os.environ.get(key, default))
    except (ValueError, TypeError):
        return default


DEFAULT_DEMO_CONFIG: Dict[str, Any] = {
    "enabled": _env_bool("DEMO_MODE", False),
    "login": os.environ.get("DEMO_LOGIN", "demo").strip() or "demo",
    "password": os.environ.get("DEMO_PASSWORD", "demo").strip() or "demo",
    "max_sessions": max(1, min(50, _env_int("DEMO_MAX_SESSIONS", 10))),
    "session_minutes": max(1, min(120, _env_int("DEMO_SESSION_MINUTES", 10))),
    "cooldown_seconds": max(0, min(3600, _env_int("DEMO_COOLDOWN_SECONDS", 60))),
    "showcase_user_id": 1,
}


@dataclass
class DemoSession:
    sid: str
    ip: str
    started_at: float
    expires_at: float
    last_seen: float


class DemoModeManager:
    def __init__(self):
        self._cfg: dict = dict(DEFAULT_DEMO_CONFIG)
        self._cfg_mtime: float = 0.0
        self._load()
        self.sessions: Dict[str, DemoSession] = {}     # sid -> DemoSession
        self.cooldowns: Dict[str, float] = {}          # ip -> cooldown_until_ts
        self._admin_collapsed_backup: Dict[str, bool] = {}

    def _get_config_path(self) -> Path:
        return get_default_data_dir() / "demo_config.json"

    def _load(self) -> None:
        try:
            cfg_path = self._get_config_path()
            if cfg_path.exists():
                st = cfg_path.stat()
                if st.st_mtime != self._cfg_mtime:
                    self._cfg_mtime = st.st_mtime
                    raw = json.loads(cfg_path.read_text(encoding="utf-8"))
                    if isinstance(raw, dict):
                        self._cfg.update(raw)
            # Если файла demo_config.json ещё нет, берём стартовые значения из переменных окружения
            if not cfg_path.exists():
                if os.environ.get("DEMO_MODE") is not None:
                    self._cfg["enabled"] = _env_bool("DEMO_MODE", self._cfg["enabled"])
                if os.environ.get("DEMO_MAX_SESSIONS") is not None:
                    self._cfg["max_sessions"] = max(1, min(50, _env_int("DEMO_MAX_SESSIONS", 10)))
                if os.environ.get("DEMO_SESSION_MINUTES") is not None:
                    self._cfg["session_minutes"] = max(1, min(120, _env_int("DEMO_SESSION_MINUTES", 10)))
                if os.environ.get("DEMO_COOLDOWN_SECONDS") is not None:
                    self._cfg["cooldown_seconds"] = max(0, min(3600, _env_int("DEMO_COOLDOWN_SECONDS", 60)))
        except Exception as e:
            logger.warning(f"[DEMO] Failed to load demo_config.json: {e}")

    def save_config(self, patch: dict) -> dict:
        self._load()
        if "enabled" in patch:
            self._cfg["enabled"] = bool(patch["enabled"])
        if "max_sessions" in patch:
            self._cfg["max_sessions"] = max(1, min(50, int(patch["max_sessions"])))
        if "session_minutes" in patch:
            new_min = max(1, min(120, int(patch["session_minutes"])))
            self._cfg["session_minutes"] = new_min
            for s in list(self.sessions.values()):
                s.expires_at = s.started_at + (new_min * 60)
        if "cooldown_seconds" in patch:
            new_cd = max(0, min(3600, int(patch["cooldown_seconds"])))
            self._cfg["cooldown_seconds"] = new_cd
            if new_cd == 0:
                self.cooldowns.clear()
        if "password" in patch and str(patch["password"]).strip():
            self._cfg["password"] = str(patch["password"]).strip()
        try:
            cfg_path = self._get_config_path()
            cfg_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = cfg_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self._cfg, indent=2, ensure_ascii=False), encoding="utf-8")
            os.replace(tmp, cfg_path)
            self._cfg_mtime = cfg_path.stat().st_mtime
        except Exception as e:
            logger.error(f"[DEMO] Failed to save demo_config.json: {e}")
        return dict(self._cfg)

    def get_config(self) -> dict:
        self._load()
        return dict(self._cfg)

    @staticmethod
    def get_client_ip(request_or_ws) -> str:
        headers = getattr(request_or_ws, "headers", {}) or {}
        xff = headers.get("x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
        xri = headers.get("x-real-ip")
        if xri:
            return xri.strip()
        client = getattr(request_or_ws, "client", None)
        return client.host if client and client.host else "unknown"

    def prune(self) -> None:
        self._load()
        now = time.time()
        expired_sids = [sid for sid, s in list(self.sessions.items()) if s.expires_at <= now]
        for sid in expired_sids:
            s = self.sessions.pop(sid, None)
            if s and self._cfg["cooldown_seconds"] > 0:
                self.cooldowns[s.ip] = max(self.cooldowns.get(s.ip, 0.0), s.expires_at + self._cfg["cooldown_seconds"])
        for ip, until in list(self.cooldowns.items()):
            if until <= now:
                self.cooldowns.pop(ip, None)

    def get_cooldown_remaining(self, ip: str) -> int:
        self.prune()
        until = self.cooldowns.get(ip, 0.0)
        rem = int(round(until - time.time()))
        return max(0, rem)

    def get_nearest_slot_sec(self) -> int:
        self.prune()
        if not self.sessions:
            return 0
        now = time.time()
        earliest = min(s.expires_at for s in self.sessions.values())
        return max(1, int(round(earliest - now)))

    def get_public_status(self, ip: str) -> dict:
        self.prune()
        max_s = self._cfg["max_sessions"]
        active_s = len(self.sessions)
        cd_sec = self.get_cooldown_remaining(ip)
        slots_full = active_s >= max_s
        nearest_sec = self.get_nearest_slot_sec() if slots_full else 0
        return {
            "enabled": bool(self._cfg["enabled"]),
            "login": self._cfg["login"],
            "session_minutes": self._cfg["session_minutes"],
            "cooldown_seconds": self._cfg["cooldown_seconds"],
            "active_sessions": active_s,
            "max_sessions": max_s,
            "free_slots": max(0, max_s - active_s),
            "slots_full": slots_full,
            "nearest_slot_sec": nearest_sec,
            "cooldown_remaining_sec": cd_sec,
        }

    def start_session(self, ip: str, existing_sid: Optional[str] = None) -> Tuple[Optional[DemoSession], Optional[dict]]:
        self.prune()
        if not self._cfg["enabled"]:
            return None, {"code": "DEMO_DISABLED", "detail": "Демо-режим отключён администратором"}

        if existing_sid and existing_sid in self.sessions:
            s = self.sessions[existing_sid]
            s.last_seen = time.time()
            return s, None
        for s in self.sessions.values():
            if s.ip == ip and ip != "unknown":
                s.last_seen = time.time()
                return s, None

        cd = self.get_cooldown_remaining(ip)
        if cd > 0:
            return None, {
                "code": "DEMO_COOLDOWN",
                "cooldown_remaining_sec": cd,
                "detail": f"Повторный демо-вход будет доступен через {cd} сек.",
            }

        if len(self.sessions) >= self._cfg["max_sessions"]:
            nearest = self.get_nearest_slot_sec()
            mm, ss = divmod(nearest, 60)
            return None, {
                "code": "DEMO_SLOTS_FULL",
                "nearest_slot_sec": nearest,
                "active_sessions": len(self.sessions),
                "max_sessions": self._cfg["max_sessions"],
                "detail": f"Все демо-слоты сейчас заняты ({len(self.sessions)}/{self._cfg['max_sessions']}). Ближайший освободится через {mm:02d}:{ss:02d}",
            }

        now = time.time()
        dur = self._cfg["session_minutes"] * 60
        sid = uuid.uuid4().hex[:12]
        sess = DemoSession(sid=sid, ip=ip, started_at=now, expires_at=now + dur, last_seen=now)
        self.sessions[sid] = sess
        logger.info(f"[DEMO] Session started: sid={sid}, ip={ip}, active={len(self.sessions)}/{self._cfg['max_sessions']}")
        return sess, None

    def end_session(self, sid: str, apply_cooldown: bool = True) -> None:
        s = self.sessions.pop(sid, None)
        if s:
            now = time.time()
            if apply_cooldown and self._cfg["cooldown_seconds"] > 0 and (now - s.started_at >= 10.0):
                self.cooldowns[s.ip] = now + self._cfg["cooldown_seconds"]
            logger.info(f"[DEMO] Session ended: sid={sid}, ip={s.ip}, active={len(self.sessions)}/{self._cfg['max_sessions']}")

    def get_session(self, sid: str) -> Optional[DemoSession]:
        self.prune()
        return self.sessions.get(sid)

    def record_admin_collapsed_state(self, hotspot_id: str, was_collapsed: bool) -> None:
        if hotspot_id not in self._admin_collapsed_backup:
            self._admin_collapsed_backup[hotspot_id] = bool(was_collapsed)

    def pop_admin_collapsed_backups(self) -> Dict[str, bool]:
        backups = dict(self._admin_collapsed_backup)
        self._admin_collapsed_backup.clear()
        return backups

    def get_active_sessions(self) -> Dict[str, DemoSession]:
        self.prune()
        return dict(self.sessions)


demo_manager = DemoModeManager()


DEMO_FAKE_DMR_ID_INT = 1234567
DEMO_FAKE_DMR_ID_STR = "1234567"


def mask_hotspot_dict_for_demo(d: dict, index: int = 0) -> dict:
    """Маскирует позывной, DMR ID, Talker Alias, пароли и API-ключи в словаре хотспота для демо-клиента."""
    out = dict(d)
    out["callsign"] = "Ваш позывной"
    try:
        raw_ssid = int(out.get("bm_ssid") or out.get("ssid") or 1)
    except Exception:
        raw_ssid = 1
    demo_ssid = raw_ssid if raw_ssid >= 30 else (30 + max(0, int(index)))
    out["bm_ssid"] = demo_ssid
    out["ssid"] = demo_ssid
    net_type = str(out.get("network_type") or out.get("net_type") or out.get("type") or "").lower().strip()
    out["dmr_id"] = DEMO_FAKE_DMR_ID_INT
    if net_type == "xlx" or str(out.get("name") or "").lower().strip() == "xlx":
        out["effective_id"] = DEMO_FAKE_DMR_ID_INT
    else:
        out["effective_id"] = int(f"{DEMO_FAKE_DMR_ID_STR}{demo_ssid:02d}")
    if out.get("talker_alias"):
        out["talker_alias"] = "Your Name"
    if out.get("bm_password"):
        out["bm_password"] = "••••••••••••"
    if out.get("bm_api_key"):
        out["bm_api_key"] = "••••••••••••••••"
    return out


def mask_hotspots_list_for_demo(hotspots: list) -> list:
    """Маскирует список хотспотов с последовательными индексами для демо-режима."""
    return [mask_hotspot_dict_for_demo(h, index=idx) if isinstance(h, dict) else h for idx, h in enumerate(hotspots)]


def mask_settings_for_demo(settings_data: dict) -> dict:
    """Маскирует данные настроек для демо-клиента."""
    out = dict(settings_data) if isinstance(settings_data, dict) else settings_data.copy()
    out["bm_ssid"] = 30
    out["ssid"] = 30
    out["transcriber_api_key"] = "••••••••••••" if out.get("transcriber_api_key") else ""
    out["transcriber_api_keys"] = []
    out["groq_api_key"] = "••••••••••••" if out.get("groq_api_key") else ""
    out["groq_api_keys"] = []
    out["deepgram_api_key"] = "••••••••••••" if out.get("deepgram_api_key") else ""
    out["hamqth_username"] = "Your CALL" if out.get("hamqth_username") else ""
    out["hamqth_password"] = "••••••••••••" if out.get("hamqth_password") else ""
    out["qrz_com_username"] = "Your CALL" if out.get("qrz_com_username") else ""
    out["qrz_com_password"] = "••••••••••••" if out.get("qrz_com_password") else ""
    if "hotspots" in out and isinstance(out["hotspots"], list):
        out["hotspots"] = mask_hotspots_list_for_demo(out["hotspots"])
    return out


def mask_call_entry_for_demo(c: dict) -> dict:
    """Маскирует собственные выходы в эфир владельца сервера (is_tx == True) для демо-гостя."""
    out = dict(c)
    if bool(out.get("is_tx")):
        out["src_id"] = 1234567
        out["src_callsign"] = "Ваш позывной"
        out["src_name"] = "Your Name"
        out["talker_alias"] = "Your Name"
        out["caller_display"] = "Ваш позывной (Your Name)"
    return out
