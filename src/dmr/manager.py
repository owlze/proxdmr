import asyncio
import json
import logging
import random
import time
from dataclasses import dataclass, field
from typing import Callable, Coroutine, Dict, List, Optional, Any, Set

import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

try:
    from config import AppSettings, HotspotConfig, load_app_settings, save_app_settings, CONFIG_DIR
    from dmr.homebrew import BMState, DMRFrame, HomeBrewClient
    from dmr.resolver import DMRResolver, format_caller_display
    from dmr.talker_alias import TalkerAliasDecoder
    from dmr.vocoder import DMRVocoderDecoder
    from dmr.vocoder_encoder import DMRVocoderEncoder
    from dmr.tx_framer import DMRTxFramer
    from dmr.audio_agc import ServerAudioAgc
    from dmr.audio_equalizer import ServerAudioEqualizer
    from dmr.tx_dsp import ServerTxDsp
    from dmr.recorder import ServerAudioRecorder, BeepMarkerGenerator
except ImportError:
    from src.config import AppSettings, HotspotConfig, load_app_settings, save_app_settings, CONFIG_DIR
    from src.dmr.homebrew import BMState, DMRFrame, HomeBrewClient
    from src.dmr.resolver import DMRResolver, format_caller_display
    from src.dmr.talker_alias import TalkerAliasDecoder
    from src.dmr.vocoder import DMRVocoderDecoder
    from src.dmr.vocoder_encoder import DMRVocoderEncoder
    from src.dmr.tx_framer import DMRTxFramer
    from src.dmr.audio_agc import ServerAudioAgc
    from src.dmr.audio_equalizer import ServerAudioEqualizer
    from src.dmr.tx_dsp import ServerTxDsp
    from src.dmr.recorder import ServerAudioRecorder, BeepMarkerGenerator

CALLS_HISTORY_FILE = CONFIG_DIR / "calls_history.json"
CALL_HISTORY_RETENTION_SEC = 86400.0  # 24 hours
CALL_HISTORY_MAX_ENTRIES = 10000     # Safety maximum

logger = logging.getLogger("proxdmr.manager")

@dataclass
class SlotState:
    active: bool = False
    src_id: int = 0
    src_callsign: str = ""
    src_name: str = ""
    talker_alias: str = ""
    dst_id: int = 0
    call_type: str = "GROUP"
    last_seen: float = 0.0
    stream_id: int = 0
    ber: int = 0
    rssi: int = 0

    def format_caller(self) -> str:
        return format_caller_display(
            self.src_id,
            self.src_callsign,
            self.src_name,
            self.talker_alias
        )

    def to_dict(self) -> dict:
        return {
            "active": self.active,
            "src_id": self.src_id,
            "src_callsign": self.src_callsign or (f"ID:{self.src_id}" if self.src_id else "---"),
            "src_name": self.src_name,
            "talker_alias": self.talker_alias,
            "caller_display": self.format_caller(),
            "dst_id": self.dst_id,
            "call_type": self.call_type,
            "last_seen": self.last_seen,
            "ber": self.ber,
            "rssi": self.rssi,
        }

@dataclass
class HotspotRuntime:
    config: HotspotConfig
    user_id: int = 1
    client: Optional[HomeBrewClient] = None
    status: BMState = BMState.DISCONNECTED
    detail: str = "Отключен"
    ts1: SlotState = field(default_factory=SlotState)
    ts2: SlotState = field(default_factory=SlotState)
    vocoder: DMRVocoderDecoder = field(default_factory=DMRVocoderDecoder)
    tx_encoder: DMRVocoderEncoder = field(default_factory=DMRVocoderEncoder)
    agc: ServerAudioAgc = field(default_factory=ServerAudioAgc)
    equalizer: ServerAudioEqualizer = field(default_factory=ServerAudioEqualizer)
    tx_dsp: ServerTxDsp = field(default_factory=ServerTxDsp)
    _active_rx_slot: Optional[int] = None
    _last_rx_burst_time: float = 0.0
    dynamic_tgs: Dict[int, Dict[int, float]] = field(default_factory=lambda: {1: {}, 2: {}})
    dropped_dynamic_ts: Dict[int, float] = field(default_factory=lambda: {1: 0.0, 2: 0.0})
    _recent_burst_keys: Dict[tuple, float] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "id": self.config.id,
            "user_id": self.user_id,
            "name": self.config.name,
            "callsign": self.config.callsign,
            "dmr_id": self.config.dmr_id,
            "bm_ssid": self.config.bm_ssid,
            "effective_id": int(f"{self.config.dmr_id}{self.config.bm_ssid:02d}") if self.config.bm_ssid > 0 else self.config.dmr_id,
            "bm_master_host": self.config.bm_master_host,
            "bm_master_port": self.config.bm_master_port,
            "bm_password": self.config.bm_password,
            "duplex": self.config.duplex,
            "default_tg_ts1": self.config.default_tg_ts1,
            "default_tg_ts2": self.config.default_tg_ts2,
            "autoconnect": self.config.autoconnect,
            "bm_api_key": self.config.bm_api_key,
            "talker_alias": self.config.talker_alias,
            "send_talker_alias": getattr(self.config, "send_talker_alias", True),
            "status": self.status.value,
            "detail": self.detail,
            "collapsed": getattr(self.config, "collapsed", False),
            "auto_tg_bm": getattr(self.config, "auto_tg_bm", True),
            "auto_record": getattr(self.config, "auto_record", False),
            "ts1": self.ts1.to_dict(),
            "ts2": self.ts2.to_dict(),
        }

@dataclass
class UserTxState:
    active: bool = False
    hotspot_id: Optional[str] = None
    slot: int = 2
    dst_id: int = 9990
    call_type: str = "GROUP"
    stream_id: int = 0
    seq_no: int = 0
    burst_index: int = 0
    superframe_index: int = 0
    audio_buffer: bytearray = field(default_factory=bytearray)
    start_time: float = 0.0
    call_id: Optional[str] = None

@dataclass
class CallLogEntry:
    id: str
    timestamp: float
    hotspot_id: str
    slot: int
    src_id: int
    dst_id: int
    call_type: str
    src_callsign: str = ""
    src_name: str = ""
    talker_alias: str = ""
    duration: float = 0.0
    active: bool = True
    is_tx: bool = False
    transcription: str = ""
    transcription_lang: str = ""
    user_id: int = 1

    def format_caller(self) -> str:
        return format_caller_display(
            self.src_id,
            self.src_callsign,
            self.src_name,
            self.talker_alias
        )

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "time_str": time.strftime("%H:%M:%S", time.localtime(self.timestamp)),
            "hotspot_id": self.hotspot_id,
            "slot": self.slot,
            "src_id": self.src_id,
            "src_callsign": self.src_callsign,
            "src_name": self.src_name,
            "talker_alias": self.talker_alias,
            "caller_display": self.format_caller(),
            "dst_id": self.dst_id,
            "call_type": self.call_type,
            "duration": round(self.duration, 1),
            "active": self.active,
            "is_tx": self.is_tx,
            "transcription": self.transcription,
            "transcription_lang": self.transcription_lang,
            "user_id": self.user_id,
        }

