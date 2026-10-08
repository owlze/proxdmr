"""
ProxDMR Database Module — SQLite storage for users and settings.
"""

import os
import json
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict, Tuple, Any

try:
    import aiosqlite
except ImportError:
    aiosqlite = None

logger = logging.getLogger("proxdmr.database")

DB_DIR = Path(__file__).resolve().parent.parent / "config"
DB_FILE = DB_DIR / "proxdmr.db"


async def init_db():
    """Create tables and enable WAL mode. Called once at startup."""
    if not aiosqlite:
        logger.error("[DB] aiosqlite not installed — auth disabled")
        return
    DB_DIR.mkdir(parents=True, exist_ok=True)
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("PRAGMA journal_mode=WAL")
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS users (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                login         TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at    REAL NOT NULL,
                last_login    REAL DEFAULT 0
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_settings (
                user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                settings_json TEXT NOT NULL DEFAULT '{}',
                updated_at    REAL NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS recordings (
                id             TEXT PRIMARY KEY,
                user_id        INTEGER DEFAULT 0,
                created_at     REAL NOT NULL,
                filename       TEXT NOT NULL,
                file_path      TEXT NOT NULL,
                file_size      INTEGER NOT NULL,
                duration       REAL NOT NULL,
                call_type      TEXT NOT NULL DEFAULT 'RX',
                hotspot_id     TEXT NOT NULL,
                slot           INTEGER NOT NULL,
                src_id         INTEGER NOT NULL,
                src_callsign   TEXT DEFAULT '',
                src_name       TEXT DEFAULT '',
                talker_alias   TEXT DEFAULT '',
                dst_id         INTEGER NOT NULL,
                is_favorite    INTEGER DEFAULT 0,
                call_id        TEXT DEFAULT '',
                transcription  TEXT DEFAULT ''
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_recordings_user ON recordings(user_id)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_recordings_created ON recordings(created_at DESC)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_recordings_call_id ON recordings(call_id)")
        try:
            await db.execute("ALTER TABLE recordings ADD COLUMN transcription TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE users ADD COLUMN is_blocked INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            await db.execute("ALTER TABLE users ADD COLUMN is_swl INTEGER DEFAULT 0")
        except Exception:
            pass
        # Clean up any orphaned user_settings rows
        await db.execute("DELETE FROM user_settings WHERE user_id NOT IN (SELECT id FROM users)")

        # Ensure at least one superadmin exists (migration for existing databases)
        cursor = await db.execute("SELECT COUNT(*) FROM users WHERE role = 'superadmin'")
        sa_count = (await cursor.fetchone())[0]
        if sa_count == 0:
            cursor2 = await db.execute("SELECT id FROM users ORDER BY id LIMIT 1")
            first_user = await cursor2.fetchone()
            if first_user:
                await db.execute("UPDATE users SET role = 'superadmin' WHERE id = ?", (first_user[0],))
                logger.info(f"[DB] Promoted user id={first_user[0]} to superadmin (migration)")

        await db.commit()
    logger.info(f"[DB] Database initialized: {DB_FILE}")

    # Auto-initialize admin user if database has no users
    await _ensure_default_admin()


async def _ensure_default_admin():
    """Ensure at least one administrator user exists on initial startup."""
    if await user_count() > 0:
        return  # Already have users

    try:
        from auth import hash_password

        login = os.getenv("ADMIN_USER", "admin").strip().lower() or "admin"
        password = os.getenv("ADMIN_PASSWORD", "proxdmr123")
        pw_hash = hash_password(password)

        # create_user automatically populates clean default settings
        user_id = await create_user(login, pw_hash)

        # Mark first user as superadmin
        await set_user_role(user_id, 'superadmin')

        # Check if legacy settings.json exists to migrate over
        settings_file = DB_DIR / "settings.json"
        if settings_file.exists():
            try:
                with open(settings_file, "r", encoding="utf-8-sig") as f:
                    settings = json.load(f)
                await save_user_settings(user_id, settings)
                migrated_path = settings_file.with_suffix(".json.migrated")
                if not migrated_path.exists():
                    settings_file.rename(migrated_path)
                logger.info(f"[DB] Migrated settings.json → admin user '{login}' (id={user_id})")
            except Exception as e:
                logger.warning(f"[DB] Could not migrate settings.json: {e}")
        else:
            logger.info(f"[DB] Initialized default admin user '{login}' (id={user_id})")

        await update_last_login(user_id)
    except Exception as e:
        logger.error(f"[DB] Admin initialization error: {e}")


DEFAULT_SETTINGS_FILE = Path(__file__).resolve().parent / "default_settings.json"
CONFIG_DEFAULT_SETTINGS = Path(__file__).resolve().parent.parent / "config" / "default_settings.json"


def get_default_settings(login: str = "") -> dict:
    """Return clean default settings for a newly registered or reset user."""
    callsign = login.strip().upper() if (login and login.strip().lower() != "admin") else "N0CALL"
    settings = None

    if CONFIG_DEFAULT_SETTINGS.exists():
        try:
            with open(CONFIG_DEFAULT_SETTINGS, "r", encoding="utf-8") as f:
                settings = json.load(f)
        except Exception as e:
            logger.warning(f"[DB] Could not load {CONFIG_DEFAULT_SETTINGS}: {e}")

    if not settings and DEFAULT_SETTINGS_FILE.exists():
        try:
            with open(DEFAULT_SETTINGS_FILE, "r", encoding="utf-8") as f:
                settings = json.load(f)
        except Exception as e:
            logger.warning(f"[DB] Could not load {DEFAULT_SETTINGS_FILE}: {e}")

    if settings:
        settings = json.loads(json.dumps(settings))
        if login and settings.get("hotspots"):
            settings["hotspots"][0]["callsign"] = callsign
        return settings
    return {
        "active_hotspot_id": "default",
        "loopback_mode": False,
        "mute_on_ptt": True,
        "volume_down_ptt": True,
        "volume_up_ptt": True,
        "sync_hotspot_volume": True,
        "sync_system_volume": True,
        "haptic_feedback": True,
        "haptic_duration": 45,
        "simultaneous_slots": True,
        "check_mic_on_tx": True,
        "theme": "dark",
        "bg_type": "pattern",
        "bg_color": "#0f1115",
        "bg_type_dark": "pattern",
        "bg_color_dark": "#0f1115",
        "bg_type_light": "pattern",
        "bg_color_light": "#f4f6f8",
        "language": "ru",
        "transcriber_enabled": False,
        "transcriber_api_key": "",
        "transcriber_api_keys": [],
        "transcriber_model": "gemini-3.5-flash",
        "transcriber_target_lang": "ru",
        "tts_enabled": False,
        "tts_engine": "gemini",
        "tts_model": "gemini-3.1-flash-tts-preview",
        "tts_voice": "auto",
        "tts_speed": 1.1,
        "tts_ducking_level": 0.80,
        "tts_mute_others": True,
        "tts_announce_callsign": False,
        "tts_style": "radio",
        "quick_mem": {},
        "contacts": [],
        "contacts_gateway": {"hotspot_id": "default", "slot": 2},
        "hamqth_username": "",
        "hamqth_password": "",
        "recordings_settings": {
            "auto_record_rx": True,
            "auto_record_tx": True,
            "min_duration_sec": 1.0,
            "max_storage_mb": 1000,
            "beep_marker_enabled": True,
            "beep_frequency_hz": 600
        },
        "client_settings": {
            "audio_rx": {
                "pre_gain_db": 0,
                "agc_enabled": True,
                "agc_profile": "standard",
                "agc_boost": 12,
                "agc_atten": -12,
                "agc_hang": 0.35,
                "eq_low": 0,
                "eq_mid": 0,
                "eq_high": 0,
                "deemphasis": False,
                "active_preset": "1",
                "presets": {
                    "1": { "name": "Стандарт", "preGain": 0, "agcProfile": "standard", "agcBoost": 12, "agcAtten": -12, "agcHang": 0.35, "eqLow": 0, "eqMid": 0, "eqHigh": 0, "deemphasis": False },
                    "2": { "name": "Мягкий эфир", "preGain": 2, "agcProfile": "soft", "agcBoost": 8, "agcAtten": -8, "agcHang": 0.30, "eqLow": 2, "eqMid": 0, "eqHigh": -3, "deemphasis": True },
                    "3": { "name": "Разборчивость", "preGain": 4, "agcProfile": "deep", "agcBoost": 18, "agcAtten": -18, "agcHang": 0.40, "eqLow": -4, "eqMid": 4, "eqHigh": 2, "deemphasis": False }
                }
            },
            "ambe_rx": {
                "uvquality": 3,
                "spectral_enh": True,
                "float_mode": True,
                "max_repeats": 3,
                "repeat_decay": 75,
                "fec_tolerance": 1,
                "audio_gain": 7.0,
                "active_preset": "1",
                "presets": {
                    "1": { "uvquality": 3, "spectral_enh": True, "float_mode": True, "max_repeats": 3, "repeat_decay": 75, "fec_tolerance": 1, "audio_gain": 7.0 },
                    "2": { "uvquality": 4, "spectral_enh": True, "float_mode": True, "max_repeats": 4, "repeat_decay": 70, "fec_tolerance": 1, "audio_gain": 6.5 },
                    "3": { "uvquality": 6, "spectral_enh": True, "float_mode": True, "max_repeats": 5, "repeat_decay": 85, "fec_tolerance": 2, "audio_gain": 8.0 }
                }
            },
            "audio_tx": {
                "mic_gain": 0,
                "noise_suppression": True,
                "browser_agc": False,
                "echo_cancellation": True,
                "gate_enabled": True,
                "gate_threshold": -45,
                "hpf_enabled": True,
                "presence_boost": 3,
                "active_preset": "1",
                "presets": {
                    "1": { "name": "Стандарт", "txMicGain": 0, "txNoiseSuppression": True, "txBrowserAgc": False, "txEchoCancellation": True, "txGateEnabled": True, "txGateThreshold": -45, "txHpfEnabled": True, "txPresenceBoost": 3 },
                    "2": { "name": "Мягкий голос", "txMicGain": 2, "txNoiseSuppression": True, "txBrowserAgc": False, "txEchoCancellation": True, "txGateEnabled": False, "txGateThreshold": -45, "txHpfEnabled": False, "txPresenceBoost": 0 },
                    "3": { "name": "Пробивной / DX", "txMicGain": 3, "txNoiseSuppression": True, "txBrowserAgc": False, "txEchoCancellation": True, "txGateEnabled": True, "txGateThreshold": -40, "txHpfEnabled": True, "txPresenceBoost": 6 }
                }
            },
            "hotspots_ui": {},
            "global_ui": {
                "main_volume": 120,
                "global_mute": False,
                "active_slot": 1
            }
        },
        "hotspots": [
            {
                "id": "default",
                "name": "Основной хотспот",
                "callsign": callsign,
                "dmr_id": 0,
                "bm_ssid": 1,
                "bm_master_host": "2322.master.brandmeister.network",
                "bm_master_port": 62031,
                "bm_password": "",
                "bm_api_key": "",
                "duplex": True,
                "rx_freq": 438800000,
                "tx_freq": 431200000,
                "color_code": 1,
                "default_tg_ts1": 91,
                "default_tg_ts2": 2501,
                "autoconnect": False,
                "rx_gain": 1.0,
                "tx_gain": 1.0,
                "talker_alias": "",
                "collapsed": False,
            }
        ]
    }


async def create_user(login: str, password_hash: str) -> int:
    """Create a new user and initialize with clean default settings. Returns user_id."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute(
            "INSERT INTO users (login, password_hash, created_at) VALUES (?, ?, ?)",
            (login, password_hash, time.time())
        )
        user_id = cursor.lastrowid
        default_settings = json.dumps(get_default_settings(login), ensure_ascii=False)
        await db.execute(
            "INSERT INTO user_settings (user_id, settings_json, updated_at) VALUES (?, ?, ?)",
            (user_id, default_settings, time.time())
        )
        await db.commit()
        logger.info(f"[DB] User created with clean settings: {login} (id={user_id})")
        return user_id


async def get_user_by_login(login: str) -> dict | None:
    """Fetch user row by login (case-insensitive). Returns dict or None."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, login, password_hash, role, is_blocked, is_swl, created_at, last_login FROM users WHERE login = ?",
            (login,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["is_swl"] = bool(d.get("is_swl", 0)) and (d.get("role") == "user")
        d["is_blocked"] = bool(d.get("is_blocked", 0))
        return d


async def get_user_by_id(user_id: int) -> dict | None:
    """Fetch user row by ID. Returns dict or None."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, login, password_hash, role, is_blocked, is_swl, created_at, last_login FROM users WHERE id = ?",
            (user_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        d = dict(row)
        d["is_swl"] = bool(d.get("is_swl", 0)) and (d.get("role") == "user")
        d["is_blocked"] = bool(d.get("is_blocked", 0))
        return d


async def update_last_login(user_id: int):
    """Update last_login timestamp for a user."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute(
            "UPDATE users SET last_login = ? WHERE id = ?",
            (time.time(), user_id)
        )
        await db.commit()


async def save_user_settings(user_id: int, settings: dict):
    """Save user settings as JSON blob (upsert)."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        settings_json = json.dumps(settings, ensure_ascii=False)
        await db.execute(
            """INSERT INTO user_settings (user_id, settings_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE
               SET settings_json = excluded.settings_json,
                   updated_at = excluded.updated_at""",
            (user_id, settings_json, time.time())
        )
        await db.commit()


async def load_user_settings(user_id: int) -> dict:
    """Load user settings JSON. Returns default settings if not found or empty."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute(
            "SELECT settings_json FROM user_settings WHERE user_id = ?",
            (user_id,)
        )
        row = await cursor.fetchone()
        if row and row[0]:
            try:
                data = json.loads(row[0])
                if data and isinstance(data, dict) and data.get("hotspots"):
                    if "client_settings" not in data or not isinstance(data["client_settings"], dict):
                        user_cursor = await db.execute("SELECT login FROM users WHERE id = ?", (user_id,))
                        user_row = await user_cursor.fetchone()
                        login = user_row[0] if user_row else ""
                        data["client_settings"] = get_default_settings(login)["client_settings"]
                    return data
            except (json.JSONDecodeError, TypeError):
                pass

        # If settings were empty or missing hotspots, fetch user login and provide defaults
        user_cursor = await db.execute("SELECT login FROM users WHERE id = ?", (user_id,))
        user_row = await user_cursor.fetchone()
        login = user_row[0] if user_row else ""
        defaults = get_default_settings(login)
        # Persist defaults so it is stored
        await db.execute(
            """INSERT INTO user_settings (user_id, settings_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE
               SET settings_json = excluded.settings_json,
                   updated_at = excluded.updated_at""",
            (user_id, json.dumps(defaults, ensure_ascii=False), time.time())
        )
        await db.commit()
        return defaults


async def delete_user(user_id: int) -> bool:
    """Delete a user and their settings. Returns True if deleted."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        cursor = await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()
        deleted = cursor.rowcount > 0
        if deleted:
            logger.info(f"[DB] User deleted: id={user_id}")
        return deleted


async def list_users() -> list[dict]:
    """List all users (without password hashes)."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, login, role, is_blocked, is_swl, created_at, last_login FROM users ORDER BY id"
        )
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            d = dict(row)
            d["is_swl"] = bool(d.get("is_swl", 0)) and (d.get("role") == "user")
            d["is_blocked"] = bool(d.get("is_blocked", 0))
            result.append(d)
        return result


async def user_count() -> int:
    """Return total number of registered users."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute("SELECT COUNT(*) FROM users")
        row = await cursor.fetchone()
        return row[0] if row else 0


async def login_exists(login: str) -> bool:
    """Check if a login is already taken (case-insensitive)."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute(
            "SELECT 1 FROM users WHERE login = ? LIMIT 1",
            (login,)
        )
        return (await cursor.fetchone()) is not None

# ─── User Role & Block Management ────────────────────────────────────────────


async def get_user_role(user_id: int) -> str:
    """Get user role. Returns 'user' if not found."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return (row[0] or "user") if row else "user"


async def set_user_role(user_id: int, role: str) -> bool:
    """Set user role ('superadmin', 'admin', 'user'). Returns True if updated."""
    if role not in ('superadmin', 'admin', 'user'):
        return False
    async with aiosqlite.connect(str(DB_FILE)) as db:
        if role in ('superadmin', 'admin'):
            cursor = await db.execute(
                "UPDATE users SET role = ?, is_swl = 0 WHERE id = ?", (role, user_id)
            )
        else:
            cursor = await db.execute(
                "UPDATE users SET role = ? WHERE id = ?", (role, user_id)
            )
        await db.commit()
        updated = cursor.rowcount > 0
        if updated:
            logger.info(f"[DB] User role updated: id={user_id} -> {role}")
        return updated


async def is_user_swl(user_id: int) -> bool:
    """Check if a user has SWL (listen-only) flag enabled."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute("SELECT is_swl, role FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            return False
        # Admins and superadmins are never SWL
        if (row[1] or "user") in ("superadmin", "admin"):
            return False
        return bool(row[0])


async def set_user_swl(user_id: int, swl: bool) -> bool:
    """Set SWL flag for regular user. Returns True if updated. Admins/superadmins cannot be SWL."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute("SELECT role FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        if not row:
            return False
        role = row[0] or "user"
        if role in ("superadmin", "admin"):
            if swl:
                logger.warning(f"[DB] Attempted to set SWL on {role} user id={user_id} - rejected")
                return False
            val = 0
        else:
            val = 1 if swl else 0

        cursor = await db.execute(
            "UPDATE users SET is_swl = ? WHERE id = ?", (val, user_id)
        )
        await db.commit()
        updated = cursor.rowcount > 0
        if updated:
            logger.info(f"[DB] User SWL updated: id={user_id} -> {bool(val)}")
        return updated


async def set_user_blocked(user_id: int, blocked: bool) -> bool:
    """Block or unblock a user. Returns True if updated."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute(
            "UPDATE users SET is_blocked = ? WHERE id = ?", (1 if blocked else 0, user_id)
        )
        await db.commit()
        updated = cursor.rowcount > 0
        if updated:
            logger.info(f"[DB] User {'blocked' if blocked else 'unblocked'}: id={user_id}")
        return updated


async def is_user_blocked(user_id: int) -> bool:
    """Check if a user is blocked."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute("SELECT is_blocked FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return bool(row[0]) if row else False


async def update_user_password(user_id: int, new_password_hash: str) -> bool:
    """Update a user's password hash. Returns True if updated."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?",
            (new_password_hash, user_id)
        )
        await db.commit()
        updated = cursor.rowcount > 0
        if updated:
            logger.info(f"[DB] Password updated for user id={user_id}")
        return updated


