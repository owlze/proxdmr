"""
ProxDMR Visitor Statistics — anonymous per-server counters of unique clients by country.

What is stored (config/visitor_stats.db, a separate mini SQLite database):
  * visitors(vid, country, first_seen, last_seen, visits) — `vid` is a salted SHA-256 hash of a
    random per-browser cookie (or of IP+User-Agent when cookies are unavailable). The raw IP
    address, the cookie value and the User-Agent are never written to disk.
  * meta(key, value) — instance id, hashing salt, collection start time, sharing flag.

What can be sent to the project author's monitoring server (superadmin checkbox, enabled by
default): only aggregated quantities — unique clients per country for the last 24 hours and for
the whole lifetime of this copy of the server. Each request is signed with a per-server Ed25519
key (config/stats_ed25519.pem); there is no shared secret inside the distribution.

Handshake with the monitor (hmon on razrab.duckdns.org):
  1. POST {base}/nodes/register  {instance_id, instance_name, public_key, version}
     -> the node is queued as "pending" until the author approves it manually.
  2. POST {base}/report_stats    {instance_id, timestamp, version, visitors{...}}
     header X-Signature = base64(Ed25519(raw request body)), header X-Instance-Id.
     Reports of pending/blocked nodes are ignored by the monitor.
Any network or protocol failure is swallowed silently and never affects the radio gateway.
"""

import asyncio
import base64
import hashlib
import ipaddress
import json
import logging
import os
import random
import re
import secrets
import time
import urllib.error
import urllib.request
import uuid
from collections import OrderedDict
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

try:
    import aiosqlite
except ImportError:  # pragma: no cover
    aiosqlite = None

try:
    from version import APP_VERSION
except ImportError:  # pragma: no cover
    from src.version import APP_VERSION

logger = logging.getLogger("proxdmr.visitor_stats")

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
DB_FILE = CONFIG_DIR / "visitor_stats.db"
KEY_FILE = CONFIG_DIR / "stats_ed25519.pem"

STATS_BASE_URL = os.getenv("PROXDMR_STATS_URL", "https://razrab.duckdns.org/hmon/api").rstrip("/")

CID_COOKIE = "proxdmr_cid"
CID_MAX_AGE = 365 * 86400
_CID_RE = re.compile(r"^[0-9a-f]{32}$")

DAY_SEC = 86400
REPORT_INTERVAL_SEC = 300          # monitor marks nodes silent for >15 min as offline
RECENT_VISIT_THROTTLE_SEC = 60     # collapse reconnect storms of the same client
REGISTER_RETRY_SEC = 3600
REGISTER_RATE_LIMIT_BACKOFF_SEC = 6 * 3600
GEO_CACHE_MAX = 5000
GEO_FAIL_RETRY_SEC = 600

_inited = False
_enabled = True
_salt = ""
_instance_id = ""
_registered = False
_recent: Dict[str, float] = {}
_geo_cache: "OrderedDict[str, str]" = OrderedDict()
_geo_fail: Dict[str, float] = {}
_last_state = ""


# ---------------------------------------------------------------------------
# Initialisation / settings
# ---------------------------------------------------------------------------

async def _meta_get(db, key: str) -> Optional[str]:
    cur = await db.execute("SELECT value FROM meta WHERE key = ?", (key,))
    row = await cur.fetchone()
    return row[0] if row else None


