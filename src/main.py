import asyncio
import contextvars
import base64
import json
import logging
import os
import re
import sys
import time
import socket
import wave
from datetime import datetime, timezone
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Dict, List, Optional, Set, Any

from pydantic import BaseModel, Field
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
    import memguard
    import visitor_stats
    import alerts_config
    from ssl_helper import ensure_ssl_certificates
    from transcriber import GeminiTranscriberService, get_tts_test_phrase
    from demo_mode import demo_manager, mask_hotspot_dict_for_demo, mask_hotspots_list_for_demo, mask_settings_for_demo, mask_call_entry_for_demo
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
        is_user_swl, set_user_swl, get_full_backup_data, restore_backup_data,
        get_collection, set_collection_key, delete_collection_key, replace_collection,
        get_all_collections, is_excluded_from_storage_dump
    )
    from settings_io import export_settings, import_settings, import_settings_bundle, get_export_filename, inspect_backup_archive
    from updater import check_for_updates, apply_update
    from i18n_backend import (
        SUPPORTED_LANGS as I18N_SUPPORTED_LANGS,
        normalize_lang,
        preload_locales,
        set_request_lang,
        reset_request_lang,
        get_request_lang,
        get_lang,
        set_user_lang,
        resolve_request_lang,
        tr as _tr,
        country_name as _i18n_country_name,
        tg_special_name as _tg_special_name,
    )
except ImportError:
    from src.config import AppSettings, HotspotConfig, load_app_settings, save_app_settings
    from src.dmr.homebrew import BMState
    from src.dmr.manager import HotspotManager
    from src.dmr.tg_resolver import tg_resolver
    from src.dmr.user_db import user_db
    from src.dmr.hamqth import hamqth_service
    from src.ping import BMPingService, ClientPingService
    from src import memguard
    from src import visitor_stats
    from src import alerts_config
    from src.ssl_helper import ensure_ssl_certificates
    from src.transcriber import GeminiTranscriberService, get_tts_test_phrase
    from src.demo_mode import demo_manager, mask_hotspot_dict_for_demo, mask_hotspots_list_for_demo, mask_settings_for_demo, mask_call_entry_for_demo
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
        is_user_swl, set_user_swl, get_full_backup_data, restore_backup_data,
        get_collection, set_collection_key, delete_collection_key, replace_collection,
        get_all_collections, is_excluded_from_storage_dump
    )
    from src.settings_io import export_settings, import_settings, import_settings_bundle, get_export_filename, inspect_backup_archive
    from src.updater import check_for_updates, apply_update
    from src.i18n_backend import (
        SUPPORTED_LANGS as I18N_SUPPORTED_LANGS,
        normalize_lang,
        preload_locales,
        set_request_lang,
        reset_request_lang,
        get_request_lang,
        get_lang,
        set_user_lang,
        resolve_request_lang,
        tr as _tr,
        country_name as _i18n_country_name,
        tg_special_name as _tg_special_name,
    )

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
ws_active_hotspots: Dict[WebSocket, Set[str]] = {}
demo_ws_clients: Dict[WebSocket, str] = {}  # ws -> demo_sid
ws_audio_queues: Dict[WebSocket, asyncio.Queue] = {}
ws_audio_tasks: Dict[WebSocket, asyncio.Task] = {}
ws_client_instance_map: Dict[WebSocket, str] = {}   # ws -> client_instance_id (cid)
active_user_client_cid: Dict[int, str] = {}         # user_id -> active non-demo cid
active_parrot_sessions: Dict[str, dict] = {}        # client_id -> parrot test session state

def _prune_dead_ws_clients() -> None:
    dead = {
        s for s in list(connected_clients)
        if s.client_state != WebSocketState.CONNECTED or s.application_state != WebSocketState.CONNECTED
    }
    if dead:
        connected_clients.difference_update(dead)
        for ws_dead in dead:
            ws_active_hotspots.pop(ws_dead, None)
            demo_ws_clients.pop(ws_dead, None)
            q_dead = ws_audio_queues.pop(ws_dead, None)
            t_dead = ws_audio_tasks.pop(ws_dead, None)
            if q_dead:
                try: q_dead.put_nowait(None)
                except Exception: pass
            if t_dead and not t_dead.done():
                t_dead.cancel()
            dead_uid = ws_user_map.pop(ws_dead, None)
            if dead_uid and dead_uid in user_clients:
                user_clients[dead_uid].discard(ws_dead)
                if not user_clients[dead_uid]:
                    user_clients.pop(dead_uid, None)
    for uid_k, u_set in list(user_clients.items()):
        stale_u = {
            s for s in list(u_set)
            if s.client_state != WebSocketState.CONNECTED or s.application_state != WebSocketState.CONNECTED
        }
        if stale_u:
            u_set.difference_update(stale_u)
            for ws_s in stale_u:
                connected_clients.discard(ws_s)
                ws_user_map.pop(ws_s, None)
                ws_active_hotspots.pop(ws_s, None)
                q_s = ws_audio_queues.pop(ws_s, None)
                t_s = ws_audio_tasks.pop(ws_s, None)
                if q_s:
                    try: q_s.put_nowait(None)
                    except Exception: pass
                if t_s and not t_s.done():
                    t_s.cancel()
            if not u_set:
                user_clients.pop(uid_k, None)

def _is_hotspot_open_on_any_client(user_id: int, hotspot_id: str, exclude_ws: Optional[WebSocket] = None) -> bool:
    _prune_dead_ws_clients()
    sockets = user_clients.get(user_id, set())
    for s in list(sockets):
        if exclude_ws is not None and s is exclude_ws:
            continue
        hset = ws_active_hotspots.get(s)
        if hset is not None and hotspot_id in hset:
            return True
    return False

class RadioState:
    def __init__(self):
        self.is_transmitting = False
        self.transmitting_client_id: Optional[str] = None
        self.tx_start_time: float = 0.0
        self.tx_slot: int = 2  # Default transmitting slot (2 for simplex/local, 1 for DX)
        self.active_tg: int = 2501
        self.is_rx: bool = False

radio_state = RadioState()
user_radio_states: Dict[int, RadioState] = {}

def get_user_radio_state(user_id: int) -> RadioState:
    if user_id not in user_radio_states:
        user_radio_states[user_id] = RadioState()
    return user_radio_states[user_id]


def _mask_bm_resp_for_demo(resp: dict, cfg: Optional[Any] = None) -> dict:
    if not isinstance(resp, dict):
        return resp
    out = dict(resp)
    ssid = 1
    if cfg:
        try:
            ssid = int(getattr(cfg, "bm_ssid", 1) or 1)
        except Exception:
            ssid = 1
    out["device_id"] = f"1234567{ssid:02d}" if ssid > 0 else "1234567"
    if "callsign" in out:
        out["callsign"] = _tr("demo.your_callsign", fallback="Your Callsign")
    return out

async def broadcast_user_json(user_id: int, data: dict, exclude: Optional[WebSocket] = None):
    sockets = user_clients.get(user_id)
    if not sockets:
        return
    targets = [ws for ws in list(sockets) if ws != exclude and ws.client_state == WebSocketState.CONNECTED]
    if not targets:
        return
    msg_normal = json.dumps(data)
    msg_demo = None
    if any(ws in demo_ws_clients for ws in targets):
        if isinstance(data.get("hotspot"), dict) or isinstance(data.get("hotspots"), list):
            demo_data = dict(data)
            if isinstance(demo_data.get("hotspot"), dict):
                demo_data["hotspot"] = mask_hotspot_dict_for_demo(demo_data["hotspot"])
            if isinstance(demo_data.get("hotspots"), list):
                demo_data["hotspots"] = mask_hotspots_list_for_demo(demo_data["hotspots"])
            msg_demo = json.dumps(demo_data)
    results = await asyncio.gather(*[
        _send_ws_text(ws, (msg_demo if (msg_demo and ws in demo_ws_clients) else msg_normal))
        for ws in targets
    ], return_exceptions=True)
    dead_clients = {ws for ws, ok in zip(targets, results) if ok is not True}
    if dead_clients:
        sockets.difference_update(dead_clients)
        connected_clients.difference_update(dead_clients)
        for ws in dead_clients:
            ws_user_map.pop(ws, None)

async def _send_ws_bytes(ws: WebSocket, data: bytes) -> bool:
    try:
        await ws.send_bytes(data)
        return True
    except Exception:
        return False

async def _send_ws_text(ws: WebSocket, text: str) -> bool:
    try:
        await asyncio.wait_for(ws.send_text(text), timeout=0.5)
        return True
    except Exception:
        return False

async def _ws_audio_sender_loop(ws: WebSocket, q: asyncio.Queue) -> None:
    """Dedicated low-latency streaming loop for a single WebSocket client.
    Pulls audio buffers from a dedicated ring-queue and sends them over TCP without
    task allocation overhead or contention with main API events."""
    try:
        while True:
            chunk = await q.get()
            if chunk is None:  # Exit sentinel
                break
            try:
                await ws.send_bytes(chunk)
            except Exception:
                break
            finally:
                q.task_done()
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.debug(f"[WS-AUDIO] Streamer loop terminated: {e}")

def dispatch_user_audio(user_id: int, data: bytes, exclude: Optional[WebSocket] = None) -> None:
    """Fast, synchronous O(1) audio packet dispatch directly into client queues.
    Drops oldest chunk if client's buffer is backlogged (>1.92s) to maintain real-time sync."""
    sockets = user_clients.get(user_id)
    if not sockets:
        return
    for ws in list(sockets):
        if ws == exclude:
            continue
        cid = ws_client_instance_map.get(ws)
        if cid and cid in active_parrot_sessions:
            # Во время попугай-теста изолируем клиента от постороннего звука радиоэфира
            continue
        q = ws_audio_queues.get(ws)
        if q is not None:
            try:
                q.put_nowait(data)
            except asyncio.QueueFull:
                try:
                    q.get_nowait()
                    q.task_done()
                except Exception:
                    pass
                try:
                    q.put_nowait(data)
                except Exception:
                    pass

def broadcast_binary(data: bytes, exclude: Optional[WebSocket] = None, user_id: Optional[int] = None) -> None:
    """Synchronous fast binary audio broadcast."""
    if user_id is not None:
        dispatch_user_audio(int(user_id), data, exclude=exclude)
        return
    for ws, q in list(ws_audio_queues.items()):
        if ws == exclude:
            continue
        try:
            q.put_nowait(data)
        except asyncio.QueueFull:
            try:
                q.get_nowait()
                q.task_done()
            except Exception:
                pass
            try:
                q.put_nowait(data)
            except Exception:
                pass

async def broadcast_user_binary(user_id: int, data: bytes, exclude: Optional[WebSocket] = None) -> None:
    """Async wrapper for backward compatibility."""
    dispatch_user_audio(user_id, data, exclude=exclude)

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


transcriber_service = GeminiTranscriberService(broadcast_fn=broadcast_json)
transcriber_service.configure(
    enabled=getattr(app_settings, "transcriber_enabled", False),
    api_key=getattr(app_settings, "transcriber_api_key", ""),
    model=getattr(app_settings, "transcriber_model", "gemini-3.1-flash-lite"),
    target_lang=getattr(app_settings, "transcriber_target_lang", "ru"),
    source_lang=getattr(app_settings, "transcriber_source_lang", "auto"),
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
    tts_skip_short_callsign=getattr(app_settings, "tts_skip_short_callsign", True),
    tts_style=getattr(app_settings, "tts_style", "radio"),
    transcriber_engine=getattr(app_settings, "transcriber_engine", "gemini"),
    translation_engine=getattr(app_settings, "translation_engine", "gemini"),
    groq_api_key=getattr(app_settings, "groq_api_key", ""),
    groq_api_keys=getattr(app_settings, "groq_api_keys", []),
    deepgram_api_key=getattr(app_settings, "deepgram_api_key", ""),
    gemini_use_first_key_only=getattr(app_settings, "gemini_use_first_key_only", False),
    groq_use_first_key_only=getattr(app_settings, "groq_use_first_key_only", False),
    gemini_use_first_key=getattr(app_settings, "gemini_use_first_key", True),
    gemini_use_other_keys=getattr(app_settings, "gemini_use_other_keys", True),
    groq_use_first_key=getattr(app_settings, "groq_use_first_key", True),
    groq_use_other_keys=getattr(app_settings, "groq_use_other_keys", True),
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
                d["connected_node"] = getattr(rt, "connected_node", None)
                d["asl_links"] = getattr(rt, "asl_links", None)
                d["_active_asl_node"] = getattr(rt, "_active_asl_node", None)
                d["_last_asl_node"] = getattr(rt, "_last_asl_node", None)
                d["user_id"] = getattr(rt, "user_id", 1)
                d["allstar_node"] = getattr(getattr(rt, "config", rt), "allstar_node", "1999")
            else:
                d = {
                    "id": cfg.id,
                    "name": cfg.name,
                    "bm_master_host": cfg.bm_master_host,
                    "network_type": getattr(cfg, "network_type", "bm") or "bm",
                    "allstar_node": getattr(cfg, "allstar_node", "1999"),
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
    preload_locales()
    await init_db()
    if transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
        transcriber_service.disable_all_slots()
    try:
        await ensure_active_user(1, force_reload=True)
    except Exception as e:
        logger.warning(f"[MAIN] Error initializing user 1 settings on startup: {e}")
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

    async def _auto_initial_bm_benchmark():
        try:
            await asyncio.sleep(3.0)
            existing = bm_ping_service.get_benchmark_results()
            if not existing:
                logger.info("[MAIN] No primary BM ping table found. Running silent startup BM benchmark...")
                masters_data = await get_bm_masters()
                servers = masters_data.get("masters", [])
                if servers:
                    await bm_ping_service.start_benchmark(servers, silent=True)
            else:
                logger.info(f"[MAIN] Loaded primary BM ping table ({len(existing)} servers cached).")
        except Exception as e:
            logger.warning(f"[MAIN] Silent startup BM benchmark failed: {e}")

    asyncio.create_task(_auto_initial_bm_benchmark())
    memguard.start(BASE_DIR / "data")
    await visitor_stats.init()
    stats_task = asyncio.create_task(visitor_stats.reporter_loop())

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
    try:
        from dmr.xlx_hosts import xlx_hosts_mgr
        asyncio.create_task(xlx_hosts_mgr.periodic_update_loop())
        from dmr.dmrplus_hosts import dmrplus_hosts_mgr
        asyncio.create_task(dmrplus_hosts_mgr.periodic_update_loop())
        from allstar_directory import allstar_dir_mgr
        asyncio.create_task(allstar_dir_mgr.periodic_update_loop())
        from dmr.ysf_directory import ysf_dir_mgr
        asyncio.create_task(ysf_dir_mgr.periodic_update_loop())
    except Exception as e:
        logger.warning(f"[MAIN] Failed to start xlx_hosts background loop: {e}")
    yield
    bm_ping_service.stop()
    memguard.stop()
    sync_task.cancel()
    stats_task.cancel()
    logger.info("[MAIN] Shutting down ProxDMR Gateway...")
    if transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
        transcriber_service.disable_all_slots()
    await hotspot_manager.stop()
    try:
        from asl_container_manager import asl_container_mgr
        asl_container_mgr.stop_all_instances()
    except Exception as e:
        logger.warning(f"[MAIN] Error stopping ASL containers on shutdown: {e}")

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
_AUTH_SKIP_EXACT = ("/", "/favicon.ico", "/apk", "/download/apk", "/download/ai-guide", "/ai-guide", "/api/apk/info", "/api/apk/version", "/api/health")

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


def _is_asl_hotspot_obj(rt_or_cfg) -> bool:
    if not rt_or_cfg:
        return False
    cfg = getattr(rt_or_cfg, "config", rt_or_cfg)
    nt = getattr(cfg, "network_type", None) if not isinstance(cfg, dict) else cfg.get("network_type")
    return str(nt or "").strip().lower() == "allstar"


async def _prepare_demo_hotspot_ssid(uid: int, rt_check):
    """Records admin collapsed state before demo user expands/connects a hotspot."""
    if not rt_check:
        return
    real_hid = rt_check.config.id
    s_admin = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    admin_hs_cfg = next((h for h in getattr(s_admin, "hotspots", []) if h.id == real_hid), rt_check.config)
    demo_manager.record_admin_collapsed_state(real_hid, bool(getattr(admin_hs_cfg, "collapsed", False)))


async def _revert_demo_runtime_state():
    """Restores transcriber and hotspot collapsed states when no demo sessions are active."""
    if not demo_ws_clients and len(demo_manager.get_active_sessions()) == 0:
        s_admin = hotspot_manager.user_settings.get(1)
        if s_admin:
            _configure_transcriber_from_settings(s_admin)
            try:
                await broadcast_json({
                    "type": "transcriber_settings_change",
                    "enabled": getattr(s_admin, "transcriber_enabled", False),
                    "model": getattr(s_admin, "transcriber_model", "gemini-3.5-flash"),
                    "target_lang": getattr(transcriber_service, "target_lang", "ru"),
                    "source_lang": getattr(transcriber_service, "source_lang", "auto"),
                    "has_key": bool(s_admin.transcriber_api_key or getattr(s_admin, "transcriber_api_keys", [])),
                    "tts_enabled": getattr(transcriber_service, "tts_enabled", False),
                    "tts_engine": getattr(transcriber_service, "tts_engine", "piper"),
                    "tts_model": getattr(transcriber_service, "tts_model", "gemini-3.1-flash-tts-preview"),
                    "tts_voice": getattr(transcriber_service, "tts_voice", "auto"),
                    "tts_speed": getattr(transcriber_service, "tts_speed", 1.1),
                    "tts_ducking_level": getattr(transcriber_service, "tts_ducking_level", 0.80),
                    "tts_pause_ducking_level": getattr(transcriber_service, "tts_pause_ducking_level", 1.0),
                    "tts_mute_others": getattr(transcriber_service, "tts_mute_others", True),
                    "tts_announce_callsign": getattr(transcriber_service, "tts_announce_callsign", False),
                    "tts_skip_short_callsign": getattr(transcriber_service, "tts_skip_short_callsign", True),
                })
            except Exception as e:
                logger.warning(f"[DEMO] Failed to broadcast restored transcriber settings: {e}")
        collapsed_backups = demo_manager.pop_admin_collapsed_backups()
        if collapsed_backups:
            admin_hs_map = {h.id: h for h in getattr(s_admin, "hotspots", [])} if s_admin else {}
            for hid, was_col in collapsed_backups.items():
                await hotspot_manager.set_hotspot_collapsed(hid, was_col, user_id=1, persist=False)
                rt = hotspot_manager.get_runtime(1, hid)
                if rt and rt.client and hid in admin_hs_map:
                    admin_ssid = getattr(admin_hs_map[hid], "bm_ssid", getattr(admin_hs_map[hid], "ssid", 1))
                    if getattr(rt.client, "ssid", admin_ssid) != admin_ssid:
                        rt.client.ssid = admin_ssid
                        if not was_col and rt.client.is_connected:
                            asyncio.create_task(rt.client.connect(force=True))


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path

    # Static files do not require JWT or DB access
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

    payload = verify_jwt(token) if token else None
    req_is_demo = bool(payload and payload.get("is_demo"))
    req_uid_hint = payload.get("user_id") if (payload and not req_is_demo) else None
    req_lang = resolve_request_lang(request, user_id=req_uid_hint, is_demo=req_is_demo)
    lang_token = set_request_lang(req_lang)
    try:
        if payload:
            if payload.get("is_demo"):
                demo_sid = payload.get("demo_sid", "")
                sess = demo_manager.get_session(demo_sid)
                if not sess or not demo_manager.get_config().get("enabled"):
                    payload = None
                    if path.startswith("/api/") and not path.startswith("/api/auth/"):
                        return JSONResponse({"error": "Demo session expired", "code": "DEMO_EXPIRED"}, status_code=401)
                else:
                    payload["role"] = "demo"
                    payload["is_swl"] = True
                    payload["demo_expires_at"] = int(sess.expires_at)
                    request.state.user = payload

                    if request.method not in ("GET", "HEAD", "OPTIONS") and path not in (
                        "/api/auth/logout",
                        "/api/auth/login",
                        "/api/transcriber/tts-test",
                        "/api/transcriber/settings",
                        "/api/transcriber/piper/download",
                    ) and not (
                        path == "/api/hotspots/active"
                        or (
                            path.startswith("/api/hotspots/")
                            and path.endswith(("/expand", "/collapse", "/connect", "/disconnect", "/reconnect"))
                        )
                    ):
                        return JSONResponse({
                            "status": "error",
                            "code": "DEMO_READ_ONLY",
                            "detail": _tr("auth.demo_read_only", fallback="🔒 Demo mode: changing settings is disabled"),
                            "message": _tr("auth.demo_read_only", fallback="🔒 Demo mode: changing settings is disabled"),
                        }, status_code=403)
                    if path.startswith("/api/settings/export") or path.startswith("/api/admin/backup"):
                        return JSONResponse({
                            "status": "error",
                            "code": "DEMO_READ_ONLY",
                            "detail": _tr("auth.demo_export_disabled", fallback="🔒 Demo mode: exports and backups are unavailable"),
                        }, status_code=403)
            else:
                uid = payload.get('user_id', 0)
                blocked, role = await _get_user_state_cached(uid)
                if blocked:
                    payload = None  # Treat as unauthenticated
                    if path.startswith('/api/') and path not in ('/api/auth/login',):
                        return JSONResponse({"error": _tr("auth.access_blocked", fallback="Access is blocked")}, status_code=403)
                if payload:
                    # Role is loaded from DB (cached for a few seconds) so role changes take effect quickly
                    payload["role"] = role
                    request.state.user = payload
                    # Block accidental mutating requests from paused session (without logout!)
                    req_cid = (request.headers.get("x-proxdmr-client-id") or "").strip()
                    cur_active_cid = active_user_client_cid.get(uid)
                    if (
                        role != "demo"
                        and req_cid
                        and cur_active_cid
                        and req_cid != cur_active_cid
                        and request.method not in ("GET", "HEAD", "OPTIONS")
                        and not path.startswith("/api/auth/")
                        and not path.startswith("/api/system/")
                    ):
                        return JSONResponse(
                            {
                                "status": "error",
                                "code": "SESSION_PAUSED",
                                "detail": _tr("auth.session_paused", fallback="Session paused (another device is active)"),
                            },
                            status_code=409,
                        )

        # Skip 401 check for public paths
        if path in _AUTH_SKIP_EXACT or any(path.startswith(p) for p in _AUTH_SKIP_PREFIXES):
            return await call_next(request)
        # /download/recordings/* requires authorization (checked in endpoint); other /download/* are public (APK)
        if path.startswith("/download/") and not path.startswith("/download/recordings/"):
            return await call_next(request)

        if not getattr(request.state, "user", None):
            if path.startswith("/api/"):
                return JSONResponse({"error": "Unauthorized"}, status_code=401)
            return await call_next(request)

        return await call_next(request)
    finally:
        reset_request_lang(lang_token)


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


def _configure_transcriber_from_settings(user_app_settings: AppSettings):
    transcriber_service.configure(
        enabled=getattr(user_app_settings, "transcriber_enabled", False),
        api_key=getattr(user_app_settings, "transcriber_api_key", ""),
        model=getattr(user_app_settings, "transcriber_model", "gemini-3.1-flash-lite"),
        target_lang=getattr(user_app_settings, "transcriber_target_lang", "ru"),
        source_lang=getattr(user_app_settings, "transcriber_source_lang", "auto"),
        api_keys=getattr(user_app_settings, "transcriber_api_keys", []),
        tts_enabled=getattr(user_app_settings, "tts_enabled", False),
        tts_engine=getattr(user_app_settings, "tts_engine", "piper"),
        tts_model=getattr(user_app_settings, "tts_model", "gemini-3.1-flash-tts-preview"),
        tts_voice=getattr(user_app_settings, "tts_voice", "ru_RU-terra5871-medium"),
        tts_speed=getattr(user_app_settings, "tts_speed", 1.1),
        tts_ducking_level=getattr(user_app_settings, "tts_ducking_level", 0.80),
        tts_pause_ducking_level=getattr(user_app_settings, "tts_pause_ducking_level", 1.0),
        tts_mute_others=getattr(user_app_settings, "tts_mute_others", True),
        tts_announce_callsign=getattr(user_app_settings, "tts_announce_callsign", False),
        tts_skip_short_callsign=getattr(user_app_settings, "tts_skip_short_callsign", True),
        tts_style=getattr(user_app_settings, "tts_style", "radio"),
        transcriber_engine=getattr(user_app_settings, "transcriber_engine", "groq"),
        translation_engine=getattr(user_app_settings, "translation_engine", "groq"),
        groq_api_key=getattr(user_app_settings, "groq_api_key", ""),
        groq_api_keys=getattr(user_app_settings, "groq_api_keys", []),
        deepgram_api_key=getattr(user_app_settings, "deepgram_api_key", ""),
        gemini_use_first_key_only=getattr(user_app_settings, "gemini_use_first_key_only", False),
        groq_use_first_key_only=getattr(user_app_settings, "groq_use_first_key_only", False),
        gemini_use_first_key=getattr(user_app_settings, "gemini_use_first_key", True),
        gemini_use_other_keys=getattr(user_app_settings, "gemini_use_other_keys", True),
        groq_use_first_key=getattr(user_app_settings, "groq_use_first_key", True),
        groq_use_other_keys=getattr(user_app_settings, "groq_use_other_keys", True),
    )


async def ensure_active_user(user_id: int, login: str = "", force_reload: bool = False) -> AppSettings:
    """Ensure hotspot_manager has initialized the specified user's runtimes and settings without disrupting other users."""
    existing_sett = hotspot_manager.user_settings.get(user_id)
    if not force_reload and existing_sett is not None and user_id in hotspot_manager.user_runtimes:
        if user_id == 1 and getattr(existing_sett, "transcriber_enabled", False) and not transcriber_service.is_enabled():
            _configure_transcriber_from_settings(existing_sett)
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

    try:
        ysf_types_col = await get_collection(user_id, "ysf_room_types")
    except Exception:
        ysf_types_col = {}
    if not hasattr(hotspot_manager, "user_ysf_room_types"):
        hotspot_manager.user_ysf_room_types = {}
    hotspot_manager.user_ysf_room_types[user_id] = dict(ysf_types_col or {})

    await hotspot_manager.ensure_user_runtimes(user_id, user_app_settings)
    hotspot_manager.apply_client_settings_to_runtimes(getattr(user_app_settings, "client_settings", {}) or {}, user_id=user_id)
    for hs_cfg in getattr(user_app_settings, "hotspots", []):
        rt = hotspot_manager.get_runtime(user_id, hs_cfg.id)
        if rt:
            rt.config.auto_record = getattr(hs_cfg, "auto_record", False)

    if user_id == 1:
        rec_s = getattr(user_app_settings, "recordings_settings", {}) or (raw_s.get("recordings_settings", {}) if raw_s else {})
        if rec_s and hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder:
            hotspot_manager.recorder.apply_settings(rec_s)
        _configure_transcriber_from_settings(user_app_settings)

    set_user_lang(
        user_id,
        getattr(user_app_settings, "language", "ru"),
        update_runtime_default=(user_id == 1),
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
async def api_auth_status(request: Request):
    uc = await user_count()
    client_ip = demo_manager.get_client_ip(request)
    return {
        "is_first_run": (uc == 0),
        "allow_registration": False,
        "demo": demo_manager.get_public_status(client_ip),
    }


@app.post("/api/auth/register")
async def auth_register(body: AuthRegisterRequest, request: Request, response: Response):
    ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(ip):
        raise HTTPException(status_code=429, detail=_tr("auth.rate_limit", fallback="Too many attempts. Please wait a minute"))

    # Open registration is completely disabled; endpoint is only permitted for initial onboarding
    if await user_count() > 0:
        raise HTTPException(status_code=403, detail=_tr("auth.registration_disabled", fallback="New user registration is disabled. New accounts are created by an administrator."))

    # Validate
    err = validate_login(body.login)
    if err:
        raise HTTPException(status_code=400, detail=err)
    err = validate_password(body.password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # Check login uniqueness
    if await login_exists(body.login):
        raise HTTPException(status_code=409, detail=_tr("auth.login_taken", fallback="This username is already taken"))

    # Create user with clean default settings
    pw_hash = await asyncio.to_thread(hash_password, body.password)
    user_id = await create_user(body.login, pw_hash)

    # Switch hotspot_manager and transcriber to the new user's clean settings
    user_settings = await ensure_active_user(user_id, body.login)

    # Apply initial onboarding configuration if provided
    settings_changed = False
    norm_reg_lang = normalize_lang(body.language)
    if norm_reg_lang:
        user_settings.language = norm_reg_lang
        set_user_lang(user_id, norm_reg_lang, update_runtime_default=(user_id == 1))
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
    client_ip = demo_manager.get_client_ip(request)
    demo_cfg = demo_manager.get_config()
    req_login = (body.login or "").strip()
    if req_login.lower() == demo_cfg.get("login", "demo").lower():
        if body.password != demo_cfg.get("password", "demo"):
            raise HTTPException(status_code=401, detail=_tr("auth.invalid_credentials", fallback="Invalid username or password"))
        prev_sid = None
        old_tok = request.cookies.get("proxdmr_token")
        if old_tok:
            old_p = verify_jwt(old_tok)
            if old_p and old_p.get("is_demo"):
                prev_sid = old_p.get("demo_sid")
        sess, err = demo_manager.start_session(client_ip, existing_sid=prev_sid)
        if err:
            st_code = 429 if err.get("code") in ("DEMO_COOLDOWN", "DEMO_SLOTS_FULL") else 403
            return JSONResponse({"status": "error", **err}, status_code=st_code)
        showcase_uid = demo_cfg.get("showcase_user_id", 1)
        await ensure_active_user(showcase_uid, "admin")
        rem_sec = max(1, int(sess.expires_at - time.time()))
        token = create_jwt(
            showcase_uid,
            "demo",
            remember=False,
            role="demo",
            exp_seconds=rem_sec,
            extra={
                "is_demo": True,
                "is_swl": True,
                "demo_sid": sess.sid,
                "demo_expires_at": int(sess.expires_at),
            },
        )
        response.set_cookie(
            key="proxdmr_token",
            value=token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=rem_sec,
            path="/",
        )
        s_admin = hotspot_manager.user_settings.get(showcase_uid, hotspot_manager.settings)
        if len(demo_manager.get_active_sessions()) <= 1 and s_admin:
            _configure_transcriber_from_settings(s_admin)
        admin_rts = [rt for rt in hotspot_manager.get_user_runtimes(showcase_uid).values() if not _is_asl_hotspot_obj(rt)]
        hs_collapsed_map = {}
        for idx_rt, rt in enumerate(admin_rts):
            hid = rt.config.id
            orig_col = demo_manager._admin_collapsed_backup.get(hid, bool(getattr(rt.config, "collapsed", idx_rt > 0)))
            hs_collapsed_map[hid] = orig_col
            if idx_rt == 0:
                hs_collapsed_map["default"] = orig_col
            if len(demo_manager.get_active_sessions()) <= 1 and getattr(rt.config, "collapsed", None) != orig_col:
                await hotspot_manager.set_hotspot_collapsed(hid, orig_col, user_id=showcase_uid, persist=False)

        wp_dir = STATIC_DIR / "img" / "wallpapers"
        c_dark = f"/static/img/wallpapers/bg-custom-u{showcase_uid}-dark.jpg?v={int((wp_dir / f'bg-custom-u{showcase_uid}-dark.jpg').stat().st_mtime)}" if (wp_dir / f"bg-custom-u{showcase_uid}-dark.jpg").exists() else (f"/static/img/bg-custom-dark.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-dark.jpg').stat().st_mtime)}" if (STATIC_DIR / "img" / "bg-custom-dark.jpg").exists() else None)
        c_light = f"/static/img/wallpapers/bg-custom-u{showcase_uid}-light.jpg?v={int((wp_dir / f'bg-custom-u{showcase_uid}-light.jpg').stat().st_mtime)}" if (wp_dir / f"bg-custom-u{showcase_uid}-light.jpg").exists() else (f"/static/img/bg-custom-light.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-light.jpg').stat().st_mtime)}" if (STATIC_DIR / "img" / "bg-custom-light.jpg").exists() else None)

        bootstrap_state = {
            "app_settings": {
                "theme": getattr(s_admin, "theme", "dark") or "dark",
                "language": getattr(s_admin, "language", "ru") or "ru",
                "bg_type_dark": "color" if getattr(s_admin, "bg_type_dark", "pattern") == "color" else "pattern",
                "bg_color_dark": getattr(s_admin, "bg_color_dark", "#0f1115") or "#0f1115",
                "bg_type_light": "color" if getattr(s_admin, "bg_type_light", "pattern") == "color" else "pattern",
                "bg_color_light": getattr(s_admin, "bg_color_light", "#f4f6f8") or "#f4f6f8",
                "custom_wallpaper_dark": c_dark,
                "custom_wallpaper_light": c_light,
                "active_hotspot_id": (admin_rts[0].config.id if admin_rts and all(rt.config.id != (getattr(s_admin, "active_hotspot_id", "default") or "default") for rt in admin_rts) else (getattr(s_admin, "active_hotspot_id", "default") or "default")),
                "simultaneous_slots": getattr(s_admin, "simultaneous_slots", False),
            },
            "client_settings": getattr(s_admin, "client_settings", None) or getattr(hotspot_manager.settings, "client_settings", {}) or {},
            "hotspots_collapsed": hs_collapsed_map,
        }
        return {
            "status": "ok",
            "user": {
                "id": showcase_uid,
                "login": "demo",
                "role": "demo",
                "is_swl": True,
                "is_demo": True,
                "demo_expires_at": int(sess.expires_at),
                "demo_session_minutes": demo_cfg.get("session_minutes", 10),
            },
            "token": token,
            "bootstrap_state": bootstrap_state,
        }

    ip = request.client.host if request.client else "unknown"
    if _check_rate_limit(ip):
        raise HTTPException(status_code=429, detail=_tr("auth.rate_limit", fallback="Too many attempts. Please wait a minute"))

    _record_attempt(ip)

    user = await get_user_by_login(body.login)
    if not user or not await asyncio.to_thread(verify_password, body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail=_tr("auth.invalid_credentials", fallback="Invalid username or password"))

    # Check if user is blocked
    if await is_user_blocked(user["id"]):
        raise HTTPException(status_code=403, detail=_tr("auth.account_blocked", fallback="Account is blocked. Contact the administrator."))

    await update_last_login(user["id"])
    user_settings_obj = await ensure_active_user(user["id"], user["login"])
    user_rts = list(hotspot_manager.get_user_runtimes(user["id"]).values())
    hs_collapsed_map = {
        rt.config.id: bool(getattr(rt.config, "collapsed", False))
        for rt in user_rts
    }
    bootstrap_state = {
        "app_settings": {
            "theme": getattr(user_settings_obj, "theme", "dark") or "dark",
            "language": getattr(user_settings_obj, "language", "ru") or "ru",
            "bg_type_dark": "color" if getattr(user_settings_obj, "bg_type_dark", "pattern") == "color" else "pattern",
            "bg_color_dark": getattr(user_settings_obj, "bg_color_dark", "#0f1115") or "#0f1115",
            "bg_type_light": "color" if getattr(user_settings_obj, "bg_type_light", "pattern") == "color" else "pattern",
            "bg_color_light": getattr(user_settings_obj, "bg_color_light", "#f4f6f8") or "#f4f6f8",
            "active_hotspot_id": getattr(user_settings_obj, "active_hotspot_id", "default") or "default",
            "simultaneous_slots": getattr(user_settings_obj, "simultaneous_slots", False),
        },
        "client_settings": getattr(user_settings_obj, "client_settings", None) or {},
        "hotspots_collapsed": hs_collapsed_map,
    }

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
    return {
        "status": "ok",
        "user": {"id": user["id"], "login": user["login"], "role": role},
        "token": token,
        "bootstrap_state": bootstrap_state,
    }


def _collect_backup_wallpapers(users_list: list[dict]) -> tuple[dict[str, bytes], dict[str, dict[str, str]]]:
    """
    Scans custom wallpaper JPG files on disk for specified users and packages them
    with deterministic archive names and a metadata manifest mapping (login -> {theme: arc_name}).
    """
    extra_files: dict[str, bytes] = {}
    manifest: dict[str, dict[str, str]] = {}
    wp_dir = STATIC_DIR / "img" / "wallpapers"

    for idx, u in enumerate(users_list):
        uid = u.get("id")
        login = str(u.get("login") or "").strip().lower()
        if not uid or not login:
            continue
        user_map: dict[str, str] = {}
        for theme in ("dark", "light"):
            cand = wp_dir / f"bg-custom-u{uid}-{theme}.jpg"
            if not cand.exists() and uid == 1:
                legacy_cand = STATIC_DIR / "img" / f"bg-custom-{theme}.jpg"
                if legacy_cand.exists():
                    cand = legacy_cand
            if cand.exists():
                try:
                    data = cand.read_bytes()
                    arc_name = f"wp_{idx}_{theme}.jpg"
                    extra_files[arc_name] = data
                    user_map[theme] = arc_name
                except Exception as e:
                    logger.warning(f"[BACKUP] Failed reading wallpaper {cand}: {e}")
        if user_map:
            manifest[login] = user_map

    return extra_files, manifest


def _extract_backup_wallpapers(
    extra_files: dict[str, bytes],
    manifest: dict,
    restored_users_info: list[dict],
) -> None:
    """
    Extracts wallpaper attachments from backup archive and saves them onto disk
    under the new user's `bg-custom-u{new_uid}-{theme}.jpg` filenames.
    """
    if not extra_files or not isinstance(extra_files, dict):
        return
    wp_dir = STATIC_DIR / "img" / "wallpapers"
    wp_dir.mkdir(parents=True, exist_ok=True)

    manifest_map = manifest if isinstance(manifest, dict) else {}

    for u_info in restored_users_info:
        new_uid = u_info.get("user_id")
        backup_login = str(u_info.get("backup_login") or u_info.get("login") or "").strip().lower()
        if not new_uid or not backup_login:
            continue

        theme_map = manifest_map.get(backup_login, {})
        for theme in ("dark", "light"):
            arc_name = theme_map.get(theme) if isinstance(theme_map, dict) else None
            data = extra_files.get(arc_name) if arc_name else None
            # Fallback for single-user backups or missing manifest
            if not data:
                for cand_key in (f"wp_{theme}.jpg", f"bg-custom-{theme}.jpg", f"wallpaper_{theme}.jpg"):
                    if cand_key in extra_files:
                        data = extra_files[cand_key]
                        break
            if data:
                try:
                    out_path = wp_dir / f"bg-custom-u{new_uid}-{theme}.jpg"
                    out_path.write_bytes(data)
                    logger.info(f"[BACKUP] Restored {theme} wallpaper for user {backup_login} -> {out_path.name}")
                except Exception as e:
                    logger.warning(f"[BACKUP] Failed writing wallpaper for user {backup_login}: {e}")


def _collect_server_config_for_backup() -> dict:
    """Collects server-wide superadmin configuration for backup."""
    srv: dict = {}
    data_dir = BASE_DIR / "data"
    try:
        raw_alerts = alerts_config.load_alerts_config(data_dir)
        srv["alerts_config"] = raw_alerts
    except Exception as e:
        logger.warning(f"[BACKUP] Error collecting alerts_config: {e}")

    try:
        raw_demo = demo_manager.get_config()
        srv["demo_config"] = raw_demo
    except Exception as e:
        logger.warning(f"[BACKUP] Error collecting demo_config: {e}")

    try:
        srv["visitor_stats_enabled"] = bool(visitor_stats.is_enabled())
    except Exception as e:
        logger.warning(f"[BACKUP] Error collecting visitor_stats: {e}")

    try:
        def_file = PROJECT_ROOT / "config" / "default_settings.json"
        if def_file.exists():
            srv["default_settings_template"] = json.loads(def_file.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning(f"[BACKUP] Error collecting default_settings.json: {e}")

    return srv


async def _apply_server_config_from_backup(srv_cfg: dict) -> None:
    """Restores server-wide superadmin configuration from backup."""
    if not isinstance(srv_cfg, dict) or not srv_cfg:
        return
    data_dir = BASE_DIR / "data"
    data_dir.mkdir(parents=True, exist_ok=True)

    if "alerts_config" in srv_cfg and isinstance(srv_cfg["alerts_config"], dict):
        try:
            alerts_config.save_alerts_config(data_dir, srv_cfg["alerts_config"])
            logger.info("[BACKUP] Server Telegram alerts configuration restored")
        except Exception as e:
            logger.warning(f"[BACKUP] Error restoring alerts_config: {e}")

    if "demo_config" in srv_cfg and isinstance(srv_cfg["demo_config"], dict):
        try:
            demo_manager.save_config(srv_cfg["demo_config"])
            logger.info("[BACKUP] Server demo mode configuration restored")
        except Exception as e:
            logger.warning(f"[BACKUP] Error restoring demo_config: {e}")

    if "visitor_stats_enabled" in srv_cfg:
        try:
            await visitor_stats.set_enabled(bool(srv_cfg["visitor_stats_enabled"]))
            logger.info("[BACKUP] Visitor stats sharing state restored")
        except Exception as e:
            logger.warning(f"[BACKUP] Error restoring visitor_stats: {e}")

    if "default_settings_template" in srv_cfg and isinstance(srv_cfg["default_settings_template"], dict):
        try:
            cfg_dir = PROJECT_ROOT / "config"
            cfg_dir.mkdir(parents=True, exist_ok=True)
            def_path = cfg_dir / "default_settings.json"
            def_path.write_text(json.dumps(srv_cfg["default_settings_template"], indent=2, ensure_ascii=False), encoding="utf-8")
            logger.info("[BACKUP] Default settings template restored")
        except Exception as e:
            logger.warning(f"[BACKUP] Error restoring default_settings.json: {e}")


def _collect_live_user_settings_map() -> dict[int, dict]:
    """Collects in-memory AppSettings snapshot across active runtimes to ensure zero recent state is lost."""
    live_map: dict[int, dict] = {}
    if hasattr(hotspot_manager, "user_settings") and isinstance(hotspot_manager.user_settings, dict):
        for uid_k, app_sett in hotspot_manager.user_settings.items():
            if hasattr(app_sett, "model_dump"):
                live_map[uid_k] = app_sett.model_dump()
    return live_map


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
        raise HTTPException(status_code=429, detail=_tr("auth.rate_limit", fallback="Too many attempts. Please wait a minute"))

    _record_attempt(ip)

    if not password:
        raise HTTPException(status_code=400, detail=_tr("auth.archive_password_required", fallback="Archive password is required"))

    archive_bytes = await file.read()
    if not archive_bytes:
        raise HTTPException(status_code=400, detail=_tr("auth.archive_empty", fallback="Archive file is empty"))

    try:
        backup_data, extra_files = import_settings_bundle(archive_bytes, password)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    is_v2 = isinstance(backup_data, dict) and backup_data.get("format_version") == 2
    client_storage_to_return = {}
    restored_users_info: list[dict] = []

    if is_v2:
        is_sa = bool(backup_data.get("is_superadmin_backup", False))
        if is_sa:
            sa_acc = (backup_data.get("superadmin") or {}).get("account") or {}
            clean_login = login.strip() or sa_acc.get("login") or "admin"
            clean_login = re.sub(r'[^a-zA-Z0-9_.\-]', '', clean_login)
            pw_hash = sa_acc.get("password_hash") or (await asyncio.to_thread(hash_password, password))

            u1 = await get_user_by_id(1)
            u1_sett = await load_user_settings(1) if u1 else {}
            u1_hs = (u1_sett or {}).get("hotspots") or []
            u1_is_empty = bool(u1 and len(u1_hs) <= 1 and int((u1_hs[0] if u1_hs else {}).get("dmr_id") or 0) == 0 and (await user_count()) == 1)

            existing_user = await get_user_by_login(clean_login)
            if existing_user:
                if existing_user["id"] == 1 and u1_is_empty:
                    # Fresh unconfigured server install: overwrite default admin with imported superadmin
                    import aiosqlite
                    from database import DB_FILE
                    async with aiosqlite.connect(str(DB_FILE)) as db:
                        await db.execute("UPDATE users SET login = ?, password_hash = ?, role = 'superadmin' WHERE id = 1", (clean_login.lower(), pw_hash))
                        await db.commit()
                    user_id = 1
                elif not await asyncio.to_thread(verify_password, password, existing_user["password_hash"]):
                    raise HTTPException(
                        status_code=401,
                        detail=_tr("auth.import_password_mismatch", fallback="A user with this login already exists, but the password does not match the archive password")
                    )
                else:
                    user_id = existing_user["id"]
            else:
                if u1_is_empty:
                    import aiosqlite
                    from database import DB_FILE
                    async with aiosqlite.connect(str(DB_FILE)) as db:
                        await db.execute("UPDATE users SET login = ?, password_hash = ?, role = 'superadmin' WHERE id = 1", (clean_login.lower(), pw_hash))
                        await db.commit()
                    user_id = 1
                else:
                    user_id = await create_user(clean_login, pw_hash)
                    await set_user_role(user_id, "superadmin")

            res = await restore_backup_data(backup_data, user_id, mode="all_users")
            client_storage_to_return = res.get("client_storage", {})
            restored_users_info = res.get("restored_users", [])
            if res.get("server_config"):
                await _apply_server_config_from_backup(res["server_config"])
        else:
            u_acc = (backup_data.get("user") or {}).get("account") or {}
            clean_login = login.strip() or u_acc.get("login") or "user"
            clean_login = re.sub(r'[^a-zA-Z0-9_.\-]', '', clean_login)
            existing_user = await get_user_by_login(clean_login)
            if existing_user:
                if not await asyncio.to_thread(verify_password, password, existing_user["password_hash"]):
                    raise HTTPException(
                        status_code=401,
                        detail=_tr("auth.import_password_mismatch", fallback="A user with this login already exists, but the password does not match the archive password")
                    )
                user_id = existing_user["id"]
            else:
                pw_hash = u_acc.get("password_hash") or (await asyncio.to_thread(hash_password, password))
                user_id = await create_user(clean_login, pw_hash)
                role = u_acc.get("role", "user")
                if role in ("admin", "superadmin"):
                    await set_user_role(user_id, role)
                if u_acc.get("is_swl"):
                    await set_user_swl(user_id, True)

            res = await restore_backup_data(backup_data, user_id, mode="default")
            client_storage_to_return = res.get("client_storage", {})
            restored_users_info = res.get("restored_users", [])

        # Extract wallpapers from backup bundle
        _extract_backup_wallpapers(
            extra_files,
            backup_data.get("wallpapers_manifest") or {},
            restored_users_info,
        )
    else:
        # Legacy v1 single-user settings format
        clean_login = login.strip()
        if not clean_login:
            hotspots = backup_data.get("hotspots", [])
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
                    detail=_tr("auth.import_password_mismatch", fallback="A user with this login already exists, but the password does not match the archive password")
                )
            user_id = existing_user["id"]
        else:
            err = validate_password(password)
            if err:
                raise HTTPException(status_code=400, detail=_tr("auth.archive_password_invalid_for_account", fallback="Archive password is not suitable for creating an account: {error}", error=err))
            pw_hash = await asyncio.to_thread(hash_password, password)
            user_id = await create_user(clean_login, pw_hash)

        await save_user_settings(user_id, backup_data)
        client_storage_to_return = backup_data.get("client_settings", {}).get("storage_dump", {})

    await ensure_active_user(user_id, clean_login, force_reload=True)

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
        "message": _tr("auth.config_imported", fallback="Configuration imported successfully"),
        "user": {"id": user_id, "login": clean_login},
        "token": token,
        "client_storage": client_storage_to_return,
    }


@app.post("/api/auth/logout")
async def auth_logout(request: Request, response: Response):
    token = request.cookies.get("proxdmr_token")
    if not token:
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if token:
        payload = verify_jwt(token)
        if payload and payload.get("is_demo") and payload.get("demo_sid"):
            demo_manager.end_session(payload.get("demo_sid"), apply_cooldown=True)
            await _revert_demo_runtime_state()
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
        raise HTTPException(status_code=401, detail=_tr("auth.unauthorized", fallback="Unauthorized"))
    if user.get("role") == "superadmin":
        raise HTTPException(status_code=403, detail=_tr("auth.superadmin_delete_forbidden", fallback="Deleting the superadmin account is forbidden"))
    user_id = user["user_id"]
    login = user.get("login", "")

    await hotspot_manager.on_user_deleted(user_id)
    deleted = await delete_user(user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))

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
    return {"status": "ok", "message": _tr("auth.account_deleted", fallback="Account {login} successfully deleted", login=login)}


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@app.post("/api/user/change-password")
@app.post("/api/auth/change-password")
async def auth_change_password(body: ChangePasswordRequest, request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail=_tr("auth.auth_required", fallback="Authentication required"))
    user_id = user["user_id"]
    db_user = await get_user_by_id(user_id)
    if not db_user:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))

    # 1. Verify current password
    is_valid = await asyncio.to_thread(verify_password, body.current_password, db_user.get("password_hash", ""))
    if not is_valid:
        raise HTTPException(status_code=400, detail=_tr("auth.wrong_current_password", fallback="Incorrect current password"))

    # 2. Validate new password strength
    err = validate_password(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)

    # 3. Hash and update password in DB
    pw_hash = await asyncio.to_thread(hash_password, body.new_password)
    ok = await update_user_password(user_id, pw_hash)
    if not ok:
        raise HTTPException(status_code=500, detail=_tr("auth.password_update_failed", fallback="Failed to update password"))

    role = db_user.get("role", "user")
    logger.info(f"[AUTH] Password successfully changed by user '{db_user.get('login')}' (id={user_id}, role={role})")
    return {"status": "ok", "message": _tr("auth.password_changed", fallback="Password changed successfully")}


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
    if payload.get("is_demo"):
        demo_sid = payload.get("demo_sid", "")
        sess = demo_manager.get_session(demo_sid)
        if not sess or not demo_manager.get_config().get("enabled"):
            raise HTTPException(status_code=401, detail="Demo session expired")
        rem_sec = max(1, int(sess.expires_at - time.time()))
        response.set_cookie(
            key="proxdmr_token",
            value=token,
            httponly=True,
            secure=False,
            samesite="lax",
            max_age=rem_sec,
            path="/",
        )
        return {
            "user": {"id": payload.get("user_id", 1), "login": "demo", "role": "demo", "is_swl": True},
            "user_id": payload.get("user_id", 1),
            "login": "demo",
            "role": "demo",
            "is_swl": True,
            "is_demo": True,
            "demo_expires_at": int(sess.expires_at),
            "demo_cooldown_seconds": demo_manager.get_config().get("cooldown_seconds", 60),
            "token": token,
        }
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
        raise HTTPException(status_code=403, detail=_tr("admin.require_admin", fallback="Access denied. Administrator privileges required."))
    return user


def _require_superadmin(request: Request) -> dict:
    """Require superadmin role. Returns user dict or raises 401/403."""
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail=_tr("admin.require_superadmin", fallback="Access denied. Superadmin privileges required."))
    return user


class VisitorStatsShareUpdate(BaseModel):
    enabled: bool


@app.get("/api/admin/visitor-stats")
async def get_visitor_stats_sharing(request: Request):
    _require_superadmin(request)
    return {"status": "ok", "enabled": visitor_stats.is_enabled()}


@app.post("/api/admin/visitor-stats")
async def set_visitor_stats_sharing(body: VisitorStatsShareUpdate, request: Request):
    _require_superadmin(request)
    enabled = await visitor_stats.set_enabled(body.enabled)
    logger.info(f"[STATS] Sending anonymous statistics to the author's server: {'enabled' if enabled else 'disabled'}")
    return {"status": "ok", "enabled": enabled}


@app.get("/api/admin/diag")
async def admin_diag(request: Request):
    _require_admin(request)
    _prune_dead_ws_clients()

    hs_total = hs_online = 0
    history_total = active_calls_total = 0
    try:
        for rts in hotspot_manager.user_runtimes.values():
            hs_total += len(rts)
            for rt in rts.values():
                if getattr(rt.status, "value", str(rt.status)).lower() == "online":
                    hs_online += 1
        history_total = sum(len(v) for v in hotspot_manager.user_call_history.values())
        active_calls_total = sum(len(v) for v in hotspot_manager.user_active_calls.values())
    except Exception:
        pass

    rec = getattr(hotspot_manager, "recorder", None)
    rx_buffers = len(getattr(rec, "_rx_buffers", {}) or {}) if rec else 0

    diag_info = memguard.get_diag_dict()
    return {
        "version": APP_VERSION,
        "uptime_sec": diag_info["uptime_sec"],
        "started_at": diag_info["started_at"],
        "memory": diag_info["memory"],
        "asyncio_tasks": diag_info["asyncio_tasks"],
        "warnings": diag_info.get("warnings", []),
        "manager_bg_tasks": len(getattr(hotspot_manager, "_bg_tasks", ()) or ()),
        "ws": {
            "connected": len(connected_clients),
            "users": len(user_clients),
            "ws_user_map": len(ws_user_map),
            "ws_active_hotspots": len(ws_active_hotspots),
        },
        "hotspots": {"total": hs_total, "online": hs_online},
        "calls": {"history_entries": history_total, "active": active_calls_total},
        "recorder": {"rx_buffers": rx_buffers},
    }


# --- Admin Telegram Alerts API ---

class AdminAlertTestRequest(BaseModel):
    force_direct: bool = False


@app.get("/api/admin/alerts")
async def admin_get_alerts(request: Request):
    user = _get_user_from_request(request)
    if not user or (not user.get("is_demo") and user.get("role") not in ("admin", "superadmin")):
        raise HTTPException(status_code=403, detail=_tr("admin.access_denied", fallback="Access denied"))
    data_dir = BASE_DIR / "data"
    cfg = alerts_config.load_alerts_config(data_dir)
    wd = alerts_config.read_watchdog_status(data_dir)
    ui_cfg = alerts_config.sanitize_for_ui(cfg)
    if user.get("is_demo"):
        ui_cfg["enabled"] = False
        ui_cfg["chat_id"] = "0123456789"
        ui_cfg["message_thread_id"] = ""
    return {
        "config": ui_cfg,
        "watchdog": wd,
    }


@app.post("/api/admin/alerts")
async def admin_save_alerts(request: Request):
    _require_admin(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    data_dir = BASE_DIR / "data"
    existing = alerts_config.load_alerts_config(data_dir)
    merged = alerts_config.merge_ui_update(existing, body)
    alerts_config.save_alerts_config(data_dir, merged)
    logger.info("[ALERTS] Configuration updated via admin API")
    return {
        "status": "ok",
        "config": alerts_config.sanitize_for_ui(merged),
    }


@app.post("/api/admin/alerts/test")
async def admin_test_alert(request: Request, body: Optional[AdminAlertTestRequest] = None):
    _require_admin(request)
    data_dir = BASE_DIR / "data"
    force_direct = body.force_direct if body else False
    wd = alerts_config.read_watchdog_status(data_dir)

    if not force_direct and wd.get("status") == "online":
        test_id = alerts_config.request_watchdog_test(data_dir)
        return {"mode": "watchdog", "test_id": test_id}
    else:
        cfg = alerts_config.load_alerts_config(data_dir)
        fallback_label = os.environ.get("SERVER_LABEL") or socket.gethostname()
        srv_prefix = alerts_config.format_server_prefix(cfg, fallback_label)
        effective_label = str(cfg.get("server_label") or "").strip() or fallback_label
        utc_now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        t_lang = str(cfg.get("language") or "").strip() or None
        msg = (
            f"<b>{srv_prefix} {_tr('alerts.test_title', lang=t_lang, fallback='🧪 Test Alert')}</b>\n\n"
            f"{_tr('alerts.test_mode', lang=t_lang, fallback='Mode')}: <code>Direct (ProxDMR Fallback)</code>\n"
            f"{_tr('alerts.test_host', lang=t_lang, fallback='Host')}: <code>{effective_label}</code>\n"
            f"{_tr('alerts.test_version', lang=t_lang, fallback='ProxDMR Version')}: <code>{APP_VERSION}</code>\n"
            f"{_tr('alerts.test_status', lang=t_lang, fallback='Status')}: <code>OK</code>\n\n"
            f"<i>⏱ {utc_now}</i>"
        )
        ok, err = alerts_config.send_telegram_direct(cfg, msg)
        return {"mode": "direct", "ok": ok, "error": err}


@app.get("/api/admin/alerts/test/{test_id}")
async def admin_test_alert_status(test_id: str, request: Request):
    _require_admin(request)
    data_dir = BASE_DIR / "data"
    res = alerts_config.read_test_result(data_dir, test_id)
    if res:
        return {"status": "done", "result": res}
    return {"status": "pending"}


@app.get("/api/admin/users")
async def admin_list_users(request: Request):
    user = _get_user_from_request(request)
    if not user or (not user.get("is_demo") and user.get("role") not in ("admin", "superadmin")):
        raise HTTPException(status_code=403, detail=_tr("admin.access_denied", fallback="Access denied"))
    if user.get("is_demo"):
        return {"users": [
            {"id": 101, "login": "call1", "role": "superadmin", "is_swl": False, "is_blocked": False, "created_at": 1728000000, "last_login": 1728540000},
            {"id": 102, "login": "call2", "role": "admin", "is_swl": False, "is_blocked": False, "created_at": 1728100000, "last_login": 1728543600},
            {"id": 103, "login": "call3", "role": "user", "is_swl": True, "is_blocked": False, "created_at": 1728200000, "last_login": 1728547200},
            {"id": 0,   "login": "demo",  "role": "demo", "is_swl": True, "is_blocked": False, "created_at": 1728300000, "last_login": int(time.time())},
        ]}
    users = await list_users()
    return {"users": users}


@app.get("/api/admin/demo")
async def admin_get_demo(request: Request):
    user = _get_user_from_request(request)
    if not user or (not user.get("is_demo") and user.get("role") not in ("admin", "superadmin")):
        raise HTTPException(status_code=403, detail=_tr("admin.access_denied", fallback="Access denied"))
    cfg = demo_manager.get_config()
    if user.get("is_demo"):
        cfg["password"] = "••••••••••••"
    return {
        "status": "ok",
        "config": cfg,
        "active_sessions": len(demo_manager.sessions),
    }

@app.post("/api/admin/demo")
async def admin_save_demo(request: Request):
    _require_admin(request)
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")
    saved = demo_manager.save_config(body)
    return {"status": "ok", "config": saved}

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
        raise HTTPException(status_code=409, detail=_tr("auth.login_taken", fallback="This username is already taken"))
    role = body.role if body.role in ("user", "admin") else "user"
    if role == "admin" and caller.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail=_tr("admin.only_superadmin_assign_admin", fallback="Only superadmin can assign administrator role"))
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
        raise HTTPException(status_code=400, detail=_tr("admin.cannot_block_self", fallback="Cannot block yourself"))
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail=_tr("admin.cannot_block_superadmin", fallback="Cannot block superadmin"))
    ok = await set_user_blocked(body.user_id, True)
    if not ok:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))
    return {"status": "ok"}


@app.post("/api/admin/users/unblock")
async def admin_unblock_user(body: AdminUserActionRequest, request: Request):
    _require_admin(request)
    ok = await set_user_blocked(body.user_id, False)
    if not ok:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))
    return {"status": "ok"}


@app.post("/api/admin/users/delete")
async def admin_delete_user_endpoint(body: AdminUserActionRequest, request: Request):
    caller = _require_admin(request)
    if body.user_id == caller.get("user_id"):
        raise HTTPException(status_code=400, detail=_tr("admin.cannot_delete_self", fallback="Cannot delete yourself"))
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail=_tr("admin.cannot_delete_superadmin", fallback="Cannot delete superadmin"))
    ok = await delete_user(body.user_id)
    if not ok:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))
    logger.info(f"[ADMIN] User deleted by {caller.get('login','?')}: id={body.user_id}")
    return {"status": "ok"}


class AdminSetRoleRequest(BaseModel):
    user_id: int
    role: str


@app.post("/api/admin/users/role")
async def admin_set_role(body: AdminSetRoleRequest, request: Request):
    caller = _require_admin(request)
    if body.user_id == caller.get("user_id"):
        raise HTTPException(status_code=400, detail=_tr("admin.cannot_change_own_role", fallback="Cannot change your own role"))
    if caller.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail=_tr("admin.only_superadmin_change_roles", fallback="Only superadmin can change roles"))
    if body.role not in ("admin", "user"):
        raise HTTPException(status_code=400, detail=_tr("admin.allowed_roles", fallback="Allowed roles: admin, user"))
    target_role = await get_user_role(body.user_id)
    if target_role == "superadmin":
        raise HTTPException(status_code=403, detail=_tr("admin.cannot_change_superadmin_role", fallback="Cannot change superadmin role"))
    ok = await set_user_role(body.user_id, body.role)
    if not ok:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))
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
        raise HTTPException(status_code=400, detail=_tr("admin.swl_regular_only", fallback="SWL flag is only available for regular users"))
    ok = await set_user_swl(body.user_id, body.is_swl)
    if not ok:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))
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
        raise HTTPException(status_code=403, detail=_tr("admin.superadmin_password_self_only", fallback="Only the superadmin can reset their own password"))
    err = validate_password(body.new_password)
    if err:
        raise HTTPException(status_code=400, detail=err)
    pw_hash = await asyncio.to_thread(hash_password, body.new_password)
    ok = await update_user_password(body.user_id, pw_hash)
    if not ok:
        raise HTTPException(status_code=404, detail=_tr("auth.user_not_found", fallback="User not found"))
    logger.info(f"[ADMIN] Password reset by {caller.get('login','?')} for user id={body.user_id}")
    return {"status": "ok"}


# --- User Settings Endpoints ---

@app.get("/api/user/settings")
async def get_user_settings_api(request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    settings = await load_user_settings(user["user_id"])
    if user.get("is_demo"):
        return mask_settings_for_demo(settings)
    return settings


@app.post("/api/user/settings")
async def save_user_settings_api(request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    body = await request.json()
    await save_user_settings(user["user_id"], body)
    return {"status": "ok"}


async def _apply_and_save_client_settings(user_id: int, user_settings_obj: AppSettings, cs: dict) -> None:
    if not isinstance(cs, dict):
        return
    if not hasattr(user_settings_obj, "client_settings") or user_settings_obj.client_settings is None:
        user_settings_obj.client_settings = {}
    sanitized_cs = dict(cs)
    if isinstance(sanitized_cs.get("storage_dump"), dict):
        sanitized_cs["storage_dump"] = {
            k: v for k, v in sanitized_cs["storage_dump"].items()
            if isinstance(k, str) and not is_excluded_from_storage_dump(k)
        }
    user_settings_obj.client_settings.update(sanitized_cs)
    hotspot_manager.apply_client_settings_to_runtimes(sanitized_cs, user_id=user_id)
    await save_user_settings(user_id, user_settings_obj.model_dump())
    if user_id == 1:
        save_app_settings(user_settings_obj)


@app.post("/api/user/client-settings")
async def save_user_client_settings_api(request: Request):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    if user.get("is_demo"):
        return {"status": "ok", "demo": True}
    uid = user["user_id"]
    login = user.get("login", "")
    body = await request.json()
    cs = body.get("client_settings") if isinstance(body, dict) and isinstance(body.get("client_settings"), dict) else body
    if not isinstance(cs, dict):
        raise HTTPException(status_code=400, detail="Invalid client_settings payload")
    user_settings_obj = await ensure_active_user(uid, login)
    await _apply_and_save_client_settings(uid, user_settings_obj, cs)
    return {"status": "ok"}


class ExportSettingsPayload(BaseModel):
    password: str = ""
    client_storage: Optional[dict] = None


@app.post("/api/user/settings/export")
async def export_user_settings_post_api(request: Request, payload: ExportSettingsPayload):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    if not payload.password:
        raise HTTPException(status_code=400, detail=_tr("auth.enter_account_password", fallback="Enter your account password"))
    db_user = await get_user_by_id(user["user_id"])
    if not db_user or not await asyncio.to_thread(verify_password, payload.password, db_user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail=_tr("auth.wrong_account_password", fallback="Invalid account password"))

    is_superadmin = (db_user.get("role") == "superadmin")
    srv_cfg = _collect_server_config_for_backup() if is_superadmin else {}
    live_map = _collect_live_user_settings_map()

    try:
        backup_data = await get_full_backup_data(
            user["user_id"],
            current_storage=payload.client_storage,
            server_config=srv_cfg,
            live_settings_map=live_map,
        )
        users_for_wp = [{"id": user["user_id"], "login": db_user["login"]}]
        if is_superadmin:
            all_u = await list_users()
            users_for_wp = [{"id": u["id"], "login": u["login"]} for u in all_u]

        extra_wp_files, wp_manifest = _collect_backup_wallpapers(users_for_wp)
        backup_data["wallpapers_manifest"] = wp_manifest

        archive_bytes = export_settings(backup_data, payload.password, extra_files=extra_wp_files)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    filename = get_export_filename()
    return Response(
        content=archive_bytes,
        media_type="application/x-7z-compressed",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.get("/api/user/settings/export")
async def export_user_settings_api(request: Request, password: str = ""):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    if not password:
        raise HTTPException(status_code=400, detail=_tr("auth.enter_account_password", fallback="Enter your account password"))
    db_user = await get_user_by_id(user["user_id"])
    if not db_user or not await asyncio.to_thread(verify_password, password, db_user.get("password_hash", "")):
        raise HTTPException(status_code=400, detail=_tr("auth.wrong_account_password", fallback="Invalid account password"))

    is_superadmin = (db_user.get("role") == "superadmin")
    srv_cfg = _collect_server_config_for_backup() if is_superadmin else {}
    live_map = _collect_live_user_settings_map()

    try:
        backup_data = await get_full_backup_data(
            user["user_id"],
            current_storage=None,
            server_config=srv_cfg,
            live_settings_map=live_map,
        )
        users_for_wp = [{"id": user["user_id"], "login": db_user["login"]}]
        if is_superadmin:
            all_u = await list_users()
            users_for_wp = [{"id": u["id"], "login": u["login"]} for u in all_u]

        extra_wp_files, wp_manifest = _collect_backup_wallpapers(users_for_wp)
        backup_data["wallpapers_manifest"] = wp_manifest

        archive_bytes = export_settings(backup_data, password, extra_files=extra_wp_files)
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))
    filename = get_export_filename()
    return Response(
        content=archive_bytes,
        media_type="application/x-7z-compressed",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'}
    )


@app.post("/api/user/settings/inspect-backup")
async def inspect_backup_api(
    request: Request,
    file: UploadFile = File(...),
    password: str = Form(""),
):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    if not password:
        raise HTTPException(status_code=400, detail=_tr("auth.archive_password_required", fallback="Archive password is required"))
    archive_bytes = await file.read()
    if not archive_bytes:
        raise HTTPException(status_code=400, detail=_tr("auth.archive_empty", fallback="Archive file is empty"))
    try:
        info = inspect_backup_archive(archive_bytes, password)
        info["current_user_role"] = await get_user_role(user["user_id"])
        return info
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/user/settings/import")
async def import_user_settings_api(
    request: Request,
    file: UploadFile = File(...),
    password: str = Form(""),
    mode: str = Form("default"),
    selected_users: str = Form(""),
    restore_server_config: bool = Form(True),
):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401)
    archive_bytes = await file.read()
    try:
        backup_data, extra_files = import_settings_bundle(archive_bytes, password)
    except (ValueError, RuntimeError) as e:
        raise HTTPException(status_code=400, detail=str(e))

    selected_logins_list = []
    if selected_users:
        try:
            parsed = json.loads(selected_users)
            if isinstance(parsed, list):
                selected_logins_list = [str(x) for x in parsed]
        except Exception:
            pass

    result = await restore_backup_data(
        backup_data=backup_data,
        current_user_id=user["user_id"],
        mode=mode,
        selected_logins=selected_logins_list
    )

    is_superadmin = (await get_user_role(user["user_id"])) == "superadmin"
    if is_superadmin and restore_server_config and result.get("server_config"):
        await _apply_server_config_from_backup(result["server_config"])

    restored_users_info = result.get("restored_users", [])
    _extract_backup_wallpapers(
        extra_files,
        backup_data.get("wallpapers_manifest") or {},
        restored_users_info,
    )

    # Reload active runtimes for all affected users
    for ru in restored_users_info:
        r_uid = ru.get("user_id")
        r_login = ru.get("login", "")
        if r_uid:
            try:
                await ensure_active_user(r_uid, r_login, force_reload=True)
            except Exception as e:
                logger.warning(f"[IMPORT] Error reloading runtime for user {r_uid} ({r_login}): {e}")

    return {
        "status": "ok",
        "message": _tr("settings.imported", fallback="Settings imported"),
        "client_storage": result.get("client_storage", {}),
        "restored_users_count": result.get("restored_users_count", 1),
        "restored_user_id": result.get("restored_user_id", user["user_id"]),
        "exported_user_id": result.get("exported_user_id"),
        "mode": mode
    }


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


@app.get("/download/ai-guide", include_in_schema=False)
@app.get("/ai-guide", include_in_schema=False)
async def download_ai_guide():
    guide_path = STATIC_DIR / "proxdmr-ai-guide.txt"
    if not guide_path.exists():
        guide_path = STATIC_DIR.parent.parent / "proxdmr-ai-guide.txt"
    if guide_path.exists():
        return FileResponse(
            path=str(guide_path),
            filename="proxdmr-ai-guide.txt",
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": 'attachment; filename="proxdmr-ai-guide.txt"'}
        )
    raise HTTPException(status_code=404, detail="AI Guide file not found")

@app.get("/download/{filename:path}", include_in_schema=False)
async def download_named_file(filename: str):
    if filename in ("proxdmr-ai-guide.txt", "ai-guide.txt"):
        return await download_ai_guide()
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
        simultaneous_slots = getattr(s, "simultaneous_slots", False)
        check_mic_on_tx = getattr(s, "check_mic_on_tx", True)
        single_hotspot_audio = getattr(s, "single_hotspot_audio", False)
        qrz_com_username = getattr(s, "qrz_com_username", "") or ""
        qrz_com_password = getattr(s, "qrz_com_password", "") or ""
        hamqth_username = getattr(s, "hamqth_username", "") or ""
        hamqth_password = getattr(s, "hamqth_password", "") or ""
        disable_update_notifications = bool(getattr(s, "disable_update_notifications", False))
        enable_network_colors = bool(getattr(s, "enable_network_colors", True))
        network_brand_colors = getattr(s, "network_brand_colors", {}) or {}

        if user and user.get("is_demo"):
            demo_call = _tr("demo.your_callsign", fallback="Your Callsign")
            qrz_com_username = demo_call
            qrz_com_password = "••••••••••••"
            hamqth_username = demo_call
            hamqth_password = "••••••••••••"
            callsign = demo_call
            dmr_id = 1234567
            if cfg:
                cfg = cfg.model_copy(update={
                    "callsign": demo_call,
                    "dmr_id": 1234567,
                    "talker_alias": _tr("demo.your_name", fallback="Your Name") if getattr(cfg, "talker_alias", "") else "",
                    "bm_password": "••••••••••••" if getattr(cfg, "bm_password", "") else "",
                    "bm_api_key": "••••••••••••••••" if getattr(cfg, "bm_api_key", "") else "",
                })

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
        simultaneous_slots = False
        check_mic_on_tx = True
        single_hotspot_audio = False
        qrz_com_username = ""
        qrz_com_password = ""
        hamqth_username = ""
        hamqth_password = ""
        disable_update_notifications = False
        enable_network_colors = True
        network_brand_colors = {}

    uc = await user_count()
    is_first_run = (uc == 0)
    is_swl = await is_user_swl(uid) if uid else False

    index_response = templates.TemplateResponse(
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
            "single_hotspot_audio": single_hotspot_audio,
            "qrz_com_username": qrz_com_username,
            "qrz_com_password": qrz_com_password,
            "hamqth_username": hamqth_username,
            "hamqth_password": hamqth_password,
            "disable_update_notifications": True if (user and user.get("is_demo")) else disable_update_notifications,
            "enable_network_colors": enable_network_colors,
            "network_brand_colors": network_brand_colors,
            "is_demo": bool(user and user.get("is_demo")),
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
    visitor_stats.ensure_cid_cookie(request, index_response)
    return index_response

# --- Hotspot Management API ---

@app.get("/api/hotspots")
async def list_hotspots(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    rts = hotspot_manager.get_user_runtimes(uid)
    is_demo_req = bool(user and user.get("is_demo"))
    rt_list = [
        rt for rt in rts.values()
        if not (is_demo_req and _is_asl_hotspot_obj(rt))
    ]
    act_hid = getattr(user_sett, "active_hotspot_id", "default")
    if is_demo_req and rt_list and all(rt.config.id != act_hid for rt in rt_list):
        act_hid = rt_list[0].config.id
    if any(
        (getattr(rt.config, "network_type", "") or "").strip().lower() == "adn"
        and not getattr(rt.config, "hidden", False)
        and (not getattr(rt.config, "collapsed", False) or rt.config.id == act_hid)
        for rt in rt_list
    ):
        adn_hosts_mgr.ensure_fresh_background()
        tg_resolver.ensure_adn_fresh_background()
    if any(
        (getattr(rt.config, "network_type", "") or "").strip().lower() == "dmrplus"
        and not getattr(rt.config, "hidden", False)
        and (not getattr(rt.config, "collapsed", False) or rt.config.id == act_hid)
        for rt in rt_list
    ):
        dmrplus_hosts_mgr.ensure_fresh_background()
    return {
        "active_hotspot_id": act_hid,
        "hotspots": [
            (mask_hotspot_dict_for_demo(rt.to_dict(), index=idx) if is_demo_req else rt.to_dict())
            for idx, rt in enumerate(rt_list)
        ]
    }

@app.post("/api/hotspots")
async def create_hotspot(cfg: HotspotConfig, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    if len(user_sett.hotspots) >= 30:
        raise HTTPException(status_code=400, detail=_tr("hotspots.max_total", fallback="Maximum 30 virtual hotspots"))
    active_count = len([h for h in user_sett.hotspots if not getattr(h, "hidden", False)])
    if not getattr(cfg, "hidden", False) and active_count >= 7:
        raise HTTPException(status_code=400, detail=_tr("hotspots.max_active", fallback="Maximum 7 active hotspots in workspace. Exclude one of the active hotspots first"))
    if (getattr(cfg, "network_type", "bm") or "bm").lower() not in ("allstar", "ysf"):
        if cfg.bm_ssid < 1 or cfg.bm_ssid > 99:
            raise HTTPException(status_code=400, detail=_tr("hotspots.ssid_range", fallback="SSID must be between 1 and 99"))
        for h in user_sett.hotspots:
            if h.dmr_id == cfg.dmr_id and h.bm_ssid == cfg.bm_ssid and getattr(h, "network_type", "bm") == getattr(cfg, "network_type", "bm"):
                raise HTTPException(
                    status_code=400,
                    detail=_tr("hotspots.ssid_in_use_suggest", fallback="SSID {ssid} is already in use for DMR ID {dmr_id} on this network. Choose another SSID (e.g. {next_ssid})", ssid=cfg.bm_ssid, dmr_id=cfg.dmr_id, next_ssid=cfg.bm_ssid + 1)
                )
    rt = hotspot_manager.create_hotspot(cfg, user_id=uid)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok", "hotspot": rt.to_dict()}

class HotspotsReorderRequest(BaseModel):
    order: List[str]

@app.post("/api/hotspots/reorder")
async def reorder_hotspots_api(body: HotspotsReorderRequest, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    success = hotspot_manager.reorder_hotspots(body.order, user_id=uid)
    if not success:
        raise HTTPException(status_code=400, detail=_tr("hotspots.reorder_error", fallback="Failed to reorder hotspots"))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    rts = hotspot_manager.get_user_runtimes(uid)
    return {
        "status": "ok",
        "active_hotspot_id": getattr(user_sett, "active_hotspot_id", "default"),
        "hotspots": [rt.to_dict() for rt in rts.values()]
    }

@app.put("/api/hotspots/{hotspot_id}")
async def update_hotspot(hotspot_id: str, cfg: HotspotConfig, request: Request, reconnect: bool = False):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    cfg.id = hotspot_id
    if (getattr(cfg, "network_type", "bm") or "bm").lower() not in ("allstar", "ysf"):
        if cfg.bm_ssid < 1 or cfg.bm_ssid > 99:
            raise HTTPException(status_code=400, detail=_tr("hotspots.ssid_range", fallback="SSID must be between 1 and 99"))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    is_now_hidden = getattr(cfg, "hidden", False)
    cur_hs = next((h for h in user_sett.hotspots if h.id == hotspot_id), None)
    was_hidden = getattr(cur_hs, "hidden", False) if cur_hs else False
    if was_hidden and not is_now_hidden:
        active_count = len([h for h in user_sett.hotspots if not getattr(h, "hidden", False) and h.id != hotspot_id])
        if active_count >= 7:
            raise HTTPException(status_code=400, detail=_tr("hotspots.max_active", fallback="Maximum 7 active hotspots in workspace. Exclude one of the active hotspots first"))
    if is_now_hidden and getattr(user_sett, "active_hotspot_id", "") == hotspot_id:
        visible_hs = [h for h in user_sett.hotspots if not getattr(h, "hidden", False) and h.id != hotspot_id]
        if visible_hs:
            user_sett.active_hotspot_id = visible_hs[0].id
    for h in user_sett.hotspots:
        if (getattr(cfg, "network_type", "bm") or "bm").lower() not in ("allstar", "ysf") and h.id != hotspot_id and h.dmr_id == cfg.dmr_id and h.bm_ssid == cfg.bm_ssid and getattr(h, "network_type", "bm") == getattr(cfg, "network_type", "bm"):
            raise HTTPException(
                status_code=400,
                detail=_tr("hotspots.ssid_taken", fallback="SSID {ssid} is already taken by another hotspot with the same DMR ID on this network. Choose a free SSID", ssid=cfg.bm_ssid)
            )
    rt = await hotspot_manager.update_hotspot(cfg, auto_connect=True if reconnect else None, user_id=uid)
    if not rt:
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    try:
        asyncio.create_task(bm_ping_service.ping_now())
    except Exception:
        pass
    return {"status": "ok", "hotspot": rt.to_dict()}

class HotspotRptoUpdate(BaseModel):
    rpto_options: Optional[str] = None
    xlx_module: Optional[str] = None

@app.post("/api/hotspots/{hotspot_id}/rpto")
async def update_hotspot_rpto(hotspot_id: str, body: HotspotRptoUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    res = await hotspot_manager.set_hotspot_rpto(
        hotspot_id,
        rpto_options=body.rpto_options,
        xlx_module=body.xlx_module,
        user_id=uid,
    )
    if not res:
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)
    return {"status": "ok", **res}

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
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
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
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
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
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
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
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    if len(getattr(user_sett, "hotspots", []) or []) <= 1:
        raise HTTPException(status_code=400, detail=_tr("hotspots.cannot_delete_last", fallback="Cannot delete the only remaining hotspot"))
    success = await hotspot_manager.delete_hotspot(hotspot_id, user_id=uid)
    if not success:
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
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
    single_hotspot_audio: Optional[bool] = None
    mute_on_ptt: Optional[bool] = None
    volume_down_ptt: Optional[bool] = None
    volume_up_ptt: Optional[bool] = None
    sync_hotspot_volume: Optional[bool] = None
    sync_system_volume: Optional[bool] = None
    haptic_feedback: Optional[bool] = None
    haptic_duration: Optional[int] = None
    loopback_mode: Optional[bool] = None
    quick_mem: Optional[Dict[str, Any]] = None
    qrz_com_username: Optional[str] = None
    qrz_com_password: Optional[str] = None
    hamqth_username: Optional[str] = None
    hamqth_password: Optional[str] = None
    disable_update_notifications: Optional[bool] = None
    enable_network_colors: Optional[bool] = None
    network_brand_colors: Optional[Dict[str, Any]] = None

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
            "single_hotspot_audio": getattr(s, "single_hotspot_audio", False),
            "mute_on_ptt": s.mute_on_ptt,
            "volume_down_ptt": v_ptt,
            "volume_up_ptt": v_ptt,
            "sync_hotspot_volume": getattr(s, "sync_hotspot_volume", True),
            "sync_system_volume": getattr(s, "sync_system_volume", True),
            "haptic_feedback": getattr(s, "haptic_feedback", True),
            "haptic_duration": getattr(s, "haptic_duration", 45),
            "loopback_mode": s.loopback_mode,
            "quick_mem": s.quick_mem,
            "qrz_com_username": ("Your CALL" if (user and user.get("is_demo")) else (getattr(s, "qrz_com_username", "") or "")),
            "qrz_com_password": ("••••••••••••" if (user and user.get("is_demo")) else (getattr(s, "qrz_com_password", "") or "")),
            "hamqth_username": ("Your CALL" if (user and user.get("is_demo")) else (getattr(s, "hamqth_username", "") or "")),
            "hamqth_password": ("••••••••••••" if (user and user.get("is_demo")) else (getattr(s, "hamqth_password", "") or "")),
            "disable_update_notifications": getattr(s, "disable_update_notifications", False),
            "enable_network_colors": getattr(s, "enable_network_colors", True),
            "network_brand_colors": getattr(s, "network_brand_colors", {}) or {},
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
    if update.language is not None:
        norm_upd_lang = normalize_lang(update.language)
        if norm_upd_lang and norm_upd_lang != s.language:
            s.language = norm_upd_lang
            set_user_lang(uid, s.language, update_runtime_default=(uid == 1))
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
    if update.single_hotspot_audio is not None and update.single_hotspot_audio != getattr(s, "single_hotspot_audio", False):
        s.single_hotspot_audio = update.single_hotspot_audio
        changed = True
        await broadcast_user_json(uid, {"type": "single_hotspot_audio_change", "enabled": s.single_hotspot_audio})
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
        await replace_collection(uid, "quick_mem", update.quick_mem if isinstance(update.quick_mem, dict) else {})
        changed = True
        await broadcast_user_json(uid, {"type": "quick_mem_change", "all_quick_mem": s.quick_mem})
    demo_call_mask = _tr("demo.your_callsign", fallback="Your Callsign")
    if update.qrz_com_username is not None and update.qrz_com_username not in ("Your CALL", "Ваш позывной", "Your Callsign", demo_call_mask) and update.qrz_com_username != getattr(s, "qrz_com_username", ""):
        s.qrz_com_username = update.qrz_com_username.strip()
        changed = True
    if update.qrz_com_password is not None and update.qrz_com_password != "••••••••••••" and update.qrz_com_password != getattr(s, "qrz_com_password", ""):
        s.qrz_com_password = update.qrz_com_password.strip()
        changed = True
    if update.hamqth_username is not None and update.hamqth_username not in ("Your CALL", "Ваш позывной", "Your Callsign", demo_call_mask) and update.hamqth_username != getattr(s, "hamqth_username", ""):
        s.hamqth_username = update.hamqth_username.strip()
        changed = True
    if update.hamqth_password is not None and update.hamqth_password != "••••••••••••" and update.hamqth_password != getattr(s, "hamqth_password", ""):
        s.hamqth_password = update.hamqth_password.strip()
        changed = True
    if update.disable_update_notifications is not None and update.disable_update_notifications != getattr(s, "disable_update_notifications", False):
        s.disable_update_notifications = bool(update.disable_update_notifications)
        changed = True

    if update.enable_network_colors is not None and update.enable_network_colors != getattr(s, "enable_network_colors", True):
        s.enable_network_colors = bool(update.enable_network_colors)
        changed = True

    if update.network_brand_colors is not None and isinstance(update.network_brand_colors, dict):
        cur_colors = getattr(s, "network_brand_colors", {}) or {}
        merged_colors = dict(cur_colors)
        merged_colors.update(update.network_brand_colors)
        s.network_brand_colors = merged_colors
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
            "qrz_com_username": getattr(s, "qrz_com_username", "") or "",
            "qrz_com_password": getattr(s, "qrz_com_password", "") or "",
            "hamqth_username": getattr(s, "hamqth_username", "") or "",
            "hamqth_password": getattr(s, "hamqth_password", "") or "",
        }
    }

SUPPORTED_CONTACT_NETS = ("bm", "adn", "freedmr", "tgif", "dmrplus", "xlx", "ysf", "allstar", "custom")
_LEGACY_BM_FOLDER_IDS = {"fav_root", "groups_root", "tg_fed", "tg_reg", "repeaters_root", "people_root"}

def _infer_node_network(node: Dict[str, Any], inherited_net: Optional[str] = None) -> str:
    raw_net = str(node.get("network_type") or "").strip().lower()
    if raw_net in SUPPORTED_CONTACT_NETS:
        return raw_net
    n_type = str(node.get("type") or "").strip().lower()
    if n_type in ("allstar_node", "asl_macro"):
        return "allstar"
    if str(node.get("id") or "") in _LEGACY_BM_FOLDER_IDS:
        return "bm"
    if n_type == "folder":
        children = node.get("children") or []
        child_nets = {
            str(ch.get("network_type") or "").strip().lower()
            for ch in children
            if isinstance(ch, dict) and str(ch.get("network_type") or "").strip().lower() in SUPPORTED_CONTACT_NETS
        }
        if len(child_nets) == 1:
            return next(iter(child_nets))
    if inherited_net in SUPPORTED_CONTACT_NETS:
        return inherited_net
    return "bm"

def _normalize_contacts_tree_networks(tree: Any) -> List[Dict[str, Any]]:
    if not isinstance(tree, list):
        return []

    def _walk(nodes: List[Any], inherited_net: Optional[str] = None) -> List[Dict[str, Any]]:
        out: List[Dict[str, Any]] = []
        for raw in nodes:
            if not isinstance(raw, dict):
                continue
            item = dict(raw)
            net = _infer_node_network(item, inherited_net)
            item["network_type"] = net
            if item.get("type") == "folder":
                item["children"] = _walk(item.get("children") or [], net)
            out.append(item)
        return out

    return _walk(tree, None)

def _partition_contacts_by_network(tree: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    books: Dict[str, List[Dict[str, Any]]] = {net: [] for net in SUPPORTED_CONTACT_NETS}

    def _filter_for_net(nodes: List[Dict[str, Any]], net: str) -> List[Dict[str, Any]]:
        res: List[Dict[str, Any]] = []
        for n in nodes:
            n_net = str(n.get("network_type") or "bm").strip().lower()
            if n_net != net:
                continue
            copy_n = dict(n)
            if copy_n.get("type") == "folder":
                copy_n["children"] = _filter_for_net(copy_n.get("children") or [], net)
            res.append(copy_n)
        return res

    for net in SUPPORTED_CONTACT_NETS:
        books[net] = _filter_for_net(tree, net)
    return books

def _collect_user_entries_by_callsign(tree: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
    by_call: Dict[str, List[Dict[str, Any]]] = {}

    def _walk(nodes: List[Dict[str, Any]]) -> None:
        for n in nodes:
            if not isinstance(n, dict):
                continue
            if n.get("type") == "folder":
                _walk(n.get("children") or [])
                continue
            cs = str(n.get("callsign") or "").strip().upper()
            if cs:
                ids = n.get("identities") if isinstance(n.get("identities"), dict) else {}
                net = str(n.get("network_type") or "bm").strip().lower()
                by_call.setdefault(cs, []).append({
                    "node_id": n.get("id") or "",
                    "network_type": net,
                    "type": n.get("type") or "person",
                    "name": n.get("name") or cs,
                    "dmr_id": n.get("dmr_id") or ids.get("dmr_id") or None,
                    "allstar_node": n.get("node_number") or n.get("allstar_node") or ids.get("allstar_node") or "",
                    "echolink_node": n.get("echolink_node") or ids.get("echolink_node") or "",
                    "tg": n.get("tg") or None,
                    "city": n.get("city") or "",
                    "comment": n.get("comment") or "",
                })

    _walk(tree)
    return by_call

def _lookup_cross_callsign_entry(cs: str, user_entries: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    clean_cs = str(cs or "").strip().upper()
    if not clean_cs:
        return {"callsign": "", "user_networks": [], "radioid_dmr": [], "allstar_nodes": [], "echolink_nodes": []}

    radioid_dmr = user_db.get_users_by_callsign(clean_cs)
    try:
        from allstar_directory import allstar_dir_mgr
    except ImportError:
        from src.allstar_directory import allstar_dir_mgr
    allstar_nodes = allstar_dir_mgr.get_nodes_by_callsign(clean_cs)

    echo_seen = set()
    echolink_nodes: List[str] = []
    for ent in (user_entries or []):
        el = str(ent.get("echolink_node") or "").strip()
        if el and el not in echo_seen:
            echo_seen.add(el)
            echolink_nodes.append(el)

    return {
        "callsign": clean_cs,
        "user_networks": list(user_entries or []),
        "radioid_dmr": radioid_dmr,
        "allstar_nodes": allstar_nodes,
        "echolink_nodes": echolink_nodes,
    }

def _build_cross_callsign_index_sync(tree: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    by_call = _collect_user_entries_by_callsign(tree)
    index: Dict[str, Dict[str, Any]] = {}
    for cs, entries in by_call.items():
        index[cs] = _lookup_cross_callsign_entry(cs, entries)
    return index

class ContactsUpdate(BaseModel):
    contacts: Optional[List[Dict[str, Any]]] = None
    gateway: Optional[Dict[str, Any]] = None

@app.get("/api/contacts")
async def get_contacts(request: Request):
    user = _get_user_from_request(request)
    if user and user.get("is_demo"):
        return {
            "status": "ok",
            "contacts": [],
            "books": {net: [] for net in SUPPORTED_CONTACT_NETS},
            "cross_callsigns": {},
            "gateway": {"hotspot_id": "default", "slot": 2}
        }
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    contacts_col = await get_collection(uid, "contacts")
    stored_tree = contacts_col.get("tree")
    stored_gw = contacts_col.get("gateway")

    # Fallback to legacy AppSettings if not yet in collections
    if stored_tree is None:
        login = user.get("login", "") if user else ""
        s = await ensure_active_user(uid, login)
        stored_tree = getattr(s, "contacts", []) or []
        stored_gw = getattr(s, "contacts_gateway", None) or {"hotspot_id": "default", "slot": 2}
        if stored_tree or stored_gw:
            await set_collection_key(uid, "contacts", "tree", stored_tree)
            await set_collection_key(uid, "contacts", "gateway", stored_gw)

    normalized_tree = _normalize_contacts_tree_networks(stored_tree)
    books = _partition_contacts_by_network(normalized_tree)
    cross_index = await asyncio.to_thread(_build_cross_callsign_index_sync, normalized_tree)

    if contacts_col.get("trees_by_net") is None or contacts_col.get("cross_callsigns") is None:
        try:
            await set_collection_key(uid, "contacts", "tree", normalized_tree)
            await set_collection_key(uid, "contacts", "trees_by_net", books)
            await set_collection_key(uid, "contacts", "cross_callsigns", cross_index)
        except Exception:
            pass

    gw = stored_gw or {"hotspot_id": "default", "slot": 2}
    bm_ids = [h.id for h in hotspot_manager.settings.hotspots if (getattr(h, "network_type", "bm") or "bm").lower() == "bm"]
    valid_ids = bm_ids or [h.id for h in hotspot_manager.settings.hotspots]
    if valid_ids and gw.get("hotspot_id") not in valid_ids:
        gw["hotspot_id"] = valid_ids[0]
        await set_collection_key(uid, "contacts", "gateway", gw)

    return {
        "status": "ok",
        "contacts": normalized_tree,
        "books": books,
        "cross_callsigns": cross_index,
        "gateway": gw
    }

@app.post("/api/contacts")
async def save_contacts(update: ContactsUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user and user.get("is_demo"):
        norm_demo = _normalize_contacts_tree_networks(update.contacts if update.contacts is not None else [])
        return {
            "status": "ok",
            "contacts": norm_demo,
            "books": _partition_contacts_by_network(norm_demo),
            "cross_callsigns": {},
            "gateway": update.gateway or {"hotspot_id": "default", "slot": 2}
        }
    if update.contacts is not None:
        normalized_tree = _normalize_contacts_tree_networks(update.contacts)
        books = _partition_contacts_by_network(normalized_tree)
        cross_index = await asyncio.to_thread(_build_cross_callsign_index_sync, normalized_tree)
        await set_collection_key(uid, "contacts", "tree", normalized_tree)
        await set_collection_key(uid, "contacts", "trees_by_net", books)
        await set_collection_key(uid, "contacts", "cross_callsigns", cross_index)
    if update.gateway is not None:
        await set_collection_key(uid, "contacts", "gateway", update.gateway)

    contacts_col = await get_collection(uid, "contacts")
    current_tree = _normalize_contacts_tree_networks(contacts_col.get("tree", []))
    current_books = contacts_col.get("trees_by_net") or _partition_contacts_by_network(current_tree)
    current_cross = contacts_col.get("cross_callsigns")
    if current_cross is None:
        current_cross = await asyncio.to_thread(_build_cross_callsign_index_sync, current_tree)
    current_gw = contacts_col.get("gateway", {"hotspot_id": "default", "slot": 2})

    # Also mirror into user_settings for backwards compatibility with legacy readers
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    s.contacts = current_tree if isinstance(current_tree, list) else []
    s.contacts_gateway = current_gw if isinstance(current_gw, dict) else {"hotspot_id": "default", "slot": 2}
    await save_user_settings(uid, s.model_dump())
    if uid == 1:
        save_app_settings(s)

    await broadcast_user_json(uid, {
        "type": "contacts_change",
        "contacts": current_tree,
        "books": current_books,
        "cross_callsigns": current_cross,
        "gateway": current_gw
    })

    return {
        "status": "ok",
        "contacts": current_tree,
        "books": current_books,
        "cross_callsigns": current_cross,
        "gateway": current_gw
    }

@app.get("/api/contacts/cross-callsign")
async def get_cross_callsign_info(callsign: str = "", request: Request = None):
    """Queries cross-network databases (RadioID DMR, AllStarLink directory, and user phonebooks across networks) for one callsign."""
    cs = str(callsign or "").strip().upper()
    if not cs or len(cs) < 2:
        return {
            "status": "ok",
            "data": {"callsign": cs, "user_networks": [], "radioid_dmr": [], "allstar_nodes": [], "echolink_nodes": []}
        }
    user = _get_user_from_request(request) if request else None
    user_entries: List[Dict[str, Any]] = []
    if user and not user.get("is_demo"):
        uid = user["user_id"]
        contacts_col = await get_collection(uid, "contacts")
        raw_tree = _normalize_contacts_tree_networks(contacts_col.get("tree") or [])
        by_call = _collect_user_entries_by_callsign(raw_tree)
        user_entries = by_call.get(cs, [])
    elif not user:
        uid = hotspot_manager.active_user_id or 1
        contacts_col = await get_collection(uid, "contacts")
        raw_tree = _normalize_contacts_tree_networks(contacts_col.get("tree") or [])
        by_call = _collect_user_entries_by_callsign(raw_tree)
        user_entries = by_call.get(cs, [])

    entry = await asyncio.to_thread(_lookup_cross_callsign_entry, cs, user_entries)
    return {"status": "ok", "data": entry}

class YsfFavoritesUpdate(BaseModel):
    favorites: List[Dict[str, Any]] = Field(default_factory=list)

def _sanitize_ysf_favorites(raw: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Normalizes user's YSF favorites: keeps order, drops duplicates (by room id) and junk, caps size."""
    out: List[Dict[str, Any]] = []
    seen = set()
    for item in (raw or []):
        if not isinstance(item, dict):
            continue
        rid = str(item.get("id", "")).strip()
        if not rid or rid in seen:
            continue
        seen.add(rid)
        try:
            port_val = int(item.get("port") or 42000)
        except (ValueError, TypeError):
            port_val = 42000
        rt_val = str(item.get("reflector_type") or "").strip().lower()
        if rt_val not in ("single", "multi_standard", "multi_mutant"):
            rt_val = ""
        out.append({
            "id": rid[:16],
            "name": str(item.get("name", "") or "")[:80],
            "reflector_name": str(item.get("reflector_name", "") or "")[:80],
            "description": str(item.get("description", "") or "")[:160],
            "country_code": str(item.get("country_code", "") or item.get("country", "") or "XX")[:8].upper(),
            "host": str(item.get("host", "") or "")[:120],
            "port": port_val if 1 <= port_val <= 65535 else 42000,
            "reflector_type": rt_val,
            "is_multiroom": bool(item.get("is_multiroom", False)),
            "multiroom_kind": str(item.get("multiroom_kind", "") or "")[:24].upper(),
        })
        if len(out) >= 500:
            break
    return out

@app.get("/api/ysf/favorites")
async def get_ysf_favorites(request: Request):
    """Returns this user's YSF favorites (= 'YSF Contacts'), stored server-side."""
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    return {"status": "ok", "favorites": getattr(s, "ysf_favorites", []) or []}

@app.put("/api/ysf/favorites")
async def put_ysf_favorites(update: YsfFavoritesUpdate, request: Request):
    """Replaces this user's YSF favorites and persists them on the server."""
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    favorites = _sanitize_ysf_favorites(update.favorites)
    if user and user.get("is_demo"):
        return {"status": "ok", "favorites": favorites}
    s = await ensure_active_user(uid, login)
    s.ysf_favorites = favorites
    await set_collection_key(uid, "ysf_favorites", "list", favorites)
    await save_user_settings(uid, s.model_dump())
    if uid == 1:
        save_app_settings(s)
    await broadcast_user_json(uid, {
        "type": "ysf_favorites_change",
        "favorites": favorites
    })
    return {"status": "ok", "favorites": favorites}

# ── User Collections API ──────────────────────────────────────────────

@app.get("/api/collections/{category}")
async def api_get_collection(category: str, request: Request):
    """Returns all key-value pairs for a given collection category."""
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    data = await get_collection(uid, category)
    return {"status": "ok", "category": category, "data": data}

class CollectionUpdatePayload(BaseModel):
    data: Dict[str, Any] = Field(default_factory=dict)

def _sync_user_ysf_room_types_cache(uid: int, action: str, key: str = "", value: Any = None, data: Optional[Dict[str, Any]] = None) -> None:
    if not hasattr(hotspot_manager, "user_ysf_room_types"):
        hotspot_manager.user_ysf_room_types = {}
    u_map = hotspot_manager.user_ysf_room_types.setdefault(uid, {})
    if action == "replace":
        u_map.clear()
        for k, v in (data or {}).items():
            sk = str(k).strip()
            sv = str(v or "").strip().lower()
            if sk and sv in ("single", "multi_standard", "multi_mutant"):
                u_map[sk] = sv
    elif action == "set":
        sk = str(key).strip()
        sv = str(value or "").strip().lower()
        if sk:
            if sv in ("single", "multi_standard", "multi_mutant"):
                u_map[sk] = sv
            else:
                u_map.pop(sk, None)
    elif action == "delete":
        u_map.pop(str(key).strip(), None)

    try:
        from dmr.ysf_directory import ysf_dir_mgr, classify_ysf_reflector
    except ImportError:
        return
    rts = hotspot_manager.get_user_runtimes(uid) if hasattr(hotspot_manager, "get_user_runtimes") else []
    for rt in (rts or []):
        if (getattr(rt.config, "network_type", "") or "").lower() != "ysf" or not rt.client:
            continue
        inner = getattr(rt.client, "client", rt.client)
        cur_rid = str(getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", "") or "").strip()
        if action in ("set", "delete") and cur_rid != str(key).strip():
            continue
        ovr = u_map.get(cur_rid, "")
        found_rm = ysf_dir_mgr.get_room_by_id(cur_rid) if cur_rid else None
        cls_info = classify_ysf_reflector(
            room=found_rm,
            name=getattr(rt.config, "ysf_room_name", "") or getattr(rt.config, "ysf_name", "") or "",
            host=getattr(rt.config, "ysf_host", "") or getattr(rt.config, "bm_master_host", "") or "",
            room_id=cur_rid,
            override=ovr,
        )
        inner.room_type_override = ovr
        inner.reflector_type = cls_info["reflector_type"]
        inner.multiroom_kind = cls_info["multiroom_kind"]
        inner.is_multiroom = cls_info["is_multiroom"]
        hotspot_manager._notify_async({
            "type": "hotspot_updated",
            "hotspot": rt.to_dict(),
            "user_id": uid,
        }, user_id=uid)

@app.put("/api/collections/{category}")
async def api_put_collection(category: str, payload: CollectionUpdatePayload, request: Request):
    """Replaces the entire collection for a category."""
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user and user.get("is_demo"):
        return {"status": "ok", "category": category, "data": payload.data}
    await replace_collection(uid, category, payload.data)
    if category == "ysf_room_types":
        _sync_user_ysf_room_types_cache(uid, "replace", data=payload.data)
    await broadcast_user_json(uid, {
        "type": "collection_change",
        "category": category,
        "action": "replace",
        "data": payload.data
    })
    return {"status": "ok", "category": category, "data": payload.data}

class CollectionKeyPayload(BaseModel):
    value: Any = None

@app.put("/api/collections/{category}/{key}")
async def api_put_collection_key(category: str, key: str, payload: CollectionKeyPayload, request: Request):
    """Upserts a single key inside a collection category."""
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user and user.get("is_demo"):
        return {"status": "ok"}
    await set_collection_key(uid, category, key, payload.value)
    if category == "ysf_room_types":
        _sync_user_ysf_room_types_cache(uid, "set", key=key, value=payload.value)
    await broadcast_user_json(uid, {
        "type": "collection_change",
        "category": category,
        "action": "set",
        "key": key,
        "value": payload.value
    })
    return {"status": "ok"}

@app.delete("/api/collections/{category}/{key}")
async def api_delete_collection_key(category: str, key: str, request: Request):
    """Removes a single key from a collection category."""
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user and user.get("is_demo"):
        return {"status": "ok"}
    await delete_collection_key(uid, category, key)
    if category == "ysf_room_types":
        _sync_user_ysf_room_types_cache(uid, "delete", key=key)
    await broadcast_user_json(uid, {
        "type": "collection_change",
        "category": category,
        "action": "delete",
        "key": key
    })
    return {"status": "ok"}

class TranscriberSettingsUpdate(BaseModel):
    enabled: Optional[bool] = None
    api_key: Optional[str] = None
    api_keys: Optional[List[str]] = None
    transcriber_engine: Optional[str] = None
    model: Optional[str] = None
    translation_engine: Optional[str] = None
    source_lang: Optional[str] = None
    target_lang: Optional[str] = None
    groq_api_key: Optional[str] = None
    groq_api_keys: Optional[List[str]] = None
    deepgram_api_key: Optional[str] = None
    gemini_use_first_key_only: Optional[bool] = None
    groq_use_first_key_only: Optional[bool] = None
    gemini_use_first_key: Optional[bool] = None
    gemini_use_other_keys: Optional[bool] = None
    groq_use_first_key: Optional[bool] = None
    groq_use_other_keys: Optional[bool] = None
    tts_enabled: Optional[bool] = None
    tts_engine: Optional[str] = None
    tts_model: Optional[str] = None
    tts_voice: Optional[str] = None
    tts_speed: Optional[float] = None
    tts_ducking_level: Optional[float] = None
    tts_pause_ducking_level: Optional[float] = None
    tts_mute_others: Optional[bool] = None
    tts_announce_callsign: Optional[bool] = None
    tts_skip_short_callsign: Optional[bool] = None
    tts_style: Optional[str] = None

class TestKeysRequest(BaseModel):
    engine: str = "gemini"
    keys: List[str] = []

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
    is_demo = bool(user and user.get("is_demo"))
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    live_ts = transcriber_service
    return {
        "status": "ok",
        "settings": {
            "enabled": getattr(s, "transcriber_enabled", False),
            "api_key": ("••••••••••••" if (is_demo and getattr(s, "transcriber_api_key", "")) else getattr(s, "transcriber_api_key", "")),
            "api_keys": (["••••••••••••"] if (is_demo and getattr(s, "transcriber_api_keys", [])) else (getattr(s, "transcriber_api_keys", []) or [])),
            "transcriber_engine": getattr(s, "transcriber_engine", "groq"),
            "model": getattr(s, "transcriber_model", "gemini-3.5-flash"),
            "translation_engine": getattr(s, "translation_engine", "groq"),
            "target_lang": getattr(live_ts, "target_lang", None) or getattr(s, "transcriber_target_lang", "ru"),
            "source_lang": getattr(live_ts, "source_lang", None) or getattr(s, "transcriber_source_lang", "auto"),
            "groq_api_key": ("••••••••••••" if (is_demo and getattr(s, "groq_api_key", "")) else getattr(s, "groq_api_key", "")),
            "groq_api_keys": (["••••••••••••"] if (is_demo and getattr(s, "groq_api_keys", [])) else (getattr(s, "groq_api_keys", []) or [])),
            "gemini_use_first_key_only": getattr(s, "gemini_use_first_key_only", False),
            "groq_use_first_key_only": getattr(s, "groq_use_first_key_only", False),
            "gemini_use_first_key": getattr(s, "gemini_use_first_key", True),
            "gemini_use_other_keys": getattr(s, "gemini_use_other_keys", True),
            "groq_use_first_key": getattr(s, "groq_use_first_key", True),
            "groq_use_other_keys": getattr(s, "groq_use_other_keys", True),
            "deepgram_api_key": ("••••••••••••" if (is_demo and getattr(s, "deepgram_api_key", "")) else getattr(s, "deepgram_api_key", "")),
            "tts_enabled": getattr(live_ts, "tts_enabled", getattr(s, "tts_enabled", False)),
            "tts_engine": getattr(live_ts, "tts_engine", None) or getattr(s, "tts_engine", "piper"),
            "tts_model": getattr(live_ts, "tts_model", None) or getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"),
            "tts_voice": getattr(live_ts, "tts_voice", None) or getattr(s, "tts_voice", "ru_RU-terra5871-medium"),
            "tts_speed": getattr(live_ts, "tts_speed", None) or getattr(s, "tts_speed", 1.1),
            "tts_ducking_level": getattr(live_ts, "tts_ducking_level", getattr(s, "tts_ducking_level", 0.80)),
            "tts_pause_ducking_level": getattr(live_ts, "tts_pause_ducking_level", getattr(s, "tts_pause_ducking_level", 1.0)),
            "tts_mute_others": getattr(live_ts, "tts_mute_others", getattr(s, "tts_mute_others", True)),
            "tts_announce_callsign": getattr(live_ts, "tts_announce_callsign", getattr(s, "tts_announce_callsign", False)),
            "tts_skip_short_callsign": getattr(live_ts, "tts_skip_short_callsign", getattr(s, "tts_skip_short_callsign", True)),
            "tts_style": getattr(live_ts, "tts_style", None) or getattr(s, "tts_style", "radio")
        }
    }

@app.post("/api/transcriber/settings")
async def update_transcriber_settings(update: TranscriberSettingsUpdate, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)
    is_demo = bool(user and user.get("is_demo"))
    if is_demo:
        if update.source_lang is not None:
            clean_sl = update.source_lang.strip().lower()
            transcriber_service.source_lang = clean_sl if clean_sl else "auto"
        if update.target_lang is not None:
            transcriber_service.target_lang = update.target_lang
        if update.tts_enabled is not None:
            transcriber_service.tts_enabled = bool(update.tts_enabled)
        if update.tts_engine is not None:
            transcriber_service.tts_engine = update.tts_engine
        if update.tts_model is not None:
            transcriber_service.tts_model = update.tts_model
        if update.tts_speed is not None:
            transcriber_service.tts_speed = float(update.tts_speed)
        if update.tts_ducking_level is not None:
            transcriber_service.tts_ducking_level = float(update.tts_ducking_level)
        if update.tts_pause_ducking_level is not None:
            transcriber_service.tts_pause_ducking_level = float(update.tts_pause_ducking_level)
        if update.tts_mute_others is not None:
            transcriber_service.tts_mute_others = bool(update.tts_mute_others)
        if update.tts_announce_callsign is not None:
            transcriber_service.tts_announce_callsign = bool(update.tts_announce_callsign)
        if update.tts_skip_short_callsign is not None:
            transcriber_service.tts_skip_short_callsign = bool(update.tts_skip_short_callsign)
        if update.tts_style is not None:
            transcriber_service.tts_style = update.tts_style

        effective_engine = getattr(transcriber_service, "tts_engine", "piper")
        eff_l = (getattr(transcriber_service, "target_lang", "ru") or "ru").lower().strip()
        if update.tts_voice is not None and (effective_engine != "piper" or update.tts_voice != "auto"):
            transcriber_service.tts_voice = update.tts_voice

        if effective_engine == "piper" and eff_l != "none":
            from piper_service import PiperService
            psrv = PiperService.get_instance()
            cur_v = getattr(transcriber_service, "tts_voice", None)
            cur_v_lang = psrv.get_voice_lang(cur_v)
            if not cur_v or cur_v in ("auto", "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Zephyr", "Despina", "Achernar", "Orus", "Iapetus") or cur_v_lang != eff_l:
                new_v = psrv.get_installed_voice_for_lang(eff_l) or psrv.get_default_voice_for_lang(eff_l)
                if new_v:
                    transcriber_service.tts_voice = new_v
            try:
                target_v = getattr(transcriber_service, "tts_voice", None)
                if target_v:
                    if not psrv.is_voice_installed(target_v):
                        logger.info(f"[PIPER][DEMO] Starting background download of voice '{target_v}' for language '{eff_l}'...")
                        psrv.start_download(target_v)
                    else:
                        asyncio.create_task(psrv.preload_voice_async(target_v))
            except Exception as pe:
                logger.warning(f"[PIPER][DEMO] Could not auto-download or preload voice: {pe}")

        await broadcast_json({
            "type": "transcriber_settings_change",
            "enabled": getattr(s, "transcriber_enabled", False),
            "model": getattr(s, "transcriber_model", "gemini-3.5-flash"),
            "target_lang": getattr(transcriber_service, "target_lang", "ru"),
            "source_lang": getattr(transcriber_service, "source_lang", "auto"),
            "has_key": bool(s.transcriber_api_key or getattr(s, "transcriber_api_keys", [])),
            "tts_enabled": getattr(transcriber_service, "tts_enabled", False),
            "tts_engine": getattr(transcriber_service, "tts_engine", "piper"),
            "tts_model": getattr(transcriber_service, "tts_model", "gemini-3.1-flash-tts-preview"),
            "tts_voice": getattr(transcriber_service, "tts_voice", "auto"),
            "tts_speed": getattr(transcriber_service, "tts_speed", 1.1),
            "tts_ducking_level": getattr(transcriber_service, "tts_ducking_level", 0.80),
            "tts_pause_ducking_level": getattr(transcriber_service, "tts_pause_ducking_level", 1.0),
            "tts_mute_others": getattr(transcriber_service, "tts_mute_others", True),
            "tts_announce_callsign": getattr(transcriber_service, "tts_announce_callsign", False),
            "tts_skip_short_callsign": getattr(transcriber_service, "tts_skip_short_callsign", True),
            "tts_style": getattr(transcriber_service, "tts_style", "radio"),
            "transcriber_engine": getattr(s, "transcriber_engine", "groq"),
            "translation_engine": getattr(s, "translation_engine", "groq"),
            "has_groq_key": bool(getattr(s, "groq_api_key", "") or getattr(s, "groq_api_keys", [])),
            "has_deepgram_key": bool(getattr(s, "deepgram_api_key", "")),
            "gemini_use_first_key": getattr(s, "gemini_use_first_key", True),
            "gemini_use_other_keys": getattr(s, "gemini_use_other_keys", True),
            "groq_use_first_key": getattr(s, "groq_use_first_key", True),
            "groq_use_other_keys": getattr(s, "groq_use_other_keys", True),
        })

        return {
            "status": "ok",
            "settings": {
                "enabled": getattr(s, "transcriber_enabled", False),
                "api_key": ("••••••••••••" if getattr(s, "transcriber_api_key", "") else ""),
                "api_keys": (["••••••••••••"] if getattr(s, "transcriber_api_keys", []) else []),
                "transcriber_engine": getattr(s, "transcriber_engine", "groq"),
                "model": getattr(s, "transcriber_model", "gemini-3.5-flash"),
                "translation_engine": getattr(s, "translation_engine", "groq"),
                "target_lang": getattr(transcriber_service, "target_lang", "ru"),
                "source_lang": getattr(transcriber_service, "source_lang", "auto"),
                "groq_api_key": ("••••••••••••" if getattr(s, "groq_api_key", "") else ""),
                "groq_api_keys": (["••••••••••••"] if getattr(s, "groq_api_keys", []) else []),
                "gemini_use_first_key_only": getattr(s, "gemini_use_first_key_only", False),
                "groq_use_first_key_only": getattr(s, "groq_use_first_key_only", False),
                "deepgram_api_key": ("••••••••••••" if getattr(s, "deepgram_api_key", "") else ""),
                "tts_enabled": getattr(transcriber_service, "tts_enabled", False),
                "tts_engine": getattr(transcriber_service, "tts_engine", "piper"),
                "tts_model": getattr(transcriber_service, "tts_model", "gemini-3.1-flash-tts-preview"),
                "tts_voice": getattr(transcriber_service, "tts_voice", "auto"),
                "tts_speed": getattr(transcriber_service, "tts_speed", 1.1),
                "tts_ducking_level": getattr(transcriber_service, "tts_ducking_level", 0.80),
                "tts_pause_ducking_level": getattr(transcriber_service, "tts_pause_ducking_level", 1.0),
                "tts_mute_others": getattr(transcriber_service, "tts_mute_others", True),
                "tts_announce_callsign": getattr(transcriber_service, "tts_announce_callsign", False),
                "tts_skip_short_callsign": getattr(transcriber_service, "tts_skip_short_callsign", True),
                "tts_style": getattr(transcriber_service, "tts_style", "radio"),
            }
        }

    changed = False
    if update.enabled is not None and update.enabled != s.transcriber_enabled:
        s.transcriber_enabled = update.enabled
        changed = True
    if update.api_key is not None and update.api_key != s.transcriber_api_key:
        s.transcriber_api_key = update.api_key
        changed = True
    if update.api_keys is not None:
        clean_keys = [k.strip() for k in update.api_keys if k and k.strip()]
        new_primary = clean_keys[0] if clean_keys else ""
        if clean_keys != getattr(s, "transcriber_api_keys", []) or new_primary != getattr(s, "transcriber_api_key", ""):
            s.transcriber_api_keys = clean_keys
            s.transcriber_api_key = new_primary
            changed = True

    # Gemini key usage flags
    if update.gemini_use_first_key is not None or update.gemini_use_other_keys is not None or update.gemini_use_first_key_only is not None:
        cur_first = getattr(s, "gemini_use_first_key", True)
        cur_other = getattr(s, "gemini_use_other_keys", True)
        new_first = update.gemini_use_first_key if update.gemini_use_first_key is not None else cur_first
        new_other = update.gemini_use_other_keys if update.gemini_use_other_keys is not None else cur_other
        if update.gemini_use_first_key_only is not None and update.gemini_use_first_key is None and update.gemini_use_other_keys is None:
            if update.gemini_use_first_key_only:
                new_first, new_other = True, False
            else:
                new_first, new_other = True, True
        if not new_first and not new_other:
            new_first = True
        if new_first != cur_first or new_other != cur_other:
            s.gemini_use_first_key = new_first
            s.gemini_use_other_keys = new_other
            s.gemini_use_first_key_only = bool(new_first and not new_other)
            changed = True

    if update.transcriber_engine is not None and update.transcriber_engine != getattr(s, "transcriber_engine", "gemini"):
        s.transcriber_engine = update.transcriber_engine
        changed = True
    if update.translation_engine is not None and update.translation_engine != getattr(s, "translation_engine", "gemini"):
        s.translation_engine = update.translation_engine
        changed = True
    if update.groq_api_key is not None and update.groq_api_key.strip() != getattr(s, "groq_api_key", ""):
        s.groq_api_key = update.groq_api_key.strip()
        changed = True
    if update.groq_api_keys is not None:
        clean_groq = [k.strip() for k in update.groq_api_keys if k and k.strip()]
        new_groq_primary = clean_groq[0] if clean_groq else ""
        if clean_groq != getattr(s, "groq_api_keys", []) or new_groq_primary != getattr(s, "groq_api_key", ""):
            s.groq_api_keys = clean_groq
            s.groq_api_key = new_groq_primary
            changed = True

    # Groq key usage flags
    if update.groq_use_first_key is not None or update.groq_use_other_keys is not None or update.groq_use_first_key_only is not None:
        cur_first = getattr(s, "groq_use_first_key", True)
        cur_other = getattr(s, "groq_use_other_keys", True)
        new_first = update.groq_use_first_key if update.groq_use_first_key is not None else cur_first
        new_other = update.groq_use_other_keys if update.groq_use_other_keys is not None else cur_other
        if update.groq_use_first_key_only is not None and update.groq_use_first_key is None and update.groq_use_other_keys is None:
            if update.groq_use_first_key_only:
                new_first, new_other = True, False
            else:
                new_first, new_other = True, True
        if not new_first and not new_other:
            new_first = True
        if new_first != cur_first or new_other != cur_other:
            s.groq_use_first_key = new_first
            s.groq_use_other_keys = new_other
            s.groq_use_first_key_only = bool(new_first and not new_other)
            changed = True
    if update.deepgram_api_key is not None and update.deepgram_api_key.strip() != getattr(s, "deepgram_api_key", ""):
        s.deepgram_api_key = update.deepgram_api_key.strip()
        changed = True
    if update.model is not None:
        target_model = update.model.strip()
        if any(dep in target_model.lower() for dep in ["gemini-2.5-", "gemini-2.0-", "gemini-1.5-"]):
            target_model = "gemini-3.5-flash"
        if target_model != s.transcriber_model:
            s.transcriber_model = target_model
            changed = True
    if update.source_lang is not None:
        clean_sl = update.source_lang.strip().lower()
        valid_sl = clean_sl if clean_sl else "auto"
        if valid_sl != getattr(s, "transcriber_source_lang", "auto"):
            s.transcriber_source_lang = valid_sl
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
    if update.tts_skip_short_callsign is not None and update.tts_skip_short_callsign != getattr(s, "tts_skip_short_callsign", True):
        s.tts_skip_short_callsign = update.tts_skip_short_callsign
        changed = True
    if update.tts_style is not None and update.tts_style != getattr(s, "tts_style", "radio"):
        s.tts_style = update.tts_style
        changed = True

    if changed:
        await save_user_settings(uid, s.model_dump())
        if uid == 1:
            save_app_settings(s)
        _configure_transcriber_from_settings(s)
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
            "source_lang": getattr(s, "transcriber_source_lang", "auto"),
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
            "tts_skip_short_callsign": getattr(s, "tts_skip_short_callsign", True),
            "tts_style": getattr(s, "tts_style", "radio"),
            "transcriber_engine": getattr(s, "transcriber_engine", "gemini"),
            "translation_engine": getattr(s, "translation_engine", "gemini"),
            "has_groq_key": bool(getattr(s, "groq_api_key", "") or getattr(s, "groq_api_keys", [])),
            "has_deepgram_key": bool(getattr(s, "deepgram_api_key", "")),
            "gemini_use_first_key": getattr(s, "gemini_use_first_key", True),
            "gemini_use_other_keys": getattr(s, "gemini_use_other_keys", True),
            "groq_use_first_key": getattr(s, "groq_use_first_key", True),
            "groq_use_other_keys": getattr(s, "groq_use_other_keys", True),
        })

    return {
        "status": "ok",
        "settings": {
            "enabled": s.transcriber_enabled,
            "api_key": s.transcriber_api_key,
            "api_keys": getattr(s, "transcriber_api_keys", []) or [],
            "transcriber_engine": getattr(s, "transcriber_engine", "gemini"),
            "model": s.transcriber_model,
            "translation_engine": getattr(s, "translation_engine", "gemini"),
            "target_lang": s.transcriber_target_lang,
            "source_lang": getattr(s, "transcriber_source_lang", "auto"),
            "groq_api_key": getattr(s, "groq_api_key", ""),
            "groq_api_keys": getattr(s, "groq_api_keys", []) or [],
            "gemini_use_first_key_only": getattr(s, "gemini_use_first_key_only", False),
            "groq_use_first_key_only": getattr(s, "groq_use_first_key_only", False),
            "gemini_use_first_key": getattr(s, "gemini_use_first_key", True),
            "gemini_use_other_keys": getattr(s, "gemini_use_other_keys", True),
            "groq_use_first_key": getattr(s, "groq_use_first_key", True),
            "groq_use_other_keys": getattr(s, "groq_use_other_keys", True),
            "deepgram_api_key": getattr(s, "deepgram_api_key", ""),
            "tts_enabled": getattr(s, "tts_enabled", False),
            "tts_engine": getattr(s, "tts_engine", "gemini"),
            "tts_model": getattr(s, "tts_model", "gemini-3.1-flash-tts-preview"),
            "tts_voice": getattr(s, "tts_voice", "auto"),
            "tts_speed": getattr(s, "tts_speed", 1.1),
            "tts_ducking_level": getattr(s, "tts_ducking_level", 0.80),
            "tts_pause_ducking_level": getattr(s, "tts_pause_ducking_level", 1.0),
            "tts_mute_others": getattr(s, "tts_mute_others", True),
            "tts_announce_callsign": getattr(s, "tts_announce_callsign", False),
            "tts_skip_short_callsign": getattr(s, "tts_skip_short_callsign", True),
            "tts_style": getattr(s, "tts_style", "radio"),
        }
    }

@app.post("/api/transcriber/test-keys")
async def test_transcriber_keys(req: TestKeysRequest):
    import urllib.request, urllib.error
    engine = (req.engine or "gemini").lower().strip()
    keys = [k.strip() for k in (req.keys or []) if k and k.strip()]
    if not keys:
        return {"status": "ok", "results": []}

    async def _test_one(k: str) -> Dict[str, Any]:
        if engine == "groq":
            url = "https://api.groq.com/openai/v1/models"
            try:
                r = urllib.request.Request(
                    url,
                    headers={
                        "Authorization": f"Bearer {k}",
                        "User-Agent": "ProxDMR/1.0"
                    }
                )
                def _do_groq():
                    with urllib.request.urlopen(r, timeout=6) as resp:
                        return resp.status
                await asyncio.to_thread(_do_groq)
                return {"key": k, "valid": True, "error": None, "http_code": 200}
            except urllib.error.HTTPError as e:
                err_text = f"HTTP {e.code}"
                try:
                    b = json.loads(e.read().decode("utf-8", errors="replace"))
                    if "error" in b and "message" in b["error"]:
                        err_text = b["error"]["message"]
                except Exception:
                    pass
                return {"key": k, "valid": False, "error": err_text, "http_code": e.code}
            except Exception as e:
                return {"key": k, "valid": False, "error": str(e), "http_code": None}
        else:
            url = f"https://generativelanguage.googleapis.com/v1beta/models?key={k}"
            try:
                r = urllib.request.Request(url, headers={"User-Agent": "ProxDMR/1.0"})
                def _do_gemini():
                    with urllib.request.urlopen(r, timeout=6) as resp:
                        return resp.status
                await asyncio.to_thread(_do_gemini)
                return {"key": k, "valid": True, "error": None, "http_code": 200}
            except urllib.error.HTTPError as e:
                err_text = f"HTTP {e.code}"
                try:
                    b = json.loads(e.read().decode("utf-8", errors="replace"))
                    if "error" in b and "message" in b["error"]:
                        err_text = b["error"]["message"]
                except Exception:
                    pass
                return {"key": k, "valid": False, "error": err_text, "http_code": e.code}
            except Exception as e:
                return {"key": k, "valid": False, "error": str(e), "http_code": None}

    results = await asyncio.gather(*[_test_one(k) for k in keys])
    return {"status": "ok", "results": results}

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
    eff_api_key = req.api_key
    if (user and user.get("is_demo")) or (eff_api_key and "•" in eff_api_key):
        eff_api_key = None
    wav_bytes, err = await transcriber_service.synthesize_speech(
        text=test_text,
        model=req.model,
        voice=req.voice,
        api_key=eff_api_key,
        target_lang=target_lang,
        engine=req_engine,
        speed=req.speed or 1.0,
        callsign="DEMO" if (user and user.get("is_demo")) else (req.callsign or "RX6AWG"),
        announce_callsign=bool(req.announce_callsign),
        style=req.tts_style
    )
    if err or not wav_bytes:
        return JSONResponse({"status": "error", "message": err or _tr("transcriber.tts_synth_error", fallback="Speech synthesis error")}, status_code=400)
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




@app.get("/api/transcriber/silero/voices")
async def api_silero_voices(lang: Optional[str] = None):
    from silero_service import SileroService, SILERO_VOICES_BY_LANG
    srv = SileroService.get_instance()
    clean_lang = (lang or "ru").lower().strip()
    if clean_lang == "ua":
        clean_lang = "uk"
    is_supp = srv.is_lang_supported(clean_lang)
    voices = srv.get_voices_for_lang(clean_lang)
    return {
        "status": "ok",
        "available": srv.is_available(),
        "supported": is_supp,
        "supported_languages": list(SILERO_VOICES_BY_LANG.keys()),
        "voices": voices,
        "lang": clean_lang
    }

@app.get("/api/transcriber/translation/status")
async def api_translation_status():
    from translation_service import TranslationService
    srv = TranslationService.get_instance()
    return {"status": "ok", "models": srv.get_status()}

@app.get("/api/transcriber/models")
async def get_transcriber_models(api_key: Optional[str] = None):
    clean_k = api_key.strip() if (api_key and not api_key.startswith("•")) else None
    _ctx = contextvars.copy_context()
    models = await asyncio.to_thread(_ctx.run, transcriber_service.fetch_available_models_with_pool, clean_k)
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
                    "message": _tr("transcriber.offline_no_recordings", user_id=user_id, fallback="No recordings for hotspot {hotspot_id}", hotspot_id=self.hotspot_id)
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
                                "message": _tr("transcriber.offline_quota_429", user_id=user_id, fallback="Google Gemini API quota exceeded (429 Quota Exceeded). Process stopped.")
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
    if not transcriber_service.get_all_keys():
        msg = _tr("transcriber.no_avail_gemini_keys_mgr", fallback="No available Gemini keys (check key settings in manager)") if transcriber_service.api_keys else _tr("transcriber.no_gemini_key_settings", fallback="Gemini API key is not specified in transcription settings")
        return JSONResponse({"status": "error", "message": msg}, status_code=400)
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

COUNTRY_FLAGS: Dict[str, str] = {
    "AT": "🇦🇹",
    "RU": "🇷🇺",
    "DE": "🇩🇪",
    "CH": "🇨🇭",
    "US": "🇺🇸",
    "FR": "🇫🇷",
    "GB": "🇬🇧",
    "ES": "🇪🇸",
    "IT": "🇮🇹",
    "NL": "🇳🇱",
    "PL": "🇵🇱",
    "CZ": "🇨🇿",
    "SE": "🇸🇪",
    "FI": "🇫🇮",
    "NO": "🇳🇴",
    "DK": "🇩🇰",
    "HU": "🇭🇺",
    "RO": "🇷🇴",
    "BG": "🇧🇬",
    "SI": "🇸🇮",
    "PT": "🇵🇹",
    "IE": "🇮🇪",
    "GR": "🇬🇷",
    "BE": "🇧🇪",
    "CA": "🇨🇦",
    "IL": "🇮🇱",
    "AU": "🇦🇺",
    "KR": "🇰🇷",
    "CN": "🇨🇳",
    "MY": "🇲🇾",
    "PH": "🇵🇭",
    "ZA": "🇿🇦",
    "BR": "🇧🇷",
    "CL": "🇨🇱",
    "MX": "🇲🇽",
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
    base_list = BM_MASTERS_CACHE["data"] if (BM_MASTERS_CACHE["data"] and (now - BM_MASTERS_CACHE["timestamp"] < 3600)) else None

    if base_list is None:
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
            base = []
            for item in raw_list:
                mid = item.get("id")
                cc = (item.get("country") or "").upper()
                c_flag = COUNTRY_FLAGS.get(cc, "🌐")
                host = f"{mid}.master.brandmeister.network"
                is_rec = (mid == 2322)
                base.append({
                    "id": mid,
                    "country_code": cc,
                    "flag": c_flag,
                    "host": host,
                    "ip": item.get("address", ""),
                    "recommended": is_rec,
                })
            return base

        base_list = await asyncio.to_thread(_fetch)
        BM_MASTERS_CACHE["timestamp"] = now
        BM_MASTERS_CACHE["data"] = base_list

    res = []
    other_label = _tr("countries.other", fallback="Other country")
    rec_badge_txt = _tr("bm.master_recommended", fallback="⭐ [Recommended]")
    for item in base_list:
        cc = item["country_code"]
        c_name = _i18n_country_name(cc, fallback=(cc or other_label))
        c_flag = item["flag"]
        mid = item["id"]
        host = item["host"]
        is_rec = item["recommended"]
        rec_suffix = f" {rec_badge_txt}" if is_rec else ""
        label = f"{c_flag} {c_name} — BM {mid} ({host}){rec_suffix}"
        res.append({
            "id": mid,
            "country_code": cc,
            "country_name": c_name,
            "flag": c_flag,
            "host": host,
            "ip": item["ip"],
            "label": label,
            "recommended": is_rec,
        })

    def sort_key(m):
        if m["id"] == 2322: return (0, "")
        if m["country_code"] == "RU": return (1, str(m["id"]))
        if m["country_code"] == "DE": return (2, str(m["id"]))
        return (3, m["country_name"])

    res.sort(key=sort_key)
    return {"masters": res}

def _localize_bm_bench_items(items, user_id: Optional[int] = None):
    other_label = _tr("countries.other", user_id=user_id, fallback="Other country")
    localized = []
    for item in (items or []):
        if not isinstance(item, dict):
            localized.append(item)
            continue
        copy_item = dict(item)
        cc = (copy_item.get("country_code") or copy_item.get("country") or "").strip().upper()
        c_name = _i18n_country_name(cc, user_id=user_id, fallback=(copy_item.get("country_name") or cc or other_label)) if cc else (copy_item.get("country_name") or other_label)
        flag = copy_item.get("flag") or "🌐"
        srv_id = copy_item.get("id")
        copy_item["country_name"] = c_name
        if srv_id is not None:
            copy_item["name"] = f"{flag} {c_name} (BM {srv_id})"
        localized.append(copy_item)
    return localized


def _localize_server_probe_cache(cache_dict, user_id: Optional[int] = None):
    if not isinstance(cache_dict, dict):
        return cache_dict
    out = {}
    for k, entry in cache_dict.items():
        if str(k).lower() == "bm" and isinstance(entry, dict) and isinstance(entry.get("results"), list):
            entry_copy = dict(entry)
            entry_copy["results"] = _localize_bm_bench_items(entry["results"], user_id=user_id)
            out[k] = entry_copy
        else:
            out[k] = entry
    return out


@app.get("/api/bm/benchmark/results")
async def api_get_bm_benchmark_results(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else None
    return {
        "status": "ok",
        "running": bm_ping_service.is_benchmark_running(),
        "results": _localize_bm_bench_items(bm_ping_service.get_benchmark_results(), user_id=uid)
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

@app.get("/api/servers/probe/results")
async def api_get_server_probe_results(network_type: str = "bm"):
    return server_probe_service.get_probe_results(network_type)

@app.post("/api/servers/probe")
async def api_start_server_probe(request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    net_type = (body.get("network_type") or "freedmr").strip().lower()
    servers = body.get("servers")

    if not servers or not isinstance(servers, list):
        if net_type == "bm":
            bm_data = await get_bm_masters()
            servers = bm_data.get("masters", [])
        elif net_type == "freedmr":
            await freedmr_hosts_mgr.fetch_hosts(force=False)
            servers = freedmr_hosts_mgr.get_hosts(enriched=False).get("servers", [])
        elif net_type == "tgif":
            servers = list(KNOWN_TGIF_SERVERS)
        elif net_type == "dmrplus":
            await dmrplus_hosts_mgr.fetch_hosts(force=False)
            servers = dmrplus_hosts_mgr.get_hosts(enriched=False)
        elif net_type == "xlx":
            await xlx_hosts_mgr.fetch_hosts(force=False)
            servers = xlx_hosts_mgr.get_hosts(enriched=False).get("servers", [])
        elif net_type == "adn":
            tg_resolver.ensure_adn_fresh_background()
            if adn_hosts_mgr._source != "live" or adn_hosts_mgr._last_loaded_ts <= 0:
                await adn_hosts_mgr.fetch_hosts(force=True)
            else:
                adn_hosts_mgr.ensure_fresh_background()
            servers = adn_hosts_mgr.get_hosts(enriched=False).get("servers", [])
        elif net_type == "ysf":
            await ysf_dir_mgr.fetch_hosts(force=False)
            servers = ysf_dir_mgr.get_hosts(enriched=False).get("servers", [])
        else:
            servers = []

    probe_id = 123456799
    user_settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    if user_settings and hasattr(user_settings, "hotspots") and user_settings.hotspots:
        base_id = user_settings.hotspots[0].dmr_id
        if base_id and base_id > 0:
            probe_id = base_id * 100 + 99

    success = await server_probe_service.start_probe(
        network_type=net_type,
        servers=servers,
        probe_id=probe_id,
        broadcast_cb=broadcast_json
    )
    return {
        "status": "ok" if success else "already_running",
        "running": True,
        "network_type": net_type
    }

@app.post("/api/servers/probe/cancel")
async def api_cancel_server_probe(request: Request):
    net_type = None
    try:
        body = await request.json()
        net_type = body.get("network_type")
    except Exception:
        pass
    server_probe_service.cancel_probe(net_type)
    return {"status": "ok", "running": False}

@app.get("/api/dmr/servers")
async def api_get_dmr_servers(network_type: str = "freedmr", request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else None
    net_lower = (network_type or "bm").strip().lower()
    if net_lower == "bm":
        bm_data = await get_bm_masters()
        base = bm_data.get("masters", [])
        bench = bm_ping_service.get_benchmark_results()
        if bench:
            return {"status": "ok", "network_type": "bm", "servers": _localize_bm_bench_items(bench, user_id=uid)}
        return {"status": "ok", "network_type": "bm", "servers": _localize_bm_bench_items(server_probe_service.enrich_servers_with_cache("bm", base), user_id=uid)}
    elif net_lower == "freedmr":
        await freedmr_hosts_mgr.fetch_hosts(force=False)
        base = freedmr_hosts_mgr.get_hosts(enriched=False).get("servers", [])
        return {"status": "ok", "network_type": "freedmr", "servers": server_probe_service.enrich_servers_with_cache("freedmr", base)}
    elif net_lower == "tgif":
        return {"status": "ok", "network_type": "tgif", "servers": server_probe_service.enrich_servers_with_cache("tgif", KNOWN_TGIF_SERVERS)}
    elif net_lower == "dmrplus":
        sync_started = dmrplus_hosts_mgr.ensure_fresh_background()
        payload = dmrplus_hosts_mgr.get_hosts_payload(enriched=True)
        payload["network_type"] = "dmrplus"
        payload["sync_in_progress"] = bool(sync_started or payload.get("sync_in_progress"))
        return payload
    elif net_lower == "xlx":
        await xlx_hosts_mgr.fetch_hosts(force=False)
        base = xlx_hosts_mgr.get_hosts(enriched=False).get("servers", [])
        return {"status": "ok", "network_type": "xlx", "servers": server_probe_service.enrich_servers_with_cache("xlx", base)}
    elif net_lower == "adn":
        sync_started = adn_hosts_mgr.ensure_fresh_background()
        tg_sync_started = tg_resolver.ensure_adn_fresh_background()
        hosts_meta = adn_hosts_mgr.get_hosts(enriched=False)
        base = hosts_meta.get("servers", [])
        return {
            "status": "ok",
            "network_type": "adn",
            "last_sync_ts": hosts_meta.get("last_sync_ts", 0),
            "tg_last_sync_ts": int(getattr(tg_resolver, "_adn_last_sync_ts", 0) or 0),
            "sync_in_progress": bool(sync_started or tg_sync_started or hosts_meta.get("sync_in_progress") or tg_resolver.is_adn_sync_running()),
            "servers": server_probe_service.enrich_servers_with_cache("adn", base),
        }
    elif net_lower == "ysf":
        await ysf_dir_mgr.fetch_hosts(force=False)
        base = ysf_dir_mgr.get_hosts(enriched=False).get("servers", [])
        return {"status": "ok", "network_type": "ysf", "servers": server_probe_service.enrich_servers_with_cache("ysf", base)}
    elif net_lower == "custom":
        return {"status": "ok", "network_type": "custom", "servers": []}
    return {"status": "error", "message": f"Unknown network type {network_type}"}

@app.post("/api/hotspots/{hotspot_id}/connect")
async def connect_hotspot(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    is_demo = bool(user and user.get("is_demo"))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    rt_check = hotspot_manager.get_runtime(uid, target_id)
    if rt_check and getattr(rt_check.config, "hidden", False):
        return {"status": "error", "message": _tr("hotspots.cannot_connect_hidden", fallback="Cannot connect a hidden hotspot. Return it to the live list first")}
    if is_demo and rt_check:
        if _is_asl_hotspot_obj(rt_check):
            return JSONResponse({"status": "error", "code": "DEMO_ASL_DISABLED", "detail": _tr("demo.asl_disabled", fallback="ASL is disabled in demo mode")}, status_code=403)
        await _prepare_demo_hotspot_ssid(uid, rt_check)
    is_auto = str(request.query_params.get("auto", "")).strip().lower() in ("1", "true", "yes")
    success = await hotspot_manager.connect_hotspot(target_id, user_id=uid, persist=not is_demo, force=not is_auto)
    rt = hotspot_manager.get_runtime(uid, target_id)
    return {"status": "ok" if success else "error", "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}

@app.post("/api/hotspots/{hotspot_id}/disconnect")
async def disconnect_hotspot(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    is_demo = bool(user and user.get("is_demo"))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    rt_check = hotspot_manager.get_runtime(uid, target_id)
    real_hid = rt_check.config.id if rt_check else target_id
    if is_demo:
        if rt_check:
            demo_manager.record_admin_collapsed_state(real_hid, bool(getattr(rt_check.config, "collapsed", False)))
        if _is_hotspot_open_on_any_client(uid, real_hid):
            return {"status": "ok", "bm_status": "DISCONNECTED", "detail": _tr("common.disconnected", fallback="Disconnected")}
    success = await hotspot_manager.disconnect_hotspot(target_id, user_id=uid)
    rt = hotspot_manager.get_runtime(uid, target_id)
    return {"status": "ok" if success else "error", "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}

@app.post("/api/hotspots/{hotspot_id}/reconnect")
async def reconnect_hotspot_api(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    is_demo = bool(user and user.get("is_demo"))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    rt_check = hotspot_manager.get_runtime(uid, target_id)
    if is_demo and rt_check:
        if _is_asl_hotspot_obj(rt_check):
            return JSONResponse({"status": "error", "code": "DEMO_ASL_DISABLED", "detail": _tr("demo.asl_disabled", fallback="ASL is disabled in demo mode")}, status_code=403)
        await _prepare_demo_hotspot_ssid(uid, rt_check)
    success = await hotspot_manager.reconnect_hotspot(target_id, user_id=uid, persist=not is_demo)
    rt = hotspot_manager.get_runtime(uid, target_id)
    return {"status": "ok" if success else "error", "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}

@app.post("/api/hotspots/{hotspot_id}/collapse")
async def collapse_hotspot_api(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    is_demo = bool(user and user.get("is_demo"))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    rt_check = hotspot_manager.get_runtime(uid, target_id)
    real_hid = rt_check.config.id if rt_check else target_id
    if is_demo and rt_check:
        s_admin = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        admin_hs_cfg = next((h for h in getattr(s_admin, "hotspots", []) if h.id == real_hid), rt_check.config)
        demo_manager.record_admin_collapsed_state(real_hid, bool(getattr(admin_hs_cfg, "collapsed", False)))
    if _is_hotspot_open_on_any_client(uid, real_hid):
        return {"status": "ok", "collapsed": True, "bm_status": "OFFLINE", "detail": _tr("hotspots.collapsed_disconnected", fallback="Collapsed / disconnected")}
    success = await hotspot_manager.set_hotspot_collapsed(target_id, True, user_id=uid, persist=not is_demo)
    if success:
        if not is_demo:
            await save_user_settings(uid, settings.model_dump())
        rt = hotspot_manager.get_runtime(uid, target_id)
        return {"status": "ok", "collapsed": True, "bm_status": rt.status.value if rt else "OFFLINE", "detail": rt.detail if rt else ""}
    raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))

@app.post("/api/hotspots/{hotspot_id}/expand")
async def expand_hotspot_api(hotspot_id: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    is_demo = bool(user and user.get("is_demo"))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    target_id = settings.active_hotspot_id if hotspot_id == "active" else hotspot_id
    rt_check = hotspot_manager.get_runtime(uid, target_id)
    if is_demo and rt_check:
        if _is_asl_hotspot_obj(rt_check):
            return JSONResponse({"status": "error", "code": "DEMO_ASL_DISABLED", "detail": _tr("demo.asl_disabled", fallback="ASL is disabled in demo mode")}, status_code=403)
        await _prepare_demo_hotspot_ssid(uid, rt_check)
    success = await hotspot_manager.set_hotspot_collapsed(target_id, False, user_id=uid, persist=not is_demo)
    if success:
        if not is_demo:
            await save_user_settings(uid, settings.model_dump())
        rt = hotspot_manager.get_runtime(uid, target_id)
        return {"status": "ok", "collapsed": False, "bm_status": rt.status.value if rt else "ONLINE", "detail": rt.detail if rt else ""}
    raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))

@app.post("/api/hotspots/active")
async def set_active_hotspot(payload: dict, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    hid = payload.get("id")
    if user and user.get("is_demo"):
        return {"status": "ok", "active_hotspot_id": hid or "default"}
    if not hid or not hotspot_manager.set_active_hotspot(hid, user_id=uid):
        raise HTTPException(status_code=404, detail=_tr("hotspots.not_found", fallback="Hotspot not found"))
    settings = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    await save_user_settings(uid, settings.model_dump())
    return {"status": "ok", "active_hotspot_id": hid}

@app.post("/api/radio/tg")
async def set_radio_tg(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    u_radio_state = get_user_radio_state(uid)
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
        return None, None, None, _tr("hotspots.not_found", fallback="Hotspot not found")

    net_type = (getattr(cfg, "network_type", "bm") or "bm").strip().lower()
    net_key_label = "TGIF API Key (v1)" if net_type == "tgif" else "BM API Key (v2)"

    api_key = (cfg.bm_api_key or "").strip()
    if not api_key and not allow_fallback:
        return cfg, None, None, _tr("hotspots.net_key_not_configured", fallback="{key_label} is not configured for \"{name}\"", key_label=net_key_label, name=cfg.name or _tr("bm.hotspot_default_name", fallback="Hotspot"))

    if cfg.dmr_id <= 0 and not allow_fallback:
        return cfg, None, None, _tr("hotspots.dmr_id_not_configured", fallback="DMR ID is not configured for \"{name}\"", name=cfg.name or _tr("bm.hotspot_default_name", fallback="Hotspot"))

    device_id = f"{cfg.dmr_id}{cfg.bm_ssid:02d}" if (cfg and cfg.bm_ssid > 0) else str(cfg.dmr_id if (cfg and cfg.dmr_id > 0) else "")
    return cfg, device_id, api_key, None

@app.post("/api/hotspots/test-api-key")
async def test_hotspot_api_key(request: Request):
    """Online validation for BrandMeister v2 API key or TGIF static token."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "detail": _tr("hotspots.invalid_json", fallback="Invalid JSON request")}

    net_type = str(body.get("network_type") or "bm").strip().lower()
    api_key = str(body.get("api_key") or "").strip()
    dmr_id = body.get("dmr_id")
    ssid = body.get("ssid")

    if not api_key:
        return {"ok": False, "detail": _tr("hotspots.api_key_not_specified", fallback="API key not specified")}

    device_id = ""
    if dmr_id:
        try:
            d_int = int(dmr_id)
            s_int = int(ssid) if ssid is not None else 1
            device_id = f"{d_int}{s_int:02d}" if s_int > 0 else str(d_int)
        except Exception:
            device_id = str(dmr_id)

    def _do_http_check():
        import urllib.request, urllib.error
        if net_type == "tgif":
            url = f"https://api.tgif.network/v1/static-talkgroups/{device_id}" if device_id else "https://api.tgif.network/v1/static-talkgroups"
            headers = {
                "User-Agent": "ProxDMR/1.0",
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json"
            }
        else:
            # Default: BrandMeister v2
            url = f"https://api.brandmeister.network/v2/device/{device_id}/profile" if device_id else "https://api.brandmeister.network/v2/profile"
            headers = {
                "User-Agent": "ProxDMR/1.0",
                "Authorization": f"Bearer {api_key}",
                "Accept": "application/json"
            }

        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=4.5) as resp:
                status_code = resp.getcode()
                if 200 <= status_code < 300:
                    return {"ok": True, "detail": _tr("hotspots.auth_ok", fallback="Authorization successful ({code} OK)", code=status_code)}
                return {"ok": False, "detail": _tr("hotspots.server_returned_code", fallback="Server returned code {code}", code=status_code)}
        except urllib.error.HTTPError as e:
            if e.code == 401 or e.code == 403:
                return {"ok": False, "detail": _tr("hotspots.auth_err_invalid_token", fallback="Authorization error: invalid API token ({code})", code=e.code)}
            elif e.code == 404:
                # 404 on profile/device might mean device not found, but key is authenticated
                return {"ok": True, "detail": _tr("hotspots.token_accepted_device_unregistered", fallback="Token accepted by server (device is not registered yet)")}
            return {"ok": False, "detail": f"HTTP {e.code}: {e.reason}"}
        except urllib.error.URLError as e:
            return {"ok": False, "detail": _tr("hotspots.net_err_reason", fallback="Network error: {reason}", reason=e.reason)}
        except Exception as ex:
            return {"ok": False, "detail": _tr("hotspots.check_error", fallback="Check error: {error}", error=str(ex))}

    _ctx = contextvars.copy_context()
    return await asyncio.to_thread(_ctx.run, _do_http_check)


@app.post("/api/hotspots/test-password")
async def test_hotspot_password(request: Request):
    """Fast HomeBrew challenge-response verification (RPTL -> RPTACK -> RPTK -> ACK/NAK)."""
    try:
        body = await request.json()
    except Exception:
        return {"ok": False, "detail": _tr("hotspots.invalid_json", fallback="Invalid JSON request")}

    net_type = str(body.get("network_type") or "bm").strip().lower()
    host = str(body.get("host") or "").strip()
    port = body.get("port") or 62031
    password = str(body.get("password") or "").strip()
    dmr_id = body.get("dmr_id")
    ssid = body.get("ssid")
    hid = str(body.get("hotspot_id") or "").strip()

    try:
        port = int(port)
    except Exception:
        port = 62031

    if not host:
        return {"ok": False, "detail": _tr("hotspots.server_addr_required", fallback="Server address not specified")}

    if not password and net_type not in ("ysf",):
        return {"ok": False, "detail": _tr("hotspots.password_required", fallback="Password not specified")}

    # 1. Fast verification: if this hotspot is ALREADY ONLINE in ProxDMR with matching credentials
    try:
        user = _get_user_from_request(request) if request else None
        uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
        rt = (hotspot_manager.get_runtime(uid, hid) if hid else None) or hotspot_manager.get_active_runtime(uid)
        if rt and getattr(rt, "status", None) and getattr(rt.status, "value", "") == "ONLINE":
            rt_cfg = getattr(rt, "config", None)
            rt_host = str(getattr(rt_cfg, "bm_master_host", "") or getattr(rt, "master_host", "")).strip().lower()
            rt_pwd = str(getattr(rt_cfg, "bm_password", "") or getattr(rt, "password", "")).strip()
            if host.lower() == rt_host and password == rt_pwd:
                return {"ok": True, "detail": _tr("hotspots.already_online_auth", fallback="Hotspot is already connected and authorized online!")}
    except Exception:
        pass

    # Special case: YSF / C4FM (UDP ping)
    if net_type == "ysf":
        def _check_ysf():
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(2.5)
            try:
                call_padded = (str(body.get("callsign") or "NOCALL").upper() + "          ")[:10]
                sock.sendto(b"YSFP" + call_padded.encode("ascii", errors="ignore"), (host, port))
                data, _ = sock.recvfrom(512)
                if data.startswith(b"YSFP") or data.startswith(b"YSFS") or data.startswith(b"YSFA"):
                    return {"ok": True, "detail": _tr("hotspots.ysf_ping_ok", fallback="YSF server is active and responds to poll (YSFP)")}
                return {"ok": False, "detail": _tr("hotspots.ysf_unexpected_resp", fallback="Unexpected response from YSF server ({size} B)", size=len(data))}
            except socket.timeout:
                return {"ok": False, "detail": _tr("hotspots.ysf_ping_timeout", fallback="Timeout: YSF reflector did not respond to UDP poll (YSFP)")}
            except Exception as e:
                return {"ok": False, "detail": _tr("hotspots.ysf_conn_err", fallback="YSF connection error: {error}", error=e)}
            finally:
                sock.close()
        _ctx = contextvars.copy_context()
        return await asyncio.to_thread(_ctx.run, _check_ysf)

    # Special case: AllStarLink (IAX2 node socket check)
    if net_type == "allstar":
        def _check_asl():
            import socket
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(2.5)
            try:
                poke_frame = bytes.fromhex("8000000000000000061e0000")
                sock.sendto(poke_frame, (host, port or 4569))
                data, _ = sock.recvfrom(512)
                return {"ok": True, "detail": _tr("hotspots.asl_node_replied", fallback="AllStarLink node (IAX2) responded")}
            except socket.timeout:
                return {"ok": True, "detail": _tr("hotspots.asl_iax2_open", fallback="IAX2 port is open (node password saved)")}
            except Exception as e:
                return {"ok": False, "detail": _tr("hotspots.asl_conn_err", fallback="Error connecting to ASL node: {error}", error=e)}
            finally:
                sock.close()
        _ctx = contextvars.copy_context()
        return await asyncio.to_thread(_ctx.run, _check_asl)

    # Standard DMR HomeBrew Handshake: BM, TGIF, FreeDMR, DMR+, XLX, ADN, Custom
    def _check_homebrew():
        import socket, struct, hashlib
        rep_id = 123456701
        try:
            d_int = int(dmr_id or 1234567)
            s_int = int(ssid or 1)
            # XLX reflectors use strictly 7-digit ID without SSID
            if net_type == "xlx":
                rep_id = d_int
            else:
                rep_id = int(f"{d_int}{s_int:02d}") if (s_int > 0 and len(str(d_int)) == 7) else d_int
        except Exception:
            rep_id = 123456701

        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(2.5)
        try:
            # 1. Send Login RPTL
            packet = b"RPTL" + struct.pack(">I", rep_id)
            sock.sendto(packet, (host, port))

            # 2. Wait for challenge salt
            data, _ = sock.recvfrom(512)
            salt = b""
            if data.startswith(b"RPTACK") and len(data) >= 10:
                salt = data[6:10]
            elif data.startswith(b"RPTL") and len(data) >= 8:
                salt = data[4:8]
            elif data.startswith(b"MSTNAK") or data.startswith(b"RPTNAK"):
                return {"ok": False, "detail": _tr("hotspots.hb_mstnak", fallback="Server rejected connection (MSTNAK)")}
            else:
                return {"ok": False, "detail": _tr("hotspots.hb_unexpected_resp", fallback="Unexpected server response: {data}", data=repr(data[:8]))}

            # 3. Calculate HomeBrew challenge response: sha256(salt[:4] + password)
            challenge = salt[:4] + password.encode("ascii", errors="ignore")
            auth_hash = hashlib.sha256(challenge).digest()

            # 4. Send Auth RPTK (Repeater Key - 40 bytes)
            auth_packet = b"RPTK" + struct.pack(">I", rep_id) + auth_hash
            sock.sendto(auth_packet, (host, port))

            # 5. Wait for ACK / NAK
            resp_data, _ = sock.recvfrom(512)
            if resp_data.startswith(b"RPTACK") or resp_data.startswith(b"MSTACK") or resp_data.startswith(b"RPTA"):
                # Clean disconnect to avoid leaving zombie repeater on master
                try:
                    sock.sendto(b"RPTCL" + struct.pack(">I", rep_id), (host, port))
                except Exception:
                    pass
                return {"ok": True, "detail": _tr("hotspots.hb_auth_ok", fallback="Authorization successful (RPTACK)! Password is valid")}
            elif resp_data.startswith(b"MSTNAK") or resp_data.startswith(b"RPTNAK"):
                return {"ok": False, "detail": _tr("hotspots.hb_invalid_password", fallback="Invalid hotspot password (server returned MSTNAK)")}
            else:
                return {"ok": False, "detail": _tr("hotspots.hb_unexpected_auth_resp", fallback="Unexpected authorization response: {data}", data=repr(resp_data[:8]))}

        except socket.timeout:
            return {"ok": False, "detail": _tr("hotspots.hb_timeout", fallback="Server did not respond to UDP request (timeout 2.5s)")}
        except Exception as e:
            return {"ok": False, "detail": _tr("hotspots.socket_err", fallback="Socket error: {error}", error=e)}
        finally:
            sock.close()

    _ctx = contextvars.copy_context()
    return await asyncio.to_thread(_ctx.run, _check_homebrew)


@app.get("/api/bm/api-status")
async def get_bm_api_status(hotspot_id: Optional[str] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, allow_fallback=False, user_id=uid)
    net_type = (getattr(cfg, "network_type", "bm") or "bm").strip().lower() if cfg else "bm"
    if not api_key:
        res_nk = {"status": "NO_KEY", "detail": err or _tr("bm.key_not_set", fallback="Key not set"), "device_id": device_id, "network_type": net_type}
        return _mask_bm_resp_for_demo(res_nk, cfg) if (user and user.get("is_demo")) else res_nk

    def _check():
        import urllib.request, urllib.error
        if net_type == "tgif":
            url = f"https://api.tgif.network/v1/static-talkgroups/{device_id}"
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "ProxDMR/1.0",
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json"
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=5) as resp:
                    if resp.status == 200:
                        return {"status": "ONLINE", "network_type": "tgif", "detail": _tr("bm.authorized", fallback="Authorized"), "device_id": device_id}
                    return {"status": "ERROR", "network_type": "tgif", "detail": f"HTTP {resp.status}", "device_id": device_id}
            except urllib.error.HTTPError as e:
                if e.code in (401, 403):
                    return {"status": "AUTH_FAILED", "network_type": "tgif", "detail": _tr("tgif.invalid_token", fallback="Invalid TGIF token (401)"), "device_id": device_id}
                if e.code == 404:
                    return {"status": "ERROR", "network_type": "tgif", "detail": _tr("tgif.device_not_found_short", fallback="Device {device_id} not found in TGIF", device_id=device_id), "device_id": device_id}
                return {"status": "ERROR", "network_type": "tgif", "detail": f"HTTP {e.code}", "device_id": device_id}
            except Exception as e:
                return {"status": "OFFLINE", "network_type": "tgif", "detail": _tr("tgif.api_unreachable", fallback="Server api.tgif.network unreachable"), "device_id": device_id}

        # BM check logic
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
                    return {"status": "ONLINE", "network_type": "bm", "detail": _tr("bm.authorized", fallback="Authorized"), "device_id": device_id}
                return {"status": "ERROR", "network_type": "bm", "detail": f"HTTP {resp.status}", "device_id": device_id}
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                return {"status": "AUTH_FAILED", "network_type": "bm", "detail": _tr("bm.invalid_token_401", fallback="Invalid token (401)"), "device_id": device_id}
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
                            return {"status": "ONLINE", "network_type": "bm", "detail": _tr("bm.authorized", fallback="Authorized"), "device_id": device_id}
                except urllib.error.HTTPError as ef:
                    if ef.code in (401, 403):
                        return {"status": "AUTH_FAILED", "network_type": "bm", "detail": _tr("bm.invalid_token_401", fallback="Invalid token (401)"), "device_id": device_id}
            return {"status": "ERROR", "network_type": "bm", "detail": f"HTTP {e.code}", "device_id": device_id}
        except Exception as e:
            return {"status": "OFFLINE", "network_type": "bm", "detail": _tr("bm.server_unreachable", fallback="BM server unreachable"), "device_id": device_id}

    _ctx = contextvars.copy_context()
    res = await asyncio.to_thread(_ctx.run, _check)
    if user and user.get("is_demo") and isinstance(res, dict):
        res = _mask_bm_resp_for_demo(res, cfg)
    return res

@app.get("/api/tg/names")
async def get_tg_names(network: str = "bm"):
    """Returns all locally cached and synchronized TalkGroup names (BM, TGIF, ADN)."""
    if len(tg_resolver.tgif_cache) < 50:
        await tg_resolver.fetch_tgif_catalog()
    net = (network or "bm").strip().lower()
    if net == "adn":
        adn_hosts_mgr.ensure_fresh_background()
        tg_resolver.ensure_adn_fresh_background()
    if net == "freedmr" and len(tg_resolver.freedmr_cache) < 50:
        await tg_resolver.fetch_freedmr_catalog()
    elif net == "dmrplus":
        dmrplus_hosts_mgr.ensure_fresh_background()
    return {
        "status": "ok",
        "names": tg_resolver.get_all_names(net),
        "tgif_names": tg_resolver.get_all_names("tgif"),
        "freedmr_names": tg_resolver.get_all_names("freedmr"),
        "adn_names": tg_resolver.get_all_names("adn"),
        "dmrplus_names": tg_resolver.get_all_names("dmrplus"),
        "adn_last_sync_ts": int(getattr(tg_resolver, "_adn_last_sync_ts", 0) or 0),
        "adn_sync_in_progress": bool(tg_resolver.is_adn_sync_running() or adn_hosts_mgr.is_sync_running()),
    }

@app.post("/api/tg/lookup")
async def lookup_tg_names(payload: dict):
    """Resolves names for a list of TalkGroups according to network_type."""
    tgs = payload.get("talkgroups", [])
    net = str(payload.get("network") or payload.get("network_type") or "bm").strip().lower()
    if net == "adn":
        adn_hosts_mgr.ensure_fresh_background()
    try:
        tgs = [int(x) for x in tgs if int(x) > 0]
    except Exception:
        tgs = []
    res = await tg_resolver.resolve_many(tgs, network_type=net)
    return {"status": "ok", "network": net, "names": {str(k): v for k, v in res.items()}}


@app.get("/api/tg/stats")
async def get_tg_stats(network: str = "bm"):
    """Returns database statistics for TalkGroups catalog."""
    if (network or "bm").strip().lower() == "adn":
        adn_hosts_mgr.ensure_fresh_background()
    return {"status": "ok", "stats": tg_resolver.get_stats(network_type=network)}

from src.dmr.constants import (
    FREEDMR_MAX_RPTO_BYTES,
    FREEDMR_DEFAULT_OPTS,
    normalize_freedmr_slots,
    parse_freedmr_rpto,
    build_freedmr_rpto,
    DMRPLUS_MAX_STATIC_PER_SLOT,
    DMRPLUS_MAX_RPTO_BYTES,
    parse_dmrplus_rpto,
    build_dmrplus_rpto,
    xlx_module_to_tg,
    xlx_tg_to_module,
)
from src.dmr.freedmr_hosts import freedmr_hosts_mgr
try:
    from dmr.xlx_hosts import xlx_hosts_mgr
except ImportError:
    from src.dmr.xlx_hosts import xlx_hosts_mgr
try:
    from dmr.dmrplus_hosts import dmrplus_hosts_mgr
except ImportError:
    from src.dmr.dmrplus_hosts import dmrplus_hosts_mgr
try:
    from dmr.adn_hosts import adn_hosts_mgr
except ImportError:
    from src.dmr.adn_hosts import adn_hosts_mgr
try:
    from dmr.ysf_directory import ysf_dir_mgr
except ImportError:
    from src.dmr.ysf_directory import ysf_dir_mgr
from src.dmr.server_probe import (
    server_probe_service,
    KNOWN_TGIF_SERVERS,
    KNOWN_DMRPLUS_SERVERS,
    KNOWN_XLX_SERVERS,
)

@app.get("/api/freedmr/hosts")
async def get_freedmr_hosts(request: Request = None):
    """Returns live/cached FreeDMR servers from official hosts list."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    await freedmr_hosts_mgr.fetch_hosts(force=False)
    return freedmr_hosts_mgr.get_hosts()

@app.get("/api/xlx/hosts")
async def get_xlx_hosts(request: Request = None):
    """Returns live/cached XLX reflectors catalog."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    await xlx_hosts_mgr.fetch_hosts(force=False)
    return xlx_hosts_mgr.get_hosts(enriched=True)

@app.get("/api/adn/hosts")
async def get_adn_hosts(force: bool = False, request: Request = None):
    """
    Returns live/cached ADN Systems servers catalog.
    On every entry into an ADN HS (without force), checks 24h TTL and runs background sync
    for both ADN servers and ADN TalkGroups if expired (>24h), returning cached data immediately.
    """
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    if force:
        await asyncio.gather(
            adn_hosts_mgr.fetch_hosts(force=True),
            tg_resolver.fetch_adn_catalog(force=True),
            return_exceptions=True,
        )
        hosts_started = False
        tg_started = False
    else:
        hosts_started = adn_hosts_mgr.ensure_fresh_background()
        tg_started = tg_resolver.ensure_adn_fresh_background()
    payload = adn_hosts_mgr.get_hosts()
    payload["tg_last_sync_ts"] = int(getattr(tg_resolver, "_adn_last_sync_ts", 0) or 0)
    payload["tg_count"] = len(getattr(tg_resolver, "adn_cache", {}) or {})
    payload["sync_in_progress"] = bool(
        hosts_started or tg_started or adn_hosts_mgr.is_sync_running() or tg_resolver.is_adn_sync_running()
    )
    return payload

@app.get("/api/ysf/hosts")
async def get_ysf_hosts(request: Request = None):
    """Returns live/cached YSF reflectors catalog."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    await ysf_dir_mgr.fetch_hosts(force=False)
    return ysf_dir_mgr.get_hosts()

def get_active_ysf_client(hotspot_id: str = "default", user_id: int = 1):
    rt = hotspot_manager.get_runtime(user_id, hotspot_id)
    if not rt or not rt.client:
        return None
    if (getattr(rt.config, "network_type", "") or "").lower() != "ysf":
        return None
    client_obj = getattr(rt.client, "client", rt.client)
    return client_obj if hasattr(client_obj, "request_status") else None

@app.get("/api/ysf/rooms")
async def get_ysf_rooms():
    await ysf_dir_mgr.fetch_hosts(force=False)
    return {"rooms": ysf_dir_mgr.get_hosts().get("rooms", [])}

@app.get("/api/ysf/connected")
async def get_ysf_connected(hotspot_id: str = "default", request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    client = get_active_ysf_client(hotspot_id, uid)
    if not client:
        return {"status": "ok", "connected": False, "online_count": 0, "last_heard": []}
    if client.is_connected:
        client.request_status()
    return {
        "status": "ok",
        "connected": client.is_connected,
        "room_id": getattr(client, "room_id", ""),
        "online_count": getattr(client, "online_count", 0),
        "caller": getattr(client, "current_caller", ""),
        "last_heard": getattr(client, "last_heard", [])
    }

@app.post("/api/ysf/disconnect")
async def post_ysf_disconnect(request: Request):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    try:
        data = await request.json()
    except Exception:
        data = {}
    cid = str(data.get("hotspot_id", "default") or "default").strip()
    rt = hotspot_manager.get_runtime(uid, cid)
    if rt:
        rt._ysf_flow_gen = getattr(rt, "_ysf_flow_gen", 0) + 1
        rt.config.ysf_room = ""
        rt.config.ysf_room_id = ""
        rt.config.ysf_name = ""
        rt.config.ysf_room_name = ""
        rt.config.ysf_host = ""
        rt.config.bm_master_host = ""
        if rt.client:
            if hasattr(rt.client, "_is_manual_disconnect"):
                rt.client._is_manual_disconnect = True
            inner_client = getattr(rt.client, "client", rt.client)
            if inner_client is not None:
                if hasattr(inner_client, "_manual_disconnect"):
                    inner_client._manual_disconnect = True
                if hasattr(inner_client, "_connect_gen"):
                    inner_client._connect_gen += 1
    ok = await hotspot_manager.disconnect_hotspot(cid, user_id=uid)
    rt = hotspot_manager.get_runtime(uid, cid)
    if rt:
        rt.config.ysf_room = ""
        rt.config.ysf_room_id = ""
        rt.config.ysf_name = ""
        rt.config.ysf_room_name = ""
        rt.config.ysf_host = ""
        rt.config.bm_master_host = ""
        if rt.client and hasattr(rt.client, "clear_target"):
            rt.client.clear_target()
        rt.status = BMState.DISCONNECTED
        rt.detail = _tr("ysf.disconnected_wait_room", user_id=uid, fallback="Disconnected (waiting for room selection)")
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        for i, h in enumerate(user_sett.hotspots):
            if h.id == rt.config.id:
                user_sett.hotspots[i] = rt.config
                break
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        hotspot_manager._notify_async({
            "type": "hotspot_updated",
            "hotspot": rt.to_dict(),
            "user_id": uid,
        }, user_id=uid)
    return {"status": "ok", "disconnected": bool(ok)}


@app.post("/api/ysf/dg-id")
async def post_ysf_dg_id(request: Request):
    """Быстрая смена подписки RX DG-ID и/или TX DG-ID с мгновенной отправкой YSFO без разрыва сокета."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    try:
        data = await request.json()
    except Exception:
        data = {}

    cid = str(data.get("hotspot_id", "default") or "default").strip()
    rt = hotspot_manager.get_runtime(uid, cid) or hotspot_manager.get_active_runtime(uid)
    if not rt or (getattr(rt.config, "network_type", "") or "").lower() != "ysf":
        raise HTTPException(status_code=404, detail=_tr("ysf.active_hotspot_not_found", fallback="Active YSF hotspot not found"))

    from dmr.ysf_directory import (
        ysf_dir_mgr,
        classify_ysf_reflector,
        normalize_ysf_dg_id_options,
        ensure_ysf_dg_id_includes_tx,
        resolve_ysf_room_dg_id_settings,
    )

    active_rid = str(getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", "") or "25000").strip()
    target_rid = str(data.get("room_id") or active_rid).strip() or active_rid
    found_room = ysf_dir_mgr.get_room_by_id(target_rid)
    user_room_types = (getattr(hotspot_manager, "user_ysf_room_types", None) or {}).get(uid, {}) or {}
    room_override = str(user_room_types.get(target_rid) or "").strip().lower()
    cls_info = classify_ysf_reflector(
        room=found_room,
        name=getattr(rt.config, "ysf_room_name", "") or getattr(rt.config, "ysf_name", "") or "",
        host=getattr(rt.config, "ysf_host", "") or getattr(rt.config, "bm_master_host", "") or "",
        room_id=target_rid,
        override=room_override,
    )
    is_mr = bool(cls_info["is_multiroom"])

    cur_rx, cur_tx, _, _ = resolve_ysf_room_dg_id_settings(
        rt.config, target_rid, found_room, room_type_override=room_override
    )

    if "rx_dg_id" in data:
        new_rx = normalize_ysf_dg_id_options(str(data.get("rx_dg_id") or ""), is_multiroom=is_mr)
    else:
        new_rx = cur_rx

    if "tx_dg_id" in data:
        raw_tx = data.get("tx_dg_id")
        if raw_tx is None or str(raw_tx).strip() == "" or str(raw_tx).strip() == "0" or str(raw_tx).strip() == "00":
            new_tx: Optional[int] = None
        else:
            try:
                v_tx = int(raw_tx)
                new_tx = v_tx if 1 <= v_tx <= 99 else None
            except (ValueError, TypeError):
                raise HTTPException(status_code=400, detail=_tr("ysf.invalid_tx_dg_id", fallback="Invalid TX DG-ID (allowed 1..99)"))
    else:
        new_tx = cur_tx

    if new_tx is not None:
        new_rx = ensure_ysf_dg_id_includes_tx(new_rx, new_tx, is_multiroom=is_mr)

    if not isinstance(getattr(rt.config, "ysf_room_dg_ids", None), dict):
        rt.config.ysf_room_dg_ids = {}
    rt.config.ysf_room_dg_ids[target_rid] = {
        "rx_dg_id": new_rx,
        "tx_dg_id": new_tx,
    }

    ysfo_sent = False
    if target_rid == active_rid:
        rt.config.ysf_dg_id = new_rx
        rt.config.ysf_tx_dg_id = new_tx
        client_obj = getattr(rt.client, "client", rt.client) if rt.client else None
        if client_obj and hasattr(client_obj, "set_dg_id_live"):
            ysfo_sent = bool(client_obj.set_dg_id_live(
                dg_id=new_rx,
                tx_dg_id=new_tx,
                is_multiroom=is_mr,
                reflector_type=cls_info["reflector_type"],
                multiroom_kind=cls_info["multiroom_kind"],
            ))

    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
    for i, h in enumerate(user_sett.hotspots):
        if h.id == rt.config.id:
            user_sett.hotspots[i] = rt.config
            break
    await save_user_settings(uid, user_sett.model_dump())
    if uid == 1:
        save_app_settings(user_sett)

    hotspot_dict = rt.to_dict()
    await broadcast_user_json(uid, {
        "type": "hotspot_updated",
        "hotspot": hotspot_dict,
        "user_id": uid,
    })

    return {
        "status": "ok",
        "room_id": target_rid,
        "rx_dg_id": new_rx,
        "tx_dg_id": new_tx,
        "is_multiroom": is_mr,
        "reflector_type": cls_info["reflector_type"],
        "multiroom_kind": cls_info["multiroom_kind"],
        "ysfo_sent": ysfo_sent,
        "hotspot": hotspot_dict,
    }

@app.get("/api/ysf/dice")
async def get_ysf_dice(exclude: str = ""):
    if not ysf_dir_mgr._top_active_rooms:
        await ysf_dir_mgr.refresh_top_active_rooms(force=False)
    exclude_set = {x.strip() for x in str(exclude or "").split(",") if x.strip()}
    room, live_rx, active_caller = await ysf_dir_mgr.pick_live_or_active_dice_room(exclude_ids=exclude_set or None)
    if not room:
        return {"status": "error", "message": "No rooms available"}
    return {
        "status": "ok",
        "room": room,
        "online_count": room.get("connections", 0),
        "live_rx": live_rx,
        "active_caller": active_caller
    }

@app.get("/api/adn/dice")
async def get_adn_dice(exclude: str = ""):
    exclude_set = set()
    for x in str(exclude or "").split(","):
        x = x.strip()
        if x.isdigit():
            exclude_set.add(int(x))
    tg_item, live_rx, active_caller = await adn_hosts_mgr.pick_live_or_active_adn_tg(exclude_ids=exclude_set or None)
    if not tg_item:
        return {"status": "empty", "talkgroup": None}
    return {
        "status": "ok",
        "talkgroup": tg_item,
        "live_rx": live_rx,
        "active_caller": active_caller
    }

@app.get("/api/ysf/active_top")
async def get_ysf_active_top():
    """Returns top active YSF rooms ranked by online client count."""
    if not ysf_dir_mgr._top_active_rooms:
        await ysf_dir_mgr.refresh_top_active_rooms(force=False)
    return {
        "status": "ok",
        "count": len(ysf_dir_mgr._top_active_rooms),
        "generated_at": int(ysf_dir_mgr._last_active_scan_ts),
        "rooms": ysf_dir_mgr._top_active_rooms[:100]
    }

class YsfMatrixProbeRequest(BaseModel):
    hotspot_id: str = "default"
    rooms: List[str] = []
    force: bool = False

@app.post("/api/ysf/matrix-status")
async def api_ysf_matrix_status(req: YsfMatrixProbeRequest, request: Request = None):
    """Проверяет доступность (online/offline), количество подключений и активность для списка комнат YSF."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    try:
        results = await ysf_dir_mgr.probe_rooms_batch(req.rooms, force=req.force)
        client = get_active_ysf_client(req.hotspot_id, uid)
        if client and client.is_connected:
            c_room = str(getattr(client, "room_id", "")).strip()
            c_room_int = str(int(c_room)) if c_room.isdigit() else c_room
            for target_k in (c_room, c_room_int):
                if target_k in results or target_k in req.rooms:
                    is_talking = bool(getattr(client, "is_rx", False) or getattr(client, "is_tx", False))
                    cnt = getattr(client, "online_count", 0) or results.get(target_k, {}).get("connections", 1)
                    results[target_k] = {
                        "room": target_k,
                        "online": True,
                        "connections": cnt,
                        "keyed": is_talking,
                        "traffic_level": "high" if is_talking else results.get(target_k, {}).get("traffic_level", "medium")
                    }
        return {
            "status": "ok",
            "hotspot_id": req.hotspot_id,
            "rooms": results
        }
    except Exception as e:
        logger.error(f"[YSF] Matrix status probe error: {e}", exc_info=True)
        return {
            "status": "error",
            "hotspot_id": req.hotspot_id,
            "rooms": {}
        }

@app.post("/api/xlx/hosts/refresh")
async def refresh_xlx_hosts(request: Request = None):
    """Force re-fetches and updates XLX reflectors catalog."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    servers = await xlx_hosts_mgr.fetch_hosts(force=True)
    return {
        "status": "ok",
        "count": len(servers),
        "source": xlx_hosts_mgr._source,
        "generated_at": int(xlx_hosts_mgr._last_loaded_ts)
    }

@app.get("/api/dmrplus/hosts")
async def get_dmrplus_hosts(force: bool = False, request: Request = None):
    """Returns live/cached DMR+ (IPSC2) servers catalog with 24h non-blocking background refresh."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    if force:
        await dmrplus_hosts_mgr.fetch_hosts(force=True)
        started = False
    else:
        started = dmrplus_hosts_mgr.ensure_fresh_background()
    payload = dmrplus_hosts_mgr.get_hosts_payload(enriched=True)
    payload["sync_in_progress"] = bool(started or payload.get("sync_in_progress"))
    return payload

@app.post("/api/dmrplus/hosts/refresh")
async def refresh_dmrplus_hosts(request: Request = None):
    """Force re-fetches and updates DMR+ servers catalog."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    servers = await dmrplus_hosts_mgr.fetch_hosts(force=True)
    return {
        "status": "ok",
        "count": len(servers),
        "source": dmrplus_hosts_mgr._source,
        "generated_at": int(dmrplus_hosts_mgr._last_loaded_ts)
    }

@app.get("/api/allstar/nodes")
async def get_allstar_nodes(q: str = "", limit: int = 50):
    """Searches AllStarLink global nodes by number, callsign, name, or location."""
    from allstar_directory import allstar_dir_mgr
    await allstar_dir_mgr.fetch_nodes(force=False)
    return allstar_dir_mgr.search(query=q, limit=limit)

@app.post("/api/allstar/nodes/sync")
async def sync_allstar_nodes():
    """Force refreshes AllStarLink database from http://allmondb.allstarlink.org/."""
    from allstar_directory import allstar_dir_mgr
    nodes = await allstar_dir_mgr.fetch_nodes(force=True)
    return {
        "status": "ok",
        "total": len(nodes),
        "last_sync": int(allstar_dir_mgr._last_loaded_ts),
        "source": allstar_dir_mgr._source
    }

@app.get("/api/allstar/nodes/stats")
async def get_allstar_nodes_stats():
    """Returns AllStarLink node database stats."""
    from allstar_directory import allstar_dir_mgr
    return {"status": "ok", "stats": allstar_dir_mgr.get_stats()}

@app.get("/api/allstar/keyed")
async def get_allstar_keyed_nodes(force: bool = False):
    """Returns currently transmitting (keyed) public AllStarLink nodes from stats.allstarlink.org/stats/keyed."""
    from allstar_directory import allstar_dir_mgr
    nodes = await allstar_dir_mgr.fetch_keyed_nodes(force=force)
    return {
        "status": "ok",
        "count": len(nodes),
        "cached_at": int(getattr(allstar_dir_mgr, "_keyed_cache_ts", 0) or 0),
        "nodes": nodes
    }

class AllStarCTCSSUpdate(BaseModel):
    hotspot_id: str = "default"
    enabled: bool = True

@app.post("/api/allstar/ctcss")
async def set_allstar_ctcss(update: AllStarCTCSSUpdate, request: Request = None):
    """Sets CTCSS filter mode (enabled: bool) for AllStarLink hotspot."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    hid = str(update.hotspot_id).strip()
    enabled = bool(update.enabled)
    target_hs = (hotspot_manager.get_runtime(uid, hid) if hid else None) or hotspot_manager.get_active_runtime(uid)
    if target_hs:
        adapter = getattr(target_hs, "client", None)
        if adapter and hasattr(adapter, "ctcss_filter_enabled"):
            adapter.ctcss_filter_enabled = enabled
        asl = getattr(target_hs, "allstar_client", None)
        if asl and hasattr(asl, "ctcss_filter_enabled"):
            asl.ctcss_filter_enabled = enabled
    return {"status": "ok", "hotspot_id": hid, "ctcss_filter_enabled": enabled}

class AllStarNodeAction(BaseModel):
    hotspot_id: str = "default"
    target_node: str
    mode: str = "*3"
    add_mode: Optional[bool] = None
    show_status_banner: Optional[bool] = True
    show_card_effects: Optional[bool] = True

async def _execute_asl_disconnect_flow(
    uid: int,
    target_hs,
    disc_target: str = "all",
    show_status_banner: bool = True,
    show_card_effects: bool = True
) -> dict:
    """Оркестратор отключения AllStarLink ХН с обратной связью по WebSocket."""
    if not hasattr(target_hs, "_asl_flow_lock"):
        target_hs._asl_flow_lock = asyncio.Lock()

    async with target_hs._asl_flow_lock:
        own_node = str(getattr(target_hs.config, "allstar_node", "1999") or "1999").strip()
        from asl_container_manager import asl_container_mgr
        from dmr.homebrew import BMState

        loop = asyncio.get_running_loop()
        def emit_step(step_data: dict):
            payload = {
                "type": "allstar_proc_step",
                "hotspot_id": target_hs.config.id,
                **step_data
            }
            asyncio.run_coroutine_threadsafe(broadcast_user_json(uid, payload), loop)

        res = await asyncio.to_thread(
            asl_container_mgr.run_disconnect_procedure,
            user_id=str(uid),
            node_number=own_node,
            target_node=disc_target,
            show_status_banner=show_status_banner,
            show_card_effects=show_card_effects,
            step_cb=emit_step
        )

        asl = getattr(target_hs, "allstar_client", None)
        if asl and asl.is_connected:
            if disc_target in ("all", "*73", "*76", "0", ""):
                asl.send_dtmf("*73")
            else:
                asl.send_dtmf(f"*1{disc_target}")

        is_all = disc_target in ("all", "*73", "*76", "0", "")
        if is_all:
            target_hs.connected_node = ""
            target_hs.is_asl_linked = False
            target_hs.asl_links = []
            target_hs.asl_online_count = 0
        else:
            if str(getattr(target_hs, "connected_node", "")).strip() == disc_target:
                target_hs.connected_node = ""
                target_hs.is_asl_linked = False
            if hasattr(target_hs, "asl_links") and isinstance(target_hs.asl_links, list):
                target_hs.asl_links = [l for l in target_hs.asl_links if str(l.get("node", "")).strip() != disc_target]
                target_hs.asl_online_count = len(target_hs.asl_links)

        if not target_hs.connected_node and not getattr(target_hs, "asl_links", None):
            target_hs.status = BMState.DISCONNECTED
            target_hs.detail = _tr("common.disconnected", user_id=uid, fallback="Disconnected")
            await broadcast_user_json(uid, {
                "type": "bm_status",
                "hotspot_id": target_hs.config.id,
                "status": "DISCONNECTED",
                "detail": _tr("common.disconnected", user_id=uid, fallback="Disconnected"),
                "user_id": uid
            })

        await broadcast_user_json(uid, {
            "type": "allstar_node_disconnected",
            "hotspot_id": target_hs.config.id,
            "node": disc_target
        })
        return res

async def _execute_ysf_connect_flow(
    uid: int,
    target_hs,
    room_id: str,
    room_name: str = "",
    host: str = "",
    port: int = 0
):
    """Пошаговый оркестратор подключения YSF с пер-хотспотной блокировкой и выводом реальных этапов."""
    if not hasattr(target_hs, "_ysf_flow_lock"):
        target_hs._ysf_flow_lock = asyncio.Lock()

    my_flow_gen = getattr(target_hs, "_ysf_flow_gen", 0) + 1
    target_hs._ysf_flow_gen = my_flow_gen

    async with target_hs._ysf_flow_lock:
        if getattr(target_hs, "_ysf_flow_gen", 0) != my_flow_gen:
            return
        hid = target_hs.config.id
        loop = asyncio.get_running_loop()

        def emit_step(step_data: dict):
            if getattr(target_hs, "_ysf_flow_gen", 0) != my_flow_gen:
                return
            payload = {
                "type": "ysf_proc_step",
                "hotspot_id": hid,
                **step_data
            }
            asyncio.run_coroutine_threadsafe(broadcast_user_json(uid, payload), loop)

        s_room = str(room_id).strip()

        # 1. Поиск в реестре
        emit_step({
            "proc": "connect",
            "state": "progress",
            "code": "lookup",
            "room_id": s_room,
            "tone": "neutral",
            "text": _tr("ysf.lookup_progress", user_id=uid, fallback="Reflector #{room_id}: looking up address in YSF registry...", room_id=s_room)
        })

        from dmr.ysf_directory import ysf_dir_mgr
        rooms = ysf_dir_mgr.get_hosts().get("rooms", [])
        found = next((r for r in rooms if str(r.get("id")).strip() == s_room), None)

        # Приоритет источников хоста: (1) реестр по номеру комнаты; (2) фронтенд, если не цифры и не номер комнаты
        target_host = ""
        target_port = 42000
        if found and found.get("host"):
            target_host = str(found.get("host")).strip()
            target_port = int(found.get("port", 42000) or 42000)
        elif host and not host.strip().isdigit() and host.strip() != s_room:
            target_host = host.strip()
            target_port = int(port) if (port and 1 <= int(port) <= 65535) else 42000

        if not target_host:
            emit_step({
                "proc": "connect",
                "state": "failed",
                "code": "not_found",
                "room_id": s_room,
                "tone": "negative",
                "text": _tr("ysf.not_found_in_registry", user_id=uid, fallback="✕ Reflector #{room_id}: address not found in YSF registry", room_id=s_room),
                "auto_hide_ms": 4000
            })
            return

        resolved_name = (found.get("reflector_name") or found.get("name") if found else "") or room_name or f"YSF #{s_room}"

        from dmr.ysf_directory import resolve_ysf_room_dg_id_settings, classify_ysf_reflector
        # Запись настроек хотспота
        target_hs.config.ysf_host = target_host
        target_hs.config.ysf_port = target_port
        target_hs.config.ysf_room_id = s_room
        target_hs.config.ysf_room_name = resolved_name
        target_hs.config.ysf_room = s_room
        target_hs.config.ysf_name = resolved_name
        target_hs.config.bm_master_host = target_host
        target_hs.config.bm_master_port = target_port

        user_room_types = (getattr(hotspot_manager, "user_ysf_room_types", None) or {}).get(uid, {}) or {}
        room_override = str(user_room_types.get(s_room) or "").strip().lower()
        rx_dg_id, tx_dg_id, is_multiroom, mr_kind = resolve_ysf_room_dg_id_settings(
            target_hs.config, s_room, found, room_type_override=room_override
        )
        cls_info = classify_ysf_reflector(
            room=found, name=resolved_name, host=target_host, room_id=s_room, override=room_override
        )
        target_hs.config.ysf_dg_id = rx_dg_id
        target_hs.config.ysf_tx_dg_id = tx_dg_id

        # Сохранение настроек пользователя
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        for i, h in enumerate(user_sett.hotspots):
            if h.id == hid:
                user_sett.hotspots[i] = target_hs.config
                break
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)

        terminal_emitted = False

        # Привязка реального колбэка этапов плашки
        def _proc_step_cb(code: str, text: str, tone: str, state: str):
            nonlocal terminal_emitted
            if state in ("done", "failed"):
                terminal_emitted = True
            emit_step({
                "proc": "connect",
                "state": state,
                "code": code,
                "room_id": s_room,
                "room_name": resolved_name,
                "host": target_host,
                "port": target_port,
                "dg_id": rx_dg_id,
                "tx_dg_id": tx_dg_id,
                "is_multiroom": is_multiroom,
                "reflector_type": cls_info["reflector_type"],
                "multiroom_kind": mr_kind,
                "tone": tone,
                "text": text,
                "auto_hide_ms": 4000 if state in ("done", "failed") else 0
            })

        if getattr(target_hs, "_ysf_flow_gen", 0) != my_flow_gen:
            return

        client_obj = getattr(target_hs.client, "client", target_hs.client)
        if hasattr(client_obj, "on_proc_step"):
            client_obj.on_proc_step = _proc_step_cb

        if hasattr(target_hs.client, "retarget"):
            target_hs.client.retarget(
                target_host,
                target_port,
                s_room,
                resolved_name,
                dg_id=rx_dg_id,
                tx_dg_id=tx_dg_id,
                is_multiroom=is_multiroom,
                reflector_type=cls_info["reflector_type"],
                multiroom_kind=mr_kind,
                room_type_override=room_override,
            )

        ok = False
        try:
            ok = await hotspot_manager.reconnect_hotspot(hid, user_id=uid)
        except Exception as e:
            logger.error(f"[YSF] Connect flow error on {hid} room #{s_room}: {e}")
            ok = False

        if getattr(target_hs, "_ysf_flow_gen", 0) != my_flow_gen:
            if target_hs.client and target_hs.client.is_connected:
                await target_hs.client.disconnect()
            return

        if ok:
            hotspot_manager._notify_async({
                "type": "hotspot_updated",
                "hotspot": target_hs.to_dict(),
                "user_id": uid,
            }, user_id=uid)
        else:
            target_hs.status = BMState.DISCONNECTED
            if not terminal_emitted:
                emit_step({
                    "proc": "connect",
                    "state": "failed",
                    "code": "connect_failed",
                    "room_id": s_room,
                    "room_name": resolved_name,
                    "host": target_host,
                    "port": target_port,
                    "tone": "negative",
                    "text": _tr("ysf.connect_failed", user_id=uid, fallback="✕ Failed to connect to reflector #{room_id}", room_id=s_room),
                    "auto_hide_ms": 4000
                })

async def _execute_asl_connect_flow(
    uid: int,
    target_hs,
    node: str,
    mode: str = "*2",
    show_status_banner: bool = True,
    show_card_effects: bool = True
) -> dict:
    """Оркестратор последовательного подключения ХН: Disconnect First -> Verify 0 Links -> Connect Next."""
    if not hasattr(target_hs, "_asl_flow_lock"):
        target_hs._asl_flow_lock = asyncio.Lock()

    async with target_hs._asl_flow_lock:
        own_node = str(getattr(target_hs.config, "allstar_node", "1999") or "1999").strip()
        from asl_container_manager import asl_container_mgr
        from dmr.homebrew import BMState

        loop = asyncio.get_running_loop()
        def emit_step(step_data: dict):
            payload = {
                "type": "allstar_proc_step",
                "hotspot_id": target_hs.config.id,
                **step_data
            }
            asyncio.run_coroutine_threadsafe(broadcast_user_json(uid, payload), loop)

        node = str(node).strip()
        mode_clean = "*3" if (node in ("1999", "9999") or mode in ("*3", "perm", "transceive")) else "*2"

        # Шаг А: Сначала отключение старого ХН (Disconnect First)
        current_links = await asyncio.to_thread(asl_container_mgr.get_connected_links, str(uid), own_node)
        has_existing = bool(current_links) or bool(getattr(target_hs, "connected_node", None))

        if has_existing:
            logger.info(f"[ASL-FLOW] Existing links detected before connecting to {node}. Running disconnect flow first.")
            disc_res = await asyncio.to_thread(
                asl_container_mgr.run_disconnect_procedure,
                user_id=str(uid),
                node_number=own_node,
                target_node="all",
                show_status_banner=show_status_banner,
                show_card_effects=show_card_effects,
                step_cb=emit_step
            )
            target_hs.connected_node = ""
            target_hs.is_asl_linked = False
            target_hs.asl_links = []
            target_hs.asl_online_count = 0
            
            # Короткая пауза 550 мс, чтобы глаз пользователя зафиксировал завершение отключения старого ХН
            await asyncio.sleep(0.55)

        # Шаг Б: Подключение нового ХН (Connect Next)
        logger.info(f"[ASL-FLOW] Connecting to #{node} (mode {mode_clean}) on {own_node}")
        target_hs._connecting_asl_node = node
        target_hs._last_asl_node = node
        asl_pre = getattr(target_hs, "allstar_client", None)
        if asl_pre:
            asl_pre._last_asl_node = node
        try:
            res = await asyncio.to_thread(
                asl_container_mgr.run_connect_procedure,
                user_id=str(uid),
                node_number=own_node,
                target_node=node,
                mode=mode_clean,
                show_status_banner=show_status_banner,
                show_card_effects=show_card_effects,
                step_cb=emit_step
            )
        finally:
            target_hs._connecting_asl_node = ""

        # Шаг В: Финализация состояния target_hs строго по факту res["success"]
        if res.get("success"):
            target_hs.connected_node = node
            target_hs._last_asl_node = node
            target_hs.is_asl_linked = True
            target_hs.asl_links = res.get("links") or [{"node": node, "mode": mode_clean, "direction": "OUT"}]
            target_hs.asl_online_count = len(target_hs.asl_links)
            target_hs.status = BMState.ONLINE
            target_hs.detail = f"AllStarLink Node {node}"

            asl = getattr(target_hs, "allstar_client", None)
            if asl:
                asl._last_asl_node = node

            await broadcast_user_json(uid, {
                "type": "bm_status",
                "hotspot_id": target_hs.config.id,
                "status": "ONLINE",
                "detail": f"AllStarLink Node {node}",
                "user_id": uid
            })
            await broadcast_user_json(uid, {
                "type": "allstar_node_changed",
                "hotspot_id": target_hs.config.id,
                "node": node,
                "mode": mode_clean
            })
        else:
            target_hs.connected_node = ""
            target_hs.is_asl_linked = False
            target_hs.asl_links = []
            target_hs.asl_online_count = 0
            target_hs.status = BMState.DISCONNECTED
            target_hs.detail = _tr("common.disconnected", user_id=uid, fallback="Disconnected")

            await broadcast_user_json(uid, {
                "type": "bm_status",
                "hotspot_id": target_hs.config.id,
                "status": "DISCONNECTED",
                "detail": _tr("common.disconnected", user_id=uid, fallback="Disconnected"),
                "user_id": uid
            })
            await broadcast_user_json(uid, {
                "type": "allstar_node_disconnected",
                "hotspot_id": target_hs.config.id,
                "node": node,
                "failed_node": node,
                "reason": res.get("reason", "failed")
            })

        return res

@app.post("/api/allstar/connect")
async def api_allstar_connect(action: AllStarNodeAction, request: Request = None):
    """Connects user's AllStarLink node to a remote node."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    target_hs = (hotspot_manager.get_runtime(uid, action.hotspot_id) if action.hotspot_id else None) or hotspot_manager.get_active_runtime(uid)
    if not target_hs:
        return {"status": "error", "message": "No active AllStarLink hotspot found"}
    own_node = str(getattr(target_hs.config, "allstar_node", "1999") or "1999").strip()
    res = await _execute_asl_connect_flow(
        uid=uid,
        target_hs=target_hs,
        node=action.target_node,
        mode="*3" if action.mode in ("*3", "perm") else "*2",
        show_status_banner=action.show_status_banner if action.show_status_banner is not None else True,
        show_card_effects=action.show_card_effects if action.show_card_effects is not None else True
    )
    return {"status": "ok" if res.get("success") else "error", "own_node": own_node, "target_node": action.target_node, "result": res}

@app.post("/api/allstar/disconnect")
async def api_allstar_disconnect(action: AllStarNodeAction, request: Request = None):
    """Disconnects user's AllStarLink node from a remote node."""
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    target_hs = (hotspot_manager.get_runtime(uid, action.hotspot_id) if action.hotspot_id else None) or hotspot_manager.get_active_runtime(uid)
    if not target_hs:
        return {"status": "error", "message": "No active AllStarLink hotspot found"}
    own_node = str(getattr(target_hs.config, "allstar_node", "1999") or "1999").strip()
    disc_target = str(action.target_node or "").strip()
    res = await _execute_asl_disconnect_flow(
        uid=uid,
        target_hs=target_hs,
        disc_target=disc_target,
        show_status_banner=action.show_status_banner if action.show_status_banner is not None else True,
        show_card_effects=action.show_card_effects if action.show_card_effects is not None else True
    )
    return {"status": "ok" if res.get("success") else "error", "own_node": own_node, "target_node": action.target_node, "result": res}

@app.get("/api/allstar/connected")
async def api_allstar_connected(hotspot_id: str = "default", request: Request = None):
    """Returns list of remote nodes currently connected to this AllStar node with telemetry."""
    user = _get_user_from_request(request) if request else None
    if user and user.get("is_demo"):
        return {"status": "ok", "connected_nodes": [], "links": [], "hub_nodes": [], "hub_info": None, "keyed_nodes": [], "online_count": 0, "rtt": 0, "jitter": 0}
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    target_hs = (hotspot_manager.get_runtime(uid, hotspot_id) if hotspot_id else None) or hotspot_manager.get_active_runtime(uid)
    if not target_hs:
        return {"status": "ok", "connected_nodes": [], "links": [], "hub_nodes": [], "hub_info": None, "keyed_nodes": [], "online_count": 0, "rtt": 0, "jitter": 0}
    own_node = str(getattr(target_hs.config, "allstar_node", "1999") or "1999").strip()
    links = []
    hub_nodes = []
    hub_info = None
    keyed_nodes = []
    established_nodes = []
    nodes = []
    try:
        from asl_container_manager import asl_container_mgr
        topo = await asyncio.to_thread(asl_container_mgr.get_hub_topology, str(uid), own_node)
        links = topo.get("links") or []
        hub_nodes = topo.get("hub_nodes") or []
        hub_info = topo.get("hub_info")
        keyed_nodes = list(topo.get("keyed_nodes") or [])
        established_nodes = [l["node"] for l in links if isinstance(l, dict) and "node" in l and not l.get("connecting")] if links else []
        nodes = [l["node"] for l in links if isinstance(l, dict) and "node" in l]
    except Exception as e:
        logger.warning(f"[ALLSTAR] Error querying links for node {own_node}: {e}")

    prev_hub_nodes = getattr(target_hs, "asl_hub_nodes", None) or []
    prev_conn_node = str(getattr(target_hs, "connected_node", "") or "").strip()
    cur_conn_node = str(established_nodes[0]).strip() if established_nodes else ""
    if cur_conn_node and len(hub_nodes) <= 1 and len(prev_hub_nodes) > 1 and (not prev_conn_node or prev_conn_node == cur_conn_node):
        k_set = {str(x).strip() for x in (keyed_nodes or [])}
        hub_nodes = [dict(item, keyed=(str(item.get("node", "")).strip() in k_set)) for item in prev_hub_nodes]

    online_count = len(established_nodes)
    target_hs.asl_online_count = online_count
    target_hs.asl_links = links
    target_hs.asl_hub_nodes = hub_nodes if established_nodes else []

    asl_client = getattr(target_hs, "allstar_client", None)
    is_client_connected = bool(asl_client and asl_client.is_connected)
    from dmr.homebrew import BMState

    if established_nodes:
        target_hs.connected_node = str(established_nodes[0])
        target_hs.is_asl_linked = True
        if getattr(target_hs, "status", None) != BMState.ONLINE:
            target_hs.status = BMState.ONLINE
            target_hs.detail = f"AllStarLink Node {established_nodes[0]}"
            hotspot_manager._notify_async({
                "type": "bm_status",
                "hotspot_id": target_hs.config.id,
                "status": "ONLINE",
                "detail": f"AllStarLink Node {established_nodes[0]}",
                "user_id": uid
            }, user_id=uid)
    else:
        target_hs.connected_node = ""
        target_hs.is_asl_linked = False
        if is_client_connected and getattr(target_hs, "status", None) != BMState.ONLINE:
            target_hs.status = BMState.ONLINE
            target_hs.detail = f"AllStarLink (Node {own_node})"
            hotspot_manager._notify_async({
                "type": "bm_status",
                "hotspot_id": target_hs.config.id,
                "status": "ONLINE",
                "detail": f"AllStarLink (Node {own_node})",
                "user_id": uid
            }, user_id=uid)

    rtt = 0.0
    jitter = 0.0
    # Determine target node: active talking node, last transmitted node, or connected node
    target_node = (
        getattr(target_hs, "_active_asl_node", None)
        or getattr(target_hs, "_last_asl_node", None)
        or getattr(target_hs, "connected_node", None)
    )
    if not target_node and links:
        target_node = links[0].get("node")

    if target_node:
        def _resolve_node_rtt_sync(u_str: str, own_n: str, tgt_n: str, is_rx_now: bool):
            loc_rtt = 0.0
            loc_jit = 0.0
            try:
                from asl_container_manager import asl_container_mgr
                netstats = asl_container_mgr.get_node_netstats(u_str, own_n)
                node_stat = netstats.get(str(tgt_n))
                if node_stat and node_stat.get("rtt"):
                    loc_rtt = float(node_stat["rtt"])
                    loc_jit = float(node_stat.get("jitter", 0.0))
                elif not is_rx_now:
                    target_ip = (node_stat.get("ip") if node_stat else None) or asl_container_mgr.lookup_node_ip(u_str, own_n, str(tgt_n))
                    if target_ip:
                        from ping import measure_host_ping_and_loss
                        p_rtt, _ = measure_host_ping_and_loss(target_ip, 1, 0.25)
                        if p_rtt:
                            loc_rtt = float(p_rtt)
            except Exception:
                pass
            return loc_rtt, loc_jit

        is_rx_active = bool(asl_client and getattr(asl_client, "is_rx", False))
        rtt, jitter = await asyncio.to_thread(
            _resolve_node_rtt_sync, str(uid), own_node, str(target_node), is_rx_active
        )

    if rtt == 0.0 and hasattr(bm_ping_service, "cached_pings"):
        cached = bm_ping_service.cached_pings.get(target_hs.config.id)
        if cached and cached > 0:
            rtt = float(cached)

    if hasattr(target_hs, "allstar_client") and target_hs.allstar_client:
        if rtt > 0:
            target_hs.allstar_client.current_rtt_ms = rtt
            target_hs.allstar_client.current_jitter_ms = jitter
        else:
            rtt = getattr(target_hs.allstar_client, "current_rtt_ms", 0.0)
            jitter = getattr(target_hs.allstar_client, "current_jitter_ms", 0.0)

    active_rx_node = str(getattr(target_hs, "_active_asl_node", "") or "").strip()
    if active_rx_node and active_rx_node not in keyed_nodes:
        keyed_nodes.insert(0, active_rx_node)

    return {
        "status": "ok",
        "own_node": own_node,
        "connected_nodes": nodes,
        "links": links,
        "hub_nodes": hub_nodes,
        "hub_info": hub_info,
        "keyed_nodes": keyed_nodes,
        "active_node": active_rx_node or (keyed_nodes[0] if keyed_nodes else ""),
        "online_count": online_count,
        "rtt": rtt,
        "jitter": jitter,
    }

class AllStarMatrixProbeRequest(BaseModel):
    hotspot_id: str = "default"
    nodes: List[str] = []
    force: bool = False

@app.post("/api/allstar/matrix-status")
async def api_allstar_matrix_status(req: AllStarMatrixProbeRequest, request: Request = None):
    """Проверяет доступность (online/offline), RTT, количество коннектов и силу трафика для списка нод ASL."""
    from allstar_directory import allstar_dir_mgr
    try:
        results = await allstar_dir_mgr.probe_nodes_batch(req.nodes, force=req.force)
        stats_ok = not allstar_dir_mgr.is_stats_circuit_broken() if hasattr(allstar_dir_mgr, "is_stats_circuit_broken") else True
        return {
            "status": "ok",
            "hotspot_id": req.hotspot_id,
            "nodes": results,
            "stats_api_ok": stats_ok
        }
    except Exception as e:
        logger.error(f"[ALLSTAR] Matrix status probe error: {e}", exc_info=True)
        return {
            "status": "error",
            "hotspot_id": req.hotspot_id,
            "nodes": {},
            "stats_api_ok": False
        }

class AllStarFeedStatsRequest(BaseModel):
    node: str
    stats: Dict[str, Any] = {}

@app.post("/api/allstar/feed-stats")
async def api_allstar_feed_stats(req: AllStarFeedStatsRequest):
    """Allows client to feed stats obtained directly from stats.allstarlink.org (client-side CORS)."""
    from allstar_directory import allstar_dir_mgr
    updated = allstar_dir_mgr.feed_node_stats(req.node, req.stats)
    return {"status": "ok", "node": req.node, "result": updated}

@app.get("/api/tg/search")
async def search_talkgroups(q: str = "", limit: int = 50, network: str = "bm"):
    """Searches TalkGroups across numbers, names, cities, and countries for the given network."""
    net = (network or "bm").strip().lower()
    if net == "tgif" and len(tg_resolver.tgif_cache) < 50:
        await tg_resolver.fetch_tgif_catalog()
    if net == "freedmr" and len(tg_resolver.freedmr_cache) < 50:
        await tg_resolver.fetch_freedmr_catalog()
    if net == "adn":
        adn_hosts_mgr.ensure_fresh_background()
        if len(tg_resolver.adn_cache) < 50:
            await tg_resolver.fetch_adn_catalog(force=True)
        else:
            tg_resolver.ensure_adn_fresh_background()
    results = tg_resolver.search_talkgroups(q, limit=limit, network_type=net)
    return {"status": "ok", "query": q, "network": net, "count": len(results), "results": results, "stats": tg_resolver.get_stats(network_type=net)}

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
    """Manual trigger to update TalkGroups catalogs (BM + TGIF + FreeDMR + ADN) and RadioID user database."""
    tg_count = await tg_resolver.fetch_master_catalog()
    tgif_count = await tg_resolver.fetch_tgif_catalog()
    freedmr_count = await tg_resolver.fetch_freedmr_catalog()
    adn_tg_count = await tg_resolver.fetch_adn_catalog(force=True)
    freedmr_servers = await freedmr_hosts_mgr.fetch_hosts(force=True)
    xlx_servers = await xlx_hosts_mgr.fetch_hosts(force=True)
    dmrplus_servers = await dmrplus_hosts_mgr.fetch_hosts(force=True)
    adn_servers = await adn_hosts_mgr.fetch_hosts(force=True)
    ysf_servers = await ysf_dir_mgr.fetch_hosts(force=True)
    user_count = await user_db.update_from_network()
    return {
        "status": "ok",
        "talkgroups_updated": tg_count,
        "tgif_talkgroups": tgif_count,
        "freedmr_talkgroups": freedmr_count,
        "adn_talkgroups": adn_tg_count,
        "freedmr_hosts": len(freedmr_servers),
        "xlx_hosts": len(xlx_servers),
        "dmrplus_hosts": len(dmrplus_servers),
        "adn_hosts": len(adn_servers),
        "ysf_hosts": len(ysf_servers),
        "users_count": user_count,
    }

@app.get("/api/bm/static-groups")
async def get_bm_static_groups(hotspot_id: Optional[str] = None, request: Request = None):
    resp = await _get_bm_static_groups_impl(hotspot_id, request)
    user = _get_user_from_request(request) if request else None
    if user and user.get("is_demo") and isinstance(resp, dict):
        cfg_chk, _, _, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=user["user_id"])
        resp = _mask_bm_resp_for_demo(resp, cfg_chk)
    return resp

async def _get_bm_static_groups_impl(hotspot_id: Optional[str] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    cfg_check, device_id_check, _, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)
    net_type = (getattr(cfg_check, "network_type", "bm") or "bm").strip().lower() if cfg_check else "bm"

    if net_type == "tgif" and cfg_check:
        if len(tg_resolver.tgif_cache) < 50:
            await tg_resolver.fetch_tgif_catalog()

        local_dyn = hotspot_manager.get_dynamic_tgs(cfg_check.id, max_age_sec=900.0, user_id=uid)
        now = time.time()
        dyn_ts1 = []
        dyn_ts2 = []
        for tg, ts in local_dyn.get(1, {}).items():
            if tg not in (0, 4000, 9990):
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts1.append({
                    "talkgroup": tg,
                    "slot": 1,
                    "name": tg_resolver.get_name(tg, network_type="tgif"),
                    "last_active": ts,
                    "remaining_sec": rem
                })
        for tg, ts in local_dyn.get(2, {}).items():
            if tg not in (0, 4000, 9990):
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts2.append({
                    "talkgroup": tg,
                    "slot": 2,
                    "name": tg_resolver.get_name(tg, network_type="tgif"),
                    "last_active": ts,
                    "remaining_sec": rem
                })
        cur_tg = getattr(cfg_check, "default_tg_ts2", 0) or getattr(cfg_check, "default_tg", 0)
        if cur_tg and cur_tg not in (0, 4000, 9990) and not any(x["talkgroup"] == cur_tg for x in dyn_ts2):
            dyn_ts2.append({
                "talkgroup": cur_tg,
                "slot": 2,
                "name": tg_resolver.get_name(cur_tg, network_type="tgif"),
                "last_active": now,
                "remaining_sec": 900
            })
        dyn_ts1.sort(key=lambda x: x["talkgroup"])
        dyn_ts2.sort(key=lambda x: x["talkgroup"])

        api_key = (cfg_check.bm_api_key or "").strip()
        if not api_key:
            return {
                "status": "error",
                "code": "NO_API_KEY",
                "network_type": "tgif",
                "detail": _tr("tgif.api_key_not_configured", fallback='TGIF API Key is not configured for "{name}"', name=cfg_check.name),
                "device_id": device_id_check or str(cfg_check.dmr_id or "---"),
                "callsign": cfg_check.callsign,
                "hotspot_name": cfg_check.name,
                "hotspot_id": cfg_check.id,
                "ts1": [],
                "ts2": [],
                "dynamic_ts1": dyn_ts1,
                "dynamic_ts2": dyn_ts2,
                "tg_names": tg_resolver.get_all_names("tgif")
            }

        def _fetch_tgif():
            import urllib.request, urllib.error
            url = f"https://api.tgif.network/v1/static-talkgroups/{device_id_check}"
            req = urllib.request.Request(
                url,
                headers={
                    "User-Agent": "ProxDMR/1.0",
                    "Authorization": f"Bearer {api_key}",
                    "Accept": "application/json"
                }
            )
            try:
                with urllib.request.urlopen(req, timeout=6) as resp:
                    data = json.loads(resp.read().decode("utf-8"))
                    static_groups = data.get("memberships") or data.get("static_groups", [])
                    ts1 = []
                    ts2 = []
                    for sg in static_groups:
                        slot_num = int(sg.get("slot") or sg.get("timeslot", 1))
                        tg_num = int(sg.get("talkgroup", 0))
                        if tg_num <= 0:
                            continue
                        item = {
                            "talkgroup": tg_num,
                            "slot": slot_num,
                            "name": tg_resolver.get_name(tg_num, network_type="tgif")
                        }
                        if slot_num == 1:
                            ts1.append(item)
                        elif slot_num == 2:
                            ts2.append(item)

                    static_tgs_1 = {x["talkgroup"] for x in ts1}
                    static_tgs_2 = {x["talkgroup"] for x in ts2}
                    filtered_dyn_ts1 = [x for x in dyn_ts1 if x["talkgroup"] not in static_tgs_1]
                    filtered_dyn_ts2 = [x for x in dyn_ts2 if x["talkgroup"] not in static_tgs_2]

                    return {
                        "status": "ok",
                        "network_type": "tgif",
                        "device_id": device_id_check,
                        "callsign": cfg_check.callsign,
                        "hotspot_name": cfg_check.name,
                        "hotspot_id": cfg_check.id,
                        "limit": data.get("limit", 5),
                        "supports_ts1": data.get("supports_ts1", True),
                        "supports_ts2": data.get("supports_ts2", True),
                        "ts1": ts1,
                        "ts2": ts2,
                        "dynamic_ts1": filtered_dyn_ts1,
                        "dynamic_ts2": filtered_dyn_ts2,
                        "tg_names": tg_resolver.get_all_names("tgif")
                    }
            except urllib.error.HTTPError as e:
                err_text = ""
                try:
                    err_json = json.loads(e.read().decode("utf-8", errors="ignore"))
                    err_text = err_json.get("message") or err_json.get("error") or ""
                except Exception:
                    pass
                if e.code in (401, 403):
                    return {"status": "error", "code": "AUTH_FAILED", "network_type": "tgif", "detail": _tr("tgif.invalid_token", fallback="Invalid TGIF token (401)"), "ts1": [], "ts2": [], "dynamic_ts1": dyn_ts1, "dynamic_ts2": dyn_ts2, "device_id": device_id_check, "hotspot_id": cfg_check.id, "tg_names": tg_resolver.get_all_names("tgif")}
                if e.code == 404:
                    return {"status": "error", "code": "NOT_FOUND", "network_type": "tgif", "detail": _tr("tgif.device_not_found", fallback="Device {device_id} not found on TGIF server. Check registration and SSID.", device_id=device_id_check), "ts1": [], "ts2": [], "dynamic_ts1": dyn_ts1, "dynamic_ts2": dyn_ts2, "device_id": device_id_check, "hotspot_id": cfg_check.id, "tg_names": tg_resolver.get_all_names("tgif")}
                return {"status": "error", "network_type": "tgif", "detail": _tr("tgif.api_http_err", fallback="TGIF API error: HTTP {code} ({reason})", code=e.code, reason=(err_text or e.reason)), "ts1": [], "ts2": [], "dynamic_ts1": dyn_ts1, "dynamic_ts2": dyn_ts2, "device_id": device_id_check, "hotspot_id": cfg_check.id, "tg_names": tg_resolver.get_all_names("tgif")}
            except Exception as e:
                return {"status": "error", "network_type": "tgif", "detail": _tr("tgif.server_unavailable_err", fallback="TGIF server unavailable ({error})", error=e), "ts1": [], "ts2": [], "dynamic_ts1": dyn_ts1, "dynamic_ts2": dyn_ts2, "device_id": device_id_check, "hotspot_id": cfg_check.id, "tg_names": tg_resolver.get_all_names("tgif")}

        _ctx = contextvars.copy_context()
        return await asyncio.to_thread(_ctx.run, _fetch_tgif)

    elif net_type in ("freedmr", "adn") and cfg_check:
        if len(tg_resolver.freedmr_cache) < 50:
            await tg_resolver.fetch_freedmr_catalog()

        parsed = parse_freedmr_rpto(getattr(cfg_check, "rpto_options", "") or "")
        is_duplex = getattr(cfg_check, "duplex", True)
        norm_ts1, norm_ts2 = normalize_freedmr_slots(parsed["ts1"], parsed["ts2"], duplex=is_duplex)
        ts1 = [
            {
                "talkgroup": tg_num,
                "slot": 1,
                "name": tg_resolver.get_name(tg_num, network_type=net_type)
            }
            for tg_num in norm_ts1
        ]
        ts2 = [
            {
                "talkgroup": tg_num,
                "slot": 2,
                "name": tg_resolver.get_name(tg_num, network_type=net_type)
            }
            for tg_num in norm_ts2
        ]

        local_dyn = hotspot_manager.get_dynamic_tgs(cfg_check.id, max_age_sec=900.0, user_id=uid)
        now = time.time()
        static_1 = set(norm_ts1)
        static_2 = set(norm_ts2)
        dyn_ts1 = []
        dyn_ts2 = []
        for tg, ts in local_dyn.get(1, {}).items():
            if tg not in (0, 4000, 9990) and tg not in static_1:
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts1.append({
                    "talkgroup": tg,
                    "slot": 1,
                    "name": tg_resolver.get_name(tg, network_type=net_type),
                    "last_active": ts,
                    "remaining_sec": rem
                })
        for tg, ts in local_dyn.get(2, {}).items():
            if tg not in (0, 4000, 9990) and tg not in static_2:
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts2.append({
                    "talkgroup": tg,
                    "slot": 2,
                    "name": tg_resolver.get_name(tg, network_type=net_type),
                    "last_active": ts,
                    "remaining_sec": rem
                })
        dyn_ts1.sort(key=lambda x: x["talkgroup"])
        dyn_ts2.sort(key=lambda x: x["talkgroup"])

        return {
            "status": "ok",
            "network_type": net_type,
            "device_id": device_id_check or str(cfg_check.dmr_id or "---"),
            "callsign": cfg_check.callsign,
            "hotspot_name": cfg_check.name,
            "hotspot_id": cfg_check.id,
            "duplex": is_duplex,
            "rpto_options": getattr(cfg_check, "rpto_options", "") or "",
            "rpto_extra": dict(parsed["opts"]),
            "ts1": ts1,
            "ts2": ts2,
            "dynamic_ts1": dyn_ts1,
            "dynamic_ts2": dyn_ts2,
            "tg_names": tg_resolver.get_all_names(net_type)
        }

    elif net_type == "xlx" and cfg_check:
        mod = (getattr(cfg_check, "xlx_module", "") or "").strip().upper()[:1]
        mod_tg = xlx_module_to_tg(mod) if mod else 0
        ts2 = []
        if mod and 4001 <= mod_tg <= 4026:
            ts2.append({
                "talkgroup": mod_tg,
                "slot": 2,
                "module": mod,
                "name": _tr("xlx.active_module_name", fallback="Module {mod} (Active module → TG 9)", mod=mod)
            })
        dyn_ts2 = [
            {
                "talkgroup": 9,
                "slot": 2,
                "name": _tr("xlx.reflector_call_ts2", fallback="Reflector Call (TS2)"),
                "last_active": time.time(),
                "remaining_sec": 900
            }
        ] if mod else []
        return {
            "status": "ok",
            "network_type": "xlx",
            "device_id": device_id_check or str(cfg_check.dmr_id or "---"),
            "callsign": cfg_check.callsign,
            "hotspot_name": cfg_check.name,
            "hotspot_id": cfg_check.id,
            "xlx_module": mod,
            "supports_ts1": False,
            "supports_ts2": True,
            "ts1": [],
            "ts2": ts2,
            "dynamic_ts1": [],
            "dynamic_ts2": dyn_ts2,
            "tg_names": tg_resolver.get_all_names("xlx")
        }

    elif net_type == "dmrplus" and cfg_check:
        dmrplus_hosts_mgr.ensure_fresh_background()
        parsed_dp = parse_dmrplus_rpto(
            getattr(cfg_check, "rpto_options", "") or "",
            fallback_reflector=getattr(cfg_check, "dmrplus_reflector", "") or "",
        )
        eff_ref = str(parsed_dp["start_ref"]) if parsed_dp["start_ref"] else ""
        ts1 = [
            {
                "talkgroup": tg_num,
                "slot": 1,
                "name": tg_resolver.get_name(tg_num, network_type="dmrplus"),
            }
            for tg_num in parsed_dp["ts1"]
        ]
        ts2 = [
            {
                "talkgroup": tg_num,
                "slot": 2,
                "name": tg_resolver.get_name(tg_num, network_type="dmrplus"),
            }
            for tg_num in parsed_dp["ts2"]
        ]
        local_dyn = hotspot_manager.get_dynamic_tgs(cfg_check.id, max_age_sec=900.0, user_id=uid)
        now = time.time()
        static_1 = set(parsed_dp["ts1"])
        static_2 = set(parsed_dp["ts2"])
        dyn_ts1 = []
        dyn_ts2 = []
        for tg, ts in local_dyn.get(1, {}).items():
            if tg not in (0, 4000, 9990) and tg not in static_1:
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts1.append({
                    "talkgroup": tg,
                    "slot": 1,
                    "name": tg_resolver.get_name(tg, network_type="dmrplus"),
                    "last_active": ts,
                    "remaining_sec": rem,
                })
        for tg, ts in local_dyn.get(2, {}).items():
            if tg not in (0, 4000, 9990) and tg not in static_2:
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts2.append({
                    "talkgroup": tg,
                    "slot": 2,
                    "name": tg_resolver.get_name(tg, network_type="dmrplus"),
                    "last_active": ts,
                    "remaining_sec": rem,
                })
        if eff_ref and not any(x["talkgroup"] == 9 for x in dyn_ts2):
            dyn_ts2.append({
                "talkgroup": 9,
                "slot": 2,
                "name": tg_resolver.get_name(9, network_type="dmrplus"),
                "last_active": now,
                "remaining_sec": 900,
            })
        dyn_ts1.sort(key=lambda x: x["talkgroup"])
        dyn_ts2.sort(key=lambda x: x["talkgroup"])
        return {
            "status": "ok",
            "network_type": "dmrplus",
            "device_id": device_id_check or str(cfg_check.dmr_id or "---"),
            "callsign": cfg_check.callsign,
            "hotspot_name": cfg_check.name,
            "hotspot_id": cfg_check.id,
            "dmrplus_reflector": eff_ref,
            "relink_time": parsed_dp["relink_time"],
            "limit": DMRPLUS_MAX_STATIC_PER_SLOT,
            "supports_ts1": True,
            "supports_ts2": True,
            "rpto_options": getattr(cfg_check, "rpto_options", "") or "",
            "ts1": ts1,
            "ts2": ts2,
            "dynamic_ts1": dyn_ts1,
            "dynamic_ts2": dyn_ts2,
            "tg_names": tg_resolver.get_all_names("dmrplus"),
        }

    elif net_type != "bm" and cfg_check:
        local_dyn = hotspot_manager.get_dynamic_tgs(cfg_check.id, max_age_sec=900.0, user_id=uid)
        now = time.time()
        dyn_ts1 = []
        dyn_ts2 = []
        for tg, ts in local_dyn.get(1, {}).items():
            if tg not in (0, 4000, 9990):
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts1.append({
                    "talkgroup": tg,
                    "slot": 1,
                    "name": tg_resolver.get_name(tg, network_type=net_type),
                    "last_active": ts,
                    "remaining_sec": rem
                })
        for tg, ts in local_dyn.get(2, {}).items():
            if tg not in (0, 4000, 9990):
                rem = max(0, int(900.0 - (now - ts)))
                dyn_ts2.append({
                    "talkgroup": tg,
                    "slot": 2,
                    "name": tg_resolver.get_name(tg, network_type=net_type),
                    "last_active": ts,
                    "remaining_sec": rem
                })
        cur_tg = getattr(cfg_check, "default_tg_ts2", 0) or getattr(cfg_check, "default_tg", 0)
        if cur_tg and cur_tg not in (0, 4000, 9990) and not any(x["talkgroup"] == cur_tg for x in dyn_ts2):
            dyn_ts2.append({
                "talkgroup": cur_tg,
                "slot": 2,
                "name": tg_resolver.get_name(cur_tg, network_type=net_type),
                "last_active": now,
                "remaining_sec": 900
            })
        dyn_ts1.sort(key=lambda x: x["talkgroup"])
        dyn_ts2.sort(key=lambda x: x["talkgroup"])
        return {
            "status": "ok",
            "network_type": net_type,
            "device_id": device_id_check or str(cfg_check.dmr_id or "---"),
            "callsign": cfg_check.callsign,
            "hotspot_name": cfg_check.name,
            "hotspot_id": cfg_check.id,
            "ts1": [],
            "ts2": [],
            "dynamic_ts1": dyn_ts1,
            "dynamic_ts2": dyn_ts2,
            "tg_names": tg_resolver.get_all_names(net_type)
        }

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "network_type": net_type, "detail": err, "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id or "---", "hotspot_id": hotspot_id}

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
                    "network_type": "bm",
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
                return {"status": "error", "detail": _tr("bm.invalid_or_expired_token", fallback="Invalid or expired BM token (401)"), "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}
            if e.code == 404:
                return {"status": "error", "detail": _tr("bm.device_not_found", fallback="Device {device_id} not found on BM server. Check device registration and hotspot SSID on BM.", device_id=device_id), "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}
            return {"status": "error", "detail": _tr("bm.api_http_err", fallback="BM API error: HTTP {code}", code=e.code), "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}
        except Exception as e:
            return {"status": "error", "detail": _tr("bm.server_unavailable_err", fallback="BM server unavailable ({error})", error=e), "ts1": [], "ts2": [], "dynamic_ts1": [], "dynamic_ts2": [], "device_id": device_id}

    _ctx = contextvars.copy_context()
    return await asyncio.to_thread(_ctx.run, _fetch)


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
                "message": _tr("bm.reconnecting_after_groups", user_id=uid, fallback="Reconnecting to BrandMeister ({name}) after talkgroup changes...", name=rt.config.name)
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
    try:
        await _execute_bm_import_fn(
            task=task,
            device_id=device_id,
            api_key=api_key,
            broadcast_fn=broadcast_user_json,
            reconnect_fn=schedule_bm_reconnect_after_group_mod,
            hotspot_manager=hotspot_manager
        )
    except Exception as e:
        logger.error(f"[BM_TASK] Unhandled error in background task {task.task_id}: {e}")
        task.status = "error"
        task.message = _tr("bm.bg_op_error", user_id=task.user_id, fallback="Background operation error: {error}", error=e)
        task.finished_at = time.time()
        if _user_active_bm_import.get(task.user_id) == task.task_id:
            _user_active_bm_import.pop(task.user_id, None)
        try:
            await broadcast_user_json(task.user_id, {"type": "bm_import_finished", "task": task.to_dict()})
        except Exception:
            pass


@app.post("/api/bm/static-groups")
async def add_bm_static_group(payload: dict, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))

    hotspot_id = payload.get("hotspot_id")
    slot = int(payload.get("slot", 1))
    if slot not in (1, 2):
        raise HTTPException(status_code=400, detail=_tr("bm.slot_must_be_1_or_2", fallback="Slot must be 1 or 2"))

    tgs = payload.get("talkgroups")
    if tgs is None:
        single_tg = payload.get("talkgroup")
        tgs = [int(single_tg)] if single_tg is not None and int(single_tg) > 0 else []
    else:
        tgs = [int(x) for x in tgs if int(x) > 0]

    if not tgs:
        raise HTTPException(status_code=400, detail=_tr("bm.no_tg_to_add", fallback="No TalkGroups specified to add"))

    cfg_check, device_id_check, _, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)
    net_type = (getattr(cfg_check, "network_type", "bm") or "bm").strip().lower() if cfg_check else "bm"

    if net_type in ("freedmr", "adn") and cfg_check:
        parsed = parse_freedmr_rpto(getattr(cfg_check, "rpto_options", "") or "")
        target_list = parsed["ts1"] if slot == 1 else parsed["ts2"]
        other_list = parsed["ts2"] if slot == 1 else parsed["ts1"]
        added = []
        errors = []
        moved_from_other_slot = []
        for tg in tgs:
            if tg in (0, 4000, 5000, 9990, 9991, 9999):
                err_svc = _tr("adn.service_tg_no_static", fallback="TG {tg}: service group (cannot be static)", tg=tg) if net_type == "adn" else _tr("freedmr.service_tg_no_static", fallback="TG {tg}: service group (cannot be static)", tg=tg)
                errors.append(err_svc)
                continue
            if tg in other_list:
                other_list.remove(tg)
                moved_from_other_slot.append(tg)
            if tg not in target_list:
                target_list.append(tg)
            added.append(tg)

        # Simplex hotspot: FreeDMR / ADN only uses Slot 2
        if not getattr(cfg_check, "duplex", True):
            for tg in parsed["ts1"]:
                if tg not in parsed["ts2"]:
                    parsed["ts2"].append(tg)
            parsed["ts1"] = []

        new_rpto = build_freedmr_rpto(parsed["ts1"], parsed["ts2"], parsed["opts"], prefer_slot=slot)
        if len(new_rpto.encode("ascii", errors="ignore")) > FREEDMR_MAX_RPTO_BYTES:
            err_lim = _tr("adn.rpto_limit_exceeded", fallback="ADN Systems server RPTO length limit exceeded ({max_bytes} bytes). Remove some talkgroups.", max_bytes=FREEDMR_MAX_RPTO_BYTES) if net_type == "adn" else _tr("freedmr.rpto_limit_exceeded", fallback="FreeDMR server RPTO length limit exceeded ({max_bytes} bytes). Remove some talkgroups.", max_bytes=FREEDMR_MAX_RPTO_BYTES)
            return {
                "status": "error",
                "detail": err_lim
            }

        await hotspot_manager.set_hotspot_rpto(cfg_check.id, rpto_options=new_rpto, user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)

        msg_added = _tr("adn.rpto_added_count", fallback="Static talkgroups added to ADN Systems RPTO: {count}", count=len(added)) if net_type == "adn" else _tr("freedmr.rpto_added_count", fallback="Static talkgroups added to FreeDMR RPTO: {count}", count=len(added))
        return {
            "status": "ok",
            "network_type": net_type,
            "slot": slot,
            "added": added,
            "moved_from_other_slot": moved_from_other_slot,
            "errors": errors,
            "talkgroup": added[0] if added else None,
            "rpto_options": new_rpto,
            "message": msg_added
        }

    if net_type == "xlx" and cfg_check:
        target_tg = tgs[-1]
        if target_tg == 4000:
            await hotspot_manager.set_hotspot_rpto(cfg_check.id, xlx_module="", user_id=uid)
            user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
            await save_user_settings(uid, user_sett.model_dump())
            if uid == 1:
                save_app_settings(user_sett)
            return {
                "status": "ok",
                "network_type": "xlx",
                "slot": 2,
                "xlx_module": "",
                "added": [],
                "errors": [],
                "message": _tr("xlx.module_disconnected", fallback="XLX module disconnected (TG 4000)")
            }
        mod = xlx_tg_to_module(target_tg)
        if not mod:
            return {
                "status": "error",
                "detail": _tr("xlx.module_tg_range", fallback="In XLX network, specify TG 4001–4026 (Modules A–Z) to select a module")
            }
        await hotspot_manager.set_hotspot_rpto(cfg_check.id, xlx_module=mod, user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        return {
            "status": "ok",
            "network_type": "xlx",
            "slot": 2,
            "xlx_module": mod,
            "added": [xlx_module_to_tg(mod)],
            "errors": [],
            "talkgroup": xlx_module_to_tg(mod),
            "message": _tr("xlx.module_connected_ts2", fallback="Connected XLX module {mod} (TG {tg}) on TS2", mod=mod, tg=xlx_module_to_tg(mod))
        }

    if net_type == "dmrplus" and cfg_check:
        target_tg = tgs[-1]
        if slot == 2 and (target_tg in (4000, 5000) or 4001 <= target_tg <= 4999):
            if target_tg == 4000:
                res_rpto = await hotspot_manager.set_hotspot_rpto(cfg_check.id, dmrplus_reflector="", user_id=uid)
                user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
                await save_user_settings(uid, user_sett.model_dump())
                if uid == 1:
                    save_app_settings(user_sett)
                return {
                    "status": "ok",
                    "network_type": "dmrplus",
                    "slot": 2,
                    "dmrplus_reflector": "",
                    "rpto_options": (res_rpto or {}).get("hotspot", {}).get("rpto_options", ""),
                    "added": [],
                    "errors": [],
                    "message": _tr("dmrplus.reflector_unlinked", fallback="DMR+ reflector disconnected (4000 Unlink)")
                }
            if target_tg == 5000:
                rt = hotspot_manager.get_runtime(uid, cfg_check.id)
                if rt and getattr(rt, "status", None) == BMState.ONLINE:
                    await hotspot_manager.send_dmrplus_reflector_link_dmr(cfg_check.id, "5000", user_id=uid)
                return {
                    "status": "ok",
                    "network_type": "dmrplus",
                    "slot": 2,
                    "added": [],
                    "errors": [],
                    "message": _tr("dmrplus.reflector_status_query", fallback="Requesting DMR+ reflector status (5000 Status)")
                }
            ref_str = str(target_tg)
            res_rpto = await hotspot_manager.set_hotspot_rpto(cfg_check.id, dmrplus_reflector=ref_str, user_id=uid)
            user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
            await save_user_settings(uid, user_sett.model_dump())
            if uid == 1:
                save_app_settings(user_sett)
            return {
                "status": "ok",
                "network_type": "dmrplus",
                "slot": 2,
                "dmrplus_reflector": ref_str,
                "rpto_options": (res_rpto or {}).get("hotspot", {}).get("rpto_options", ""),
                "added": [target_tg],
                "errors": [],
                "talkgroup": target_tg,
                "message": _tr("dmrplus.reflector_connected_ts2", fallback="Connected DMR+ reflector {reflector} on TS2 (Voice on TG 9)", reflector=ref_str)
            }

        parsed_dp = parse_dmrplus_rpto(
            getattr(cfg_check, "rpto_options", "") or "",
            fallback_reflector=getattr(cfg_check, "dmrplus_reflector", "") or "",
        )
        target_list = parsed_dp["ts1"] if slot == 1 else parsed_dp["ts2"]
        added = []
        errors = []
        for tg in tgs:
            if tg in (0, 4000, 5000, 9990, 9991, 9999) or (slot == 2 and tg == 9):
                errors.append(_tr("dmrplus.service_tg_no_static", fallback="TG {tg}: service group (cannot be static)", tg=tg))
                continue
            if tg in target_list:
                added.append(tg)
                continue
            if len(target_list) >= DMRPLUS_MAX_STATIC_PER_SLOT:
                errors.append(_tr("dmrplus.slot_limit_reached", fallback="TG {tg}: DMR+ allows up to {limit} static groups per slot (TS{slot})", tg=tg, limit=DMRPLUS_MAX_STATIC_PER_SLOT, slot=slot))
                continue
            target_list.append(tg)
            added.append(tg)

        if not added and errors:
            return {"status": "error", "detail": "; ".join(errors[:5])}

        new_rpto = build_dmrplus_rpto(
            start_ref=parsed_dp["start_ref"],
            ts1=parsed_dp["ts1"],
            ts2=parsed_dp["ts2"],
            relink_time=parsed_dp["relink_time"],
            user_link=parsed_dp["user_link"],
            extra_opts=parsed_dp["opts"],
        )
        if len(new_rpto.encode("ascii", errors="ignore")) > DMRPLUS_MAX_RPTO_BYTES:
            return {"status": "error", "detail": _tr("dmrplus.rpto_limit_exceeded", fallback="DMR+ RPTO length limit exceeded ({max_bytes} bytes)", max_bytes=DMRPLUS_MAX_RPTO_BYTES)}

        if slot == 1 and added:
            cfg_check.default_tg_ts1 = added[-1]
            rt = hotspot_manager.get_runtime(uid, cfg_check.id)
            if rt:
                rt.config.default_tg_ts1 = added[-1]
        await hotspot_manager.set_hotspot_rpto(cfg_check.id, rpto_options=new_rpto, user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        return {
            "status": "ok",
            "network_type": "dmrplus",
            "slot": slot,
            "dmrplus_reflector": str(parsed_dp["start_ref"]) if parsed_dp["start_ref"] else "",
            "added": added,
            "errors": errors,
            "talkgroup": added[0] if added else None,
            "rpto_options": new_rpto,
            "message": _tr("dmrplus.rpto_added_count", fallback="DMR+ TS{slot}: added {count} static TG(s)", slot=slot, count=len(added)),
        }

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err}

    net_type = (getattr(cfg, "network_type", "bm") or "bm").strip().lower()
    _req_lang = get_lang(user_id=uid)

    if net_type == "tgif":
        def _add_tgif():
            import urllib.request, urllib.error, time
            added = []
            errors = []
            for i, tg in enumerate(tgs):
                if tg in (9, 777, 4000, 9990, 31000):
                    errors.append(_tr("tgif.service_tg_dynamic_only", lang=_req_lang, fallback="TG {tg}: TGIF service group (activated dynamically via PTT only)", tg=tg))
                    continue
                if i > 0:
                    time.sleep(0.06)
                url = f"https://api.tgif.network/v1/static-talkgroups/{device_id}"
                req_data = json.dumps({"slot": slot, "timeslot": slot, "talkgroup": tg}).encode("utf-8")
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
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        resp.read()
                        added.append(tg)
                except urllib.error.HTTPError as e:
                    err_msg = ""
                    try:
                        err_json = json.loads(e.read().decode("utf-8", errors="ignore"))
                        err_msg = err_json.get("message") or err_json.get("error") or ""
                    except Exception:
                        pass
                    errors.append(f"TG {tg}: HTTP {e.code} ({err_msg or e.reason})")
                except Exception as e:
                    errors.append(f"TG {tg}: {e}")

            if not added and errors:
                return {"status": "error", "detail": "; ".join(errors[:5])}
            return {
                "status": "ok",
                "network_type": "tgif",
                "slot": slot,
                "added": added,
                "errors": errors,
                "talkgroup": added[0] if added else None,
                "message": _tr("bm.static_added_count", lang=_req_lang, fallback="Static talkgroups added: {count}", count=len(added))
            }

        return await asyncio.to_thread(_add_tgif)

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
            "message": _tr("bm.static_added_count", lang=_req_lang, fallback="Static talkgroups added: {count}", count=len(added))
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
        raise HTTPException(status_code=400, detail=_tr("bm.slot_must_be_1_or_2", fallback="Slot must be 1 or 2"))

    tgs = payload.get("talkgroups", [])
    tgs = [int(x) for x in tgs if int(x) > 0]
    if not tgs:
        raise HTTPException(status_code=400, detail=_tr("bm.no_tg_specified", fallback="No TalkGroups specified"))

    filename = str(payload.get("filename", "")).strip()
    action = str(payload.get("action", "add")).lower().strip()
    if action not in ("add", "delete"):
        action = "add"

    active_tid = _user_active_bm_import.get(uid)
    if active_tid and active_tid in _bm_import_tasks:
        cur_task = _bm_import_tasks[active_tid]
        if cur_task.status == "running":
            busy_msg = (
                _tr("bm.bg_delete_already_running", fallback="Background group deletion is already running")
                if cur_task.action == "delete"
                else _tr("bm.bg_import_already_running", fallback="Background group import is already running")
            )
            return {"status": "busy", "message": busy_msg, "task": cur_task.to_dict()}

    cfg_check, device_id_check, _, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)
    net_type = (getattr(cfg_check, "network_type", "bm") or "bm").strip().lower() if cfg_check else "bm"
    if net_type not in ("freedmr", "adn", "xlx", "dmrplus"):
        cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
        if err:
            return {"status": "error", "detail": err}
    else:
        cfg = cfg_check
        device_id = device_id_check or str(cfg.dmr_id or "")
        api_key = ""

    task_id = str(uuid.uuid4())[:8]
    task = BmImportTask(
        task_id=task_id,
        user_id=uid,
        hotspot_id=cfg.id,
        slot=slot,
        talkgroups=tgs,
        filename=filename,
        action=action,
        network_type=net_type
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
        now_ts = time.time()
        # Предохранитель от зависших/зомби задач
        if t.status == "running" and (
            t.cancelled
            or (now_ts - t.started_at > 180.0)
            or (t.current == 0 and now_ts - t.started_at > 15.0)
        ):
            t.cancel()
            t.finished_at = now_ts
            _user_active_bm_import.pop(uid, None)
            return {"status": "idle", "task": None}
        if t.status != "running" and t.finished_at and (now_ts - t.finished_at > 10.0):
            _user_active_bm_import.pop(uid, None)
            return {"status": "idle", "task": None}
        if hotspot_id and t.hotspot_id and str(t.hotspot_id) != str(hotspot_id):
            return {"status": "idle", "task": None}
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
        t.cancel()
        t.finished_at = time.time()
        _user_active_bm_import.pop(uid, None)
        try:
            await broadcast_user_json(uid, {"type": "bm_import_finished", "task": t.to_dict()})
        except Exception:
            pass
        return {"status": "ok", "task": t.to_dict(), "message": _tr("bm.bg_op_cancelled", fallback="Operation cancelled")}
    return {"status": "not_running", "message": _tr("bm.bg_no_active_op", fallback="No active operation")}


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
        raise HTTPException(status_code=400, detail=_tr("bm.no_tg_to_delete", fallback="No TalkGroups specified for deletion"))

    cfg_check, device_id_check, _, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)
    net_type = (getattr(cfg_check, "network_type", "bm") or "bm").strip().lower() if cfg_check else "bm"

    if net_type in ("freedmr", "adn") and cfg_check:
        parsed = parse_freedmr_rpto(getattr(cfg_check, "rpto_options", "") or "")
        target_list = parsed["ts1"] if slot == 1 else parsed["ts2"]
        deleted = []
        for tg in tgs:
            if tg in target_list:
                target_list.remove(tg)
                deleted.append(tg)
        is_duplex = getattr(cfg_check, "duplex", True)
        norm_ts1, norm_ts2 = normalize_freedmr_slots(parsed["ts1"], parsed["ts2"], duplex=is_duplex)
        new_rpto = build_freedmr_rpto(norm_ts1, norm_ts2, parsed["opts"])
        await hotspot_manager.set_hotspot_rpto(cfg_check.id, rpto_options=new_rpto, user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        del_msg = _tr("adn.rpto_deleted_count", fallback="Static talkgroups removed from ADN Systems RPTO: {count}", count=len(deleted)) if net_type == "adn" else _tr("freedmr.rpto_deleted_count", fallback="Static talkgroups removed from FreeDMR RPTO: {count}", count=len(deleted))
        return {
            "status": "ok",
            "network_type": net_type,
            "deleted": deleted,
            "errors": [],
            "rpto_options": new_rpto,
            "message": del_msg
        }

    if net_type == "xlx" and cfg_check:
        await hotspot_manager.set_hotspot_rpto(cfg_check.id, xlx_module="", user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        return {
            "status": "ok",
            "network_type": "xlx",
            "xlx_module": "",
            "deleted": tgs,
            "message": _tr("xlx.module_disconnected", fallback="XLX module disconnected (TG 4000)")
        }

    if net_type == "dmrplus" and cfg_check:
        if slot == 2 and any(tg == 4000 or 4001 <= tg <= 4999 for tg in tgs):
            res_rpto = await hotspot_manager.set_hotspot_rpto(cfg_check.id, dmrplus_reflector="", user_id=uid)
            user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
            await save_user_settings(uid, user_sett.model_dump())
            if uid == 1:
                save_app_settings(user_sett)
            return {
                "status": "ok",
                "network_type": "dmrplus",
                "dmrplus_reflector": "",
                "rpto_options": (res_rpto or {}).get("hotspot", {}).get("rpto_options", ""),
                "deleted": tgs,
                "message": _tr("dmrplus.reflector_unlinked", fallback="DMR+ reflector disconnected (4000 Unlink)")
            }
        parsed_dp = parse_dmrplus_rpto(
            getattr(cfg_check, "rpto_options", "") or "",
            fallback_reflector=getattr(cfg_check, "dmrplus_reflector", "") or "",
        )
        target_list = parsed_dp["ts1"] if slot == 1 else parsed_dp["ts2"]
        deleted = []
        for tg in tgs:
            if tg in target_list:
                target_list.remove(tg)
                deleted.append(tg)
        new_rpto = build_dmrplus_rpto(
            start_ref=parsed_dp["start_ref"],
            ts1=parsed_dp["ts1"],
            ts2=parsed_dp["ts2"],
            relink_time=parsed_dp["relink_time"],
            user_link=parsed_dp["user_link"],
            extra_opts=parsed_dp["opts"],
        )
        await hotspot_manager.set_hotspot_rpto(cfg_check.id, rpto_options=new_rpto, user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        return {
            "status": "ok",
            "network_type": "dmrplus",
            "deleted": deleted,
            "errors": [],
            "dmrplus_reflector": str(parsed_dp["start_ref"]) if parsed_dp["start_ref"] else "",
            "rpto_options": new_rpto,
            "message": _tr("dmrplus.rpto_deleted_count", fallback="Static talkgroups removed from DMR+ RPTO: {count}", count=len(deleted)),
        }

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)
    if err:
        return {"status": "error", "detail": err}

    net_type = (getattr(cfg, "network_type", "bm") or "bm").strip().lower()

    _req_lang = get_lang(user_id=uid)

    # Automatically offload batch deletion of more than 5 groups to background task
    if len(tgs) > 5 or payload.get("background"):
        active_tid = _user_active_bm_import.get(uid)
        if active_tid and active_tid in _bm_import_tasks:
            cur_task = _bm_import_tasks[active_tid]
            if cur_task.status == "running":
                busy_msg = (
                    _tr("bm.bg_delete_already_running", lang=_req_lang, fallback="Background group deletion is already running")
                    if cur_task.action == "delete"
                    else _tr("bm.bg_import_already_running", lang=_req_lang, fallback="Background group import is already running")
                )
                return {"status": "busy", "message": busy_msg, "task": cur_task.to_dict()}

        task_id = str(uuid.uuid4())[:8]
        task = BmImportTask(
            task_id=task_id,
            user_id=uid,
            hotspot_id=cfg.id,
            slot=slot,
            talkgroups=tgs,
            filename=_tr("bm.batch_delete_label", lang=_req_lang, fallback="Batch deletion"),
            action="delete",
            network_type=net_type
        )
        _bm_import_tasks[task_id] = task
        _user_active_bm_import[uid] = task_id
        asyncio.create_task(_execute_bm_import(task, device_id, api_key))
        return {
            "status": "ok",
            "background": True,
            "task": task.to_dict(),
            "message": _tr("bm.bg_delete_started", lang=_req_lang, fallback="Background deletion of {count} groups started", count=len(tgs))
        }

    if net_type == "tgif":
        def _delete_tgif():
            import urllib.request, urllib.error, json, time
            deleted = []
            errors = []
            for i, tg in enumerate(tgs):
                if i > 0:
                    time.sleep(0.06)
                url = f"https://api.tgif.network/v1/static-talkgroups/{device_id}"
                body_data = json.dumps({"slot": slot, "timeslot": slot, "talkgroup": tg}).encode("utf-8")
                req = urllib.request.Request(
                    url,
                    data=body_data,
                    headers={
                        "User-Agent": "ProxDMR/1.0",
                        "Authorization": f"Bearer {api_key}",
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    method="DELETE"
                )
                try:
                    with urllib.request.urlopen(req, timeout=6) as resp:
                        resp.read()
                        deleted.append(tg)
                except urllib.error.HTTPError as e:
                    err_text = ""
                    try:
                        err_json = json.loads(e.read().decode("utf-8"))
                        err_text = err_json.get("message") or err_json.get("error") or ""
                    except Exception:
                        pass
                    msg = f"TG {tg}: {err_text}" if err_text else f"TG {tg}: HTTP {e.code}"
                    errors.append(msg)
                except Exception as e:
                    errors.append(f"TG {tg}: {e}")

            if not deleted and errors:
                return {"status": "error", "detail": "; ".join(errors[:5])}
            return {
                "status": "ok",
                "deleted": deleted,
                "errors": errors,
                "message": _tr("bm.static_deleted_count", lang=_req_lang, fallback="Static talkgroups deleted: {count}", count=len(deleted))
            }

        # For TGIF, do NOT schedule reconnect!
        return await asyncio.to_thread(_delete_tgif)

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
            "message": _tr("bm.static_deleted_count", lang=_req_lang, fallback="Static talkgroups deleted: {count}", count=len(deleted))
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
    quick_ptt_unlink = bool(payload.get("quick_ptt_unlink"))
    slots_to_drop = [int(slot)] if slot in (1, 2) else [1, 2]

    cfg_check, device_id_check, _, _ = _get_bm_device_and_key(hotspot_id, allow_fallback=True, user_id=uid)
    net_type = (getattr(cfg_check, "network_type", "bm") or "bm").strip().lower() if cfg_check else "bm"
    if net_type == "tgif" and cfg_check:
        for s in slots_to_drop:
            hotspot_manager.clear_dynamic_tgs(cfg_check.id, slot=s, user_id=uid)
            hotspot_manager.send_silent_unlink_dmr(cfg_check.id, slot=s, user_id=uid)
            try:
                import urllib.request
                sess_url = f"http://tgif.network:5040/api/sessions/update/{device_id_check}/{s - 1}/4000"
                req_sess = urllib.request.Request(sess_url, headers={"User-Agent": "ProxDMR/1.0"})
                with urllib.request.urlopen(req_sess, timeout=1.5) as r:
                    r.read()
            except Exception:
                pass
        return {
            "status": "ok",
            "hotspot_id": cfg_check.id,
            "hotspot_name": cfg_check.name,
            "device_id": device_id_check or str(cfg_check.dmr_id or ""),
            "dropped_slots": slots_to_drop,
            "dmr_4000_sent": True,
            "message": _tr("bm.dynamic_dropped_net", fallback="Dynamic talkgroups dropped for {name} ({network})", name=cfg_check.name, network="TGIF")
        }
    elif net_type in ("freedmr", "adn") and cfg_check:
        net_label = "ADN Systems" if net_type == "adn" else "FreeDMR"
        for s in slots_to_drop:
            hotspot_manager.clear_dynamic_tgs(cfg_check.id, slot=s, user_id=uid)
            hotspot_manager.send_silent_unlink_dmr(cfg_check.id, slot=s, user_id=uid)
        return {
            "status": "ok",
            "hotspot_id": cfg_check.id,
            "hotspot_name": cfg_check.name,
            "device_id": device_id_check or str(cfg_check.dmr_id or ""),
            "dropped_slots": slots_to_drop,
            "dmr_4000_sent": True,
            "message": _tr("bm.dynamic_dropped_tg4000_net", fallback="Dynamic talkgroups dropped (TG 4000) for {name} ({network})", name=cfg_check.name, network=net_label)
        }
    elif net_type == "xlx" and cfg_check:
        hotspot_manager.clear_dynamic_tgs(cfg_check.id, slot=2, user_id=uid)
        await hotspot_manager.set_hotspot_rpto(cfg_check.id, xlx_module="", user_id=uid)
        user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings)
        await save_user_settings(uid, user_sett.model_dump())
        if uid == 1:
            save_app_settings(user_sett)
        return {
            "status": "ok",
            "hotspot_id": cfg_check.id,
            "hotspot_name": cfg_check.name,
            "device_id": device_id_check or str(cfg_check.dmr_id or ""),
            "dropped_slots": [2],
            "dmr_4000_sent": True,
            "message": _tr("xlx.module_disconnected_for", fallback="XLX module disconnected (TG 4000) for {name}", name=cfg_check.name)
        }
    elif net_type != "bm" and cfg_check:
        for s in slots_to_drop:
            hotspot_manager.clear_dynamic_tgs(cfg_check.id, slot=s, user_id=uid)
            hotspot_manager.send_silent_unlink_dmr(cfg_check.id, slot=s, user_id=uid)
        return {
            "status": "ok",
            "hotspot_id": cfg_check.id,
            "hotspot_name": cfg_check.name,
            "device_id": device_id_check or str(cfg_check.dmr_id or ""),
            "dropped_slots": slots_to_drop,
            "dmr_4000_sent": True,
            "message": _tr("bm.dynamic_dropped_tg4000_net", fallback="Dynamic talkgroups dropped (TG 4000) for {name} ({network})", name=cfg_check.name, network=net_type.upper())
        }

    # For BM network:
    # 1. Always send HomeBrew silent unlink DMR burst (TG 4000) on each slot
    if cfg_check:
        for s in slots_to_drop:
            hotspot_manager.clear_dynamic_tgs(cfg_check.id, slot=s, user_id=uid)
            hotspot_manager.send_silent_unlink_dmr(cfg_check.id, slot=s, user_id=uid)

    cfg, device_id, api_key, err = _get_bm_device_and_key(hotspot_id, user_id=uid)

    # If quick_ptt_unlink is True:
    if quick_ptt_unlink:
        if api_key and device_id:
            # Fire and forget BM API drop in background without scheduling reconnect
            def _bg_drop_bm_api(dev_id, key, slots):
                import urllib.request, urllib.error
                for s in slots:
                    url = f"https://api.brandmeister.network/v2/device/{dev_id}/action/dropDynamicGroups/{s}"
                    req = urllib.request.Request(
                        url,
                        headers={
                            "User-Agent": "ProxDMR/0.1",
                            "Authorization": f"Bearer {key}",
                            "Accept": "application/json"
                        }
                    )
                    try:
                        with urllib.request.urlopen(req, timeout=4) as resp:
                            resp.read()
                    except Exception as e:
                        logger.debug(f"[BM_DROP_API] Async drop TS{s} warning: {e}")
            asyncio.create_task(asyncio.to_thread(_bg_drop_bm_api, device_id, api_key, slots_to_drop))

        return {
            "status": "ok",
            "hotspot_id": cfg_check.id if cfg_check else (cfg.id if cfg else hotspot_id),
            "hotspot_name": cfg_check.name if cfg_check else (cfg.name if cfg else ""),
            "device_id": device_id_check or str(getattr(cfg_check, "dmr_id", "") or device_id or ""),
            "dropped_slots": slots_to_drop,
            "dmr_4000_sent": True,
            "message": _tr("bm.tg4000_sent", fallback="Sent TG 4000 burst ({slots}) for {name}", slots=', '.join(f'TS{s}' for s in slots_to_drop), name=(cfg_check.name if cfg_check else ''))
        }

    # Standard drop via BM API (when called from modal / UI button)
    if err:
        return {"status": "error", "detail": err}

    _req_lang = get_lang(user_id=uid)

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
            "message": _tr("bm.dynamic_dropped_slots", lang=_req_lang, fallback="Dynamic talkgroups dropped for {name} ({device_id}), slots: {slots}", name=cfg.name, device_id=device_id, slots=', '.join(f'TS{s}' for s in dropped))
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
    net_type = (getattr(cfg, "network_type", "bm") or "bm").strip().lower() if cfg else "bm"
    if net_type == "tgif" and len(tg_resolver.tgif_cache) < 50:
        await tg_resolver.fetch_tgif_catalog()
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
        is_bm = (net_type == "bm")
        with concurrent.futures.ThreadPoolExecutor(max_workers=7) as ex:
            f_tg = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/talkgroup/{clean_id}") if is_bm else None
            f_reg = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/registry/{clean_id}") if is_bm else None
            f_radio_user = ex.submit(_fetch_url, f"https://database.radioid.net/api/dmr/user/?id={clean_id}") if (clean_id.isdigit() and len(clean_id) >= 5) else None
            f_radio_rep = ex.submit(_fetch_url, f"https://database.radioid.net/api/dmr/repeater/?id={clean_id}") if (clean_id.isdigit() and len(clean_id) in (6, 7)) else None
            f_dev_direct = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/{clean_id}") if (is_bm and clean_id.isdigit() and len(clean_id) >= 6) else None
            f_prof_direct = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/{clean_id}/profile") if (is_bm and clean_id.isdigit() and len(clean_id) >= 6) else None
            f_hs_subs = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/{hs_device_id}/talkgroup", hs_api_key) if (is_bm and hs_device_id) else None
            f_dev_by_call = ex.submit(_fetch_url, f"https://api.brandmeister.network/v2/device/byCall?callsign={urllib.parse.quote(res_call)}") if (is_bm and res_call) else None

            tg_res = f_tg.result() if f_tg else None
            reg_res = f_reg.result() if f_reg else None
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
        elif is_bm and res_call and not dev_by_call_res:
            extra_devs = _fetch_url(f"https://api.brandmeister.network/v2/device/byCall?callsign={urllib.parse.quote(res_call)}")
            if isinstance(extra_devs, list):
                for d in extra_devs:
                    if isinstance(d, dict) and d.get("id") and not any(existing.get("id") == d.get("id") for existing in dev_list):
                        dev_list.append(d)

        # Also if reg_data was empty by ID but we resolved callsign, look up registry by callsign
        if is_bm and not reg_data and res_call:
            by_call_reg = _fetch_url(f"https://api.brandmeister.network/v2/registry/byCall/{urllib.parse.quote(res_call)}")
            if isinstance(by_call_reg, list) and by_call_reg:
                reg_data = by_call_reg[0]
            elif isinstance(by_call_reg, dict) and not by_call_reg.get("error"):
                reg_data = by_call_reg

        # If no device profile yet, but we found devices, fetch profile of the first device
        if is_bm and not prof_data and dev_list:
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

        local_name = tg_resolver.get_name(target_tg_num, network_type=net_type) if target_tg_num > 0 else ""
        generic_bm_group = _tr("tg_catalog.bm_group", fallback="BrandMeister Group")
        if local_name and local_name in (f"TG {target_tg_num}", "Группа BrandMeister", "Группа BM", "BrandMeister Group", generic_bm_group):
            local_name = ""
        tg_display_name = (tg_data.get("Name") if is_bm else "") or local_name or ""

        # Dates
        valid_created = [d.get("created_at") for d in dev_list if isinstance(d, dict) and d.get("created_at")]
        bm_created = min(valid_created) if valid_created else None
        valid_updated = [d.get("updated_at") for d in dev_list if isinstance(d, dict) and d.get("updated_at")]
        bm_updated = max(valid_updated) if valid_updated else None

        # 8. Classification
        has_operator = bool(reg_data.get("Call") or reg_data.get("Name") or radioid_user_info)
        has_device = bool(dev_list or radioid_rep_info)
        has_tg = bool((is_bm and (tg_data.get("ID") or tg_data.get("Name"))) or local_name)

        is_repeater = False
        if radioid_rep_info:
            is_repeater = True
        elif dev_direct_data and dev_direct_data.get("rx") and dev_direct_data.get("tx") and dev_direct_data.get("rx") != dev_direct_data.get("tx"):
            is_repeater = True
        elif len(clean_id) == 6 and has_device:
            is_repeater = True

        if has_operator and len(clean_id) == 7:
            detected_type = "operator"
            detected_label = _tr("bm.type_operator", fallback="Amateur Radio Operator DMR ID")
        elif is_repeater:
            detected_type = "repeater"
            detected_label = _tr("bm.type_repeater", fallback="DMR Repeater") if not is_bm else _tr("bm.type_repeater_bm", fallback="BrandMeister DMR Repeater")
        elif has_device and not has_operator:
            detected_type = "hotspot"
            detected_label = _tr("bm.type_hotspot", fallback="MMDVM Personal Hotspot")
        elif has_operator:
            detected_type = "operator"
            detected_label = _tr("bm.type_operator", fallback="Amateur Radio Operator DMR ID")
        elif has_tg:
            detected_type = "talkgroup"
            detected_label = _tr("bm.type_talkgroup", fallback="TalkGroup")
        else:
            detected_type = "talkgroup" if t_type == "TG" else "unknown"
            detected_label = _tr("bm.type_custom_group_id", fallback="Custom Group / ID")

        cross_info_note = ""
        if t_type == "TG" and has_operator:
            name_suffix = f" ({full_name})" if full_name else ""
            cross_info_note = _tr(
                "bm.cross_info_personal_id",
                fallback="Identifier {id} (incoming as TG) belongs to amateur radio operator {callsign}{name_suffix}. In DMR networks, such personal IDs can be used as tactical talkgroups or for private calls.",
                id=clean_id,
                callsign=res_call or "DMR",
                name_suffix=name_suffix,
            )
        elif t_type == "ID" and has_tg and not has_operator:
            cross_info_note = _tr(
                "bm.cross_info_talkgroup",
                fallback="Identifier {id} is registered on the network as TalkGroup ({tg_name}).",
                id=clean_id,
                tg_name=tg_display_name,
            )

        return {
            "status": "ok",
            "network_type": net_type,
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
                "bm_name": tg_data.get("Name") or "" if is_bm else local_name,
                "local_name": local_name,
                "is_registered": bool((is_bm and (tg_data.get("ID") or tg_data.get("Name"))) or local_name),
                "is_subscribed": bool(matched_slot),
                "slot": matched_slot,
                "description": (tg_data.get("description") if is_bm else "") or ""
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
                "name": cfg.name if cfg else _tr("bm.hotspot_default_name", fallback="Hotspot"),
                "device_id": hs_device_id or "",
                "has_api_key": bool(hs_api_key)
            },
            "subscription": {
                "is_subscribed": bool(matched_slot),
                "slot": matched_slot
            }
        }

    _ctx = contextvars.copy_context()
    return await asyncio.to_thread(_ctx.run, _process)

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

    _req_lang = get_lang(user_id=uid)

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
                return {"status": "error", "detail": _tr("bm.no_device_id", lang=_req_lang, fallback="Device ID is not specified")}
            url = f"https://api.brandmeister.network/v2/device/{clean_id}/profile"

        elif q_type == "device_talkgroup":
            target_device = device_id
            if not target_device and clean_id and clean_id.isdigit() and len(clean_id) >= 6:
                target_device = clean_id
            if not target_device:
                return {"status": "error", "detail": _tr("bm.cannot_resolve_hotspot_id", lang=_req_lang, fallback="Failed to determine BM hotspot ID")}
            url = f"https://api.brandmeister.network/v2/device/{target_device}/talkgroup"
            target_name = f"{cfg.name or _tr('bm.hotspot_default_name', lang=_req_lang, fallback='Hotspot')} ({target_device})" if cfg else str(target_device)

        elif q_type == "talkgroup_info":
            if not clean_id:
                return {"status": "error", "detail": _tr("bm.no_tg_number", lang=_req_lang, fallback="TalkGroup number is not specified")}
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
                return {"status": "error", "detail": _tr("bm.cannot_resolve_callsign", lang=_req_lang, fallback="Failed to resolve callsign for ID {id}", id=clean_id)}
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
                return {"status": "error", "detail": _tr("bm.no_id_or_callsign", lang=_req_lang, fallback="ID or callsign is not specified for registry lookup")}

        else:
            return {"status": "error", "detail": _tr("bm.unknown_query_type", lang=_req_lang, fallback="Unknown query type: {query_type}", query_type=q_type)}

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
                    "detail": _tr("bm.data_not_found_404", lang=_req_lang, fallback="Data not found in BM (HTTP 404). {error}", error=err_body).strip(),
                    "query_type": query_type,
                    "target_id": clean_id,
                    "callsign": clean_call,
                    "target_name": target_name
                }
            elif e.code in (401, 403):
                return {
                    "status": "unauthorized",
                    "detail": _tr("bm.auth_key_required_http", lang=_req_lang, fallback="Authorized BM API Key required (HTTP {code}). {error}", code=e.code, error=err_body).strip(),
                    "query_type": query_type,
                    "target_id": clean_id,
                    "callsign": clean_call,
                    "target_name": target_name
                }
            return {
                "status": "error",
                "detail": _tr("bm.api_http_err_detail", lang=_req_lang, fallback="BM API error: HTTP {code}. {error}", code=e.code, error=err_body).strip(),
                "query_type": query_type,
                "target_id": clean_id,
                "callsign": clean_call,
                "target_name": target_name
            }
        except Exception as ex:
            return {
                "status": "error",
                "detail": _tr("bm.connection_err_detail", lang=_req_lang, fallback="BM connection error: {error}", error=str(ex)),
                "query_type": query_type,
                "target_id": clean_id,
                "callsign": clean_call,
                "target_name": target_name
            }

    return await asyncio.to_thread(_query)

# --- General Status & Backward Compatibility API ---

@app.get("/api/health")
async def get_health():
    _prune_dead_ws_clients()
    total_online = 0
    total_hs = 0
    try:
        for u in hotspot_manager.user_runtimes.values():
            total_hs += len(u)
        for ws in list(connected_clients):
            uid = ws_user_map.get(ws)
            if not uid:
                continue
            user_rts = hotspot_manager.user_runtimes.get(uid, {})
            active_hids = ws_active_hotspots.get(ws)
            if active_hids is not None:
                for hid in list(active_hids):
                    rt = user_rts.get(hid)
                    if rt and getattr(rt.status, 'value', str(rt.status)).lower() == 'online':
                        total_online += 1
            else:
                for rt in user_rts.values():
                    if not getattr(rt.config, 'collapsed', False) and getattr(rt.status, 'value', str(rt.status)).lower() == 'online':
                        total_online += 1
    except Exception:
        pass
    return {
        "status": "online",
        "hotspots_online": total_online,
        "hotspots_total": total_hs,
        "clients_connected": len(connected_clients),
        "version": APP_VERSION,
        "uptime": memguard.uptime_sec(),
        "rss_mb": memguard.read_rss_mb(),
        "started_at": memguard.started_at_iso(),
    }

@app.get("/api/status")
async def get_status(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings
    u_radio_state = get_user_radio_state(uid)
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
        "active_hotspot": (mask_hotspot_dict_for_demo(active_hs.to_dict()) if (user and user.get("is_demo") and active_hs) else (active_hs.to_dict() if active_hs else None)),
        "bm_status": active_hs.status.value if active_hs else "OFFLINE",
        "bm_detail": active_hs.detail if active_hs else _tr("common.disconnected", fallback="Disconnected"),
        "bm_master": f"{cfg.bm_master_host}:{cfg.bm_master_port}" if cfg else "---",
    }

@app.post("/api/system/restart")
async def restart_system(request: Request):
    _require_admin(request)
    logger.warning("[SYSTEM] Server restart initiated via client API")
    try:
        await broadcast_json({
            "type": "server_restart",
            "message": _tr("system.restarting", fallback="Server is restarting...")
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
    return {"status": "ok", "message": _tr("system.restarting", fallback="Server is restarting...")}

class ApplyUpdateRequest(BaseModel):
    tarball_url: Optional[str] = None

@app.get("/api/system/check-update")
async def check_update_endpoint(request: Request, force: bool = False):
    user = _get_user_from_request(request)
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    nocache_headers = {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        "Pragma": "no-cache",
        "Expires": "0",
    }
    if user.get("is_demo"):
        return JSONResponse(
            content={
                "status": "ok",
                "has_update": False,
                "current_version": APP_VERSION,
                "current_date": APP_VERSION_DATE,
                "latest_version": APP_VERSION,
                "release_date": APP_VERSION_DATE,
                "disable_update_notifications": True,
                "is_admin": False,
                "is_demo": True,
                "release_notes": {},
            },
            headers=nocache_headers,
        )
    try:
        data = await asyncio.to_thread(check_for_updates, force=force)
        sett = hotspot_manager.user_settings.get(1) or hotspot_manager.settings
        data["disable_update_notifications"] = bool(getattr(sett, "disable_update_notifications", False))
        data["is_admin"] = user.get("role") in ("admin", "superadmin")
        return JSONResponse(content=data, headers=nocache_headers)
    except Exception as e:
        logger.error(f"[UPDATER] Error checking updates: {e}")
        return JSONResponse(
            content={"status": "error", "message": str(e), "has_update": False},
            headers=nocache_headers,
        )

@app.post("/api/system/apply-update")
async def apply_update_endpoint(request: Request, payload: Optional[ApplyUpdateRequest] = None):
    _require_admin(request)
    url = payload.tarball_url if payload else None
    logger.warning("[SYSTEM] Update initiated via client API")
    try:
        await broadcast_json({
            "type": "server_updating",
            "message": _tr("system.updating_restarting", fallback="Installing update and restarting server...")
        })
    except Exception as e:
        logger.error(f"[SYSTEM] Error broadcasting update status: {e}")

    success, msg = await asyncio.to_thread(apply_update, tarball_url=url)
    if not success:
        raise HTTPException(status_code=500, detail=msg)

    try:
        await hotspot_manager.stop()
    except Exception:
        pass
    try:
        bm_ping_service.stop()
    except Exception:
        pass

    return {"status": "ok", "message": msg}

# --- HamQTH.com XML API Endpoints ---

class HamQthTestRequest(BaseModel):
    portal: Optional[str] = "hamqth"
    username: Optional[str] = None
    password: Optional[str] = None
    session_key: Optional[str] = None

@app.post("/api/hamqth/test")
async def test_hamqth_connection(payload: Optional[HamQthTestRequest] = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)

    portal = (payload.portal if payload and payload.portal else "hamqth").lower()
    if portal == "qrz_com":
        username = (payload.username if payload and payload.username is not None else getattr(s, "qrz_com_username", "")) or ""
        password = (payload.password if payload and payload.password is not None else getattr(s, "qrz_com_password", "")) or ""
    else:  # hamqth
        username = (payload.username if payload and payload.username is not None else getattr(s, "hamqth_username", "")) or ""
        password = (payload.password if payload and payload.password is not None else getattr(s, "hamqth_password", "")) or ""

    session_key = (payload.session_key if payload and payload.session_key is not None else "") or ""

    res = await hamqth_service.test_connection(username, password, session_key, portal=portal)
    return res

@app.get("/api/callsign/hamqth/{query}")
async def lookup_callsign_hamqth(query: str, request: Request):
    user = _get_user_from_request(request)
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    login = user.get("login", "") if user else ""
    s = await ensure_active_user(uid, login)

    sett_u1 = hotspot_manager.user_settings.get(1) or hotspot_manager.settings

    qrz_com_u = getattr(s, "qrz_com_username", "") or (getattr(sett_u1, "qrz_com_username", "") if sett_u1 else "") or ""
    qrz_com_p = getattr(s, "qrz_com_password", "") or (getattr(sett_u1, "qrz_com_password", "") if sett_u1 else "") or ""

    hamqth_u = getattr(s, "hamqth_username", "") or (getattr(sett_u1, "hamqth_username", "") if sett_u1 else "") or ""
    hamqth_p = getattr(s, "hamqth_password", "") or (getattr(sett_u1, "hamqth_password", "") if sett_u1 else "") or ""


    creds = {
        "qrz_com": (qrz_com_u, qrz_com_p),
        "hamqth": (hamqth_u, hamqth_p),
    }

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
                "message": _tr("hamqth.id_not_found_radioid", fallback="DMR ID {id} not found in RadioID database, cannot resolve callsign for HamQTH.com lookup", id=query.strip())
            }

    res = await hamqth_service.lookup_callsign_multi(target, creds)
    return res

@app.get("/api/config")
async def get_config(request: Request = None):
    user = _get_user_from_request(request) if request else None
    uid = user["user_id"] if user else (hotspot_manager.active_user_id or 1)
    if user:
        await ensure_active_user(uid, user.get("login", ""))
    active_hs = hotspot_manager.get_active_runtime(uid)
    if active_hs:
        res = active_hs.config.model_dump()
        return mask_hotspot_dict_for_demo(res) if (user and user.get("is_demo")) else res
    user_sett = hotspot_manager.user_settings.get(uid, hotspot_manager.settings) if uid else hotspot_manager.settings
    res = user_sett.hotspots[0].model_dump() if user_sett.hotspots else HotspotConfig().model_dump()
    return mask_hotspot_dict_for_demo(res) if (user and user.get("is_demo")) else res

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
    raw_calls = [e.to_dict() for e in hotspot_manager.get_calls_history(user_id=uid)]
    if user and user.get("is_demo"):
        raw_calls = [mask_call_entry_for_demo(c) for c in raw_calls]
    return {
        "calls": raw_calls
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
        limit=min(500, max(1, limit)),
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
    stats["auto_record"] = bool(hotspot_manager.recorder.auto_rx_enabled or hotspot_manager.recorder.auto_tx_enabled) if hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder else True
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
            raise HTTPException(status_code=400, detail=_tr("recordings.audio_not_found", fallback="Recording audio file not found on disk"))

        wav_bytes = await asyncio.to_thread(file_path.read_bytes)
        mime = "audio/mpeg" if file_path.suffix.lower() == ".mp3" else "audio/wav"

        transcribed_text, det_lang, err = await transcriber_service.transcribe_wav(
            wav_bytes,
            src_callsign=rec.get("src_callsign", ""),
            src_id=rec.get("src_id", 0),
            mime_type=mime
        )
        if err or not transcribed_text:
            return JSONResponse({"status": "error", "message": err or _tr("recordings.asr_failed", fallback="Failed to recognize speech in recording")}, status_code=400)

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
        return JSONResponse({"status": "error", "message": err or _tr("transcriber.tts_synth_error", fallback="Speech synthesis error")}, status_code=400)

    b64 = base64.b64encode(wav_bytes).decode("ascii")
    return {
        "status": "ok",
        "audio_base64": b64,
        "text": text,
        "target_lang": target_lang,
        "recording_id": rec["id"]
    }


# Active server-side recording-to-TX streaming tasks per user_id
active_rec_tx_tasks: Dict[int, asyncio.Task] = {}


async def _stop_active_rec_tx(uid: int):
    task = active_rec_tx_tasks.pop(uid, None)
    if task and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            pass
    u_radio_state = get_user_radio_state(uid)
    if u_radio_state.is_transmitting and str(u_radio_state.transmitting_client_id or "").startswith("rec_tx_"):
        await hotspot_manager.stop_tx(user_id=uid, roger_beep=False)
        u_radio_state.is_transmitting = False
        u_radio_state.transmitting_client_id = None
        duration = max(0.0, time.time() - (u_radio_state.tx_start_time or time.time()))
        active_hs = hotspot_manager.get_active_runtime(uid)
        await broadcast_user_json(uid, {
            "type": "state_change",
            "is_tx": False,
            "client_id": f"rec_tx_{uid}",
            "hotspot_id": active_hs.config.id if active_hs else "",
            "duration": duration,
            "slot": u_radio_state.tx_slot,
            "active_tg": u_radio_state.active_tg,
        })


@app.post("/api/recordings/{rec_id}/tx/start")
async def api_recording_tx_start(rec_id: str, payload: dict = None, request: Request = None):
    user = _get_user_from_request(request) if request else None
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    if user.get("is_swl") or user.get("is_demo"):
        raise HTTPException(status_code=403, detail="TX not permitted in SWL/Demo mode")

    uid = int(user["user_id"])
    rec = await get_recording_by_id(rec_id)
    if not rec:
        rec = await get_recording_by_call_id(rec_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Recording not found")

    file_path = Path(rec.get("file_path", ""))
    if not file_path.exists() or file_path.stat().st_size <= 44:
        raise HTTPException(status_code=404, detail="Recording audio file not found on disk")

    data = payload or {}
    req_hid = str(data.get("hotspot_id") or "").strip()
    target_rt = (hotspot_manager.get_runtime(uid, req_hid) if req_hid else None) or hotspot_manager.get_active_runtime(uid)
    if not target_rt:
        raise HTTPException(status_code=400, detail="Target hotspot not found")
    if getattr(target_rt, "status", None) != BMState.ONLINE:
        raise HTTPException(status_code=400, detail="Target hotspot is offline")

    await _stop_active_rec_tx(uid)

    net_type = str(getattr(target_rt.config, "network_type", "bm") or "bm").lower()
    req_slot = int(data.get("slot") or 2)
    slot = 1 if req_slot == 1 else 2
    req_tg = int(data.get("dst_id") or 0)

    if net_type == "allstar":
        slot = 1
        conn_node = getattr(target_rt, "connected_node", None)
        if not conn_node and getattr(target_rt, "asl_links", None):
            conn_node = target_rt.asl_links[0]
        if not conn_node:
            conn_node = getattr(target_rt.config, "allstar_node", 1999)
        try:
            tg = int(conn_node)
        except (ValueError, TypeError):
            tg = 1999
    elif net_type == "ysf":
        slot = 1
        ysf_rid = str(getattr(target_rt.config, "ysf_room_id", "") or getattr(target_rt.config, "ysf_room", "") or "25000").strip()
        tg = int(ysf_rid) if ysf_rid.isdigit() else 25000
    elif net_type == "xlx":
        slot = 2
        tg = req_tg if req_tg > 0 else 9
    else:
        tg = req_tg if req_tg > 0 else (getattr(target_rt.config, "default_tg", 0) or getattr(target_rt.config, "default_tg_ts2", 9990) or 9990)

    offset_sec = max(0.0, float(data.get("offset_sec") or 0.0))
    max_dur_sec = min(60.0, max(1.0, float(data.get("max_duration_sec") or 60.0)))

    try:
        with wave.open(str(file_path), "rb") as wf:
            sr = wf.getframerate() or 8000
            start_frame = min(wf.getnframes(), int(offset_sec * sr))
            max_frames = int(max_dur_sec * sr)
            wf.setpos(start_frame)
            pcm_data = wf.readframes(max_frames)
    except Exception as e:
        logger.error(f"[REC_TX] Error reading WAV {file_path}: {e}")
        raise HTTPException(status_code=500, detail="Could not read recording WAV file")

    if not pcm_data:
        return {"status": "empty"}

    u_radio_state = get_user_radio_state(uid)
    call_type = "PRIVATE" if (tg == 9990 or tg > 999999) else "GROUP"
    started = hotspot_manager.start_tx(
        hotspot_id=target_rt.config.id,
        slot=slot,
        dst_id=tg,
        call_type=call_type,
        user_id=uid,
    )
    if not started:
        raise HTTPException(status_code=400, detail="Failed to start TX on target hotspot")

    client_tag = f"rec_tx_{uid}"
    u_radio_state.is_transmitting = True
    u_radio_state.transmitting_client_id = client_tag
    u_radio_state.tx_start_time = time.time()
    u_radio_state.tx_slot = slot
    u_radio_state.active_tg = tg

    await broadcast_user_json(uid, {
        "type": "state_change",
        "is_tx": True,
        "client_id": client_tag,
        "hotspot_id": target_rt.config.id,
        "slot": slot,
        "active_tg": tg,
        "callsign": target_rt.config.callsign,
        "dmr_id": target_rt.config.dmr_id,
    })

    async def _stream_pcm_to_tx(raw_pcm: bytes, target_hid: str, tx_slot: int, tx_tg: int):
        chunk_size = 320  # 20ms @ 8000Hz 16-bit mono
        total_len = len(raw_pcm)
        idx = 0
        next_tick = time.monotonic()
        try:
            while idx < total_len:
                if not u_radio_state.is_transmitting or u_radio_state.transmitting_client_id != client_tag:
                    break
                chunk = raw_pcm[idx:idx + chunk_size]
                if len(chunk) < chunk_size:
                    chunk = chunk + b"\x00" * (chunk_size - len(chunk))
                hotspot_manager.process_tx_audio(chunk, user_id=uid)
                idx += chunk_size
                next_tick += 0.020
                sleep_dur = next_tick - time.monotonic()
                if sleep_dur > 0:
                    await asyncio.sleep(sleep_dur)
        except asyncio.CancelledError:
            raise
        except Exception as err:
            logger.error(f"[REC_TX] Streaming error: {err}")
        finally:
            if u_radio_state.is_transmitting and u_radio_state.transmitting_client_id == client_tag:
                await hotspot_manager.stop_tx(user_id=uid, roger_beep=False)
                u_radio_state.is_transmitting = False
                u_radio_state.transmitting_client_id = None
                dur = max(0.0, time.time() - (u_radio_state.tx_start_time or time.time()))
                await broadcast_user_json(uid, {
                    "type": "state_change",
                    "is_tx": False,
                    "client_id": client_tag,
                    "hotspot_id": target_hid,
                    "duration": dur,
                    "slot": tx_slot,
                    "active_tg": tx_tg,
                })
            if active_rec_tx_tasks.get(uid) == asyncio.current_task():
                active_rec_tx_tasks.pop(uid, None)

    active_rec_tx_tasks[uid] = asyncio.create_task(_stream_pcm_to_tx(pcm_data, target_rt.config.id, slot, tg))
    return {
        "status": "ok",
        "hotspot_id": target_rt.config.id,
        "slot": slot,
        "dst_id": tg,
        "max_duration_sec": max_dur_sec,
    }


@app.post("/api/recordings/tx/stop")
async def api_recording_tx_stop(request: Request = None):
    user = _get_user_from_request(request) if request else None
    if not user:
        raise HTTPException(status_code=401, detail="Unauthorized")
    uid = int(user["user_id"])
    await _stop_active_rec_tx(uid)
    return {"status": "ok"}


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
        return JSONResponse({"status": "error", "detail": _tr("transcriber.no_gemini_key_settings", fallback="Gemini API key is not configured in transcription settings")}, status_code=400)

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
        return {"status": "ok", "queued": 0, "message": _tr("recordings.batch_no_audio_files", fallback="No audio files to transcribe among selected recordings")}

    # Sort recordings chronologically
    valid_recordings.sort(key=lambda r: r.get("created_at", 0))

    hid = payload.get("hotspot_id")
    if not hid or hid == "all":
        hid = valid_recordings[0].get("hotspot_id") or "default"

    runner = offline_transcribe_manager.get_runner(hid)
    if runner.is_running:
        return JSONResponse(
            status_code=409,
            content={"status": "error", "queued": 0, "detail": _tr("transcriber.offline_already_running", fallback="Offline transcription for this hotspot is already running")}
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
            content={"status": "error", "queued": 0, "detail": _tr("transcriber.offline_start_failed", fallback="Failed to start transcription")}
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
            "seam_beep_pattern": getattr(rec, "seam_beep_pattern", "600-110-33, 840-50-15") if rec else "600-110-33, 840-50-15",
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
        "seam_beep_pattern": getattr(rec, "seam_beep_pattern", "600-110-33, 840-50-15"),
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


# =========================================================================
# LOCAL PARROT TEST ENGINE (DMR AMBE+2 / ASL G.711) + TEMP 3-STAGE DIAG
# =========================================================================
import math
import struct
import wave
from typing import Tuple

PARROT_DIAG_DIR = BASE_DIR / "data" / "parrot_diag"
PARROT_DIAG_MAX_RUNS = 25


def _compute_pcm16_diag_metrics(pcm_bytes: bytes) -> dict:
    """Computes objective PCM16 @ 8 kHz mono quality metrics for TX speech diagnostics."""
    valid_len = (len(pcm_bytes) // 2) * 2 if pcm_bytes else 0
    if valid_len < 2:
        return {"samples": 0, "duration_sec": 0.0}

    n_samples = valid_len // 2
    samples = struct.unpack(f"<{n_samples}h", pcm_bytes[:valid_len])
    duration_sec = round(n_samples / 8000.0, 3)

    total = 0
    sum_sq = 0
    peak_abs = 0
    hard_clip = 0
    soft_knee = 0
    zero_count = 0
    max_delta = 0
    prev = samples[0]

    for idx, s in enumerate(samples):
        total += s
        sum_sq += s * s
        a = -s if s < 0 else s
        if a > peak_abs:
            peak_abs = a
        if s >= 32760 or s <= -32767:
            hard_clip += 1
        if a >= 24576:
            soft_knee += 1
        if s == 0:
            zero_count += 1
        if idx > 0:
            d = abs(s - prev)
            if d > max_delta:
                max_delta = d
            prev = s

    rms = math.sqrt(sum_sq / n_samples) if n_samples else 0.0
    peak_dbfs = round(20.0 * math.log10(peak_abs / 32768.0), 2) if peak_abs > 0 else -120.0
    rms_dbfs = round(20.0 * math.log10(rms / 32768.0), 2) if rms > 0.0 else -120.0
    crest_factor_db = round(peak_dbfs - rms_dbfs, 2) if (peak_abs > 0 and rms > 0.0) else 0.0

    frame_size = 160  # 20 ms @ 8 kHz
    frame_rms_db = []
    silent_frames = 0
    total_frames = n_samples // frame_size
    for f_idx in range(total_frames):
        base = f_idx * frame_size
        f_sq = 0
        f_peak = 0
        for s in samples[base:base + frame_size]:
            f_sq += s * s
            a = -s if s < 0 else s
            if a > f_peak:
                f_peak = a
        if f_peak <= 2:
            silent_frames += 1
        f_rms = math.sqrt(f_sq / frame_size)
        frame_rms_db.append(round(20.0 * math.log10(f_rms / 32768.0), 2) if f_rms > 0.0 else -120.0)

    active_frame_db = sorted(db for db in frame_rms_db if db > -65.0)
    rms_p95_dbfs = active_frame_db[min(len(active_frame_db) - 1, int(len(active_frame_db) * 0.95))] if active_frame_db else -120.0

    return {
        "samples": n_samples,
        "duration_sec": duration_sec,
        "dc_offset": round(total / n_samples, 2),
        "peak_abs": peak_abs,
        "peak_dbfs": peak_dbfs,
        "rms_dbfs": rms_dbfs,
        "active_rms_p95_dbfs": rms_p95_dbfs,
        "crest_factor_db": crest_factor_db,
        "hard_clip_samples": hard_clip,
        "hard_clip_pct": round((hard_clip * 100.0) / n_samples, 4),
        "soft_knee_samples": soft_knee,
        "soft_knee_pct": round((soft_knee * 100.0) / n_samples, 3),
        "zero_samples_pct": round((zero_count * 100.0) / n_samples, 2),
        "silent_20ms_frames": silent_frames,
        "total_20ms_frames": total_frames,
        "silent_20ms_frames_pct": round((silent_frames * 100.0) / total_frames, 2) if total_frames else 0.0,
        "max_sample_delta": max_delta,
    }


def _write_pcm16_wav(filepath: Path, pcm_bytes: bytes, sample_rate: int = 8000) -> str:
    """Writes mono 16-bit PCM bytes as a standard RIFF WAV file."""
    valid_len = (len(pcm_bytes) // 2) * 2 if pcm_bytes else 0
    with wave.open(str(filepath), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(pcm_bytes[:valid_len])
    return str(filepath)


def _resolve_parrot_tx_dsp(user_id: int, network: str, hid: Optional[str], client_settings: Optional[dict]) -> Tuple[Any, dict]:
    """Builds an isolated ServerTxDsp clone calibrated for the requested Parrot network (dmr/allstar)."""
    is_asl = (str(network or "dmr").strip().lower() == "allstar")
    rt = hotspot_manager.get_runtime(user_id, hid) if hid else None
    rt_net = (getattr(getattr(rt, "config", None), "network_type", "") or "").lower() if rt else ""
    if rt is None or (is_asl and rt_net != "allstar") or (not is_asl and rt_net == "allstar"):
        rt = None
        for cand in hotspot_manager.get_user_runtimes(user_id).values():
            c_net = (getattr(getattr(cand, "config", None), "network_type", "bm") or "bm").lower()
            if (is_asl and c_net == "allstar") or (not is_asl and c_net != "allstar"):
                rt = cand
                break

    tx_dsp = None
    try:
        from dmr.tx_dsp import ServerTxDsp
        tx_dsp = ServerTxDsp()
        rt_dsp = getattr(rt, "tx_dsp", None)
        if rt_dsp is not None and hasattr(rt_dsp, "get_settings"):
            base_cfg = rt_dsp.get_settings()
            tx_dsp.set_settings(
                hpf_enabled=base_cfg.get("hpf_enabled"),
                presence_boost=base_cfg.get("presence_boost"),
                eq_low=base_cfg.get("eq_low"),
                eq_mid=base_cfg.get("eq_mid"),
                eq_high=base_cfg.get("eq_high"),
                mic_gain=base_cfg.get("mic_gain"),
                dsp_agc=base_cfg.get("dsp_agc"),
                agc_profile=base_cfg.get("agc_profile"),
            )
        elif is_asl:
            tx_dsp.set_settings(hpf_enabled=True, dsp_agc=True)

        atx_key = "asl_audio_tx" if is_asl else "audio_tx"
        atx = client_settings.get(atx_key) if isinstance(client_settings, dict) else None
        if isinstance(atx, dict) and atx:
            tx_dsp.set_settings(
                hpf_enabled=bool(atx["hpf_enabled"]) if "hpf_enabled" in atx else None,
                presence_boost=float(atx["presence_boost"]) if "presence_boost" in atx else None,
                eq_low=float(atx["eq_low"]) if "eq_low" in atx else None,
                eq_mid=float(atx["eq_mid"]) if "eq_mid" in atx else None,
                eq_high=float(atx["eq_high"]) if "eq_high" in atx else None,
                mic_gain=float(atx["mic_gain"]) if "mic_gain" in atx else None,
                dsp_agc=bool(atx["dsp_agc"]) if "dsp_agc" in atx else None,
                agc_profile=str(atx["agc_profile"]) if "agc_profile" in atx else None,
            )
    except Exception as e:
        logger.warning(f"[PARROT_DIAG] Could not build isolated ServerTxDsp: {e}")
        tx_dsp = getattr(rt, "tx_dsp", None)

    rt_cfg = getattr(rt, "config", None)
    hs_meta = {
        "requested_hotspot_id": hid,
        "resolved_hotspot_id": getattr(rt_cfg, "id", None),
        "resolved_hotspot_name": getattr(rt_cfg, "name", None),
        "resolved_network_type": (getattr(rt_cfg, "network_type", None) or "").lower(),
    }
    return tx_dsp, hs_meta


def _save_parrot_diag_bundle(
    raw_pcm: bytes,
    dsp_pcm: bytes,
    codec_pcm: bytes,
    network: str,
    user_id: int,
    user_login: str,
    hs_meta: dict,
    tx_dsp_settings: dict,
    client_settings: dict,
) -> str:
    """Persists 3 synchronized WAV stages and metadata JSON into src/data/parrot_diag/."""
    PARROT_DIAG_DIR.mkdir(parents=True, exist_ok=True)
    now_dt = datetime.now(timezone.utc)
    net_tag = "asl" if str(network or "dmr").strip().lower() == "allstar" else "dmr"
    base_id = f"{now_dt.strftime('%Y%m%d_%H%M%S_%f')[:19]}_{net_tag}"
    run_id = base_id
    seq = 1
    while (PARROT_DIAG_DIR / f"{run_id}_meta.json").exists():
        seq += 1
        run_id = f"{base_id}_{seq}"

    f_raw = PARROT_DIAG_DIR / f"{run_id}_1_raw_mic.wav"
    f_dsp = PARROT_DIAG_DIR / f"{run_id}_2_post_tx_dsp.wav"
    f_cod = PARROT_DIAG_DIR / f"{run_id}_3_post_codec.wav"

    _write_pcm16_wav(f_raw, raw_pcm, 8000)
    _write_pcm16_wav(f_dsp, dsp_pcm, 8000)
    _write_pcm16_wav(f_cod, codec_pcm, 8000)

    meta = {
        "run_id": run_id,
        "created_at_utc": now_dt.isoformat(),
        "network_mode": net_tag,
        "network_requested": network,
        "user_id": user_id,
        "user_login": user_login,
        "hotspot": hs_meta,
        "tx_dsp_settings": tx_dsp_settings,
        "client_settings_snapshot": {
            "audio_tx": (client_settings or {}).get("audio_tx", {}),
            "asl_audio_tx": (client_settings or {}).get("asl_audio_tx", {}),
            "ambe_rx": (client_settings or {}).get("ambe_rx", {}),
        },
        "audio_metrics": {
            "stage1_raw_mic": _compute_pcm16_diag_metrics(raw_pcm),
            "stage2_post_tx_dsp": _compute_pcm16_diag_metrics(dsp_pcm),
            "stage3_post_codec": _compute_pcm16_diag_metrics(codec_pcm),
        },
        "files": {
            "stage1_raw_mic": f_raw.name,
            "stage2_post_tx_dsp": f_dsp.name,
            "stage3_post_codec": f_cod.name,
        },
    }

    meta_text = json.dumps(meta, ensure_ascii=False, indent=2)
    (PARROT_DIAG_DIR / f"{run_id}_meta.json").write_text(meta_text, encoding="utf-8")
    (PARROT_DIAG_DIR / f"latest_{net_tag}_meta.json").write_text(meta_text, encoding="utf-8")
    (PARROT_DIAG_DIR / "latest_meta.json").write_text(meta_text, encoding="utf-8")

    # Rotate old diagnostic bundles, keep only PARROT_DIAG_MAX_RUNS most recent
    meta_files = sorted(
        (p for p in PARROT_DIAG_DIR.glob("*_meta.json") if not p.name.startswith("latest_")),
        key=lambda p: p.name,
        reverse=True,
    )
    for old_meta in meta_files[PARROT_DIAG_MAX_RUNS:]:
        old_prefix = old_meta.name[:-10]  # strip _meta.json
        for suffix in ("_meta.json", "_1_raw_mic.wav", "_2_post_tx_dsp.wav", "_3_post_codec.wav"):
            old_f = PARROT_DIAG_DIR / f"{old_prefix}{suffix}"
            if old_f.exists():
                try:
                    old_f.unlink()
                except Exception:
                    pass

    return run_id


def _process_dmr_parrot_audio(pcm_data: bytes, target_hs_or_dsp: Any = None) -> Tuple[bytes, bytes]:
    """Encodes PCM to AMBE+2 frames and decodes back via mbelib-neo; returns (codec_pcm, post_dsp_pcm)."""
    if not pcm_data:
        return pcm_data, pcm_data

    # Пропускаем через ServerTxDsp покадрово по 60 мс (960 байт) как в реальном DMR TX
    tx_dsp = target_hs_or_dsp if hasattr(target_hs_or_dsp, "process_burst") else getattr(target_hs_or_dsp, "tx_dsp", None)
    if tx_dsp is not None:
        try:
            tx_dsp.reset()
            dsp_out = bytearray()
            chunk_bytes = 960
            for off in range(0, len(pcm_data), chunk_bytes):
                dsp_out.extend(tx_dsp.process_burst(pcm_data[off:off + chunk_bytes]))
            pcm_data = bytes(dsp_out)
            tx_dsp.reset()
        except Exception as e:
            logger.warning(f"[PARROT] TX DSP processing error in DMR parrot: {e}")

    dsp_pcm = pcm_data
    enc = None
    dec = None
    try:
        import ctypes
        from dmr.vocoder_encoder import DMRVocoderEncoder
        from dmr.vocoder import DMRVocoderDecoder
        enc = DMRVocoderEncoder()
        dec = DMRVocoderDecoder()
        if not enc.is_ready or not dec.is_ready:
            return dsp_pcm, dsp_pcm

        out_pcm = bytearray()
        chunk_bytes = 960  # 60ms @ 8000 Hz 16-bit mono = 480 samples = 960 bytes
        offset = 0

        while offset < len(dsp_pcm):
            part = dsp_pcm[offset:offset + chunk_bytes]
            offset += chunk_bytes
            if len(part) < chunk_bytes:
                part = part + b"\x00" * (chunk_bytes - len(part))

            frames = enc.encode_60ms_superframe(part)
            if frames and len(frames) == 3:
                for raw9 in frames:
                    c_buf = (ctypes.c_uint8 * 9).from_buffer_copy(raw9)
                    dec.lib.mbe_neo_decode_72(
                        dec._slots[1],
                        c_buf,
                        dec._out160,
                        ctypes.byref(dec._meta_c)
                    )
                    out_pcm.extend(bytes(dec._out160))
            else:
                out_pcm.extend(part)

        res_bytes = bytes(out_pcm) if out_pcm else dsp_pcm
        logger.info(f"[PARROT_DMR] Vocoder roundtrip completed: {len(dsp_pcm)}B input -> AMBE+2 encode/decode -> {len(res_bytes)}B output")
        return res_bytes, dsp_pcm
    except Exception as e:
        logger.warning(f"[PARROT_DMR] Vocoder roundtrip error, fallback to raw PCM: {e}")
        return dsp_pcm, dsp_pcm
    finally:
        if enc is not None:
            enc.close()
        if dec is not None:
            dec.close()


def _process_analog_parrot_audio(pcm_data: bytes, target_hs_or_dsp: Any = None) -> Tuple[bytes, bytes]:
    """Encodes PCM to G.711 u-law and decodes back to simulate analog ASL/IAX2 channel; returns (codec_pcm, post_dsp_pcm)."""
    if not pcm_data:
        return pcm_data, pcm_data

    # Пропускаем через ServerTxDsp покадрово по 20 мс (320 байт) — точное соответствие AllStar TX
    tx_dsp = target_hs_or_dsp if hasattr(target_hs_or_dsp, "process_burst") else getattr(target_hs_or_dsp, "tx_dsp", None)
    if tx_dsp is not None:
        try:
            tx_dsp.reset()
            dsp_out = bytearray()
            chunk_bytes = 320
            for off in range(0, len(pcm_data), chunk_bytes):
                dsp_out.extend(tx_dsp.process_burst(pcm_data[off:off + chunk_bytes]))
            pcm_data = bytes(dsp_out)
            tx_dsp.reset()
        except Exception as e:
            logger.warning(f"[PARROT] TX DSP processing error in Analog parrot: {e}")

    dsp_pcm = pcm_data
    try:
        from allstar_engine import pcm16_to_ulaw, ulaw_to_pcm16
        ulaw = pcm16_to_ulaw(dsp_pcm)
        res = ulaw_to_pcm16(ulaw)
        logger.info(f"[PARROT_ANALOG] Analog roundtrip completed: {len(dsp_pcm)}B PCM -> {len(ulaw)}B G.711 u-law -> {len(res)}B PCM")
        return res, dsp_pcm
    except Exception as e:
        logger.warning(f"[PARROT_ANALOG] Analog roundtrip error: {e}")
        return dsp_pcm, dsp_pcm


async def _run_parrot_playback(websocket, client_id: str, pcm_data: bytes, network: str, user_id: int = 1, hid: str = None, user_login: str = ""):
    """Streams decoded audio frames back to the client and persists 3-stage diagnostic WAV bundle."""
    try:
        await asyncio.sleep(0.40)  # Natural turnaround pause
        if not pcm_data or len(pcm_data) < 320:
            await websocket.send_text(json.dumps({"type": "parrot_test_done"}))
            return

        await websocket.send_text(json.dumps({
            "type": "parrot_playback_start",
            "network": network,
            "total_bytes": len(pcm_data)
        }))

        client_settings = {}
        try:
            u_settings = await ensure_active_user(user_id, user_login)
            raw_cs = getattr(u_settings, "client_settings", None)
            if isinstance(raw_cs, dict):
                client_settings = dict(raw_cs)
        except Exception as e:
            logger.warning(f"[PARROT_DIAG] Could not load user client_settings: {e}")

        tx_dsp, hs_meta = _resolve_parrot_tx_dsp(user_id, network, hid, client_settings)
        tx_dsp_settings = tx_dsp.get_settings() if hasattr(tx_dsp, "get_settings") else {}

        if str(network or "dmr").strip().lower() == "dmr":
            processed, dsp_pcm = _process_dmr_parrot_audio(pcm_data, tx_dsp)
        else:
            processed, dsp_pcm = _process_analog_parrot_audio(pcm_data, tx_dsp)

        try:
            diag_run_id = await asyncio.to_thread(
                _save_parrot_diag_bundle,
                pcm_data,
                dsp_pcm,
                processed,
                network,
                user_id,
                user_login,
                hs_meta,
                tx_dsp_settings,
                client_settings,
            )
            logger.info(f"[PARROT_DIAG] Saved 3-stage diagnostic bundle '{diag_run_id}' in {PARROT_DIAG_DIR}")
        except Exception as diag_err:
            logger.warning(f"[PARROT_DIAG] Failed to save diagnostic bundle: {diag_err}")

        chunk_size = 960  # 60ms chunks
        offset = 0
        total = len(processed)
        next_chunk_time = time.monotonic()

        while offset < total:
            chunk = processed[offset:offset + chunk_size]
            offset += chunk_size
            b64_pcm = base64.b64encode(chunk).decode("ascii")
            await websocket.send_text(json.dumps({
                "type": "parrot_audio_chunk",
                "pcm": b64_pcm,
                "network": network
            }))
            next_chunk_time += 0.060
            sleep_sec = next_chunk_time - time.monotonic()
            if sleep_sec > 0:
                await asyncio.sleep(sleep_sec)
            else:
                next_chunk_time = time.monotonic()

        await asyncio.sleep(0.15)
        await websocket.send_text(json.dumps({"type": "parrot_test_done"}))
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning(f"[PARROT] Playback error: {e}")
        try:
            await websocket.send_text(json.dumps({"type": "parrot_test_done"}))
        except Exception:
            pass
    finally:
        active_parrot_sessions.pop(client_id, None)


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
    # Prune stale/disconnected sockets from connected_clients and user_clients
    def _prune_stale_ws():
        dead = {
            s for s in list(connected_clients)
            if s.client_state != WebSocketState.CONNECTED or s.application_state != WebSocketState.CONNECTED
        }
        connected_clients.difference_update(dead)
        for ws_dead in dead:
            dead_uid = ws_user_map.pop(ws_dead, None)
            ws_client_instance_map.pop(ws_dead, None)
            q_dead = ws_audio_queues.pop(ws_dead, None)
            t_dead = ws_audio_tasks.pop(ws_dead, None)
            if q_dead:
                try: q_dead.put_nowait(None)
                except Exception: pass
            if t_dead and not t_dead.done():
                t_dead.cancel()
            if dead_uid and dead_uid in user_clients:
                user_clients[dead_uid].discard(ws_dead)
        if ws_user_id in user_clients:
            stale_u = {
                s for s in list(user_clients[ws_user_id])
                if s.client_state != WebSocketState.CONNECTED or s.application_state != WebSocketState.CONNECTED
            }
            user_clients[ws_user_id].difference_update(stale_u)
            for ws_s in stale_u:
                connected_clients.discard(ws_s)
                ws_user_map.pop(ws_s, None)
                ws_client_instance_map.pop(ws_s, None)
                q_s = ws_audio_queues.pop(ws_s, None)
                t_s = ws_audio_tasks.pop(ws_s, None)
                if q_s:
                    try: q_s.put_nowait(None)
                    except Exception: pass
                if t_s and not t_s.done():
                    t_s.cancel()

    _prune_stale_ws()
    ws_cid = (websocket.query_params.get("cid") or "").strip()[:64]
    ws_is_demo = bool(ws_user.get("is_demo"))
    ws_demo_sid = ws_user.get("demo_sid", "")
    demo_cfg_now = demo_manager.get_config()
    demo_login_name = str(demo_cfg_now.get("login", "demo") or "demo").strip().lower()
    ws_role_pre = "demo" if ws_is_demo else await get_user_role(ws_user_id)
    # Полное исключение для режима и аккаунта ДЕМО
    is_exempt_multi_session = bool(
        ws_is_demo
        or ws_role_pre == "demo"
        or str(ws_login).strip().lower() == demo_login_name
    )

    demo_sess = None
    if ws_is_demo:
        demo_sess = demo_manager.get_session(ws_demo_sid)
        if not demo_sess or not demo_cfg_now.get("enabled"):
            try:
                await websocket.send_text(json.dumps({
                    "type": "demo_expired",
                    "cooldown_seconds": demo_cfg_now.get("cooldown_seconds", 60),
                }))
                await websocket.close(code=4009, reason="Demo session expired")
            except Exception:
                pass
            return

    # Собираем предыдущие НЕ-демо подключения этого же аккаунта ProxDMR
    sockets_to_evict: List[WebSocket] = []
    if not is_exempt_multi_session:
        sockets_to_evict = [
            s for s in list(user_clients.get(ws_user_id, set()))
            if s is not websocket and s not in demo_ws_clients
        ]

    # ВАЖНО: Сначала регистрируем НОВЫЙ сокет и его открытые хотспоты,
    # чтобы при закрытии старого сокета блок finally не свернул хотспоты пользователя!
    connected_clients.add(websocket)
    if ws_user_id not in user_clients:
        user_clients[ws_user_id] = set()
    user_clients[ws_user_id].add(websocket)
    ws_user_map[websocket] = ws_user_id
    if ws_cid:
        ws_client_instance_map[websocket] = ws_cid
    if ws_is_demo:
        demo_ws_clients[websocket] = ws_demo_sid
    elif not is_exempt_multi_session and ws_cid:
        active_user_client_cid[ws_user_id] = ws_cid

    # Start dedicated audio streaming queue & worker task for this client
    audio_q: asyncio.Queue = asyncio.Queue(maxsize=100)
    ws_audio_queues[websocket] = audio_q
    audio_task = asyncio.create_task(_ws_audio_sender_loop(websocket, audio_q))
    ws_audio_tasks[websocket] = audio_task

    user_settings = await ensure_active_user(ws_user_id, ws_login)
    ws_active_hotspots[websocket] = {
        rt.config.id for rt in hotspot_manager.get_user_runtimes(ws_user_id).values()
        if not getattr(rt.config, "collapsed", False)
    }
    u_radio_state = get_user_radio_state(ws_user_id)

    # Теперь переводим все предыдущие подключения этого аккаунта в режим паузы (без разлогина)
    if sockets_to_evict:
        for old_ws in sockets_to_evict:
            old_cid = ws_client_instance_map.pop(old_ws, "")
            old_client_addr = f"{old_ws.client.host}:{old_ws.client.port}" if getattr(old_ws, "client", None) else "unknown"
            same_instance_reconnect = bool(ws_cid and old_cid and ws_cid == old_cid)

            # Отключаем аудио-очередь и убираем старый сокет из активной рассылки сразу
            q_old = ws_audio_queues.pop(old_ws, None)
            t_old = ws_audio_tasks.pop(old_ws, None)
            if q_old:
                try:
                    q_old.put_nowait(None)
                except Exception:
                    pass
            if t_old and not t_old.done():
                t_old.cancel()

            connected_clients.discard(old_ws)
            if ws_user_id in user_clients:
                user_clients[ws_user_id].discard(old_ws)
            ws_user_map.pop(old_ws, None)
            ws_active_hotspots.pop(old_ws, None)

            # Если вытесняемое устройство держало передачу (PTT) — немедленно гасим TX
            if u_radio_state.is_transmitting and u_radio_state.transmitting_client_id == old_client_addr:
                try:
                    await hotspot_manager.stop_tx(user_id=ws_user_id)
                except Exception:
                    pass
                u_radio_state.is_transmitting = False
                u_radio_state.transmitting_client_id = None

            if same_instance_reconnect:
                logger.info(f"[WS] Replaced stale socket of same client instance cid={ws_cid} (user={ws_login})")
                try:
                    await old_ws.close(code=4000, reason="Replaced by same client instance")
                except Exception:
                    pass
            else:
                logger.info(
                    f"[WS] Pausing previous device {old_client_addr} (old_cid={old_cid or '-'}) "
                    f"for user={ws_login} (id={ws_user_id}) -> priority taken by {client_id} (new_cid={ws_cid or '-'})"
                )
                try:
                    await old_ws.send_text(json.dumps({
                        "type": "session_paused",
                        "reason": "another_device",
                        "login": ws_login,
                    }))
                except Exception:
                    pass
                try:
                    await old_ws.close(code=4010, reason="Paused by another device")
                except Exception:
                    pass

    logger.info(f"[WS] Client connected: {client_id} (user={ws_login}, demo={ws_is_demo}, cid={ws_cid or '-'}), total: {len(connected_clients)}, user_total: {len(user_clients[ws_user_id])}")
    asyncio.create_task(visitor_stats.record_visit(
        visitor_stats.client_ip(websocket),
        websocket.headers.get("user-agent", ""),
        websocket.cookies.get(visitor_stats.CID_COOKIE),
    ))

    active_hs = hotspot_manager.get_active_runtime(ws_user_id)
    default_unified_tg = getattr(active_hs.config, "default_tg", getattr(active_hs.config, "default_tg_ts2", 2501)) if active_hs else 2501
    tg_ts1 = default_unified_tg
    tg_ts2 = default_unified_tg
    active_tg = u_radio_state.active_tg or default_unified_tg
    apk_meta = get_current_apk_metadata()

    wp_dir = STATIC_DIR / "img" / "wallpapers"
    custom_wp_dark = f"/static/img/wallpapers/bg-custom-u{ws_user_id}-dark.jpg?v={int((wp_dir / f'bg-custom-u{ws_user_id}-dark.jpg').stat().st_mtime)}" if (wp_dir / f"bg-custom-u{ws_user_id}-dark.jpg").exists() else (f"/static/img/bg-custom-dark.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-dark.jpg').stat().st_mtime)}" if ws_user_id == 1 and (STATIC_DIR / "img" / "bg-custom-dark.jpg").exists() else None)
    custom_wp_light = f"/static/img/wallpapers/bg-custom-u{ws_user_id}-light.jpg?v={int((wp_dir / f'bg-custom-u{ws_user_id}-light.jpg').stat().st_mtime)}" if (wp_dir / f"bg-custom-u{ws_user_id}-light.jpg").exists() else (f"/static/img/bg-custom-light.jpg?v={int((STATIC_DIR / 'img' / 'bg-custom-light.jpg').stat().st_mtime)}" if ws_user_id == 1 and (STATIC_DIR / "img" / "bg-custom-light.jpg").exists() else None)

    all_user_rts = list(hotspot_manager.get_user_runtimes(ws_user_id).values())
    visible_rts = [rt for rt in all_user_rts if not (ws_is_demo and _is_asl_hotspot_obj(rt))]
    if ws_is_demo and _is_asl_hotspot_obj(active_hs):
        active_hs = visible_rts[0] if visible_rts else None
    init_active_hid = (active_hs.config.id if active_hs else "default") if ws_is_demo else user_settings.active_hotspot_id
    ws_role = ws_role_pre if 'ws_role_pre' in locals() else ("demo" if ws_is_demo else await get_user_role(ws_user_id))
    ws_is_swl = True if ws_is_demo else await is_user_swl(ws_user_id)

    demo_timer_task = None
    all_ws_cols = await get_all_collections(ws_user_id)
    if not hasattr(hotspot_manager, "user_ysf_room_types"):
        hotspot_manager.user_ysf_room_types = {}
    hotspot_manager.user_ysf_room_types[ws_user_id] = dict(all_ws_cols.get("ysf_room_types", {}) or {})
    try:
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
            "active_hotspot_id": init_active_hid,
            "is_demo": ws_is_demo,
            "demo_expires_at": int(demo_sess.expires_at) if (ws_is_demo and demo_sess) else None,
            "demo_session_minutes": demo_manager.get_config()["session_minutes"] if ws_is_demo else None,
            "demo_cooldown_seconds": demo_manager.get_config()["cooldown_seconds"] if ws_is_demo else None,
            "active_hotspot": (mask_hotspot_dict_for_demo(active_hs.to_dict()) if (ws_is_demo and active_hs) else (active_hs.to_dict() if active_hs else None)),
            "hotspots": [(mask_hotspot_dict_for_demo(rt.to_dict(), index=idx) if ws_is_demo else rt.to_dict()) for idx, rt in enumerate(visible_rts)],
            "bm_pings": bm_ping_service.cached_pings,
            "bm_host_pings": bm_ping_service.cached_host_pings,
            "bm_losses": bm_ping_service.cached_losses,
            "bm_host_losses": bm_ping_service.cached_host_losses,
            "bm_ping_history": bm_ping_service.get_history_dict(hours=24.0),
            "bm_benchmark_results": _localize_bm_bench_items(bm_ping_service.get_benchmark_results(), user_id=ws_user_id),
            "bm_benchmark_running": bm_ping_service.is_benchmark_running(),
            "server_probe_cache": _localize_server_probe_cache(server_probe_service._cache, user_id=ws_user_id),
            "server_probe_running": server_probe_service.is_probe_running(),
            "client_ping_history": client_ping_service.get_history_list(hours=6.0),
            "client_rtt": client_ping_service.current_rtt,
            "client_packet_loss": client_ping_service.get_packet_loss(),
            "calls": [mask_call_entry_for_demo(e.to_dict()) if ws_is_demo else e.to_dict() for e in hotspot_manager.get_calls_history(user_id=ws_user_id)],
            "active_call_ids": [
                str(c.id)
                for c in hotspot_manager._get_user_active_calls(ws_user_id).values()
                if getattr(c, "active", False) and getattr(c, "id", None)
            ],
            "recording_state": {
                "active": hotspot_manager.recorder.is_recording(ws_user_id) if (hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder) else False,
                "session_active": hotspot_manager.recorder.is_session_active(ws_user_id) if (hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder) else False,
                "rx_active": bool(
                    hasattr(hotspot_manager, "recorder")
                    and hotspot_manager.recorder
                    and any(getattr(b, "user_id", 1) == ws_user_id for b in hotspot_manager.recorder._rx_buffers.values())
                ),
                "tx_active": bool(
                    hasattr(hotspot_manager, "recorder")
                    and hotspot_manager.recorder
                    and hotspot_manager.recorder._tx_buffer
                    and getattr(hotspot_manager.recorder._tx_buffer, "user_id", 1) == ws_user_id
                ),
                "recording_hotspots": hotspot_manager.recorder.get_recording_hotspots(user_id=ws_user_id) if (hasattr(hotspot_manager, "recorder") and hotspot_manager.recorder) else [],
            },
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
                "qrz_com_username": ("Your CALL" if ws_is_demo else (getattr(user_settings, "qrz_com_username", "") or "")),
                "qrz_com_password": ("••••••••••••" if ws_is_demo else (getattr(user_settings, "qrz_com_password", "") or "")),
                "hamqth_username": ("Your CALL" if ws_is_demo else (getattr(user_settings, "hamqth_username", "") or "")),
                "hamqth_password": ("••••••••••••" if ws_is_demo else (getattr(user_settings, "hamqth_password", "") or "")),
                "loopback_mode": user_settings.loopback_mode,
                "quick_mem": all_ws_cols.get("quick_mem", {}),
                "asl_mem": all_ws_cols.get("asl_mem", {}),
            },
            "collections": {
                "ysf_matrix": all_ws_cols.get("ysf_matrix", {}),
                "asl_quick_nodes": all_ws_cols.get("asl_quick_nodes", {}),
                "asl_default_nodes": all_ws_cols.get("asl_default_nodes", {}),
                "ysf_scan_cfg": all_ws_cols.get("ysf_scan_cfg", {}),
                "ysf_dice_cfg": all_ws_cols.get("ysf_dice_cfg", {}),
                "adn_dice_cfg": all_ws_cols.get("adn_dice_cfg", {}),
                "asl_scan_cfg": all_ws_cols.get("asl_scan_cfg", {}),
                "asl_dice_cfg": all_ws_cols.get("asl_dice_cfg", {}),
                "ysf_dash_auto": all_ws_cols.get("ysf_dash_auto", {}),
                "asl_dash_auto": all_ws_cols.get("asl_dash_auto", {}),
                "pinned_servers": all_ws_cols.get("pinned_servers", {}),
                "srv_sort_prefs": all_ws_cols.get("srv_sort_prefs", {}),
                "quick_mem": all_ws_cols.get("quick_mem", {}),
                "asl_mem": all_ws_cols.get("asl_mem", {}),
                "contacts": all_ws_cols.get("contacts", {}),
                "ysf_room_types": all_ws_cols.get("ysf_room_types", {}),
                "ysf_favorites": (getattr(user_settings, "ysf_favorites", None) or []),
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
                "bm_detail": active_hs.detail if active_hs else _tr("common.disconnected", user_id=ws_user_id, fallback="Disconnected"),
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

        if ws_is_demo and demo_sess:
            async def _watch_demo_expiry():
                try:
                    rem = max(0.5, demo_sess.expires_at - time.time())
                    await asyncio.sleep(rem)
                    demo_manager.end_session(ws_demo_sid, apply_cooldown=True)
                    try:
                        await websocket.send_text(json.dumps({
                            "type": "demo_expired",
                            "cooldown_seconds": demo_manager.get_config().get("cooldown_seconds", 60),
                        }))
                        await websocket.close(code=4009, reason="Demo session expired")
                    except Exception:
                        pass
                except asyncio.CancelledError:
                    pass
            demo_timer_task = asyncio.create_task(_watch_demo_expiry())

        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            if ws_is_demo and "bytes" in message:
                continue
            if ws_is_demo and "text" in message:
                try:
                    d_check = json.loads(message["text"])
                    m_type = d_check.get("type")
                except Exception:
                    continue
                if m_type in ("ping", "client_ping"):
                    pass  # let handle below
                elif m_type in ("set_transcribe_slot", "set_tts_slot"):
                    pass  # allow demo client to turn ON slot transcription and TTS speech synthesis
                elif m_type in ("hotspot_collapse", "bm_connect", "bm_disconnect", "bm_reconnect", "set_active_hotspot"):
                    hs_id_req = d_check.get("hotspot_id") or d_check.get("id")
                    if hs_id_req:
                        rt_target = hotspot_manager.get_runtime(ws_user_id, hs_id_req)
                        if _is_asl_hotspot_obj(rt_target):
                            continue
                    pass  # allow demo client to expand/collapse/connect hotspots in-memory
                else:
                    if m_type == "ptt_press":
                        try:
                            await websocket.send_text(json.dumps({
                                "type": "error",
                                "message": _tr("ptt.demo_rx_only", user_id=ws_user_id, fallback="🎧 Demo mode: transmit disabled (receive only)"),
                                "code": "DEMO_DENIED"
                            }))
                        except Exception:
                            pass
                    continue
            if "text" in message:
                try:
                    data = json.loads(message["text"])
                except Exception:
                    continue

                msg_type = data.get("type")

                if msg_type == "parrot_test_start":
                    active_parrot_sessions[client_id] = {
                        "recording": True,
                        "buffer": bytearray(),
                        "network": data.get("network", "dmr"),
                        "hotspot_id": data.get("hotspot_id"),
                        "user_id": ws_user_id,
                        "task": None
                    }
                    await websocket.send_text(json.dumps({
                        "type": "parrot_test_ready",
                        "network": data.get("network", "dmr")
                    }))
                    continue
                elif msg_type == "parrot_test_stop":
                    sess = active_parrot_sessions.get(client_id)
                    if sess and not sess.get("task"):
                        sess["recording"] = False
                        pcm_bytes = bytes(sess["buffer"])
                        net = sess.get("network", "dmr")
                        uid = sess.get("user_id", ws_user_id)
                        hid = sess.get("hotspot_id")
                        sess["task"] = asyncio.create_task(_run_parrot_playback(websocket, client_id, pcm_bytes, net, uid, hid, ws_login))
                    continue
                elif msg_type == "parrot_test_cancel":
                    sess = active_parrot_sessions.pop(client_id, None)
                    if sess and sess.get("task") and not sess["task"].done():
                        sess["task"].cancel()
                    continue

                if msg_type == "ptt_press":
                    if await is_user_swl(ws_user_id):
                        logger.warning(f"[PTT] Denied for SWL user {ws_login} (id={ws_user_id})")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": _tr("ptt.denied_swl", user_id=ws_user_id, fallback="Transmit denied: SWL mode enabled (receive only)"),
                            "code": "SWL_DENIED"
                        }))
                        continue
                    hid = data.get("hotspot_id")
                    if hid:
                        hotspot_manager.set_active_hotspot(hid, user_id=ws_user_id)

                    active_hs = hotspot_manager.get_active_runtime(ws_user_id)
                    if not active_hs:
                        logger.warning(f"[PTT] Denied for user {ws_login}: active hotspot not found")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": _tr("ptt.denied_no_hotspot", user_id=ws_user_id, fallback="Transmit blocked: hotspot not found"),
                            "code": "HOTSPOT_NOT_FOUND"
                        }))
                        continue

                    if getattr(active_hs, "status", None) != BMState.ONLINE:
                        hs_id = active_hs.config.id if active_hs.config else "default"
                        st_val = getattr(active_hs.status, "value", str(getattr(active_hs, "status", "UNKNOWN")))
                        logger.warning(f"[PTT] Denied for user {ws_login}: Hotspot {hs_id} is not connected to BM (status={st_val})")
                        await websocket.send_text(json.dumps({
                            "type": "error",
                            "message": _tr("ptt.denied_bm_offline", user_id=ws_user_id, fallback="Transmit blocked: not connected to BrandMeister (BM:OFFLINE)"),
                            "code": "BM_OFFLINE"
                        }))
                        continue

                    slot = int(data.get("slot", u_radio_state.tx_slot))
                    tg = int(data.get("tg", u_radio_state.active_tg))

                    # If active hotspot is AllStarLink or YSF, enforce slot=1 and active node/room dst_id
                    if active_hs and (getattr(active_hs.config, "network_type", "bm") or "").lower() == "allstar":
                        slot = 1
                        conn_node = getattr(active_hs, "connected_node", None)
                        if not conn_node and getattr(active_hs, "asl_links", None):
                            conn_node = active_hs.asl_links[0]
                        if not conn_node:
                            conn_node = getattr(active_hs.config, "allstar_node", 1999)
                        try:
                            tg = int(conn_node)
                        except (ValueError, TypeError):
                            tg = 1999
                    elif active_hs and (getattr(active_hs.config, "network_type", "bm") or "").lower() == "ysf":
                        slot = 1
                        ysf_rid = str(getattr(active_hs.config, "ysf_room_id", "") or getattr(active_hs.config, "ysf_room", "") or "25000").strip()
                        tg = int(ysf_rid) if ysf_rid.isdigit() else 25000
                        req_tx_dg = data.get("ysf_tx_dg_id", None)
                        if req_tx_dg is not None and str(req_tx_dg).strip().isdigit():
                            v_dg = int(req_tx_dg)
                            if 1 <= v_dg <= 99:
                                active_hs.config.ysf_tx_dg_id = v_dg
                                c_obj = getattr(active_hs.client, "client", active_hs.client) if active_hs.client else None
                                if c_obj:
                                    c_obj.tx_dg_id = v_dg

                    u_radio_state.is_transmitting = True
                    u_radio_state.transmitting_client_id = client_id
                    u_radio_state.tx_start_time = time.time()
                    u_radio_state.tx_slot = slot
                    u_radio_state.active_tg = tg

                    callsign = active_hs.config.callsign if active_hs else "N0CALL"
                    dmr_id = active_hs.config.dmr_id if active_hs else 0

                    # Determine call type (default to PRIVATE for 9990 Parrot or if explicitly requested)
                    req_call_type = str(data.get("call_type", "")).upper()
                    if req_call_type in ("PRIVATE", "GROUP"):
                        call_type = req_call_type
                    else:
                        call_type = "PRIVATE" if (tg == 9990 or tg > 999999) else "GROUP"

                    logger.info(f"[PTT] Pressed by {client_id} (user {ws_login}) on Hotspot {active_hs.config.id if active_hs else ''}, Slot {slot}, TG {tg}")

                    # Start DMR TX pipeline (Voice Header to BM if online, and log TX entry)
                    hotspot_manager.start_tx(
                        hotspot_id=active_hs.config.id if active_hs else None,
                        slot=slot,
                        dst_id=tg,
                        call_type=call_type,
                        user_id=ws_user_id,
                    )

                    await broadcast_user_json(ws_user_id, {
                        "type": "state_change",
                        "is_tx": True,
                        "client_id": client_id,
                        "hotspot_id": active_hs.config.id if active_hs else "",
                        "slot": slot,
                        "active_tg": tg,
                        "callsign": callsign,
                        "dmr_id": dmr_id
                    })

                elif msg_type == "ptt_release":
                    if u_radio_state.transmitting_client_id == client_id:
                        roger_beep = bool(data.get("roger_beep", False))
                        roger_beep_pattern = str(data.get("roger_beep_pattern", "")).strip()
                        await hotspot_manager.stop_tx(
                            user_id=ws_user_id,
                            roger_beep=roger_beep,
                            roger_beep_pattern=roger_beep_pattern,
                        )
                        u_radio_state.is_transmitting = False
                        u_radio_state.transmitting_client_id = None
                        duration = time.time() - u_radio_state.tx_start_time
                        active_hs = hotspot_manager.get_active_runtime(ws_user_id)
                        logger.info(f"[PTT] Released by {client_id} (user {ws_login}), duration: {duration:.2f}s")

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
                    norm_lang = normalize_lang(data.get("language")) or "en"
                    set_request_lang(norm_lang)
                    if not ws_is_demo:
                        set_user_lang(ws_user_id, norm_lang, update_runtime_default=(ws_user_id == 1))
                        user_settings.language = norm_lang
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        logger.info(f"[SETTINGS] Language set to {norm_lang}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "language_change",
                            "language": norm_lang
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

                elif msg_type == "set_single_hotspot_audio":
                    enabled = bool(data.get("enabled", False))
                    user_settings.single_hotspot_audio = enabled
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    logger.info(f"[SETTINGS] Single hotspot audio set to {enabled}")
                    await broadcast_user_json(ws_user_id, {
                        "type": "single_hotspot_audio_change",
                        "enabled": enabled
                    }, exclude=websocket)

                elif msg_type == "set_quick_mem":
                    key = str(data.get("key", ""))
                    val = data.get("data")
                    if key:
                        if val is None:
                            user_settings.quick_mem.pop(key, None)
                            await delete_collection_key(ws_user_id, "quick_mem", key)
                        else:
                            user_settings.quick_mem[key] = val
                            await set_collection_key(ws_user_id, "quick_mem", key, val)
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                        all_qm = await get_collection(ws_user_id, "quick_mem")
                        logger.info(f"[SETTINGS] Quick mem updated: {key} for user={ws_user_id}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "quick_mem_change",
                            "key": key,
                            "data": val,
                            "all_quick_mem": all_qm
                        }, exclude=websocket)

                elif msg_type == "set_asl_mem":
                    key = str(data.get("key", ""))
                    val = data.get("data")
                    if key:
                        if val is None:
                            await delete_collection_key(ws_user_id, "asl_mem", key)
                        else:
                            await set_collection_key(ws_user_id, "asl_mem", key, str(val))
                        all_asl = await get_collection(ws_user_id, "asl_mem")
                        logger.info(f"[SETTINGS] ASL mem updated: {key} for user={ws_user_id}")
                        await broadcast_user_json(ws_user_id, {
                            "type": "asl_mem_change",
                            "key": key,
                            "data": val,
                            "all_asl_mem": all_asl
                        }, exclude=websocket)


                elif msg_type == "set_vocoder_settings":
                    enh = bool(data.get("spectral_enh", True))
                    high_band_gain_db = max(0.0, min(6.0, float(data.get("high_band_gain_db", 0.5))))
                    unvoiced_gain_db = max(-4.0, min(4.0, float(data.get("unvoiced_gain_db", -1.5))))
                    user_rts = hotspot_manager.get_user_runtimes(ws_user_id)
                    for rt in user_rts.values():
                        if hasattr(rt, "vocoder") and hasattr(rt.vocoder, "set_settings"):
                            rt.vocoder.set_settings(
                                spectral_enh=enh,
                                high_band_gain_db=high_band_gain_db,
                                unvoiced_gain_db=unvoiced_gain_db
                            )
                    if not ws_is_demo:
                        if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                            user_settings.client_settings = {}
                        ambe_upd = {
                            "spectral_enh": enh,
                            "high_band_gain_db": high_band_gain_db,
                            "unvoiced_gain_db": unvoiced_gain_db,
                        }
                        if data.get("active_preset") is not None:
                            ambe_upd["active_preset"] = str(data.get("active_preset"))
                        if isinstance(data.get("presets"), dict):
                            ambe_upd["presets"] = data.get("presets")
                        user_settings.client_settings.setdefault("ambe_rx", {}).update(ambe_upd)
                        await save_user_settings(ws_user_id, user_settings.model_dump())
                        if ws_user_id == 1:
                            save_app_settings(user_settings)
                    logger.info(
                        f"[VOCODER] Applied & saved AMBE+2 settings (user {ws_login}): enh={enh}, "
                        f"high_band={high_band_gain_db} dB, unvoiced={unvoiced_gain_db} dB"
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

                elif msg_type == "set_backend_buffer":
                    buf_ms = hotspot_manager.set_backend_buffer_ms(data.get("buffer_ms", 0), user_id=ws_user_id)
                    if not hasattr(user_settings, "client_settings") or user_settings.client_settings is None:
                        user_settings.client_settings = {}
                    arx = user_settings.client_settings.setdefault("audio_rx", {})
                    arx["backend_buffer_ms"] = buf_ms
                    await save_user_settings(ws_user_id, user_settings.model_dump())
                    if ws_user_id == 1:
                        save_app_settings(user_settings)
                    await broadcast_user_json(ws_user_id, {
                        "type": "backend_buffer_settings",
                        "buffer_ms": buf_ms
                    })

                elif msg_type == "save_client_settings":
                    cs = data.get("client_settings")
                    if isinstance(cs, dict) and not ws_is_demo:
                        await _apply_and_save_client_settings(ws_user_id, user_settings, cs)

                elif msg_type == "set_active_hotspot":
                    hid = data.get("id")
                    if hid and not ws_is_demo:
                        if hotspot_manager.set_active_hotspot(hid, user_id=ws_user_id):
                            await save_user_settings(ws_user_id, user_settings.model_dump())

                elif msg_type == "bm_connect":
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        if target_hs.client and getattr(target_hs.client, "_is_manual_disconnect", False):
                            continue
                        if ws_is_demo:
                            await _prepare_demo_hotspot_ssid(ws_user_id, target_hs)
                            ws_active_hotspots.setdefault(websocket, set()).add(target_hs.config.id)
                        await hotspot_manager.connect_hotspot(target_hs.config.id, user_id=ws_user_id, persist=not ws_is_demo, force=False)

                elif msg_type == "bm_disconnect":
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        real_hid = target_hs.config.id
                        if ws_is_demo:
                            ws_active_hotspots.setdefault(websocket, set()).discard(real_hid)
                            if _is_hotspot_open_on_any_client(ws_user_id, real_hid, exclude_ws=websocket):
                                continue
                        await hotspot_manager.disconnect_hotspot(real_hid, user_id=ws_user_id)

                elif msg_type == "hotspot_collapse":
                    hid = data.get("hotspot_id")
                    collapsed = bool(data.get("collapsed", False))
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        real_hid = target_hs.config.id
                        hset = ws_active_hotspots.setdefault(websocket, set())
                        if collapsed:
                            hset.discard(real_hid)
                            if ws_is_demo:
                                s_admin = hotspot_manager.user_settings.get(ws_user_id, hotspot_manager.settings)
                                admin_hs_cfg = next((h for h in getattr(s_admin, "hotspots", []) if h.id == real_hid), target_hs.config)
                                demo_manager.record_admin_collapsed_state(real_hid, bool(getattr(admin_hs_cfg, "collapsed", False)))
                            if not _is_hotspot_open_on_any_client(ws_user_id, real_hid, exclude_ws=websocket):
                                await hotspot_manager.set_hotspot_collapsed(real_hid, True, user_id=ws_user_id, persist=not ws_is_demo)
                                if not ws_is_demo:
                                    await save_user_settings(ws_user_id, user_settings.model_dump())
                        else:
                            if ws_is_demo:
                                await _prepare_demo_hotspot_ssid(ws_user_id, target_hs)
                            hset.add(real_hid)
                            await hotspot_manager.set_hotspot_collapsed(real_hid, False, user_id=ws_user_id, persist=not ws_is_demo)
                            if not ws_is_demo:
                                await save_user_settings(ws_user_id, user_settings.model_dump())
                            try:
                                await websocket.send_text(json.dumps({
                                    "type": "bm_status",
                                    "hotspot_id": real_hid,
                                    "status": target_hs.status.value,
                                    "detail": target_hs.detail
                                }))
                            except Exception:
                                pass


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

                elif msg_type == "start_server_probe":
                    net = (data.get("network_type") or "freedmr").strip().lower()
                    if net == "bm":
                        masters_data = await get_bm_masters()
                        servers = masters_data.get("masters", [])
                    elif net == "freedmr":
                        await freedmr_hosts_mgr.fetch_hosts(force=False)
                        servers = freedmr_hosts_mgr.get_hosts(enriched=False).get("servers", [])
                    elif net == "tgif":
                        servers = list(KNOWN_TGIF_SERVERS)
                    elif net == "dmrplus":
                        if dmrplus_hosts_mgr._source == "fallback" or dmrplus_hosts_mgr._last_loaded_ts <= 0:
                            await dmrplus_hosts_mgr.fetch_hosts(force=True)
                        else:
                            dmrplus_hosts_mgr.ensure_fresh_background()
                        servers = dmrplus_hosts_mgr.get_hosts(enriched=False) or list(KNOWN_DMRPLUS_SERVERS)
                    elif net == "xlx":
                        await xlx_hosts_mgr.fetch_hosts(force=False)
                        servers = xlx_hosts_mgr.get_hosts(enriched=False).get("servers", [])
                    elif net == "adn":
                        tg_resolver.ensure_adn_fresh_background()
                        if adn_hosts_mgr._source != "live" or adn_hosts_mgr._last_loaded_ts <= 0:
                            await adn_hosts_mgr.fetch_hosts(force=True)
                        else:
                            adn_hosts_mgr.ensure_fresh_background()
                        servers = adn_hosts_mgr.get_hosts(enriched=False).get("servers", [])
                    elif net == "ysf":
                        await ysf_dir_mgr.fetch_hosts(force=False)
                        servers = ysf_dir_mgr.get_hosts(enriched=False).get("servers", [])
                    else:
                        servers = []
                    probe_id = 123456799
                    u_sett = hotspot_manager.user_settings.get(ws_user_id, hotspot_manager.settings)
                    if u_sett and hasattr(u_sett, "hotspots") and u_sett.hotspots:
                        bid = u_sett.hotspots[0].dmr_id
                        if bid and bid > 0:
                            probe_id = bid * 100 + 99
                    await server_probe_service.start_probe(
                        network_type=net,
                        servers=servers,
                        probe_id=probe_id,
                        broadcast_cb=broadcast_json
                    )

                elif msg_type == "cancel_server_probe":
                    net = data.get("network_type")
                    server_probe_service.cancel_probe(net)

                elif msg_type == "bm_reconnect":
                    hid = data.get("hotspot_id")
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        if ws_is_demo:
                            await _prepare_demo_hotspot_ssid(ws_user_id, target_hs)
                        await hotspot_manager.reconnect_hotspot(target_hs.config.id, user_id=ws_user_id, persist=not ws_is_demo)

                elif msg_type == "allstar_connect_node":
                    hid = str(data.get("hotspot_id", "")).strip()
                    node = str(data.get("node", "")).strip()
                    mode = str(data.get("mode", "*2")).strip() or "*2"
                    show_status_banner = data.get("show_status_banner", True)
                    show_card_effects = data.get("show_card_effects", True)
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs and node:
                        logger.info(f"[ALLSTAR] Connect node #{node} (mode {mode}) on hotspot {target_hs.config.id} by {ws_login}")
                        asyncio.create_task(_execute_asl_connect_flow(
                            uid=ws_user_id,
                            target_hs=target_hs,
                            node=node,
                            mode=mode,
                            show_status_banner=show_status_banner,
                            show_card_effects=show_card_effects
                        ))

                elif msg_type == "allstar_disconnect_node":
                    hid = str(data.get("hotspot_id", "")).strip()
                    node = str(data.get("node", "")).strip()
                    show_status_banner = data.get("show_status_banner", True)
                    show_card_effects = data.get("show_card_effects", True)
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs and node:
                        logger.info(f"[ALLSTAR] Disconnect node #{node} on hotspot {target_hs.config.id} by {ws_login}")
                        asyncio.create_task(_execute_asl_disconnect_flow(
                            uid=ws_user_id,
                            target_hs=target_hs,
                            disc_target=node,
                            show_status_banner=show_status_banner,
                            show_card_effects=show_card_effects
                        ))

                elif msg_type == "ysf_connect_room":
                    hid = str(data.get("hotspot_id", "")).strip()
                    room_id = str(data.get("room_id", "")).strip()
                    room_name = str(data.get("room_name", "")).strip()
                    host = str(data.get("host", "")).strip()
                    try:
                        port = int(data.get("port") or 0)
                    except (ValueError, TypeError):
                        port = 0
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs and room_id:
                        logger.info(f"[YSF] Connect room #{room_id} ({room_name}) on hotspot {target_hs.config.id} by {ws_login}")
                        asyncio.create_task(_execute_ysf_connect_flow(
                            uid=ws_user_id,
                            target_hs=target_hs,
                            room_id=room_id,
                            room_name=room_name,
                            host=host,
                            port=port
                        ))
                    else:
                        await websocket.send_json({
                            "type": "ysf_proc_step",
                            "hotspot_id": hid or (target_hs.config.id if target_hs else ""),
                            "proc": "connect",
                            "state": "failed",
                            "code": "no_hotspot",
                            "room_id": room_id,
                            "tone": "negative",
                            "text": _tr("ysf.err_no_active_hotspot", fallback="✕ Error # {room_id}: active YSF hotspot not found", room_id=room_id),
                            "auto_hide_ms": 4000
                        })

                elif msg_type == "allstar_dtmf":
                    hid = str(data.get("hotspot_id", "")).strip()
                    digit = str(data.get("digit", "")).strip()
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs and digit:
                        if digit in ("*73", "*76"):
                            logger.info(f"[ALLSTAR] DTMF '{digit}' (disconnect all) on hotspot {target_hs.config.id} by {ws_login}")
                            asyncio.create_task(_execute_asl_disconnect_flow(
                                uid=ws_user_id,
                                target_hs=target_hs,
                                disc_target="all",
                                show_status_banner=True,
                                show_card_effects=True
                            ))
                        else:
                            asl = getattr(target_hs, "allstar_client", None)
                            if asl and asl.is_connected:
                                asl.send_dtmf(digit)
                                logger.info(f"[ALLSTAR] DTMF '{digit}' sent on hotspot {target_hs.config.id} by {ws_login}")

                elif msg_type == "allstar_dtmf_macro":
                    hid = str(data.get("hotspot_id", "")).strip()
                    digits = str(data.get("digits", "")).strip()
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs and digits:
                        own_node = str(getattr(target_hs.config, "allstar_node", "1999") or "1999").strip()
                        from asl_container_manager import asl_container_mgr
                        links = await asyncio.to_thread(asl_container_mgr.get_connected_links, str(ws_user_id), own_node)
                        has_tx_node = any(lk.get("mode") in ("*3", "tx", "transceive") for lk in (links or []))
                        if not has_tx_node and getattr(target_hs, "connected_node", None) == "1999":
                            has_tx_node = True

                        if not has_tx_node:
                            await ws.send_text(json.dumps({
                                "type": "allstar_proc_step",
                                "hotspot_id": target_hs.config.id,
                                "tone": "negative",
                                "text": _tr("asl.dtmf_requires_tx", fallback="✕ DTMF transmit unavailable: switch node to TX-RX mode (*3)"),
                                "auto_hide_ms": 4000
                            }))
                        else:
                            asl_adapter = getattr(target_hs, "client", None) or getattr(target_hs, "allstar_client", None)
                            if asl_adapter:
                                async def _notify_macro_state(event_type: str, d: str):
                                    try:
                                        if event_type == "tx_start":
                                            await ws.send_text(json.dumps({
                                                "type": "allstar_proc_step",
                                                "hotspot_id": target_hs.config.id,
                                                "tone": "neutral",
                                                "text": _tr("asl.auto_tx_dtmf", fallback="📡 Auto-TX: transmitting DTMF {digits}...", digits=d),
                                                "auto_hide_ms": 0
                                            }))
                                            await ws.send_text(json.dumps({
                                                "type": "allstar_macro_tx_state",
                                                "hotspot_id": target_hs.config.id,
                                                "active": True
                                            }))
                                        elif event_type == "tx_stop":
                                            await ws.send_text(json.dumps({
                                                "type": "allstar_proc_step",
                                                "hotspot_id": target_hs.config.id,
                                                "tone": "positive",
                                                "text": _tr("asl.dtmf_sent", fallback="✓ DTMF sent: {digits}", digits=d),
                                                "auto_hide_ms": 4000
                                            }))
                                            await ws.send_text(json.dumps({
                                                "type": "allstar_macro_tx_state",
                                                "hotspot_id": target_hs.config.id,
                                                "active": False
                                            }))
                                        elif event_type == "tx_inject":
                                            await ws.send_text(json.dumps({
                                                "type": "allstar_proc_step",
                                                "hotspot_id": target_hs.config.id,
                                                "tone": "neutral",
                                                "text": _tr("asl.tx_dtmf", fallback="📡 Transmitting DTMF {digits}...", digits=d),
                                                "auto_hide_ms": 0
                                            }))
                                        elif event_type == "tx_inject_done":
                                            await ws.send_text(json.dumps({
                                                "type": "allstar_proc_step",
                                                "hotspot_id": target_hs.config.id,
                                                "tone": "positive",
                                                "text": _tr("asl.dtmf_sent", fallback="✓ DTMF sent: {digits}", digits=d),
                                                "auto_hide_ms": 4000
                                            }))
                                    except Exception as err:
                                        logger.debug(f"[ALLSTAR] Macro notify error: {err}")

                                if hasattr(asl_adapter, "execute_dtmf_macro"):
                                    asyncio.create_task(asl_adapter.execute_dtmf_macro(digits, notify_cb=_notify_macro_state))
                                elif hasattr(asl_adapter, "client") and hasattr(asl_adapter.client, "execute_dtmf_macro"):
                                    asyncio.create_task(asl_adapter.client.execute_dtmf_macro(digits, notify_cb=_notify_macro_state))

                elif msg_type == "allstar_ctcss_filter":
                    hid = str(data.get("hotspot_id", "")).strip()
                    enabled = bool(data.get("enabled", True))
                    target_hs = (hotspot_manager.get_runtime(ws_user_id, hid) if hid else None) or hotspot_manager.get_active_runtime(ws_user_id)
                    if target_hs:
                        adapter = getattr(target_hs, "client", None)
                        if adapter and hasattr(adapter, "ctcss_filter_enabled"):
                            adapter.ctcss_filter_enabled = enabled
                        asl = getattr(target_hs, "allstar_client", None)
                        if asl and hasattr(asl, "ctcss_filter_enabled"):
                            asl.ctcss_filter_enabled = enabled
                        logger.info(f"[ALLSTAR] CTCSS filter set to {enabled} on hotspot {target_hs.config.id} by {ws_login}")

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
                parrot_sess = active_parrot_sessions.get(client_id)
                if parrot_sess and (parrot_sess.get("recording") or not parrot_sess.get("task")):
                    if parrot_sess.get("recording"):
                        remaining = 480000 - len(parrot_sess["buffer"])  # 30 sec limit at 8 kHz 16-bit PCM
                        if remaining > 0:
                            parrot_sess["buffer"].extend(audio_bytes[:remaining])
                        if len(parrot_sess["buffer"]) >= 480000:
                            parrot_sess["recording"] = False
                elif u_radio_state.is_transmitting and (u_radio_state.transmitting_client_id == client_id or not u_radio_state.transmitting_client_id):
                    hotspot_manager.process_tx_audio(audio_bytes, user_id=ws_user_id)
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
        sess = active_parrot_sessions.pop(client_id, None)
        if sess and sess.get("task") and not sess["task"].done():
            sess["task"].cancel()
        if demo_timer_task and not demo_timer_task.done():
            demo_timer_task.cancel()
        was_demo = (websocket in demo_ws_clients)
        demo_sid_disc = demo_ws_clients.pop(websocket, None)
        if was_demo and demo_sid_disc:
            async def _delayed_demo_release(sid_to_check: str):
                await asyncio.sleep(15.0)
                if sid_to_check not in demo_ws_clients.values():
                    demo_manager.end_session(sid_to_check, apply_cooldown=False)
                await _revert_demo_runtime_state()
            asyncio.create_task(_delayed_demo_release(demo_sid_disc))
        # Cancel and cleanup dedicated audio streaming queue
        q_disc = ws_audio_queues.pop(websocket, None)
        t_disc = ws_audio_tasks.pop(websocket, None)
        if q_disc:
            try: q_disc.put_nowait(None)
            except Exception: pass
        if t_disc and not t_disc.done():
            t_disc.cancel()

        disc_cid = ws_client_instance_map.pop(websocket, None)
        connected_clients.discard(websocket)
        if not connected_clients and transcriber_service and hasattr(transcriber_service, "disable_all_slots"):
            transcriber_service.disable_all_slots()
        removed_hids = ws_active_hotspots.pop(websocket, set())
        disc_uid = ws_user_map.pop(websocket, None)
        if disc_uid and disc_uid in user_clients:
            user_clients[disc_uid].discard(websocket)
            if not user_clients[disc_uid]:
                user_clients.pop(disc_uid, None)
                if disc_cid and active_user_client_cid.get(disc_uid) == disc_cid:
                    active_user_client_cid.pop(disc_uid, None)
            elif not was_demo:
                for r_hid in list(removed_hids):
                    if not _is_hotspot_open_on_any_client(disc_uid, r_hid):
                        await hotspot_manager.set_hotspot_collapsed(r_hid, True, user_id=disc_uid)
        if not was_demo and u_radio_state.transmitting_client_id == client_id:
            await hotspot_manager.stop_tx(user_id=ws_user_id)
            u_radio_state.is_transmitting = False
            u_radio_state.transmitting_client_id = None
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
        host_ip = os.environ.get("HOST_IP", "")
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