# ─── Recordings Storage & CRUD ───────────────────────────────────────────────

RECORDINGS_DIR = DB_DIR / "recordings"


def get_recordings_dir() -> Path:
    RECORDINGS_DIR.mkdir(parents=True, exist_ok=True)
    return RECORDINGS_DIR


async def create_recording(rec: dict) -> dict:
    """Save metadata for a newly recorded audio file."""
    if not aiosqlite:
        return rec
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute(
            """INSERT INTO recordings (
                id, user_id, created_at, filename, file_path, file_size,
                duration, call_type, hotspot_id, slot, src_id, src_callsign,
                src_name, talker_alias, dst_id, call_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                rec.get("id"),
                rec.get("user_id", 0),
                rec.get("created_at", time.time()),
                rec.get("filename", ""),
                rec.get("file_path", ""),
                rec.get("file_size", 0),
                rec.get("duration", 0.0),
                rec.get("call_type", "RX"),
                rec.get("hotspot_id", "default"),
                rec.get("slot", 1),
                rec.get("src_id", 0),
                rec.get("src_callsign", ""),
                rec.get("src_name", ""),
                rec.get("talker_alias", ""),
                rec.get("dst_id", 0),
                rec.get("call_id", "")
            )
        )
        await db.commit()
    logger.debug(f"[DB] Recording saved: id={rec.get('id')}, file={rec.get('filename')}")
    return rec


async def get_recordings(
    user_id: Optional[int] = None,
    search: str = "",
    call_type: str = "",
    limit: int = 50,
    offset: int = 0
) -> tuple[list[dict], int]:
    """List recordings with flexible filtering, search, and pagination."""
    if not aiosqlite:
        return [], 0
    query = "SELECT * FROM recordings WHERE 1=1"
    count_query = "SELECT COUNT(*) FROM recordings WHERE 1=1"
    params = []

    if user_id is not None and user_id > 0:
        query += " AND (user_id = ? OR user_id = 0)"
        count_query += " AND (user_id = ? OR user_id = 0)"
        params.append(user_id)

    if call_type and call_type != "ALL":
        query += " AND call_type = ?"
        count_query += " AND call_type = ?"
        params.append(call_type.upper())

    if search:
        s = f"%{search.strip().lower()}%"
        query += " AND (LOWER(src_callsign) LIKE ? OR LOWER(src_name) LIKE ? OR CAST(dst_id AS TEXT) LIKE ? OR CAST(src_id AS TEXT) LIKE ?)"
        count_query += " AND (LOWER(src_callsign) LIKE ? OR LOWER(src_name) LIKE ? OR CAST(dst_id AS TEXT) LIKE ? OR CAST(src_id AS TEXT) LIKE ?)"
        params.extend([s, s, s, s])

    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        # Count total matches
        cursor = await db.execute(count_query, params)
        total_row = await cursor.fetchone()
        total_count = total_row[0] if total_row else 0

        # Fetch page
        query += " ORDER BY created_at DESC LIMIT ? OFFSET ?"
        page_params = params + [limit, offset]
        cursor = await db.execute(query, page_params)
        rows = await cursor.fetchall()
        recordings = [dict(r) for r in rows]
        for r in recordings:
            r["time_str"] = time.strftime("%H:%M:%S", time.localtime(r.get("created_at", 0)))
            r["date_str"] = time.strftime("%d.%m.%Y", time.localtime(r.get("created_at", 0)))
        return recordings, total_count


async def get_recording_by_id(rec_id: str) -> Optional[dict]:
    """Fetch single recording by ID."""
    if not aiosqlite:
        return None
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM recordings WHERE id = ? LIMIT 1", (rec_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        res["time_str"] = time.strftime("%H:%M:%S", time.localtime(res.get("created_at", 0)))
        res["date_str"] = time.strftime("%d.%m.%Y", time.localtime(res.get("created_at", 0)))
        return res


async def get_recording_by_call_id(call_id: str) -> Optional[dict]:
    """Fetch recording associated with a call ID (e.g. for Last Heard inline play)."""
    if not aiosqlite or not call_id:
        return None
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute("SELECT * FROM recordings WHERE call_id = ? ORDER BY created_at DESC LIMIT 1", (call_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        res = dict(row)
        res["time_str"] = time.strftime("%H:%M:%S", time.localtime(res.get("created_at", 0)))
        res["date_str"] = time.strftime("%d.%m.%Y", time.localtime(res.get("created_at", 0)))
        return res


async def delete_recording(rec_id: str) -> Optional[dict]:
    """Delete a recording from DB and return its metadata (for disk file removal)."""
    if not aiosqlite:
        return None
    rec = await get_recording_by_id(rec_id)
    if not rec:
        return None
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("DELETE FROM recordings WHERE id = ?", (rec_id,))
        await db.commit()
    logger.info(f"[DB] Recording deleted from DB: id={rec_id}")
    return rec


async def delete_all_recordings(user_id: Optional[int] = None) -> list[str]:
    """Delete all recordings for the user (or all if user_id is None). Returns list of file paths to remove from disk."""
    if not aiosqlite:
        return []
    files_to_remove = []
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT id, file_path FROM recordings WHERE 1=1"
        params = []
        if user_id is not None and user_id > 0:
            query += " AND (user_id = ? OR user_id = 0)"
            params.append(user_id)

        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        ids_to_del = []
        for r in rows:
            files_to_remove.append(r["file_path"])
            ids_to_del.append(r["id"])

        if ids_to_del:
            placeholders = ",".join(["?"] * len(ids_to_del))
            await db.execute(f"DELETE FROM recordings WHERE id IN ({placeholders})", ids_to_del)
            await db.commit()
    logger.info(f"[DB] Bulk deleted {len(files_to_remove)} recordings")
    return files_to_remove


async def get_recordings_stats(user_id: Optional[int] = None) -> dict:
    """Return storage statistics: total size in bytes, total count, count by type."""
    if not aiosqlite:
        return {"total_size_bytes": 0, "total_count": 0, "rx_count": 0, "tx_count": 0, "session_count": 0}
    async with aiosqlite.connect(str(DB_FILE)) as db:
        query = "SELECT COUNT(*) as total_count, COALESCE(SUM(file_size), 0) as total_size, " \
                "COALESCE(SUM(CASE WHEN call_type = 'RX' THEN 1 ELSE 0 END), 0) as rx_count, " \
                "COALESCE(SUM(CASE WHEN call_type = 'TX' THEN 1 ELSE 0 END), 0) as tx_count, " \
                "COALESCE(SUM(CASE WHEN call_type = 'SESSION' THEN 1 ELSE 0 END), 0) as session_count " \
                "FROM recordings WHERE 1=1"
        params = []
        if user_id is not None and user_id > 0:
            query += " AND (user_id = ? OR user_id = 0)"
            params.append(user_id)
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(query, params)
        row = await cursor.fetchone()
        if not row:
            return {"total_size_bytes": 0, "total_count": 0, "rx_count": 0, "tx_count": 0, "session_count": 0}
        return {
            "total_size_bytes": row["total_size"],
            "total_count": row["total_count"],
            "rx_count": row["rx_count"],
            "tx_count": row["tx_count"],
            "session_count": row["session_count"]
        }


async def get_oldest_recordings(user_id: Optional[int] = None, limit: int = 50) -> list[dict]:
    """Retrieve oldest recordings for quota FIFO cleanup."""
    if not aiosqlite:
        return []
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT id, file_path, file_size FROM recordings WHERE 1=1"
        params = []
        if user_id is not None and user_id > 0:
            query += " AND (user_id = ? OR user_id = 0)"
            params.append(user_id)
        query += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# Backward compatibility alias
get_oldest_unfavorite_recordings = get_oldest_recordings


async def update_recording_transcription(rec_id: str, transcription: str) -> bool:
    """Save speech transcription text for a recording."""
    if not aiosqlite or not rec_id:
        return False
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("UPDATE recordings SET transcription = ? WHERE id = ?", (transcription, rec_id))
        await db.commit()
    return True


async def get_untranscribed_recordings(user_id: Optional[int] = None, limit: int = 50, hotspot_id: Optional[str] = None) -> list[dict]:
    """Retrieve recordings that don't have transcription yet, ordered by newest first."""
    if not aiosqlite:
        return []
    async with aiosqlite.connect(str(DB_FILE)) as db:
        db.row_factory = aiosqlite.Row
        query = "SELECT * FROM recordings WHERE (transcription IS NULL OR transcription = '') AND duration >= 0.8"
        params = []
        if user_id is not None and user_id > 0:
            query += " AND (user_id = ? OR user_id = 0)"
            params.append(user_id)
        if hotspot_id:
            query += " AND hotspot_id = ?"
            params.append(hotspot_id)
        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)
        cursor = await db.execute(query, params)
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_full_backup_data(user_id: int, current_storage: Optional[dict] = None) -> dict:
    """
    Generate full backup data structure for export.
    If user_id is superadmin, exports all users, accounts, settings, and client storage.
    If regular user, exports only their own account, settings, and client storage.
    """
    if not aiosqlite:
        raise RuntimeError("Database not available")

    db_user = await get_user_by_id(user_id)
    if not db_user:
        raise ValueError("User not found")

    user_role = db_user.get("role", "user")
    is_superadmin = (user_role == "superadmin")

    if is_superadmin:
        async with aiosqlite.connect(str(DB_FILE)) as db:
            db.row_factory = aiosqlite.Row
            cursor = await db.execute(
                "SELECT id, login, password_hash, role, is_blocked, is_swl, created_at, last_login FROM users ORDER BY id ASC"
            )
            rows = await cursor.fetchall()
            all_users = [dict(r) for r in rows]

        superadmin_data = None
        users_list = []

        for u in all_users:
            u_id = u["id"]
            u_sett = await load_user_settings(u_id)
            if u_id == user_id:
                # Fresh client storage passed from browser during export
                u_storage = current_storage if (current_storage is not None) else (u_sett.get("client_settings", {}).get("storage_dump", {}))
                superadmin_data = {
                    "account": {
                        "login": u["login"],
                        "password_hash": u["password_hash"],
                        "role": u["role"],
                        "is_blocked": bool(u.get("is_blocked", 0)),
                        "is_swl": bool(u.get("is_swl", 0)),
                        "created_at": u.get("created_at", 0)
                    },
                    "settings": u_sett,
                    "client_storage": u_storage
                }
            else:
                u_storage = u_sett.get("client_settings", {}).get("storage_dump", {})
                users_list.append({
                    "account": {
                        "login": u["login"],
                        "password_hash": u["password_hash"],
                        "role": u["role"],
                        "is_blocked": bool(u.get("is_blocked", 0)),
                        "is_swl": bool(u.get("is_swl", 0)),
                        "created_at": u.get("created_at", 0)
                    },
                    "settings": u_sett,
                    "client_storage": u_storage
                })

        return {
            "format_version": 2,
            "is_superadmin_backup": True,
            "exported_by": db_user["login"],
            "timestamp": time.time(),
            "superadmin": superadmin_data,
            "users": users_list
        }
    else:
        u_sett = await load_user_settings(user_id)
        u_storage = current_storage if (current_storage is not None) else (u_sett.get("client_settings", {}).get("storage_dump", {}))
        return {
            "format_version": 2,
            "is_superadmin_backup": False,
            "exported_by": db_user["login"],
            "timestamp": time.time(),
            "user": {
                "account": {
                    "login": db_user["login"],
                    "password_hash": db_user["password_hash"],
                    "role": user_role,
                    "is_blocked": bool(db_user.get("is_blocked", 0)),
                    "is_swl": bool(db_user.get("is_swl", 0)),
                    "created_at": db_user.get("created_at", 0)
                },
                "settings": u_sett,
                "client_storage": u_storage
            }
        }