async def _meta_set(db, key: str, value: str) -> None:
    await db.execute(
        "INSERT INTO meta(key, value) VALUES(?, ?) "
        "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


async def init() -> None:
    """Create the mini database (if needed) and load runtime settings. Safe to call repeatedly."""
    global _inited, _enabled, _salt, _instance_id, _registered
    if not aiosqlite:
        logger.warning("[STATS] aiosqlite is not installed — visitor statistics disabled")
        return
    try:
        CONFIG_DIR.mkdir(parents=True, exist_ok=True)
        async with aiosqlite.connect(str(DB_FILE), timeout=10) as db:
            await db.execute("PRAGMA journal_mode=WAL")
            await db.execute(
                "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
            )
            await db.execute(
                """CREATE TABLE IF NOT EXISTS visitors (
                       vid        TEXT PRIMARY KEY,
                       country    TEXT NOT NULL DEFAULT 'XX',
                       first_seen REAL NOT NULL,
                       last_seen  REAL NOT NULL,
                       visits     INTEGER NOT NULL DEFAULT 1
                   )"""
            )
            await db.execute("CREATE INDEX IF NOT EXISTS idx_visitors_country ON visitors(country)")
            await db.execute("CREATE INDEX IF NOT EXISTS idx_visitors_last_seen ON visitors(last_seen)")

            if not await _meta_get(db, "instance_id"):
                await _meta_set(db, "instance_id", uuid.uuid4().hex)
            if not await _meta_get(db, "salt"):
                await _meta_set(db, "salt", secrets.token_hex(16))
            if not await _meta_get(db, "started_at"):
                await _meta_set(db, "started_at", str(int(time.time())))
            if await _meta_get(db, "share_enabled") is None:
                await _meta_set(db, "share_enabled", "1")
            await db.commit()

            _instance_id = await _meta_get(db, "instance_id") or ""
            _salt = await _meta_get(db, "salt") or ""
            _enabled = (await _meta_get(db, "share_enabled")) != "0"
            _registered = (await _meta_get(db, "registered")) == "1"
        _inited = True
        logger.info(f"[STATS] Visitor statistics database ready: {DB_FILE} (sharing={'on' if _enabled else 'off'})")
    except Exception as e:
        logger.warning(f"[STATS] Failed to initialise visitor statistics: {e}")


def is_enabled() -> bool:
    return _enabled


async def set_enabled(value: bool) -> bool:
    """Persist the 'send statistics to the author's monitoring server' flag."""
    global _enabled
    _enabled = bool(value)
    if aiosqlite and _inited:
        try:
            async with aiosqlite.connect(str(DB_FILE), timeout=10) as db:
                await _meta_set(db, "share_enabled", "1" if _enabled else "0")
                await db.commit()
        except Exception as e:
            logger.warning(f"[STATS] Failed to save sharing flag: {e}")
    return _enabled


# ---------------------------------------------------------------------------
# Client identification
# ---------------------------------------------------------------------------

def client_ip(request_or_ws) -> str:
    headers = getattr(request_or_ws, "headers", {}) or {}
    xff = headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    xri = headers.get("x-real-ip")
    if xri:
        return xri.strip()
    client = getattr(request_or_ws, "client", None)
    return client.host if client and client.host else "unknown"


def ensure_cid_cookie(request, response) -> None:
    """Give a browser a long-lived random anonymous client cookie (no personal data)."""
    try:
        cid = request.cookies.get(CID_COOKIE)
        if cid and _CID_RE.match(cid):
            return
        response.set_cookie(
            key=CID_COOKIE,
            value=uuid.uuid4().hex,
            max_age=CID_MAX_AGE,
            httponly=True,
            secure=False,
            samesite="lax",
            path="/",
        )
    except Exception:
        pass


def _make_vid(cid: Optional[str], ip: str, ua: str) -> str:
    if cid and _CID_RE.match(cid):
        base = "c:" + cid
    else:
        base = f"f:{ip}|{(ua or '')[:200]}"
    return hashlib.sha256((_salt + base).encode("utf-8")).hexdigest()[:32]


# ---------------------------------------------------------------------------
# Country lookup (cached, never blocks the event loop)
# ---------------------------------------------------------------------------

def _is_public_ip(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_global
    except ValueError:
        return False


def _fetch_json(url: str) -> Optional[dict]:
    req = urllib.request.Request(url, headers={"User-Agent": "ProxDMR-Stats/1.0"})
    with urllib.request.urlopen(req, timeout=4) as resp:
        return json.loads(resp.read(16384).decode("utf-8", "replace"))


def _geo_lookup_sync(ip: str) -> Optional[str]:
    providers = (
        (f"https://ipwho.is/{ip}?fields=success,country_code", "country_code"),
        (f"https://get.geojs.io/v1/ip/country/{ip}.json", "country"),
    )
    for url, field in providers:
        try:
            data = _fetch_json(url)
            if isinstance(data, dict) and data.get("success", True) is not False:
                code = str(data.get(field) or "").strip().upper()
                if len(code) == 2 and code.isalpha():
                    return code
        except Exception:
            continue
    return None


async def resolve_country(ip: str) -> str:
    """ISO-3166 alpha-2 code, 'LAN' for non-public addresses, 'XX' when unknown."""
    if not _is_public_ip(ip):
        return "LAN"
    cached = _geo_cache.get(ip)
    if cached:
        _geo_cache.move_to_end(ip)
        return cached
    failed_at = _geo_fail.get(ip)
    if failed_at and time.time() - failed_at < GEO_FAIL_RETRY_SEC:
        return "XX"
    code = await asyncio.to_thread(_geo_lookup_sync, ip)
    if code:
        _geo_cache[ip] = code
        while len(_geo_cache) > GEO_CACHE_MAX:
            _geo_cache.popitem(last=False)
        return code
    _geo_fail[ip] = time.time()
    if len(_geo_fail) > GEO_CACHE_MAX:
        _geo_fail.clear()
    return "XX"


# ---------------------------------------------------------------------------
# Recording and aggregation
# ---------------------------------------------------------------------------

async def record_visit(ip: str, user_agent: str = "", cid: Optional[str] = None) -> None:
    """Count one client connection. Must be fire-and-forget: never raises."""
    if not (_inited and aiosqlite):
        return
    try:
        vid = _make_vid(cid, ip, user_agent)
        now = time.time()
        last = _recent.get(vid)
        if last and now - last < RECENT_VISIT_THROTTLE_SEC:
            return
        _recent[vid] = now
        if len(_recent) > 5000:
            cutoff = now - RECENT_VISIT_THROTTLE_SEC
            for k in [k for k, t in _recent.items() if t < cutoff]:
                _recent.pop(k, None)

        country = await resolve_country(ip)
        async with aiosqlite.connect(str(DB_FILE), timeout=10) as db:
            cur = await db.execute("SELECT country FROM visitors WHERE vid = ?", (vid,))
            row = await cur.fetchone()
            if row:
                new_country = country if country != "XX" else row[0]
                await db.execute(
                    "UPDATE visitors SET last_seen = ?, visits = visits + 1, country = ? WHERE vid = ?",
                    (now, new_country, vid),
                )
            else:
                await db.execute(
                    "INSERT INTO visitors(vid, country, first_seen, last_seen, visits) VALUES(?, ?, ?, ?, 1)",
                    (vid, country, now, now),
                )
            await db.commit()
    except Exception as e:
        logger.debug(f"[STATS] record_visit failed: {e}")


async def build_report() -> Dict[str, Any]:
    """Aggregate numbers only: unique clients for the last 24 h and for all time, by country."""
    now = time.time()
    since = now - DAY_SEC
    async with aiosqlite.connect(str(DB_FILE), timeout=10) as db:
        cur = await db.execute(
            "SELECT country, COUNT(*), SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) "
            "FROM visitors GROUP BY country",
            (since,),
        )
        rows = await cur.fetchall()
    day_total = all_total = 0
    countries = []
    for code, total, day in rows:
        day = int(day or 0)
        total = int(total or 0)
        day_total += day
        all_total += total
        if isinstance(code, str) and len(code) == 2 and code.isalpha() and code != "XX":
            countries.append({"code": code.upper(), "day": day, "total": total})
    countries.sort(key=lambda c: (-c["day"], -c["total"], c["code"]))
    return {"day_total": day_total, "all_total": all_total, "countries": countries}


# ---------------------------------------------------------------------------
# Signed reporting to the author's monitoring server
# ---------------------------------------------------------------------------

def _load_or_create_key():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    if KEY_FILE.exists():
        return serialization.load_pem_private_key(KEY_FILE.read_bytes(), password=None)
    key = Ed25519PrivateKey.generate()
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    try:
        os.chmod(KEY_FILE, 0o600)
    except Exception:
        pass
    return key


def _public_key_b64(key) -> str:
    from cryptography.hazmat.primitives import serialization

    raw = key.public_key().public_bytes(
        encoding=serialization.Encoding.Raw, format=serialization.PublicFormat.Raw
    )
    return base64.b64encode(raw).decode("ascii")


def _instance_name() -> str:
    label = (os.getenv("SERVER_LABEL") or "").strip()
    return label[:64] if label else f"ProxDMR-{_instance_id[:6]}"


def _post_json_sync(path: str, raw_body: bytes, headers: Dict[str, str]) -> Tuple[int, Dict[str, Any]]:
    req = urllib.request.Request(
        STATS_BASE_URL + path,
        data=raw_body,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": "ProxDMR-Stats/1.0", **headers},
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            code, data = resp.status, resp.read(65536)
    except urllib.error.HTTPError as e:
        code, data = e.code, e.read(65536)
    try:
        parsed = json.loads(data.decode("utf-8", "replace")) if data else {}
    except Exception:
        parsed = {}
    return code, parsed if isinstance(parsed, dict) else {}


def _dumps(obj: Dict[str, Any]) -> bytes:
    return json.dumps(obj, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode("utf-8")


def _note_state(state: str) -> None:
    global _last_state
    if state != _last_state:
        _last_state = state
        logger.info(f"[STATS] {state}")


async def _set_registered(value: bool) -> None:
    global _registered
    _registered = value
    try:
        async with aiosqlite.connect(str(DB_FILE), timeout=10) as db:
            await _meta_set(db, "registered", "1" if value else "0")
            await db.commit()
    except Exception:
        pass


async def _signed_post(key, path: str, body: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    raw = _dumps(body)
    sig = base64.b64encode(key.sign(raw)).decode("ascii")
    return await asyncio.to_thread(
        _post_json_sync, path, raw, {"X-Signature": sig, "X-Instance-Id": _instance_id}
    )


async def _report_cycle(key) -> float:
    """One register/report iteration. Returns extra seconds to wait before the next attempt."""
    if not _registered:
        code, data = await _signed_post(
            key,
            "/nodes/register",
            {
                "instance_id": _instance_id,
                "instance_name": _instance_name(),
                "public_key": _public_key_b64(key),
                "version": APP_VERSION,
            },
        )
        if code in (200, 201, 202):
            await _set_registered(True)
            _note_state(f"Registered on the monitoring server (status={data.get('status', 'pending')})")
        elif code == 429:
            _note_state("Registration rate-limited by the monitoring server, will retry later")
            return REGISTER_RATE_LIMIT_BACKOFF_SEC
        else:
            _note_state(f"Monitoring server unavailable for registration (HTTP {code}), will retry later")
            return REGISTER_RETRY_SEC
        return 0

    report = await build_report()
    code, data = await _signed_post(
        key,
        "/report_stats",
        {
            "instance_id": _instance_id,
            "timestamp": int(time.time()),
            "version": APP_VERSION,
            "visitors": report,
        },
    )
    if code == 200:
        _note_state("Statistics accepted by the monitoring server")
    elif data.get("status") in ("unregistered", "unknown_node"):
        await _set_registered(False)
        _note_state("Monitoring server does not know this node, will register again")
    elif code in (401, 403):
        _note_state(f"Statistics not accepted yet (status={data.get('status', code)}) — waiting for approval")
    else:
        _note_state(f"Statistics report failed (HTTP {code})")
    return 0


async def reporter_loop() -> None:
    """Background task: periodically push aggregated statistics (if enabled by the superadmin)."""
    await asyncio.sleep(60 + random.uniform(0, 30))
    extra_wait = 0.0
    while True:
        try:
            if _enabled and _inited and aiosqlite:
                key = await asyncio.to_thread(_load_or_create_key)
                extra_wait = await _report_cycle(key)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _note_state(f"Statistics cycle failed: {type(e).__name__}")
            logger.debug(f"[STATS] cycle error: {e}")
        await asyncio.sleep(REPORT_INTERVAL_SEC + extra_wait + random.uniform(0, 30))
        extra_wait = 0.0
