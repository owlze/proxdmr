import asyncio
import base64
import json
import logging
import os
import re
import sys
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional, Set, Any

from pydantic import BaseModel
import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, Response, Cookie, UploadFile, File, Form
from starlette.websockets import WebSocketState
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BASE_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = BASE_DIR.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

try:
    from config import AppSettings, HotspotConfig, load_app_settings, save_app_settings
    from dmr.homebrew import BMState
    from dmr.manager import HotspotManager
    from dmr.tg_resolver import tg_resolver
    from dmr.user_db import user_db
    from dmr.hamqth import hamqth_service
    from ping import BMPingService, ClientPingService
    from ssl_helper import ensure_ssl_certificates
    from transcriber import GeminiTranscriberService, get_tts_test_phrase
    from version import APP_VERSION, APP_VERSION_DATE, APK_VERSION, APK_VERSION_DATE, get_apk_filename
    from auth import hash_password, verify_password, create_jwt, verify_jwt, validate_login, validate_password, JWT_EXPIRY_DAYS_REMEMBER, LOGIN_MIN_LENGTH, LOGIN_MAX_LENGTH
    from database import (
        init_db, create_user, get_user_by_login, get_user_by_id, update_last_login,
        save_user_settings, load_user_settings, delete_user, list_users, login_exists,
        user_count, get_default_settings, create_recording, get_recordings,
        get_recording_by_id, get_recording_by_call_id, delete_recording,
        delete_all_recordings, get_recordings_stats,
        update_recording_transcription, get_untranscribed_recordings, RECORDINGS_DIR,
        get_user_role, set_user_role, set_user_blocked, is_user_blocked, update_user_password,
        is_user_swl, set_user_swl
    )
    from settings_io import export_settings, import_settings, get_export_filename
except ImportError:
    from src.config import AppSettings, HotspotConfig, load_app_settings, save_app_settings
    from src.dmr.homebrew import BMState
    from src.dmr.manager import HotspotManager
    from src.dmr.tg_resolver import tg_resolver
    from src.dmr.user_db import user_db
    from src.dmr.hamqth import hamqth_service
    from src.ping import BMPingService, ClientPingService
    from src.ssl_helper import ensure_ssl_certificates
    from src.transcriber import GeminiTranscriberService
    from src.version import APP_VERSION, APP_VERSION_DATE, APK_VERSION, APK_VERSION_DATE, get_apk_filename
    from src.auth import hash_password, verify_password, create_jwt, verify_jwt, validate_login, validate_password, JWT_EXPIRY_DAYS_REMEMBER, LOGIN_MIN_LENGTH, LOGIN_MAX_LENGTH
    from src.database import (
        init_db, create_user, get_user_by_login, get_user_by_id, update_last_login,
        save_user_settings, load_user_settings, delete_user, list_users, login_exists,
        user_count, get_default_settings, create_recording, get_recordings,
        get_recording_by_id, get_recording_by_call_id, delete_recording,
        delete_all_recordings, get_recordings_stats,
        update_recording_transcription, get_untranscribed_recordings, RECORDINGS_DIR,
        get_user_role, set_user_role, set_user_blocked, is_user_blocked, update_user_password,
        is_user_swl, set_user_swl
    )
    from src.settings_io import export_settings, import_settings, get_export_filename

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler(str(BASE_DIR / "proxdmr.log"), encoding="utf-8")
    ]
)
logger = logging.getLogger("proxdmr.main")

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"

app_settings = load_app_settings()
connected_clients: Set[WebSocket] = set()
user_clients: Dict[int, Set[WebSocket]] = {}
ws_user_map: Dict[WebSocket, int] = {}

class RadioState:
    def __init__(self):
        self.is_transmitting = False
        self.transmitting_client_id: Optional[str] = None
        self.tx_start_time: float = 0.0
        self.tx_slot: int = 2  # Default transmitting slot (2 for simplex/local, 1 for DX)
        self.active_tg: int = 2501
        self.is_rx: bool = False
        self.is_loopback: bool = False

radio_state = RadioState()
user_radio_states: Dict[int, RadioState] = {}

def get_user_radio_state(user_id: int) -> RadioState:
    if user_id not in user_radio_states:
        user_radio_states[user_id] = RadioState()
    return user_radio_states[user_id]

async def broadcast_user_json(user_id: int, data: dict, exclude: Optional[WebSocket] = None):
    sockets = user_clients.get(user_id)
    if not sockets:
        return
    targets = [ws for ws in list(sockets) if ws != exclude and ws.client_state == WebSocketState.CONNECTED]
    if not targets:
        return
    msg = json.dumps(data)
    results = await asyncio.gather(*[_send_ws_text(ws, msg) for ws in targets], return_exceptions=True)
    dead_clients = {ws for ws, ok in zip(targets, results) if ok is not True}
    if dead_clients:
        sockets.difference_update(dead_clients)
        connected_clients.difference_update(dead_clients)
        for ws in dead_clients:
            ws_user_map.pop(ws, None)

async def _send_ws_bytes(ws: WebSocket, data: bytes) -> bool:
    try:
        await asyncio.wait_for(ws.send_bytes(data), timeout=0.3)
        return True
    except Exception:
        return False

async def _send_ws_text(ws: WebSocket, text: str) -> bool:
    try:
        await asyncio.wait_for(ws.send_text(text), timeout=0.5)
        return True
    except Exception:
        return False

async def broadcast_user_binary(user_id: int, data: bytes, exclude: Optional[WebSocket] = None):
    sockets = user_clients.get(user_id)
    if not sockets:
        return
    targets = [ws for ws in list(sockets) if ws != exclude and ws.client_state == WebSocketState.CONNECTED]
    if not targets:
        return
    results = await asyncio.gather(*[_send_ws_bytes(ws, data) for ws in targets], return_exceptions=True)
    dead_clients = {ws for ws, ok in zip(targets, results) if ok is not True}
    if dead_clients:
        sockets.difference_update(dead_clients)
        connected_clients.difference_update(dead_clients)
        for ws in dead_clients:
            ws_user_map.pop(ws, None)

async def broadcast_json(data: dict, exclude: Optional[WebSocket] = None, user_id: Optional[int] = None):
    target_uid = user_id if user_id is not None else data.get("user_id")
    if target_uid is None and data.get("hotspot_id"):
        hid = str(data.get("hotspot_id", "")).strip()
        if hid and hasattr(hotspot_manager, "user_runtimes"):
            for uid, rts in hotspot_manager.user_runtimes.items():
                if hid in rts:
                    target_uid = uid
                    break

    if target_uid is not None:
        uid = int(target_uid)
        if data.get("type") == "dmr_activity":
            u_state = get_user_radio_state(uid)
            u_state.is_rx = bool(data.get("active", False))
        elif data.get("type") == "call_transcription":
            try:
                hotspot_manager.attach_transcription(
                    hotspot_id=data.get("hotspot_id", ""),
                    slot=int(data.get("slot", 1)),
                    src_id=int(data.get("src_id", 0)),
                    text=data.get("text", ""),
                    lang=data.get("lang", ""),
                    is_final=bool(data.get("is_final", False)),
                    call_id=data.get("call_id"),
                    user_id=uid,
                )
            except Exception as e:
                logger.debug(f"[MAIN] Failed to attach transcription to call history: {e}")
        await broadcast_user_json(uid, data, exclude=exclude)
        return

    if data.get("type") == "dmr_activity":
        radio_state.is_rx = bool(data.get("active", False))
    elif data.get("type") == "call_transcription":
        try:
            hotspot_manager.attach_transcription(
                hotspot_id=data.get("hotspot_id", ""),
                slot=int(data.get("slot", 1)),
                src_id=int(data.get("src_id", 0)),
                text=data.get("text", ""),
                lang=data.get("lang", ""),
                is_final=bool(data.get("is_final", False)),
                call_id=data.get("call_id")
            )
        except Exception as e:
            logger.debug(f"[MAIN] Failed to attach transcription to call history: {e}")
    targets = [ws for ws in list(connected_clients) if ws != exclude and ws.client_state == WebSocketState.CONNECTED]
    if targets:
        msg = json.dumps(data)
        results = await asyncio.gather(*[_send_ws_text(ws, msg) for ws in targets], return_exceptions=True)
        dead_clients = {ws for ws, ok in zip(targets, results) if ok is not True}
        if dead_clients:
            connected_clients.difference_update(dead_clients)
            for ws in dead_clients:
                uid = ws_user_map.pop(ws, None)
                if uid and uid in user_clients:
                    user_clients[uid].discard(ws)

async def broadcast_binary(data: bytes, exclude: Optional[WebSocket] = None, user_id: Optional[int] = None):
    if user_id is not None:
        await broadcast_user_binary(int(user_id), data, exclude=exclude)
        return
    targets = [ws for ws in list(connected_clients) if ws != exclude and ws.client_state == WebSocketState.CONNECTED]
    if not targets:
        return
    results = await asyncio.gather(*[_send_ws_bytes(ws, data) for ws in targets], return_exceptions=True)
    dead_clients = {ws for ws, ok in zip(targets, results) if ok is not True}
    if dead_clients:
        connected_clients.difference_update(dead_clients)
        for ws in dead_clients:
            uid = ws_user_map.pop(ws, None)
            if uid and uid in user_clients:
                user_clients[uid].discard(ws)

transcriber_service = GeminiTranscriberService(broadcast_fn=broadcast_json)
transcriber_service.configure(
    enabled=getattr(app_settings, "transcriber_enabled", False),
    api_key=getattr(app_settings, "transcriber_api_key", ""),
    model=getattr(app_settings, "transcriber_model", "gemini-3.1-flash-lite"),
    target_lang=getattr(app_settings, "transcriber_target_lang", "ru"),
    api_keys=getattr(app_settings, "transcriber_api_keys", []),
    tts_enabled=getattr(app_settings, "tts_enabled", False),
    tts_engine=getattr(app_settings, "tts_engine", "gemini"),
    tts_model=getattr(app_settings, "tts_model", "gemini-3.1-flash-tts-preview"),
    tts_voice=getattr(app_settings, "tts_voice", "Puck"),
    tts_speed=getattr(app_settings, "tts_speed", 1.1),
    tts_ducking_level=getattr(app_settings, "tts_ducking_level", 0.80),
    tts_pause_ducking_level=getattr(app_settings, "tts_pause_ducking_level", 1.0),
    tts_mute_others=getattr(app_settings, "tts_mute_others", True),
    tts_announce_callsign=getattr(app_settings, "tts_announce_callsign", False),
    tts_style=getattr(app_settings, "tts_style", "radio"),
)

hotspot_manager = HotspotManager(
    app_settings,
    broadcast_fn=broadcast_json,
    audio_broadcast_fn=broadcast_binary,
    transcriber=transcriber_service
)

def get_hotspots_for_ping():
    result = []
    cfg_list = hotspot_manager.settings.hotspots
    if cfg_list:
        for i, cfg in enumerate(cfg_list):
            rt = hotspot_manager.runtimes.get(cfg.id)
            if rt:
                d = rt.to_dict()
            else:
                d = {
                    "id": cfg.id,
                    "name": cfg.name,
                    "bm_master_host": cfg.bm_master_host,
                    "status": "OFFLINE",
                }
            d["is_primary"] = (i == 0)
            result.append(d)
    else:
        result.append({
            "id": "default",
            "name": "Main",
            "bm_master_host": "2322.master.brandmeister.network",
            "status": "OFFLINE",
            "is_primary": True,
        })
    return result

bm_ping_service = BMPingService(
    get_hotspots_callback=get_hotspots_for_ping,
    broadcast_callback=broadcast_json,
    interval=5.0
)
client_ping_service = ClientPingService()

async def periodic_directory_sync():
    """Checks and updates BrandMeister and RadioID databases every 3 hours."""
    while True:
        try:
            await asyncio.sleep(10800)  # 3 hours
            logger.info("[SYNC] Running scheduled 3-hour directory check...")
            await tg_resolver.check_and_update(interval_seconds=10800)
            await user_db.check_and_update(interval_seconds=10800)
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"[SYNC] Periodic check error: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("[MAIN] Starting ProxDMR Gateway...")
    await init_db()
    if transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
        transcriber_service.disable_all_slots()
    # Initialize recorder with user 1 settings if available
    try:
        u1_settings = await load_user_settings(1)
        if u1_settings and "recordings_settings" in u1_settings:
            u1_rec = u1_settings["recordings_settings"]
            if hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder:
                hotspot_manager.recorder.apply_settings(u1_rec)
            if hasattr(hotspot_manager, "settings"):
                hotspot_manager.settings.recordings_settings = u1_rec
    except Exception as e:
        logger.warning(f"[MAIN] Error initializing user 1 recordings settings: {e}")
    await hotspot_manager.start()
    bm_ping_service.start()

    # Предзагрузка голоса Piper при старте (когда loop уже активен)
    if transcriber_service and getattr(transcriber_service, "tts_voice", None):
        try:
            import piper_service
            psrv = piper_service.get_piper_service()
            if psrv.is_voice_installed(transcriber_service.tts_voice):
                asyncio.create_task(psrv.preload_voice_async(transcriber_service.tts_voice))
        except Exception as e:
            logger.debug(f"[MAIN] Piper preload at startup failed: {e}")

    # Initial background check and catalog fetch
    asyncio.create_task(tg_resolver.check_and_update(interval_seconds=10800))
    asyncio.create_task(user_db.check_and_update(interval_seconds=10800))
    sync_task = asyncio.create_task(periodic_directory_sync())
    yield
    bm_ping_service.stop()
    sync_task.cancel()
    logger.info("[MAIN] Shutting down ProxDMR Gateway...")
    if transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
        transcriber_service.disable_all_slots()
    await hotspot_manager.stop()

app = FastAPI(title="ProxDMR Web Gateway", version="0.3.0", lifespan=lifespan)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))
if os.environ.get("PROXDMR_DEV") == "1":
    templates.env.auto_reload = True
    templates.env.cache = None

# --- Rate Limiting (login attempts) ---
_login_attempts: Dict[str, List[float]] = {}  # IP -> list of timestamps
LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 60

def _check_rate_limit(ip: str) -> bool:
    """Returns True if the IP is rate-limited."""
    now = time.time()
    attempts = [t for t in _login_attempts.get(ip, []) if now - t < LOGIN_WINDOW_SECONDS]
    if attempts:
        _login_attempts[ip] = attempts
    else:
        _login_attempts.pop(ip, None)
    # Защита от разрастания словаря при переборе с множества IP
    if len(_login_attempts) > 5000:
        for k in [k for k, v in _login_attempts.items() if not v or now - v[-1] >= LOGIN_WINDOW_SECONDS]:
            _login_attempts.pop(k, None)
    return len(attempts) >= LOGIN_MAX_ATTEMPTS

def _record_attempt(ip: str):
    _login_attempts.setdefault(ip, []).append(time.time())

# --- JWT Auth Middleware ---

_AUTH_SKIP_PREFIXES = ("/static/", "/api/auth/", "/ws/")
_AUTH_SKIP_EXACT = ("/", "/favicon.ico", "/apk", "/download/apk", "/api/apk/info", "/api/apk/version")

# Короткий TTL-кэш (blocked, role) на user_id: избавляет от 2 запросов к БД на каждый HTTP-запрос.
_USER_STATE_TTL = 3.0
_user_state_cache: Dict[int, tuple] = {}  # user_id -> (expires_ts, blocked, role)