class HotspotManager:
    def __init__(
        self,
        app_settings: AppSettings,
        broadcast_fn: Optional[Callable[[dict], Coroutine]] = None,
        audio_broadcast_fn: Optional[Callable[[bytes], Coroutine]] = None,
        transcriber: Optional[Any] = None
    ):
        self.settings = app_settings
        self.broadcast_fn = broadcast_fn
        self.audio_broadcast_fn = audio_broadcast_fn
        self.transcriber = transcriber
        self.vocoder = DMRVocoderDecoder()
        self.resolver = DMRResolver()
        self.ta_decoder = TalkerAliasDecoder()
        self.active_user_id: int = 1

        self.user_runtimes: Dict[int, Dict[str, HotspotRuntime]] = {}
        self.user_settings: Dict[int, AppSettings] = {}
        self.user_active_calls: Dict[int, Dict[str, CallLogEntry]] = {}
        self.user_call_history: Dict[int, List[CallLogEntry]] = {}
        self.user_tx_states: Dict[int, UserTxState] = {}
        self.timeout_watcher_task: Optional[asyncio.Task] = None
        self._last_prune_time: float = 0.0
        self._bg_tasks: Set[asyncio.Task] = set()
        self._history_dirty: Set[int] = set()

        # DMR TX Framing & Pipeline
        self.tx_framer = DMRTxFramer()

        # Audio Recorder & Master Session Engine
        self.recorder = ServerAudioRecorder(broadcast_fn=self.broadcast_fn)
        cs = getattr(self.settings, "client_settings", {}) or {}
        if cs:
            self.recorder.apply_settings(cs)
        rec_s = getattr(self.settings, "recordings_settings", {}) or {}
        if rec_s:
            self.recorder.apply_settings(rec_s)

        # Initialize user 1 runtimes
        self.user_settings[1] = self.settings
        self.user_runtimes[1] = {}
        self.user_active_calls[1] = {}
        self._load_calls_history(1)
        for hs_cfg in self.settings.hotspots:
            self._init_runtime(hs_cfg, user_id=1)

    def _get_user_tx(self, user_id: Optional[int] = None) -> UserTxState:
        uid = user_id if user_id is not None else self.active_user_id
        if uid not in self.user_tx_states:
            self.user_tx_states[uid] = UserTxState()
        return self.user_tx_states[uid]

    def get_user_tx_state(self, user_id: Optional[int] = None) -> UserTxState:
        return self._get_user_tx(user_id)

    def _get_user_active_calls(self, user_id: Optional[int] = None) -> Dict[str, CallLogEntry]:
        uid = user_id if user_id is not None else self.active_user_id
        if uid not in self.user_active_calls:
            self.user_active_calls[uid] = {}
        return self.user_active_calls[uid]

    def _get_user_call_history(self, user_id: Optional[int] = None) -> List[CallLogEntry]:
        uid = user_id if user_id is not None else self.active_user_id
        if uid not in self.user_call_history:
            self._load_calls_history(uid)
        return self.user_call_history[uid]

    def get_user_runtimes(self, user_id: Optional[int] = None) -> Dict[str, HotspotRuntime]:
        uid = user_id if user_id is not None else self.active_user_id
        return self.user_runtimes.get(uid, {})

    def get_runtime(self, user_id: Optional[int], hotspot_id: Optional[str]) -> Optional[HotspotRuntime]:
        uid = user_id if user_id is not None else self.active_user_id
        user_map = self.user_runtimes.get(uid, {})
        if hotspot_id and hotspot_id in user_map:
            return user_map[hotspot_id]
        if not hotspot_id or hotspot_id in ("default", "active"):
            settings = self.user_settings.get(uid, self.settings)
            active_hid = getattr(settings, "active_hotspot_id", None)
            if active_hid and active_hid in user_map:
                return user_map[active_hid]
            return next(iter(user_map.values()), None)
        return user_map.get(hotspot_id)

    @property
    def runtimes(self) -> Dict[str, HotspotRuntime]:
        return self.user_runtimes.get(self.active_user_id, {})

    @runtimes.setter
    def runtimes(self, val: Dict[str, HotspotRuntime]):
        self.user_runtimes[self.active_user_id] = val

    @property
    def call_history(self) -> List[CallLogEntry]:
        return self._get_user_call_history(self.active_user_id)

    @call_history.setter
    def call_history(self, val: List[CallLogEntry]):
        self.user_call_history[self.active_user_id] = val

    @property
    def _active_calls(self) -> Dict[str, CallLogEntry]:
        return self._get_user_active_calls(self.active_user_id)

    @_active_calls.setter
    def _active_calls(self, val: Dict[str, CallLogEntry]):
        self.user_active_calls[self.active_user_id] = val

    @property
    def _tx_active(self) -> bool:
        return self._get_user_tx(self.active_user_id).active

    @_tx_active.setter
    def _tx_active(self, val: bool):
        self._get_user_tx(self.active_user_id).active = val

    @property
    def _tx_hotspot_id(self) -> Optional[str]:
        return self._get_user_tx(self.active_user_id).hotspot_id

    @_tx_hotspot_id.setter
    def _tx_hotspot_id(self, val: Optional[str]):
        self._get_user_tx(self.active_user_id).hotspot_id = val

    @property
    def _tx_slot(self) -> int:
        return self._get_user_tx(self.active_user_id).slot

    @_tx_slot.setter
    def _tx_slot(self, val: int):
        self._get_user_tx(self.active_user_id).slot = val

    @property
    def _tx_dst_id(self) -> int:
        return self._get_user_tx(self.active_user_id).dst_id

    @_tx_dst_id.setter
    def _tx_dst_id(self, val: int):
        self._get_user_tx(self.active_user_id).dst_id = val

    @property
    def _tx_call_type(self) -> str:
        return self._get_user_tx(self.active_user_id).call_type

    @_tx_call_type.setter
    def _tx_call_type(self, val: str):
        self._get_user_tx(self.active_user_id).call_type = val

    @property
    def _tx_stream_id(self) -> int:
        return self._get_user_tx(self.active_user_id).stream_id

    @_tx_stream_id.setter
    def _tx_stream_id(self, val: int):
        self._get_user_tx(self.active_user_id).stream_id = val

    @property
    def _tx_seq_no(self) -> int:
        return self._get_user_tx(self.active_user_id).seq_no

    @_tx_seq_no.setter
    def _tx_seq_no(self, val: int):
        self._get_user_tx(self.active_user_id).seq_no = val

    @property
    def _tx_burst_index(self) -> int:
        return self._get_user_tx(self.active_user_id).burst_index

    @_tx_burst_index.setter
    def _tx_burst_index(self, val: int):
        self._get_user_tx(self.active_user_id).burst_index = val

    @property
    def _tx_superframe_index(self) -> int:
        return self._get_user_tx(self.active_user_id).superframe_index

    @_tx_superframe_index.setter
    def _tx_superframe_index(self, val: int):
        self._get_user_tx(self.active_user_id).superframe_index = val

    @property
    def _tx_audio_buffer(self) -> bytearray:
        return self._get_user_tx(self.active_user_id).audio_buffer

    @_tx_audio_buffer.setter
    def _tx_audio_buffer(self, val: bytearray):
        self._get_user_tx(self.active_user_id).audio_buffer = val

    @property
    def _tx_start_time(self) -> float:
        return self._get_user_tx(self.active_user_id).start_time

    @_tx_start_time.setter
    def _tx_start_time(self, val: float):
        self._get_user_tx(self.active_user_id).start_time = val

    @property
    def _tx_call_id(self) -> Optional[str]:
        return self._get_user_tx(self.active_user_id).call_id

    @_tx_call_id.setter
    def _tx_call_id(self, val: Optional[str]):
        self._get_user_tx(self.active_user_id).call_id = val

    def set_transcriber(self, transcriber: Any):
        self.transcriber = transcriber

    def _get_calls_history_file(self, user_id: Optional[int] = None) -> Path:
        uid = user_id if user_id is not None else self.active_user_id
        if uid == 1:
            user1_file = CONFIG_DIR / "calls_history_1.json"
            legacy_file = CONFIG_DIR / "calls_history.json"
            if not user1_file.exists() and legacy_file.exists():
                return legacy_file
            return user1_file
        return CONFIG_DIR / f"calls_history_{uid}.json"

    def _load_calls_history(self, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        target_file = self._get_calls_history_file(uid)
        if not target_file.exists():
            self.user_call_history[uid] = []
            return
        try:
            with open(target_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            now = time.time()
            cutoff = now - CALL_HISTORY_RETENTION_SEC
            loaded = []
            for item in data:
                ts = float(item.get("timestamp", 0.0))
                dur = float(item.get("duration", 0.0))
                if ts >= cutoff and (dur >= 0.5 or bool(item.get("transcription"))):
                    entry = CallLogEntry(
                        id=item.get("id") or f"{int(ts*1000)}_{item.get('src_id', 0)}_{item.get('slot', 1)}",
                        timestamp=ts,
                        hotspot_id=item.get("hotspot_id", "default"),
                        slot=int(item.get("slot", 1)),
                        src_id=int(item.get("src_id", 0)),
                        dst_id=int(item.get("dst_id", 0)),
                        call_type=item.get("call_type", "GROUP"),
                        src_callsign=item.get("src_callsign", ""),
                        src_name=item.get("src_name", ""),
                        talker_alias=item.get("talker_alias", ""),
                        duration=dur,
                        active=False,
                        is_tx=bool(item.get("is_tx", False)),
                        transcription=item.get("transcription", ""),
                        transcription_lang=item.get("transcription_lang", "")
                    )
                    loaded.append(entry)
            loaded.sort(key=lambda x: x.timestamp, reverse=True)
            self.user_call_history[uid] = loaded[:CALL_HISTORY_MAX_ENTRIES]
            logger.info(f"[MANAGER] Loaded {len(self.user_call_history[uid])} call history records for user {uid} (24h retention)")
        except Exception as e:
            logger.warning(f"[MANAGER] Failed to load calls history cache for user {uid}: {e}")
            self.user_call_history[uid] = []

    def _spawn_task(self, coro) -> None:
        """create_task с удержанием ссылки для защиты от сборки мусора."""
        try:
            task = asyncio.get_running_loop().create_task(coro)
            self._bg_tasks.add(task)
            task.add_done_callback(self._bg_tasks.discard)
        except RuntimeError:
            coro.close()

    def _save_calls_history(self, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        try:
            CONFIG_DIR.mkdir(parents=True, exist_ok=True)
            target_file = self._get_calls_history_file(uid)
            cutoff = time.time() - CALL_HISTORY_RETENTION_SEC
            history = self.user_call_history.get(uid, [])
            records = [
                e.to_dict() for e in history
                if e.timestamp >= cutoff and (e.active or e.duration >= 0.5 or bool(e.transcription))
            ][:CALL_HISTORY_MAX_ENTRIES]
            self._history_dirty.discard(uid)

            def _write():
                tmp_file = target_file.with_suffix(".tmp")
                with open(tmp_file, "w", encoding="utf-8") as f:
                    json.dump(records, f, ensure_ascii=False)
                tmp_file.replace(target_file)

            try:
                self._spawn_task(asyncio.to_thread(_write))
            except Exception:
                _write()
        except Exception as e:
            logger.warning(f"[MANAGER] Failed to save calls history cache for user {uid}: {e}")

    def prune_calls(self, max_age_sec: float = CALL_HISTORY_RETENTION_SEC, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        now = time.time()
        cutoff = now - max_age_sec
        history = self.user_call_history.get(uid, [])
        orig_len = len(history)
        history = [
            c for c in history
            if c.timestamp >= cutoff and (c.active or c.duration >= 0.5 or bool(c.transcription))
        ]
        if len(history) > CALL_HISTORY_MAX_ENTRIES:
            history = history[:CALL_HISTORY_MAX_ENTRIES]
        self.user_call_history[uid] = history
        if len(history) != orig_len:
            self._history_dirty.add(uid)
            logger.debug(f"[MANAGER] Pruned {orig_len - len(history)} calls older than 24h for user {uid}")

    def clear_calls(self, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        if uid in self.user_call_history:
            self.user_call_history[uid].clear()
        if uid in self.user_active_calls:
            self.user_active_calls[uid].clear()
        target_file = self._get_calls_history_file(uid)
        try:
            if target_file.exists():
                target_file.unlink()
        except Exception as e:
            logger.warning(f"[MANAGER] Failed to remove calls history file for user {uid}: {e}")
        logger.info(f"[MANAGER] Call history buffer cleared for user {uid}")

    def delete_calls(self, call_ids: List[str], user_id: Optional[int] = None) -> int:
        if not call_ids:
            return 0
        uid = user_id if user_id is not None else self.active_user_id
        id_set = set(str(cid) for cid in call_ids)
        history = self.user_call_history.get(uid, [])
        orig_len = len(history)
        self.user_call_history[uid] = [c for c in history if str(c.id) not in id_set]
        deleted_count = orig_len - len(self.user_call_history[uid])
        if deleted_count > 0:
            self._save_calls_history(uid)
            logger.info(f"[MANAGER] Deleted {deleted_count} calls from history buffer for user {uid}")
        return deleted_count

    def get_calls_history(self, user_id: Optional[int] = None) -> List[CallLogEntry]:
        uid = user_id if user_id is not None else self.active_user_id
        self.prune_calls(user_id=uid)
        return self._get_user_call_history(uid)

    async def ensure_user_runtimes(self, user_id: int, new_settings: AppSettings):
        """Ensure runtimes and settings for user_id are initialized and running without disturbing other users."""
        self.user_settings[user_id] = new_settings
        if user_id not in self.user_runtimes:
            self.user_runtimes[user_id] = {}
            self.user_active_calls[user_id] = {}
            self._load_calls_history(user_id)

        user_map = self.user_runtimes[user_id]
        configured_ids = set()

        for hs_cfg in new_settings.hotspots:
            configured_ids.add(hs_cfg.id)
            if hs_cfg.id in user_map:
                rt = user_map[hs_cfg.id]
                rt.config = hs_cfg
                rt.config.auto_record = getattr(hs_cfg, "auto_record", False)
            else:
                rt = self._init_runtime(hs_cfg, user_id=user_id)
                if rt.config.autoconnect and not getattr(rt.config, "collapsed", False) and rt.config.dmr_id > 0 and rt.config.bm_password:
                    asyncio.create_task(self.connect_hotspot(hs_cfg.id, user_id=user_id))

        for hid in list(user_map.keys()):
            if hid not in configured_ids:
                old_rt = user_map.pop(hid, None)
                if old_rt and old_rt.client:
                    try:
                        await old_rt.client.disconnect()
                    except Exception:
                        pass

        self.apply_client_settings_to_runtimes(getattr(new_settings, "client_settings", {}) or {}, user_id=user_id)
        rec_s = getattr(new_settings, "recordings_settings", {}) or {}
        if rec_s and hasattr(self, "recorder") and self.recorder:
            self.recorder.apply_settings(rec_s)

    async def switch_user(self, user_id: int, new_settings: AppSettings):
        """Switch active user reference (used for single-tenant / CLI fallback). Keeps other users alive!"""
        self.active_user_id = user_id
        self.settings = new_settings
        await self.ensure_user_runtimes(user_id, new_settings)

    def apply_client_settings_to_runtimes(self, client_settings: dict, user_id: Optional[int] = None) -> None:
        """Apply Audio RX (AGC) and ambe+ RX (Vocoder) settings from client_settings to runtimes."""
        if not client_settings or not isinstance(client_settings, dict):
            return
        target_runtimes = list(self.get_user_runtimes(user_id).values()) if user_id is not None else [
            rt for hs_map in self.user_runtimes.values() for rt in hs_map.values()
        ]
        arx = client_settings.get("audio_rx", {})
        if arx and isinstance(arx, dict):
            if "agc_enabled" in arx:
                self.set_agc_enabled(bool(arx["agc_enabled"]), user_id=user_id)
            if "agc_profile" in arx and arx["agc_profile"]:
                self.set_agc_profile(str(arx["agc_profile"]), user_id=user_id)
            if any(k in arx for k in ("agc_boost", "agc_atten", "agc_hang")):
                self.set_agc_params(
                    min_gain_db=float(arx["agc_atten"]) if "agc_atten" in arx else None,
                    max_gain_db=float(arx["agc_boost"]) if "agc_boost" in arx else None,
                    hang_time=float(arx["agc_hang"]) if "agc_hang" in arx else None,
                    user_id=user_id
                )
            if any(k in arx for k in ("eq_low", "eq_mid", "eq_high", "deemphasis")):
                for rt in target_runtimes:
                    if hasattr(rt, "equalizer"):
                        rt.equalizer.set_params(
                            low_db=float(arx["eq_low"]) if "eq_low" in arx else None,
                            mid_db=float(arx["eq_mid"]) if "eq_mid" in arx else None,
                            high_db=float(arx["eq_high"]) if "eq_high" in arx else None,
                            deemphasis=bool(arx["deemphasis"]) if "deemphasis" in arx else None,
                        )
        atx = client_settings.get("audio_tx", {})
        if atx and isinstance(atx, dict):
            for rt in target_runtimes:
                if hasattr(rt, "tx_dsp"):
                    rt.tx_dsp.set_settings(
                        hpf_enabled=bool(atx["hpf_enabled"]) if "hpf_enabled" in atx else None,
                        presence_boost=float(atx["presence_boost"]) if "presence_boost" in atx else None,
                        mic_gain=float(atx["mic_gain"]) if "mic_gain" in atx else None,
                        dsp_agc=bool(atx["dsp_agc"]) if "dsp_agc" in atx else None,
                    )
        vrx = client_settings.get("ambe_rx", {})
        if vrx and isinstance(vrx, dict):
            for rt in target_runtimes:
                if hasattr(rt, "vocoder") and hasattr(rt.vocoder, "set_settings"):
                    rt.vocoder.set_settings(
                        uvquality=min(8, max(1, int(vrx.get("uvquality", 3)))),
                        spectral_enh=bool(vrx.get("spectral_enh", True)),
                        float_mode=bool(vrx.get("float_mode", True)),
                        max_repeats=int(vrx.get("max_repeats", 3)),
                        repeat_decay=float(vrx.get("repeat_decay", 75)) / 100.0,
                        fec_tolerance=int(vrx.get("fec_tolerance", 1)),
                        audio_gain=min(8.0, max(1.0, float(vrx.get("audio_gain", 7.0))))
                    )
        if hasattr(self, "recorder") and self.recorder:
            self.recorder.apply_settings(client_settings)

    async def on_user_deleted(self, user_id: int):
        """Clean up runtimes and call history for a deleted user."""
        target_file = self._get_calls_history_file(user_id)
        if target_file.exists():
            try:
                target_file.unlink()
            except Exception:
                pass
        hs_map = self.user_runtimes.pop(user_id, {})
        for hid, rt in hs_map.items():
            if rt.client:
                try:
                    await rt.client.disconnect()
                except Exception:
                    pass
        self.user_active_calls.pop(user_id, None)
        self.user_call_history.pop(user_id, None)
        self.user_settings.pop(user_id, None)
        self.user_tx_states.pop(user_id, None)
        if self.active_user_id == user_id:
            self.active_user_id = 1

    def attach_transcription(
        self,
        hotspot_id: str,
        slot: int,
        src_id: int,
        text: str,
        lang: str = "",
        is_final: bool = False,
        call_id: Optional[str] = None,
        created_at: Optional[float] = None,
        user_id: Optional[int] = None
    ):
        """Attaches speech transcription to the active or most recent matching CallLogEntry and persists to cache."""
        clean_text = (text or "").strip()
        if not clean_text:
            return

        uid = user_id if user_id is not None else self.active_user_id
        call_history = self._get_user_call_history(uid)
        active_calls = self._get_user_active_calls(uid)

        target_call = None
        if call_id:
            str_call_id = str(call_id)
            for call in call_history:
                if str(call.id) == str_call_id:
                    target_call = call
                    break

        if not target_call and created_at and src_id:
            for call in call_history:
                if call.src_id == src_id and abs(call.timestamp - created_at) < 5.0:
                    target_call = call
                    break

        if not target_call:
            call_key = f"{hotspot_id}_{slot}"
            target_call = active_calls.get(call_key)

        now = time.time()
        if not target_call:
            # Look up recent call from history within last 90s on this slot
            for call in call_history:
                same_hid = (call.hotspot_id == hotspot_id) or (hotspot_id in ("default", "") and not call.hotspot_id)
                if same_hid and call.slot == slot and (now - call.timestamp < 90.0):
                    if not src_id or call.src_id == src_id:
                        target_call = call
                        break

        if target_call:
            if target_call.transcription:
                if clean_text not in target_call.transcription:
                    target_call.transcription = f"{target_call.transcription} {clean_text}".strip()
            else:
                target_call.transcription = clean_text
            if lang and lang != "---":
                target_call.transcription_lang = lang
            self._save_calls_history(uid)
            logger.info(
                f"[MANAGER] Saved transcription to CallLog [{target_call.id}] "
                f"({target_call.src_callsign or target_call.src_id}, user {uid}): {clean_text[:60]}"
            )
        elif call_id or created_at:
            # If not in call_history (e.g. was purged or recorded earlier), add a CallLogEntry so it appears in history upon reload
            now_ts = created_at or time.time()
            entry = CallLogEntry(
                id=call_id or f"{int(now_ts * 1000)}_{src_id}_{slot}",
                timestamp=now_ts,
                hotspot_id=hotspot_id or "default",
                slot=int(slot),
                src_id=int(src_id or 0),
                dst_id=0,
                call_type="GROUP",
                src_callsign="",
                src_name="",
                talker_alias="",
                duration=0.0,
                active=False,
                is_tx=False,
                transcription=clean_text,
                transcription_lang=lang or ""
            )
            call_history.append(entry)
            call_history.sort(key=lambda x: x.timestamp, reverse=True)
            self._save_calls_history(uid)
            logger.info(
                f"[MANAGER] Created and saved new CallLogEntry [{entry.id}] from transcription: {clean_text[:60]}"
            )

    def _init_runtime(self, cfg: HotspotConfig, user_id: int = 1) -> HotspotRuntime:
        runtime = HotspotRuntime(config=cfg, user_id=user_id)

        def make_status_cb(hid: str, uid: int):
            def _status_cb(state: BMState, detail: str):
                self._on_client_status(hid, state, detail, user_id=uid)
            return _status_cb

        def make_frame_cb(hid: str, uid: int):
            def _frame_cb(frame: DMRFrame):
                self._on_dmr_frame(hid, frame, user_id=uid)
            return _frame_cb

        client = HomeBrewClient(
            repeater_id=cfg.dmr_id,
            callsign=cfg.callsign,
            password=cfg.bm_password,
            master_host=cfg.bm_master_host,
            master_port=cfg.bm_master_port,
            ssid=cfg.bm_ssid,
            duplex=cfg.duplex,
            rx_freq=cfg.rx_freq,
            tx_freq=cfg.tx_freq,
            color_code=cfg.color_code,
            on_status_change=make_status_cb(cfg.id, user_id),
            on_dmr_frame=make_frame_cb(cfg.id, user_id),
        )
        runtime.client = client

        # Apply current AGC and vocoder settings from user_settings or self.settings.client_settings
        user_sett = self.user_settings.get(user_id, self.settings)
        cs = getattr(user_sett, "client_settings", {}) or {}
        arx = cs.get("audio_rx", {})
        if arx and isinstance(arx, dict):
            if "agc_enabled" in arx:
                runtime.agc.enabled = bool(arx["agc_enabled"])
            if "agc_profile" in arx and arx["agc_profile"]:
                runtime.agc.set_profile(str(arx["agc_profile"]))
            if any(k in arx for k in ("agc_boost", "agc_atten", "agc_hang")):
                runtime.agc.set_params(
                    min_gain_db=float(arx["agc_atten"]) if "agc_atten" in arx else None,
                    max_gain_db=float(arx["agc_boost"]) if "agc_boost" in arx else None,
                    hang_time=float(arx["agc_hang"]) if "agc_hang" in arx else None
                )
            if any(k in arx for k in ("eq_low", "eq_mid", "eq_high", "deemphasis")):
                runtime.equalizer.set_params(
                    low_db=float(arx["eq_low"]) if "eq_low" in arx else None,
                    mid_db=float(arx["eq_mid"]) if "eq_mid" in arx else None,
                    high_db=float(arx["eq_high"]) if "eq_high" in arx else None,
                    deemphasis=bool(arx["deemphasis"]) if "deemphasis" in arx else None,
                )
        atx = cs.get("audio_tx", {})
        if atx and isinstance(atx, dict):
            runtime.tx_dsp.set_settings(
                hpf_enabled=bool(atx["hpf_enabled"]) if "hpf_enabled" in atx else None,
                presence_boost=float(atx["presence_boost"]) if "presence_boost" in atx else None,
                mic_gain=float(atx["mic_gain"]) if "mic_gain" in atx else None,
                dsp_agc=bool(atx["dsp_agc"]) if "dsp_agc" in atx else None,
            )
        vrx = cs.get("ambe_rx", {})
        if vrx and isinstance(vrx, dict) and hasattr(runtime, "vocoder") and hasattr(runtime.vocoder, "set_settings"):
            runtime.vocoder.set_settings(
                uvquality=min(8, max(1, int(vrx.get("uvquality", 3)))),
                spectral_enh=bool(vrx.get("spectral_enh", True)),
                float_mode=bool(vrx.get("float_mode", True)),
                max_repeats=int(vrx.get("max_repeats", 3)),
                repeat_decay=float(vrx.get("repeat_decay", 75)) / 100.0,
                fec_tolerance=int(vrx.get("fec_tolerance", 1)),
                audio_gain=min(8.0, max(1.0, float(vrx.get("audio_gain", 7.0))))
            )

        if user_id not in self.user_runtimes:
            self.user_runtimes[user_id] = {}
        self.user_runtimes[user_id][cfg.id] = runtime
        return runtime

    async def start(self):
        total_instances = sum(len(m) for m in self.user_runtimes.values())
        logger.info(f"[MANAGER] Starting HotspotManager with {total_instances} instances across {len(self.user_runtimes)} users...")
        self.timeout_watcher_task = asyncio.create_task(self._slot_timeout_loop())

        # Autoconnect configured instances (only if not collapsed) across all user runtimes
        for uid, hs_dict in self.user_runtimes.items():
            for hid, rt in hs_dict.items():
                if rt.config.autoconnect and not getattr(rt.config, "collapsed", False) and rt.config.dmr_id > 0 and rt.config.bm_password:
                    logger.info(f"[MANAGER] Autoconnecting hotspot '{rt.config.name}' (ID {hid}, user {uid})...")
                    asyncio.create_task(rt.client.connect())
                    await asyncio.sleep(0.5)

    async def stop(self):
        logger.info("[MANAGER] Stopping HotspotManager...")
        if self.timeout_watcher_task and not self.timeout_watcher_task.done():
            self.timeout_watcher_task.cancel()

        if self.transcriber and hasattr(self.transcriber, "disable_all_slots"):
            try:
                self.transcriber.disable_all_slots()
            except Exception as e:
                logger.error(f"[MANAGER] Error disabling transcriber slots on stop: {e}")

        for uid in list(self.user_runtimes.keys()):
            self._save_calls_history(uid)
            for hid, rt in self.user_runtimes[uid].items():
                if rt.client:
                    await rt.client.disconnect()
                # Explicitly release C-allocated vocoder memory
                if hasattr(rt, "vocoder") and hasattr(rt.vocoder, "close"):
                    try:
                        rt.vocoder.close()
                    except Exception:
                        pass
                if hasattr(rt, "tx_encoder") and hasattr(rt.tx_encoder, "close"):
                    try:
                        rt.tx_encoder.close()
                    except Exception:
                        pass

    def get_active_runtime(self, user_id: Optional[int] = None) -> Optional[HotspotRuntime]:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        settings = self.user_settings.get(uid, self.settings)
        active_id = getattr(settings, "active_hotspot_id", None)
        if active_id and active_id in hs_map:
            return hs_map[active_id]
        return next(iter(hs_map.values()), None)

    def set_active_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        if hotspot_id in hs_map:
            settings = self.user_settings.get(uid, self.settings)
            settings.active_hotspot_id = hotspot_id
            if uid == 1:
                save_app_settings(settings)
            self._notify_async({
                "type": "active_hotspot_changed",
                "active_hotspot_id": hotspot_id,
                "hotspot": hs_map[hotspot_id].to_dict(),
                "user_id": uid,
            }, user_id=uid)
            return True
        return False

    async def connect_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt or not rt.client:
            return False
        hotspot_id = rt.config.id
        if rt.client.is_connected:
            return True
        if rt.config.collapsed:
            rt.config.collapsed = False
            settings = self.user_settings.get(uid, self.settings)
            for hs_cfg in settings.hotspots:
                if hs_cfg.id == hotspot_id:
                    hs_cfg.collapsed = False
                    break
            if uid == 1:
                save_app_settings(settings)
            self._notify_async({
                "type": "hotspot_collapse",
                "hotspot_id": hotspot_id,
                "collapsed": False,
                "user_id": uid,
            }, user_id=uid)
        return await rt.client.connect()

    async def disconnect_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt or not rt.client:
            return False
        hotspot_id = rt.config.id
        if self.transcriber and hasattr(self.transcriber, "disable_hotspot"):
            try:
                self.transcriber.disable_hotspot(hotspot_id)
            except Exception as e:
                logger.error(f"[MANAGER] Error disabling transcriber on disconnect for {hotspot_id}: {e}")
        await rt.client.disconnect()
        return True

    async def reconnect_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt or not rt.client:
            return False
        hotspot_id = rt.config.id
        logger.info(f"[MANAGER] Reconnecting hotspot '{rt.config.name}' (id={hotspot_id}, user={uid}) to BM...")
        if rt.config.collapsed:
            rt.config.collapsed = False
            settings = self.user_settings.get(uid, self.settings)
            for hs_cfg in settings.hotspots:
                if hs_cfg.id == hotspot_id:
                    hs_cfg.collapsed = False
                    break
            if uid == 1:
                save_app_settings(settings)
            self._notify_async({
                "type": "hotspot_collapse",
                "hotspot_id": hotspot_id,
                "collapsed": False,
                "user_id": uid,
            }, user_id=uid)

        if hasattr(rt.client, "_is_manual_disconnect"):
            rt.client._is_manual_disconnect = False
        if hasattr(rt.client, "disconnect"):
            await rt.client.disconnect(is_retry=True)
        await asyncio.sleep(0.5)
        return await rt.client.connect(force=True)

    async def set_hotspot_collapsed(self, hotspot_id: str, collapsed: bool, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt and (hotspot_id == "default" or hotspot_id == "active"):
            rt = self.get_active_runtime(uid)
            if rt:
                hotspot_id = rt.config.id
        if not rt:
            return False
        hotspot_id = rt.config.id
        rt.config.collapsed = collapsed
        settings = self.user_settings.get(uid, self.settings)
        for hs_cfg in settings.hotspots:
            if hs_cfg.id == hotspot_id:
                hs_cfg.collapsed = collapsed
                break
        if uid == 1:
            save_app_settings(settings)
        self._notify_async({"type": "hotspot_collapse", "hotspot_id": hotspot_id, "collapsed": collapsed, "user_id": uid}, user_id=uid)
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        if collapsed:
            logger.info(f"[MANAGER] Hotspot '{rt.config.name}' (ID {hotspot_id}, user {uid}) collapsed -> disconnecting BM & disabling transcriber...")
            if self.transcriber and hasattr(self.transcriber, "disable_hotspot"):
                try:
                    self.transcriber.disable_hotspot(hotspot_id)
                except Exception as e:
                    logger.error(f"[MANAGER] Error disabling transcriber on collapse for {hotspot_id}: {e}")
            if rt.client:
                await rt.client.disconnect()
        else:
            logger.info(f"[MANAGER] Hotspot '{rt.config.name}' (ID {hotspot_id}, user {uid}) expanded -> connecting BM...")
            if rt.client and rt.config.autoconnect and not rt.client.is_connected:
                asyncio.create_task(rt.client.connect())
        return True

    def create_hotspot(self, cfg: HotspotConfig, user_id: Optional[int] = None) -> HotspotRuntime:
        uid = user_id if user_id is not None else self.active_user_id
        settings = self.user_settings.get(uid, self.settings)
        settings.hotspots.append(cfg)
        if uid == 1:
            save_app_settings(settings)
        rt = self._init_runtime(cfg, user_id=uid)
        self._notify_async({"type": "hotspot_created", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        return rt

    async def set_hotspot_auto_tg_bm(self, hotspot_id: str, enabled: bool, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt and (hotspot_id in ("default", "active")):
            rt = self.get_active_runtime(uid)
            if rt:
                hotspot_id = rt.config.id
        if not rt:
            return False
        hotspot_id = rt.config.id
        rt.config.auto_tg_bm = enabled
        settings = self.user_settings.get(uid, self.settings)
        for hs_cfg in settings.hotspots:
            if hs_cfg.id == hotspot_id:
                hs_cfg.auto_tg_bm = enabled
                break
        if uid == 1:
            save_app_settings(settings)
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        return True

    async def set_hotspot_auto_record(self, hotspot_id: str, enabled: bool, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt and (hotspot_id in ("default", "active")):
            rt = self.get_active_runtime(uid)
            if rt:
                hotspot_id = rt.config.id
        if not rt:
            return False
        hotspot_id = rt.config.id
        rt.config.auto_record = enabled
        settings = self.user_settings.get(uid, self.settings)
        for hs_cfg in settings.hotspots:
            if hs_cfg.id == hotspot_id or hs_cfg.id == rt.config.id:
                hs_cfg.auto_record = enabled
                break
        if not enabled and hasattr(self, "recorder") and self.recorder:
            self.recorder.on_hotspot_auto_record_disabled(hotspot_id)
        if uid == 1:
            save_app_settings(settings)
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        return True

    async def set_hotspot_autoconnect(self, hotspot_id: str, enabled: bool, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt and (hotspot_id in ("default", "active")):
            rt = self.get_active_runtime(uid)
            if rt:
                hotspot_id = rt.config.id
        if not rt:
            return False
        hotspot_id = rt.config.id
        rt.config.autoconnect = enabled
        settings = self.user_settings.get(uid, self.settings)
        for hs_cfg in settings.hotspots:
            if hs_cfg.id == hotspot_id or hs_cfg.id == rt.config.id:
                hs_cfg.autoconnect = enabled
                break
        if uid == 1:
            save_app_settings(settings)
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        return True

    async def update_hotspot(self, cfg: HotspotConfig, user_id: Optional[int] = None, auto_connect: Optional[bool] = None) -> Optional[HotspotRuntime]:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        if cfg.id not in hs_map:
            return None

        old_rt = hs_map[cfg.id]
        was_connected = (old_rt.status in (BMState.ONLINE, BMState.CONNECTING, BMState.AUTHENTICATING, BMState.CONFIGURING))
        if old_rt.client:
            try:
                await old_rt.client.disconnect(is_retry=True)
            except Exception as e:
                logger.warning(f"[MANAGER] Error disconnecting old client for {cfg.id} (user {uid}): {e}")

        # Update config in settings
        settings = self.user_settings.get(uid, self.settings)
        for i, h in enumerate(settings.hotspots):
            if h.id == cfg.id:
                # If incoming password is blank, preserve existing password!
                if not cfg.bm_password and h.bm_password:
                    cfg.bm_password = h.bm_password
                if not cfg.bm_api_key and h.bm_api_key:
                    cfg.bm_api_key = h.bm_api_key
                settings.hotspots[i] = cfg
                break
        if uid == 1:
            save_app_settings(settings)

        # Re-initialize runtime
        rt = self._init_runtime(cfg, user_id=uid)
        if rt.client and hasattr(rt.client, "_is_manual_disconnect"):
            rt.client._is_manual_disconnect = False
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)

        # Connect if auto_connect is True, or if previously active, or if autoconnect is configured
        should_connect = auto_connect if auto_connect is not None else (was_connected or cfg.autoconnect)
        if should_connect and rt.client and cfg.dmr_id > 0 and cfg.bm_password:
            logger.info(f"[MANAGER] Reconnecting hotspot '{cfg.name}' (ID {cfg.id}, user {uid}) to {cfg.bm_master_host}...")
            async def _delayed_connect(target_rt, wait_sec: float):
                if wait_sec > 0:
                    await asyncio.sleep(wait_sec)
                if target_rt and target_rt.client:
                    await target_rt.client.connect()

            # If previous session was active, give BM cluster 1.2s to propagate session release
            reconnect_delay = 1.2 if was_connected else 0.0
            asyncio.create_task(_delayed_connect(rt, reconnect_delay))

        return rt

    async def delete_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        if hotspot_id not in hs_map:
            return False

        if self.transcriber and hasattr(self.transcriber, "disable_hotspot"):
            try:
                self.transcriber.disable_hotspot(hotspot_id)
            except Exception as e:
                logger.error(f"[MANAGER] Error disabling transcriber on delete for {hotspot_id}: {e}")

        rt = hs_map[hotspot_id]
        if rt.client:
            await rt.client.disconnect()

        del hs_map[hotspot_id]
        settings = self.user_settings.get(uid, self.settings)
        settings.hotspots = [h for h in settings.hotspots if h.id != hotspot_id]

        first_hs = next(iter(hs_map.values()), None)
        first_id = first_hs.config.id if first_hs else "default"

        if settings.active_hotspot_id == hotspot_id:
            settings.active_hotspot_id = first_id

        if isinstance(settings.contacts_gateway, dict) and settings.contacts_gateway.get("hotspot_id") == hotspot_id:
            settings.contacts_gateway["hotspot_id"] = first_id

        if uid == 1:
            save_app_settings(settings)
        self._notify_async({"type": "hotspot_deleted", "id": hotspot_id, "user_id": uid}, user_id=uid)
        return True

    def register_dynamic_tg(self, hid: str, slot: int, tg: int, timestamp: Optional[float] = None, user_id: Optional[int] = None):
        if tg in (0, 4000, 9990) or slot not in (1, 2):
            return
        rt = self.get_runtime(user_id, hid)
        if not rt:
            return
        if not hasattr(rt, "dynamic_tgs") or not isinstance(rt.dynamic_tgs, dict):
            rt.dynamic_tgs = {1: {}, 2: {}}
        if slot not in rt.dynamic_tgs:
            rt.dynamic_tgs[slot] = {}
        ts = timestamp or time.time()
        rt.dynamic_tgs[slot][tg] = max(rt.dynamic_tgs[slot].get(tg, 0.0), ts)

    def clear_dynamic_tgs(self, hid: str, slot: Optional[int] = None, user_id: Optional[int] = None):
        rt = self.get_runtime(user_id, hid)
        if not rt:
            return
        now = time.time()
        if not hasattr(rt, "dropped_dynamic_ts") or not isinstance(rt.dropped_dynamic_ts, dict):
            rt.dropped_dynamic_ts = {1: 0.0, 2: 0.0}
        if not hasattr(rt, "dynamic_tgs") or not isinstance(rt.dynamic_tgs, dict):
            rt.dynamic_tgs = {1: {}, 2: {}}

        slots_to_clear = [slot] if (slot in (1, 2)) else [1, 2]
        for s in slots_to_clear:
            rt.dropped_dynamic_ts[s] = now
            if s in rt.dynamic_tgs:
                rt.dynamic_tgs[s].clear()

    def get_dynamic_tgs(self, hid: str, max_age_sec: float = 900.0, user_id: Optional[int] = None) -> Dict[int, Dict[int, float]]:
        now = time.time()
        rt = self.get_runtime(user_id, hid)
        result: Dict[int, Dict[int, float]] = {1: {}, 2: {}}
        if not rt:
            return result

        dropped_ts = getattr(rt, "dropped_dynamic_ts", {1: 0.0, 2: 0.0}) or {1: 0.0, 2: 0.0}

        # 1. From runtime tracked dynamic_tgs
        if hasattr(rt, "dynamic_tgs") and isinstance(rt.dynamic_tgs, dict):
            for slot in (1, 2):
                for tg, ts in list(rt.dynamic_tgs.get(slot, {}).items()):
                    if (now - ts) <= max_age_sec and ts > dropped_ts.get(slot, 0.0):
                        result[slot][tg] = max(result[slot].get(tg, 0.0), ts)

        # 2. Also inspect call_history to catch any recent activity since start/restart
        call_history = self._get_user_call_history(user_id)
        for entry in call_history:
            if entry.hotspot_id == hid and entry.call_type == "GROUP":
                if (now - entry.timestamp) <= max_age_sec:
                    slot = entry.slot
                    if slot in (1, 2) and entry.dst_id not in (0, 4000, 9990):
                        if entry.timestamp > dropped_ts.get(slot, 0.0):
                            result[slot][entry.dst_id] = max(result[slot].get(entry.dst_id, 0.0), entry.timestamp)

        # Keep runtime cache in sync
        if hasattr(rt, "dynamic_tgs") and isinstance(rt.dynamic_tgs, dict):
            for slot in (1, 2):
                rt.dynamic_tgs[slot] = {tg: ts for tg, ts in result[slot].items()}

        return result

    def _on_client_status(self, hid: str, state: BMState, detail: str, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt:
            return
        rt.status = state
        rt.detail = detail
        self._notify_async({
            "type": "bm_status",
            "hotspot_id": hid,
            "status": state.value,
            "detail": detail,
            "user_id": uid,
        }, user_id=uid)

    def _on_dmr_frame(self, hid: str, frame: DMRFrame, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt or getattr(rt.config, "collapsed", False):
            return

        tx_st = self._get_user_tx(uid)
        # Ignore reflected frames from our own active transmission
        if tx_st.active and frame.stream_id == tx_st.stream_id:
            return

        slot_state = rt.ts1 if frame.slot == 1 else rt.ts2
        now = time.time()

        # Duplicate UDP burst filter: drop identical frame (stream_id, seq_no, slot) within 500ms
        burst_key = (frame.stream_id, getattr(frame, "seq_no", 0), frame.slot)
        if not hasattr(rt, "_recent_burst_keys") or rt._recent_burst_keys is None:
            rt._recent_burst_keys = {}
        last_burst_time = rt._recent_burst_keys.get(burst_key, 0.0)
        if (now - last_burst_time) < 0.50:
            return
        rt._recent_burst_keys[burst_key] = now
        if len(rt._recent_burst_keys) > 128:
            cutoff = now - 2.0
            rt._recent_burst_keys = {k: v for k, v in rt._recent_burst_keys.items() if v > cutoff}

        active_calls = self._get_user_active_calls(uid)
        call_history = self._get_user_call_history(uid)
        user_sett = self.user_settings.get(uid, self.settings)

        # 1. Handle DMR Terminator (DT_TERMINATOR_WITH_LC = 0x22, DT_TERMINATOR = 0x23)
        # Note: 0x02 without DataSync (0x20) is Voice Burst C within the superframe, NOT a terminator!
        is_terminator = (frame.frame_type in (0x22, 0x23)) or (bool(frame.frame_type & 0x20) and (frame.frame_type & 0x0F) in (2, 3))
        if is_terminator:
            if rt._active_rx_slot == frame.slot:
                rt._active_rx_slot = None
                rt._last_rx_burst_time = 0.0
            if slot_state.active and (frame.stream_id == slot_state.stream_id or frame.src_id == slot_state.src_id):
                slot_state.active = False
                slot_state.src_id = 0
                slot_state.src_callsign = ""
                slot_state.src_name = ""
                slot_state.talker_alias = ""
                call_key = f"{hid}_{frame.slot}"
                active_call = active_calls.pop(call_key, None)
                duration = 0.0
                if active_call:
                    active_call.active = False
                    active_call.duration = max(0.1, round(now - active_call.timestamp, 1))
                    duration = active_call.duration
                    if active_call.duration < 0.5 and not active_call.transcription:
                        if active_call in call_history:
                            call_history.remove(active_call)
                if self.transcriber and self.transcriber.is_slot_enabled(hid, frame.slot):
                    self.transcriber.on_call_ended(hid, frame.slot, call_id=active_call.id if active_call else "")
                if hasattr(self, "recorder") and self.recorder:
                    self.recorder.on_rx_call_ended(hid, frame.slot, call_id=active_call.id if active_call else "")
                rt.vocoder.reset_slot(frame.slot)
                rt.agc.reset_slot(frame.slot)
                if hasattr(rt, "equalizer"):
                    rt.equalizer.reset_slot(frame.slot)
                if hid == user_sett.active_hotspot_id:
                    self.ta_decoder.reset_slot(frame.slot)
                self._notify_async({
                    "type": "dmr_activity",
                    "hotspot_id": hid,
                    "slot": frame.slot,
                    "active": False,
                    "call_id": active_call.id if active_call else "",
                    "duration": round(duration, 1),
                    "discard": (duration < 0.5),
                    "user_id": uid,
                }, user_id=uid)
            return

        was_active = slot_state.active
        src_changed = (slot_state.src_id != frame.src_id)
        stream_changed = (slot_state.stream_id != frame.stream_id)

        # 2. Debounce and Stream-locking:
        # If this slot is actively receiving voice from an ongoing call,
        # prevent colliding bursts from another speaker or stream (e.g. doubling or packet jitter)
        # from preempting or rapid flip-flopping unless there has been a gap of at least 350ms.
        if was_active and (src_changed or stream_changed):
            if (now - slot_state.last_seen) < 0.35:
                # Active speaker is still talking; ignore interleaved/colliding bursts from another station
                return

        dst_changed = (slot_state.dst_id != frame.dst_id)
        slot_state.active = True
        slot_state.src_id = frame.src_id
        slot_state.dst_id = frame.dst_id
        slot_state.call_type = frame.call_type
        slot_state.last_seen = now
        slot_state.stream_id = frame.stream_id
        slot_state.ber = frame.ber
        slot_state.rssi = frame.rssi

        # Dynamic TalkGroup tracking
        if frame.dst_id == 4000:
            self.clear_dynamic_tgs(hid, slot=frame.slot, user_id=uid)
        elif frame.call_type == "GROUP" and frame.dst_id > 0 and frame.dst_id not in (4000, 9990):
            self.register_dynamic_tg(hid, frame.slot, frame.dst_id, slot_state.last_seen, user_id=uid)

        # Check Talker Alias in voice bursts
        if len(frame.payload) >= 33:
            ta = self.ta_decoder.process_frame(
                slot=frame.slot,
                stream_id=frame.stream_id,
                frame_type=frame.frame_type,
                payload=frame.payload
            )
            if ta and ta != slot_state.talker_alias:
                slot_state.talker_alias = ta
                self.resolver.set_talker_alias(frame.src_id, ta)
                call_key = f"{hid}_{frame.slot}"
                active_call = active_calls.get(call_key)
                if active_call and active_call.src_id == frame.src_id:
                    active_call.talker_alias = ta
                self._notify_async({
                    "type": "caller_resolved",
                    "hotspot_id": hid,
                    "slot": frame.slot,
                    "src_id": frame.src_id,
                    "src_callsign": slot_state.src_callsign,
                    "src_name": slot_state.src_name,
                    "talker_alias": ta,
                    "caller_display": slot_state.format_caller(),
                    "user_id": uid,
                }, user_id=uid)

        # Only notify UI on call start, change, or periodic
        if not was_active or src_changed or dst_changed:
            slot_state.talker_alias = ""
            cached_info = self.resolver.get_cached(frame.src_id)
            if cached_info:
                slot_state.src_callsign = cached_info.get("callsign", "")
                slot_state.src_name = cached_info.get("name", "")
                slot_state.talker_alias = cached_info.get("talker_alias", "")
            else:
                slot_state.src_callsign = ""
                slot_state.src_name = ""
                slot_state.talker_alias = ""
                # Launch async resolution
                asyncio.create_task(self._resolve_caller_async(hid, frame.slot, frame.src_id, user_id=uid))

            call_key = f"{hid}_{frame.slot}"
            prev_call = active_calls.get(call_key)
            if prev_call and prev_call.active:
                prev_call.active = False
                prev_end = slot_state.last_seen if (slot_state.last_seen and slot_state.last_seen > prev_call.timestamp) else now
                prev_call.duration = max(0.1, round(prev_end - prev_call.timestamp, 1))
                if prev_call.duration < 0.5 and not prev_call.transcription:
                    if prev_call in call_history:
                        call_history.remove(prev_call)
                if self.transcriber and self.transcriber.is_slot_enabled(hid, frame.slot):
                    self.transcriber.on_call_ended(hid, frame.slot, call_id=prev_call.id)
                if hasattr(self, "recorder") and self.recorder:
                    self.recorder.on_rx_call_ended(hid, frame.slot, call_id=prev_call.id)
                self._notify_async({
                    "type": "dmr_activity",
                    "hotspot_id": hid,
                    "slot": frame.slot,
                    "active": False,
                    "call_id": prev_call.id,
                    "duration": round(prev_call.duration, 1),
                    "discard": (prev_call.duration < 0.5),
                    "user_id": uid,
                }, user_id=uid)

            call_id = f"{int(time.time() * 1000)}_{frame.src_id}_{frame.slot}"
            new_call = CallLogEntry(
                id=call_id,
                timestamp=time.time(),
                hotspot_id=hid,
                slot=frame.slot,
                src_id=frame.src_id,
                src_callsign=slot_state.src_callsign,
                src_name=slot_state.src_name,
                talker_alias=slot_state.talker_alias,
                dst_id=frame.dst_id,
                call_type=frame.call_type,
                active=True
            )
            active_calls[call_key] = new_call
            call_history.insert(0, new_call)
            self.prune_calls(user_id=uid)

            self._notify_async({
                "type": "dmr_activity",
                "hotspot_id": hid,
                "slot": frame.slot,
                "src_id": frame.src_id,
                "src_callsign": slot_state.src_callsign,
                "src_name": slot_state.src_name,
                "talker_alias": slot_state.talker_alias,
                "caller_display": slot_state.format_caller(),
                "dst_id": frame.dst_id,
                "call_type": frame.call_type,
                "active": True,
                "call_entry": new_call.to_dict(),
                "user_id": uid,
            }, user_id=uid)

        # Decode audio with hotspot-tagged frame: [slot (1B), hid_len (1B), hid_bytes, pcm_bytes]
        if len(frame.payload) >= 33:
            now = time.time()
            if not rt.config.duplex:
                if rt._active_rx_slot and rt._active_rx_slot != frame.slot:
                    if now - rt._last_rx_burst_time < 0.6:
                        # Previous slot on this simplex hotspot is still actively speaking
                        return
                rt._active_rx_slot = frame.slot
                rt._last_rx_burst_time = now

            pcm_bytes = rt.vocoder.decode_burst(frame.payload, slot=frame.slot)
            if pcm_bytes:
                # Server-side AGC: normalize audio level before broadcast
                if rt.agc.enabled:
                    pcm_bytes = rt.agc.process_burst(pcm_bytes, slot=frame.slot)

                # Server-side 3-band Equalizer & De-emphasis
                if hasattr(rt, "equalizer") and rt.equalizer:
                    pcm_bytes = rt.equalizer.process_burst(pcm_bytes, slot=frame.slot)

                hid_bytes = hid.encode("utf-8")
                tagged_audio = bytes([frame.slot, len(hid_bytes)]) + hid_bytes + pcm_bytes
                self._broadcast_audio_async(tagged_audio, user_id=uid)
                if self.transcriber and self.transcriber.is_slot_enabled(hid, frame.slot):
                    curr_call = active_calls.get(f"{hid}_{frame.slot}")
                    self.transcriber.feed_audio(
                        hid, frame.slot, frame.src_id, slot_state.src_callsign, pcm_bytes,
                        call_id=curr_call.id if curr_call else ""
                    )
                if hasattr(self, "recorder") and self.recorder:
                    curr_call = active_calls.get(f"{hid}_{frame.slot}")
                    auto_rec = getattr(rt.config, "auto_record", False)
                    self.recorder.feed_rx(
                        hotspot_id=hid,
                        slot=frame.slot,
                        src_id=frame.src_id,
                        src_callsign=slot_state.src_callsign,
                        src_name=slot_state.src_name,
                        talker_alias=slot_state.talker_alias,
                        dst_id=frame.dst_id,
                        pcm_bytes=pcm_bytes,
                        call_id=curr_call.id if curr_call else "",
                        user_id=uid,
                        auto_record=auto_rec,
                    )

    async def _resolve_caller_async(self, hid: str, slot: int, src_id: int, user_id: Optional[int] = None):
        try:
            uid = user_id if user_id is not None else self.active_user_id
            info = await self.resolver.resolve(src_id)
            if not info:
                return

            callsign = info.get("callsign", "")
            name = info.get("name", "")
            rt = self.get_runtime(uid, hid)
            if not rt:
                return

            slot_state = rt.ts1 if slot == 1 else rt.ts2
            if slot_state.src_id == src_id:
                slot_state.src_callsign = callsign
                slot_state.src_name = name

            active_calls = self._get_user_active_calls(uid)
            call_key = f"{hid}_{slot}"
            active_call = active_calls.get(call_key)
            if active_call and active_call.src_id == src_id:
                active_call.src_callsign = callsign
                active_call.src_name = name

            # Notify clients that station info is now resolved
            self._notify_async({
                "type": "caller_resolved",
                "hotspot_id": hid,
                "slot": slot,
                "src_id": src_id,
                "src_callsign": callsign,
                "src_name": name,
                "talker_alias": slot_state.talker_alias,
                "caller_display": format_caller_display(src_id, callsign, name, slot_state.talker_alias),
                "city": info.get("city", ""),
                "country": info.get("country", ""),
                "user_id": uid,
            }, user_id=uid)
        except Exception as e:
            logger.debug(f"[MANAGER] Caller resolution failed for {src_id}: {e}")

    async def _slot_timeout_loop(self):
        while True:
            await asyncio.sleep(0.5)
            try:
                now = time.time()

                if now - self._last_prune_time >= 30.0:
                    self._last_prune_time = now
                    for uid in list(self.user_runtimes.keys()):
                        self.prune_calls(user_id=uid)
                        if uid in self._history_dirty:
                            self._save_calls_history(user_id=uid)

                for uid, hs_dict in list(self.user_runtimes.items()):
                    tx_st = self._get_user_tx(uid)
                    active_calls = self._get_user_active_calls(uid)
                    call_history = self._get_user_call_history(uid)
                    user_sett = self.user_settings.get(uid, self.settings)

                    for hid, rt in hs_dict.items():
                        if rt._active_rx_slot and (now - rt._last_rx_burst_time > 1.0):
                            rt._active_rx_slot = None
                        for slot_num, st in [(1, rt.ts1), (2, rt.ts2)]:
                            if tx_st.active and hid == tx_st.hotspot_id and slot_num == tx_st.slot:
                                continue
                            if st.active and (now - st.last_seen > 1.8):
                                st.active = False
                                st.src_id = 0
                                st.src_callsign = ""
                                st.src_name = ""
                                st.talker_alias = ""
                                call_key = f"{hid}_{slot_num}"
                                active_call = active_calls.pop(call_key, None)
                                duration = 0.0
                                if active_call:
                                    active_call.active = False
                                    active_call.duration = max(0.1, round(st.last_seen - active_call.timestamp, 1))
                                    duration = active_call.duration
                                    if active_call.duration < 0.5 and not active_call.transcription:
                                        call_history[:] = [c for c in call_history if c.id != active_call.id]
                                        self._history_dirty.add(uid)
                                if self.transcriber and self.transcriber.is_slot_enabled(hid, slot_num):
                                    self.transcriber.on_call_ended(hid, slot_num, call_id=active_call.id if active_call else "")
                                if hasattr(self, "recorder") and self.recorder:
                                    self.recorder.on_rx_call_ended(hid, slot_num, call_id=active_call.id if active_call else "")

                                rt.vocoder.reset_slot(slot_num)
                                rt.agc.reset_slot(slot_num)
                                if hasattr(rt, "equalizer"):
                                    rt.equalizer.reset_slot(slot_num)
                                if hid == user_sett.active_hotspot_id:
                                    self.ta_decoder.reset_slot(slot_num)
                                self._notify_async({
                                    "type": "dmr_activity",
                                    "hotspot_id": hid,
                                    "slot": slot_num,
                                    "active": False,
                                    "call_id": active_call.id if active_call else "",
                                    "duration": round(duration, 1),
                                    "discard": (duration < 0.5),
                                    "user_id": uid,
                                }, user_id=uid)
            except Exception as e:
                logger.error(f"[MANAGER] Unexpected exception in slot timeout loop: {e}", exc_info=True)

    def _broadcast_audio_async(self, pcm_bytes: bytes, user_id: Optional[int] = None):
        if self.audio_broadcast_fn:
            try:
                self._spawn_task(self.audio_broadcast_fn(pcm_bytes, user_id=user_id))
            except TypeError:
                self._spawn_task(self.audio_broadcast_fn(pcm_bytes))

    def _notify_async(self, data: dict, user_id: Optional[int] = None):
        if user_id is not None and "user_id" not in data:
            data["user_id"] = user_id
        if self.broadcast_fn:
            try:
                self._spawn_task(self.broadcast_fn(data, user_id=user_id))
            except TypeError:
                self._spawn_task(self.broadcast_fn(data))

    # ─── AGC Management (synchronized per-user across all hotspots) ────

    def set_agc_enabled(self, enabled: bool, user_id: Optional[int] = None) -> None:
        """Enable/disable AGC for user's hotspots (or all if user_id is None)."""
        uid = user_id if user_id is not None else self.active_user_id
        rts = self.user_runtimes.get(uid, {}).values() if user_id is not None else [rt for hs in self.user_runtimes.values() for rt in hs.values()]
        for rt in rts:
            rt.agc.enabled = enabled
        logger.info(f"[AGC] {'Enabled' if enabled else 'Disabled'} for user {uid if user_id is not None else 'all'}")

    def set_agc_profile(self, profile: str, user_id: Optional[int] = None) -> dict:
        """Set AGC profile for user's hotspots. Returns the resulting settings dict."""
        uid = user_id if user_id is not None else self.active_user_id
        rts = list(self.user_runtimes.get(uid, {}).values()) if user_id is not None else [rt for hs in self.user_runtimes.values() for rt in hs.values()]
        for rt in rts:
            rt.agc.set_profile(profile)
        logger.info(f"[AGC] Profile set to '{profile}' for user {uid if user_id is not None else 'all'}")
        for rt in rts:
            return rt.agc.get_settings()
        return {"enabled": True, "profile": profile, "min_gain_db": -12, "max_gain_db": 12, "hang_time": 0.35}

    def set_agc_params(self, min_gain_db=None, max_gain_db=None, hang_time=None, user_id: Optional[int] = None) -> dict:
        """Set custom AGC parameters for user's hotspots. Returns the resulting settings dict."""
        uid = user_id if user_id is not None else self.active_user_id
        rts = list(self.user_runtimes.get(uid, {}).values()) if user_id is not None else [rt for hs in self.user_runtimes.values() for rt in hs.values()]
        for rt in rts:
            rt.agc.set_params(min_gain_db=min_gain_db, max_gain_db=max_gain_db, hang_time=hang_time)
        logger.info(f"[AGC] Custom params for user {uid if user_id is not None else 'all'}: min={min_gain_db}, max={max_gain_db}, hang={hang_time}")
        for rt in rts:
            return rt.agc.get_settings()
        return {"enabled": True, "profile": "custom", "min_gain_db": min_gain_db or -12, "max_gain_db": max_gain_db or 12, "hang_time": hang_time or 0.35}

    def get_agc_settings(self, user_id: Optional[int] = None) -> dict:
        """Get current AGC settings for user (from first runtime)."""
        uid = user_id if user_id is not None else self.active_user_id
        for rt in self.user_runtimes.get(uid, {}).values():
            return rt.agc.get_settings()
        return {"enabled": True, "profile": "standard", "min_gain_db": -12, "max_gain_db": 12, "hang_time": 0.35}


    def start_tx(
        self,
        hotspot_id: Optional[str] = None,
        slot: int = 2,
        dst_id: int = 9990,
        call_type: str = "GROUP",
        is_loopback: bool = False,
        user_id: Optional[int] = None,
    ) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        tx_st = self._get_user_tx(uid)
        settings = self.user_settings.get(uid, self.settings)
        hid = hotspot_id or settings.active_hotspot_id
        rt = self.get_runtime(uid, hid) or self.get_active_runtime(uid)
        if not rt and not is_loopback:
            logger.warning(f"[TX] Cannot start TX: runtime {hid} not found for user {uid}")
            return False

        effective_hid = rt.config.id if rt else (hid or "default")
        src_id = rt.config.dmr_id if rt else 0
        src_callsign = rt.config.callsign if rt else "ME"
        send_ta = getattr(rt.config, "send_talker_alias", True) if rt else True
        talker_alias = ((rt.config.talker_alias or rt.config.callsign) if send_ta else "") if rt else "ME"
        src_name = "ME (ProxDMR)" if not is_loopback else "ME (MIC Loop)"

        tx_st.active = True
        tx_st.hotspot_id = effective_hid
        tx_st.slot = slot
        tx_st.dst_id = dst_id
        tx_st.call_type = call_type.upper()
        tx_st.stream_id = random.randint(1, 0xFFFFFFFE)
        tx_st.seq_no = 0
        tx_st.burst_index = 0
        tx_st.superframe_index = 0
        tx_st.audio_buffer.clear()
        tx_st.start_time = time.time()
        if rt:
            rt.tx_encoder.reset()
            if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                rt.tx_dsp.reset()

        # Update local slot state for display
        if rt:
            st = rt.ts1 if slot == 1 else rt.ts2
            st.active = True
            st.src_id = src_id
            st.src_callsign = src_callsign
            st.src_name = src_name
            st.talker_alias = talker_alias
            st.dst_id = dst_id
            st.call_type = tx_st.call_type
            st.last_seen = tx_st.start_time
            st.stream_id = tx_st.stream_id

            # Dynamic TalkGroup tracking on TX
            if dst_id == 4000:
                self.clear_dynamic_tgs(effective_hid, slot=slot, user_id=uid)
            elif tx_st.call_type == "GROUP" and dst_id > 0 and dst_id not in (4000, 9990):
                self.register_dynamic_tg(effective_hid, slot, dst_id, tx_st.start_time, user_id=uid)

        active_calls = self._get_user_active_calls(uid)
        call_history = self._get_user_call_history(uid)

        # If an RX call was active on this slot, finalize it cleanly
        prev_rx = active_calls.pop(f"{effective_hid}_{slot}", None)
        if prev_rx and prev_rx.active:
            prev_rx.active = False
            prev_rx.duration = max(0.1, tx_st.start_time - prev_rx.timestamp)
            if hasattr(self, "recorder") and self.recorder:
                self.recorder.on_rx_call_ended(effective_hid, slot, call_id=prev_rx.id)
            self._notify_async({
                "type": "dmr_activity",
                "hotspot_id": effective_hid,
                "slot": slot,
                "active": False,
                "call_id": prev_rx.id,
                "duration": round(prev_rx.duration, 1),
                "user_id": uid,
            }, user_id=uid)

        # Create and record CallLogEntry for this TX transmission
        tx_call_id = f"tx_{int(tx_st.start_time * 1000)}_{random.randint(100, 999)}"
        tx_st.call_id = tx_call_id
        if hasattr(self, "recorder") and self.recorder:
            effective_rt = self.get_runtime(uid, effective_hid)
            auto_rec = getattr(effective_rt.config, "auto_record", False) if effective_rt else False
            self.recorder.start_tx(
                hotspot_id=effective_hid,
                slot=slot,
                src_id=src_id,
                src_callsign=src_callsign,
                dst_id=dst_id,
                call_id=tx_call_id,
                user_id=uid,
                auto_record=auto_rec,
            )
        tx_call = CallLogEntry(
            id=tx_call_id,
            timestamp=tx_st.start_time,
            hotspot_id=effective_hid,
            slot=slot,
            src_id=src_id,
            src_callsign=src_callsign,
            src_name=src_name,
            talker_alias=talker_alias,
            dst_id=dst_id,
            call_type=tx_st.call_type,
            active=True,
            is_tx=True,
        )
        active_calls[f"tx_{effective_hid}_{slot}"] = tx_call
        call_history.insert(0, tx_call)
        self.prune_calls(user_id=uid)

        # Broadcast dmr_activity with call_entry so all connected clients log the TX row
        self._notify_async({
            "type": "dmr_activity",
            "hotspot_id": effective_hid,
            "slot": slot,
            "src_id": src_id,
            "src_callsign": src_callsign,
            "src_name": src_name,
            "talker_alias": talker_alias,
            "caller_display": tx_call.format_caller(),
            "dst_id": dst_id,
            "call_type": tx_st.call_type,
            "active": True,
            "is_tx": True,
            "call_entry": tx_call.to_dict(),
            "user_id": uid,
        }, user_id=uid)

        if not is_loopback and rt and rt.client and rt.status == BMState.ONLINE:
            try:
                header_payload = self.tx_framer.create_header(
                    src_id=src_id,
                    dst_id=dst_id,
                    slot=slot,
                    call_type=tx_st.call_type,
                    color_code=rt.client.color_code,
                )
                logger.info(
                    f"[TX] Starting transmission to BM (user {uid}): Src={src_id}, Dst={dst_id}, "
                    f"Slot={slot}, CallType={tx_st.call_type}, StreamID={tx_st.stream_id:08X}"
                )
                # Send 3 Voice Headers as per MMDVM NO_HEADERS_DUPLEX standard
                for _ in range(3):
                    rt.client.send_dmrd(
                        slot=slot,
                        call_type=tx_st.call_type,
                        frame_type=1,  # Header (DT_VOICE_LC_HEADER)
                        stream_id=tx_st.stream_id,
                        seq_no=tx_st.seq_no,
                        payload=header_payload,
                        src_id=src_id,
                        dst_id=dst_id,
                    )
                    tx_st.seq_no = (tx_st.seq_no + 1) % 256
            except Exception as e:
                logger.error(f"[TX] Error sending voice header: {e}")
        else:
            logger.info(f"[TX] Local TX started for user {uid} ({'MIC LOOP' if is_loopback else ('BM status is ' + (rt.status.value if rt else 'unknown'))})")

        return True

    def process_tx_audio(self, pcm_bytes: bytes, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        tx_st = self._get_user_tx(uid)
        if not tx_st.active or not tx_st.hotspot_id:
            logger.warning(f"[TX] process_tx_audio: TX not active (active={tx_st.active}, hid={tx_st.hotspot_id})")
            return

        if hasattr(self, "recorder") and self.recorder:
            self.recorder.feed_tx(pcm_bytes)

        rt = self.get_runtime(uid, tx_st.hotspot_id)
        if not rt:
            logger.warning(f"[TX] process_tx_audio: Runtime not found for hotspot {tx_st.hotspot_id}")
            return

        tx_st.audio_buffer.extend(pcm_bytes)

        # 960 bytes PCM = 480 samples @ 8000 Hz = 60 ms
        while len(tx_st.audio_buffer) >= 960:
            chunk = bytes(tx_st.audio_buffer[:960])
            del tx_st.audio_buffer[:960]

            if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                chunk = rt.tx_dsp.process_burst(chunk)

            if rt.client and rt.status == BMState.ONLINE:
                try:
                    ambes = rt.tx_encoder.encode_60ms_superframe(chunk)
                    if ambes and len(ambes) == 3:
                        src_id = rt.config.dmr_id
                        burst_payload = self.tx_framer.create_burst(
                            ambe_3_frames=ambes,
                            burst_index=tx_st.burst_index,
                            src_id=src_id,
                            dst_id=tx_st.dst_id,
                            slot=tx_st.slot,
                            call_type=tx_st.call_type,
                            color_code=rt.client.color_code,
                            talker_alias=(rt.config.talker_alias or rt.config.callsign) if getattr(rt.config, "send_talker_alias", True) else None,
                            superframe_index=tx_st.superframe_index,
                        )
                        rt.client.send_dmrd(
                            slot=tx_st.slot,
                            call_type=tx_st.call_type,
                            frame_type=0,  # Voice Burst
                            stream_id=tx_st.stream_id,
                            seq_no=tx_st.seq_no,
                            payload=burst_payload,
                            src_id=src_id,
                            dst_id=tx_st.dst_id,
                            burst_index=tx_st.burst_index,
                        )
                        tx_st.seq_no = (tx_st.seq_no + 1) % 256
                        tx_st.burst_index = (tx_st.burst_index + 1) % 6
                        if tx_st.burst_index == 0:
                            tx_st.superframe_index += 1
                    else:
                        logger.error(f"[TX] Vocoder encode returned invalid frames: {ambes}")
                except Exception as e:
                    logger.error(f"[TX] Error encoding/sending burst: {e}")
            else:
                logger.warning(f"[TX] Cannot send burst to BM: client={bool(rt.client)}, status={rt.status if rt else 'None'}")

    def stop_tx(self, user_id: Optional[int] = None, roger_beep: bool = False, roger_beep_pattern: str = "") -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        tx_st = self._get_user_tx(uid)
        if not tx_st.active:
            return False

        now = time.time()
        hid = tx_st.hotspot_id
        rt = self.get_runtime(uid, hid) if hid else None
        slot = tx_st.slot

        active_calls = self._get_user_active_calls(uid)
        # Finalize active TX CallLogEntry
        tx_call_key = f"tx_{hid}_{slot}"
        active_tx_call = active_calls.pop(tx_call_key, None)
        duration = 0.0
        if active_tx_call:
            active_tx_call.active = False
            active_tx_call.duration = max(0.1, now - active_tx_call.timestamp)
            duration = active_tx_call.duration
        elif tx_st.start_time > 0:
            duration = max(0.1, now - tx_st.start_time)

        if rt and rt.client and rt.status == BMState.ONLINE:
            try:
                src_id = rt.config.dmr_id

                # If roger beep is requested, append beep PCM before flushing
                if roger_beep and roger_beep_pattern:
                    try:
                        beep_pcm = BeepMarkerGenerator.get_marker_bytes(roger_beep_pattern)
                        if beep_pcm:
                            if hasattr(self, "recorder") and self.recorder:
                                self.recorder.feed_tx(beep_pcm)
                            tx_st.audio_buffer.extend(beep_pcm)
                            logger.info(f"[TX] Appended Roger Beep ({len(beep_pcm)} bytes, '{roger_beep_pattern}')")
                    except Exception as e:
                        logger.error(f"[TX] Error generating Roger Beep: {e}")

                # Process all complete 960-byte chunks in buffer (each is 60ms voice burst)
                while len(tx_st.audio_buffer) >= 960:
                    chunk = bytes(tx_st.audio_buffer[:960])
                    del tx_st.audio_buffer[:960]
                    ambes = rt.tx_encoder.encode_60ms_superframe(chunk)
                    if ambes and len(ambes) == 3:
                        burst_payload = self.tx_framer.create_burst(
                            ambe_3_frames=ambes,
                            burst_index=tx_st.burst_index,
                            src_id=src_id,
                            dst_id=tx_st.dst_id,
                            slot=tx_st.slot,
                            call_type=tx_st.call_type,
                            color_code=rt.client.color_code,
                            talker_alias=(rt.config.talker_alias or rt.config.callsign) if getattr(rt.config, "send_talker_alias", True) else None,
                            superframe_index=tx_st.superframe_index,
                        )
                        rt.client.send_dmrd(
                            slot=tx_st.slot,
                            call_type=tx_st.call_type,
                            frame_type=0,
                            stream_id=tx_st.stream_id,
                            seq_no=tx_st.seq_no,
                            payload=burst_payload,
                            src_id=src_id,
                            dst_id=tx_st.dst_id,
                            burst_index=tx_st.burst_index,
                        )
                        tx_st.seq_no = (tx_st.seq_no + 1) % 256
                        tx_st.burst_index = (tx_st.burst_index + 1) % 6
                        if tx_st.burst_index == 0:
                            tx_st.superframe_index += 1

                # If leftover audio >= 320 bytes (20 ms), pad to 960 bytes and send last burst
                if len(tx_st.audio_buffer) >= 320:
                    pad_len = 960 - len(tx_st.audio_buffer)
                    padded = bytes(tx_st.audio_buffer) + (b"\x00" * pad_len)
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        padded = rt.tx_dsp.process_burst(padded)
                    ambes = rt.tx_encoder.encode_60ms_superframe(padded)
                    if ambes and len(ambes) == 3:
                        burst_payload = self.tx_framer.create_burst(
                            ambe_3_frames=ambes,
                            burst_index=tx_st.burst_index,
                            src_id=src_id,
                            dst_id=tx_st.dst_id,
                            slot=tx_st.slot,
                            call_type=tx_st.call_type,
                            color_code=rt.client.color_code,
                            talker_alias=(rt.config.talker_alias or rt.config.callsign) if getattr(rt.config, "send_talker_alias", True) else None,
                            superframe_index=tx_st.superframe_index,
                        )
                        rt.client.send_dmrd(
                            slot=tx_st.slot,
                            call_type=tx_st.call_type,
                            frame_type=0,
                            stream_id=tx_st.stream_id,
                            seq_no=tx_st.seq_no,
                            payload=burst_payload,
                            src_id=src_id,
                            dst_id=tx_st.dst_id,
                            burst_index=tx_st.burst_index,
                        )
                        tx_st.seq_no = (tx_st.seq_no + 1) % 256

                term_payload = self.tx_framer.create_terminator(
                    src_id=src_id,
                    dst_id=tx_st.dst_id,
                    slot=tx_st.slot,
                    call_type=tx_st.call_type,
                    color_code=rt.client.color_code,
                )
                logger.info(
                    f"[TX] Ending transmission to BM (user {uid}): Src={src_id}, Dst={tx_st.dst_id}, "
                    f"Slot={tx_st.slot}"
                )
                # Send 2 Voice Terminators to ensure completion
                for _ in range(2):
                    rt.client.send_dmrd(
                        slot=tx_st.slot,
                        call_type=tx_st.call_type,
                        frame_type=2,  # Terminator
                        stream_id=tx_st.stream_id,
                        seq_no=tx_st.seq_no,
                        payload=term_payload,
                        src_id=src_id,
                        dst_id=tx_st.dst_id,
                    )
                    tx_st.seq_no = (tx_st.seq_no + 1) % 256
            except Exception as e:
                logger.error(f"[TX] Error sending voice terminator: {e}")

        # Update local slot state
        if rt:
            st = rt.ts1 if tx_st.slot == 1 else rt.ts2
            st.active = False
            st.src_id = 0
            st.src_callsign = ""
            st.src_name = ""
            st.talker_alias = ""

        tx_st.active = False
        tx_st.audio_buffer.clear()
        if rt and hasattr(rt, "tx_dsp") and rt.tx_dsp:
            rt.tx_dsp.reset()

        # Broadcast completion of TX call
        tx_call_finish_id = active_tx_call.id if active_tx_call else (tx_st.call_id or "")
        if hasattr(self, "recorder") and self.recorder:
            self.recorder.stop_tx(call_id=tx_call_finish_id)

        self._notify_async({
            "type": "dmr_activity",
            "hotspot_id": hid,
            "slot": slot,
            "active": False,
            "is_tx": True,
            "call_id": tx_call_finish_id,
            "duration": round(duration, 1),
            "user_id": uid,
        }, user_id=uid)
        tx_st.call_id = None
        return True

    # ─── Selective Slot & Hotspot Mute Management ────────────────────

    def set_slot_mute(self, hotspot_id: str, slot: int, muted: bool) -> None:
        """Inform audio recorder and manager about slot mute state."""
        if hasattr(self, "recorder") and self.recorder:
            self.recorder.set_slot_mute(hotspot_id, slot, muted)

    def set_hotspot_mute(self, hotspot_id: str, muted: bool) -> None:
        """Inform audio recorder and manager about whole hotspot mute state."""
        if hasattr(self, "recorder") and self.recorder:
            self.recorder.set_hotspot_mute(hotspot_id, muted)

    def is_slot_muted(self, hotspot_id: str, slot: int) -> bool:
        """Check whether a timeslot on a hotspot is currently muted."""
        if hasattr(self, "recorder") and self.recorder:
            return self.recorder.is_slot_muted(hotspot_id, slot)
        return False

    # ─── Master Recording Session Control ────────────────────────────

    def start_recording_session(self, user_id: int = 1, hotspot_id: str = "default") -> dict:
        """Start a continuous master recording session across multiple overs."""
        if hasattr(self, "recorder") and self.recorder:
            return self.recorder.start_session(user_id=user_id, hotspot_id=hotspot_id)
        return {"active": False}

    async def stop_recording_session(self, user_id: int = 1) -> Optional[dict]:
        """Stop a continuous master recording session and finalize WAV."""
        if hasattr(self, "recorder") and self.recorder:
            return await self.recorder.stop_session(user_id=user_id)
        return None

    def get_recording_session_status(self, user_id: int = 1) -> Optional[dict]:
        """Return live metadata about an active master recording session."""
        if hasattr(self, "recorder") and self.recorder:
            return self.recorder.get_session_status(user_id=user_id)
        return None