async def restore_backup_data(
    backup_data: dict,
    current_user_id: int,
    mode: str = "default",
    selected_logins: Optional[list[str]] = None
) -> dict:
    """
    Restore backup data into database.
    Supports Format Version 2 (superadmin full DB backup or single user backup)
    and Format Version 1 (legacy plain settings dict).
    """
    if not aiosqlite:
        raise RuntimeError("Database not available")

    is_v2 = isinstance(backup_data, dict) and backup_data.get("format_version") == 2
    client_storage_to_return = {}
    restored_users_count = 0

    if is_v2:
        is_sa_backup = bool(backup_data.get("is_superadmin_backup", False))
        curr_role = await get_user_role(current_user_id)

        if is_sa_backup and curr_role == "superadmin":
            # 1. Restore superadmin
            sa_data = backup_data.get("superadmin") or {}
            sa_sett = sa_data.get("settings") or {}
            sa_storage = sa_data.get("client_storage") or {}
            client_storage_to_return = sa_storage

            if sa_sett:
                if "client_settings" not in sa_sett or not isinstance(sa_sett["client_settings"], dict):
                    sa_sett["client_settings"] = {}
                sa_sett["client_settings"]["storage_dump"] = sa_storage
                await save_user_settings(current_user_id, sa_sett)
                restored_users_count += 1

            # 2. Process other users based on mode
            users_in_backup = backup_data.get("users", [])
            target_users = []
            if mode == "all_users":
                target_users = users_in_backup
            elif mode == "selected_users":
                sel_set = set(l.strip().lower() for l in (selected_logins or []))
                target_users = [u for u in users_in_backup if (u.get("account", {}).get("login") or "").strip().lower() in sel_set]

            for u_item in target_users:
                acc = u_item.get("account") or {}
                login = (acc.get("login") or "").strip().lower()
                if not login:
                    continue
                pw_hash = acc.get("password_hash") or ""
                role = acc.get("role", "user")
                if role == "superadmin":
                    role = "admin"  # Keep only primary superadmin
                is_swl = 1 if acc.get("is_swl") else 0
                is_blocked = 1 if acc.get("is_blocked") else 0
                u_sett = u_item.get("settings") or {}
                u_storage = u_item.get("client_storage") or {}
                if "client_settings" not in u_sett or not isinstance(u_sett["client_settings"], dict):
                    u_sett["client_settings"] = {}
                u_sett["client_settings"]["storage_dump"] = u_storage

                # Check existing user
                existing = await get_user_by_login(login)
                if existing:
                    target_uid = existing["id"]
                    if target_uid != current_user_id:
                        async with aiosqlite.connect(str(DB_FILE)) as db:
                            if pw_hash:
                                await db.execute(
                                    "UPDATE users SET password_hash = ?, role = ?, is_blocked = ?, is_swl = ? WHERE id = ?",
                                    (pw_hash, role, is_blocked, is_swl, target_uid)
                                )
                            else:
                                await db.execute(
                                    "UPDATE users SET role = ?, is_blocked = ?, is_swl = ? WHERE id = ?",
                                    (role, is_blocked, is_swl, target_uid)
                                )
                            await db.commit()
                        await save_user_settings(target_uid, u_sett)
                        restored_users_count += 1
                else:
                    if not pw_hash:
                        from auth import hash_password
                        pw_hash = hash_password("proxdmr123")
                    created_uid = await create_user(login, pw_hash)
                    async with aiosqlite.connect(str(DB_FILE)) as db:
                        await db.execute(
                            "UPDATE users SET role = ?, is_blocked = ?, is_swl = ? WHERE id = ?",
                            (role, is_blocked, is_swl, created_uid)
                        )
                        await db.commit()
                    await save_user_settings(created_uid, u_sett)
                    restored_users_count += 1

        else:
            # Single-user backup or non-superadmin restoring
            user_data = backup_data.get("user")
            if not user_data and is_sa_backup:
                curr_user = await get_user_by_id(current_user_id)
                curr_login = (curr_user.get("login") or "").lower() if curr_user else ""
                matching = [u for u in backup_data.get("users", []) if (u.get("account", {}).get("login") or "").lower() == curr_login]
                if matching:
                    user_data = matching[0]
                else:
                    user_data = backup_data.get("superadmin")

            if user_data:
                u_sett = user_data.get("settings") or {}
                u_storage = user_data.get("client_storage") or {}
                client_storage_to_return = u_storage
                if "client_settings" not in u_sett or not isinstance(u_sett["client_settings"], dict):
                    u_sett["client_settings"] = {}
                u_sett["client_settings"]["storage_dump"] = u_storage
                await save_user_settings(current_user_id, u_sett)
                restored_users_count = 1
    else:
        # Legacy v1 format (plain settings dict)
        client_storage_to_return = backup_data.get("client_settings", {}).get("storage_dump", {})
        await save_user_settings(current_user_id, backup_data)
        restored_users_count = 1

    return {
        "client_storage": client_storage_to_return,
        "restored_users_count": restored_users_count,
        "mode": mode
    }