async def _get_user_state_cached(user_id: int):
    now = time.monotonic()
    hit = _user_state_cache.get(user_id)
    if hit and hit[0] > now:
        return hit[1], hit[2]
    blocked = await is_user_blocked(user_id)
    role = None if blocked else await get_user_role(user_id)
    if len(_user_state_cache) > 2000:
        _user_state_cache.clear()
    _user_state_cache[user_id] = (now + _USER_STATE_TTL, blocked, role)
    return blocked, role


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Статические файлы не требуют ни JWT, ни обращений к БД
    if path.startswith("/static/"):
        return await call_next(request)

    # Extract JWT token if present on ANY request
    token = request.cookies.get("proxdmr_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        token = request.query_params.get("token")

    if token:
        payload = verify_jwt(token)
        if payload:
            uid = payload.get('user_id', 0)
            blocked, role = await _get_user_state_cached(uid)
            if blocked:
                payload = None  # Treat as unauthenticated
                if path.startswith('/api/') and path not in ('/api/auth/login',):
                    return JSONResponse({"error": "Аккаунт заблокирован"}, status_code=403)
            if payload:
                # Role is loaded from DB (cached for a few seconds) so role changes take effect quickly
                payload["role"] = role
                request.state.user = payload

    # Skip 401 check for public paths
    if path in _AUTH_SKIP_EXACT or any(path.startswith(p) for p in _AUTH_SKIP_PREFIXES):
        return await call_next(request)
    # /download/recordings/* требует авторизации (проверяется в самом эндпоинте); остальные /download/* публичны (APK)
    if path.startswith("/download/") and not path.startswith("/download/recordings/"):
        return await call_next(request)

    if not getattr(request.state, "user", None):
        if path.startswith("/api/"):
            return JSONResponse({"error": "Unauthorized"}, status_code=401)
        return await call_next(request)

    return await call_next(request)


@app.middleware("http")
async def no_cache_static_middleware(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        response.headers["Pragma"] = "no-cache"
    return response


def _get_user_from_request(request: Request) -> dict | None:
    """Extract user payload from request.state (set by middleware)."""
    return getattr(request.state, "user", None)


def _require_recording_access(rec: dict | None, request: Request) -> dict:
    """Проверяет, что запись существует и доступна текущему пользователю (владелец, общая user_id=0 или админ)."""
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if user.get("role") in ("admin", "superadmin"):
        return rec
    owner = rec.get("user_id") or 0
    if owner not in (0, user.get("user_id")):
        # 404 вместо 403, чтобы не раскрывать существование чужих записей
        raise HTTPException(status_code=404, detail="Recording not found")
    return rec


async def ensure_active_user(user_id: int, login: str = "", force_reload: bool = False) -> AppSettings:
    """Ensure hotspot_manager has initialized the specified user's runtimes and settings without disrupting other users."""
    existing_sett = hotspot_manager.user_settings.get(user_id)
    if not force_reload and existing_sett is not None and user_id in hotspot_manager.user_runtimes:
        return existing_sett
    raw_s = await load_user_settings(user_id)
    if not raw_s:
        raw_s = get_default_settings(login)
    user_app_settings = AppSettings(**raw_s)
    if getattr(user_app_settings, "bg_type", None) in ("pattern1", "pattern2"):
        user_app_settings.bg_type = "pattern"
    if getattr(user_app_settings, "bg_type_dark", None) in ("pattern1", "pattern2"):
        user_app_settings.bg_type_dark = "pattern"
    if getattr(user_app_settings, "bg_type_light", None) in ("pattern1", "pattern2"):
        user_app_settings.bg_type_light = "pattern"
    if not getattr(user_app_settings, "theme", None):
        user_app_settings.theme = "dark"

    await hotspot_manager.ensure_user_runtimes(user_id, user_app_settings)
    hotspot_manager.apply_client_settings_to_runtimes(getattr(user_app_settings, "client_settings", {}) or {}, user_id=user_id)
    for hs_cfg in getattr(user_app_settings, "hotspots", []):
        rt = hotspot_manager.get_runtime(user_id, hs_cfg.id)
        if rt:
            rt.config.auto_record = getattr(hs_cfg, "auto_record", False)
    rec_s = getattr(user_app_settings, "recordings_settings", {}) or (raw_s.get("recordings_settings", {}) if raw_s else {})
    if rec_s and hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder:
        hotspot_manager.recorder.apply_settings(rec_s)

    if hotspot_manager.active_user_id == user_id or hotspot_manager.active_user_id == 1:
        transcriber_service.configure(
            enabled=getattr(user_app_settings, "transcriber_enabled", False),
            api_key=getattr(user_app_settings, "transcriber_api_key", ""),
            model=getattr(user_app_settings, "transcriber_model", "gemini-3.1-flash-lite"),
            target_lang=getattr(user_app_settings, "transcriber_target_lang", "ru"),
            api_keys=getattr(user_app_settings, "transcriber_api_keys", []),
            tts_enabled=getattr(user_app_settings, "tts_enabled", False),
            tts_engine=getattr(user_app_settings, "tts_engine", "gemini"),
            tts_model=getattr(user_app_settings, "tts_model", "gemini-3.1-flash-tts-preview"),
            tts_voice=getattr(user_app_settings, "tts_voice", "Puck"),
            tts_speed=getattr(user_app_settings, "tts_speed", 1.1),
            tts_ducking_level=getattr(user_app_settings, "tts_ducking_level", 0.80),
            tts_pause_ducking_level=getattr(user_app_settings, "tts_pause_ducking_level", 1.0),
            tts_mute_others=getattr(user_app_settings, "tts_mute_others", True),
            tts_announce_callsign=getattr(user_app_settings, "tts_announce_callsign", False),
            tts_style=getattr(user_app_settings, "tts_style", "radio"),
        )
    return user_app_settings


# --- Auth Endpoints ---

class AuthRegisterRequest(BaseModel):
    login: str
    password: str
    language: Optional[str] = None
    dmr_id: Optional[int] = None
    bm_password: Optional[str] = None
    bm_master_host: Optional[str] = None

class AuthLoginRequest(BaseModel):
    login: str
    password: str
    remember: bool = True


@app.get("/api/auth/status")
async def api_auth_status():
    uc = await user_count()
    return {
        "is_first_run": (uc == 0),
        "allow_registration": False,
    }


@app.post("/api/auth/register")
async def auth_register(body: AuthRegisterRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите минуту")

    # Open registration is completely disabled; endpoint is only permitted for initial onboarding
    if await user_count() > 0:
        raise HTTPException(status_code=403, detail="Регистрация новых пользователей отключена. Новые аккаунты создаются администратором.")

    # Validate
    err = validate_login(body.login)
    if err:
        raise HTTPException(status_code=400, detail=err)
    err = validate_password(body.password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # Check login uniqueness
    if await login_exists(body.login):
        raise HTTPException(status_code=409, detail="Этот логин уже занят")

    # Create user with clean default settings
    pw_hash = await asyncio.to_thread(hash_password, body.password)
    user_id = await create_user(body.login, pw_hash)

    # Switch hotspot_manager and transcriber to the new user's clean settings
    user_settings = await ensure_active_user(user_id, body.login)

    # Apply initial onboarding configuration if provided
    settings_changed = False
    if body.language and body.language in ("uk", "en", "de", "es", "fr", "it", "ru"):
        user_settings.language = body.language
        settings_changed = True

    hs = user_settings.get_active_hotspot()
    if hs:
        hs.callsign = body.login.strip().upper()
        settings_changed = True
        if body.dmr_id is not None and body.dmr_id > 0:
            hs.dmr_id = body.dmr_id
        if body.bm_password:
            hs.bm_password = body.bm_password.strip()
        if body.bm_master_host:
            hs.bm_master_host = body.bm_master_host.strip()

    if settings_changed:
        await save_user_settings(user_id, user_settings.model_dump())
        await ensure_active_user(user_id, body.login, force_reload=True)

    # Migrate settings.json for the first user only if legacy exists
    if await user_count() == 1:
        try:
            settings_file = Path(__file__).resolve().parent.parent / "config" / "settings.json"
            if settings_file.exists():
                with open(settings_file, "r", encoding="utf-8-sig") as f:
                    migrated = json.load(f)
                await save_user_settings(user_id, migrated)
                migrated_path = settings_file.with_suffix(".json.migrated")
                if not migrated_path.exists():
                    settings_file.rename(migrated_path)
                logger.info(f"[AUTH] Migrated settings.json to user {body.login}")
        except Exception as e:
            logger.error(f"[AUTH] Migration error: {e}")

    await update_last_login(user_id)

    # Set JWT cookie
    role = await get_user_role(user_id)
    token = create_jwt(user_id, body.login, remember=True, role=role)
    response.set_cookie(
        key="proxdmr_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=JWT_EXPIRY_DAYS_REMEMBER * 86400,
        path="/",
    )
    return {"status": "ok", "user": {"id": user_id, "login": body.login}, "token": token}


@app.post("/api/auth/login")
async def auth_login(body: AuthLoginRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите минуту")

    _record_attempt(ip)

    user = await get_user_by_login(body.login)
    if not user or not await asyncio.to_thread(verify_password, body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Неверный логин или пароль")

    # Check if user is blocked
    if await is_user_blocked(user["id"]):
        raise HTTPException(status_code=403, detail="Аккаунт заблокирован. Обратитесь к администратору.")

    await update_last_login(user["id"])
    await ensure_active_user(user["id"], user["login"])

    role = await get_user_role(user["id"])
    max_age = (JWT_EXPIRY_DAYS_REMEMBER * 86400) if body.remember else None
    token = create_jwt(user["id"], user["login"], remember=body.remember, role=role)
    response.set_cookie(
        key="proxdmr_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=max_age,
        path="/",
    )
    return {"status": "ok", "user": {"id": user["id"], "login": user["login"], "role": role}, "token": token}


@app.post("/api/auth/import-config")
async def auth_import_config(
    request: Request,
    response: Response,
    file: UploadFile = File(...),
    login: str = Form(""),
    password: str = Form(""),
    remember: bool = Form(True),
):
    ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(ip):
        raise HTTPException(status_code=429, detail="Слишком много попыток. Подождите минуту")

    _record_attempt(ip)

    if not password:
        raise HTTPException(status_code=400, detail="Пароль архива обязателен")

    archive_bytes = await file.read()
    if not archive_bytes:
        raise HTTPException(status_code=400, detail="Файл архива пустой")

    try:
        settings = import_settings(archive_bytes, password)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    clean_login = login.strip()
    if not clean_login:
        hotspots = settings.get("hotspots", [])
        if isinstance(hotspots, list) and len(hotspots) > 0 and isinstance(hotspots[0], dict):
            clean_login = (hotspots[0].get("callsign") or "").strip()
        if not clean_login:
            clean_login = "admin"
        clean_login = re.sub(r'[^a-zA-Z0-9_.\-]', '', clean_login)
        if len(clean_login) < LOGIN_MIN_LENGTH:
            clean_login = "user"
        if len(clean_login) > LOGIN_MAX_LENGTH:
            clean_login = clean_login[:LOGIN_MAX_LENGTH]
    else:
        err = validate_login(clean_login)
        if err:
            raise HTTPException(status_code=400, detail=err)

    existing_user = await get_user_by_login(clean_login)
    if existing_user:
        if not await asyncio.to_thread(verify_password, password, existing_user["password_hash"]):
            raise HTTPException(
                status_code=401,
                detail="Пользователь с таким логином уже существует, но пароль не совпадает с паролем архива"
            )
        user_id = existing_user["id"]
    else:
        err = validate_password(password)
        if err:
            raise HTTPException(status_code=400, detail=f"Пароль архива не подходит для создания аккаунта: {err}")
        pw_hash = await asyncio.to_thread(hash_password, password)
        user_id = await create_user(clean_login, pw_hash)

    await save_user_settings(user_id, settings)
    await ensure_active_user(user_id, clean_login)

    if await user_count() == 1:
        try:
            settings_file = Path(__file__).resolve().parent.parent / "config" / "settings.json"
            if settings_file.exists():
                migrated_path = settings_file.with_suffix(".json.migrated")
                if not migrated_path.exists():
                    settings_file.rename(migrated_path)
        except Exception as e:
            logger.error(f"[AUTH] Migration error during import: {e}")

    await update_last_login(user_id)
    _login_attempts.pop(ip, None)

    max_age = (JWT_EXPIRY_DAYS_REMEMBER * 86400) if remember else None
    token = create_jwt(user_id, clean_login, remember=remember)
    response.set_cookie(
        key="proxdmr_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=max_age,
        path="/",
    )
    logger.info(f"[AUTH] Configuration imported via login screen for user '{clean_login}' (id={user_id})")
    return {
        "status": "ok",
        "message": "Конфигурация успешно загружена",
        "user": {"id": user_id, "login": clean_login},
        "token": token,
    }


@app.post("/api/auth/logout")
async def auth_logout(response: Response):
    response.delete_cookie(
        key="proxdmr_token",
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    return {"status": "ok"}


@app.post("/api/auth/delete")
async def auth_delete(request: Request, response: Response):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Не авторизован")
    if user.get("role") == "superadmin":
        raise HTTPException(status_code=403, detail="Удаление аккаунта суперадминистратора запрещено")
    user_id = user["user_id"]
    login = user.get("login", "")

    await hotspot_manager.on_user_deleted(user_id)
    deleted = await delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # If any users remain, switch active runtime to the first user; otherwise clean defaults
    remaining_users = await list_users()
    if remaining_users:
        next_user = remaining_users[0]
        await ensure_active_user(next_user["id"], next_user["login"])
    else:
        empty_defaults = AppSettings(**get_default_settings())
        hotspot_manager.settings = empty_defaults

    response.delete_cookie(
        key="proxdmr_token",
        path="/",
        secure=True,
        httponly=True,
        samesite="lax",
    )
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    logger.info(f"[AUTH] User deleted: {login} (id={user_id})")
    return {"status": "ok", "message": f"Аккаунт {login} успешно удален"}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/user/change-password")
@app.post("/api/auth/change-password")
async def auth_change_password(body: ChangePasswordRequest, request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Требуется авторизация")
    user_id = user["user_id"]
    db_user = await get_user_by_id(user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    # 1. Verify current password
    is_valid = await asyncio.to_thread(verify_password, body.current_password, db_user.get("password_hash", ""))
    if not is_valid:
        raise HTTPException(status_code=400, detail="Неверный текущий пароль")

    # 2. Validate new password strength
    err = validate_password(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # 3. Hash and update password in DB
    pw_hash = await asyncio.to_thread(hash_password, body.new_password)
    ok = await update_user_password(user_id, pw_hash)
    if not ok:
        raise HTTPException(status_code=500, detail="Не удалось обновить пароль")

    role = db_user.get("role", "user")
    logger.info(f"[AUTH] Password successfully changed by user '{db_user.get('login')}' (id={user_id}, role={role})")
    return {"status": "ok", "message": "Пароль успешно изменен"}


@app.get("/api/auth/me")
async def auth_me(request: Request, response: Response):
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    token = request.cookies.get("proxdmr_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        token = request.query_params.get("token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = verify_jwt(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token expired")
    user = await get_user_by_id(payload["user_id"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    role = await get_user_role(payload["user_id"])
    is_swl = await is_user_swl(payload["user_id"])
    response.set_cookie(
        key="proxdmr_token",
        value=token,
        httponly=True,
        secure=False,
        samesite="lax",
        max_age=JWT_EXPIRY_DAYS_REMEMBER * 86400,
        path="/",
    )
    return {"user": user, "user_id": payload["user_id"], "login": user.get("login", ""), "role": role, "is_swl": is_swl, "token": token}

# --- Admin User Management API ---

def _require_admin(request: Request) -> dict:
    """Require admin or superadmin role. Returns user dict or raises 403."""
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    role = user.get("role", "user")
    if role not in ("admin", "superadmin"):
        raise HTTPException(status_code=403, detail="Доступ запрещён. Требуются права администратора.")
    return user


@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    _require_admin(request)
    users = await list_users()
    return {"users": users}


class AdminCreateUserRequest(BaseModel):
    login: str
    password: str
    role: str = "user"
    is_swl: bool = False


@app.post("/api/admin/users/create")
async def admin_create_user_endpoint(body: AdminCreateUserRequest, request: Request):
    caller = _require_admin(request)
    err = validate_login(body.login)
    if err:
        raise HTTPException(status_code=400, detail=err)
    err = validate_password(body.password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    if await login_exists(body.login):
        raise HTTPException(status_code=409, detail="Этот логин уже занят")
    role = body.role if body.role in ("user", "admin") else "user"
    if role == "admin" and caller.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Только суперадмин может назначать роль администратора")
    pw_hash = await asyncio.to_thread(hash_password, body.password)
    user_id = await create_user(body.login, pw_hash)
    effective_swl = False
    if role != "user":
        await set_user_role(user_id, role)
    elif body.is_swl:
        await set_user_swl(user_id, True)
        effective_swl = True
    logger.info(f"[ADMIN] User created by {caller.get('login','?')}: {body.login} (role={role}, is_swl={effective_swl})")
    return {"status": "ok", "user_id": user_id, "login": body.login, "role": role, "is_swl": effective_swl}


class AdminUserActionRequest(BaseModel):
    user_id: int


@app.post("/api/admin/users/block")
async def admin_block_user(body: AdminUserActionRequest, request: Request):
    caller = _require_admin(request)
    if body.user_id == caller.get("user_id"):
        raise HTTPException(status_code=400, detail="Нельзя заблокировать самого себя")
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail="Нельзя заблокировать суперадмина")
    ok = await set_user_blocked(body.user_id, True)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"status": "ok"}


@app.post("/api/admin/users/unblock")
async def admin_unblock_user(body: AdminUserActionRequest, request: Request):
    _require_admin(request)
    ok = await set_user_blocked(body.user_id, False)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    return {"status": "ok"}


@app.post("/api/admin/users/delete")
async def admin_delete_user_endpoint(body: AdminUserActionRequest, request: Request):
    caller = _require_admin(request)
    if body.user_id == caller.get("user_id"):
        raise HTTPException(status_code=400, detail="Нельзя удалить самого себя")
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail="Нельзя удалить суперадмина")
    ok = await delete_user(body.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    logger.info(f"[ADMIN] User deleted by {caller.get('login','?')}: id={body.user_id}")
    return {"status": "ok"}


class AdminSetRoleRequest(BaseModel):
    user_id: int
    role: str


@app.post("/api/admin/users/role")
async def admin_set_role(body: AdminSetRoleRequest, request: Request):
    caller = _require_admin(request)
    if body.user_id == caller.get("user_id"):
        raise HTTPException(status_code=400, detail="Нельзя изменить свою собственную роль")
    if caller.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Только суперадмин может менять роли")
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail="Допустимые роли: admin, user")
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail="Нельзя изменить роль суперадмина")
    ok = await set_user_role(body.user_id, body.role)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    if body.role in ("admin", "superadmin"):
        await broadcast_user_json(body.user_id, {
            "type": "swl_change",
            "is_swl": False
        })
    return {"status": "ok"}


class AdminSetSwlRequest(BaseModel):
    user_id: int
    is_swl: bool


@app.post("/api/admin/users/swl")
async def admin_set_swl(body: AdminSetSwlRequest, request: Request):
    caller = _require_admin(request)
    target_role = await get_user_role(body.user_id)
    if target_role in ("superadmin", "admin"):
        raise HTTPException(status_code=400, detail="Флаг SWL доступен только для обычных пользователей")
    ok = await set_user_swl(body.user_id, body.is_swl)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    await broadcast_user_json(body.user_id, {
        "type": "swl_change",
        "is_swl": body.is_swl
    })
    logger.info(f"[ADMIN] User SWL updated by {caller.get('login','?')}: id={body.user_id} -> {body.is_swl}")
    return {"status": "ok", "is_swl": body.is_swl}


class AdminResetPasswordRequest(BaseModel):
    user_id: int
    new_password: str


@app.post("/api/admin/users/reset-password")
async def admin_reset_password(body: AdminResetPasswordRequest, request: Request):
    caller = _require_admin(request)
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin" and caller.get("user_id") != body.user_id:
        raise HTTPException(status_code=403, detail="Пароль суперадмина может сбросить только он сам")
    err = validate_password(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    pw_hash = await asyncio.to_thread(hash_password, body.new_password)
    ok = await update_user_password(body.user_id, pw_hash)
    if not ok:
        raise HTTPException(status_code=404, detail="Пользователь не найден")
    logger.info(f"[ADMIN] Password reset by {caller.get('login','?')} for user id={body.user_id}")
    return {"status": "ok"}


# --- User Settings Endpoints ---

@app.get("/api/user/settings")
async def get_user_settings_api(request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    settings = await load_user_settings(user["user_id"])
    return settings


@app.post("/api/user/settings")
async def save_user_settings_api(request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    body = await request.json()
    await save_user_settings(user["user_id"], body)
    return {"status": "ok"}


@app.get("/api/user/settings/export")
async def export_user_settings_api(request: Request, password: str = ""):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    if not password:
        raise HTTPException(status_code=400, detail="Введите пароль от вашего аккаунта")
    db_user = await get_user_by_id(user["user_id"])
    if not db_user or not await asyncio.to_thread(verify_password, password, db_user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Неверный пароль аккаунта")
    settings = await load_user_settings(user["user_id"])
    try:
        archive_bytes = export_settings(settings, password)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    filename = get_export_filename()
    return Response(
        content=archive_bytes,
        media_type="application/x-7z-compressed",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.post("/api/user/settings/import")
async def import_user_settings_api(
    request: Request,
    file: UploadFile = File(...),
    password: str = Form(""),
):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    archive_bytes = await file.read()
    try:
        settings = import_settings(archive_bytes, password)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    await save_user_settings(user["user_id"], settings)
    await ensure_active_user(user["user_id"], user.get("login", ""))
    return {"status": "ok", "message": "Настройки импортированы"}


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(STATIC_DIR / "favicon.ico")

@app.get("/download/apk", include_in_schema=False)
@app.get("/apk", include_in_schema=False)
async def download_apk():
    apk_path = STATIC_DIR / "ProxDMR.apk"
    if apk_path.exists():
        filename = get_apk_filename(apk_path)
        return FileResponse(
            path=str(apk_path),
            filename=filename,
            media_type="application/vnd.android.package-archive"
        )
    raise HTTPException(status_code=404, detail="APK not found")

@app.get("/download/{filename:path}", include_in_schema=False)
async def download_named_file(filename: str):
    if filename.endswith(".apk"):
        try:
            static_root = STATIC_DIR.resolve()
            specific_path = (STATIC_DIR / filename).resolve()
            if not specific_path.is_relative_to(static_root):
                raise HTTPException(status_code=403, detail="Forbidden")
            if specific_path.is_file():
                return FileResponse(
                    path=str(specific_path),
                    filename=specific_path.name,
                    media_type="application/vnd.android.package-archive"
                )
            default_path = (STATIC_DIR / "ProxDMR.apk").resolve()
            if default_path.is_file():
                return FileResponse(
                    path=str(default_path),
                    filename=specific_path.name,
                    media_type="application/vnd.android.package-archive"
                )
        except HTTPException:
            raise
        except Exception:
            pass
    raise HTTPException(status_code=404, detail="File not found")

def get_current_apk_metadata() -> dict:
    apk_path = STATIC_DIR / "ProxDMR.apk"
    current_apk_ver = "1.11"
    current_apk_date = ""
    filename = "ProxDMR.apk"
    try:
        import importlib
        mod = None
        try:
            import version
            importlib.reload(version)
            mod = version
        except Exception:
            pass
        if mod is None:
            try:
                from src import version as src_version
                importlib.reload(src_version)
                mod = src_version
            except Exception:
                pass
        if mod is not None:
            current_apk_ver = getattr(mod, "APK_VERSION", "1.11")
            current_apk_date = getattr(mod, "APK_VERSION_DATE", "")
            filename = mod.get_apk_filename(apk_path)
        else:
            raise RuntimeError("Could not find version module")
    except Exception as e:
        logger.warning(f"Error reloading version.py: {e}")
        try:
            from version import APK_VERSION as cv, APK_VERSION_DATE as cd, get_apk_filename as gfn
        except ImportError:
            from src.version import APK_VERSION as cv, APK_VERSION_DATE as cd, get_apk_filename as gfn
        current_apk_ver = cv
        current_apk_date = cd
        filename = gfn(apk_path)
    exists = apk_path.exists()
    size = apk_path.stat().st_size if exists else 0
    return {
        "apk_version": current_apk_ver,
        "apk_version_date": current_apk_date,
        "apk_filename": filename,
        "apk_path": f"/download/{filename}",
        "apk_url": f"/download/{filename}",
        "exists": exists,
        "size": size,
    }

@app.get("/api/apk/info", include_in_schema=False)
@app.get("/api/apk/version", include_in_schema=False)
async def get_apk_info():
    return get_current_apk_metadata()

@app.get("/", response_class=HTMLResponse)
async def get_index(request: Request):
    user = _get_user_from_request(request)
    if user:
        uid = user["user_id"]
        login = user.get("login", "")
        s = await ensure_active_user(uid, login)
        active_hs = hotspot_manager.get_active_runtime(uid)
        cfg = active_hs.config if active_hs else (s.get_active_hotspot() or HotspotConfig(callsign=login.upper()))
        callsign = cfg.callsign
        dmr_id = cfg.dmr_id
        default_tg_ts1 = cfg.default_tg_ts1
        default_tg_ts2 = cfg.default_tg_ts2
        loopback_mode = getattr(s, "loopback_mode", False)
        mute_on_ptt = s.mute_on_ptt
        volume_up_ptt = getattr(s, "volume_up_ptt", getattr(s, "volume_down_ptt", True))
        volume_down_ptt = volume_up_ptt
        sync_hotspot_volume = getattr(s, "sync_hotspot_volume", True)
        sync_system_volume = getattr(s, "sync_system_volume", True)
        haptic_feedback = getattr(s, "haptic_feedback", True)
        haptic_duration = getattr(s, "haptic_duration", 45)
        bm_status = active_hs.status.value if active_hs else "OFFLINE"
        theme = getattr(s, "theme", "dark") or "dark"
        bg_type = "color" if getattr(s, "bg_type", "pattern") == "color" else "pattern"
        bg_color = s.bg_color or "#0f1115"
        bg_type_dark = "color" if getattr(s, "bg_type_dark", "pattern") == "color" else "pattern"
        bg_color_dark = getattr(s, "bg_color_dark", bg_color) or "#0f1115"
        bg_type_light = "color" if getattr(s, "bg_type_light", "pattern") == "color" else "pattern"
        bg_color_light = getattr(s, "bg_color_light", "#f4f6f8") or "#f4f6f8"
        language = s.language
        simultaneous_slots = getattr(s, "simultaneous_slots", True)
        check_mic_on_tx = getattr(s, "check_mic_on_tx", True)
        hamqth_username = getattr(s, "hamqth_username", "") or ""
        hamqth_password = getattr(s, "hamqth_password", "") or ""

        wp_dir = STATIC_DIR / "img" / "wallpapers"
        custom_bg_dark = (wp_dir / f"bg-custom-u{uid}-dark.jpg").exists()
        custom_bg_light = (wp_dir / f"bg-custom-u{uid}-light.jpg").exists()
        if not custom_bg_dark and uid == 1:
            custom_bg_dark = (STATIC_DIR / "img" / "bg-custom-dark.jpg").exists()
        if not custom_bg_light and uid == 1:
            custom_bg_light = (STATIC_DIR / "img" / "bg-custom-light.jpg").exists()

        if (wp_dir / f"bg-custom-u{uid}-dark.jpg").exists():
            custom_bg_dark_url = f"/static/img/wallpapers/bg-custom-u{uid}-dark.jpg?v={int((wp_dir / f'bg-custom-u{uid}-dark.jpg').stat().st_mtime)}"
        elif uid == 1 and (STATIC_DIR / "img" / "bg-custom-dark.jpg").exists():
            custom_bg_dark_url = f"/static/img/bg-custom-dark.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-dark.jpg').stat().st_mtime)}"
        else:
            custom_bg_dark_url = ""

        if (wp_dir / f"bg-custom-u{uid}-light.jpg").exists():
            custom_bg_light_url = f"/static/img/wallpapers/bg-custom-u{uid}-light.jpg?v={int((wp_dir / f'bg-custom-u{uid}-light.jpg').stat().st_mtime)}"
        elif uid == 1 and (STATIC_DIR / "img" / "bg-custom-light.jpg").exists():
            custom_bg_light_url = f"/static/img/bg-custom-light.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-light.jpg').stat().st_mtime)}"
        else:
            custom_bg_light_url = ""
    else:
        uid = None
        custom_bg_dark = False
        custom_bg_light = False
        custom_bg_dark_url = ""
        custom_bg_light_url = ""
        cfg = HotspotConfig(callsign="N0CALL", dmr_id=0)
        callsign = "N0CALL"
        dmr_id = 0
        default_tg_ts1 = 91
        default_tg_ts2 = 2501
        loopback_mode = False
        mute_on_ptt = True
        volume_down_ptt = True
        volume_up_ptt = True
        sync_hotspot_volume = True
        sync_system_volume = True
        haptic_feedback = True
        haptic_duration = 45
        bm_status = "OFFLINE"
        theme = "dark"
        bg_type = "pattern"
        bg_color = "#0f1115"
        bg_type_dark = "pattern"
        bg_color_dark = "#0f1115"
        bg_type_light = "pattern"
        bg_color_light = "#f4f6f8"
        language = "ru"
        simultaneous_slots = True
        check_mic_on_tx = True
        hamqth_username = ""
        hamqth_password = ""

    uc = await user_count()
    is_first_run = (uc == 0)
    is_swl = await is_user_swl(uid) if uid else False

    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "user_id": uid,
            "role": user.get("role", "user") if user else "user",
            "is_admin": (user.get("role") in ("admin", "superadmin")) if user else False,
            "is_swl": is_swl,
            "cfg": cfg,
            "callsign": callsign,
            "dmr_id": dmr_id,
            "default_tg_ts1": default_tg_ts1,
            "default_tg": default_tg_ts2,
            "default_tg_ts2": default_tg_ts2,
            "loopback_mode": loopback_mode,
            "mute_on_ptt": mute_on_ptt,
            "volume_down_ptt": volume_down_ptt,
            "volume_up_ptt": volume_up_ptt,
            "sync_hotspot_volume": sync_hotspot_volume,
            "sync_system_volume": sync_system_volume,
            "haptic_feedback": haptic_feedback,
            "haptic_duration": haptic_duration,
            "bm_status": bm_status,
            "theme": theme,
            "bg_type": bg_type,
            "bg_color": bg_color,
            "bg_type_dark": bg_type_dark,
            "bg_color_dark": bg_color_dark,
            "bg_type_light": bg_type_light,
            "bg_color_light": bg_color_light,
            "language": language,
            "simultaneous_slots": simultaneous_slots,
            "check_mic_on_tx": check_mic_on_tx,
            "hamqth_username": hamqth_username,
            "hamqth_password": hamqth_password,
            "app_version": APP_VERSION,
            "app_version_date": APP_VERSION_DATE,
            "apk_version": get_current_apk_metadata()["apk_version"],
            "apk_version_date": get_current_apk_metadata()["apk_version_date"],
            "apk_filename": get_current_apk_metadata()["apk_filename"],
            "apk_path": get_current_apk_metadata()["apk_path"],
            "apk_url": get_current_apk_metadata()["apk_url"],
            "custom_bg_dark": custom_bg_dark,
            "custom_bg_light": custom_bg_light,
            "custom_bg_dark_url": custom_bg_dark_url,
            "custom_bg_light_url": custom_bg_light_url,
            "is_first_run": is_first_run,
            "allow_registration": False,
        }
    )

# --- Hotspot Management API ---

@app.get("/api/hotspots")
async def list_hotspots(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    rts = hotspot_manager.get_user_runtimes(uid)
    return {
        "active_hotspot_id": getattr(user_sett, "active_hotspot_id", "default"),
        "hotspots": [rt.to_dict() for rt in rts.values()]
    }

@app.post("/api/hotspots")
async def create_hotspot(cfg: HotspotConfig, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    if len(user_sett.hotspots) >= 7:
        raise HTTPException(status_code=400, detail="Максимум 7 виртуальных хотспотов")
    if cfg.bm_ssid < 1 or cfg.bm_ssid > 99:
        raise HTTPException(status_code=400, detail="SSID должен быть в диапазоне от 1 до 99")
    for h in user_sett.hotspots:
        if h.dmr_id == cfg.dmr_id and h.bm_ssid == cfg.bm_ssid:
            raise HTTPException(
                status_code=400,
                detail=f"SSID {cfg.bm_ssid} уже используется для DMR ID {cfg.dmr_id}. Выберите другой SSID (например, {cfg.bm_ssid + 1})"
            )
    rt = hotspot_manager.create_hotspot(cfg, user_id=uid)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok", "hotspot": rt.to_dict()}

@app.put("/api/hotspots/{hotspot_id}")
async def update_hotspot(hotspot_id: str, cfg: HotspotConfig, request: Request, reconnect: bool = False):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    cfg.id = hotspot_id
    if cfg.bm_ssid < 1 or cfg.bm_ssid > 99:
        raise HTTPException(status_code=400, detail="SSID должен быть в диапазоне от 1 до 99")
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    for h in user_sett.hotspots:
        if h.id != hotspot_id and h.dmr_id == cfg.dmr_id and h.bm_ssid == cfg.bm_ssid:
            raise HTTPException(
                status_code=400,
                detail=f"SSID {cfg.bm_ssid} уже занят другим хотспотом с таким же DMR ID. Выберите свободный SSID"
            )
    rt = await hotspot_manager.update_hotspot(cfg, auto_connect=True if reconnect else None, user_id=uid)
    if not rt:
        raise HTTPException(status_code=404, detail="Хотспот не найден")
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    try:
        asyncio.create_task(bm_ping_service.ping_now())
    except Exception:
        pass
    return {"status": "ok", "hotspot": rt.to_dict()}

class HotspotAutoTgBmUpdate(BaseModel):
    enabled: bool

@app.post("/api/hotspots/{hotspot_id}/auto-tg-bm")
async def toggle_hotspot_auto_tg_bm(hotspot_id: str, body: HotspotAutoTgBmUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    success = await hotspot_manager.set_hotspot_auto_tg_bm(hotspot_id, body.enabled, user_id=uid)
    if not success:
        raise HTTPException(status_code=404, detail="Хотспот не найден")
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok", "auto_tg_bm": body.enabled}

class HotspotAutoRecordUpdate(BaseModel):
    enabled: bool

@app.post("/api/hotspots/{hotspot_id}/auto-record")
async def toggle_hotspot_auto_record(hotspot_id: str, body: HotspotAutoRecordUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    success = await hotspot_manager.set_hotspot_auto_record(hotspot_id, body.enabled, user_id=uid)
    if not success:
        raise HTTPException(status_code=404, detail="Хотспот не найден")
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok", "auto_record": body.enabled}

class HotspotAutoconnectUpdate(BaseModel):
    enabled: bool

@app.post("/api/hotspots/{hotspot_id}/autoconnect")
async def toggle_hotspot_autoconnect(hotspot_id: str, body: HotspotAutoconnectUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    success = await hotspot_manager.set_hotspot_autoconnect(hotspot_id, body.enabled, user_id=uid)
    if not success:
        raise HTTPException(status_code=404, detail="Хотспот не найден")
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok", "autoconnect": body.enabled}

@app.delete("/api/hotspots/{hotspot_id}")
async def delete_hotspot(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    success = await hotspot_manager.delete_hotspot(hotspot_id, user_id=uid)
    if not success:
        raise HTTPException(status_code=404, detail="Хотспот не найден")
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok"}

# --- General App Settings API ---

class GeneralSettingsUpdate(BaseModel):
    theme: Optional[str] = None
    bg_type: Optional[str] = None
    bg_color: Optional[str] = None
    bg_type_dark: Optional[str] = None
    bg_color_dark: Optional[str] = None
    bg_type_light: Optional[str] = None
    bg_color_light: Optional[str] = None
    language: Optional[str] = None
    simultaneous_slots: Optional[bool] = None
    check_mic_on_tx: Optional[bool] = None
    mute_on_ptt: Optional[bool] = None
    volume_down_ptt: Optional[bool] = None
    volume_up_ptt: Optional[bool] = None
    sync_hotspot_volume: Optional[bool] = None
    sync_system_volume: Optional[bool] = None
    haptic_feedback: Optional[bool] = None
    haptic_duration: Optional[int] = None
    loopback_mode: Optional[bool] = None
    quick_mem: Optional[Dict[str, Any]] = None
    hamqth_username: Optional[str] = None
    hamqth_password: Optional[str] = None

@app.get("/api/settings/general")
async def get_general_settings(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    v_ptt = getattr(s, "volume_up_ptt", getattr(s, "volume_down_ptt", True))
    return {
        "status": "ok",
        "settings": {
            "theme": getattr(s, "theme", "dark") or "dark",
            "bg_type": "color" if getattr(s, "bg_type", "pattern") == "color" else "pattern",
            "bg_color": s.bg_color or "#0f1115",
            "bg_type_dark": getattr(s, "bg_type_dark", "pattern") or "pattern",
            "bg_color_dark": getattr(s, "bg_color_dark", "#0f1115") or "#0f1115",
            "bg_type_light": getattr(s, "bg_type_light", "pattern") or "pattern",
            "bg_color_light": getattr(s, "bg_color_light", "#f4f6f8") or "#f4f6f8",
            "language": s.language,
            "simultaneous_slots": s.simultaneous_slots,
            "check_mic_on_tx": getattr(s, "check_mic_on_tx", True),
            "mute_on_ptt": s.mute_on_ptt,
            "volume_down_ptt": v_ptt,
            "volume_up_ptt": v_ptt,
            "sync_hotspot_volume": getattr(s, "sync_hotspot_volume", True),
            "sync_system_volume": getattr(s, "sync_system_volume", True),
            "haptic_feedback": getattr(s, "haptic_feedback", True),
            "haptic_duration": getattr(s, "haptic_duration", 45),
            "loopback_mode": s.loopback_mode,
            "quick_mem": s.quick_mem,
            "hamqth_username": getattr(s, "hamqth_username", "") or "",
            "hamqth_password": getattr(s, "hamqth_password", "") or "",
        }
    }

@app.post("/api/settings/general")
async def update_general_settings(update: GeneralSettingsUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    changed = False
    if update.theme is not None:
        norm_theme = "light" if update.theme == "light" else "dark"
        if norm_theme != getattr(s, "theme", "dark"):
            s.theme = norm_theme
            changed = True
            await broadcast_user_json(uid, {"type": "theme_change", "theme": s.theme})
    bg_changed = False
    if update.bg_type is not None:
        norm_bg = "color" if update.bg_type == "color" else "pattern"
        if norm_bg != s.bg_type:
            s.bg_type = norm_bg
            changed = True
            bg_changed = True
    if update.bg_color is not None and update.bg_color != s.bg_color:
        s.bg_color = update.bg_color
        changed = True
        bg_changed = True
    if update.bg_type_dark is not None:
        norm_dark = "color" if update.bg_type_dark == "color" else "pattern"
        if norm_dark != getattr(s, "bg_type_dark", "pattern"):
            s.bg_type_dark = norm_dark
            changed = True
            bg_changed = True
    if update.bg_color_dark is not None and update.bg_color_dark != getattr(s, "bg_color_dark", "#0f1115"):
        s.bg_color_dark = update.bg_color_dark
        changed = True
        bg_changed = True
    if update.bg_type_light is not None:
        norm_light = "color" if update.bg_type_light == "color" else "pattern"
        if norm_light != getattr(s, "bg_type_light", "pattern"):
            s.bg_type_light = norm_light
            changed = True
            bg_changed = True
    if update.bg_color_light is not None and update.bg_color_light != getattr(s, "bg_color_light", "#f4f6f8"):
        s.bg_color_light = update.bg_color_light
        changed = True
        bg_changed = True
    if bg_changed:
        await broadcast_user_json(uid, {
            "type": "background_change",
            "bg_type": s.bg_type,
            "bg_color": s.bg_color,
            "bg_type_dark": getattr(s, "bg_type_dark", "pattern"),
            "bg_color_dark": getattr(s, "bg_color_dark", "#0f1115"),
            "bg_type_light": getattr(s, "bg_type_light", "pattern"),
            "bg_color_light": getattr(s, "bg_color_light", "#f4f6f8"),
        })
    if update.language is not None and update.language != s.language:
        s.language = update.language
        changed = True
        await broadcast_user_json(uid, {"type": "language_change", "language": s.language})
    if update.simultaneous_slots is not None and update.simultaneous_slots != s.simultaneous_slots:
        s.simultaneous_slots = update.simultaneous_slots
        changed = True
        await broadcast_user_json(uid, {"type": "simultaneous_slots_change", "enabled": s.simultaneous_slots})
    if update.check_mic_on_tx is not None and update.check_mic_on_tx != getattr(s, "check_mic_on_tx", True):
        s.check_mic_on_tx = update.check_mic_on_tx
        changed = True
        await broadcast_user_json(uid, {"type": "check_mic_on_tx_change", "enabled": s.check_mic_on_tx})
    if update.mute_on_ptt is not None and update.mute_on_ptt != s.mute_on_ptt:
        s.mute_on_ptt = update.mute_on_ptt
        changed = True
        await broadcast_user_json(uid, {"type": "mute_on_ptt_change", "enabled": s.mute_on_ptt})
    vol_ptt_val = update.volume_up_ptt if update.volume_up_ptt is not None else update.volume_down_ptt
    if vol_ptt_val is not None:
        cur_up = getattr(s, "volume_up_ptt", None)
        cur_down = getattr(s, "volume_down_ptt", None)
        if vol_ptt_val != cur_up or vol_ptt_val != cur_down:
            s.volume_up_ptt = vol_ptt_val
            s.volume_down_ptt = vol_ptt_val
            changed = True
            await broadcast_user_json(uid, {"type": "volume_up_ptt_change", "enabled": vol_ptt_val})
            await broadcast_user_json(uid, {"type": "volume_down_ptt_change", "enabled": vol_ptt_val})
    if update.sync_hotspot_volume is not None and update.sync_hotspot_volume != getattr(s, "sync_hotspot_volume", True):
        s.sync_hotspot_volume = update.sync_hotspot_volume
        changed = True
        await broadcast_user_json(uid, {"type": "sync_hotspot_volume_change", "enabled": s.sync_hotspot_volume})
    if update.sync_system_volume is not None and update.sync_system_volume != getattr(s, "sync_system_volume", True):
        s.sync_system_volume = update.sync_system_volume
        changed = True
        await broadcast_user_json(uid, {"type": "sync_system_volume_change", "enabled": s.sync_system_volume})
    if update.haptic_feedback is not None and update.haptic_feedback != getattr(s, "haptic_feedback", True):
        s.haptic_feedback = update.haptic_feedback
        changed = True
        await broadcast_user_json(uid, {"type": "haptic_feedback_change", "enabled": s.haptic_feedback})
    if update.haptic_duration is not None and update.haptic_duration != getattr(s, "haptic_duration", 45):
        s.haptic_duration = max(15, min(150, update.haptic_duration))
        changed = True
        await broadcast_user_json(uid, {"type": "haptic_duration_change", "duration": s.haptic_duration})
    if update.loopback_mode is not None and update.loopback_mode != s.loopback_mode:
        s.loopback_mode = update.loopback_mode
        changed = True
        await broadcast_user_json(uid, {"type": "loopback_change", "enabled": s.loopback_mode})
    if update.quick_mem is not None:
        s.quick_mem = update.quick_mem
        changed = True
        await broadcast_user_json(uid, {"type": "quick_mem_change", "all_quick_mem": s.quick_mem})
    if update.hamqth_username is not None and update.hamqth_username != getattr(s, "hamqth_username", ""):
        s.hamqth_username = update.hamqth_username.strip()
        changed = True
    if update.hamqth_password is not None and update.hamqth_password != getattr(s, "hamqth_password", ""):
        s.hamqth_password = update.hamqth_password.strip()
        changed = True

    if changed:
        await save_user_settings(uid, s.model_dump())
        if uid == 1:
            save_app_settings(s)

    v_ret_ptt = getattr(s, "volume_up_ptt", getattr(s, "volume_down_ptt", True))
    return {
        "status": "ok",
        "settings": {
            "bg_type": s.bg_type,
            "bg_color": s.bg_color,
            "language": s.language,
            "simultaneous_slots": s.simultaneous_slots,
            "mute_on_ptt": s.mute_on_ptt,
            "volume_down_ptt": v_ret_ptt,
            "volume_up_ptt": v_ret_ptt,
            "sync_hotspot_volume": getattr(s, "sync_hotspot_volume", True),
            "sync_system_volume": getattr(s, "sync_system_volume", True),
            "loopback_mode": s.loopback_mode,
            "quick_mem": s.quick_mem,
            "hamqth_username": getattr(s, "hamqth_username", "") or "",
            "hamqth_password": getattr(s, "hamqth_password", "") or "",
        }
    }

class ContactsUpdate(BaseModel):
    contacts: Optional[List[Dict[str, Any]]] = None
    gateway: Optional[Dict[str, Any]] = None

@app.get("/api/contacts")
async def get_contacts(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    gw = getattr(s, "contacts_gateway", None) or {"hotspot_id": "default", "slot": 2}
    valid_ids = [h.id for h in hotspot_manager.settings.hotspots]
    if valid_ids and gw.get("hotspot_id") not in valid_ids:
        gw["hotspot_id"] = valid_ids[0]
        s.contacts_gateway = gw
        await save_user_settings(uid, s.model_dump())
        if uid == 1:
            save_app_settings(s)
    return {
        "status": "ok",
        "contacts": getattr(s, "contacts", []) or [],
        "gateway": gw
    }

@app.post("/api/contacts")
async def save_contacts(update: ContactsUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    changed = False
    if update.contacts is not None:
        s.contacts = update.contacts
        changed = True
    if update.gateway is not None:
        s.contacts_gateway = update.gateway
        changed = True
    if changed:
        await save_user_settings(uid, s.model_dump())
        if uid == 1:
            save_app_settings(s)
    return {
        "status": "ok",
        "contacts": getattr(s, "contacts", []) or [],
        "gateway": getattr(s, "contacts_gateway", {"hotspot_id": "default", "slot": 2}) or {"hotspot_id": "default", "slot": 2}
    }

class TranscriberSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    api_key: Optional[str] = None
    api_keys: Optional[List[str]] = None
    model: Optional[str] = None
    target_lang: Optional[str] = None
    tts_enabled: Optional[bool] = None
    tts_engine: Optional[str] = None
    tts_model: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_speed: Optional[float] = None
    tts_ducking_level: Optional[float] = None
    tts_pause_ducking_level: Optional[float] = None
    tts_mute_others: Optional[bool] = None
    tts_announce_callsign: Optional[bool] = None
    tts_style: Optional[str] = None

class TtsTestRequest(BaseModel):
    text: Optional[str] = None
    voice: Optional[str] = None
    model: Optional[str] = None
    api_key: Optional[str] = None
    target_lang: Optional[str] = None
    lang: Optional[str] = None
    engine: Optional[str] = None
    speed: Optional[float] = 1.0
    announce_callsign: Optional[bool] = False
    callsign: Optional[str] = None
    tts_style: Optional[str] = None

class RecordingTtsTranslateRequest(BaseModel):
    target_lang: Optional[str] = None
    engine: Optional[str] = None
    model: Optional[str] = None
    voice: Optional[str] = None
    api_key: Optional[str] = None
    speed: Optional[float] = 1.0
    tts_style: Optional[str] = None

@app.get("/api/transcriber/settings")
async def get_transcriber_settings(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    return {
        "status": "ok",
        "settings": {
            "enabled": getattr(s, "transcriber_enabled", False),
            "api_key": getattr(s, "transcriber_api_key", ""),
            "api_keys": getattr(s, "transcriber_api_keys", []) or [],
            "model": getattr(s, "transcriber_model", "gemini-3.1-flash-lite"),
            "target_lang": getattr(s, "transcriber_target_lang", "ru"),
            "tts_enabled": getattr(s, "tts_enabled", False),
            "tts_engine": getattr(s, "tts_engine", "gemini"),
            "tts_model": getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"),
            "tts_voice": getattr(s, "tts_voice", "auto"),
            "tts_speed": getattr(s, "tts_speed", 1.1),
            "tts_ducking_level": getattr(s, "tts_ducking_level", 0.80),
            "tts_pause_ducking_level": getattr(s, "tts_pause_ducking_level", 1.0),
            "tts_mute_others": getattr(s, "tts_mute_others", True),
            "tts_announce_callsign": getattr(s, "tts_announce_callsign", False),
            "tts_style": getattr(s, "tts_style", "radio")
        }
    }

@app.post("/api/transcriber/settings")
async def update_transcriber_settings(update: TranscriberSettingsUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    changed = False
    if update.enabled is not None and update.enabled != s.transcriber_enabled:
        s.transcriber_enabled = update.enabled
        changed = True
    if update.api_key is not None and update.api_key != s.transcriber_api_key:
        s.transcriber_api_key = update.api_key
        changed = True
    if update.api_keys is not None:
        clean_keys = [k.strip() for k in update.api_keys if k and k.strip()]
        if clean_keys != getattr(s, "transcriber_api_keys", []):
            s.transcriber_api_keys = clean_keys
            changed = True
    if update.model is not None:
        target_model = update.model.strip()
        if any(dep in target_model.lower() for dep in ["gemini-2.5-", "gemini-2.0-", "gemini-1.5-"]):
            target_model = "gemini-3.5-flash"
        if target_model != s.transcriber_model:
            s.transcriber_model = target_model
            changed = True
    if update.target_lang is not None and update.target_lang != s.transcriber_target_lang:
        s.transcriber_target_lang = update.target_lang
        changed = True

    # If Piper TTS is active, ensure tts_voice matches the target language
    effective_engine = update.tts_engine if update.tts_engine is not None else getattr(s, "tts_engine", "gemini")
    eff_l = (s.transcriber_target_lang or "ru").lower().strip()
    if effective_engine == "piper" and eff_l != "none":
        from piper_service import PiperService
        psrv = PiperService.get_instance()
        cur_v = update.tts_voice if update.tts_voice is not None else getattr(s, "tts_voice", None)
        cur_v_lang = psrv.get_voice_lang(cur_v)
        if not cur_v or cur_v in ("auto", "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Zephyr", "Despina", "Achernar", "Orus", "Iapetus") or cur_v_lang != eff_l:
            new_v = psrv.get_installed_voice_for_lang(eff_l) or psrv.get_default_voice_for_lang(eff_l)
            if new_v and new_v != cur_v:
                s.tts_voice = new_v
                changed = True

    if update.tts_enabled is not None and update.tts_enabled != getattr(s, "tts_enabled", False):
        s.tts_enabled = update.tts_enabled
        changed = True
    if update.tts_engine is not None and update.tts_engine != getattr(s, "tts_engine", "gemini"):
        s.tts_engine = update.tts_engine
        changed = True
    if update.tts_model is not None and update.tts_model != getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"):
        s.tts_model = update.tts_model
        changed = True
    if update.tts_voice is not None and update.tts_voice != getattr(s, "tts_voice", "auto"):
        if effective_engine != "piper" or update.tts_voice != "auto":
            s.tts_voice = update.tts_voice
            changed = True
    if update.tts_speed is not None and update.tts_speed != getattr(s, "tts_speed", 1.1):
        s.tts_speed = update.tts_speed
        changed = True
    if update.tts_ducking_level is not None and update.tts_ducking_level != getattr(s, "tts_ducking_level", 0.80):
        s.tts_ducking_level = update.tts_ducking_level
        changed = True
    if update.tts_pause_ducking_level is not None and update.tts_pause_ducking_level != getattr(s, "tts_pause_ducking_level", 1.0):
        s.tts_pause_ducking_level = update.tts_pause_ducking_level
        changed = True
    if update.tts_mute_others is not None and update.tts_mute_others != getattr(s, "tts_mute_others", True):
        s.tts_mute_others = update.tts_mute_others
        changed = True
    if update.tts_announce_callsign is not None and update.tts_announce_callsign != getattr(s, "tts_announce_callsign", False):
        s.tts_announce_callsign = update.tts_announce_callsign
        changed = True
    if update.tts_style is not None and update.tts_style != getattr(s, "tts_style", "radio"):
        s.tts_style = update.tts_style
        changed = True

    if changed:
        await save_user_settings(uid, s.model_dump())
        if uid == 1:
            save_app_settings(s)
        transcriber_service.configure(
            enabled=s.transcriber_enabled,
            api_key=s.transcriber_api_key,
            model=s.transcriber_model,
            target_lang=s.transcriber_target_lang,
            api_keys=getattr(s, "transcriber_api_keys", []),
            tts_enabled=getattr(s, "tts_enabled", False),
            tts_engine=getattr(s, "tts_engine", "gemini"),
            tts_model=getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"),
            tts_voice=getattr(s, "tts_voice", "auto"),
            tts_speed=getattr(s, "tts_speed", 1.1),
            tts_ducking_level=getattr(s, "tts_ducking_level", 0.80),
            tts_pause_ducking_level=getattr(s, "tts_pause_ducking_level", 1.0),
            tts_mute_others=getattr(s, "tts_mute_others", True),
            tts_announce_callsign=getattr(s, "tts_announce_callsign", False),
            tts_style=getattr(s, "tts_style", "radio")
        )
        # Proactively ensure Piper voice is downloaded/preloaded if Piper TTS is active
        if effective_engine == "piper" and eff_l != "none":
            try:
                from piper_service import PiperService
                psrv = PiperService.get_instance()
                target_v = getattr(s, "tts_voice", None)
                if target_v:
                    if not psrv.is_voice_installed(target_v):
                        logger.info(f"[PIPER] Proactively starting background download of voice '{target_v}' for language '{eff_l}'...")
                        psrv.start_download(target_v)
                    else:
                        logger.info(f"[PIPER] Pre-loading installed voice '{target_v}' for language '{eff_l}' into RAM...")
                        asyncio.create_task(psrv.preload_voice_async(target_v))
            except Exception as pe:
                logger.warning(f"[PIPER] Could not auto-download or preload voice on settings save: {pe}")

        await broadcast_json({
            "type": "transcriber_settings_change",
            "enabled": s.transcriber_enabled,
            "model": s.transcriber_model,
            "target_lang": s.transcriber_target_lang,
            "has_key": bool(s.transcriber_api_key or getattr(s, "transcriber_api_keys", [])),
            "tts_enabled": getattr(s, "tts_enabled", False),
            "tts_engine": getattr(s, "tts_engine", "gemini"),
            "tts_model": getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"),
            "tts_voice": getattr(s, "tts_voice", "auto"),
            "tts_speed": getattr(s, "tts_speed", 1.1),
            "tts_ducking_level": getattr(s, "tts_ducking_level", 0.80),
            "tts_pause_ducking_level": getattr(s, "tts_pause_ducking_level", 1.0),
            "tts_mute_others": getattr(s, "tts_mute_others", True),
            "tts_announce_callsign": getattr(s, "tts_announce_callsign", False),
            "tts_style": getattr(s, "tts_style", "radio"),
        })

    return {
        "status": "ok",
        "settings": {
            "enabled": s.transcriber_enabled,
            "api_key": s.transcriber_api_key,
            "api_keys": getattr(s, "transcriber_api_keys", []) or [],
            "model": s.transcriber_model,
            "target_lang": s.transcriber_target_lang,
            "tts_enabled": getattr(s, "tts_enabled", False),
            "tts_engine": getattr(s, "tts_engine", "gemini"),
            "tts_model": getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"),
            "tts_voice": getattr(s, "tts_voice", "auto"),
            "tts_speed": getattr(s, "tts_speed", 1.1),
            "tts_ducking_level": getattr(s, "tts_ducking_level", 0.80),
            "tts_pause_ducking_level": getattr(s, "tts_pause_ducking_level", 1.0),
            "tts_mute_others": getattr(s, "tts_mute_others", True),
            "tts_announce_callsign": getattr(s, "tts_announce_callsign", False),
            "tts_style": getattr(s, "tts_style", "radio"),
        }
    }

@app.post("/api/transcriber/tts-test")
async def test_transcriber_tts(req: TtsTestRequest, request: Request):
    user = _get_user_from_request(request)
    target_lang = req.target_lang or req.lang or getattr(transcriber_service, "target_lang", "ru")
    if target_lang == "none" or not target_lang:
        target_lang = "ru"

    req_engine = req.engine or getattr(transcriber_service, "tts_engine", "gemini")
    req_voice = (req.voice or "").strip()

    # For Piper TTS: if an installed voice is specified, align target_lang to that voice's language
    if req_engine == "piper" and req_voice and req_voice != "auto":
        try:
            from piper_service import PiperService
            psrv = PiperService.get_instance()
            v_lang = psrv.get_voice_lang(req_voice)
            if v_lang and psrv.is_voice_installed(req_voice):
                target_lang = v_lang
        except Exception:
            pass

    from transcriber import TTS_TEST_PHRASES, get_tts_test_phrase

    test_text = (req.text or "").strip()
    if not test_text or test_text in TTS_TEST_PHRASES.values():
        test_text = get_tts_test_phrase(target_lang)
    wav_bytes, err = await transcriber_service.synthesize_speech(
        text=test_text,
        model=req.model,
        voice=req.voice,
        api_key=req.api_key,
        target_lang=target_lang,
        engine=req_engine,
        speed=req.speed or 1.0,
        callsign=req.callsign or "RX6AWG",
        announce_callsign=bool(req.announce_callsign),
        style=req.tts_style
    )
    if err or not wav_bytes:
        return JSONResponse({"status": "error", "message": err or "Ошибка синтеза речи"}, status_code=400)
    b64 = base64.b64encode(wav_bytes).decode("ascii")
    return {"status": "ok", "audio_base64": b64, "text": test_text, "target_lang": target_lang}


class PiperDownloadRequest(BaseModel):
    voice_id: str


@app.get("/api/transcriber/piper/voices")
async def api_piper_voices(lang: Optional[str] = None):
    from piper_service import PiperService
    srv = PiperService.get_instance()
    installed = srv.list_installed_voices()
    available = srv.get_voices_for_lang(lang) if lang else []
    return {
        "status": "ok",
        "installed": installed,
        "available": available,
        "lang": lang
    }


@app.get("/api/transcriber/piper/check-lang")
async def api_piper_check_lang(lang: str):
    from piper_service import PiperService
    srv = PiperService.get_instance()
    clean_lang = (lang or "").lower().strip()
    supported = srv.is_lang_supported(clean_lang)
    has_installed = srv.has_installed_voice_for_lang(clean_lang)
    voices = srv.get_voices_for_lang(clean_lang, force_reload=True)
    installed_voices = [v for v in voices if v["installed"]]
    default_voice = srv.get_default_voice_for_lang(clean_lang)
    return {
        "status": "ok",
        "lang": clean_lang,
        "supported": supported,
        "has_installed": has_installed,
        "installed_count": len(installed_voices),
        "available_count": len(voices),
        "default_voice": default_voice,
        "installed_voices": installed_voices,
        "available_voices": voices
    }


@app.post("/api/transcriber/piper/download")
async def api_piper_download(req: PiperDownloadRequest):
    from piper_service import PiperService
    srv = PiperService.get_instance()
    status = srv.start_download(req.voice_id)
    return {"status": "ok", "download": status}


@app.get("/api/transcriber/piper/download/status")
async def api_piper_download_status(voice_id: Optional[str] = None):
    from piper_service import PiperService
    srv = PiperService.get_instance()
    if voice_id:
        status = srv.get_download_status(voice_id)
    else:
        status = srv.get_any_active_download_status()
    return {"status": "ok", "download": status}

@app.get("/api/transcriber/models")
async def get_transcriber_models(api_key: Optional[str] = None):
    key = api_key if api_key else app_settings.transcriber_api_key
    models = await asyncio.to_thread(GeminiTranscriberService.fetch_available_models, key)
    transcribe_models = [
        m for m in models
        if m.get("category") == "transcribe"
        and "tts" not in m.get("id", "").lower()
        and "tts" not in (m.get("name") or "").lower()
    ]
    tts_models = [m for m in models if m.get("category") == "tts"]
    return {
        "status": "ok",
        "models": models,
        "transcribe_models": transcribe_models,
        "tts_models": tts_models
    }

@app.post("/api/transcriber/disable_all")
async def api_transcriber_disable_all():
    if transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
        transcriber_service.disable_all_slots()
    await broadcast_json({"type": "transcribe_all_disabled"})
    return {"status": "ok", "message": "All transcribers disabled"}

@app.post("/api/transcriber/disable_hotspot/{hotspot_id}")
async def api_transcriber_disable_hotspot(hotspot_id: str):
    target_id = hotspot_manager.settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    if transcriber_service and hasattr(transcriber_service, "disable_hotspot"):
        transcriber_service.disable_hotspot(target_id)
    await broadcast_json({"type": "hotspot_transcribe_disabled", "hotspot_id": target_id})
    return {"status": "ok", "message": f"Transcribers disabled for hotspot {target_id}"}


class OfflineTranscriberRunner:
    def __init__(self, hotspot_id: str, transcriber: GeminiTranscriberService, broadcast_fn):
        self.hotspot_id = hotspot_id
        self.transcriber = transcriber
        self.broadcast_fn = broadcast_fn
        self.task: Optional[asyncio.Task] = None
        self.is_running: bool = False
        self._stop_requested: bool = False
        self.delete_original: bool = False
        self.stats: dict = {"total": 0, "processed": 0, "current": "", "hotspot_id": hotspot_id}

    def start(self, user_id: int = 1, delete_original: bool = False, target_recordings: Optional[list[dict]] = None) -> bool:
        if self.is_running:
            return False
        self.is_running = True
        self._stop_requested = False
        self.delete_original = bool(delete_original)
        self.task = asyncio.create_task(self._run(user_id, target_recordings=target_recordings))
        return True

    def stop(self) -> bool:
        if not self.is_running:
            return False
        self._stop_requested = True
        if self.task and not self.task.done():
            self.task.cancel()
        self.is_running = False
        return True

    async def _run(self, user_id: int, target_recordings: Optional[list[dict]] = None):
        try:
            logger.info(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Process started (targeted={bool(target_recordings)}).")

            if target_recordings is not None:
                recordings = target_recordings
            else:
                recordings = await get_untranscribed_recordings(user_id=user_id, limit=100, hotspot_id=self.hotspot_id)

            self.stats = {"total": len(recordings), "processed": 0, "current": "", "hotspot_id": self.hotspot_id}

            await self.broadcast_fn({
                "type": "offline_transcribe_state",
                "hotspot_id": self.hotspot_id,
                "active": True,
                "status": "running",
                "stats": self.stats
            })

            # Broadcast initial progress immediately so UI updates with exact total count instantly
            await self.broadcast_fn({
                "type": "offline_transcribe_progress",
                "hotspot_id": self.hotspot_id,
                "processed": 0,
                "total": self.stats["total"],
                "current": ""
            })

            if not recordings:
                logger.info(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] No recordings to transcribe.")
                await self.broadcast_fn({
                    "type": "offline_transcribe_state",
                    "hotspot_id": self.hotspot_id,
                    "active": False,
                    "status": "completed",
                    "stats": self.stats,
                    "message": f"Нет записей для хотспота {self.hotspot_id}"
                })
                return

            for rec in recordings:
                if self._stop_requested:
                    logger.info(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Stopped by user request.")
                    break

                rec_file = Path(rec.get("resolved_file_path") or rec.get("file_path", ""))
                if not rec_file.is_file():
                    rec_file = RECORDINGS_DIR / rec.get("filename", "")

                if not rec_file.is_file():
                    if rec_file.with_suffix(".wav").is_file():
                        rec_file = rec_file.with_suffix(".wav")
                    elif rec_file.with_suffix(".mp3").is_file():
                        rec_file = rec_file.with_suffix(".mp3")
                    else:
                        continue

                callsign = rec.get("src_callsign") or str(rec.get("src_id"))
                self.stats["current"] = callsign

                try:
                    wav_bytes = await asyncio.to_thread(rec_file.read_bytes)
                    if len(wav_bytes) >= 44:
                        mime = "audio/mpeg" if rec_file.suffix.lower() == ".mp3" else "audio/wav"
                        text, lang, err = await self.transcriber.transcribe_wav(
                            wav_bytes,
                            src_callsign=rec.get("src_callsign", ""),
                            src_id=rec.get("src_id", 0),
                            mime_type=mime
                        )
                        if err and ("429" in str(err) or "RESOURCE_EXHAUSTED" in str(err) or "quota" in str(err).lower()):
                            logger.error(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Quota exceeded: {err}")
                            await self.broadcast_fn({
                                "type": "offline_transcribe_state",
                                "hotspot_id": self.hotspot_id,
                                "active": False,
                                "status": "error",
                                "stats": self.stats,
                                "message": "Превышена квота Google Gemini API (429 Quota Exceeded). Процесс остановлен."
                            })
                            break
                        if text:
                            await update_recording_transcription(rec["id"], text)
                            hotspot_manager.attach_transcription(
                                hotspot_id=rec.get("hotspot_id") or self.hotspot_id,
                                slot=rec.get("slot", 1),
                                src_id=rec.get("src_id", 0),
                                text=text,
                                lang=lang or "---",
                                is_final=True,
                                call_id=rec.get("call_id") or None,
                                created_at=rec.get("created_at")
                            )
                            # Broadcast dedicated recording_transcribed event for instant real-time UI updates
                            await self.broadcast_fn({
                                "type": "recording_transcribed",
                                "recording_id": rec.get("id") or "",
                                "call_id": rec.get("call_id") or "",
                                "hotspot_id": rec.get("hotspot_id") or self.hotspot_id,
                                "slot": rec.get("slot", 1),
                                "src_id": rec.get("src_id", 0),
                                "callsign": rec.get("src_callsign", ""),
                                "src_name": rec.get("src_name", ""),
                                "dst_id": rec.get("dst_id", 0),
                                "created_at": rec.get("created_at", 0),
                                "duration": rec.get("duration", 0),
                                "lang": lang or "---",
                                "text": text,
                                "is_final": True
                            })
                            # Also broadcast call_transcription for backwards compatibility
                            await self.broadcast_fn({
                                "type": "call_transcription",
                                "recording_id": rec.get("id") or "",
                                "hotspot_id": rec.get("hotspot_id") or self.hotspot_id,
                                "slot": rec.get("slot", 1),
                                "src_id": rec.get("src_id", 0),
                                "callsign": rec.get("src_callsign", ""),
                                "lang": lang or "---",
                                "text": text,
                                "is_final": True,
                                "call_id": rec.get("call_id") or "",
                                "created_at": rec.get("created_at", 0)
                            })

                            if self.delete_original:
                                try:
                                    if rec_file.is_file():
                                        rec_file.unlink()
                                    mp3_path = rec_file.with_suffix(".mp3")
                                    if mp3_path.is_file():
                                        mp3_path.unlink()
                                    await delete_recording(rec["id"])
                                    await self.broadcast_fn({
                                        "type": "recording_deleted",
                                        "recording_id": rec.get("id") or "",
                                        "call_id": rec.get("call_id") or ""
                                    })
                                    logger.info(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Deleted original audio for {rec.get('id')}")
                                except Exception as del_err:
                                    logger.warning(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Failed to delete audio for {rec.get('id')}: {del_err}")
                except Exception as ex:
                    logger.warning(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Failed on {rec.get('id')}: {ex}")

                self.stats["processed"] += 1
                await self.broadcast_fn({
                    "type": "offline_transcribe_progress",
                    "hotspot_id": self.hotspot_id,
                    "processed": self.stats["processed"],
                    "total": self.stats["total"],
                    "current": self.stats["current"]
                })

                # Rate limit pause (~1.8 seconds)
                for _ in range(18):
                    if self._stop_requested:
                        break
                    await asyncio.sleep(0.1)

        except asyncio.CancelledError:
            logger.info(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Task cancelled.")
        except Exception as e:
            logger.error(f"[OFFLINE-TRANSCRIBE][{self.hotspot_id}] Unexpected error: {e}", exc_info=True)
        finally:
            self.is_running = False
            await self.broadcast_fn({
                "type": "offline_transcribe_state",
                "hotspot_id": self.hotspot_id,
                "active": False,
                "status": "stopped",
                "stats": self.stats
            })


class OfflineTranscribeManager:
    def __init__(self, transcriber: GeminiTranscriberService, broadcast_fn):
        self.transcriber = transcriber
        self.broadcast_fn = broadcast_fn
        self.runners: dict[str, OfflineTranscriberRunner] = {}

    def get_runner(self, hotspot_id: str) -> OfflineTranscriberRunner:
        hid = hotspot_id or "default"
        if hid not in self.runners:
            self.runners[hid] = OfflineTranscriberRunner(hid, self.transcriber, self.broadcast_fn)
        return self.runners[hid]

    def start(self, hotspot_id: str, user_id: int = 1, delete_original: bool = False, target_recordings: Optional[list[dict]] = None) -> bool:
        runner = self.get_runner(hotspot_id)
        return runner.start(user_id=user_id, delete_original=delete_original, target_recordings=target_recordings)

    def stop(self, hotspot_id: Optional[str] = None) -> bool:
        if hotspot_id:
            runner = self.runners.get(hotspot_id)
            return runner.stop() if runner else False
        else:
            stopped_any = False
            for runner in self.runners.values():
                if runner.stop():
                    stopped_any = True
            return stopped_any

    @property
    def is_running(self) -> bool:
        return any(r.is_running for r in self.runners.values())

    def get_status(self, hotspot_id: Optional[str] = None) -> dict:
        if hotspot_id:
            runner = self.runners.get(hotspot_id)
            return {
                "active": runner.is_running if runner else False,
                "stats": runner.stats if runner else {"total": 0, "processed": 0, "current": "", "hotspot_id": hotspot_id}
            }
        statuses = {hid: {"active": r.is_running, "stats": r.stats} for hid, r in self.runners.items()}
        return {
            "active": self.is_running,
            "hotspots": statuses
        }


offline_transcribe_manager = OfflineTranscribeManager(transcriber_service, broadcast_json)
offline_transcriber_runner = offline_transcribe_manager.get_runner("default")


@app.get("/api/transcriber/offline/status")
async def api_get_offline_transcribe_status(hotspot_id: Optional[str] = None):
    st = offline_transcribe_manager.get_status(hotspot_id)
    return {
        "status": "ok",
        "active": st.get("active", False),
        "stats": st.get("stats") or {},
        "hotspots": st.get("hotspots") or {}
    }


@app.post("/api/transcriber/offline/start")
async def api_start_offline_transcribe(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if not transcriber_service.api_key:
        return JSONResponse({"status": "error", "message": "Не указан API ключ Gemini в настройках транскрибации"}, status_code=400)
    delete_orig = False
    hid = "default"
    try:
        body = await request.json()
        if isinstance(body, dict):
            delete_orig = bool(body.get("delete_original", False))
            hid = body.get("hotspot_id") or "default"
    except Exception:
        pass
    started = offline_transcribe_manager.start(hotspot_id=hid, user_id=uid, delete_original=delete_orig)
    return {"status": "ok", "active": started, "delete_original": delete_orig, "hotspot_id": hid}


@app.post("/api/transcriber/offline/stop")
async def api_stop_offline_transcribe(request: Request):
    hid = None
    try:
        body = await request.json()
        if isinstance(body, dict):
            hid = body.get("hotspot_id")
    except Exception:
        pass
    stopped = offline_transcribe_manager.stop(hotspot_id=hid)
    return {"status": "ok", "active": False, "stopped": stopped, "hotspot_id": hid}

class WallpaperUploadRequest(BaseModel):
    theme: str = "dark"
    image_base64: str

@app.post("/api/settings/wallpaper")
async def upload_wallpaper(payload: WallpaperUploadRequest, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    theme = "light" if payload.theme == "light" else "dark"
    raw_data = payload.image_base64
    if "," in raw_data:
        raw_data = raw_data.split(",", 1)[1]
    try:
        img_bytes = base64.b64decode(raw_data)
        wp_dir = STATIC_DIR / "img" / "wallpapers"
        wp_dir.mkdir(parents=True, exist_ok=True)
        out_file = wp_dir / f"bg-custom-u{uid}-{theme}.jpg"
        out_file.write_bytes(img_bytes)
        url = f"/static/img/wallpapers/bg-custom-u{uid}-{theme}.jpg?v={int(time.time())}"
        await broadcast_user_json(uid, {"type": "wallpaper_change", "theme": theme, "url": url})
        return {"status": "ok", "theme": theme, "url": url}
    except Exception as e:
        logger.exception(f"Failed to save wallpaper: {e}")
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/settings/wallpaper/reset")
async def reset_wallpaper(payload: Dict[str, str], request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    theme = "light" if payload.get("theme") == "light" else "dark"
    wp_dir = STATIC_DIR / "img" / "wallpapers"
    out_file = wp_dir / f"bg-custom-u{uid}-{theme}.jpg"
    if out_file.exists():
        try:
            out_file.unlink()
        except Exception as e:
            logger.warning(f"Failed to delete custom wallpaper: {e}")
    if uid == 1:
        legacy_file = STATIC_DIR / "img" / f"bg-custom-{theme}.jpg"
        if legacy_file.exists():
            try:
                legacy_file.unlink()
            except Exception:
                pass
    await broadcast_user_json(uid, {"type": "wallpaper_reset", "theme": theme})
    return {"status": "ok", "theme": theme}

BM_MASTERS_CACHE = {
    "timestamp": 0,
    "data": []
}

COUNTRY_NAMES_RU = {
    "AT": ("Австрия", "🇦🇹"),
    "RU": ("Россия", "🇷🇺"),
    "DE": ("Германия", "🇩🇪"),
    "CH": ("Швейцария", "🇨🇭"),
    "US": ("США", "🇺🇸"),
    "FR": ("Франция", "🇫🇷"),
    "GB": ("Великобритания", "🇬🇧"),
    "ES": ("Испания", "🇪🇸"),
    "IT": ("Италия", "🇮🇹"),
    "NL": ("Нидерланды", "🇳🇱"),
    "PL": ("Польша", "🇵🇱"),
    "CZ": ("Чехия", "🇨🇿"),
    "SE": ("Швеция", "🇸🇪"),
    "FI": ("Финляндия", "🇫🇮"),
    "NO": ("Норвегия", "🇳🇴"),
    "DK": ("Дания", "🇩🇰"),
    "HU": ("Венгрия", "🇭🇺"),
    "RO": ("Румыния", "🇷🇴"),
    "BG": ("Болгария", "🇧🇬"),
    "SI": ("Словения", "🇸🇮"),
    "PT": ("Португалия", "🇵🇹"),
    "IE": ("Ирландия", "🇮🇪"),
    "GR": ("Греция", "🇬🇷"),
    "BE": ("Бельгия", "🇧🇪"),
    "CA": ("Канада", "🇨🇦"),
    "IL": ("Израиль", "🇮🇱"),
    "AU": ("Австралия", "🇦🇺"),
    "KR": ("Южная Корея", "🇰🇷"),
    "CN": ("Китай", "🇨🇳"),
    "MY": ("Малайзия", "🇲🇾"),
    "PH": ("Филиппины", "🇵🇭"),
    "ZA": ("ЮАР", "🇿🇦"),
    "BR": ("Бразилия", "🇧🇷"),
    "CL": ("Чили", "🇨🇱"),
    "MX": ("Мексика", "🇲🇽"),
}

BM_MASTERS_DEFAULT = [
    {"id": 2322, "country": "AT", "address": "62.171.130.35"},
    {"id": 2502, "country": "RU", "address": "44.32.144.132"},
    {"id": 2503, "country": "RU", "address": "164.215.71.108"},
    {"id": 2622, "country": "DE", "address": "178.238.234.72"},
    {"id": 2621, "country": "DE", "address": "87.106.126.49"},
    {"id": 2282, "country": "CH", "address": "185.46.59.78"},
    {"id": 3102, "country": "US", "address": "74.91.114.19"},
    {"id": 3103, "country": "US", "address": "74.91.118.251"},
    {"id": 3104, "country": "US", "address": "162.248.88.117"},
    {"id": 2082, "country": "FR", "address": "217.182.129.131"},
    {"id": 2341, "country": "GB", "address": "51.68.220.36"},
    {"id": 2141, "country": "ES", "address": "84.232.5.113"},
    {"id": 2222, "country": "IT", "address": "31.14.134.183"},
    {"id": 2041, "country": "NL", "address": "44.137.42.20"},
    {"id": 2602, "country": "PL", "address": "195.26.76.59"},
    {"id": 2302, "country": "CZ", "address": "80.250.21.206"},
    {"id": 2402, "country": "SE", "address": "44.5.24.178"},
    {"id": 2441, "country": "FI", "address": "85.188.1.107"},
    {"id": 2421, "country": "NO", "address": "80.89.46.242"},
    {"id": 2382, "country": "DK", "address": "185.51.76.16"},
    {"id": 2162, "country": "HU", "address": "185.187.75.192"},
    {"id": 2262, "country": "RO", "address": "94.176.6.38"},
    {"id": 2841, "country": "BG", "address": "44.31.90.2"},
    {"id": 2931, "country": "SI", "address": "46.54.227.93"},
    {"id": 2682, "country": "PT", "address": "193.137.237.12"},
    {"id": 2721, "country": "IE", "address": "44.155.254.5"},
    {"id": 2022, "country": "GR", "address": "185.4.134.95"},
    {"id": 2061, "country": "BE", "address": "194.146.121.130"},
    {"id": 3021, "country": "CA", "address": "158.69.203.89"},
    {"id": 4251, "country": "IL", "address": "31.154.7.7"},
    {"id": 5051, "country": "AU", "address": "103.230.158.71"},
    {"id": 4501, "country": "KR", "address": "211.60.41.188"},
    {"id": 4602, "country": "CN", "address": "43.129.83.124"},
    {"id": 5021, "country": "MY", "address": "103.197.58.171"},
    {"id": 5151, "country": "PH", "address": "120.89.61.77"},
    {"id": 6551, "country": "ZA", "address": "154.66.196.131"},
    {"id": 7242, "country": "BR", "address": "69.62.93.116"},
    {"id": 7301, "country": "CL", "address": "170.239.84.17"},
    {"id": 3341, "country": "MX", "address": "72.1.241.232"},
]

@app.get("/api/bm/masters")
async def get_bm_masters():
    now = time.time()
    if BM_MASTERS_CACHE["data"] and (now - BM_MASTERS_CACHE["timestamp"] < 3600):
        return {"masters": BM_MASTERS_CACHE["data"]}

    def _fetch():
        import urllib.request, json
        data = None
        try:
            req = urllib.request.Request("https://api.brandmeister.network/v2/master", headers={"User-Agent": "ProxDMR/0.1"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode())
        except Exception:
            pass

        raw_list = data if isinstance(data, list) and len(data) > 0 else BM_MASTERS_DEFAULT
        res = []
        for item in raw_list:
            mid = item.get("id")
            cc = item.get("country", "").upper()
            c_name, c_flag = COUNTRY_NAMES_RU.get(cc, (cc or "Другая страна", "🌐"))
            host = f"{mid}.master.brandmeister.network"
            is_rec = (mid == 2322)
            label = f"{c_flag} {c_name} — BM {mid} ({host})" + (" ⭐ [Рекомендуется]" if is_rec else "")
            res.append({
                "id": mid,
                "country_code": cc,
                "country_name": c_name,
                "flag": c_flag,
                "host": host,
                "ip": item.get("address", ""),
                "label": label,
                "recommended": is_rec,
            })

        def sort_key(m):
            if m["id"] == 2322: return (0, "")
            if m["country_code"] == "RU": return (1, str(m["id"]))
            if m["country_code"] == "DE": return (2, str(m["id"]))
            return (3, m["country_name"])

        res.sort(key=sort_key)
        return res

    result = await asyncio.to_thread(_fetch)
    BM_MASTERS_CACHE["timestamp"] = now
    BM_MASTERS_CACHE["data"] = result
    return {"masters": result}

@app.get("/api/bm/benchmark/results")
async def api_get_bm_benchmark_results():
    return {
        "status": "ok",
        "running": bm_ping_service.is_benchmark_running(),
        "results": bm_ping_service.get_benchmark_results()
    }

@app.post("/api/bm/benchmark/start")
async def api_start_bm_benchmark():
    masters_data = await get_bm_masters()
    servers = masters_data.get("masters", [])
    success = await bm_ping_service.start_benchmark(servers)
    return {
        "status": "ok" if success else "already_running",
        "running": True
    }

@app.post("/api/bm/benchmark/cancel")
async def api_cancel_bm_benchmark():
    bm_ping_service.cancel_benchmark()
    return {"status": "ok", "running": False}

@app.post("/api/hotspots/{hotspot_id}/connect")
async def connect_hotspot(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    success = await hotspot_manager.connect_hotspot(target_id, user_id=uid)
    rt = hotspot_manager.get_runtime(uid, target_id)
    return {"status": "ok" if success else "error", "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}

@app.post("/api/hotspots/{hotspot_id}/disconnect")
async def disconnect_hotspot(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    success = await hotspot_manager.disconnect_hotspot(target_id, user_id=uid)
    rt = hotspot_manager.get_runtime(uid, target_id)
    return {"status": "ok" if success else "error", "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}

@app.post("/api/hotspots/{hotspot_id}/reconnect")
async def reconnect_hotspot_api(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    success = await hotspot_manager.reconnect_hotspot(target_id, user_id=uid)
    rt = hotspot_manager.get_runtime(uid, target_id)
    return {"status": "ok" if success else "error", "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}

@app.post("/api/hotspots/{hotspot_id}/collapse")
async def collapse_hotspot_api(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    success = await hotspot_manager.set_hotspot_collapsed(target_id, True, user_id=uid)
    if success:
        rt = hotspot_manager.get_runtime(uid, target_id)
        return {"status": "ok", "collapsed": True, "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}
    raise HTTPException(status_code=404, detail="Хотспот не найден")

@app.post("/api/hotspots/{hotspot_id}/expand")
async def expand_hotspot_api(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    success = await hotspot_manager.set_hotspot_collapsed(target_id, False, user_id=uid)
    if success:
        rt = hotspot_manager.get_runtime(uid, target_id)
        return {"status": "ok", "collapsed": False, "bm_status": rt.status.value if rt else "ONLINE", "detail": rt.detail if rt else ""}
    raise HTTPException(status_code=404, detail="Хотспот не найден")

@app.post("/api/hotspots/active")
async def set_active_hotspot(payload: dict, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    hid = payload.get("id")
    if not hid or not hotspot_manager.set_active_hotspot(hid, user_id=uid):
        raise HTTPException(status_code=404, detail="Хотспот не найден")
    return {"status": "ok", "active_hotspot_id": hid}

@app.post("/api/radio/tg")
async def set_radio_tg(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    u_radio_state = hotspot_manager.get_user_tx_state(user_id=uid)
    slot = int(payload.get("slot", u_radio_state.tx_slot))
    new_tg = int(payload.get("tg", u_radio_state.active_tg))
    hid = payload.get("hotspot_id")
    target_hs = (hotspot_manager.get_runtime(uid, hid) if hid else None) or hotspot_manager.get_active_runtime(uid)
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings

    if target_hs:
        if new_tg == 4000:
            hotspot_manager.clear_dynamic_tgs(target_hs.config.id, slot=slot, user_id=uid)
        elif new_tg > 0 and new_tg not in (4000, 9990):
            hotspot_manager.register_dynamic_tg(target_hs.config.id, slot, new_tg, user_id=uid)
        target_hs.config.default_tg_ts1 = new_tg
        target_hs.config.default_tg_ts2 = new_tg
        if hasattr(target_hs.config, "default_tg"):
            target_hs.config.default_tg = new_tg
        for hs in user_sett.hotspots:
            if hs.id == target_hs.config.id:
                hs.default_tg_ts1 = new_tg
                hs.default_tg_ts2 = new_tg
                if hasattr(hs, "default_tg"):
                    hs.default_tg = new_tg
                break
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)

    if target_hs and target_hs.config.id == getattr(user_sett, "active_hotspot_id", None):
        u_radio_state.active_tg = new_tg

    logger.info(f"[TG] API (user {uid}) updated Hotspot {target_hs.config.id if target_hs else 'default'} TG to {new_tg}")
    await broadcast_json({
        "type": "tg_change",
        "user_id": uid,
        "hotspot_id": target_hs.config.id if target_hs else "",
        "active_tg": new_tg,
        "slot": slot,
        "tg_ts1": new_tg,
        "tg_ts2": new_tg
    }, user_id=uid)
    return {
        "status": "ok",
        "hotspot_id": target_hs.config.id if target_hs else "",
        "slot": slot,
        "tg": new_tg,
        "tg_ts1": new_tg,
        "tg_ts2": new_tg
    }

def _get_bm_device_and_key(
    hotspot_id: Optional[str] = None,
    allow_fallback: bool = False,
    user_id: Optional[int] = None,
):
    """Retrieve device ID, API key, and hotspot config for BrandMeister REST operations."""
    uid = user_id if user_id is not None else hotspot_manager.active_user_id
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings

    rt = hotspot_manager.get_runtime(uid, hotspot_id)
    cfg = rt.config if rt else None

    if not cfg:
        # Check in user's saved hotspots list
        if hotspot_id and hotspot_id not in ("active", "default"):
            for h in user_sett.hotspots:
                if h.id == hotspot_id:
                    cfg = h
                    break
        if not cfg:
            cfg = user_sett.get_active_hotspot() if hasattr(user_sett, "get_active_hotspot") else (user_sett.hotspots[0] if user_sett.hotspots else None)

    if not cfg and allow_fallback:
        # Fallback to global default hotspot settings if allowed
        rt_fallback = hotspot_manager.get_active_runtime()
        cfg = rt_fallback.config if rt_fallback else (hotspot_manager.settings.hotspots[0] if hotspot_manager.settings.hotspots else None)

    if not cfg:
        return None, None, None, "Хотспот не найден"

    api_key = (cfg.bm_api_key or "").strip()
    if not api_key and not allow_fallback:
        return None, None, None, f"BM API Key (v2) не настроен для «{cfg.name or 'хотспота'}»"

    if cfg.dmr_id <= 0 and not allow_fallback:
        return None, None, None, f"DMR ID не настроен для «{cfg.name or 'хотспота'}»"

    device_id = f"{cfg.dmr_id}{cfg.bm_ssid:02d}" if (cfg and cfg.bm_ssid > 0) else str(cfg.dmr_id if (cfg and cfg.dmr_id > 0) else "")
    return cfg, device_id, api_key, None

@app.get("/api/bm/api-status")
async def get_bm_api_status(hotspot_id: Optional[str] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, allow_fallback=False, user_id=uid)
    if not api_key:
        return {"status": "NO_KEY", "detail": err or "Ключ не задан", "device_id": device_id}

    def _check():
        import urllib.request, urllib.error
        # Use BM v2 action/getRepeater or selfcare endpoint.
        # Note: /v2/user is restricted by BrandMeister and returns HTTP 403 (Interactive login required).
        if device_id:
            url = f"https://api.brandmeister.network/v2/device/{device_id}/action/getRepeater"
        elif cfg and cfg.dmr_id:
            url = f"https://api.brandmeister.network/v2/selfcare/{cfg.dmr_id}"
        else:
            url = "https://api.brandmeister.network/v2/device/byCall"

        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "ProxDMR/0.1",
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=4) as resp:
                if resp.status == 200:
                    return {"status": "ONLINE", "detail": "Авторизован", "device_id": device_id}
                return {"status": "ERROR", "detail": f"HTTP {resp.status}", "device_id": device_id}
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return {"status": "AUTH_FAILED", "detail": "Неверный токен (401)", "device_id": device_id}
            # Fallback to selfcare check if repeater/device action returns 404
            if e.code == 404 and cfg and cfg.dmr_id and url != f"https://api.brandmeister.network/v2/selfcare/{cfg.dmr_id}":
                try:
                    fallback_url = f"https://api.brandmeister.network/v2/selfcare/{cfg.dmr_id}"
                    req_fb = urllib.request.Request(
                        fallback_url,
                        headers={
                            "User-Agent": "ProxDMR/0.1",
                            "Authorization": f"Bearer {api_key}",
                            "Accept": "application/json"
                        }
                    )
                    with urllib.request.urlopen(req_fb, timeout=4) as resp_fb:
                        if resp_fb.status == 200:
                            return {"status": "ONLINE", "detail": "Авторизован", "device_id": device_id}
                except urllib.error.HTTPError as ef:
                    if ef.code in (401, 403):
                        return {"status": "AUTH_FAILED", "detail": "Неверный токен (401)", "device_id": device_id}
            return {"status": "ERROR", "detail": f"HTTP {e.code}", "device_id": device_id}
        except Exception as e:
            return {"status": "OFFLINE", "detail": "Сервер BM недоступен", "device_id": device_id}

    return await asyncio.to_thread(_check)

@app.get("/api/tg/names")
async def get_tg_names():
    """Returns all locally cached and synchronized TalkGroup names."""
    return {"status": "ok", "names": tg_resolver.get_all_names()}

@app.post("/api/tg/lookup")
async def lookup_tg_names(payload: dict):
    """Resolves names for a list of TalkGroups, querying BM online if unknown and saving to local cache."""
    tgs = payload.get("talkgroups", [])
    try:
        tgs = [int(x) for x in tgs if int(x) > 0]
    except Exception:
        tgs = []
    res = await tg_resolver.resolve_many(tgs)
    return {"status": "ok", "names": {str(k): v for k, v in res.items()}}


@app.get("/api/tg/stats")
async def get_tg_stats():
    """Returns database statistics for TalkGroups catalog."""
    return {"status": "ok", "stats": tg_resolver.get_stats()}

@app.get("/api/tg/search")
async def search_talkgroups(q: str = "", limit: int = 50):
    """Searches TalkGroups across numbers, Russian/English names, cities, and countries."""
    results = tg_resolver.search_talkgroups(q, limit=limit)
    return {"status": "ok", "query": q, "count": len(results), "results": results, "stats": tg_resolver.get_stats()}

@app.get("/api/dmr/users/stats")
async def get_dmr_users_stats():
    """Returns database statistics for RadioID amateur users."""
    return {"status": "ok", "stats": user_db.get_stats()}

@app.get("/api/dmr/users/search")
async def search_dmr_users(q: str = "", limit: int = 50):
    """Searches registered amateur DMR IDs across callsigns, names, DMR IDs, cities, and countries."""
    results = user_db.search_users(q, limit=limit)
    return {"status": "ok", "query": q, "count": len(results), "results": results, "stats": user_db.get_stats()}

@app.post("/api/dmr/sync")
async def manual_sync_dmr_databases():
    """Manual trigger to update TalkGroups catalog and RadioID user database."""
    tg_count = await tg_resolver.fetch_master_catalog()
    user_count = await user_db.update_from_network()
    return {"status": "ok", "talkgroups_updated": tg_count, "users_count": user_count}

@app.get("/api/bm/static-groups")
async def get_bm_static_groups(hotspot_id: Optional[str] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err, "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id or "---", "hotspot_id": hotspot_id}

    local_dyn = hotspot_manager.get_dynamic_tgs(cfg.id, max_age_sec=900.0, user_id=uid)

    def _fetch():
        import urllib.request, urllib.error
        url = f"https://api.brandmeister.network/v2/device/{device_id}/profile"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "ProxDMR/0.1",
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=6) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                subs = data.get("staticSubscriptions", [])
                dyn_subs = data.get("dynamicSubscriptions", [])
                ts1 = []
                ts2 = []
                for s in subs:
                    try:
                        tg = int(s.get("talkgroup", 0))
                        slot = int(s.get("slot", 1))
                        if tg > 0:
                            item = {
                                "talkgroup": tg,
                                "slot": slot,
                                "name": tg_resolver.get_name(tg)
                            }
                            if slot == 2:
                                ts2.append(item)
                            else:
                                ts1.append(item)
                    except (ValueError, TypeError):
                        continue
                ts1.sort(key=lambda x: x["talkgroup"])
                ts2.sort(key=lambda x: x["talkgroup"])

                dyn_ts1 = []
                dyn_ts2 = []
                for s in dyn_subs:
                    try:
                        tg = int(s.get("talkgroup", 0))
                        slot = int(s.get("slot", 1))
                        if tg > 0:
                            item = {
                                "talkgroup": tg,
                                "slot": slot,
                                "name": tg_resolver.get_name(tg)
                            }
                            if slot == 2:
                                dyn_ts2.append(item)
                            else:
                                dyn_ts1.append(item)
                    except (ValueError, TypeError):
                        continue

                # Merge local dynamic talkgroups tracked in ProxDMR (traffic & PTT)
                static_tg_ts1 = {item["talkgroup"] for item in ts1}
                static_tg_ts2 = {item["talkgroup"] for item in ts2}
                known_dyn_ts1 = {item["talkgroup"] for item in dyn_ts1}
                known_dyn_ts2 = {item["talkgroup"] for item in dyn_ts2}

                now = time.time()
                for tg, ts in local_dyn.get(1, {}).items():
                    if tg not in static_tg_ts1 and tg not in known_dyn_ts1 and tg not in (0, 4000, 9990):
                        rem = max(0, int(900.0 - (now - ts)))
                        dyn_ts1.append({
                            "talkgroup": tg,
                            "slot": 1,
                            "name": tg_resolver.get_name(tg),
                            "last_active": ts,
                            "remaining_sec": rem
                        })

                for tg, ts in local_dyn.get(2, {}).items():
                    if tg not in static_tg_ts2 and tg not in known_dyn_ts2 and tg not in (0, 4000, 9990):
                        rem = max(0, int(900.0 - (now - ts)))
                        dyn_ts2.append({
                            "talkgroup": tg,
                            "slot": 2,
                            "name": tg_resolver.get_name(tg),
                            "last_active": ts,
                            "remaining_sec": rem
                        })

                dyn_ts1.sort(key=lambda x: x["talkgroup"])
                dyn_ts2.sort(key=lambda x: x["talkgroup"])

                return {
                    "status": "ok",
                    "device_id": device_id,
                    "callsign": cfg.callsign,
                    "hotspot_name": cfg.name,
                    "hotspot_id": cfg.id,
                    "ts1": ts1,
                    "ts2": ts2,
                    "dynamic_ts1": dyn_ts1,
                    "dynamic_ts2": dyn_ts2,
                    "tg_names": tg_resolver.get_all_names()
                }
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return {"status": "error", "detail": "Неверный или просроченный токен BM (401)", "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}
            if e.code == 404:
                return {"status": "error", "detail": f"Устройство {device_id} не найдено на сервере BM. Проверьте регистрацию устройства и SSID хотспота на BM.", "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}
            return {"status": "error", "detail": f"Ошибка BM API: HTTP {e.code}", "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}
        except Exception as e:
            return {"status": "error", "detail": f"Сервер BM недоступен ({e})", "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}

    return await asyncio.to_thread(_fetch)


# Debounced BM reconnect tasks after group modifications: hotspot_id -> asyncio.Task
_bm_group_reconnect_tasks: Dict[str, asyncio.Task] = {}
BM_GROUP_RECONNECT_DELAY = 2.0  # seconds


def schedule_bm_reconnect_after_group_mod(
    hotspot_id: Optional[str] = None,
    delay: float = BM_GROUP_RECONNECT_DELAY,
    user_id: Optional[int] = None,
):
    """
    Schedule a debounced BM reconnect for the given hotspot after group modifications.
    If multiple modifications occur in rapid succession, the timer is reset so reconnect occurs
    only once after the series of modifications finishes.
    """
    uid = user_id if user_id is not None else hotspot_manager.active_user_id
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings
    hs_map = hotspot_manager.user_runtimes.get(uid, {}) if uid else hotspot_manager.runtimes

    target_hid = hotspot_id or getattr(user_sett, "active_hotspot_id", None) or "default"
    if target_hid in ("active", "default", None):
        active_hs = hotspot_manager.get_active_runtime(uid)
        if active_hs:
            target_hid = active_hs.config.id
        else:
            target_hid = getattr(user_sett, "active_hotspot_id", None) or "default"

    task_key = f"{uid}_{target_hid}"

    async def _runner():
        try:
            logger.info(f"[BM_GROUPS] Debounce timer started ({delay}s) for BM reconnect on hotspot '{target_hid}' (user {uid})...")
            await asyncio.sleep(delay)

            # Wait if transmission (PTT) is currently active
            tx_wait_count = 0
            while getattr(hotspot_manager, "_tx_active", False) and tx_wait_count < 60:
                await asyncio.sleep(0.5)
                tx_wait_count += 1

            rt = hs_map.get(target_hid) if hs_map else None
            if not rt:
                rt = hotspot_manager.get_active_runtime(uid)
            if not rt:
                logger.warning(f"[BM_GROUPS] Cannot reconnect: hotspot runtime '{target_hid}' not found for user {uid}")
                return

            logger.info(f"[BM_GROUPS] Triggering debounced BM reconnect for hotspot '{rt.config.name}' ({rt.config.id}) after group modifications (user {uid})")
            hotspot_manager._notify_async({
                "type": "bm_reconnecting_groups",
                "hotspot_id": rt.config.id,
                "message": f"Переподключение к BrandMeister ({rt.config.name}) после изменения групп..."
            }, user_id=uid)

            await hotspot_manager.reconnect_hotspot(rt.config.id, user_id=uid)
            logger.info(f"[BM_GROUPS] Debounced BM reconnect completed for hotspot '{rt.config.name}' ({rt.config.id}) (user {uid})")
        except asyncio.CancelledError:
            logger.debug(f"[BM_GROUPS] Debounce timer reset for hotspot '{target_hid}' (user {uid})")
        except Exception as e:
            logger.error(f"[BM_GROUPS] Error during debounced BM reconnect for '{target_hid}' (user {uid}): {e}")
        finally:
            _bm_group_reconnect_tasks.pop(task_key, None)

    old_task = _bm_group_reconnect_tasks.get(task_key)
    if old_task and not old_task.done():
        old_task.cancel()

# --- BM Background Bulk Import Manager ---
import uuid
from src.dmr.bm_import import (
    BmImportTask,
    _bm_import_tasks,
    _user_active_bm_import,
    execute_bm_import as _execute_bm_import_fn
)

async def _execute_bm_import(task: BmImportTask, device_id: str, api_key: str):
    await _execute_bm_import_fn(
        task=task,
        device_id=device_id,
        api_key=api_key,
        broadcast_fn=broadcast_user_json,
        reconnect_fn=schedule_bm_reconnect_after_group_mod
    )


@app.post("/api/bm/static-groups")
async def add_bm_static_group(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    hotspot_id = payload.get("hotspot_id")
    slot = int(payload.get("slot", 1))
    if slot not in (1, 2):
        raise HTTPException(status_code=400, detail="Слот должен быть 1 или 2")

    tgs = payload.get("talkgroups")
    if tgs is None:
        single_tg = payload.get("talkgroup")
        tgs = [int(single_tg)] if single_tg is not None and int(single_tg) > 0 else []
    else:
        tgs = [int(x) for x in tgs if int(x) > 0]

    if not tgs:
        raise HTTPException(status_code=400, detail="Не указаны TalkGroup для добавления")

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err}

    def _add_all():
        import urllib.request, urllib.error, time
        added = []
        errors = []
        for i, tg in enumerate(tgs):
            if i > 0:
                time.sleep(0.06)
            url = f"https://api.brandmeister.network/v2/device/{device_id}/talkgroup"
            req_data = json.dumps({"slot": slot, "group": tg}).encode("utf-8")
            req = urllib.request.Request(
                url,
                data=req_data,
                headers={
                    "User-Agent": "ProxDMR/0.1",
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                method="POST"
            )
            try:
                with urllib.request.urlopen(req, timeout=6) as resp:
                    resp.read()
                    added.append(tg)
            except urllib.error.HTTPError as e:
                msg = e.read().decode("utf-8", errors="ignore")
                errors.append(f"TG {tg}: HTTP {e.code} ({msg or e.reason})")
            except Exception as e:
                errors.append(f"TG {tg}: {e}")

        if not added and errors:
            return {"status": "error", "detail": "; ".join(errors[:5])}
        return {
            "status": "ok",
            "slot": slot,
            "added": added,
            "errors": errors,
            "talkgroup": added[0] if added else None,
            "message": f"Добавлено статических групп: {len(added)}"
        }

    res = await asyncio.to_thread(_add_all)
    if isinstance(res, dict) and res.get("status") == "ok" and res.get("added"):
        schedule_bm_reconnect_after_group_mod(cfg.id, user_id=uid)
    return res


@app.post("/api/bm/static-groups/import")
@app.post("/api/bm/static-groups/task")
async def start_bm_static_groups_import(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    hotspot_id = payload.get("hotspot_id")
    slot = int(payload.get("slot", 1))
    if slot not in (1, 2):
        raise HTTPException(status_code=400, detail="Слот должен быть 1 или 2")

    tgs = payload.get("talkgroups", [])
    tgs = [int(x) for x in tgs if int(x) > 0]
    if not tgs:
        raise HTTPException(status_code=400, detail="Не указаны TalkGroup")

    filename = str(payload.get("filename", "")).strip()
    action = str(payload.get("action", "add")).lower().strip()
    if action not in ("add", "delete"):
        action = "add"

    active_tid = _user_active_bm_import.get(uid)
    if active_tid and active_tid in _bm_import_tasks:
        cur_task = _bm_import_tasks[active_tid]
        if cur_task.status == "running":
            act_ru = "удаления" if cur_task.action == "delete" else "импорта"
            return {"status": "busy", "message": f"Фоновая операция {act_ru} групп уже выполняется", "task": cur_task.to_dict()}

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err}

    task_id = str(uuid.uuid4())[:8]
    task = BmImportTask(
        task_id=task_id,
        user_id=uid,
        hotspot_id=cfg.id,
        slot=slot,
        talkgroups=tgs,
        filename=filename,
        action=action
    )
    _bm_import_tasks[task_id] = task
    _user_active_bm_import[uid] = task_id

    asyncio.create_task(_execute_bm_import(task, device_id, api_key))
    return {
        "status": "ok",
        "task": task.to_dict()
    }


@app.get("/api/bm/static-groups/import/status")
@app.get("/api/bm/static-groups/task/status")
async def get_bm_static_groups_import_status(hotspot_id: Optional[str] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)

    active_tid = _user_active_bm_import.get(uid)
    if active_tid and active_tid in _bm_import_tasks:
        t = _bm_import_tasks[active_tid]
        return {"status": "ok", "task": t.to_dict()}
    return {"status": "idle", "task": None}


@app.post("/api/bm/static-groups/import/cancel")
@app.post("/api/bm/static-groups/task/cancel")
async def cancel_bm_static_groups_import(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)

    active_tid = _user_active_bm_import.get(uid)
    if active_tid and active_tid in _bm_import_tasks:
        t = _bm_import_tasks[active_tid]
        if t.status == "running":
            t.cancelled = True
            return {"status": "ok", "message": "Запрос на отмену отправлен"}
    return {"status": "not_running", "message": "Нет активной операции"}


@app.delete("/api/bm/static-groups")
async def delete_bm_static_group(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    hotspot_id = payload.get("hotspot_id")
    slot = int(payload.get("slot", 1))
    tgs = payload.get("talkgroups")
    if tgs is None:
        single_tg = payload.get("talkgroup")
        tgs = [int(single_tg)] if single_tg is not None else []
    else:
        tgs = [int(x) for x in tgs if int(x) > 0]

    if not tgs:
        raise HTTPException(status_code=400, detail="Не указаны TalkGroup для удаления")

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err}

    # Automatically offload batch deletion of more than 5 groups to background task
    if len(tgs) > 5 or payload.get("background"):
        active_tid = _user_active_bm_import.get(uid)
        if active_tid and active_tid in _bm_import_tasks:
            cur_task = _bm_import_tasks[active_tid]
            if cur_task.status == "running":
                act_ru = "удаления" if cur_task.action == "delete" else "импорта"
                return {"status": "busy", "message": f"Фоновая операция {act_ru} групп уже выполняется", "task": cur_task.to_dict()}

        task_id = str(uuid.uuid4())[:8]
        task = BmImportTask(
            task_id=task_id,
            user_id=uid,
            hotspot_id=cfg.id,
            slot=slot,
            talkgroups=tgs,
            filename="Пакетное удаление",
            action="delete"
        )
        _bm_import_tasks[task_id] = task
        _user_active_bm_import[uid] = task_id
        asyncio.create_task(_execute_bm_import(task, device_id, api_key))
        return {
            "status": "ok",
            "background": True,
            "task": task.to_dict(),
            "message": f"Фоновое удаление {len(tgs)} групп запущено"
        }

    def _delete_all():
        import urllib.request, urllib.error, time
        deleted = []
        errors = []
        for i, tg in enumerate(tgs):
            if i > 0:
                time.sleep(0.06)
            url = f"https://api.brandmeister.network/v2/device/{device_id}/talkgroup/{slot}/{tg}"
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "ProxDMR/0.1",
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json"
                },
                method="DELETE"
            )
            try:
                with urllib.request.urlopen(req, timeout=6) as resp:
                    resp.read()
                    deleted.append(tg)
            except urllib.error.HTTPError as e:
                errors.append(f"TG {tg}: HTTP {e.code}")
            except Exception as e:
                errors.append(f"TG {tg}: {e}")

        if not deleted and errors:
            return {"status": "error", "detail": "; ".join(errors[:5])}
        return {
            "status": "ok",
            "deleted": deleted,
            "errors": errors,
            "message": f"Удалено статических групп: {len(deleted)}"
        }

    res = await asyncio.to_thread(_delete_all)
    if isinstance(res, dict) and res.get("status") == "ok" and res.get("deleted"):
        schedule_bm_reconnect_after_group_mod(cfg.id, user_id=uid)
    return res

@app.post("/api/bm/drop-dynamic")
async def drop_bm_dynamic_groups(payload: Optional[dict] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    payload = payload or {}
    hotspot_id = payload.get("hotspot_id")
    slot = payload.get("slot")
    slots_to_drop = [int(slot)] if slot in (1, 2) else [1, 2]

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err}

    def _drop():
        import urllib.request, urllib.error
        dropped = []
        errors = []
        for s in slots_to_drop:
            url = f"https://api.brandmeister.network/v2/device/{device_id}/action/dropDynamicGroups/{s}"
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "ProxDMR/0.1",
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json"
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=6) as resp:
                    resp.read()
                    dropped.append(s)
            except urllib.error.HTTPError as e:
                errors.append(f"TS{s}: HTTP {e.code}")
            except Exception as e:
                errors.append(f"TS{s}: {e}")

        if not dropped and errors:
            return {"status": "error", "detail": "; ".join(errors)}
        return {
            "status": "ok",
            "hotspot_id": cfg.id,
            "hotspot_name": cfg.name,
            "device_id": device_id,
            "dropped_slots": dropped,
            "message": f"Динамические группы сброшены для {cfg.name} ({device_id}), слоты: {', '.join(f'TS{s}' for s in dropped)}"
        }

    res = await asyncio.to_thread(_drop)
    for s in slots_to_drop:
        hotspot_manager.clear_dynamic_tgs(cfg.id, slot=s, user_id=uid)

    if isinstance(res, dict) and res.get("status") == "ok" and res.get("dropped_slots"):
        schedule_bm_reconnect_after_group_mod(cfg.id, user_id=uid)
    return res

@app.get("/api/bm/summary")
async def get_bm_summary(
    target_id: str,
    target_type: Optional[str] = "AUTO",
    callsign: Optional[str] = None,
    hotspot_id: Optional[str] = None,
    request: Request = None,
):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    import concurrent.futures, urllib.request, urllib.error, urllib.parse

    cfg, hs_device_id, hs_api_key, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)
    clean_id = str(target_id).strip()
    clean_call = str(callsign).strip().upper() if callsign else ""
    t_type = str(target_type or "AUTO").strip().upper()

    def _fetch_url(url, token=None, timeout=3.8):
        headers = {"User-Agent": "ProxDMR/0.1", "Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                try:
                    return json.loads(raw.decode("utf-8"))
                except Exception:
                    return raw.decode("utf-8")
        except urllib.error.HTTPError as e:
            return {"error_code": e.code, "error": f"HTTP {e.code}"}
        except Exception as e:
            return {"error": str(e)}

    def _process():
        # 1. Resolve callsign locally if not provided
        res_call = clean_call
        if not res_call and clean_id.isdigit():
            try:
                u_info = user_db.get_user_by_id(int(clean_id))
                if u_info and u_info.get("callsign"):
                    res_call = u_info["callsign"].strip().upper()
            except Exception:
                pass

        # 2. Concurrently query primary BM & RadioID endpoints
        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as ex:
            f_tg = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/talkgroup/{clean_id}")
            f_reg = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/registry/{clean_id}")
            f_radio_user = ex.submit(_fetch_url, f"https://database.radioid.net/api/dmr/user/?id={clean_id}") if (clean_id.isdigit() and len(clean_id) >= 5) else None
            f_radio_rep = ex.submit(_fetch_url, f"https://database.radioid.net/api/dmr/repeater/?id={clean_id}") if (clean_id.isdigit() and len(clean_id) in (6, 7)) else None
            f_dev_direct = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/{clean_id}") if (clean_id.isdigit() and len(clean_id) >= 6) else None
            f_prof_direct = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/{clean_id}/profile") if (clean_id.isdigit() and len(clean_id) >= 6) else None
            f_hs_subs = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/{hs_device_id}/talkgroup", hs_api_key) if hs_device_id else None
            f_dev_by_call = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/byCall?callsign={urllib.parse.quote(res_call)}") if res_call else None

            tg_res = f_tg.result()
            reg_res = f_reg.result()
            radio_user_res = f_radio_user.result() if f_radio_user else None
            radio_rep_res = f_radio_rep.result() if f_radio_rep else None
            dev_direct_res = f_dev_direct.result() if f_dev_direct else None
            prof_direct_res = f_prof_direct.result() if f_prof_direct else None
            hs_subs_res = f_hs_subs.result() if f_hs_subs else None
            dev_by_call_res = f_dev_by_call.result() if f_dev_by_call else None

        reg_data = reg_res if (isinstance(reg_res, dict) and not reg_res.get("error")) else {}
        tg_data = tg_res if (isinstance(tg_res, dict) and not tg_res.get("error") and (tg_res.get("ID") or tg_res.get("Name"))) else {}
        dev_direct_data = dev_direct_res if (isinstance(dev_direct_res, dict) and not dev_direct_res.get("error") and dev_direct_res.get("id")) else {}
        prof_data = prof_direct_res if (isinstance(prof_direct_res, dict) and not prof_direct_res.get("error") and "staticSubscriptions" in prof_direct_res) else {}
        subs_list = hs_subs_res if isinstance(hs_subs_res, list) else []

        radioid_user_info = None
        if radio_user_res and isinstance(radio_user_res, dict) and radio_user_res.get("results"):
            r_item = radio_user_res["results"][0]
            radioid_user_info = {
                "lastheard": r_item.get("lastheard"),
                "lastmaster": r_item.get("lastmaster"),
                "lasttg": r_item.get("lasttg"),
                "lastsource": r_item.get("lastsource"),
                "status": r_item.get("account_validation_status"),
                "city": r_item.get("city"),
                "country": r_item.get("country"),
                "fname": r_item.get("fname"),
                "surname": r_item.get("surname"),
                "callsign": r_item.get("callsign")
            }

        radioid_rep_info = None
        if radio_rep_res and isinstance(radio_rep_res, dict) and radio_rep_res.get("results"):
            rep_item = radio_rep_res["results"][0]
            radioid_rep_info = {
                "callsign": rep_item.get("callsign"),
                "city": rep_item.get("city"),
                "country": rep_item.get("country"),
                "frequency": rep_item.get("frequency"),
                "color_code": rep_item.get("color_code"),
                "offset": rep_item.get("offset")
            }

        # 3. Resolve callsign from network registries if not yet known
        reg_call = ""
        if reg_data.get("Call"):
            reg_call = str(reg_data["Call"]).strip().upper()
        elif radioid_user_info and radioid_user_info.get("callsign"):
            reg_call = str(radioid_user_info["callsign"]).strip().upper()
        elif dev_direct_data and dev_direct_data.get("callsign"):
            reg_call = str(dev_direct_data["callsign"]).strip().upper()
        elif radioid_rep_info and radioid_rep_info.get("callsign"):
            reg_call = str(radioid_rep_info["callsign"]).strip().upper()

        if not res_call and reg_call:
            res_call = reg_call

        # 4. Secondary device fetching by callsign if not yet fetched
        dev_list = []
        if dev_direct_data:
            dev_list.append(dev_direct_data)

        if dev_by_call_res and isinstance(dev_by_call_res, list):
            for d in dev_by_call_res:
                if isinstance(d, dict) and d.get("id") and not any(existing.get("id") == d.get("id") for existing in dev_list):
                    dev_list.append(d)
        elif res_call and not dev_by_call_res:
            extra_devs = _fetch_url(f"https://api.brandmeister.network/v2/device/byCall?callsign={urllib.parse.quote(res_call)}")
            if isinstance(extra_devs, list):
                for d in extra_devs:
                    if isinstance(d, dict) and d.get("id") and not any(existing.get("id") == d.get("id") for existing in dev_list):
                        dev_list.append(d)

        # Also if reg_data was empty by ID but we resolved callsign, look up registry by callsign
        if not reg_data and res_call:
            by_call_reg = _fetch_url(f"https://api.brandmeister.network/v2/registry/byCall/{urllib.parse.quote(res_call)}")
            if isinstance(by_call_reg, list) and by_call_reg:
                reg_data = by_call_reg[0]
            elif isinstance(by_call_reg, dict) and not by_call_reg.get("error"):
                reg_data = by_call_reg

        # If no device profile yet, but we found devices, fetch profile of the first device
        if not prof_data and dev_list:
            first_dev_id = dev_list[0].get("id")
            if first_dev_id:
                p_res = _fetch_url(f"https://api.brandmeister.network/v2/device/{first_dev_id}/profile")
                if isinstance(p_res, dict) and not p_res.get("error") and "staticSubscriptions" in p_res:
                    prof_data = p_res

        # 5. Extract Operator details
        name_parts = [reg_data.get("Name"), reg_data.get("Surname")]
        full_name = " ".join(p for p in name_parts if p)
        if not full_name and radioid_user_info:
            full_name = " ".join(p for p in [radioid_user_info.get("fname"), radioid_user_info.get("surname")] if p)
        location = reg_data.get("Text") or reg_data.get("City") or ""
        if not location and radioid_user_info:
            location = ", ".join(p for p in [radioid_user_info.get("city"), radioid_user_info.get("country")] if p)

        # 6. Extract Device Profile subscriptions
        ts1_subs = []
        ts2_subs = []
        if isinstance(prof_data.get("staticSubscriptions"), list):
            for s in prof_data["staticSubscriptions"]:
                try:
                    tg = int(s.get("talkgroup", 0))
                    slot = int(s.get("slot", 1))
                    if tg > 0:
                        if slot == 2:
                            ts2_subs.append(tg)
                        else:
                            ts1_subs.append(tg)
                except Exception:
                    pass
            ts1_subs.sort()
            ts2_subs.sort()

        # 7. Extract TalkGroup and observer hotspot subscription
        target_tg_num = int(clean_id) if clean_id.isdigit() else 0
        matched_slot = None
        for s in subs_list:
            if str(s.get("talkgroup")) == clean_id:
                try:
                    matched_slot = int(s.get("slot", 1))
                except Exception:
                    matched_slot = 1
                break

        local_name = tg_resolver.get_name(target_tg_num) if target_tg_num > 0 else ""
        tg_display_name = tg_data.get("Name") or local_name or ""

        # Dates
        valid_created = [d.get("created_at") for d in dev_list if isinstance(d, dict) and d.get("created_at")]
        bm_created = min(valid_created) if valid_created else None
        valid_updated = [d.get("updated_at") for d in dev_list if isinstance(d, dict) and d.get("updated_at")]
        bm_updated = max(valid_updated) if valid_updated else None

        # 8. Classification
        has_operator = bool(reg_data.get("Call") or reg_data.get("Name") or radioid_user_info)
        has_device = bool(dev_list or radioid_rep_info)
        has_tg = bool(tg_data.get("ID") or tg_data.get("Name") or local_name)

        is_repeater = False
        if radioid_rep_info:
            is_repeater = True
        elif dev_direct_data and dev_direct_data.get("rx") and dev_direct_data.get("tx") and dev_direct_data.get("rx") != dev_direct_data.get("tx"):
            is_repeater = True
        elif len(clean_id) == 6 and has_device:
            is_repeater = True

        if has_operator and len(clean_id) == 7:
            detected_type = "operator"
            detected_label = "DMR ID радиолюбителя / оператора"
        elif is_repeater:
            detected_type = "repeater"
            detected_label = "Репитер DMR BrandMeister"
        elif has_device and not has_operator:
            detected_type = "hotspot"
            detected_label = "Персональный хотспот MMDVM"
        elif has_operator:
            detected_type = "operator"
            detected_label = "DMR ID радиолюбителя / оператора"
        elif has_tg:
            detected_type = "talkgroup"
            detected_label = "Разговорная группа (TalkGroup)"
        else:
            detected_type = "talkgroup" if t_type == "TG" else "unknown"
            detected_label = "Пользовательская группа / ID"

        cross_info_note = ""
        if t_type == "TG" and has_operator:
            cross_info_note = f"Идентификатор {clean_id} (входящий как TG) принадлежит радиолюбителю {res_call or 'DMR'}{f' ({full_name})' if full_name else ''}. В DMR-сетях такие персональные ID могут использоваться как тактические разговорные группы или для прямого вызова."
        elif t_type == "ID" and has_tg and not has_operator:
            cross_info_note = f"Идентификатор {clean_id} зарегистрирован в сети как TalkGroup ({tg_display_name})."

        return {
            "status": "ok",
            "target_type": detected_type.upper(),
            "target_id": clean_id,
            "callsign": res_call or reg_data.get("Call") or "",
            "user_name": full_name or "",
            "location": location,
            "detected_type": detected_type,
            "detected_type_label": detected_label,
            "cross_info_note": cross_info_note,
            "is_operator": has_operator,
            "is_device": has_device,
            "is_repeater": is_repeater,
            "is_talkgroup": has_tg,
            "tg_name": tg_display_name,
            "is_registered": bool(has_operator or has_device or has_tg),
            "bm_created": bm_created,
            "bm_updated": bm_updated,
            "operator": {
                "callsign": res_call or reg_data.get("Call") or "",
                "name": full_name or "",
                "city": reg_data.get("City") or (radioid_user_info and radioid_user_info.get("city")) or "",
                "country": reg_data.get("Country") or (radioid_user_info and radioid_user_info.get("country")) or "",
                "location": location,
                "ssid": reg_data.get("SSID"),
                "symbol": reg_data.get("Symbol"),
                "text": reg_data.get("Text"),
                "radioid": radioid_user_info,
                "bm_created": bm_created,
                "bm_updated": bm_updated,
                "is_registered": has_operator
            },
            "talkgroup": {
                "id": target_tg_num,
                "name": tg_display_name,
                "bm_name": tg_data.get("Name") or "",
                "local_name": local_name,
                "is_registered": bool(tg_data.get("ID") or tg_data.get("Name")),
                "is_subscribed": bool(matched_slot),
                "slot": matched_slot,
                "description": tg_data.get("description") or ""
            },
            "radioid": radioid_user_info,
            "registry": reg_data,
            "devices": [
                {
                    "id": d.get("id"),
                    "callsign": d.get("callsign"),
                    "lastKnownMaster": d.get("lastKnownMaster"),
                    "statusText": d.get("statusText"),
                    "status": d.get("status"),
                    "hardware": d.get("hardware") or d.get("linkname") or "MMDVM",
                    "firmware": d.get("firmware"),
                    "rx": d.get("rx"),
                    "tx": d.get("tx"),
                    "colorcode": d.get("colorcode"),
                    "last_seen": d.get("last_seen"),
                    "created_at": d.get("created_at"),
                    "updated_at": d.get("updated_at"),
                    "pep": d.get("pep", 0),
                    "agl": d.get("agl", 0),
                    "lat": d.get("lat", 0),
                    "lng": d.get("lng", 0),
                    "city": d.get("city") or "",
                    "description": d.get("description") or d.get("priorityDescription") or "",
                    "website": d.get("website") or "",
                    "is_repeater": bool((d.get("rx") and d.get("tx") and d.get("rx") != d.get("tx") and d.get("rx") != "0.0000") or str(d.get("id", "")).strip().startswith("2501") or len(str(d.get("id", "")).strip()) == 6)
                } for d in dev_list if isinstance(d, dict) and d.get("id")
            ],
            "has_profile": bool(ts1_subs or ts2_subs),
            "static_talkgroups": {
                "ts1": ts1_subs,
                "ts2": ts2_subs,
                "total": len(ts1_subs) + len(ts2_subs)
            },
            "device_profile": {
                "static_ts1": ts1_subs,
                "static_ts2": ts2_subs,
                "autoStatic": prof_data.get("autoStatic"),
                "dynamicSubscriptions": prof_data.get("dynamicSubscriptions", []),
                "clusters": prof_data.get("clusters", []),
                "blockedGroups": prof_data.get("blockedGroups", []),
                "timedSubscriptions": prof_data.get("timedSubscriptions", [])
            },
            "hotspot": {
                "id": cfg.id if cfg else "",
                "name": cfg.name if cfg else "Хотспот",
                "device_id": hs_device_id or "",
                "has_api_key": bool(hs_api_key)
            },
            "subscription": {
                "is_subscribed": bool(matched_slot),
                "slot": matched_slot
            }
        }

    return await asyncio.to_thread(_process)

@app.get("/api/bm/info")
async def get_bm_info(
    query_type: Optional[str] = None,
    type: Optional[str] = None,
    target_id: Optional[str] = None,
    value: Optional[str] = None,
    callsign: Optional[str] = None,
    hotspot_id: Optional[str] = None,
    request: Request = None,
):
    """
    Proxies requests to BrandMeister API v2:
    - 'profile': GET /v2/device/{id}/profile
    - 'repeater_diag': GET /v2/device/{id}/action/getRepeater
    - 'devices_by_call': GET /v2/device/byCall?callsign={call}
    - 'registry': GET /v2/registry/{id} or /v2/registry/byCall/{call}
    - 'tg_summary', 'unified_info', 'auto': delegates to get_bm_summary
    """
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    q_type = str(query_type or type or "auto").strip().lower()
    clean_id = str(target_id or value or "").strip()
    clean_call = str(callsign).strip().upper() if callsign else ""

    if q_type in ("tg_summary", "unified_info", "auto", "summary", "contact_info", ""):
        return await get_bm_summary(target_id=clean_id, target_type="AUTO", callsign=clean_call, hotspot_id=hotspot_id, request=request)

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)

    # Automatic local callsign resolution if not provided
    if not clean_call and clean_id and clean_id.isdigit():
        try:
            u_info = user_db.get_user_by_id(int(clean_id))
            if u_info and u_info.get("callsign"):
                clean_call = u_info["callsign"].strip().upper()
        except Exception:
            pass

    def _query():
        import urllib.request, urllib.error, urllib.parse
        headers = {
            "User-Agent": "ProxDMR/0.1",
            "Accept": "application/json"
        }
        if api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        url = None
        target_name = clean_call or clean_id

        if q_type == "profile":
            if not clean_id:
                return {"status": "error", "detail": "Не указан ID устройства"}
            url = f"https://api.brandmeister.network/v2/device/{clean_id}/profile"

        elif q_type == "device_talkgroup":
            target_device = device_id
            if not target_device and clean_id and clean_id.isdigit() and len(clean_id) >= 6:
                target_device = clean_id
            if not target_device:
                return {"status": "error", "detail": "Не удалось определить ID хотспота на BM"}
            url = f"https://api.brandmeister.network/v2/device/{target_device}/talkgroup"
            target_name = f"{cfg.name or 'Хотспот'} ({target_device})" if cfg else str(target_device)

        elif q_type == "talkgroup_info":
            if not clean_id:
                return {"status": "error", "detail": "Не указан номер TalkGroup"}
            url = f"https://api.brandmeister.network/v2/talkgroup/{clean_id}"
            target_name = f"TG {clean_id}"

        elif q_type == "devices_by_call":
            resolved_call = clean_call
            if not resolved_call and clean_id and clean_id.isdigit():
                # Try BrandMeister registry to resolve callsign
                try:
                    reg_url = f"https://api.brandmeister.network/v2/registry/{clean_id}"
                    reg_req = urllib.request.Request(reg_url, headers=headers)
                    with urllib.request.urlopen(reg_req, timeout=5) as r_resp:
                        r_data = json.loads(r_resp.read().decode("utf-8"))
                        if isinstance(r_data, dict):
                            resolved_call = (r_data.get("Call") or r_data.get("callsign") or "").strip().upper()
                except Exception:
                    pass

            if not resolved_call:
                return {"status": "error", "detail": f"Не удалось определить позывной для ID {clean_id}"}
            url = f"https://api.brandmeister.network/v2/device/byCall?callsign={urllib.parse.quote(resolved_call)}"
            target_name = resolved_call

        elif q_type == "registry":
            if clean_call:
                url = f"https://api.brandmeister.network/v2/registry/byCall/{urllib.parse.quote(clean_call)}"
                target_name = clean_call
            elif clean_id:
                url = f"https://api.brandmeister.network/v2/registry/{clean_id}"
                target_name = clean_id
            else:
                return {"status": "error", "detail": "Не указан ID или позывной для поиска в реестре"}

        else:
            return {"status": "error", "detail": f"Неизвестный тип запроса: {q_type}"}

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                raw_bytes = resp.read()
                try:
                    payload = json.loads(raw_bytes.decode("utf-8"))
                except Exception:
                    payload = raw_bytes.decode("utf-8")
                return {
                    "status": "ok",
                    "query_type": q_type,
                    "target_id": clean_id,
                    "callsign": clean_call,
                    "target_name": target_name,
                    "hotspot_name": cfg.name if cfg else "",
                    "hotspot_device_id": device_id or "",
                    "url": url,
                    "data": payload
                }
        except urllib.error.HTTPError as e:
            err_body = ""
            try:
                err_raw = e.read().decode("utf-8")
                parsed_err = json.loads(err_raw)
                if isinstance(parsed_err, dict) and "message" in parsed_err:
                    err_body = parsed_err["message"]
                else:
                    err_body = err_raw
            except Exception:
                pass
            if e.code == 404:
                return {
                    "status": "not_found",
                    "detail": f"Данные не найдены в BM (HTTP 404). {err_body}".strip(),
                    "query_type": query_type,
                    "target_id": clean_id,
                    "callsign": clean_call,
                    "target_name": target_name
                }
            elif e.code in (401, 403):
                return {
                    "status": "unauthorized",
                    "detail": f"Требуется авторизованный API Key BM (HTTP {e.code}). {err_body}".strip(),
                    "query_type": query_type,
                    "target_id": clean_id,
                    "callsign": clean_call,
                    "target_name": target_name
                }
            return {
                "status": "error",
                "detail": f"Ошибка BM API: HTTP {e.code}. {err_body}".strip(),
                "query_type": query_type,
                "target_id": clean_id,
                "callsign": clean_call,
                "target_name": target_name
            }
        except Exception as ex:
            return {
                "status": "error",
                "detail": f"Ошибка соединения с BM: {str(ex)}",
                "query_type": query_type,
                "target_id": clean_id,
                "callsign": clean_call,
                "target_name": target_name
            }

    return await asyncio.to_thread(_query)

# --- General Status & Backward Compatibility API ---

@app.get("/api/status")
async def get_status(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings
    u_radio_state = hotspot_manager.get_user_tx_state(user_id=uid)
    cfg = active_hs.config if active_hs else (user_sett.get_active_hotspot() if hasattr(user_sett, "get_active_hotspot") else HotspotConfig())
    apk_meta = get_current_apk_metadata()
    return {
        "status": "online",
        "version": APP_VERSION,
        "version_date": APP_VERSION_DATE,
        "apk_version": apk_meta["apk_version"],
        "apk_version_date": apk_meta["apk_version_date"],
        "apk_filename": apk_meta["apk_filename"],
        "apk_path": apk_meta["apk_path"],
        "apk_url": apk_meta["apk_url"],
        "clients_count": len(connected_clients),
        "is_tx": u_radio_state.is_transmitting,
        "is_rx": u_radio_state.is_rx,
        "tx_slot": u_radio_state.tx_slot,
        "active_tg": u_radio_state.active_tg,
        "loopback_mode": getattr(user_sett, "loopback_mode", app_settings.loopback_mode),
        "active_hotspot": active_hs.to_dict() if active_hs else None,
        "bm_status": active_hs.status.value if active_hs else "OFFLINE",
        "bm_detail": active_hs.detail if active_hs else "Отключен",
        "bm_master": f"{cfg.bm_master_host}:{cfg.bm_master_port}" if cfg else "---",
    }

@app.post("/api/system/restart")
async def restart_system(request: Request):
    _require_admin(request)
    logger.warning("[SYSTEM] Server restart initiated via client API")
    try:
        await broadcast_json({
            "type": "server_restart",
            "message": "Сервер перезагружается..."
        })
    except Exception as e:
        logger.error(f"[SYSTEM] Error broadcasting restart: {e}")

    async def _do_restart():
        await asyncio.sleep(0.8)
        logger.info("[SYSTEM] Clean shutdown of services before container restart...")
        try:
            await hotspot_manager.stop()
        except Exception as e:
            logger.error(f"[SYSTEM] Error stopping hotspot_manager: {e}")
        try:
            bm_ping_service.stop()
        except Exception:
            pass
        logger.info("[SYSTEM] Terminating process (Docker will auto-restart container)...")
        os._exit(0)

    asyncio.create_task(_do_restart())
    return {"status": "ok", "message": "Сервер перезагружается..."}

# --- HamQTH.com XML API Endpoints ---

class HamQthTestRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    session_key: Optional[str] = None

@app.post("/api/hamqth/test")
async def test_hamqth_connection(payload: Optional[HamQthTestRequest] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)

    username = (payload.username if payload and payload.username is not None else getattr(s, "hamqth_username", "")) or ""
    password = (payload.password if payload and payload.password is not None else getattr(s, "hamqth_password", "")) or ""
    session_key = (payload.session_key if payload and payload.session_key is not None else "") or ""

    res = await hamqth_service.test_connection(username, password, session_key)
    return res

@app.get("/api/callsign/hamqth/{query}")
async def lookup_callsign_hamqth(query: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)

    username = getattr(s, "hamqth_username", "") or ""
    password = getattr(s, "hamqth_password", "") or ""

    if not username or not password:
        # Fallback to system / admin settings (user 1 or hotspot_manager.settings)
        sett_u1 = hotspot_manager.user_settings.get(1) or hotspot_manager.settings
        if sett_u1:
            username = username or getattr(sett_u1, "hamqth_username", "") or ""
            password = password or getattr(sett_u1, "hamqth_password", "") or ""

    target = query.strip()
    # Strip SSID suffix if present (e.g., UB3DLP-7 -> UB3DLP)
    if "-" in target:
        parts = target.split("-")
        if len(parts) == 2 and parts[1].isdigit():
            target = parts[0].strip()

    # If target is numeric (Radio ID), try to resolve it to a callsign first via user_db
    if target.isdigit():
        rid = int(target)
        user_info = user_db.get_user_by_id(rid)
        if user_info and user_info.get("callsign"):
            target = user_info["callsign"].strip()
        else:
            # Fallback to online RadioID.net API lookup
            try:
                import json
                import urllib.request

                def _radioid_lookup(_rid=rid):
                    req = urllib.request.Request(
                        f"https://database.radioid.net/api/dmr/user/?id={_rid}",
                        headers={"User-Agent": "ProxDMR/1.13"}
                    )
                    with urllib.request.urlopen(req, timeout=3.5) as r:
                        r_data = json.loads(r.read().decode("utf-8"))
                        if r_data and r_data.get("results"):
                            return str(r_data["results"][0].get("callsign", "")).strip()
                    return ""

                resolved = await asyncio.to_thread(_radioid_lookup)
                if resolved:
                    target = resolved
            except Exception as e:
                logger.debug(f"[HamQTH] RadioID fallback failed for ID {rid}: {e}")

        if not target or target.isdigit():
            return {
                "status": "not_found",
                "found": False,
                "callsign": query.strip(),
                "message": f"DMR ID {query.strip()} не найден в базе RadioID, невозможно определить позывной для запроса к HamQTH.com"
            }

    res = await hamqth_service.lookup_callsign(target, username=username, password=password)
    return res

@app.get("/api/config")
async def get_config(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    if active_hs:
        return active_hs.config.model_dump()
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings
    return user_sett.hotspots[0].model_dump() if user_sett.hotspots else HotspotConfig().model_dump()

@app.post("/api/config")
async def update_config(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    if active_hs:
        for k, v in payload.items():
            if hasattr(active_hs.config, k):
                setattr(active_hs.config, k, v)
        await hotspot_manager.update_hotspot(active_hs.config, user_id=uid)
        return {"status": "ok", "config": active_hs.config.model_dump()}
    return {"status": "error", "detail": "No active hotspot"}

@app.post("/api/bm/connect")
async def bm_connect_legacy(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    if not active_hs:
        return {"status": "error", "bm_status": "OFFLINE"}
    success = await hotspot_manager.connect_hotspot(active_hs.config.id, user_id=uid)
    return {"status": "ok" if success else "error", "bm_status": active_hs.status.value}

@app.post("/api/bm/disconnect")
async def bm_disconnect_legacy(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    if active_hs:
        await hotspot_manager.disconnect_hotspot(active_hs.config.id, user_id=uid)
    return {"status": "ok", "bm_status": "OFFLINE"}

@app.post("/api/bm/reconnect")
async def bm_reconnect_legacy(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    if not active_hs:
        return {"status": "error", "bm_status": "OFFLINE"}
    success = await hotspot_manager.reconnect_hotspot(active_hs.config.id, user_id=uid)
    return {"status": "ok" if success else "error", "bm_status": active_hs.status.value}

@app.get("/api/bm/tg-name/{tg}")
async def get_bm_tg_single_name(tg: int):
    name = tg_resolver.get_name(tg) if tg > 0 else ""
    return {"status": "ok", "talkgroup": tg, "name": name}

@app.get("/api/calls")
async def get_recent_calls(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    return {
        "calls": [e.to_dict() for e in hotspot_manager.get_calls_history(user_id=uid)]
    }


# ─── Audio Recordings & Player REST API ───────────────────────────────

def _range_audio_response(request: Request, file_path: Path, content_type: str = "audio/wav") -> Response:
    """Stream audio with support for HTTP 206 Partial Content (Range header)."""
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    file_size = file_path.stat().st_size
    range_header = request.headers.get("Range")

    if not range_header:
        return FileResponse(file_path, media_type=content_type, headers={"Accept-Ranges": "bytes"})

    try:
        range_val = range_header.strip().replace("bytes=", "")
        parts = range_val.split("-")
        start = int(parts[0]) if parts[0] else 0
        end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
        start = max(0, start)
        end = min(file_size - 1, end)
        if start > end:
            raise ValueError("Invalid range: start > end")
    except Exception:
        return Response(status_code=416, headers={"Content-Range": f"bytes */{file_size}"})

    chunk_size = (end - start) + 1
    with open(file_path, "rb") as f:
        f.seek(start)
        data = f.read(chunk_size)

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(chunk_size),
        "Content-Type": content_type,
    }
    return Response(content=data, status_code=206, headers=headers)


@app.get("/api/recordings")
async def api_get_recordings(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    call_type: Optional[str] = None,
    search: Optional[str] = None,
):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else 1
    recordings, total = await get_recordings(
        user_id=uid,
        limit=min(200, max(1, limit)),
        offset=max(0, offset),
        call_type=call_type,
        search=search,
    )
    return {
        "recordings": recordings,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@app.get("/api/recordings/stats")
async def api_get_recordings_stats(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else 1
    stats = await get_recordings_stats(user_id=uid)
    max_mb = hotspot_manager.recorder.max_storage_mb if hasattr(hotspot_manager, "recorder") else 2048
    max_bytes = max_mb * 1024 * 1024
    total_bytes = stats.get("total_size_bytes", 0)
    stats["max_storage_mb"] = max_mb
    stats["used_mb"] = round(total_bytes / (1024 * 1024), 2)
    stats["quota_percent"] = min(100.0, round((total_bytes / max_bytes) * 100.0, 1)) if max_bytes > 0 else 0
    stats["session_active"] = hotspot_manager.recorder.is_session_active(uid) if hasattr(hotspot_manager, "recorder") else False
    stats["recording_active"] = hotspot_manager.recorder.is_recording(uid) if hasattr(hotspot_manager, "recorder") else False
    return stats


@app.get("/api/recordings/call/{call_id}")
async def api_get_recording_by_call_id(call_id: str, request: Request):
    rec = await get_recording_by_call_id(call_id)
    if not rec:
        return {"found": False, "recording": None}
    try:
        _require_recording_access(rec, request)
    except HTTPException:
        return {"found": False, "recording": None}
    return {"found": True, "recording": rec}


@app.get("/api/recordings/{rec_id}")
async def api_get_recording_item(rec_id: str, request: Request):
    rec = await get_recording_by_id(rec_id)
    return _require_recording_access(rec, request)


@app.get("/api/recordings/{rec_id}/audio")
async def api_stream_recording_audio(rec_id: str, request: Request):
    rec = await get_recording_by_id(rec_id)
    _require_recording_access(rec, request)
    file_path = Path(rec["file_path"])
    return _range_audio_response(request, file_path, "audio/wav")


_ffmpeg_semaphore: "asyncio.Semaphore | None" = None


def _get_ffmpeg_semaphore() -> "asyncio.Semaphore":
    global _ffmpeg_semaphore
    if _ffmpeg_semaphore is None:
        _ffmpeg_semaphore = asyncio.Semaphore(2)
    return _ffmpeg_semaphore


@app.get("/api/recordings/{rec_id}/download")
@app.get("/download/recordings/{rec_id}")
async def api_download_recording(rec_id: str, request: Request, format: str = "mp3", fn: str = None):
    rec = await get_recording_by_id(rec_id)
    _require_recording_access(rec, request)
    file_path = Path(rec["file_path"])
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found on disk")

    orig_filename = rec.get("filename", f"{rec_id}.wav")

    if format.lower() == "wav":
        wav_filename = fn.strip() if (fn and fn.strip()) else orig_filename
        return FileResponse(
            file_path,
            filename=wav_filename,
            media_type="audio/wav"
        )

    base_name = Path(orig_filename).stem
    mp3_filename = fn.strip() if (fn and fn.strip()) else f"{base_name}.mp3"
    mp3_path = file_path.with_suffix(".mp3")

    need_convert = True
    if mp3_path.exists():
        try:
            if mp3_path.stat().st_mtime >= file_path.stat().st_mtime and mp3_path.stat().st_size > 0:
                need_convert = False
        except Exception:
            need_convert = True

    if need_convert:
        # Ограничиваем число одновременных ffmpeg и пишем во временный файл с атомарной подменой,
        # чтобы параллельные запросы не портили общий .mp3
        async with _get_ffmpeg_semaphore():
            try:
                if mp3_path.exists() and mp3_path.stat().st_mtime >= file_path.stat().st_mtime and mp3_path.stat().st_size > 0:
                    need_convert = False
            except Exception:
                pass
            if need_convert:
                tmp_mp3 = mp3_path.with_name(f"{mp3_path.stem}.{uuid.uuid4().hex[:8]}.tmp.mp3")
                try:
                    proc = await asyncio.create_subprocess_exec(
                        "ffmpeg", "-y", "-i", str(file_path),
                        "-vn", "-c:a", "libmp3lame", "-b:a", "64k",
                        str(tmp_mp3),
                        stdout=asyncio.subprocess.DEVNULL,
                        stderr=asyncio.subprocess.PIPE
                    )
                    try:
                        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=120)
                    except asyncio.TimeoutError:
                        proc.kill()
                        await proc.wait()
                        raise RuntimeError("ffmpeg timeout")
                    if proc.returncode != 0:
                        logger.error(f"[RECORDER] FFmpeg conversion to MP3 failed: {stderr.decode(errors='ignore')}")
                        tmp_mp3.unlink(missing_ok=True)
                        return FileResponse(file_path, filename=orig_filename, media_type="audio/wav")
                    os.replace(tmp_mp3, mp3_path)
                except Exception as e:
                    logger.error(f"[RECORDER] Failed to convert via ffmpeg: {e}")
                    try:
                        tmp_mp3.unlink(missing_ok=True)
                    except Exception:
                        pass
                    return FileResponse(file_path, filename=orig_filename, media_type="audio/wav")

    return FileResponse(
        mp3_path,
        filename=mp3_filename,
        media_type="audio/mpeg"
    )


@app.delete("/api/recordings/{rec_id}")
async def api_delete_recording(rec_id: str, request: Request):
    _require_recording_access(await get_recording_by_id(rec_id), request)
    rec = await delete_recording(rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")
    file_path = Path(rec.get("file_path", ""))
    try:
        if file_path.exists():
            file_path.unlink()
    except Exception as e:
        logger.warning(f"[RECORDER] Could not delete disk file {file_path}: {e}")
    try:
        mp3_path = file_path.with_suffix(".mp3")
        if mp3_path.exists():
            mp3_path.unlink()
    except Exception as e:
        logger.warning(f"[RECORDER] Could not delete disk file {mp3_path}: {e}")
    return {"status": "ok", "deleted_id": rec_id}


@app.post("/api/recordings/{rec_id}/tts-translate")
async def api_recording_tts_translate(rec_id: str, req: RecordingTtsTranslateRequest, request: Request):
    user = _get_user_from_request(request)
    rec = await get_recording_by_id(rec_id)
    if not rec:
        rec = await get_recording_by_call_id(rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")

    target_lang = req.target_lang or getattr(transcriber_service, "target_lang", "ru")
    if target_lang == "none" or not target_lang:
        target_lang = "ru"

    text = (rec.get("transcription") or "").strip()
    detected_lang = rec.get("transcription_lang") or "---"

    if not text:
        file_path = Path(rec.get("file_path", ""))
        if not file_path.exists() or file_path.stat().st_size < 44:
            raise HTTPException(status_code=400, detail="Аудиофайл записи не найден на диске")

        wav_bytes = await asyncio.to_thread(file_path.read_bytes)
        mime = "audio/mpeg" if file_path.suffix.lower() == ".mp3" else "audio/wav"

        transcribed_text, det_lang, err = await transcriber_service.transcribe_wav(
            wav_bytes,
            src_callsign=rec.get("src_callsign", ""),
            src_id=rec.get("src_id", 0),
            mime_type=mime
        )
        if err or not transcribed_text:
            return JSONResponse({"status": "error", "message": err or "Не удалось распознать речь в записи"}, status_code=400)

        text = transcribed_text
        detected_lang = det_lang or "---"

        await update_recording_transcription(rec["id"], text)
        hotspot_manager.attach_transcription(
            hotspot_id=rec.get("hotspot_id") or "default",
            slot=rec.get("slot", 1),
            src_id=rec.get("src_id", 0),
            text=text,
            lang=detected_lang,
            is_final=True,
            call_id=rec.get("call_id") or None,
            created_at=rec.get("created_at")
        )
        try:
            await broadcast_json({
                "type": "recording_transcribed",
                "recording_id": rec["id"],
                "call_id": rec.get("call_id"),
                "text": text,
                "lang": detected_lang
            })
        except Exception:
            pass
    else:
        # Transcription exists. If target_lang is specified, translate if needed
        if hasattr(transcriber_service, "translate_text"):
            text, _ = await transcriber_service.translate_text(text, target_lang=target_lang)

    req_engine = req.engine or getattr(transcriber_service, "tts_engine", "gemini")

    if req_engine == "browser":
        return {
            "status": "ok",
            "engine": "browser",
            "text": text,
            "target_lang": target_lang,
            "recording_id": rec["id"]
        }

    wav_bytes, err = await transcriber_service.synthesize_speech(
        text=text,
        model=req.model,
        voice=req.voice,
        api_key=req.api_key,
        target_lang=target_lang,
        engine=req_engine,
        speed=req.speed or 1.0,
        callsign=rec.get("src_callsign", ""),
        style=req.tts_style
    )
    if err or not wav_bytes:
        return JSONResponse({"status": "error", "message": err or "Ошибка синтеза речи"}, status_code=400)

    b64 = base64.b64encode(wav_bytes).decode("ascii")
    return {
        "status": "ok",
        "audio_base64": b64,
        "text": text,
        "target_lang": target_lang,
        "recording_id": rec["id"]
    }


@app.post("/api/recordings/clear")
async def api_clear_recordings(payload: dict = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else None
    files = await delete_all_recordings(user_id=uid)
    deleted_files = 0
    for f in files:
        try:
            p = Path(f)
            if p.exists():
                p.unlink()
                deleted_files += 1
            mp3_p = p.with_suffix(".mp3")
            if mp3_p.exists():
                mp3_p.unlink()
        except Exception as e:
            logger.warning(f"[RECORDER] Failed to delete file {f}: {e}")
    try:
        await broadcast_json({"type": "recordings_cleared"})
    except Exception as e:
        logger.warning(f"[RECORDER] Failed to broadcast recordings_cleared: {e}")
    return {"status": "ok", "deleted_count": len(files), "deleted_files": deleted_files}


@app.post("/api/calls/batch-delete")
async def api_batch_delete_calls(payload: dict, request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    call_ids = payload.get("call_ids", [])
    if not isinstance(call_ids, list) or not call_ids:
        return {"status": "ok", "deleted_calls": 0, "deleted_recordings": 0}

    # 1. Delete matching calls from memory & JSON history
    deleted_calls = hotspot_manager.delete_calls(call_ids)

    # 2. Delete associated recordings from DB and disk
    deleted_recordings = 0
    for cid in call_ids:
        try:
            rec = await get_recording_by_call_id(str(cid))
            if rec:
                rec_id = rec.get("id")
                await delete_recording(rec_id)
                file_path = Path(rec.get("file_path", ""))
                try:
                    if file_path.exists():
                        file_path.unlink()
                except Exception:
                    pass
                try:
                    mp3_path = file_path.with_suffix(".mp3")
                    if mp3_path.exists():
                        mp3_path.unlink()
                except Exception:
                    pass
                deleted_recordings += 1
        except Exception as e:
            logger.warning(f"[RECORDER] Failed deleting recording for call {cid}: {e}")

    try:
        await broadcast_json({
            "type": "calls_deleted",
            "call_ids": [str(c) for c in call_ids]
        })
        if deleted_recordings > 0:
            await broadcast_json({"type": "recordings_changed"})
    except Exception as e:
        logger.warning(f"[MANAGER] Failed broadcasting calls_deleted: {e}")

    return {
        "status": "ok",
        "deleted_calls": deleted_calls,
        "deleted_recordings": deleted_recordings
    }


@app.post("/api/calls/batch-download")
async def api_batch_download_calls(payload: dict, request: Request):
    import io
    import zipfile
    from datetime import datetime
    from fastapi.responses import Response, FileResponse

    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    call_ids = payload.get("call_ids", [])
    if not isinstance(call_ids, list) or not call_ids:
        raise HTTPException(status_code=400, detail="No call_ids specified")

    found_files = []
    now_str = datetime.now().strftime("%Y%m%d_%H%M%S")

    for cid in call_ids:
        try:
            rec = await get_recording_by_call_id(str(cid))
            if not rec:
                continue
            orig_path = Path(rec.get("file_path", ""))
            mp3_path = orig_path.with_suffix(".mp3")
            target_path = mp3_path if mp3_path.exists() else (orig_path if orig_path.exists() else None)
            if target_path:
                src_call = rec.get("src_callsign") or rec.get("src_id") or "UNKNOWN"
                dst_id = rec.get("dst_id") or "TG"
                rec_ts = int(rec.get("timestamp") or 0)
                time_str = datetime.fromtimestamp(rec_ts).strftime("%H%M%S") if rec_ts > 0 else "000000"
                arc_name = f"{src_call}_TG{dst_id}_{time_str}{target_path.suffix}"
                found_files.append((target_path, arc_name))
        except Exception as e:
            logger.warning(f"[RECORDER] Error resolving audio for call {cid}: {e}")

    if not found_files:
        raise HTTPException(status_code=404, detail="No audio recordings found for selected calls")

    if len(found_files) == 1:
        path, fname = found_files[0]
        media_type = "audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/wav"
        return FileResponse(path, filename=fname, media_type=media_type)

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zip_file:
        used_names = set()
        for path, fname in found_files:
            final_name = fname
            idx = 1
            while final_name in used_names:
                p = Path(fname)
                final_name = f"{p.stem}_{idx}{p.suffix}"
                idx += 1
            used_names.add(final_name)
            zip_file.write(path, arcname=final_name)

    zip_bytes = zip_buffer.getvalue()
    zip_filename = f"proxdmr_recordings_{now_str}.zip"
    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'}
    )


@app.post("/api/calls/batch-transcribe")
async def api_batch_transcribe_calls(payload: dict, request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if not transcriber_service.api_key:
        return JSONResponse({"status": "error", "detail": "Не указан API ключ Gemini в настройках транскрибации"}, status_code=400)

    call_ids = payload.get("call_ids", [])
    if not isinstance(call_ids, list) or not call_ids:
        raise HTTPException(status_code=400, detail="No call_ids specified")

    # Filter only recordings that are selected AND actually have audio on disk
    seen_rec_ids = set()
    valid_recordings = []
    for cid in call_ids:
        try:
            cid_str = str(cid)
            rec = await get_recording_by_call_id(cid_str)
            if not rec:
                rec = await get_recording_by_id(cid_str)
            if rec and rec["id"] not in seen_rec_ids:
                rec_file = Path(rec.get("file_path", ""))
                if not rec_file.is_file():
                    rec_file = RECORDINGS_DIR / rec.get("filename", "")
                if not rec_file.is_file():
                    if rec_file.with_suffix(".wav").is_file():
                        rec_file = rec_file.with_suffix(".wav")
                    elif rec_file.with_suffix(".mp3").is_file():
                        rec_file = rec_file.with_suffix(".mp3")
                if rec_file.is_file() and rec_file.stat().st_size >= 44:
                    rec_copy = dict(rec)
                    rec_copy["resolved_file_path"] = str(rec_file)
                    seen_rec_ids.add(rec["id"])
                    valid_recordings.append(rec_copy)
        except Exception as e:
            logger.warning(f"[BATCH-TRANSCRIBE] Error checking recording for call_id={cid}: {e}")

    if not valid_recordings:
        return {"status": "ok", "queued": 0, "message": "Среди выбранных записей нет аудиофайлов для транскрибации"}

    # Sort recordings chronologically
    valid_recordings.sort(key=lambda r: r.get("created_at", 0))

    hid = payload.get("hotspot_id")
    if not hid or hid == "all":
        hid = valid_recordings[0].get("hotspot_id") or "default"

    runner = offline_transcribe_manager.get_runner(hid)
    if runner.is_running:
        return JSONResponse(
            status_code=409,
            content={"status": "error", "queued": 0, "detail": "Офлайн-транскрибация для этого хотспота уже выполняется"}
        )

    started = offline_transcribe_manager.start(
        hotspot_id=hid,
        user_id=user["user_id"],
        delete_original=False,
        target_recordings=valid_recordings
    )
    if not started:
        return JSONResponse(
            status_code=400,
            content={"status": "error", "queued": 0, "detail": "Не удалось запустить транскрибацию"}
        )

    return {"status": "ok", "queued": len(valid_recordings)}


@app.get("/api/recordings/settings")
async def api_get_recording_settings(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else 1
    rec = getattr(hotspot_manager, "recorder", None)

    # Sync from user settings or app_settings if available
    user_s = await load_user_settings(uid) or {}
    saved_rec = user_s.get("recordings_settings")
    if not saved_rec and hasattr(hotspot_manager, "settings"):
        saved_rec = getattr(hotspot_manager.settings, "recordings_settings", None)
    if saved_rec and rec:
        rec.apply_settings(saved_rec)

    return {
        "status": "ok",
        "settings": {
            "auto_record": (rec.auto_rx_enabled or rec.auto_tx_enabled) if rec else True,
            "auto_record_rx": rec.auto_rx_enabled if rec else True,
            "auto_record_tx": rec.auto_tx_enabled if rec else True,
            "seam_beep": rec.seam_beep_enabled if rec else True,
            "seam_beep_pattern": getattr(rec, "seam_beep_pattern", "600,80") if rec else "600,80",
            "min_duration_sec": rec.min_duration_sec if rec else 0.5,
            "max_storage_mb": rec.max_storage_mb if rec else 2048,
            "max_storage_gb": round((rec.max_storage_mb if rec else 2048) / 1024.0, 1),
            "auto_cleanup": rec.auto_cleanup_enabled if rec else True,
            "gap_threshold_sec": rec.gap_threshold_sec if rec else 1.2,
        }
    }


@app.post("/api/recordings/settings")
async def api_update_recording_settings(payload: dict, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else 1
    if hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder:
        hotspot_manager.recorder.apply_settings(payload)

    # Persist in user settings
    current_settings = await load_user_settings(uid) or {}
    rec = hotspot_manager.recorder
    rec_dict = {
        "auto_record": bool(rec.auto_rx_enabled or rec.auto_tx_enabled),
        "auto_record_rx": rec.auto_rx_enabled,
        "auto_record_tx": rec.auto_tx_enabled,
        "seam_beep": rec.seam_beep_enabled,
        "seam_beep_pattern": getattr(rec, "seam_beep_pattern", "600,80"),
        "min_duration_sec": rec.min_duration_sec,
        "max_storage_mb": rec.max_storage_mb,
        "max_storage_gb": round(rec.max_storage_mb / 1024.0, 1),
        "auto_cleanup": rec.auto_cleanup_enabled,
        "gap_threshold_sec": rec.gap_threshold_sec,
    }
    current_settings["recordings_settings"] = rec_dict
    await save_user_settings(uid, current_settings)

    if hasattr(hotspot_manager, "settings") and hotspot_manager.settings:
        hotspot_manager.settings.recordings_settings = rec_dict
        if uid == 1 or hotspot_manager.active_user_id == 1:
            try:
                save_app_settings(hotspot_manager.settings)
            except Exception as e:
                logger.warning(f"[SETTINGS] Failed to save app_settings with recordings_settings: {e}")

    return {"status": "ok", "settings": rec_dict}


@app.post("/api/recordings/session/toggle")
async def api_toggle_recording_session(payload: dict = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else 1
    action = payload.get("action") if payload else None

    if action == "status":
        status = hotspot_manager.get_recording_session_status(uid)
        return {"status": "ok", "session": status, "active": status is not None}

    if action == "start" or (not action and not hotspot_manager.recorder.is_session_active(uid)):
        active_hid = hotspot_manager.settings.active_hotspot_id or "default"
        info = hotspot_manager.start_recording_session(user_id=uid, hotspot_id=active_hid)
        return {"status": "ok", "action": "started", "session": info}
    else:
        saved = await hotspot_manager.stop_recording_session(user_id=uid)
        return {"status": "ok", "action": "stopped", "saved": saved}


# --- WebSocket Radio Endpoint ---

@app.websocket("/ws/radio")
async def websocket_radio_endpoint(websocket: WebSocket):
    # Verify JWT from cookie or query params before accepting
    token = websocket.cookies.get("proxdmr_token") or websocket.query_params.get("token")
    ws_user = None
    if token:
        ws_user = verify_jwt(token)
    if not ws_user:
        await websocket.close(code=4001, reason="Unauthorized")
        return

    await websocket.accept()
    ws_user_id = ws_user["user_id"]
    ws_login = ws_user.get("login", "")
    client_id = f"{websocket.client.host}:{websocket.client.port}"
    # Prune stale/disconnected sockets from connected_clients
    dead = {s for s in connected_clients if s.client_state != WebSocketState.CONNECTED}
    connected_clients.difference_update(dead)
    for ws in dead:
        dead_uid = ws_user_map.pop(ws, None)
        if dead_uid and dead_uid in user_clients:
            user_clients[dead_uid].discard(ws)
    connected_clients.add(websocket)
    if ws_user_id not in user_clients:
        user_clients[ws_user_id] = set()
    user_clients[ws_user_id].add(websocket)
    ws_user_map[websocket] = ws_user_id
    logger.info(f"[WS] Client connected: {client_id} (user={ws_login}), total: {len(connected_clients)}, user_total: {len(user_clients[ws_user_id])}")

    user_settings = await ensure_active_user(ws_user_id, ws_login)
    u_radio_state = get_user_radio_state(ws_user_id)

    active_hs = hotspot_manager.get_active_runtime(ws_user_id)
    default_unified_tg = getattr(active_hs.config, "default_tg", getattr(active_hs.config, "default_tg_ts2", 2501)) if active_hs else 2501
    tg_ts1 = default_unified_tg
    tg_ts2 = default_unified_tg
    active_tg = u_radio_state.active_tg or default_unified_tg
    apk_meta = get_current_apk_metadata()

    wp_dir = STATIC_DIR / "img" / "wallpapers"
    custom_wp_dark = f"/static/img/wallpapers/bg-custom-u{ws_user_id}-dark.jpg?v={int((wp_dir / f'bg-custom-u{ws_user_id}-dark.jpg').stat().st_mtime)}" if (wp_dir / f"bg-custom-u{ws_user_id}-dark.jpg").exists() else (f"/static/img/bg-custom-dark.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-dark.jpg').stat().st_mtime)}" if ws_user_id == 1 and (STATIC_DIR / "img" / "bg-custom-dark.jpg").exists() else None)
    custom_wp_light = f"/static/img/wallpapers/bg-custom-u{ws_user_id}-light.jpg?v={int((wp_dir / f'bg-custom-u{ws_user_id}-light.jpg').stat().st_mtime)}" if (wp_dir / f"bg-custom-u{ws_user_id}-light.jpg").exists() else (f"/static/img/bg-custom-light.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-light.jpg').stat().st_mtime)}" if ws_user_id == 1 and (STATIC_DIR / "img" / "bg-custom-light.jpg").exists() else None)

    ws_role = await get_user_role(ws_user_id)
    ws_is_swl = await is_user_swl(ws_user_id)

    await websocket.send_text(json.dumps({
        "type": "init",
        "user_id": ws_user_id,
        "login": ws_login,
        "role": ws_role,
        "is_swl": ws_is_swl,
        "version": APP_VERSION,
        "version_date": APP_VERSION_DATE,
        "apk_version": apk_meta["apk_version"],
        "apk_version_date": apk_meta["apk_version_date"],
        "apk_filename": apk_meta["apk_filename"],
        "apk_path": apk_meta["apk_path"],
        "apk_url": apk_meta["apk_url"],
        "server_time": time.time() * 1000,
        "active_hotspot_id": user_settings.active_hotspot_id,
        "active_hotspot": active_hs.to_dict() if active_hs else None,
        "hotspots": [rt.to_dict() for rt in hotspot_manager.get_user_runtimes(ws_user_id).values()],
        "bm_pings": bm_ping_service.cached_pings,
        "bm_host_pings": bm_ping_service.cached_host_pings,
        "bm_losses": bm_ping_service.cached_losses,
        "bm_host_losses": bm_ping_service.cached_host_losses,
        "bm_ping_history": bm_ping_service.get_history_dict(hours=24.0),
        "bm_benchmark_results": bm_ping_service.get_benchmark_results(),
        "bm_benchmark_running": bm_ping_service.is_benchmark_running(),
        "client_ping_history": client_ping_service.get_history_list(hours=6.0),
        "client_rtt": client_ping_service.current_rtt,
        "client_packet_loss": client_ping_service.get_packet_loss(),
        "calls": [e.to_dict() for e in hotspot_manager.get_calls_history(user_id=ws_user_id)],
        "app_settings": {
            "theme": getattr(user_settings, "theme", "dark") or "dark",
            "bg_type": "color" if getattr(user_settings, "bg_type", "pattern") == "color" else "pattern",
            "bg_color": user_settings.bg_color or "#0f1115",
            "bg_type_dark": "color" if getattr(user_settings, "bg_type_dark", "pattern") == "color" else "pattern",
            "bg_color_dark": getattr(user_settings, "bg_color_dark", "#0f1115") or "#0f1115",
            "bg_type_light": "color" if getattr(user_settings, "bg_type_light", "pattern") == "color" else "pattern",
            "bg_color_light": getattr(user_settings, "bg_color_light", "#f4f6f8") or "#f4f6f8",
            "custom_wallpaper_dark": custom_wp_dark,
            "custom_wallpaper_light": custom_wp_light,
            "language": user_settings.language,
            "simultaneous_slots": user_settings.simultaneous_slots,
            "mute_on_ptt": user_settings.mute_on_ptt,
            "volume_down_ptt": getattr(user_settings, "volume_up_ptt", getattr(user_settings, "volume_down_ptt", True)),
            "volume_up_ptt": getattr(user_settings, "volume_up_ptt", getattr(user_settings, "volume_down_ptt", True)),
            "sync_hotspot_volume": getattr(user_settings, "sync_hotspot_volume", True),
            "sync_system_volume": getattr(user_settings, "sync_system_volume", True),
            "haptic_feedback": getattr(user_settings, "haptic_feedback", True),
            "haptic_duration": getattr(user_settings, "haptic_duration", 45),
            "hamqth_username": getattr(user_settings, "hamqth_username", "") or "",
            "hamqth_password": getattr(user_settings, "hamqth_password", "") or "",
            "loopback_mode": user_settings.loopback_mode,
            "quick_mem": user_settings.quick_mem,
        },
        "client_settings": getattr(user_settings, "client_settings", None) or getattr(hotspot_manager.settings, "client_settings", {}) or {},
        "state": {
            "tx_slot": u_radio_state.tx_slot,
            "active_tg": active_tg,
            "tg_ts1": tg_ts1,
            "tg_ts2": tg_ts2,
            "is_tx": u_radio_state.is_transmitting,
            "is_rx": u_radio_state.is_rx,
            "loopback_mode": user_settings.loopback_mode,
            "mute_on_ptt": user_settings.mute_on_ptt,
            "volume_down_ptt": getattr(user_settings, "volume_up_ptt", getattr(user_settings, "volume_down_ptt", True)),
            "volume_up_ptt": getattr(user_settings, "volume_up_ptt", getattr(user_settings, "volume_down_ptt", True)),
            "haptic_feedback": getattr(user_settings, "haptic_feedback", True),
            "haptic_duration": getattr(user_settings, "haptic_duration", 45),
            "bm_status": active_hs.status.value if active_hs else "OFFLINE",
            "bm_detail": active_hs.detail if active_hs else "Отключен",
            "agc": hotspot_manager.get_agc_settings(user_id=ws_user_id),
        }
    }))

    try:
        for hid, runner in offline_transcribe_manager.runners.items():
            if runner.is_running:
                await websocket.send_text(json.dumps({
                    "type": "offline_transcribe_state",
                    "hotspot_id": hid,
                    "active": True,
                    "status": "running",
                    "stats": runner.stats
                }))
    except Exception:
        pass

    try:
        while True:
            message = await websocket.receive()
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                except Exception:
                    continue

                msg_type = data.get("type")

                if msg_type == "ptt_press":
                    if await is_user_swl(ws_user_id):
                        logger.warning(f"[PTT] Denied for SWL user {ws_login} (id={ws_user_id})")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": "Передача запрещена: включен режим SWL (только приём)",
                            "code": "SWL_DENIED"
                        }))
                        continue
                    hid = data.get("hotspot_id")
                    if hid:
                        hotspot_manager.set_active_hotspot(hid, user_id=ws_user_id)
                    slot = int(data.get("slot", u_radio_state.tx_slot))
                    tg = int(data.get("tg", u_radio_state.active_tg))
                    is_loop = bool(data.get("loopback", False)) or user_settings.loopback_mode
                    u_radio_state.is_transmitting = True
                    u_radio_state.transmitting_client_id = client_id
                    u_radio_state.tx_start_time = time.time()
                    u_radio_state.tx_slot = slot
                    u_radio_state.active_tg = tg
                    u_radio_state.is_loopback = is_loop

                    active_hs = hotspot_manager.get_active_runtime(ws_user_id)
                    callsign = active_hs.config.callsign if active_hs else "N0CALL"
                    dmr_id = active_hs.config.dmr_id if active_hs else 0

                    # Determine call type (default to PRIVATE for 9990 Parrot or if explicitly requested)
                    req_call_type = str(data.get("call_type", "")).upper()
                    if req_call_type in ("PRIVATE", "GROUP"):
                        call_type = req_call_type
                    else:
                        call_type = "PRIVATE" if (tg == 9990 or tg > 999999) else "GROUP"

                    if is_loop:
                        logger.info(f"[PTT] (MIC LOOP) Pressed by {client_id} (user {ws_login}) on Slot {slot} (Local loop, no BM TX)")
                    else:
                        logger.info(f"[PTT] Pressed by {client_id} (user {ws_login}) on Hotspot {active_hs.config.id if active_hs else ''}, Slot {slot}, TG {tg}")

                    # Start DMR TX pipeline (Voice Header to BM if online, and log TX entry)
                    hotspot_manager.start_tx(
                        hotspot_id=active_hs.config.id if active_hs else None,
                        slot=slot,
                        dst_id=tg,
                        call_type=call_type,
                        is_loopback=is_loop,
                        user_id=ws_user_id,
                    )

                    await broadcast_user_json(ws_user_id, {
                        "type": "state_change",
                        "is_tx": True,
                        "is_loopback": is_loop,
                        "client_id": client_id,
                        "hotspot_id": active_hs.config.id if active_hs else "",
                        "slot": slot,
                        "active_tg": tg,
                        "callsign": callsign,
                        "dmr_id": dmr_id
                    })

                elif msg_type == "ptt_release":
                    if u_radio_state.transmitting_client_id == client_id:
                        is_loop = getattr(u_radio_state, "is_loopback", False)
                        hotspot_manager.stop_tx(user_id=ws_user_id)
                        u_radio_state.is_transmitting = False
                        u_radio_state.transmitting_client_id = None
                        u_radio_state.is_loopback = False
                        duration = time.time() - u_radio_state.tx_start_time
                        active_hs = hotspot_manager.get_active_runtime(ws_user_id)
                        logger.info(f"[PTT] Released by {client_id} (user {ws_login}){' (MIC LOOP)' if is_loop else ''}, duration: {duration:.2f}s")

                        await broadcast_user_json(ws_user_id, {
                            "type": "state_change",
                            "is_tx": False,
                            "client_id": client_id,
                            "hotspot_id": active_hs.config.id if active_hs else "",
                            "duration": duration,
                            "slot": u_radio_state.tx_slot,
                            "active_tg": u_radio_state.active_tg
                        })

                elif msg_type == "set_slot":
                    new_slot = int(data.get("slot", 2))
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if new_slot in (1, 2):
                        if target_hs and target_hs.config.id == user_settings.active_hotspot_id:
                            u_radio_state.tx_slot = new_slot
                        logger.info(f"[SLOT] Switched user {ws_login} Hotspot {target_hs.config.id if target_hs else ''} slot to {new_slot}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "slot_change",
                            "hotspot_id": target_hs.config.id if target_hs else "",
                            "slot": new_slot,
                            "active_tg": u_radio_state.active_tg
                        }, exclude=websocket)

                elif msg_type == "set_tg":
                    new_tg = int(data.get("tg", u_radio_state.active_tg))
                    slot = int(data.get("slot", u_radio_state.tx_slot))
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        if new_tg == 4000:
                            hotspot_manager.clear_dynamic_tgs(target_hs.config.id, slot=slot, user_id=ws_user_id)
                        elif new_tg > 0 and new_tg not in (4000, 9990):
                            hotspot_manager.register_dynamic_tg(target_hs.config.id, slot, new_tg, user_id=ws_user_id)
                        target_hs.config.default_tg_ts1 = new_tg
                        target_hs.config.default_tg_ts2 = new_tg
                        if hasattr(target_hs.config, "default_tg"):
                            target_hs.config.default_tg = new_tg
                        for hs in user_settings.hotspots:
                            if hs.id == target_hs.config.id:
                                hs.default_tg_ts1 = new_tg
                                hs.default_tg_ts2 = new_tg
                                if hasattr(hs, "default_tg"):
                                    hs.default_tg = new_tg
                                break
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                    if target_hs and target_hs.config.id == user_settings.active_hotspot_id:
                        u_radio_state.active_tg = new_tg
                    logger.info(f"[TG] WS Switched user {ws_login} Hotspot {target_hs.config.id if target_hs else ''} TG to {new_tg}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "tg_change",
                        "hotspot_id": target_hs.config.id if target_hs else "",
                        "active_tg": new_tg,
                        "slot": slot,
                        "tg_ts1": new_tg,
                        "tg_ts2": new_tg
                    }, exclude=websocket)

                elif msg_type == "set_loopback":
                    enabled = bool(data.get("enabled", True))
                    if user_settings.loopback_mode != enabled:
                        user_settings.loopback_mode = enabled
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[LOOPBACK] Set to {user_settings.loopback_mode} for user {ws_login}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "loopback_change",
                            "enabled": user_settings.loopback_mode
                        }, exclude=websocket)

                elif msg_type == "set_transcribe_slot":
                    hid = str(data.get("hotspot_id", "")).strip()
                    slot = int(data.get("slot", 1))
                    enabled = bool(data.get("enabled", False))
                    if transcriber_service and hid:
                        target_hs = hotspot_manager.get_runtime(ws_user_id, hid)
                        if not target_hs:
                            target_hs = hotspot_manager.get_active_runtime(ws_user_id)
                        effective_hid = target_hs.config.id if target_hs else hid
                        transcriber_service.set_slot_enabled(effective_hid, slot, enabled)
                        if effective_hid != hid:
                            transcriber_service.set_slot_enabled(hid, slot, enabled)

                elif msg_type == "set_tts_slot":
                    hid = str(data.get("hotspot_id", "")).strip()
                    slot = int(data.get("slot", 1))
                    enabled = bool(data.get("enabled", False))
                    if transcriber_service and hid:
                        target_hs = hotspot_manager.get_runtime(ws_user_id, hid)
                        if not target_hs:
                            target_hs = hotspot_manager.get_active_runtime(ws_user_id)
                        effective_hid = target_hs.config.id if target_hs else hid
                        transcriber_service.set_slot_tts_enabled(effective_hid, slot, enabled)
                        if effective_hid != hid:
                            transcriber_service.set_slot_tts_enabled(hid, slot, enabled)

                elif msg_type == "disable_all_transcribe_slots":
                    if transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
                        transcriber_service.disable_all_slots()
                    await broadcast_json({"type": "transcribe_all_disabled"}, exclude=websocket)

                elif msg_type == "disable_hotspot_transcribe":
                    hid = str(data.get("hotspot_id", "")).strip()
                    if transcriber_service and hid:
                        target_hs = hotspot_manager.get_runtime(ws_user_id, hid)
                        if not target_hs:
                            target_hs = hotspot_manager.get_active_runtime(ws_user_id)
                        effective_hid = target_hs.config.id if target_hs else hid
                        transcriber_service.disable_hotspot(effective_hid)
                        if effective_hid != hid:
                            transcriber_service.disable_hotspot(hid)
                        await broadcast_json({
                            "type": "hotspot_transcribe_disabled",
                            "hotspot_id": effective_hid
                        }, exclude=websocket)

                elif msg_type == "set_mute_on_ptt":
                    enabled = bool(data.get("enabled", True))
                    if user_settings.mute_on_ptt != enabled:
                        user_settings.mute_on_ptt = enabled
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[PTT] Mute on PTT set to {user_settings.mute_on_ptt}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "mute_on_ptt_change",
                            "enabled": user_settings.mute_on_ptt
                        }, exclude=websocket)

                elif msg_type in ("set_volume_up_ptt", "set_volume_down_ptt"):
                    enabled = bool(data.get("enabled", True))
                    if getattr(user_settings, "volume_up_ptt", None) != enabled or user_settings.volume_down_ptt != enabled:
                        user_settings.volume_up_ptt = enabled
                        user_settings.volume_down_ptt = enabled
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[PTT] Volume up PTT set to {enabled}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "volume_up_ptt_change",
                            "enabled": enabled
                        }, exclude=websocket)
                        await broadcast_user_json(ws_user_id, {
                            "type": "volume_down_ptt_change",
                            "enabled": enabled
                        }, exclude=websocket)

                elif msg_type == "set_haptic_feedback":
                    enabled = bool(data.get("enabled", True))
                    if getattr(user_settings, "haptic_feedback", True) != enabled:
                        user_settings.haptic_feedback = enabled
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[HAPTIC] Feedback set to {enabled}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "haptic_feedback_change",
                            "enabled": enabled
                        }, exclude=websocket)

                elif msg_type == "set_haptic_duration":
                    dur = int(data.get("duration", 45))
                    dur = max(15, min(150, dur))
                    if getattr(user_settings, "haptic_duration", 45) != dur:
                        user_settings.haptic_duration = dur
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[HAPTIC] Duration set to {dur} ms")
                        await broadcast_user_json(ws_user_id, {
                            "type": "haptic_duration_change",
                            "duration": dur
                        }, exclude=websocket)

                elif msg_type == "set_slot_mute":
                    hid = str(data.get("hotspot_id", "")).strip()
                    slot = int(data.get("slot", 1))
                    muted = bool(data.get("muted", False))
                    hotspot_manager.set_slot_mute(hid, slot, muted)

                elif msg_type == "set_hotspot_mute":
                    hid = str(data.get("hotspot_id", "")).strip()
                    muted = bool(data.get("muted", False))
                    hotspot_manager.set_hotspot_mute(hid, muted)

                elif msg_type == "sync_slot_mutes":
                    mutes = data.get("mutes", [])
                    for m in mutes:
                        if isinstance(m, dict):
                            hotspot_manager.set_slot_mute(
                                str(m.get("hotspot_id", "")).strip(),
                                int(m.get("slot", 1)),
                                bool(m.get("muted", False))
                            )

                elif msg_type == "toggle_recording_session":
                    uid = ws_user_id or 1
                    action = data.get("action")
                    if action == "start" or (not action and not hotspot_manager.recorder.is_session_active(uid)):
                        active_hid = hotspot_manager.settings.active_hotspot_id or "default"
                        hotspot_manager.start_recording_session(user_id=uid, hotspot_id=active_hid)
                    else:
                        await hotspot_manager.stop_recording_session(user_id=uid)

                elif msg_type == "set_theme":
                    theme = str(data.get("theme", "dark"))
                    if theme not in ("dark", "light"):
                        theme = "dark"
                    user_settings.theme = theme
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(f"[SETTINGS] Theme set to {theme}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "theme_change",
                        "theme": theme
                    }, exclude=websocket)

                elif msg_type == "set_background":
                    bg_type = str(data.get("bg_type", "pattern"))
                    if bg_type != "color":
                        bg_type = "pattern"
                    bg_color = str(data.get("bg_color", "#0f1115"))
                    theme_target = str(data.get("theme_target", getattr(user_settings, "theme", "dark") or "dark"))
                    if theme_target not in ("dark", "light"):
                        theme_target = "dark"

                    user_settings.bg_type = bg_type
                    user_settings.bg_color = bg_color
                    if theme_target == "light":
                        user_settings.bg_type_light = bg_type
                        user_settings.bg_color_light = bg_color
                    else:
                        user_settings.bg_type_dark = bg_type
                        user_settings.bg_color_dark = bg_color

                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(f"[SETTINGS] Background set for theme={theme_target}: type={bg_type}, color={bg_color}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "background_change",
                        "theme_target": theme_target,
                        "bg_type": bg_type,
                        "bg_color": bg_color,
                        "bg_type_dark": getattr(user_settings, "bg_type_dark", "pattern"),
                        "bg_color_dark": getattr(user_settings, "bg_color_dark", "#0f1115"),
                        "bg_type_light": getattr(user_settings, "bg_type_light", "pattern"),
                        "bg_color_light": getattr(user_settings, "bg_color_light", "#f4f6f8"),
                    }, exclude=websocket)

                elif msg_type == "set_language":
                    lang = str(data.get("language", "ru"))
                    user_settings.language = lang
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(f"[SETTINGS] Language set to {lang}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "language_change",
                        "language": lang
                    }, exclude=websocket)

                elif msg_type == "set_simultaneous_slots":
                    enabled = bool(data.get("enabled", True))
                    user_settings.simultaneous_slots = enabled
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(f"[SETTINGS] Simultaneous slots set to {enabled}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "simultaneous_slots_change",
                        "enabled": enabled
                    }, exclude=websocket)

                elif msg_type == "set_check_mic_on_tx":
                    enabled = bool(data.get("enabled", True))
                    user_settings.check_mic_on_tx = enabled
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(f"[SETTINGS] Check mic on TX set to {enabled}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "check_mic_on_tx_change",
                        "enabled": enabled
                    }, exclude=websocket)

                elif msg_type == "set_quick_mem":
                    key = str(data.get("key", ""))
                    val = data.get("data")
                    if key:
                        if val is None:
                            user_settings.quick_mem.pop(key, None)
                        else:
                            user_settings.quick_mem[key] = val
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[SETTINGS] Quick mem updated: {key}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "quick_mem_change",
                            "key": key,
                            "data": val,
                            "all_quick_mem": user_settings.quick_mem
                        }, exclude=websocket)

                elif msg_type == "set_vocoder_settings":
                    uvq = min(8, max(1, int(data.get("uvquality", 3))))
                    enh = bool(data.get("spectral_enh", True))
                    flt = bool(data.get("float_mode", True))
                    reps = int(data.get("max_repeats", 3))
                    decay = float(data.get("repeat_decay", 0.75))
                    fec = int(data.get("fec_tolerance", 1))
                    gain = min(8.0, max(1.0, float(data.get("audio_gain", 7.0))))
                    user_rts = hotspot_manager.get_user_runtimes(ws_user_id)
                    for rt in user_rts.values():
                        if hasattr(rt, "vocoder") and hasattr(rt.vocoder, "set_settings"):
                            rt.vocoder.set_settings(
                                uvquality=uvq,
                                spectral_enh=enh,
                                float_mode=flt,
                                max_repeats=reps,
                                repeat_decay=decay,
                                fec_tolerance=fec,
                                audio_gain=gain
                            )
                    if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                        user_settings.client_settings = {}
                    user_settings.client_settings.setdefault("ambe_rx", {}).update({
                        "uvquality": uvq,
                        "spectral_enh": enh,
                        "float_mode": flt,
                        "max_repeats": reps,
                        "repeat_decay": int(decay * 100) if decay <= 1.0 else int(decay),
                        "fec_tolerance": fec,
                        "audio_gain": gain
                    })
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(
                        f"[VOCODER] Applied & saved DSD-FME settings (user {ws_login}): uvq={uvq}, enh={enh}, flt={flt}, "
                        f"reps={reps}, decay={decay}, fec={fec}, gain={gain}"
                    )

                elif msg_type == "set_agc_enabled":
                    enabled = bool(data.get("enabled", True))
                    hotspot_manager.set_agc_enabled(enabled, user_id=ws_user_id)
                    settings = hotspot_manager.get_agc_settings(user_id=ws_user_id)
                    if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                        user_settings.client_settings = {}
                    user_settings.client_settings.setdefault("audio_rx", {})["agc_enabled"] = enabled
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    await broadcast_user_json(ws_user_id, {
                        "type": "agc_state",
                        "enabled": enabled,
                        **settings
                    })

                elif msg_type == "set_agc_profile":
                    profile = data.get("profile", "standard")
                    settings = hotspot_manager.set_agc_profile(profile, user_id=ws_user_id)
                    if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                        user_settings.client_settings = {}
                    arx = user_settings.client_settings.setdefault("audio_rx", {})
                    arx["agc_profile"] = profile
                    if "max_gain_db" in settings:
                        arx["agc_boost"] = settings["max_gain_db"]
                    if "min_gain_db" in settings:
                        arx["agc_atten"] = settings["min_gain_db"]
                    if "hang_time" in settings:
                        arx["agc_hang"] = settings["hang_time"]
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    await broadcast_user_json(ws_user_id, {
                        "type": "agc_settings",
                        **settings
                    })

                elif msg_type == "set_agc_params":
                    min_g = data.get("min_gain_db")
                    max_g = data.get("max_gain_db")
                    hang = data.get("hang_time")
                    if min_g is not None:
                        min_g = float(min_g)
                    if max_g is not None:
                        max_g = float(max_g)
                    if hang is not None:
                        hang = float(hang)
                    settings = hotspot_manager.set_agc_params(min_g, max_g, hang, user_id=ws_user_id)
                    if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                        user_settings.client_settings = {}
                    arx = user_settings.client_settings.setdefault("audio_rx", {})
                    if max_g is not None:
                        arx["agc_boost"] = max_g
                    if min_g is not None:
                        arx["agc_atten"] = min_g
                    if hang is not None:
                        arx["agc_hang"] = hang
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    await broadcast_user_json(ws_user_id, {
                        "type": "agc_settings",
                        **settings
                    })

                elif msg_type == "save_client_settings":
                    cs = data.get("client_settings")
                    if isinstance(cs, dict):
                        if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                            user_settings.client_settings = {}
                        user_settings.client_settings.update(cs)
                        hotspot_manager.apply_client_settings_to_runtimes(cs, user_id=ws_user_id)
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)

                elif msg_type == "set_active_hotspot":
                    hid = data.get("id")
                    if hid:
                        hotspot_manager.set_active_hotspot(hid, user_id=ws_user_id)

                elif msg_type == "bm_connect":
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        await hotspot_manager.connect_hotspot(target_hs.config.id, user_id=ws_user_id)

                elif msg_type == "bm_disconnect":
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        await hotspot_manager.disconnect_hotspot(target_hs.config.id, user_id=ws_user_id)

                elif msg_type == "hotspot_collapse":
                    hid = data.get("hotspot_id")
                    collapsed = bool(data.get("collapsed", False))
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        await hotspot_manager.set_hotspot_collapsed(target_hs.config.id, collapsed, user_id=ws_user_id)


                elif msg_type == "sync_settings":
                    # Save user settings to DB
                    if ws_user:
                        settings_data = data.get("settings")
                        if isinstance(settings_data, dict):
                            await save_user_settings(ws_user["user_id"], settings_data)

                elif msg_type == "start_bm_benchmark":
                    masters_data = await get_bm_masters()
                    servers = masters_data.get("masters", [])
                    await bm_ping_service.start_benchmark(servers)

                elif msg_type == "cancel_bm_benchmark":
                    bm_ping_service.cancel_benchmark()

                elif msg_type == "bm_reconnect":
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        await hotspot_manager.reconnect_hotspot(target_hs.config.id, user_id=ws_user_id)

                elif msg_type in ("ping", "client_ping"):
                    seq = data.get("seq")
                    ts = data.get("ts", time.time() * 1000)
                    rtt_reported = data.get("rtt")
                    is_lost = bool(data.get("lost", False))
                    client_loss_val = data.get("loss_pct")
                    now_ts = int(time.time())
                    current_rtt, loss_pct = client_ping_service.record_client_ping(rtt_reported, is_lost=is_lost, client_loss=client_loss_val)
                    resp_type = "client_pong" if msg_type == "client_ping" else "pong"
                    resp_dict = {
                        "type": resp_type,
                        "client_ts": ts,
                        "server_ts": time.time() * 1000,
                        "rtt": current_rtt,
                        "loss": loss_pct,
                        "point": [now_ts, current_rtt] if current_rtt is not None else [now_ts, None]
                    }
                    if seq is not None:
                        resp_dict["seq"] = seq
                    await websocket.send_text(json.dumps(resp_dict))

            elif "bytes" in message:
                audio_bytes = message["bytes"]
                is_loop = getattr(u_radio_state, "is_loopback", False) or user_settings.loopback_mode
                if u_radio_state.is_transmitting and (u_radio_state.transmitting_client_id == client_id or not u_radio_state.transmitting_client_id):
                    if not is_loop:
                        hotspot_manager.process_tx_audio(audio_bytes, user_id=ws_user_id)
                    else:
                        try:
                            active_hs = hotspot_manager.get_active_runtime(ws_user_id)
                            hid = active_hs.config.id if active_hs else "default"
                            hid_bytes = hid.encode("utf-8")
                            slot = u_radio_state.tx_slot if u_radio_state.tx_slot in (1, 2) else 1
                            # ProxDMR tagged audio packet: [slot (1B), hid_len (1B), hid_bytes, pcm_bytes]
                            tagged_audio = bytes([slot, len(hid_bytes)]) + hid_bytes + audio_bytes
                            await websocket.send_bytes(tagged_audio)
                        except Exception as e:
                            logger.error(f"[MIC LOOP] Error echoing audio: {e}")
                else:
                    last_drop = getattr(u_radio_state, "_last_drop_log", 0.0)
                    now_t = time.time()
                    if now_t - last_drop > 2.0:
                        u_radio_state._last_drop_log = now_t
                        logger.warning(
                            f"[WS_AUDIO] Discarded {len(audio_bytes)}B audio: is_tx={u_radio_state.is_transmitting}, "
                            f"tx_client={u_radio_state.transmitting_client_id}, cur_client={client_id}"
                        )

    except WebSocketDisconnect:
        logger.info(f"[WS] Client disconnected: {client_id}")
    except Exception as e:
        logger.error(f"[WS] Error on {client_id}: {e}")
    finally:
        connected_clients.discard(websocket)
        disc_uid = ws_user_map.pop(websocket, None)
        if disc_uid and disc_uid in user_clients:
            user_clients[disc_uid].discard(websocket)
            if not user_clients[disc_uid]:
                user_clients.pop(disc_uid, None)
        if u_radio_state.transmitting_client_id == client_id:
            hotspot_manager.stop_tx(user_id=ws_user_id)
            u_radio_state.is_transmitting = False
            u_radio_state.transmitting_client_id = None
            u_radio_state.is_loopback = False
            await broadcast_user_json(ws_user_id, {
                "type": "state_change",
                "is_tx": False,
                "client_id": client_id
            })

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8266))
    use_ssl = os.environ.get("USE_SSL", "true").lower() in ("true", "1", "yes")

    ssl_cert_path = None
    ssl_key_path = None

    if use_ssl:
        host_ip = (os.environ.get("HOST_IP") or os.environ.get("EXTERNAL_HOST") or "").strip()
        cert_file, key_file = ensure_ssl_certificates(host_ip)
        ssl_cert_path = cert_file
        ssl_key_path = key_file
        logger.info(f"[BOOT] Starting HTTPS/WSS on port {port} with self-signed SSL...")
    else:
        logger.info(f"[BOOT] Starting HTTP/WS on port {port} (SSL disabled)...")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        ssl_certfile=ssl_cert_path,
        ssl_keyfile=ssl_key_path,
        log_level="info"
    )