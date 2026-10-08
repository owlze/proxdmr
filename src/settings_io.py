"""
ProxDMR Settings Export/Import — encrypted 7z archives (AES-256).
"""

import io
import json
import logging
from datetime import datetime

logger = logging.getLogger("proxdmr.settings_io")

try:
    import py7zr
    _HAS_PY7ZR = True
except ImportError:
    py7zr = None
    _HAS_PY7ZR = False
    logger.warning("[SETTINGS_IO] py7zr not installed — export/import disabled")


def export_settings(settings: dict, password: str) -> bytes:
    """
    Export settings dict to an AES-256 encrypted 7z archive.
    Returns the archive as bytes.
    """
    if not _HAS_PY7ZR:
        raise RuntimeError("py7zr not installed — export unavailable")

    settings_json = json.dumps(settings, indent=2, ensure_ascii=False).encode("utf-8")

    buf = io.BytesIO()
    with py7zr.SevenZipFile(buf, mode="w", password=password) as archive:
        archive.writestr(settings_json, "proxdmr_settings.json")
    buf.seek(0)
    return buf.read()


def import_settings(archive_bytes: bytes, password: str) -> dict:
    """
    Import settings from an encrypted 7z archive.
    Returns the settings dict.
    Raises ValueError on invalid archive/password/content.
    """
    if not _HAS_PY7ZR:
        raise RuntimeError("py7zr not installed — import unavailable")

    import tempfile
    import os

    buf = io.BytesIO(archive_bytes)
    settings_data = None

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            with py7zr.SevenZipFile(buf, mode="r", password=password) as archive:
                archive.extractall(path=tmpdir)
            for fname in os.listdir(tmpdir):
                if fname.endswith(".json"):
                    with open(os.path.join(tmpdir, fname), "rb") as f:
                        settings_data = f.read()
                    break
    except py7zr.exceptions.Bad7zFile:
        raise ValueError("Неверный формат архива или неверный пароль")
    except py7zr.exceptions.PasswordRequired:
        raise ValueError("Требуется пароль")
    except (py7zr.exceptions.DecompressionError, py7zr.exceptions.CrcError):
        raise ValueError("Неверный пароль")
    except Exception as e:
        msg = str(e).lower()
        if any(k in msg for k in ("password", "crypt", "corrupt", "crc", "lzma")):
            raise ValueError("Неверный пароль")
        raise ValueError(f"Ошибка при распаковке: {e}")

    # Find the settings JSON file
    if settings_data is None:
        raise ValueError("В архиве не найден файл настроек")

    try:
        settings = json.loads(settings_data)
    except (json.JSONDecodeError, UnicodeDecodeError):
        raise ValueError("Некорректный JSON в архиве")

    if not isinstance(settings, dict):
        raise ValueError("Настройки должны быть JSON-объектом")

    return settings


def inspect_backup_archive(archive_bytes: bytes, password: str) -> dict:
    """
    Inspect the encrypted 7z archive without modifying database.
    Returns metadata about what is inside the archive:
    {
        "format_version": 2,
        "is_superadmin_backup": True,
        "superadmin_login": "...",
        "users": [ { "login": "...", "role": "...", "hotspots_count": 2, ... } ],
        "created_at": ...,
        "exported_by": ...
    }
    """
    data = import_settings(archive_bytes, password)
    is_v2 = isinstance(data, dict) and data.get("format_version") == 2
    if is_v2:
        is_sa = bool(data.get("is_superadmin_backup", False))
        sa_info = data.get("superadmin") or {}
        sa_acc = sa_info.get("account") or {}
        users_list = []
        for u in data.get("users", []):
            acc = u.get("account") or {}
            hs_list = u.get("hotspots") or (u.get("settings", {}) or {}).get("hotspots", [])
            users_list.append({
                "login": acc.get("login", ""),
                "role": acc.get("role", "user"),
                "is_swl": bool(acc.get("is_swl", False)),
                "is_blocked": bool(acc.get("is_blocked", False)),
                "hotspots_count": len(hs_list) if isinstance(hs_list, list) else 0
            })
        return {
            "format_version": 2,
            "is_superadmin_backup": is_sa,
            "superadmin_login": sa_acc.get("login", "") or data.get("exported_by", ""),
            "users": users_list,
            "created_at": data.get("timestamp"),
            "exported_by": data.get("exported_by", "")
        }
    else:
        # Legacy v1 single-user settings dict
        return {
            "format_version": 1,
            "is_superadmin_backup": False,
            "superadmin_login": "",
            "users": [],
            "created_at": None,
            "exported_by": ""
        }


def get_export_filename() -> str:
    """Generate a timestamped filename for the export archive."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"ProxDMR_backup_{ts}.7z"
