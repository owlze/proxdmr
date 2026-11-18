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

        # --- user_collections: structured per-user keyed data (pinned servers, sort prefs, etc.) ---
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_collections (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                category    TEXT NOT NULL,
                key         TEXT NOT NULL,
                value_json  TEXT NOT NULL DEFAULT '[]',
                updated_at  REAL NOT NULL,
                UNIQUE(user_id, category, key)
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_ucoll_user_cat ON user_collections(user_id, category)")

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
        "simultaneous_slots": False,
        "check_mic_on_tx": False,
        "single_hotspot_audio": False,
        "theme": "dark",
        "bg_type": "pattern",
        "bg_color": "#0f1115",
        "bg_type_dark": "pattern",
        "bg_color_dark": "#0f1115",
        "bg_type_light": "pattern",
        "bg_color_light": "#f4f6f8",
        "language": "en",
        "transcriber_enabled": False,
        "transcriber_api_key": "",
        "transcriber_api_keys": [],
        "transcriber_model": "gemini-3.5-flash",
        "transcriber_engine": "groq",
        "translation_engine": "groq",
        "transcriber_target_lang": "ru",
        "groq_api_key": "",
        "groq_api_keys": [],
        "deepgram_api_key": "",
        "gemini_use_first_key_only": False,
        "groq_use_first_key_only": False,
        "gemini_use_first_key": True,
        "gemini_use_other_keys": True,
        "groq_use_first_key": True,
        "groq_use_other_keys": True,
        "tts_enabled": False,
        "tts_engine": "piper",
        "tts_model": "gemini-3.1-flash-tts-preview",
        "tts_voice": "ru_RU-terra5871-medium",
        "tts_speed": 1.1,
        "tts_ducking_level": 0.03,
        "tts_mute_others": True,
        "tts_announce_callsign": False,
        "tts_skip_short_callsign": True,
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
                "agc_enabled": True,
                "boost_pct": 50,
                "jitter_buffer_ms": 1080,
                "active_preset": "1",
                "presets": {
                    "1": { "name": "Standard", "eq10Enable": True, "eq10Linked": True, "eq10Gains": [-7, -83, -11, 4, 2, 103, 118, 131, 25, -200], "agcEnable": True, "agcDepth": 22, "agcGain": 50, "limiterEnable": True, "jitterBuffer": 1080, "boostPct": 50 },
                    "2": { "name": "Soft Audio", "eq10Enable": True, "eq10Linked": True, "eq10Gains": [15, 10, -20, -30, 0, -15, -10, -15, -10, 0], "agcEnable": True, "agcDepth": 12, "agcGain": 35, "limiterEnable": True, "jitterBuffer": 140, "boostPct": 50 },
                    "3": { "name": "Clarity (DX)", "eq10Enable": True, "eq10Linked": True, "eq10Gains": [-40, -30, -20, 0, 20, 30, 25, 15, 0, -20], "agcEnable": True, "agcDepth": 24, "agcGain": 55, "limiterEnable": True, "jitterBuffer": 180, "boostPct": 50 }
                }
            },
            "asl_audio_rx": {
                "boost_pct": 50,
                "jitter_buffer_ms": 1100,
                "active_preset": "1",
                "presets": {
                    "1": { "name": "Standard (Linear)", "eq10Enable": True, "eq10Linked": True, "eq10Gains": [-15, -20, 25, -5, 32, 135, 168, 199, 67, -132], "agcEnable": True, "agcDepth": 19, "agcGain": 10, "limiterEnable": True, "jitterBuffer": 1100, "boostPct": 50 },
                    "2": { "name": "Soft Audio", "eq10Enable": False, "eq10Linked": True, "eq10Gains": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "agcEnable": False, "agcDepth": 12, "agcGain": 15, "limiterEnable": True, "jitterBuffer": 280, "boostPct": 50 },
                    "3": { "name": "Clear", "eq10Enable": False, "eq10Linked": True, "eq10Gains": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], "agcEnable": False, "agcDepth": 20, "agcGain": 30, "limiterEnable": True, "jitterBuffer": 320, "boostPct": 50 }
                }
            },
            "ambe_rx": {
                "spectral_enh": True,
                "high_band_gain_db": 0.5,
                "unvoiced_gain_db": -1.5,
                "active_preset": "1",
                "presets": {
                    "1": { "spectral_enh": True, "high_band_gain_db": 0.5, "unvoiced_gain_db": -1.5 },
                    "2": { "spectral_enh": True, "high_band_gain_db": 4.5, "unvoiced_gain_db": 1.0 },
                    "3": { "spectral_enh": True, "high_band_gain_db": 0.0, "unvoiced_gain_db": -1.5 }
                }
            },
            "audio_tx": {
                "mic_gain": 0,
                "noise_suppression": False,
                "browser_agc": False,
                "dsp_agc": False,
                "echo_cancellation": False,
                "gate_enabled": True,
                "gate_threshold": -45,
                "hpf_enabled": True,
                "presence_boost": 0,
                "eq_low": 0,
                "eq_mid": 0,
                "eq_high": 0,
                "eq_preset": "standard",
                "active_preset": "1",
                "presets": {
                    "1": { "name": "Standard", "txBtMicEnabled": False, "txMicGain": 0, "txNoiseSuppression": False, "txBrowserAgc": False, "txDspAgc": False, "txEchoCancellation": False, "txGateEnabled": True, "txGateThreshold": -45, "txHpfEnabled": True, "txPresenceBoost": 0, "txEqLow": 0, "txEqMid": 0, "txEqHigh": 0, "txEqPreset": "standard" },
                    "2": { "name": "Soft Voice", "txBtMicEnabled": False, "txMicGain": 2, "txNoiseSuppression": False, "txBrowserAgc": False, "txDspAgc": False, "txEchoCancellation": False, "txGateEnabled": False, "txGateThreshold": -45, "txHpfEnabled": False, "txPresenceBoost": 0, "txEqLow": -6, "txEqMid": 0, "txEqHigh": -4, "txEqPreset": "bright" },
                    "3": { "name": "Punchy / DX", "txBtMicEnabled": False, "txMicGain": 3, "txNoiseSuppression": False, "txBrowserAgc": False, "txDspAgc": False, "txEchoCancellation": False, "txGateEnabled": True, "txGateThreshold": -40, "txHpfEnabled": True, "txPresenceBoost": 6, "txEqLow": -15, "txEqMid": 7, "txEqHigh": 2, "txEqPreset": "dx" }
                }
            },
            "asl_audio_tx": {
                "mic_gain": 0,
                "noise_suppression": False,
                "browser_agc": False,
                "dsp_agc": True,
                "echo_cancellation": False,
                "gate_enabled": True,
                "gate_threshold": -45,
                "hpf_enabled": True,
                "presence_boost": 0,
                "eq_low": 0,
                "eq_mid": 0,
                "eq_high": 0,
                "eq_preset": "standard",
                "active_preset": "1",
                "presets": {
                    "1": { "txBtMicEnabled": False, "txMicGain": 0, "txNoiseSuppression": False, "txBrowserAgc": False, "txDspAgc": True, "txEchoCancellation": False, "txGateEnabled": True, "txGateThreshold": -45, "txHpfEnabled": True, "txPresenceBoost": 0, "txEqLow": 0, "txEqMid": 0, "txEqHigh": 0, "txEqPreset": "standard" },
                    "2": { "txBtMicEnabled": False, "txMicGain": 2, "txNoiseSuppression": False, "txBrowserAgc": False, "txDspAgc": True, "txEchoCancellation": False, "txGateEnabled": True, "txGateThreshold": -42, "txHpfEnabled": True, "txPresenceBoost": 2, "txEqLow": 3, "txEqMid": -1, "txEqHigh": 2, "txEqPreset": "custom" },
                    "3": { "txBtMicEnabled": False, "txMicGain": 3, "txNoiseSuppression": False, "txBrowserAgc": False, "txDspAgc": True, "txEchoCancellation": False, "txGateEnabled": True, "txGateThreshold": -40, "txHpfEnabled": True, "txPresenceBoost": 4, "txEqLow": -2, "txEqMid": 1, "txEqHigh": 4, "txEqPreset": "custom" }
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
                "name": "Main Hotspot",
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


# ── user_collections CRUD ──────────────────────────────────────────────
async def get_collection(user_id: int, category: str) -> dict:
    """Return {key: value_json_parsed, ...} for a given category."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute(
            "SELECT key, value_json FROM user_collections WHERE user_id = ? AND category = ?",
            (user_id, category)
        )
        rows = await cursor.fetchall()
        result = {}
        for k, v in rows:
            try:
                result[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                result[k] = v
        return result


async def set_collection_key(user_id: int, category: str, key: str, value) -> None:
    """Upsert a single key inside a collection category."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        value_json = json.dumps(value, ensure_ascii=False) if not isinstance(value, str) else value
        await db.execute(
            """INSERT INTO user_collections (user_id, category, key, value_json, updated_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id, category, key) DO UPDATE
               SET value_json = excluded.value_json,
                   updated_at = excluded.updated_at""",
            (user_id, category, key, value_json, time.time())
        )
        await db.commit()


async def delete_collection_key(user_id: int, category: str, key: str) -> None:
    """Remove a single key from a collection category."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute(
            "DELETE FROM user_collections WHERE user_id = ? AND category = ? AND key = ?",
            (user_id, category, key)
        )
        await db.commit()


async def get_all_collections(user_id: int) -> dict:
    """Return {category: {key: value_json_parsed, ...}, ...} for all categories of a user."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        cursor = await db.execute(
            "SELECT category, key, value_json FROM user_collections WHERE user_id = ?",
            (user_id,)
        )
        rows = await cursor.fetchall()
        result = {}
        for cat, k, v in rows:
            cat_map = result.setdefault(cat, {})
            try:
                cat_map[k] = json.loads(v)
            except (json.JSONDecodeError, TypeError):
                cat_map[k] = v
        return result


COLLECTION_STORAGE_PREFIXES = (
    "pinnedServers_",
    "srvSortMode_",
    "srvSortDir_",
    "proxdmr_asl_mem_",
    "proxdmr_quick_mem",
    "proxdmr_ysf_matrix_",
    "proxdmr_asl_quick_nodes_",
    "proxdmr_asl_default_nodes_",
    "proxdmr_ysf_scan_cfg_",
    "proxdmr_ysf_dice_cfg_",
    "proxdmr_adn_dice_cfg_",
    "proxdmr_asl_scan_cfg_",
    "proxdmr_asl_dice_cfg_",
    "proxdmr_ysf_dash_auto_",
    "proxdmr_asl_dash_auto_",
    "proxdmr_collapsed_",
    "proxdmr_live_collapsed_",
    "proxdmr_pre_collapse_mute_",
    "proxdmr_autorec_",
    "proxdmr_ysf_favorites",
)

COLLECTION_STORAGE_EXACT = {
    "proxdmr_active_hotspot_id",
    "proxdmr_my_contacts_tree",
    "proxdmr_contacts_gw",
    "proxdmr_ysf_bookmarks",
}


def is_excluded_from_storage_dump(key: str) -> bool:
    if not isinstance(key, str):
        return True
    if key in COLLECTION_STORAGE_EXACT:
        return True
    if any(key.startswith(p) for p in COLLECTION_STORAGE_PREFIXES):
        return True
    if key.startswith("proxdmr_u") and "_quick_mem" in key:
        return True
    return False


async def replace_collection(user_id: int, category: str, data: dict) -> None:
    """Replace the entire collection category atomically."""
    async with aiosqlite.connect(str(DB_FILE)) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute(
            "DELETE FROM user_collections WHERE user_id = ? AND category = ?",
            (user_id, category)
        )
        now = time.time()
        for k, v in data.items():
            value_json = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
            await db.execute(
                "INSERT INTO user_collections (user_id, category, key, value_json, updated_at) VALUES (?, ?, ?, ?, ?)",
                (user_id, category, k, value_json, now)
            )
        await db.commit()


async def migrate_storage_dump_to_collections(user_id: int, storage_dump: dict) -> bool:
    """One-time migration: extract collections from legacy storage_dump into user_collections without overwriting newer structured data."""
    if not storage_dump or not isinstance(storage_dump, dict):
        return False
    existing_all = await get_all_collections(user_id)
    migrated = False
    buckets = {
        "pinned_servers": {},
        "srv_sort_prefs": {},
        "asl_mem": {},
        "ysf_matrix": {},
        "asl_quick_nodes": {},
        "asl_default_nodes": {},
        "ysf_scan_cfg": {},
        "ysf_dice_cfg": {},
        "adn_dice_cfg": {},
        "asl_scan_cfg": {},
        "asl_dice_cfg": {},
        "ysf_dash_auto": {},
        "asl_dash_auto": {},
    }
    json_prefixes = (
        ("pinnedServers_", "pinned_servers"),
        ("proxdmr_ysf_matrix_", "ysf_matrix"),
        ("proxdmr_asl_quick_nodes_", "asl_quick_nodes"),
        ("proxdmr_asl_default_nodes_", "asl_default_nodes"),
        ("proxdmr_ysf_scan_cfg_", "ysf_scan_cfg"),
        ("proxdmr_ysf_dice_cfg_", "ysf_dice_cfg"),
        ("proxdmr_adn_dice_cfg_", "adn_dice_cfg"),
        ("proxdmr_asl_scan_cfg_", "asl_scan_cfg"),
        ("proxdmr_asl_dice_cfg_", "asl_dice_cfg"),
    )
    str_prefixes = (
        ("proxdmr_asl_mem_", "asl_mem"),
        ("proxdmr_ysf_dash_auto_", "ysf_dash_auto"),
        ("proxdmr_asl_dash_auto_", "asl_dash_auto"),
    )
    for k, v in list(storage_dump.items()):
        if not isinstance(k, str):
            continue
        if k.startswith("srvSortMode_") or k.startswith("srvSortDir_"):
            buckets["srv_sort_prefs"][k] = v
            migrated = True
            continue
        matched = False
        for pref, cat in json_prefixes:
            if k.startswith(pref):
                sub_k = k[len(pref):]
                try:
                    buckets[cat][sub_k] = json.loads(v) if isinstance(v, str) else v
                except (json.JSONDecodeError, TypeError):
                    pass
                migrated = True
                matched = True
                break
        if matched:
            continue
        for pref, cat in str_prefixes:
            if k.startswith(pref):
                sub_k = k[len(pref):]
                buckets[cat][sub_k] = str(v)
                migrated = True
                break

    for cat, payload in buckets.items():
        if not payload:
            continue
        existing_cat = existing_all.get(cat, {})
        for sub_k, sub_v in payload.items():
            if sub_k not in existing_cat:
                await set_collection_key(user_id, cat, sub_k, sub_v)
    return migrated


async def migrate_user_settings_collections(user_id: int, settings_dict: dict) -> bool:
    """One-time migration of quick_mem and contacts from root user_settings into user_collections."""
    if not isinstance(settings_dict, dict):
        return False
    existing_meta = await get_collection(user_id, "sys_meta")
    if existing_meta.get("collections_migrated_v2"):
        return False

    migrated = False
    existing_qm = await get_collection(user_id, "quick_mem")
    raw_qm = settings_dict.get("quick_mem")
    if not existing_qm and isinstance(raw_qm, dict) and raw_qm:
        await replace_collection(user_id, "quick_mem", raw_qm)
        migrated = True

    existing_contacts = await get_collection(user_id, "contacts")
    raw_contacts = settings_dict.get("contacts")
    raw_gw = settings_dict.get("contacts_gateway")
    if "tree" not in existing_contacts and isinstance(raw_contacts, list) and raw_contacts:
        await set_collection_key(user_id, "contacts", "tree", raw_contacts)
        migrated = True
    if "gateway" not in existing_contacts and isinstance(raw_gw, dict) and raw_gw:
        await set_collection_key(user_id, "contacts", "gateway", raw_gw)
        migrated = True

    await set_collection_key(user_id, "sys_meta", "collections_migrated_v2", True)
    return migrated


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
                    cs = data.get("client_settings")
                    needs_db_save = False
                    if isinstance(cs, dict):
                        sd = cs.get("storage_dump")
                        if isinstance(sd, dict):
                            stale_keys = [k for k in sd.keys() if is_excluded_from_storage_dump(k)]
                            if stale_keys:
                                await migrate_storage_dump_to_collections(user_id, sd)
                                for k in stale_keys:
                                    sd.pop(k, None)
                                data["client_settings"]["storage_dump"] = sd
                                needs_db_save = True
                                logger.info(f"[DB] Cleaned {len(stale_keys)} collection/transient keys from storage_dump for user {user_id}")

                    await migrate_user_settings_collections(user_id, data)

                    if needs_db_save:
                        settings_json = json.dumps(data, ensure_ascii=False)
                        await db.execute(
                            """UPDATE user_settings SET settings_json = ?, updated_at = ?
                               WHERE user_id = ?""",
                            (settings_json, time.time(), user_id)
                        )
                        await db.commit()
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


def _enrich_asl_recording(rec: Optional[dict]) -> Optional[dict]:
    if not rec or not isinstance(rec, dict):
        return rec
    call_id = str(rec.get("call_id") or "")
    hotspot_id = str(rec.get("hotspot_id") or "")
    is_asl = call_id.startswith("asl_") or ("allstar" in hotspot_id.lower())
    if is_asl:
        rec["network_type"] = "allstar"
        node_str = str(rec.get("src_id") or "").strip()
        if not node_str or node_str == "0":
            parts = call_id.split("_")
            if len(parts) >= 3 and parts[-1].isdigit():
                node_str = parts[-1]
        if node_str and node_str != "0":
            try:
                from allstar_directory import allstar_dir_mgr
                info = allstar_dir_mgr.get_node_info(node_str)
                if info:
                    rec["country"] = info.get("country") or rec.get("country") or "INT"
                    rec["flag"] = info.get("flag") or rec.get("flag") or "🌐"
                    if not rec.get("src_name") and info.get("name"):
                        rec["src_name"] = info.get("name")
            except Exception:
                pass
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
        recordings = [_enrich_asl_recording(dict(r)) for r in rows]
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
        res = _enrich_asl_recording(dict(row))
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
        res = _enrich_asl_recording(dict(row))
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


def _remap_user_scoped_storage(
    storage: Optional[dict],
    old_uid: Optional[int],
    new_uid: Optional[int],
) -> dict:
    """
    Remap user-scoped localStorage keys (`proxdmr_u{old_uid}_*` -> `proxdmr_u{new_uid}_*`)
    and custom wallpaper URLs (`bg-custom-u{old_uid}-` -> `bg-custom-u{new_uid}-`) when
    an account is restored onto a server where its numeric `user_id` differs.
    """
    if not isinstance(storage, dict):
        return {}

    import re as _re

    detected_old = old_uid
    if detected_old is None and new_uid is not None:
        found_uids = set()
        for k in storage.keys():
            if isinstance(k, str):
                m = _re.match(r"^proxdmr_u(\d+)_", k)
                if m:
                    found_uids.add(int(m.group(1)))
        if len(found_uids) == 1:
            detected_old = next(iter(found_uids))

    remapped: dict = {}
    for k, v in storage.items():
        if not isinstance(k, str) or not k:
            continue
        new_key = k
        if new_uid is not None:
            m = _re.match(r"^proxdmr_u(\d+)_(.+)$", k)
            if m:
                key_uid = int(m.group(1))
                suffix = m.group(2)
                if detected_old is not None and key_uid == int(detected_old):
                    new_key = f"proxdmr_u{int(new_uid)}_{suffix}"
                elif key_uid == int(new_uid):
                    new_key = k
                else:
                    # Drop stale foreign user-scoped keys from another user on shared browser
                    continue

        new_val = v
        if isinstance(v, str) and new_uid is not None:
            if detected_old is not None and int(detected_old) != int(new_uid):
                new_val = v.replace(
                    f"/static/img/wallpapers/bg-custom-u{int(detected_old)}-",
                    f"/static/img/wallpapers/bg-custom-u{int(new_uid)}-",
                )
            if "/static/img/bg-custom-dark.jpg" in new_val:
                new_val = new_val.replace(
                    "/static/img/bg-custom-dark.jpg",
                    f"/static/img/wallpapers/bg-custom-u{int(new_uid)}-dark.jpg",
                )
            if "/static/img/bg-custom-light.jpg" in new_val:
                new_val = new_val.replace(
                    "/static/img/bg-custom-light.jpg",
                    f"/static/img/wallpapers/bg-custom-u{int(new_uid)}-light.jpg",
                )
        remapped[new_key] = new_val

    return remapped


async def get_full_backup_data(
    user_id: int,
    current_storage: Optional[dict] = None,
    server_config: Optional[dict] = None,
    live_settings_map: Optional[dict] = None,
) -> dict:
    """
    Generate full backup data structure for export.
    If user_id is superadmin, exports server_config, all users, accounts, settings, and client storage.
    If regular user, exports only their own account, settings, and client storage.
    """
    if not aiosqlite:
        raise RuntimeError("Database not available")

    db_user = await get_user_by_id(user_id)
    if not db_user:
        raise ValueError("User not found")

    user_role = db_user.get("role", "user")
    is_superadmin = (user_role == "superadmin")
    live_map = live_settings_map if isinstance(live_settings_map, dict) else {}

    def _merge_user_sett(uid_val: int, db_sett: dict, browser_storage: Optional[dict] = None) -> tuple[dict, dict]:
        merged = dict(db_sett) if isinstance(db_sett, dict) else {}
        live_override = live_map.get(uid_val)
        if isinstance(live_override, dict):
            # Preserve any extra keys in DB while applying freshest in-memory runtime values
            merged_cs = dict(merged.get("client_settings") or {}) if isinstance(merged.get("client_settings"), dict) else {}
            live_cs = live_override.get("client_settings")
            if isinstance(live_cs, dict):
                merged_cs.update(live_cs)
            merged.update(live_override)
            if merged_cs:
                merged["client_settings"] = merged_cs
        cs_obj = merged.get("client_settings")
        if not isinstance(cs_obj, dict):
            cs_obj = {}
            merged["client_settings"] = cs_obj
        if browser_storage is not None and isinstance(browser_storage, dict):
            u_storage = dict(browser_storage)
            cs_obj["storage_dump"] = u_storage
        else:
            sd = cs_obj.get("storage_dump")
            u_storage = dict(sd) if isinstance(sd, dict) else {}
        return merged, u_storage

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
            raw_sett = await load_user_settings(u_id)
            if u_id == user_id:
                u_sett, u_storage = _merge_user_sett(u_id, raw_sett, browser_storage=current_storage)
                superadmin_data = {
                    "exported_user_id": u_id,
                    "account": {
                        "id": u_id,
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
                u_sett, u_storage = _merge_user_sett(u_id, raw_sett, browser_storage=None)
                users_list.append({
                    "exported_user_id": u_id,
                    "account": {
                        "id": u_id,
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
            "exported_user_id": user_id,
            "timestamp": time.time(),
            "server_config": server_config if isinstance(server_config, dict) else {},
            "superadmin": superadmin_data,
            "users": users_list
        }
    else:
        raw_sett = await load_user_settings(user_id)
        u_sett, u_storage = _merge_user_sett(user_id, raw_sett, browser_storage=current_storage)
        return {
            "format_version": 2,
            "is_superadmin_backup": False,
            "exported_by": db_user["login"],
            "exported_user_id": user_id,
            "timestamp": time.time(),
            "user": {
                "exported_user_id": user_id,
                "account": {
                    "id": user_id,
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
    restored_users: list[dict] = []
    exported_uid_for_caller: Optional[int] = None
    server_config_to_return: dict = {}

    curr_db_user = await get_user_by_id(current_user_id)
    curr_login_actual = (curr_db_user.get("login") or "").lower() if curr_db_user else ""

    if is_v2:
        is_sa_backup = bool(backup_data.get("is_superadmin_backup", False))
        curr_role = await get_user_role(current_user_id)

        if is_sa_backup and curr_role == "superadmin":
            if isinstance(backup_data.get("server_config"), dict):
                server_config_to_return = dict(backup_data["server_config"])

            # 1. Restore superadmin
            sa_data = backup_data.get("superadmin") or {}
            sa_acc = sa_data.get("account") or {}
            raw_sa_old_uid = sa_data.get("exported_user_id", sa_acc.get("id", backup_data.get("exported_user_id")))
            sa_old_uid = int(raw_sa_old_uid) if isinstance(raw_sa_old_uid, int) or (isinstance(raw_sa_old_uid, str) and raw_sa_old_uid.isdigit()) else None
            exported_uid_for_caller = sa_old_uid

            sa_sett = dict(sa_data.get("settings") or {})
            raw_sa_storage = sa_data.get("client_storage") or (sa_sett.get("client_settings", {}) or {}).get("storage_dump", {})
            sa_storage = _remap_user_scoped_storage(raw_sa_storage, sa_old_uid, current_user_id)
            client_storage_to_return = sa_storage

            if "is_swl" in sa_acc:
                await set_user_swl(current_user_id, bool(sa_acc.get("is_swl", False)))

            if sa_sett or sa_storage:
                if "client_settings" not in sa_sett or not isinstance(sa_sett["client_settings"], dict):
                    sa_sett["client_settings"] = {}
                else:
                    sa_sett["client_settings"] = dict(sa_sett["client_settings"])
                sa_sett["client_settings"]["storage_dump"] = sa_storage
                await save_user_settings(current_user_id, sa_sett)
                restored_users_count += 1
                restored_users.append({
                    "user_id": current_user_id,
                    "login": curr_login_actual or (sa_acc.get("login") or "").strip().lower(),
                    "backup_login": (sa_acc.get("login") or "").strip().lower(),
                    "exported_user_id": sa_old_uid,
                })

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
                raw_u_old_uid = u_item.get("exported_user_id", acc.get("id"))
                u_old_uid = int(raw_u_old_uid) if isinstance(raw_u_old_uid, int) or (isinstance(raw_u_old_uid, str) and raw_u_old_uid.isdigit()) else None
                pw_hash = acc.get("password_hash") or ""
                role = acc.get("role", "user")
                if role == "superadmin":
                    role = "admin"  # Keep only primary superadmin
                is_swl = 1 if acc.get("is_swl") else 0
                is_blocked = 1 if acc.get("is_blocked") else 0
                u_sett = dict(u_item.get("settings") or {})
                raw_u_storage = u_item.get("client_storage") or (u_sett.get("client_settings", {}) or {}).get("storage_dump", {})

                # Check existing user
                existing = await get_user_by_login(login)
                if existing:
                    target_uid = existing["id"]
                    if target_uid != current_user_id:
                        u_storage = _remap_user_scoped_storage(raw_u_storage, u_old_uid, target_uid)
                        if "client_settings" not in u_sett or not isinstance(u_sett["client_settings"], dict):
                            u_sett["client_settings"] = {}
                        else:
                            u_sett["client_settings"] = dict(u_sett["client_settings"])
                        u_sett["client_settings"]["storage_dump"] = u_storage
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
                        restored_users.append({
                            "user_id": target_uid,
                            "login": login,
                            "backup_login": login,
                            "exported_user_id": u_old_uid,
                        })
                else:
                    if not pw_hash:
                        from auth import hash_password
                        pw_hash = hash_password("proxdmr123")
                    created_uid = await create_user(login, pw_hash)
                    u_storage = _remap_user_scoped_storage(raw_u_storage, u_old_uid, created_uid)
                    if "client_settings" not in u_sett or not isinstance(u_sett["client_settings"], dict):
                        u_sett["client_settings"] = {}
                    else:
                        u_sett["client_settings"] = dict(u_sett["client_settings"])
                    u_sett["client_settings"]["storage_dump"] = u_storage
                    async with aiosqlite.connect(str(DB_FILE)) as db:
                        await db.execute(
                            "UPDATE users SET role = ?, is_blocked = ?, is_swl = ? WHERE id = ?",
                            (role, is_blocked, is_swl, created_uid)
                        )
                        await db.commit()
                    await save_user_settings(created_uid, u_sett)
                    restored_users_count += 1
                    restored_users.append({
                        "user_id": created_uid,
                        "login": login,
                        "backup_login": login,
                        "exported_user_id": u_old_uid,
                    })

        else:
            # Single-user backup or non-superadmin restoring
            user_data = backup_data.get("user")
            if not user_data and is_sa_backup:
                matching = [u for u in backup_data.get("users", []) if (u.get("account", {}).get("login") or "").lower() == curr_login_actual]
                if matching:
                    user_data = matching[0]
                else:
                    user_data = backup_data.get("superadmin")

            if user_data:
                u_acc = user_data.get("account") or {}
                raw_u_old_uid = user_data.get("exported_user_id", u_acc.get("id", backup_data.get("exported_user_id")))
                u_old_uid = int(raw_u_old_uid) if isinstance(raw_u_old_uid, int) or (isinstance(raw_u_old_uid, str) and raw_u_old_uid.isdigit()) else None
                exported_uid_for_caller = u_old_uid

                u_sett = dict(user_data.get("settings") or {})
                raw_u_storage = user_data.get("client_storage") or (u_sett.get("client_settings", {}) or {}).get("storage_dump", {})
                u_storage = _remap_user_scoped_storage(raw_u_storage, u_old_uid, current_user_id)
                client_storage_to_return = u_storage
                if "client_settings" not in u_sett or not isinstance(u_sett["client_settings"], dict):
                    u_sett["client_settings"] = {}
                else:
                    u_sett["client_settings"] = dict(u_sett["client_settings"])
                u_sett["client_settings"]["storage_dump"] = u_storage
                await save_user_settings(current_user_id, u_sett)
                restored_users_count = 1
                restored_users.append({
                    "user_id": current_user_id,
                    "login": curr_login_actual,
                    "backup_login": (u_acc.get("login") or backup_data.get("exported_by") or curr_login_actual).strip().lower(),
                    "exported_user_id": u_old_uid,
                })
    else:
        # Legacy v1 format (plain settings dict)
        legacy_copy = dict(backup_data) if isinstance(backup_data, dict) else {}
        raw_legacy_storage = (legacy_copy.get("client_settings") or {}).get("storage_dump", {}) if isinstance(legacy_copy.get("client_settings"), dict) else {}
        remapped_legacy = _remap_user_scoped_storage(raw_legacy_storage, None, current_user_id)
        if isinstance(legacy_copy.get("client_settings"), dict):
            legacy_copy["client_settings"] = dict(legacy_copy["client_settings"])
            legacy_copy["client_settings"]["storage_dump"] = remapped_legacy
        client_storage_to_return = remapped_legacy
        await save_user_settings(current_user_id, legacy_copy)
        restored_users_count = 1
        restored_users.append({
            "user_id": current_user_id,
            "login": curr_login_actual,
            "backup_login": curr_login_actual,
            "exported_user_id": None,
        })

    return {
        "client_storage": client_storage_to_return,
        "restored_users_count": restored_users_count,
        "restored_user_id": current_user_id,
        "exported_user_id": exported_uid_for_caller,
        "restored_users": restored_users,
        "server_config": server_config_to_return,
        "mode": mode
    }

