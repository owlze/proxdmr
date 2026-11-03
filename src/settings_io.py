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


def export_settings(settings: dict, password: str, extra_files: dict[str, bytes] | None = None) -> bytes:
    """
    Export settings dict (plus optional binary files such as custom wallpapers)
    to an AES-256 encrypted 7z archive.
    Returns the archive as bytes.
    """
    if not _HAS_PY7ZR:
        raise RuntimeError("py7zr not installed — export unavailable")

    import os

    settings_json = json.dumps(settings, indent=2, ensure_ascii=False).encode("utf-8")

    buf = io.BytesIO()
    with py7zr.SevenZipFile(buf, mode="w", password=password) as archive:
        archive.writestr(settings_json, "proxdmr_settings.json")
        if extra_files and isinstance(extra_files, dict):
            for arc_name, raw_bytes in extra_files.items():
                safe_name = os.path.basename(str(arc_name or "").strip())
                if not safe_name or safe_name == "proxdmr_settings.json" or not isinstance(raw_bytes, (bytes, bytearray)):
                    continue
                archive.writestr(bytes(raw_bytes), safe_name)
    buf.seek(0)
    return buf.read()


def import_settings_bundle(archive_bytes: bytes, password: str) -> tuple[dict, dict[str, bytes]]:
    """
    Import settings dict and any bundled binary attachments from an encrypted 7z archive.
    Returns (settings_dict, extra_files_dict).
    Raises ValueError on invalid archive/password/content.
    """
    if not _HAS_PY7ZR:
        raise RuntimeError("py7zr not installed — import unavailable")

    import tempfile
    import os

    buf = io.BytesIO(archive_bytes)
    settings_data = None
    extra_files: dict[str, bytes] = {}

    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            with py7zr.SevenZipFile(buf, mode="r", password=password) as archive:
                archive.extractall(path=tmpdir)
            entries = sorted(os.listdir(tmpdir))
            for fname in entries:
                fpath = os.path.join(tmpdir, fname)
                if not os.path.isfile(fpath):
                    continue
                if fname == "proxdmr_settings.json" or (settings_data is None and fname.endswith(".json")):
                    with open(fpath, "rb") as f:
                        settings_data = f.read()
                elif not fname.endswith(".json"):
                    with open(fpath, "rb") as f:
                        extra_files[fname] = f.read()
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

    return settings, extra_files


def import_settings(archive_bytes: bytes, password: str) -> dict:
    """
    Import settings from an encrypted 7z archive.
    Returns the settings dict.
    Raises ValueError on invalid archive/password/content.
    """
    settings, _ = import_settings_bundle(archive_bytes, password)
    return settings


def inspect_backup_archive(archive_bytes: bytes, password: str) -> dict:
    """
    Inspect the encrypted 7z archive without modifying database.
    Returns metadata about what is inside the archive.
    """
    data, extra_files = import_settings_bundle(archive_bytes, password)
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
        srv_cfg = data.get("server_config") if isinstance(data.get("server_config"), dict) else {}
        srv_items = [k for k in ("alerts_config", "demo_config", "visitor_stats_enabled", "default_settings_template") if k in srv_cfg]
        wp_manifest = data.get("wallpapers_manifest") if isinstance(data.get("wallpapers_manifest"), dict) else {}
        wp_count = sum(len(v) for v in wp_manifest.values() if isinstance(v, dict)) if wp_manifest else len(extra_files)
        return {
            "format_version": 2,
            "is_superadmin_backup": is_sa,
            "superadmin_login": sa_acc.get("login", "") or data.get("exported_by", ""),
            "users": users_list,
            "created_at": data.get("timestamp"),
            "exported_by": data.get("exported_by", ""),
            "has_server_config": bool(srv_items),
            "server_config_items": srv_items,
            "wallpapers_count": wp_count
        }
    else:
        # Legacy v1 single-user settings dict
        return {
            "format_version": 1,
            "is_superadmin_backup": False,
            "superadmin_login": "",
            "users": [],
            "created_at": None,
            "exported_by": "",
            "has_server_config": False,
            "server_config_items": [],
            "wallpapers_count": len(extra_files)
        }


def get_export_filename() -> str:
    """Generate a timestamped filename for the export archive."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"ProxDMR_backup_{ts}.7z"
