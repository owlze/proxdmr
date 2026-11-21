import asyncio
import collections
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
    from dmr.tg_resolver import tg_resolver
    from dmr.adn_hosts import adn_hosts_mgr
    from dmr.dmrplus_hosts import dmrplus_hosts_mgr
    from dmr.constants import (
        parse_freedmr_rpto,
        build_freedmr_rpto,
        FREEDMR_MAX_RPTO_BYTES,
        FREEDMR_DEFAULT_OPTS,
        normalize_freedmr_slots,
        parse_dmrplus_rpto,
        build_dmrplus_rpto,
    )
    from dmr.jitter_buffer import DMRRxJitterBuffer
    from i18n_backend import tr as _tr, country_name as _i18n_country_name
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
    from src.dmr.tg_resolver import tg_resolver
    from src.dmr.adn_hosts import adn_hosts_mgr
    from src.dmr.dmrplus_hosts import dmrplus_hosts_mgr
    from src.dmr.constants import (
        parse_freedmr_rpto,
        build_freedmr_rpto,
        FREEDMR_MAX_RPTO_BYTES,
        FREEDMR_DEFAULT_OPTS,
        normalize_freedmr_slots,
        parse_dmrplus_rpto,
        build_dmrplus_rpto,
    )
    from src.dmr.jitter_buffer import DMRRxJitterBuffer
    from src.i18n_backend import tr as _tr, country_name as _i18n_country_name

CALLS_HISTORY_FILE = CONFIG_DIR / "calls_history.json"
CALL_HISTORY_RETENTION_SEC = 0.0      # 0 = no time limit (disk quota only)
CALL_HISTORY_MAX_ENTRIES = 10000     # Safety maximum

DEAD_FREEDMR_HOSTS = {
    "ru.freedmr.uk",
    "nl.freedmr.uk",
    "fr.freedmr.uk",
    "it.freedmr.uk",
    "es.freedmr.uk",
    "us-east.freedmr.uk",
    "br.freedmr.uk",
    "freedmr.cymru",
    "freedmr.ham-digital.org",
}
DEFAULT_LIVE_FREEDMR_HOST = "178.254.30.151"

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
    client: Optional[Any] = None
    allstar_client: Optional[Any] = None
    status: BMState = BMState.DISCONNECTED
    detail: str = "Disconnected"
    ts1: SlotState = field(default_factory=SlotState)
    ts2: SlotState = field(default_factory=SlotState)
    vocoder: DMRVocoderDecoder = field(default_factory=DMRVocoderDecoder)
    tx_encoder: DMRVocoderEncoder = field(default_factory=DMRVocoderEncoder)
    agc: ServerAudioAgc = field(default_factory=ServerAudioAgc)
    rx_agc_profile: Dict[str, Any] = field(default_factory=lambda: {"enabled": True, "depth_db": 18.0, "gain_raw": 35.0, "limiter_enabled": True})
    equalizer: ServerAudioEqualizer = field(default_factory=ServerAudioEqualizer)
    tx_dsp: ServerTxDsp = field(default_factory=ServerTxDsp)
    _active_rx_slot: Optional[int] = None
    _last_rx_burst_time: float = 0.0
    dynamic_tgs: Dict[int, Dict[int, float]] = field(default_factory=lambda: {1: {}, 2: {}})
    dropped_dynamic_ts: Dict[int, float] = field(default_factory=lambda: {1: 0.0, 2: 0.0})
    _recent_burst_keys: Dict[tuple, float] = field(default_factory=dict)
    asl_rx_pcm_accum: bytearray = field(default_factory=bytearray)
    backend_buffer_ms: int = 120
    rx_jitter_buffers: Dict[int, Any] = field(default_factory=dict)
    _rx_pacer_queues: Dict[int, collections.deque] = field(default_factory=lambda: {1: collections.deque(maxlen=100), 2: collections.deque(maxlen=100)})
    _rx_pacer_tasks: Dict[int, Optional[asyncio.Task]] = field(default_factory=lambda: {1: None, 2: None})
    _rx_pacer_draining: Dict[int, bool] = field(default_factory=lambda: {1: False, 2: False})
    _rx_pacer_EndCallbacks: Dict[int, list] = field(default_factory=lambda: {1: [], 2: []})

    def to_dict(self) -> dict:
        return {
            "id": self.config.id,
            "user_id": self.user_id,
            "name": self.config.name,
            "callsign": self.config.callsign,
            "dmr_id": self.config.dmr_id,
            "bm_ssid": self.config.bm_ssid,
            "effective_id": (
                int(f"{self.config.dmr_id}{self.config.bm_ssid:02d}")
                if (
                    self.config.dmr_id > 0
                    and len(str(self.config.dmr_id)) == 7
                    and 1 <= int(getattr(self.config, "bm_ssid", 0) or 0) <= 99
                    and (getattr(self.config, "network_type", "bm") or "bm").lower() != "xlx"
                )
                else self.config.dmr_id
            ),
            "bm_master_host": self.config.bm_master_host,
            "bm_master_port": self.config.bm_master_port,
            "bm_password": self.config.bm_password,
            "network_type": getattr(self.config, "network_type", "bm") or "bm",
            "rpto_options": getattr(self.config, "rpto_options", "") or "",
            "xlx_module": getattr(self.config, "xlx_module", "D") or "D",
            "dmrplus_reflector": getattr(self.config, "dmrplus_reflector", "4530") or "4530",
            "allstar_node": getattr(self.config, "allstar_node", "1999") or "1999",
            "allstar_always_online": bool(getattr(self.config, "allstar_always_online", True)),
            "ysf_host": getattr(self.config, "ysf_host", "") or "",
            "ysf_port": int(getattr(self.config, "ysf_port", 42000) or 42000),
            "ysf_room_id": getattr(self.config, "ysf_room_id", "") or getattr(self.config, "ysf_room", "") or "",
            "ysf_room_name": getattr(self.config, "ysf_room_name", "") or getattr(self.config, "ysf_name", "") or "",
            "ysf_room": getattr(self.config, "ysf_room", "") or getattr(self.config, "ysf_room_id", "") or "",
            "ysf_name": getattr(self.config, "ysf_name", "") or getattr(self.config, "ysf_room_name", "") or "",
            "ysf_online_count": int(getattr(getattr(self.client, "client", self.client), "online_count", 0) or 0) if self.client else 0,
            "ysf_dg_id": str(getattr(getattr(self.client, "client", self.client), "dg_id", "") or getattr(self.config, "ysf_dg_id", "") or "00"),
            "ysf_tx_dg_id": getattr(getattr(self.client, "client", self.client), "tx_dg_id", getattr(self.config, "ysf_tx_dg_id", None)) if self.client else getattr(self.config, "ysf_tx_dg_id", None),
            "ysf_rx_dg_id": int(getattr(getattr(self.client, "client", self.client), "current_rx_dg_id", 0) or 0) if self.client else 0,
            "ysf_is_multiroom": bool(getattr(getattr(self.client, "client", self.client), "is_multiroom", False)) if self.client else False,
            "ysf_reflector_type": str(getattr(getattr(self.client, "client", self.client), "reflector_type", "single") or "single") if self.client else "single",
            "ysf_multiroom_kind": str(getattr(getattr(self.client, "client", self.client), "multiroom_kind", "") or "") if self.client else "",
            "ysf_room_dg_ids": dict(getattr(self.config, "ysf_room_dg_ids", {}) or {}),
            "m17_host": getattr(self.config, "m17_host", "") or "",
            "m17_port": int(getattr(self.config, "m17_port", 17000) or 17000),
            "m17_reflector": getattr(self.config, "m17_reflector", "") or "",
            "m17_reflector_name": getattr(self.config, "m17_reflector_name", "") or "",
            "m17_module": getattr(self.config, "m17_module", "C") or "C",
            "m17_callsign_suffix": getattr(self.config, "m17_callsign_suffix", "D") if getattr(self.config, "m17_callsign_suffix", None) is not None else "D",
            "m17_can": int(getattr(self.config, "m17_can", 0) or 0),
            "m17_link_mode": getattr(self.config, "m17_link_mode", "conn") or "conn",
            "m17_codec_mode": getattr(self.config, "m17_codec_mode", "3200") or "3200",
            "m17_dst_mode": getattr(self.config, "m17_dst_mode", "reflector") or "reflector",
            "m17_meta_text": getattr(self.config, "m17_meta_text", "") or "",
            "m17_server_type": getattr(self.config, "m17_server_type", "mrefd") or "mrefd",
            "m17_room_modules": dict(getattr(self.config, "m17_room_modules", {}) or {}),
            "m17_online_count": int(getattr(getattr(self.client, "client", self.client), "online_count", 0) or 0) if self.client else 0,
            "m17_rx_only": bool(getattr(getattr(self.client, "client", self.client), "rx_only", False)) if self.client else False,
            "m17_rx_can": int(getattr(getattr(self.client, "client", self.client), "current_rx_can", 0) or 0) if self.client else 0,
            "m17_rx_codec": str(getattr(getattr(self.client, "client", self.client), "current_rx_codec", "3200") or "3200") if self.client else "3200",
            "m17_rx_encrypted": bool(getattr(getattr(self.client, "client", self.client), "current_rx_encrypted", False)) if self.client else False,
            "dstar_host": getattr(self.config, "dstar_host", "") or "",
            "dstar_port": int(getattr(self.config, "dstar_port", 30001) or 30001),
            "dstar_reflector": getattr(self.config, "dstar_reflector", "XLX250") or "XLX250",
            "dstar_reflector_name": getattr(self.config, "dstar_reflector_name", "") or "",
            "dstar_protocol": getattr(self.config, "dstar_protocol", "auto") or "auto",
            "dstar_module": getattr(self.config, "dstar_module", "D") or "D",
            "dstar_local_module": getattr(self.config, "dstar_local_module", "D") or "D",
            "dstar_my2": getattr(self.config, "dstar_my2", "PROX") or "PROX",
            "dstar_urcall": getattr(self.config, "dstar_urcall", "CQCQCQ  ") or "CQCQCQ  ",
            "dstar_text": getattr(self.config, "dstar_text", "") or "",
            "dstar_room_modules": dict(getattr(self.config, "dstar_room_modules", {}) or {}),
            "dstar_online_count": int(getattr(getattr(self.client, "client", self.client), "online_count", 0) or 0) if self.client else 0,
            "dstar_rx_only": bool(getattr(getattr(self.client, "client", self.client), "rx_only", False)) if self.client else bool(getattr(self.config, "dstar_rx_only", False)),
            "dstar_server_ro": bool(getattr(getattr(self.client, "client", self.client), "server_ro", False)) if self.client else False,
            "dstar_rx_my2": str(getattr(getattr(self.client, "client", self.client), "current_rx_my2", "") or "") if self.client else "",
            "dstar_rx_urcall": str(getattr(getattr(self.client, "client", self.client), "current_rx_urcall", "") or "") if self.client else "",
            "dstar_rx_text": str(getattr(getattr(self.client, "client", self.client), "current_rx_text", "") or "") if self.client else "",
            "svx_host": getattr(self.config, "svx_host", "") or "",
            "svx_port": int(getattr(self.config, "svx_port", 5300) or 5300),
            "svx_auth_key": getattr(self.config, "svx_auth_key", "") or "",
            "svx_server_name": getattr(self.config, "svx_server_name", "") or "",
            "svx_status_url": getattr(self.config, "svx_status_url", "") or "",
            "svx_tg": int(getattr(getattr(self.client, "client", self.client), "selected_tg", getattr(self.config, "svx_tg", 1)) or 0) if self.client else int(getattr(self.config, "svx_tg", 1) or 1),
            "svx_monitor_tgs": list(getattr(getattr(self.client, "client", self.client), "monitor_tgs", getattr(self.config, "svx_monitor_tgs", [1, 250])) or [1, 250]) if self.client else list(getattr(self.config, "svx_monitor_tgs", [1, 250]) or [1, 250]),
            "svx_proto_ver": int(getattr(getattr(self.client, "client", self.client), "proto_major", getattr(self.config, "svx_proto_ver", 2)) or 2) if self.client else int(getattr(self.config, "svx_proto_ver", 2) or 2),
            "svx_codec": str(getattr(getattr(self.client, "client", self.client), "codec_pref", getattr(self.config, "svx_codec", "OPUS")) or "OPUS") if self.client else str(getattr(self.config, "svx_codec", "OPUS") or "OPUS"),
            "svx_tg_timeout": int(getattr(self.config, "svx_tg_timeout", 0) or 0),
            "svx_node_info": getattr(self.config, "svx_node_info", "") or "",
            "svx_rx_only": bool(getattr(getattr(self.client, "client", self.client), "rx_only", False)) if self.client else bool(getattr(self.config, "svx_rx_only", False)),
            "svx_online_count": len(getattr(getattr(self.client, "client", self.client), "connected_nodes", [])) if self.client else 0,
            "svx_connected_nodes_count": len(getattr(getattr(self.client, "client", self.client), "connected_nodes", [])) if self.client else 0,
            "svx_active_tg": int(getattr(getattr(self.client, "client", self.client), "current_rx_tg", 0) or 0) if self.client else 0,
            "svx_current_talker": str(getattr(getattr(self.client, "client", self.client), "current_rx_talker", "") or "") if self.client else "",
            "backend_buffer_ms": getattr(self, "backend_buffer_ms", 0),
            "duplex": self.config.duplex,
            "default_tg_ts1": self.config.default_tg_ts1,
            "default_tg_ts2": self.config.default_tg_ts2,
            "autoconnect": self.config.autoconnect,
            "bm_api_key": self.config.bm_api_key,
            "talker_alias": self.config.talker_alias,
            "send_talker_alias": getattr(self.config, "send_talker_alias", True),
            "status": self.status.value,
            "detail": self.detail,
            "failed_cycles": getattr(self.client, "failed_cycles", 0) if self.client else 0,
            "collapsed": getattr(self.config, "collapsed", False),
            "hidden": getattr(self.config, "hidden", False),
            "auto_tg_bm": getattr(self.config, "auto_tg_bm", True),
            "auto_record": getattr(self.config, "auto_record", False),
            "ts1": self.ts1.to_dict(),
            "ts2": self.ts2.to_dict(),
        }

@dataclass
class UserTxState:
    active: bool = False
    is_releasing: bool = False
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
    dst_name: str = ""
    city: str = ""
    country: str = ""
    duration: float = 0.0
    active: bool = True
    is_tx: bool = False
    transcription: str = ""
    transcription_lang: str = ""
    user_id: int = 1
    network_type: str = ""
    source_type: str = ""

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
            "dst_name": self.dst_name,
            "city": self.city,
            "country": self.country,
            "call_type": self.call_type,
            "duration": round(self.duration, 1),
            "active": self.active,
            "is_tx": self.is_tx,
            "transcription": self.transcription,
            "transcription_lang": self.transcription_lang,
            "user_id": self.user_id,
            "network_type": self.network_type,
            "source_type": self.source_type,
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
        self.recorder = ServerAudioRecorder(
            broadcast_fn=self.broadcast_fn,
            rx_agc_config_resolver=self.get_hotspot_rx_agc_config,
        )
        cs = getattr(self.settings, "client_settings", {}) or {}
        if cs:
            self.recorder.apply_settings(cs, user_id=1)
        rec_s = getattr(self.settings, "recordings_settings", {}) or {}
        if rec_s:
            self.recorder.apply_settings(rec_s, user_id=1)

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
            cutoff = (now - CALL_HISTORY_RETENTION_SEC) if CALL_HISTORY_RETENTION_SEC > 0 else 0.0
            loaded = []
            for item in data:
                ts = float(item.get("timestamp", 0.0))
                dur = float(item.get("duration", 0.0))
                if (cutoff <= 0.0 or ts >= cutoff) and (dur >= 0.5 or bool(item.get("transcription"))):
                    raw_id = item.get("id") or f"{int(ts*1000)}_{item.get('src_id', 0)}_{item.get('slot', 1)}"
                    inferred_net = item.get("network_type", "") or ("m17" if str(raw_id).startswith("m17_") else ("ysf" if str(raw_id).startswith("ysf_") else ("allstar" if str(raw_id).startswith("asl_") else "")))
                    entry = CallLogEntry(
                        id=raw_id,
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
                        transcription_lang=item.get("transcription_lang", ""),
                        dst_name=item.get("dst_name", ""),
                        city=item.get("city", ""),
                        country=item.get("country", ""),
                        network_type=inferred_net,
                        source_type=item.get("source_type", "")
                    )
                    loaded.append(entry)
            loaded.sort(key=lambda x: x.timestamp, reverse=True)
            self.user_call_history[uid] = loaded[:CALL_HISTORY_MAX_ENTRIES]
            logger.info(f"[MANAGER] Loaded {len(self.user_call_history[uid])} call history records for user {uid} (unlimited time retention)")
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
            cutoff = (time.time() - CALL_HISTORY_RETENTION_SEC) if CALL_HISTORY_RETENTION_SEC > 0 else 0.0
            history = self.user_call_history.get(uid, [])
            records = [
                e.to_dict() for e in history
                if (cutoff <= 0.0 or e.timestamp >= cutoff) and (e.active or e.duration >= 0.5 or bool(e.transcription))
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
        cutoff = (time.time() - max_age_sec) if (max_age_sec and max_age_sec > 0) else 0.0
        history = self.user_call_history.get(uid, [])
        orig_len = len(history)
        history = [
            c for c in history
            if (cutoff <= 0.0 or c.timestamp >= cutoff) and (c.active or c.duration >= 0.5 or bool(c.transcription))
        ]
        if len(history) > CALL_HISTORY_MAX_ENTRIES:
            history = history[:CALL_HISTORY_MAX_ENTRIES]
        self.user_call_history[uid] = history
        if len(history) != orig_len:
            self._history_dirty.add(uid)
            logger.debug(f"[MANAGER] Pruned {orig_len - len(history)} stale/excess call history entries for user {uid}")

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
                if getattr(hs_cfg, "hidden", False) and rt.client:
                    asyncio.create_task(rt.client.disconnect(is_retry=False))
                if (getattr(hs_cfg, "network_type", "") or "").lower() == "allstar" and bool(getattr(hs_cfg, "allstar_always_online", True)):
                    try:
                        from asl_container_manager import asl_container_mgr
                        callsign = getattr(hs_cfg, "callsign", "N0CALL")
                        password = getattr(hs_cfg, "bm_password", "")
                        node_str = str(getattr(hs_cfg, "allstar_node", "1999") or "1999").strip()
                        loop = asyncio.get_running_loop()
                        loop.run_in_executor(None, asl_container_mgr.start_instance, str(user_id), node_str, password, callsign)
                    except Exception as e:
                        logger.warning(f"[MANAGER] Error ensuring ASL container started for user {user_id}: {e}")
            else:
                rt = self._init_runtime(hs_cfg, user_id=user_id)
                net_l = (getattr(rt.config, "network_type", "bm") or "bm").lower()
                ysf_ready = (net_l == "ysf") and bool(getattr(rt.config, "ysf_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", ""))
                m17_ready = (net_l == "m17") and bool(getattr(rt.config, "m17_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "m17_reflector", ""))
                dstar_ready = (net_l == "dstar") and bool(getattr(rt.config, "dstar_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "dstar_reflector", ""))
                svx_ready = (net_l == "svx") and bool(getattr(rt.config, "svx_host", "") or getattr(rt.config, "bm_master_host", ""))
                if not getattr(rt.config, "collapsed", False) and not getattr(rt.config, "hidden", False) and (net_l == "allstar" or ysf_ready or m17_ready or dstar_ready or svx_ready or (rt.config.dmr_id > 0 and rt.config.bm_password)):
                    asyncio.create_task(self.connect_hotspot(hs_cfg.id, user_id=user_id))

        for hid in list(user_map.keys()):
            if hid not in configured_ids:
                old_rt = user_map.pop(hid, None)
                if old_rt and old_rt.client:
                    try:
                        await old_rt.client.disconnect()
                    except Exception:
                        pass

        # Rebuild user_map in the exact order of new_settings.hotspots
        new_map = {}
        for hs_cfg in new_settings.hotspots:
            if hs_cfg.id in user_map:
                new_map[hs_cfg.id] = user_map[hs_cfg.id]
        for hid, rt in user_map.items():
            if hid not in new_map:
                new_map[hid] = rt
        self.user_runtimes[user_id] = new_map

        active_hid = getattr(new_settings, "active_hotspot_id", None)
        for rt in new_map.values():
            if not getattr(rt.config, "hidden", False) and (not getattr(rt.config, "collapsed", False) or rt.config.id == active_hid):
                self._trigger_adn_sync_for_runtime(rt)

        self.apply_client_settings_to_runtimes(getattr(new_settings, "client_settings", {}) or {}, user_id=user_id)
        rec_s = getattr(new_settings, "recordings_settings", {}) or {}
        if rec_s and hasattr(self, "recorder") and self.recorder:
            self.recorder.apply_settings(rec_s)

    async def switch_user(self, user_id: int, new_settings: AppSettings):
        """Switch active user reference (used for single-tenant / CLI fallback). Keeps other users alive!"""
        self.active_user_id = user_id
        self.settings = new_settings
        await self.ensure_user_runtimes(user_id, new_settings)

    @staticmethod
    def _extract_rx_agc_profile(client_settings: dict, is_asl: bool) -> Optional[dict]:
        """Resolve AudioRX AGC profile (agcEnable, agcDepth, agcGain, limiterEnable) from client_settings."""
        if not isinstance(client_settings, dict):
            return None
        key = "asl_audio_rx" if is_asl else "audio_rx"
        arx = client_settings.get(key)
        if not isinstance(arx, dict):
            return None
        def_depth = 16.0 if is_asl else 18.0
        def_gain = 25.0 if is_asl else 35.0
        active_pid = str(arx.get("active_preset") or "1")
        presets = arx.get("presets") if isinstance(arx.get("presets"), dict) else {}
        preset = presets.get(active_pid) if isinstance(presets.get(active_pid), dict) else {}

        if "agcEnable" in preset:
            enabled = bool(preset["agcEnable"])
        elif "agc_enabled" in arx:
            enabled = bool(arx["agc_enabled"])
        else:
            enabled = True

        try:
            raw_depth = preset.get("agcDepth")
            depth_db = max(6.0, min(30.0, float(raw_depth if raw_depth is not None else def_depth)))
        except (TypeError, ValueError):
            depth_db = def_depth

        try:
            raw_gain = preset.get("agcGain")
            gain_raw = max(10.0, min(120.0, float(raw_gain if raw_gain is not None else def_gain)))
        except (TypeError, ValueError):
            gain_raw = def_gain

        limiter_enabled = bool(preset.get("limiterEnable", True))
        return {
            "enabled": enabled,
            "depth_db": depth_db,
            "gain_raw": gain_raw,
            "limiter_enabled": limiter_enabled,
        }

    def get_hotspot_rx_agc_config(self, user_id: int, hotspot_id: str) -> dict:
        """Return effective AudioRX AGC parameters for the given user's hotspot."""
        rt = self.get_runtime(user_id, hotspot_id)
        if rt is not None and isinstance(getattr(rt, "rx_agc_profile", None), dict):
            return rt.rx_agc_profile
        is_asl = "allstar" in str(hotspot_id or "").lower()
        user_sett = self.user_settings.get(user_id, self.settings)
        cs = getattr(user_sett, "client_settings", {}) or {}
        prof = self._extract_rx_agc_profile(cs, is_asl)
        if prof is not None:
            return prof
        return {
            "enabled": True,
            "depth_db": 16.0 if is_asl else 18.0,
            "gain_raw": 25.0 if is_asl else 35.0,
            "limiter_enabled": True,
        }

    def apply_client_settings_to_runtimes(self, client_settings: dict, user_id: Optional[int] = None) -> None:
        """Apply Audio RX (AGC) and ambe+ RX (Vocoder) settings from client_settings to runtimes."""
        if not client_settings or not isinstance(client_settings, dict):
            return
        if user_id is not None and user_id in self.user_settings:
            us = self.user_settings[user_id]
            if not hasattr(us, "client_settings") or us.client_settings is None:
                us.client_settings = {}
            if us.client_settings is not client_settings:
                us.client_settings.update(client_settings)
        target_runtimes = list(self.get_user_runtimes(user_id).values()) if user_id is not None else [
            rt for hs_map in self.user_runtimes.values() for rt in hs_map.values()
        ]
        arx = client_settings.get("audio_rx", {})
        if arx and isinstance(arx, dict):
            if "backend_buffer_ms" in arx:
                self.set_backend_buffer_ms(int(arx["backend_buffer_ms"]), user_id=user_id)
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
        atx_dmr = client_settings.get("audio_tx", {})
        atx_asl = client_settings.get("asl_audio_tx", {})
        rx_prof_dmr = self._extract_rx_agc_profile(client_settings, is_asl=False)
        rx_prof_asl = self._extract_rx_agc_profile(client_settings, is_asl=True)
        for rt in target_runtimes:
            is_asl = (getattr(rt.config, "network_type", "bm") or "").lower() == "allstar" or bool(getattr(rt, "allstar_client", None))
            rx_prof = rx_prof_asl if is_asl else rx_prof_dmr
            if rx_prof is not None:
                rt.rx_agc_profile = dict(rx_prof)
            atx = atx_asl if (is_asl and atx_asl) else atx_dmr
            if atx and isinstance(atx, dict) and hasattr(rt, "tx_dsp"):
                rt.tx_dsp.set_settings(
                    hpf_enabled=bool(atx["hpf_enabled"]) if "hpf_enabled" in atx else None,
                    presence_boost=float(atx["presence_boost"]) if "presence_boost" in atx else None,
                    eq_low=float(atx["eq_low"]) if "eq_low" in atx else None,
                    eq_mid=float(atx["eq_mid"]) if "eq_mid" in atx else None,
                    eq_high=float(atx["eq_high"]) if "eq_high" in atx else None,
                    mic_gain=float(atx["mic_gain"]) if "mic_gain" in atx else None,
                    dsp_agc=bool(atx["dsp_agc"]) if "dsp_agc" in atx else None,
                )
        ambe_rx = client_settings.get("ambe_rx", {})
        if ambe_rx and isinstance(ambe_rx, dict):
            self.set_vocoder_settings(
                spectral_enh=ambe_rx.get("spectral_enh"),
                high_band_gain_db=ambe_rx.get("high_band_gain_db"),
                unvoiced_gain_db=ambe_rx.get("unvoiced_gain_db"),
                user_id=user_id,
            )
        if hasattr(self, "recorder") and self.recorder:
            self.recorder.apply_settings(client_settings, user_id=user_id)

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
            if getattr(rt, "vocoder", None):
                try:
                    rt.vocoder.close()
                except Exception:
                    pass
            if getattr(rt, "tx_encoder", None):
                try:
                    rt.tx_encoder.close()
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

            # Extract spoken personal callsign for AllStarLink calls (e.g. from repeater WW7PSR, operator says <call>K7ABC</call>)
            if target_call.network_type == "allstar" and clean_text:
                import re
                m_call = re.search(
                    r'<call>((?:[A-Za-z0-9]{1,3}/)?(?:[A-Za-z]{1,2}\d{1,4}[A-Za-z]{1,4}|\d[A-Za-z]{1,2}\d{1,4}[A-Za-z]{1,4})(?:/[A-Za-z0-9]{1,4})?)</call>',
                    clean_text,
                )
                if m_call:
                    spoken_cs = m_call.group(1).upper().strip()
                    src_cs = (target_call.src_callsign or "").upper().strip()
                    rt_owner = self.get_runtime(uid, target_call.hotspot_id)
                    own_cs = (getattr(rt_owner.config, "callsign", "") if rt_owner else "").upper().strip()
                    if spoken_cs != src_cs and (target_call.is_local_tx or spoken_cs != own_cs):
                        old_alias = target_call.talker_alias or ""
                        if f"🎙️ {spoken_cs}" not in old_alias:
                            target_call.talker_alias = f"🎙️ {spoken_cs} · {src_cs}" if src_cs else f"🎙️ {spoken_cs}"
                            flag = getattr(target_call, "flag", "🌐") or "🌐"
                            self._notify_async({
                                "type": "caller_resolved",
                                "call_id": target_call.id,
                                "src_id": target_call.src_id,
                                "src_callsign": target_call.src_callsign,
                                "talker_alias": target_call.talker_alias,
                                "caller_display": f"{flag} {spoken_cs} · {src_cs}" if src_cs else f"{flag} {spoken_cs}",
                                "user_id": uid,
                            }, user_id=uid)

            self._save_calls_history(uid)
            logger.info(
                f"[MANAGER] Saved transcription to CallLog [{target_call.id}] "
                f"({target_call.src_callsign or target_call.src_id}, user {uid}): {clean_text[:60]}"
            )
        elif call_id or created_at:
            # If not in call_history (e.g. was purged or recorded earlier), add a CallLogEntry so it appears in history upon reload
            now_ts = created_at or time.time()
            resolved_id = call_id or f"{int(now_ts * 1000)}_{src_id}_{slot}"
            inferred_net = "m17" if str(resolved_id).startswith("m17_") else ("ysf" if str(resolved_id).startswith("ysf_") else ("allstar" if str(resolved_id).startswith("asl_") else ""))
            entry = CallLogEntry(
                id=resolved_id,
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
                transcription_lang=lang or "",
                network_type=inferred_net
            )
            call_history.append(entry)
            call_history.sort(key=lambda x: x.timestamp, reverse=True)
            self._save_calls_history(uid)
            logger.info(
                f"[MANAGER] Created and saved new CallLogEntry [{entry.id}] from transcription: {clean_text[:60]}"
            )

    def _init_runtime(self, cfg: HotspotConfig, user_id: int = 1) -> HotspotRuntime:
        net_lower = (getattr(cfg, "network_type", "bm") or "bm").lower()
        if net_lower == "tgif" and (cfg.bm_master_host or "").strip().lower() == "eu.tgif.network":
            cfg.bm_master_host = "tgif.network"
            try:
                user_sett = self.user_settings.get(user_id, self.settings)
                if user_id == 1:
                    save_app_settings(user_sett)
            except Exception:
                pass
        elif net_lower == "freedmr":
            cur_host = (cfg.bm_master_host or "").strip().lower()
            if cur_host in DEAD_FREEDMR_HOSTS:
                logger.warning(
                    f"[HOTSPOT] Auto-migrated dead FreeDMR host '{cfg.bm_master_host}' to {DEFAULT_LIVE_FREEDMR_HOST}"
                )
                cfg.bm_master_host = DEFAULT_LIVE_FREEDMR_HOST
                try:
                    user_sett = self.user_settings.get(user_id, self.settings)
                    if user_id == 1:
                        save_app_settings(user_sett)
                except Exception:
                    pass
        runtime = HotspotRuntime(config=cfg, user_id=user_id)

        net_type = (getattr(cfg, "network_type", "bm") or "bm").lower()
        if net_type == "allstar":
            from allstar_engine import AllStarClient, AllStarClientAdapter
            node_num = str(getattr(cfg, "allstar_node", "1999") or "1999").strip()
            # Автоматически строим hostname локального ASL-контейнера по формуле
            # asl_{user_id}_{node} — идентично asl_container_manager._container_name().
            # Поля bm_master_host/bm_master_port из UI игнорируются для AllStar:
            # пользователю достаточно ввести только номер ноды и пароль.
            _uid_clean = "".join(c for c in str(user_id) if c.isalnum() or c in ("-", "_"))
            _node_clean = "".join(c for c in node_num if c.isdigit())
            host = f"asl_{_uid_clean}_{_node_clean}"
            port = 4569
            password = cfg.bm_password or ""
            callsign = cfg.callsign or "N0CALL"
            asl_client = AllStarClient(
                host=host,
                port=port,
                node=node_num,
                username="proxdmr",
                password="proxdmr_secret_iax",
                callsign=callsign,
                context="iaxrpt",
                asl_password=password
            )
            runtime.allstar_client = asl_client
            runtime.client = AllStarClientAdapter(asl_client, cfg.id, user_id, self)
        elif net_type == "ysf":
            from src.dmr.ysf_client import YSFClient, YSFClientAdapter
            from src.dmr.ysf_directory import ysf_dir_mgr, resolve_ysf_room_dg_id_settings, classify_ysf_reflector
            room_id = str(getattr(cfg, "ysf_room_id", None) or getattr(cfg, "ysf_room", None) or "").strip()
            ysf_host = str(getattr(cfg, "ysf_host", "") or cfg.bm_master_host or "").strip()
            ysf_port = int(getattr(cfg, "ysf_port", 42000) or getattr(cfg, "bm_master_port", 42000) or 42000)

            found_room = ysf_dir_mgr.get_room_by_id(room_id) if room_id else None
            # Sanitize host: never accept numeric room ID as host or dummy fallback
            if not ysf_host or ysf_host.isdigit() or ysf_host == "ysf.brandmeister.ru":
                if found_room and found_room.get("host"):
                    ysf_host = str(found_room.get("host")).strip()
                    ysf_port = int(found_room.get("port", 42000))
                else:
                    ysf_host = ""

            user_room_types = (getattr(self, "user_ysf_room_types", None) or {}).get(user_id, {}) or {}
            room_override = str(user_room_types.get(room_id) or "").strip().lower()
            rx_dg_id, tx_dg_id, is_multiroom, mr_kind = resolve_ysf_room_dg_id_settings(
                cfg, room_id, found_room, room_type_override=room_override
            )
            cls_info = classify_ysf_reflector(
                room=found_room,
                name=str(getattr(cfg, "ysf_room_name", "") or getattr(cfg, "ysf_name", "") or ""),
                host=ysf_host,
                room_id=room_id,
                override=room_override,
            )
            cfg.ysf_dg_id = rx_dg_id
            cfg.ysf_tx_dg_id = tx_dg_id

            callsign = cfg.callsign or "N0CALL"
            ysf_desc = getattr(cfg, "description", "") or getattr(cfg, "talker_alias", "") or ""
            ysf_loc = getattr(cfg, "qth_locator", "") or getattr(cfg, "locator", "") or "KO85VU"
            room_name = getattr(cfg, "ysf_room_name", "") or getattr(cfg, "ysf_name", "") or getattr(cfg, "name", "")
            ysf_client = YSFClient(
                host=ysf_host,
                port=ysf_port,
                callsign=callsign,
                room_id=room_id,
                room_name=room_name,
                description=ysf_desc,
                qth_locator=ysf_loc,
                vocoder=runtime.vocoder,
                tx_encoder=runtime.tx_encoder,
                dg_id=rx_dg_id,
                tx_dg_id=tx_dg_id,
                is_multiroom=is_multiroom,
                reflector_type=cls_info["reflector_type"],
                multiroom_kind=mr_kind,
                room_type_override=room_override,
                user_id=user_id,
            )
            runtime.client = YSFClientAdapter(ysf_client, cfg.id, user_id, self)
        elif net_type == "m17":
            from dmr.m17_client import M17Client, M17ClientAdapter
            from dmr.m17_directory import m17_dir_mgr
            is_swl = False
            try:
                from database import get_user_by_id_sync
                u_row = get_user_by_id_sync(user_id)
                if u_row and str(u_row.get("role", "")).lower() == "swl":
                    is_swl = True
            except Exception:
                is_swl = False

            m17_ref = str(getattr(cfg, "m17_reflector", "") or "").strip().upper()[:8]
            m17_host = str(getattr(cfg, "m17_host", "") or "").strip()
            m17_port = int(getattr(cfg, "m17_port", 17000) or 17000)
            m17_mod = str(getattr(cfg, "m17_module", "C") or "C").strip().upper()[:1] or "C"
            m17_srv_type = str(getattr(cfg, "m17_server_type", "mrefd") or "mrefd").strip().lower()
            m17_ref_name = str(getattr(cfg, "m17_reflector_name", "") or "").strip()

            found_m17 = m17_dir_mgr.find_host(m17_ref or m17_host)
            if found_m17:
                if not m17_host:
                    m17_host = str(found_m17.get("host") or "").strip()
                    m17_port = int(found_m17.get("port") or 17000)
                if not m17_ref:
                    m17_ref = str(found_m17.get("designator") or "").strip().upper()
                if not m17_ref_name:
                    m17_ref_name = str(found_m17.get("name") or m17_ref).strip()
                m17_srv_type = str(found_m17.get("server_type") or m17_srv_type).strip().lower()

            link_mode = "lstn" if is_swl else (str(getattr(cfg, "m17_link_mode", "conn") or "conn").strip().lower())
            if link_mode not in ("conn", "lstn"):
                link_mode = "conn"
            rx_only = bool(is_swl or link_mode == "lstn")

            m17_client = M17Client(
                host=m17_host,
                port=m17_port,
                callsign=cfg.callsign or "N0CALL",
                suffix=getattr(cfg, "m17_callsign_suffix", "D"),
                reflector=m17_ref,
                reflector_name=m17_ref_name,
                module=m17_mod,
                can=int(getattr(cfg, "m17_can", 0) or 0),
                link_mode=link_mode,
                codec_mode=str(getattr(cfg, "m17_codec_mode", "3200") or "3200"),
                dst_mode=str(getattr(cfg, "m17_dst_mode", "reflector") or "reflector"),
                meta_text=str(getattr(cfg, "m17_meta_text", "") or ""),
                server_type=m17_srv_type,
                rx_only=rx_only,
                user_id=user_id,
            )
            runtime.client = M17ClientAdapter(self, cfg.id, m17_client, user_id=user_id)
        elif net_type == "dstar":
            from dmr.dstar_client import DStarClientAdapter
            from dmr.dstar_directory import dstar_dir_mgr

            dstar_ref = str(getattr(cfg, "dstar_reflector", "") or "").strip().upper()
            dstar_host = str(getattr(cfg, "dstar_host", "") or "").strip()
            dstar_port = int(getattr(cfg, "dstar_port", 30001) or 30001)
            dstar_ref_name = str(getattr(cfg, "dstar_reflector_name", "") or "").strip()

            found_dstar = dstar_dir_mgr.find_host(dstar_ref or dstar_host)
            if found_dstar:
                if not dstar_host:
                    dstar_host = str(found_dstar.get("host") or "").strip()
                    dstar_port = int(found_dstar.get("port") or 30001)
                if not dstar_ref:
                    dstar_ref = str(found_dstar.get("designator") or "").strip().upper()
                if not dstar_ref_name:
                    dstar_ref_name = str(found_dstar.get("name") or dstar_ref).strip()

            runtime.client = DStarClientAdapter(self, cfg.id, cfg, user_id=user_id)
        elif net_type == "svx":
            from dmr.svx_client import SVXClientAdapter
            from dmr.svx_directory import svx_dir_mgr

            svx_host = str(getattr(cfg, "svx_host", "") or "").strip()
            svx_port = int(getattr(cfg, "svx_port", 5300) or 5300)
            svx_srv_name = str(getattr(cfg, "svx_server_name", "") or "").strip()

            found_svx = svx_dir_mgr.find_server(svx_srv_name or svx_host)
            if found_svx:
                if not svx_host:
                    svx_host = str(found_svx.get("host") or "").strip()
                    svx_port = int(found_svx.get("port") or 5300)
                if not svx_srv_name:
                    svx_srv_name = str(found_svx.get("name") or svx_host).strip()

            runtime.client = SVXClientAdapter(self, cfg.id, cfg, user_id=user_id)
        else:
            def make_status_cb(hid: str, uid: int):
                def _status_cb(state: BMState, detail: str):
                    self._on_client_status(hid, state, detail, user_id=uid)
                return _status_cb

            def make_frame_cb(hid: str, uid: int):
                def _frame_cb(frame: DMRFrame):
                    self._on_dmr_frame(hid, frame, user_id=uid)
                return _frame_cb

            def make_creds_valid_cb(hid: str, uid: int):
                def _creds_valid_cb() -> bool:
                    return self._are_bm_credentials_known_valid(hid, user_id=uid)
                return _creds_valid_cb

            def make_failover_cands_cb(hid: str, uid: int):
                def _failover_cands_cb(exclude_host: str, limit: int = 15) -> list:
                    return self._get_bm_failover_candidates(exclude_host, limit=limit)
                return _failover_cands_cb

            def make_failover_event_cb(hid: str, uid: int):
                def _failover_event_cb(payload: dict):
                    self._on_bm_failover_event(hid, payload, user_id=uid)
                return _failover_event_cb

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
                network_type=net_type,
                rpto_options=getattr(cfg, "rpto_options", "") or "",
                xlx_module=getattr(cfg, "xlx_module", "D") or "D",
                on_status_change=make_status_cb(cfg.id, user_id),
                on_dmr_frame=make_frame_cb(cfg.id, user_id),
                check_credentials_valid_cb=make_creds_valid_cb(cfg.id, user_id),
                get_failover_candidates_cb=make_failover_cands_cb(cfg.id, user_id),
                on_failover_event_cb=make_failover_event_cb(cfg.id, user_id),
                user_id=user_id,
            )
            runtime.client = client

        # Apply current AGC and vocoder settings from user_settings or self.settings.client_settings
        user_sett = self.user_settings.get(user_id, self.settings)
        cs = getattr(user_sett, "client_settings", {}) or {}
        is_asl_rt = (net_type == "allstar")
        init_rx_prof = self._extract_rx_agc_profile(cs, is_asl=is_asl_rt)
        if init_rx_prof is not None:
            runtime.rx_agc_profile = init_rx_prof
        else:
            runtime.rx_agc_profile = {
                "enabled": True,
                "depth_db": 16.0 if is_asl_rt else 18.0,
                "gain_raw": 25.0 if is_asl_rt else 35.0,
                "limiter_enabled": True,
            }
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
        atx = cs.get("asl_audio_tx", {}) if net_type == "allstar" else cs.get("audio_tx", {})
        if atx and isinstance(atx, dict):
            runtime.tx_dsp.set_settings(
                hpf_enabled=bool(atx["hpf_enabled"]) if "hpf_enabled" in atx else None,
                presence_boost=float(atx["presence_boost"]) if "presence_boost" in atx else None,
                eq_low=float(atx["eq_low"]) if "eq_low" in atx else None,
                eq_mid=float(atx["eq_mid"]) if "eq_mid" in atx else None,
                eq_high=float(atx["eq_high"]) if "eq_high" in atx else None,
                mic_gain=float(atx["mic_gain"]) if "mic_gain" in atx else None,
                dsp_agc=bool(atx["dsp_agc"]) if "dsp_agc" in atx else None,
            )
        elif net_type == "allstar":
            runtime.tx_dsp.set_settings(
                hpf_enabled=True,
                presence_boost=0.0,
                eq_low=0.0,
                eq_mid=0.0,
                eq_high=0.0,
                mic_gain=0.0,
                dsp_agc=True,
            )
        vrx = cs.get("ambe_rx", {})
        if vrx and isinstance(vrx, dict) and hasattr(runtime, "vocoder") and hasattr(runtime.vocoder, "set_settings"):
            hb = vrx.get("high_band_gain_db")
            uv = vrx.get("unvoiced_gain_db")
            runtime.vocoder.set_settings(
                spectral_enh=bool(vrx.get("spectral_enh", True)),
                high_band_gain_db=float(hb if hb is not None else 0.5),
                unvoiced_gain_db=float(uv if uv is not None else -1.5)
            )

        if user_id not in self.user_runtimes:
            self.user_runtimes[user_id] = {}
        self.user_runtimes[user_id][cfg.id] = runtime
        return runtime

    async def start(self):
        total_instances = sum(len(m) for m in self.user_runtimes.values())
        logger.info(f"[MANAGER] Starting HotspotManager with {total_instances} instances across {len(self.user_runtimes)} users...")
        self.timeout_watcher_task = asyncio.create_task(self._slot_timeout_loop())

        # Ensure ASL core containers are started for allstar_always_online=True hotspots
        for uid, hs_dict in self.user_runtimes.items():
            for hid, rt in hs_dict.items():
                if (getattr(rt.config, "network_type", "") or "").lower() == "allstar" and bool(getattr(rt.config, "allstar_always_online", True)):
                    try:
                        from asl_container_manager import asl_container_mgr
                        callsign = getattr(rt.config, "callsign", "N0CALL")
                        password = getattr(rt.config, "bm_password", "")
                        node_str = str(getattr(rt.config, "allstar_node", "1999") or "1999").strip()
                        loop = asyncio.get_running_loop()
                        loop.run_in_executor(None, asl_container_mgr.start_instance, str(uid), node_str, password, callsign)
                    except Exception as e:
                        logger.warning(f"[MANAGER] Error ensuring ASL container started on startup: {e}")

        # Autoconnect configured instances (only if not collapsed and not hidden) across all user runtimes
        for uid, hs_dict in self.user_runtimes.items():
            for hid, rt in hs_dict.items():
                net_l = (getattr(rt.config, "network_type", "bm") or "bm").lower()
                ysf_ready = (net_l == "ysf") and bool(getattr(rt.config, "ysf_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", ""))
                m17_ready = (net_l == "m17") and bool(getattr(rt.config, "m17_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "m17_reflector", ""))
                dstar_ready = (net_l == "dstar") and bool(getattr(rt.config, "dstar_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "dstar_reflector", ""))
                svx_ready = (net_l == "svx") and bool(getattr(rt.config, "svx_host", "") or getattr(rt.config, "bm_master_host", ""))
                if not getattr(rt.config, "collapsed", False) and not getattr(rt.config, "hidden", False) and (net_l == "allstar" or ysf_ready or m17_ready or dstar_ready or svx_ready or (rt.config.dmr_id > 0 and rt.config.bm_password)):
                    self._trigger_adn_sync_for_runtime(rt)
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
                    try:
                        if hasattr(rt.client, "disconnect"):
                            await rt.client.disconnect(force_stop_container=True)
                        else:
                            await rt.client.disconnect()
                    except TypeError:
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

    def _trigger_adn_sync_for_runtime(self, rt: Optional[HotspotRuntime]) -> None:
        """Checks 24h staleness for ADN/DMR+ directories whenever a hotspot of that network is entered."""
        if not rt or not getattr(rt, "config", None):
            return
        net_l = (getattr(rt.config, "network_type", "") or "").strip().lower()
        try:
            if net_l == "adn":
                adn_hosts_mgr.ensure_fresh_background()
                tg_resolver.ensure_adn_fresh_background()
            elif net_l == "dmrplus":
                dmrplus_hosts_mgr.ensure_fresh_background()
        except Exception as e:
            logger.debug(f"[MANAGER] Network directory sync check note ({net_l}): {e}")

    def set_active_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        if hotspot_id in hs_map:
            settings = self.user_settings.get(uid, self.settings)
            settings.active_hotspot_id = hotspot_id
            if uid == 1:
                save_app_settings(settings)
            self._trigger_adn_sync_for_runtime(hs_map[hotspot_id])
            self._notify_async({
                "type": "active_hotspot_changed",
                "active_hotspot_id": hotspot_id,
                "hotspot": hs_map[hotspot_id].to_dict(),
                "user_id": uid,
            }, user_id=uid)
            return True
        return False

    async def connect_hotspot(self, hotspot_id: str, user_id: Optional[int] = None, persist: bool = True, force: bool = False) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt or not rt.client:
            return False
        hotspot_id = rt.config.id
        self._trigger_adn_sync_for_runtime(rt)
        if rt.client.is_connected:
            return True
        net_l = (getattr(rt.config, "network_type", "bm") or "bm").lower()
        if net_l == "ysf":
            ysf_target = str(
                getattr(rt.config, "ysf_host", "")
                or getattr(rt.config, "bm_master_host", "")
                or getattr(rt.config, "ysf_room_id", "")
                or getattr(rt.config, "ysf_room", "")
                or ""
            ).strip()
            if not ysf_target:
                if hasattr(rt.client, "clear_target"):
                    rt.client.clear_target()
                logger.debug(f"[MANAGER] Skip connect_hotspot for YSF '{rt.config.name}' ({hotspot_id}): no active room/host (STANDBY)")
                return False
        elif net_l == "m17":
            m17_target = str(
                getattr(rt.config, "m17_host", "")
                or getattr(rt.config, "bm_master_host", "")
                or getattr(rt.config, "m17_reflector", "")
                or ""
            ).strip()
            if not m17_target:
                m17_inner = getattr(rt.client, "client", rt.client)
                if hasattr(m17_inner, "clear_target"):
                    m17_inner.clear_target()
                logger.debug(f"[MANAGER] Skip connect_hotspot for M17 '{rt.config.name}' ({hotspot_id}): no active reflector/host (STANDBY)")
                return False
        elif net_l == "dstar":
            dstar_target = str(
                getattr(rt.config, "dstar_host", "")
                or getattr(rt.config, "bm_master_host", "")
                or getattr(rt.config, "dstar_reflector", "")
                or ""
            ).strip()
            if not dstar_target:
                logger.debug(f"[MANAGER] Skip connect_hotspot for D-STAR '{rt.config.name}' ({hotspot_id}): no active reflector/host (STANDBY)")
                return False
        elif net_l == "svx":
            svx_target = str(
                getattr(rt.config, "svx_host", "")
                or getattr(rt.config, "bm_master_host", "")
                or ""
            ).strip()
            if not svx_target:
                logger.debug(f"[MANAGER] Skip connect_hotspot for SVX '{rt.config.name}' ({hotspot_id}): no active server/host (STANDBY)")
                return False
        if not force and getattr(rt.client, "_is_manual_disconnect", False):
            logger.debug(f"[MANAGER] Skip auto connect_hotspot for '{rt.config.name}' ({hotspot_id}): manual disconnect active")
            return False
        if rt.config.collapsed:
            rt.config.collapsed = False
            if persist:
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
        return await rt.client.connect(force=force)

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

    async def reconnect_hotspot(self, hotspot_id: str, user_id: Optional[int] = None, persist: bool = True) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt or not rt.client:
            return False
        hotspot_id = rt.config.id
        self._trigger_adn_sync_for_runtime(rt)
        logger.info(f"[MANAGER] Reconnecting hotspot '{rt.config.name}' (id={hotspot_id}, user={uid}) to BM...")
        if rt.config.collapsed:
            rt.config.collapsed = False
            if persist:
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
        if getattr(rt.config, "network_type", "") == "ysf" and hasattr(rt.client, "retarget"):
            from src.dmr.ysf_directory import ysf_dir_mgr, resolve_ysf_room_dg_id_settings, classify_ysf_reflector
            h = getattr(rt.config, "ysf_host", "") or getattr(rt.config, "bm_master_host", "")
            p = getattr(rt.config, "ysf_port", 42000) or getattr(rt.config, "bm_master_port", 42000)
            rid = str(getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", "") or "").strip()
            rname = getattr(rt.config, "ysf_room_name", "") or getattr(rt.config, "ysf_name", "")
            found = ysf_dir_mgr.get_room_by_id(rid)
            if not h or str(h).isdigit():
                if found and found.get("host"):
                    h = str(found.get("host")).strip()
                    p = int(found.get("port", 42000))
            user_room_types = (getattr(self, "user_ysf_room_types", None) or {}).get(uid, {}) or {}
            room_override = str(user_room_types.get(rid) or "").strip().lower()
            rx_dg_id, tx_dg_id, is_multiroom, mr_kind = resolve_ysf_room_dg_id_settings(
                rt.config, rid, found, room_type_override=room_override
            )
            cls_info = classify_ysf_reflector(room=found, name=rname, host=h, room_id=rid, override=room_override)
            rt.config.ysf_dg_id = rx_dg_id
            rt.config.ysf_tx_dg_id = tx_dg_id
            rt.client.retarget(
                h,
                p,
                rid,
                rname,
                dg_id=rx_dg_id,
                tx_dg_id=tx_dg_id,
                is_multiroom=is_multiroom,
                reflector_type=cls_info["reflector_type"],
                multiroom_kind=mr_kind,
                room_type_override=room_override,
            )
        elif (getattr(rt.config, "network_type", "") or "").lower() == "m17":
            m17_inner = getattr(rt.client, "client", rt.client)
            if hasattr(m17_inner, "retarget"):
                try:
                    from dmr.m17_directory import m17_dir_mgr
                except ImportError:
                    from src.dmr.m17_directory import m17_dir_mgr
                m_ref = str(getattr(rt.config, "m17_reflector", "") or "").strip().upper()[:8]
                m_host = str(getattr(rt.config, "m17_host", "") or "").strip()
                m_port = int(getattr(rt.config, "m17_port", 17000) or 17000)
                m_mod = str(getattr(rt.config, "m17_module", "C") or "C").strip().upper()[:1] or "C"
                m_srv = str(getattr(rt.config, "m17_server_type", "mrefd") or "mrefd").strip().lower()
                m_rname = str(getattr(rt.config, "m17_reflector_name", "") or "").strip()
                found_m = m17_dir_mgr.find_host(m_ref or m_host)
                if found_m:
                    if not m_host:
                        m_host = str(found_m.get("host") or "").strip()
                        m_port = int(found_m.get("port") or 17000)
                    if not m_ref:
                        m_ref = str(found_m.get("designator") or "").strip().upper()[:8]
                    if not m_rname:
                        m_rname = str(found_m.get("name") or m_ref).strip()
                    m_srv = str(found_m.get("server_type") or m_srv).strip().lower()
                m17_inner.retarget(
                    host=m_host,
                    port=m_port,
                    reflector=m_ref,
                    reflector_name=m_rname,
                    module=m_mod,
                    server_type=m_srv,
                    link_mode=getattr(rt.config, "m17_link_mode", "conn"),
                    can=int(getattr(rt.config, "m17_can", 0) or 0),
                    codec_mode=str(getattr(rt.config, "m17_codec_mode", "3200") or "3200"),
                    dst_mode=str(getattr(rt.config, "m17_dst_mode", "reflector") or "reflector"),
                    meta_text=str(getattr(rt.config, "m17_meta_text", "") or ""),
                    suffix=getattr(rt.config, "m17_callsign_suffix", "D"),
                )
        elif (getattr(rt.config, "network_type", "") or "").lower() == "dstar":
            dstar_inner = getattr(rt.client, "client", rt.client)
            if hasattr(dstar_inner, "retarget"):
                try:
                    from dmr.dstar_directory import dstar_dir_mgr
                except ImportError:
                    from src.dmr.dstar_directory import dstar_dir_mgr
                d_ref = str(getattr(rt.config, "dstar_reflector", "") or "").strip().upper()
                d_host = str(getattr(rt.config, "dstar_host", "") or "").strip()
                d_port = int(getattr(rt.config, "dstar_port", 30001) or 30001)
                d_mod = str(getattr(rt.config, "dstar_module", "D") or "D").strip().upper()[:1] or "D"
                d_proto = str(getattr(rt.config, "dstar_protocol", "auto") or "auto").strip().lower()
                d_rname = str(getattr(rt.config, "dstar_reflector_name", "") or "").strip()
                found_d = dstar_dir_mgr.find_host(d_ref or d_host)
                if found_d:
                    if not d_host:
                        d_host = str(found_d.get("host") or "").strip()
                        d_port = int(found_d.get("port") or 30001)
                    if not d_ref:
                        d_ref = str(found_d.get("designator") or "").strip().upper()
                    if not d_rname:
                        d_rname = str(found_d.get("name") or d_ref).strip()
                dstar_inner.retarget(
                    reflector=d_ref,
                    host=d_host,
                    port=d_port,
                    module=d_mod,
                    protocol=d_proto,
                    reflector_name=d_rname,
                    rx_only=getattr(rt.config, "dstar_rx_only", False)
                )
        elif (getattr(rt.config, "network_type", "") or "").lower() == "svx":
            svx_inner = getattr(rt.client, "client", rt.client)
            if hasattr(svx_inner, "retarget"):
                s_host = str(getattr(rt.config, "svx_host", "") or "").strip()
                s_port = int(getattr(rt.config, "svx_port", 5300) or 5300)
                s_key = str(getattr(rt.config, "svx_auth_key", "") or "").strip()
                s_name = str(getattr(rt.config, "svx_server_name", "") or "").strip()
                s_tg = int(getattr(rt.config, "svx_tg", 1) or 1)
                svx_inner.retarget(host=s_host, port=s_port, auth_key=s_key, server_name=s_name, tg=s_tg)
        if hasattr(rt.client, "disconnect"):
            await rt.client.disconnect(is_retry=True)
        fast_udp = (getattr(rt.config, "network_type", "bm") or "bm").lower() in ("ysf", "m17", "dstar", "svx")
        await asyncio.sleep(0.09 if fast_udp else 0.5)
        return await rt.client.connect(force=True)

    async def set_hotspot_collapsed(self, hotspot_id: str, collapsed: bool, user_id: Optional[int] = None, persist: bool = True) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt and (hotspot_id == "default" or hotspot_id == "active"):
            rt = self.get_active_runtime(uid)
            if rt:
                hotspot_id = rt.config.id
        if not rt:
            return False
        hotspot_id = rt.config.id
        if not collapsed:
            self._trigger_adn_sync_for_runtime(rt)
        was_collapsed = bool(getattr(rt.config, "collapsed", False))
        is_client_conn = bool(rt.client and rt.client.is_connected)
        if was_collapsed == bool(collapsed):
            if collapsed and not is_client_conn:
                return True
            if not collapsed and is_client_conn:
                return True

        rt.config.collapsed = collapsed
        if persist:
            settings = self.user_settings.get(uid, self.settings)
            for hs_cfg in settings.hotspots:
                if hs_cfg.id == hotspot_id:
                    hs_cfg.collapsed = collapsed
                    break
            if uid == 1 and was_collapsed != bool(collapsed):
                save_app_settings(settings)
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
            net_l = (getattr(rt.config, "network_type", "bm") or "bm").lower()
            ysf_ready = (net_l == "ysf") and bool(getattr(rt.config, "ysf_host", "") or getattr(rt.config, "bm_master_host", "") or getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", ""))
            if rt.client and not rt.client.is_connected and (net_l != "ysf" or ysf_ready):
                asyncio.create_task(rt.client.connect(force=True))
        return True

    def create_hotspot(self, cfg: HotspotConfig, user_id: Optional[int] = None) -> HotspotRuntime:
        uid = user_id if user_id is not None else self.active_user_id
        settings = self.user_settings.get(uid, self.settings)
        settings.hotspots.append(cfg)
        if uid == 1:
            save_app_settings(settings)
        rt = self._init_runtime(cfg, user_id=uid)
        self._trigger_adn_sync_for_runtime(rt)
        self._notify_async({"type": "hotspot_created", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        return rt

    def reorder_hotspots(self, order: List[str], user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        settings = self.user_settings.get(uid, self.settings)
        if not settings or not hasattr(settings, "hotspots") or not settings.hotspots:
            return False

        # All hotspots are equal: apply requested order uniformly without locking index 0
        hs_by_id = {h.id: h for h in settings.hotspots}
        new_hotspots = []
        for hid in order:
            if hid in hs_by_id:
                new_hotspots.append(hs_by_id.pop(hid))
        for remaining in hs_by_id.values():
            new_hotspots.append(remaining)
        settings.hotspots = new_hotspots

        if uid in self.user_runtimes:
            old_map = self.user_runtimes[uid]
            new_map = {}
            for h in new_hotspots:
                if h.id in old_map:
                    new_map[h.id] = old_map[h.id]
            for hid, rt in old_map.items():
                if hid not in new_map:
                    new_map[hid] = rt
            self.user_runtimes[uid] = new_map

        if uid == 1:
            save_app_settings(settings)

        self._notify_async({
            "type": "hotspots_reordered",
            "order": [h.id for h in new_hotspots],
            "hotspots": [rt.to_dict() for rt in self.user_runtimes.get(uid, {}).values()],
            "user_id": uid
        }, user_id=uid)
        return True

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

    async def set_hotspot_rpto(
        self,
        hotspot_id: str,
        rpto_options: Optional[str] = None,
        xlx_module: Optional[str] = None,
        dmrplus_reflector: Optional[str] = None,
        user_id: Optional[int] = None,
    ) -> Optional[dict]:
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hotspot_id)
        if not rt and (hotspot_id in ("default", "active")):
            rt = self.get_active_runtime(uid)
            if rt:
                hotspot_id = rt.config.id
        if not rt:
            return None
        hotspot_id = rt.config.id
        net_type_l = (getattr(rt.config, "network_type", "bm") or "bm").lower()
        if rpto_options is not None:
            clean_str = str(rpto_options).strip()
            if net_type_l in ("freedmr", "adn"):
                parsed = parse_freedmr_rpto(clean_str)
                is_duplex = getattr(rt.config, "duplex", True)
                norm_ts1, norm_ts2 = normalize_freedmr_slots(parsed["ts1"], parsed["ts2"], duplex=is_duplex)
                clean_str = build_freedmr_rpto(norm_ts1, norm_ts2, parsed["opts"])
            elif net_type_l == "dmrplus":
                parsed_dp = parse_dmrplus_rpto(clean_str, fallback_reflector=getattr(rt.config, "dmrplus_reflector", "") or "")
                clean_str = build_dmrplus_rpto(
                    start_ref=parsed_dp["start_ref"],
                    ts1=parsed_dp["ts1"],
                    ts2=parsed_dp["ts2"],
                    relink_time=parsed_dp["relink_time"],
                    user_link=parsed_dp["user_link"],
                    extra_opts=parsed_dp["opts"],
                )
                if dmrplus_reflector is None:
                    rt.config.dmrplus_reflector = str(parsed_dp["start_ref"]) if parsed_dp["start_ref"] else ""
            rt.config.rpto_options = clean_str
            if rt.client:
                rt.client.rpto_options = rt.config.rpto_options
        if xlx_module is not None:
            mod_clean = str(xlx_module).strip().upper()[:1]
            if not mod_clean or ("A" <= mod_clean <= "Z"):
                rt.config.xlx_module = mod_clean
                if rt.client:
                    rt.client.xlx_module = mod_clean
        if dmrplus_reflector is not None:
            ref_clean = str(dmrplus_reflector).strip()
            rt.config.dmrplus_reflector = "" if (not ref_clean or ref_clean == "4000") else ref_clean
            if net_type_l == "dmrplus" and rpto_options is None:
                parsed_dp = parse_dmrplus_rpto(getattr(rt.config, "rpto_options", "") or "", fallback_reflector=rt.config.dmrplus_reflector)
                eff_start_ref = int(rt.config.dmrplus_reflector) if rt.config.dmrplus_reflector.isdigit() else 4000
                rt.config.rpto_options = build_dmrplus_rpto(
                    start_ref=eff_start_ref,
                    ts1=parsed_dp["ts1"],
                    ts2=parsed_dp["ts2"],
                    relink_time=parsed_dp["relink_time"],
                    user_link=parsed_dp["user_link"],
                    extra_opts=parsed_dp["opts"],
                )
                if rt.client:
                    rt.client.rpto_options = rt.config.rpto_options
        settings = self.user_settings.get(uid, self.settings)
        for hs_cfg in settings.hotspots:
            if hs_cfg.id == hotspot_id or hs_cfg.id == rt.config.id:
                hs_cfg.rpto_options = rt.config.rpto_options
                hs_cfg.xlx_module = rt.config.xlx_module
                hs_cfg.dmrplus_reflector = rt.config.dmrplus_reflector
                break
        if uid == 1:
            save_app_settings(settings)
        sent = False
        opts_up = str(rt.config.rpto_options or "").upper()
        has_foreign_rpto = any(k in opts_up for k in ("TS1=", "TS2=", "STARTREF=", "RELINKTIME=", "USERLINK=", "DIAL=", "VOICE=", "SINGLE=", "LANG="))
        allow_rpto = (net_type_l in ("freedmr", "adn", "dmrplus", "custom")) or (net_type_l == "bm" and not has_foreign_rpto)
        if rt.client and rt.client.is_connected and rt.config.rpto_options and allow_rpto:
            sent = rt.client.send_options(rt.config.rpto_options)
        if xlx_module is not None and net_type_l == "xlx" and getattr(rt, "status", None) == BMState.ONLINE:
            await self.send_xlx_module_link_dmr(hotspot_id, rt.config.xlx_module, user_id=uid)
        if dmrplus_reflector is not None and net_type_l == "dmrplus" and getattr(rt, "status", None) == BMState.ONLINE:
            await self.send_dmrplus_reflector_link_dmr(hotspot_id, rt.config.dmrplus_reflector, user_id=uid)
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
        return {"hotspot": rt.to_dict(), "rpto_sent": sent}

    async def update_hotspot(self, cfg: HotspotConfig, user_id: Optional[int] = None, auto_connect: Optional[bool] = None) -> Optional[HotspotRuntime]:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        if cfg.id not in hs_map:
            return None

        old_rt = hs_map[cfg.id]
        was_connected = (old_rt.status in (BMState.ONLINE, BMState.CONNECTING, BMState.AUTHENTICATING, BMState.CONFIGURING))

        old_net = (getattr(old_rt.config, "network_type", "") or "").lower()
        new_net = (getattr(cfg, "network_type", "") or "").lower()
        old_node = str(getattr(old_rt.config, "allstar_node", "1999") or "1999").strip()
        new_node = str(getattr(cfg, "allstar_node", "1999") or "1999").strip()
        old_always_online = bool(getattr(old_rt.config, "allstar_always_online", True))
        new_always_online = bool(getattr(cfg, "allstar_always_online", True))

        if old_net == "allstar" and (new_net != "allstar" or old_node != new_node):
            try:
                from asl_container_manager import asl_container_mgr
                asl_container_mgr.delete_instance(user_id=str(uid), node_number=old_node)
            except Exception as e:
                logger.warning(f"[MANAGER] Error deleting old ASL container for {old_node}: {e}")

        is_hidden = getattr(cfg, "hidden", False)
        is_collapsed = getattr(cfg, "collapsed", False)
        should_connect = False if (is_hidden or is_collapsed) else (auto_connect if auto_connect is not None else was_connected)
        if old_net == "allstar" and old_always_online and not new_always_online and not should_connect:
            try:
                from asl_container_manager import asl_container_mgr
                asl_container_mgr.stop_instance(user_id=str(uid), node_number=new_node)
            except Exception as e:
                logger.warning(f"[MANAGER] Error stopping ASL container after always_online turned off: {e}")

        if old_rt.client:
            try:
                await old_rt.client.disconnect(is_retry=False)
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
                if not getattr(cfg, "ysf_room_dg_ids", None) and getattr(h, "ysf_room_dg_ids", None):
                    cfg.ysf_room_dg_ids = dict(h.ysf_room_dg_ids)
                if new_net == "ysf":
                    from src.dmr.ysf_directory import resolve_ysf_room_dg_id_settings
                    old_rid = str(getattr(h, "ysf_room_id", "") or getattr(h, "ysf_room", "") or "").strip()
                    new_rid = str(getattr(cfg, "ysf_room_id", "") or getattr(cfg, "ysf_room", "") or "").strip()
                    if new_rid != old_rid or not getattr(cfg, "ysf_dg_id", ""):
                        rx_dg, tx_dg, _, _ = resolve_ysf_room_dg_id_settings(cfg, new_rid)
                        cfg.ysf_dg_id = rx_dg
                        cfg.ysf_tx_dg_id = tx_dg
                settings.hotspots[i] = cfg
                break
        if uid == 1:
            save_app_settings(settings)

        # Re-initialize runtime
        rt = self._init_runtime(cfg, user_id=uid)
        if rt.client and hasattr(rt.client, "_is_manual_disconnect"):
            rt.client._is_manual_disconnect = False
        self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)

        if new_net == "allstar" and new_always_online:
            try:
                from asl_container_manager import asl_container_mgr
                callsign = getattr(cfg, "callsign", "N0CALL")
                password = getattr(cfg, "bm_password", "")
                loop = asyncio.get_running_loop()
                loop.run_in_executor(None, asl_container_mgr.start_instance, str(uid), new_node, password, callsign)
            except Exception as e:
                logger.warning(f"[MANAGER] Error ensuring ASL container started on update: {e}")

        # Connect if auto_connect is True, or if previously active, or if autoconnect is configured
        # But NEVER connect if hotspot is hidden!
        is_hidden = getattr(cfg, "hidden", False)
        is_collapsed = getattr(cfg, "collapsed", False)
        self._trigger_adn_sync_for_runtime(rt)
        should_connect = False if (is_hidden or is_collapsed) else (auto_connect if auto_connect is not None else was_connected)
        net_l = (getattr(cfg, "network_type", "bm") or "bm").lower()
        ysf_ready = (net_l == "ysf") and bool(getattr(cfg, "ysf_host", "") or getattr(cfg, "bm_master_host", "") or getattr(cfg, "ysf_room_id", "") or getattr(cfg, "ysf_room", ""))
        m17_ready = (net_l == "m17") and bool(getattr(cfg, "m17_host", "") or getattr(cfg, "bm_master_host", "") or getattr(cfg, "m17_reflector", ""))
        dstar_ready = (net_l == "dstar") and bool(getattr(cfg, "dstar_host", "") or getattr(cfg, "bm_master_host", "") or getattr(cfg, "dstar_reflector", ""))
        svx_ready = (net_l == "svx") and bool(getattr(cfg, "svx_host", "") or getattr(cfg, "bm_master_host", ""))
        if should_connect and rt.client and (net_l == "allstar" or ysf_ready or m17_ready or dstar_ready or svx_ready or (cfg.dmr_id > 0 and cfg.bm_password)):
            logger.info(f"[MANAGER] Reconnecting hotspot '{cfg.name}' (ID {cfg.id}, user {uid}) to {cfg.bm_master_host}...")
            async def _delayed_connect(target_rt, wait_sec: float):
                if wait_sec > 0:
                    await asyncio.sleep(wait_sec)
                if target_rt and target_rt.client:
                    await target_rt.client.connect()

            # If previous session was active, give BM cluster 1.2s to propagate session release (YSF/M17/D-STAR/SVX need only 0.1s)
            reconnect_delay = (0.1 if net_l in ("ysf", "m17", "dstar", "svx") else 1.2) if was_connected else 0.0
            asyncio.create_task(_delayed_connect(rt, reconnect_delay))

        return rt

    async def delete_hotspot(self, hotspot_id: str, user_id: Optional[int] = None) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        hs_map = self.user_runtimes.get(uid, {})
        if hotspot_id not in hs_map:
            return False
        settings_check = self.user_settings.get(uid, self.settings)
        if settings_check and hasattr(settings_check, "hotspots") and len(settings_check.hotspots) <= 1:
            return False

        if self.transcriber and hasattr(self.transcriber, "disable_hotspot"):
            try:
                self.transcriber.disable_hotspot(hotspot_id)
            except Exception as e:
                logger.error(f"[MANAGER] Error disabling transcriber on delete for {hotspot_id}: {e}")

        rt = hs_map[hotspot_id]
        if rt.client:
            await rt.client.disconnect()

        # If AllStarLink node, purge container instance and allocated ports
        if (getattr(rt.config, "network_type", "") or "").lower() == "allstar":
            try:
                from asl_container_manager import asl_container_mgr
                node_to_purge = str(getattr(rt.config, "allstar_node", "") or "1999").strip()
                asl_container_mgr.delete_instance(user_id=str(uid), node_number=node_to_purge)
            except Exception as e:
                logger.warning(f"[MANAGER] Error deleting ASL container for {hotspot_id}: {e}")

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
        net_type = (getattr(rt.config, "network_type", "bm") or "bm").lower()
        if net_type in ("allstar", "ysf", "m17", "dstar", "svx"):
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

    def send_silent_unlink_dmr(self, hid: str, slot: int, user_id: Optional[int] = None) -> bool:
        """Отправляет короткий DMR Group Call на TG 4000 (Header + Terminator) для сброса динамических групп на сервере (TGIF и др.)."""
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt or not rt.client or getattr(rt, "status", None) != BMState.ONLINE:
            return False
        if slot not in (1, 2):
            return False
        try:
            src_id = rt.config.dmr_id or 0
            if (getattr(rt.config, "network_type", "") or "").lower() == "xlx":
                raw_dmr = str(src_id or getattr(rt.config, "repeater_id", "") or "").strip()
                if raw_dmr.isdigit() and len(raw_dmr) >= 7:
                    src_id = int(raw_dmr[:7])
            dst_id = 4000
            stream_id = random.randint(1, 0xFFFFFFFE)
            seq_no = 0
            header_payload = self.tx_framer.create_header(
                src_id=src_id,
                dst_id=dst_id,
                slot=slot,
                call_type="GROUP",
                color_code=rt.client.color_code,
            )
            for _ in range(3):
                rt.client.send_dmrd(
                    slot=slot,
                    call_type="GROUP",
                    frame_type=1,
                    stream_id=stream_id,
                    seq_no=seq_no,
                    payload=header_payload,
                    src_id=src_id,
                    dst_id=dst_id,
                )
                seq_no = (seq_no + 1) % 256

            term_payload = self.tx_framer.create_terminator(
                src_id=src_id,
                dst_id=dst_id,
                slot=slot,
                call_type="GROUP",
                color_code=rt.client.color_code,
            )
            for _ in range(2):
                rt.client.send_dmrd(
                    slot=slot,
                    call_type="GROUP",
                    frame_type=2,
                    stream_id=stream_id,
                    seq_no=seq_no,
                    payload=term_payload,
                    src_id=src_id,
                    dst_id=dst_id,
                )
                seq_no = (seq_no + 1) % 256
            return True
        except Exception as e:
            logger.warning(f"[DMR] Failed to send silent unlink 4000 on {hid} TS{slot}: {e}")
            return False

    def _send_dmr_cmd_burst(self, rt: HotspotRuntime, dst_id: int, slot: int = 2, call_type: str = "PRIVATE") -> bool:
        """
        Отправляет короткую управляющую DMR-посылку (3 Voice Header + 2 Terminator).
        Важно для XLX: src_id обязан быть 7-значным DMR ID оператора (для прохождения
        валидации CCallsign::IsValid() по dmrid.dat в xlxd).
        """
        if not rt or not rt.client or getattr(rt, "status", None) != BMState.ONLINE:
            return False
        raw_dmr = str(rt.config.dmr_id or rt.config.repeater_id or "").strip()
        src_id = int(raw_dmr[:7]) if (raw_dmr.isdigit() and len(raw_dmr) >= 7) else (rt.config.dmr_id or 0)
        stream_id = random.randint(1, 0xFFFFFFFE)
        seq_no = 0
        header_payload = self.tx_framer.create_header(
            src_id=src_id,
            dst_id=dst_id,
            slot=slot,
            call_type=call_type,
            color_code=rt.client.color_code,
        )
        for _ in range(3):
            rt.client.send_dmrd(
                slot=slot,
                call_type=call_type,
                frame_type=1,
                stream_id=stream_id,
                seq_no=seq_no,
                payload=header_payload,
                src_id=src_id,
                dst_id=dst_id,
            )
            seq_no = (seq_no + 1) % 256

        term_payload = self.tx_framer.create_terminator(
            src_id=src_id,
            dst_id=dst_id,
            slot=slot,
            call_type=call_type,
            color_code=rt.client.color_code,
        )
        for _ in range(2):
            rt.client.send_dmrd(
                slot=slot,
                call_type=call_type,
                frame_type=2,
                stream_id=stream_id,
                seq_no=seq_no,
                payload=term_payload,
                src_id=src_id,
                dst_id=dst_id,
            )
            seq_no = (seq_no + 1) % 256
        return True

    async def send_xlx_module_link_dmr(self, hid: str, module: Optional[str] = None, user_id: Optional[int] = None) -> bool:
        """
        Переключает или привязывает хотспот XLX к модулю A..Z (TG 4001..4026) на TS2.
        Если module пустой — отправляет только UNLINK (TG 4000) на TS2.
        По спецификации xlxd (cdmrmmdvmprotocol.cpp:382-415) и эталону hblink.py (send_xlxmaster):
        1) Сначала отправляется посылка на 4000 (CMD_UNLINK) на TS2;
        2) Через 150 мс отправляется посылка на 4001..4026 (CMD_LINK) на TS2.
        """
        from .constants import xlx_module_to_tg
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt or not rt.client or getattr(rt, "status", None) != BMState.ONLINE:
            return False

        mod_clean = (module or "").strip().upper()[:1]
        target_tg = xlx_module_to_tg(mod_clean)

        try:
            # Шаг 1: Отправляем UNLINK (4000) на TS2 (PRIVATE, как в hblink.py send_xlxmaster)
            self._send_dmr_cmd_burst(rt, dst_id=4000, slot=2, call_type="PRIVATE")
            self.clear_dynamic_tgs(rt.config.id, slot=2, user_id=uid)

            if target_tg == 4000:
                rt.config.xlx_module = ""
                if rt.client:
                    rt.client.xlx_module = ""
                logger.info(f"[XLX] Unlinked module (TG 4000) on hotspot '{rt.config.name}' (TS2)")
                self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
                return True

            # Шаг 2: Пауза 150 мс и отправка LINK (4001..4026) на TS2
            await asyncio.sleep(0.15)
            self._send_dmr_cmd_burst(rt, dst_id=target_tg, slot=2, call_type="PRIVATE")

            rt.config.xlx_module = mod_clean
            if rt.client:
                rt.client.xlx_module = mod_clean
            self.register_dynamic_tg(rt.config.id, slot=2, tg=target_tg, user_id=uid)
            logger.info(f"[XLX] Linked hotspot '{rt.config.name}' to Module {mod_clean} (TG {target_tg}) on TS2")
            self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
            return True
        except Exception as e:
            logger.warning(f"[XLX] Failed to link module {mod_clean} on {hid}: {e}")
            return False

    async def send_dmrplus_reflector_link_dmr(self, hid: str, reflector: Optional[str] = None, user_id: Optional[int] = None) -> bool:
        """
        Переключает, отключает (4000) или запрашивает статус (5000) рефлектора DMR+ / IPSC2 на TS2.
        По протоколу IPSC2/MMDVM команды рефлектора передаются как PRIVATE Call на TS2:
          - '5000' -> PRIVATE Call 5000 на TS2 (голосовой отклик статуса от мастера);
          - '' / '4000' -> PRIVATE Call 4000 на TS2 (отключение рефлектора);
          - 4001..4999 -> PRIVATE Call 4000 + пауза 150мс + PRIVATE Call <номер> на TS2.
        """
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt or not rt.client or getattr(rt, "status", None) != BMState.ONLINE:
            return False

        ref_raw = str(reflector or "").strip()
        try:
            target_ref = int(ref_raw) if ref_raw.isdigit() else 4000
        except (ValueError, TypeError):
            target_ref = 4000

        try:
            if target_ref == 5000:
                self._send_dmr_cmd_burst(rt, dst_id=5000, slot=2, call_type="PRIVATE")
                logger.info(f"[DMR+] Requested reflector status (5000 Status) on hotspot '{rt.config.name}' (TS2)")
                return True

            # Step 1: Send Unlink 4000 on TS2
            self._send_dmr_cmd_burst(rt, dst_id=4000, slot=2, call_type="PRIVATE")
            self.clear_dynamic_tgs(rt.config.id, slot=2, user_id=uid)

            if target_ref == 4000 or not (4001 <= target_ref <= 4999):
                rt.config.dmrplus_reflector = ""
                logger.info(f"[DMR+] Unlinked reflector (4000 Unlink) on hotspot '{rt.config.name}' (TS2)")
                self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
                return True

            # Step 2: Pause 150ms and link target reflector on TS2
            await asyncio.sleep(0.15)
            self._send_dmr_cmd_burst(rt, dst_id=target_ref, slot=2, call_type="PRIVATE")

            rt.config.dmrplus_reflector = str(target_ref)
            logger.info(f"[DMR+] Linked hotspot '{rt.config.name}' to Reflector {target_ref} on TS2 (Voice via TG 9)")
            self._notify_async({"type": "hotspot_updated", "hotspot": rt.to_dict(), "user_id": uid}, user_id=uid)
            return True
        except Exception as e:
            logger.warning(f"[DMR+] Failed to link reflector '{ref_raw}' on {hid}: {e}")
            return False

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
        if state == BMState.ONLINE and getattr(rt.config, "network_type", "bm") == "xlx" and getattr(rt.config, "xlx_module", ""):
            async def _auto_link_xlx():
                await asyncio.sleep(0.5)
                if getattr(rt, "status", None) == BMState.ONLINE:
                    await self.send_xlx_module_link_dmr(rt.config.id, rt.config.xlx_module, user_id=uid)
            asyncio.create_task(_auto_link_xlx())
        if state == BMState.ONLINE and getattr(rt.config, "network_type", "bm") == "dmrplus" and getattr(rt.config, "dmrplus_reflector", ""):
            async def _auto_link_dmrplus():
                await asyncio.sleep(0.5)
                if getattr(rt, "status", None) == BMState.ONLINE:
                    await self.send_dmrplus_reflector_link_dmr(rt.config.id, rt.config.dmrplus_reflector, user_id=uid)
            asyncio.create_task(_auto_link_dmrplus())
        self._notify_async({
            "type": "bm_status",
            "hotspot_id": hid,
            "status": state.value,
            "detail": detail,
            "user_id": uid,
        }, user_id=uid)

    def _are_bm_credentials_known_valid(self, hid: str, user_id: Optional[int] = None) -> bool:
        """
        Returns True if another BrandMeister hotspot belonging to the same user
        with the exact same DMR ID and password is currently ONLINE or has already
        authenticated successfully in this session.
        """
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt or not rt.config:
            return False
        target_dmr_id = int(getattr(rt.config, "dmr_id", 0) or 0)
        target_pwd = str(getattr(rt.config, "bm_password", "") or "")
        if target_dmr_id <= 0 or not target_pwd:
            return False

        hs_map = self.user_runtimes.get(uid, {})
        for other_id, other_rt in hs_map.items():
            if other_id == hid or not other_rt or not other_rt.config or not other_rt.client:
                continue
            other_net = (getattr(other_rt.config, "network_type", "bm") or "bm").lower()
            if other_net != "bm":
                continue
            if int(getattr(other_rt.config, "dmr_id", 0) or 0) == target_dmr_id and str(getattr(other_rt.config, "bm_password", "") or "") == target_pwd:
                if other_rt.status == BMState.ONLINE or getattr(other_rt.client, "_ever_authenticated_ok", False):
                    return True
        return False

    def _get_bm_failover_candidates(self, exclude_host: str, limit: int = 15) -> List[Dict[str, Any]]:
        """
        Returns up to `limit` (15) BrandMeister master servers sorted by ascending ping time,
        excluding `exclude_host`. Uses the primary benchmark table from bm_ping_service
        (or server_probe_service fallback).
        """
        excl = (exclude_host or "").strip().lower()
        raw_list: List[Dict[str, Any]] = []
        try:
            import main as _main_mod
            if hasattr(_main_mod, "bm_ping_service") and _main_mod.bm_ping_service:
                raw_list = list(_main_mod.bm_ping_service.get_benchmark_results() or [])
        except Exception as e:
            logger.debug(f"[MANAGER] Could not read bm_ping_service benchmark results: {e}")

        if not raw_list:
            try:
                from .server_probe import server_probe_service
                probe_data = server_probe_service.get_probe_results("bm")
                raw_list = list(probe_data.get("results") or [])
            except Exception as e:
                logger.debug(f"[MANAGER] Could not read server_probe_service BM results: {e}")

        if not raw_list:
            try:
                import main as _main_mod
                for item in getattr(_main_mod, "BM_MASTERS_DEFAULT", []):
                    mid = item.get("id")
                    cc = (item.get("country") or "").upper()
                    c_flag = getattr(_main_mod, "COUNTRY_FLAGS", {}).get(cc, "🌐")
                    c_name = _i18n_country_name(cc or "BM", fallback=cc or "BM")
                    raw_list.append({
                        "id": mid,
                        "country_code": cc,
                        "country_name": c_name,
                        "flag": c_flag,
                        "host": f"{mid}.master.brandmeister.network",
                        "avg_ping": None,
                        "udp_ms": None,
                        "status": "ok",
                    })
            except Exception:
                pass

        reachable: List[Dict[str, Any]] = []
        fallback_all: List[Dict[str, Any]] = []
        seen_hosts = set()

        for srv in raw_list:
            host = str(srv.get("host") or "").strip()
            if not host:
                continue
            h_low = host.lower()
            if h_low == excl or h_low in seen_hosts:
                continue
            seen_hosts.add(h_low)
            fallback_all.append(srv)

            st = str(srv.get("state") or "").lower()
            status = str(srv.get("status") or "").lower()
            udp_ok = srv.get("udp_ok")
            if udp_ok is False or status == "unreachable" or st in ("refused", "dns_fail", "no_reply"):
                continue
            reachable.append(srv)

        pool = reachable if reachable else fallback_all

        def _ping_sort_key(item: Dict[str, Any]):
            u_ms = item.get("udp_ms")
            a_ms = item.get("avg_ping")
            ping_val = float(u_ms) if u_ms is not None else (float(a_ms) if a_ms is not None else 9999.0)
            loss_val = float(item.get("loss_pct") if item.get("loss_pct") is not None else 0.0)
            return (ping_val, loss_val, str(item.get("host") or ""))

        pool.sort(key=_ping_sort_key)
        return pool[:max(1, int(limit or 15))]

    @staticmethod
    def _format_bm_candidate_label(cand: Optional[Dict[str, Any]], lang: Optional[str] = None) -> str:
        if not isinstance(cand, dict):
            return _tr("bm_failover.unknown_server", lang=lang, fallback="unknown server")
        host = str(cand.get("host") or "").strip()
        flag = str(cand.get("flag") or "🌐").strip()
        cc = str(cand.get("country_code") or "").strip()
        raw_cn = str(cand.get("country_name") or "").strip()
        c_name = _i18n_country_name(cc or raw_cn, lang=lang, fallback=raw_cn or cc) if (cc or raw_cn) else ""
        u_ms = cand.get("udp_ms")
        a_ms = cand.get("avg_ping")
        ping_val = u_ms if u_ms is not None else a_ms
        ping_str = (
            _tr("bm_failover.ping_ms", lang=lang, fallback="{ms} ms", ms=int(round(float(ping_val))))
            if ping_val is not None
            else _tr("bm_failover.ping_na", lang=lang, fallback="ping N/A")
        )
        if c_name:
            return f"<code>{host}</code> ({flag} {c_name}, {ping_str})"
        return f"<code>{host}</code> ({ping_str})"

    def _on_bm_failover_event(self, hid: str, payload: Dict[str, Any], user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        rt = self.get_runtime(uid, hid)
        if not rt or not rt.config:
            return

        ev = str(payload.get("event") or "")
        hs_name = str(getattr(rt.config, "name", hid) or hid)
        callsign = str(getattr(rt.config, "callsign", "") or "")
        eff_id = rt.client.effective_repeater_id if rt.client else getattr(rt.config, "dmr_id", 0)
        primary_host = str(payload.get("primary_host") or getattr(rt.config, "bm_master_host", ""))

        if ev == "failover_succeeded":
            new_host = str(payload.get("new_host") or "").strip()
            if new_host:
                rt.config.bm_master_host = new_host
                settings = self.user_settings.get(uid, self.settings)
                for h_cfg in getattr(settings, "hotspots", []):
                    if h_cfg.id == rt.config.id:
                        h_cfg.bm_master_host = new_host
                        break
                if uid == 1:
                    save_app_settings(settings)
                self._notify_async({
                    "type": "hotspot_updated",
                    "hotspot": rt.to_dict(),
                    "user_id": uid,
                }, user_id=uid)

        if ev in ("failover_started", "candidate_failed_next", "failover_succeeded", "all_candidates_failed"):
            async def _send_tg():
                try:
                    import alerts_config

                    def _build_and_send():
                        cfg = alerts_config.load_alerts_config()
                        tg_lang = str(cfg.get("language") or "en").strip().lower()
                        msg_html = ""
                        if ev == "failover_started":
                            unhealthy_sec = payload.get("unhealthy_seconds", 60)
                            reason = str(payload.get("reason") or _tr("bm_failover.reason_unhealthy", lang=tg_lang, fallback="unreachable / abnormal response"))
                            next_cand = payload.get("next_candidate") or {}
                            next_idx = payload.get("next_index", 1)
                            total_c = payload.get("total_candidates", 15)
                            cand_label = self._format_bm_candidate_label(next_cand, lang=tg_lang)
                            msg_html = _tr(
                                "bm_failover.tg_started",
                                lang=tg_lang,
                                fallback=(
                                    "⚠️ <b>BrandMeister server abnormal behavior (&gt;{sec}s)</b>\n"
                                    "Hotspot: <b>{hs}</b> ({callsign}, ID <code>{eff_id}</code>)\n"
                                    "Problem server: <code>{primary_host}</code>\n"
                                    "Reason: <i>{reason}</i>\n"
                                    "🔄 Switching to server #{next_idx} of {total} by ping table:\n"
                                    "➡️ {cand_label}"
                                ),
                                sec=unhealthy_sec,
                                hs=hs_name,
                                callsign=callsign,
                                eff_id=eff_id,
                                primary_host=primary_host,
                                reason=reason,
                                next_idx=next_idx,
                                total=total_c,
                                cand_label=cand_label,
                            )
                        elif ev == "candidate_failed_next":
                            failed_cand = payload.get("failed_candidate") or {}
                            failed_idx = payload.get("failed_index", 1)
                            failed_reason = str(payload.get("failed_reason") or _tr("bm_failover.reason_no_response", lang=tg_lang, fallback="no response"))
                            next_cand = payload.get("next_candidate") or {}
                            next_idx = payload.get("next_index", 2)
                            total_c = payload.get("total_candidates", 15)
                            failed_label = self._format_bm_candidate_label(failed_cand, lang=tg_lang)
                            next_label = self._format_bm_candidate_label(next_cand, lang=tg_lang)
                            msg_html = _tr(
                                "bm_failover.tg_candidate_failed",
                                lang=tg_lang,
                                fallback=(
                                    "❌ <b>Backup server connection failed #{failed_idx}/{total}</b>\n"
                                    "Hotspot: <b>{hs}</b> (ID <code>{eff_id}</code>)\n"
                                    "Server: {failed_label}\n"
                                    "Reason: <i>{reason}</i>\n"
                                    "🔄 Trying next server #{next_idx}/{total}:\n"
                                    "➡️ {next_label}"
                                ),
                                failed_idx=failed_idx,
                                total=total_c,
                                hs=hs_name,
                                eff_id=eff_id,
                                failed_label=failed_label,
                                reason=failed_reason,
                                next_idx=next_idx,
                                next_label=next_label,
                            )
                        elif ev == "failover_succeeded":
                            new_host = str(payload.get("new_host") or "").strip()
                            cand = payload.get("candidate") or {"host": new_host}
                            idx_num = payload.get("index", 1)
                            total_c = payload.get("total_candidates", 15)
                            cand_label = self._format_bm_candidate_label(cand, lang=tg_lang)
                            msg_html = _tr(
                                "bm_failover.tg_succeeded",
                                lang=tg_lang,
                                fallback=(
                                    "✅ <b>Switched to backup BM server (#{idx}/{total})</b>\n"
                                    "Hotspot: <b>{hs}</b> ({callsign}, ID <code>{eff_id}</code>)\n"
                                    "Previous server: <code>{primary_host}</code>\n"
                                    "New server: {cand_label}\n"
                                    "Status: <b>ONLINE</b>"
                                ),
                                idx=idx_num,
                                total=total_c,
                                hs=hs_name,
                                callsign=callsign,
                                eff_id=eff_id,
                                primary_host=primary_host,
                                cand_label=cand_label,
                            )
                        elif ev == "all_candidates_failed":
                            total_c = payload.get("total_candidates", 15)
                            failed_reason = str(payload.get("failed_reason") or _tr("bm_failover.reason_no_response", lang=tg_lang, fallback="no response"))
                            msg_html = _tr(
                                "bm_failover.tg_all_failed",
                                lang=tg_lang,
                                fallback=(
                                    "🚨 <b>Failed to connect to any of {total} backup BM servers</b>\n"
                                    "Hotspot: <b>{hs}</b> ({callsign}, ID <code>{eff_id}</code>)\n"
                                    "Last error: <i>{reason}</i>\n"
                                    "↩️ Returning to primary server <code>{primary_host}</code> (next retry scan not earlier than 10 min)."
                                ),
                                total=total_c,
                                hs=hs_name,
                                callsign=callsign,
                                eff_id=eff_id,
                                reason=failed_reason,
                                primary_host=primary_host,
                            )
                        return alerts_config.send_bm_failover_telegram_alert(msg_html)

                    ok, err = await asyncio.to_thread(_build_and_send)
                    if not ok:
                        logger.debug(f"[BM-FAILOVER] Telegram alert not sent: {err}")
                    else:
                        logger.info(f"[BM-FAILOVER] Telegram alert sent for event '{ev}' on hotspot '{hs_name}'")
                except Exception as e:
                    logger.warning(f"[BM-FAILOVER] Error sending Telegram alert: {e}")

            try:
                loop = asyncio.get_running_loop()
                loop.create_task(_send_tg())
            except RuntimeError:
                pass

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
                if hasattr(rt, "rx_jitter_buffers") and rt.rx_jitter_buffers.get(frame.slot):
                    rt.rx_jitter_buffers[frame.slot].drain_sync()
                    rt.rx_jitter_buffers[frame.slot].reset()
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
                self._notify_call_ended(uid, rt, frame.slot, {
                    "type": "dmr_activity",
                    "hotspot_id": hid,
                    "slot": frame.slot,
                    "active": False,
                    "call_id": active_call.id if active_call else "",
                    "duration": round(duration, 1),
                    "discard": (duration < 0.5),
                    "user_id": uid,
                })
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
                cached_info = self.resolver.get_cached(frame.src_id)
                self._notify_async({
                    "type": "caller_resolved",
                    "hotspot_id": hid,
                    "slot": frame.slot,
                    "src_id": frame.src_id,
                    "src_callsign": slot_state.src_callsign,
                    "src_name": slot_state.src_name,
                    "talker_alias": ta,
                    "caller_display": slot_state.format_caller(),
                    "city": cached_info.get("city", "") if cached_info else "",
                    "country": cached_info.get("country", "") if cached_info else "",
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
                if hasattr(rt, "rx_jitter_buffers") and rt.rx_jitter_buffers.get(frame.slot):
                    rt.rx_jitter_buffers[frame.slot].reset()
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

            cached_city = cached_info.get("city", "") if cached_info else ""
            cached_country = cached_info.get("country", "") if cached_info else ""
            net_type = (getattr(rt.config, "network_type", "bm") or "bm").lower()
            dst_name = tg_resolver.get_name(frame.dst_id, network_type=net_type) if frame.dst_id else ""

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
                dst_name=dst_name,
                city=cached_city,
                country=cached_country,
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
                "city": cached_city,
                "country": cached_country,
                "dst_id": frame.dst_id,
                "dst_name": dst_name,
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

            jb = self._get_or_create_rx_jitter_buffer(uid, rt, hid, frame.slot)
            jb.push(frame)

    def _get_or_create_rx_jitter_buffer(self, uid: int, rt: HotspotRuntime, hid: str, slot: int) -> DMRRxJitterBuffer:
        if not hasattr(rt, "rx_jitter_buffers") or rt.rx_jitter_buffers is None:
            rt.rx_jitter_buffers = {}
        jb = rt.rx_jitter_buffers.get(slot)
        if jb is None:
            cushion = max(1, min(10, getattr(rt, "backend_buffer_ms", 120) // 60)) if getattr(rt, "backend_buffer_ms", 120) > 0 else 2
            def _on_audio_out(slot_num: int, pcm_8k: bytes, meta_list: list, frame_ref: Any):
                self._dispatch_decoded_rx_burst(uid, rt, hid, slot_num, pcm_8k, meta_list, frame_ref)

            jb = DMRRxJitterBuffer(
                slot=slot,
                vocoder=rt.vocoder,
                on_audio_out=_on_audio_out,
                cushion_packets=cushion,
                max_plc_bursts=2,
                max_queue_depth=6,
            )
            rt.rx_jitter_buffers[slot] = jb
        return jb

    def _dispatch_decoded_rx_burst(
        self,
        uid: int,
        rt: HotspotRuntime,
        hid: str,
        slot: int,
        pcm_8k: bytes,
        meta_list: list,
        frame: Any
    ):
        if not pcm_8k:
            return

        hid_bytes = hid.encode("utf-8")
        tagged_audio = bytes([slot, len(hid_bytes)]) + hid_bytes + pcm_8k
        self._broadcast_audio_async(tagged_audio, user_id=uid)

        src_id = getattr(frame, "src_id", 0)
        dst_id = getattr(frame, "dst_id", 0)
        is_freedmr_beacon = (
            (getattr(rt.config, "network_type", "bm") or "bm").lower() in ("freedmr", "adn")
            and (dst_id == 16777215 or src_id == 5000)
        )
        if is_freedmr_beacon:
            return

        slot_state = rt.ts1 if slot == 1 else rt.ts2
        if not slot_state.active:
            return
        active_calls = self._get_user_active_calls(uid)
        curr_call = active_calls.get(f"{hid}_{slot}")

        if self.transcriber and self.transcriber.is_slot_enabled(hid, slot):
            self.transcriber.feed_audio(
                hid, slot, src_id, slot_state.src_callsign, pcm_8k,
                call_id=curr_call.id if curr_call else "",
                dst_id=dst_id
            )
        if hasattr(self, "recorder") and self.recorder:
            auto_rec = getattr(rt.config, "auto_record", False)
            self.recorder.feed_rx(
                hotspot_id=hid,
                slot=slot,
                src_id=src_id,
                src_callsign=slot_state.src_callsign,
                src_name=slot_state.src_name,
                talker_alias=slot_state.talker_alias,
                dst_id=dst_id,
                pcm_bytes=pcm_8k,
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
                active_call.city = info.get("city", "")
                active_call.country = info.get("country", "")

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
                if hasattr(self, "recorder") and self.recorder and hasattr(self.recorder, "prune_stale_rx_buffers"):
                    self.recorder.prune_stale_rx_buffers(max_idle_sec=3.5)

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
                        net_type = (getattr(rt.config, "network_type", "bm") or "bm").lower()
                        if net_type in ("allstar", "ysf", "m17"):
                            # AllStarLink, YSF, and M17 manage carrier lifecycle via their own watchdogs & carrier callbacks.
                            # Do NOT let the 2.5s DMR burst timeout extinguish active AllStar, YSF, or M17 calls!
                            continue
                        if rt._active_rx_slot and (now - rt._last_rx_burst_time > 1.0):
                            rt._active_rx_slot = None
                        for slot_num, st in [(1, rt.ts1), (2, rt.ts2)]:
                            if tx_st.active and hid == tx_st.hotspot_id and slot_num == tx_st.slot:
                                continue
                            if st.active and (now - st.last_seen > 2.5):
                                if hasattr(rt, "rx_jitter_buffers") and rt.rx_jitter_buffers.get(slot_num):
                                    rt.rx_jitter_buffers[slot_num].drain_sync()
                                    rt.rx_jitter_buffers[slot_num].reset()
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
                                self._notify_call_ended(uid, rt, slot_num, {
                                    "type": "dmr_activity",
                                    "hotspot_id": hid,
                                    "slot": slot_num,
                                    "active": False,
                                    "call_id": active_call.id if active_call else "",
                                    "duration": round(duration, 1),
                                    "discard": (duration < 0.5),
                                    "user_id": uid,
                                })
            except Exception as e:
                logger.error(f"[MANAGER] Unexpected exception in slot timeout loop: {e}", exc_info=True)


    def set_backend_buffer_ms(self, buffer_ms: int, user_id: Optional[int] = None) -> int:
        val = max(0, min(2000, int(buffer_ms) if buffer_ms is not None else 0))
        target_runtimes = list(self.get_user_runtimes(user_id).values()) if user_id is not None else [
            rt for hs_map in self.user_runtimes.values() for rt in hs_map.values()
        ]
        cushion = max(1, min(10, val // 60)) if val > 0 else 2
        for rt in target_runtimes:
            rt.backend_buffer_ms = val
            if hasattr(rt, "rx_jitter_buffers") and rt.rx_jitter_buffers:
                for jb in rt.rx_jitter_buffers.values():
                    if jb:
                        jb.cushion_packets = cushion
        return val

    def _enqueue_or_send_rx_audio(self, user_id: int, rt: HotspotRuntime, slot: int, tagged_audio: bytes):
        if getattr(rt, "backend_buffer_ms", 0) <= 0:
            self._broadcast_audio_async(tagged_audio, user_id=user_id)
            return

        if not hasattr(rt, "_rx_pacer_queues"):
            rt._rx_pacer_queues = {1: collections.deque(maxlen=100), 2: collections.deque(maxlen=100)}
            rt._rx_pacer_tasks = {1: None, 2: None}
            rt._rx_pacer_draining = {1: False, 2: False}
            rt._rx_pacer_EndCallbacks = {1: [], 2: []}

        q = rt._rx_pacer_queues.get(slot)
        if q is None:
            q = collections.deque(maxlen=100)
            rt._rx_pacer_queues[slot] = q

        q.append(tagged_audio)
        pacer_task = rt._rx_pacer_tasks.get(slot)
        if pacer_task is None or pacer_task.done():
            try:
                loop = asyncio.get_running_loop()
                rt._rx_pacer_tasks[slot] = loop.create_task(
                    self._run_slot_rx_pacer(user_id, rt, slot)
                )
            except RuntimeError:
                self._broadcast_audio_async(tagged_audio, user_id=user_id)

    async def _run_slot_rx_pacer(self, user_id: int, rt: HotspotRuntime, slot: int):
        q = rt._rx_pacer_queues[slot]
        target_ms = getattr(rt, "backend_buffer_ms", 0)
        wait_start = time.monotonic()
        while len(q) * 60 < target_ms and not rt._rx_pacer_draining.get(slot, False):
            if time.monotonic() - wait_start > 0.350:
                break
            await asyncio.sleep(0.015)

        next_tick = time.monotonic()
        last_pkt_time = time.monotonic()
        try:
            while True:
                if not q:
                    if rt._rx_pacer_draining.get(slot, False) or (time.monotonic() - last_pkt_time > 0.400):
                        break
                    await asyncio.sleep(0.010)
                    # Keep next_tick anchored to monotonic clock when queue was dry
                    # so incoming packets are paced at 60ms instead of bursting at 0ms
                    now_m = time.monotonic()
                    if next_tick < now_m:
                        next_tick = now_m
                    continue

                chunk = q.popleft()
                now_m = time.monotonic()
                last_pkt_time = now_m
                self._broadcast_audio_async(chunk, user_id=user_id)
                if next_tick < now_m - 0.030:
                    next_tick = now_m + 0.060
                else:
                    next_tick += 0.060
                sleep_sec = next_tick - time.monotonic()
                if sleep_sec > 0.002:
                    await asyncio.sleep(sleep_sec)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[PACER] Error in slot {slot} pacer: {e}")
        finally:
            callbacks = list(rt._rx_pacer_EndCallbacks.get(slot, []))
            rt._rx_pacer_EndCallbacks[slot].clear()
            rt._rx_pacer_draining[slot] = False
            for cb in callbacks:
                try:
                    cb()
                except Exception as e:
                    logger.debug(f"[PACER] Callback error: {e}")

    def _notify_call_ended(self, uid: int, rt: HotspotRuntime, slot: int, payload: dict, extra_cb: Optional[Callable] = None):
        if (
            getattr(rt, "backend_buffer_ms", 0) > 0
            and hasattr(rt, "_rx_pacer_queues")
            and rt._rx_pacer_queues.get(slot)
            and len(rt._rx_pacer_queues[slot]) > 0
        ):
            rt._rx_pacer_draining[slot] = True
            def _drain_and_fire():
                self._notify_async(payload, user_id=uid)
                if extra_cb:
                    try:
                        extra_cb()
                    except Exception as e:
                        logger.debug(f"[PACER] extra_cb error: {e}")
            rt._rx_pacer_EndCallbacks[slot].append(_drain_and_fire)
        else:
            self._notify_async(payload, user_id=uid)
            if extra_cb:
                try:
                    extra_cb()
                except Exception as e:
                    logger.debug(f"[PACER] extra_cb error: {e}")

    def _broadcast_audio_async(self, pcm_bytes: bytes, user_id: Optional[int] = None):
        if self.audio_broadcast_fn:
            try:
                res = self.audio_broadcast_fn(pcm_bytes, user_id=user_id)
                if asyncio.iscoroutine(res):
                    self._spawn_task(res)
            except TypeError:
                res = self.audio_broadcast_fn(pcm_bytes)
                if asyncio.iscoroutine(res):
                    self._spawn_task(res)

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
        rts = list(self.user_runtimes.get(uid, {}).values()) if user_id is not None else [rt for hs in self.user_runtimes.values() for rt in hs.values()]
        changed = False
        for rt in rts:
            if bool(getattr(rt.agc, "enabled", None)) != bool(enabled):
                changed = True
            rt.agc.enabled = enabled
            if isinstance(getattr(rt, "rx_agc_profile", None), dict):
                rt.rx_agc_profile["enabled"] = bool(enabled)
        if changed:
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

    def set_vocoder_settings(self, spectral_enh: Optional[bool] = None, high_band_gain_db: Optional[float] = None, unvoiced_gain_db: Optional[float] = None, user_id: Optional[int] = None, **kwargs) -> None:
        """Apply AMBE+2 vocoder settings (mbelib-neo) across all runtimes for user."""
        uid = user_id if user_id is not None else self.active_user_id
        rts = list(self.user_runtimes.get(uid, {}).values()) if user_id is not None else [rt for hs in self.user_runtimes.values() for rt in hs.values()]
        enh = spectral_enh if spectral_enh is not None else True
        high_band = float(high_band_gain_db) if high_band_gain_db is not None else 0.5
        unvoiced = float(unvoiced_gain_db) if unvoiced_gain_db is not None else -1.5
        for rt in rts:
            if hasattr(rt, "vocoder") and hasattr(rt.vocoder, "set_settings"):
                rt.vocoder.set_settings(
                    spectral_enh=enh,
                    high_band_gain_db=high_band,
                    unvoiced_gain_db=unvoiced,
                )


    def start_tx(
        self,
        hotspot_id: Optional[str] = None,
        slot: int = 2,
        dst_id: int = 9990,
        call_type: str = "GROUP",
        user_id: Optional[int] = None,
    ) -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        tx_st = self._get_user_tx(uid)
        settings = self.user_settings.get(uid, self.settings)
        hid = hotspot_id or settings.active_hotspot_id
        rt = self.get_runtime(uid, hid) or self.get_active_runtime(uid)
        if not rt:
            logger.warning(f"[TX] Cannot start TX: runtime {hid} not found for user {uid}")
            return False
        if getattr(rt, "status", None) != BMState.ONLINE:
            st_val = getattr(rt.status, "value", str(getattr(rt, "status", "UNKNOWN")))
            logger.warning(f"[TX] Cannot start TX: hotspot {rt.config.id} is not connected to BM (status={st_val})")
            return False

        # Защита от реентрантного start_tx (обрыв WS во время PTT и т.п.): чисто финализируем старую TX-запись
        if tx_st.active:
            prev_hid = tx_st.hotspot_id
            prev_slot = tx_st.slot or 2
            now_re = time.time()
            active_calls_re = self._get_user_active_calls(uid)
            prev_tx_key = f"tx_{prev_hid}_{prev_slot}"
            prev_tx_call = active_calls_re.pop(prev_tx_key, None)
            prev_dur = max(0.5, now_re - (prev_tx_call.timestamp if prev_tx_call else (tx_st.start_time or now_re)))
            if prev_tx_call:
                prev_tx_call.active = False
                prev_tx_call.duration = prev_dur
                self._history_dirty.add(uid)
                self._save_calls_history(uid)
            prev_rt = self.get_runtime(uid, prev_hid) if prev_hid else None
            if prev_rt:
                prev_st = prev_rt.ts1 if prev_slot == 1 else prev_rt.ts2
                prev_st.active = False
                prev_st.src_id = 0
                prev_st.src_callsign = ""
                prev_st.src_name = ""
                prev_st.talker_alias = ""
                if (getattr(prev_rt.config, "network_type", "") or "").lower() in ("allstar", "ysf", "m17", "dstar", "svx"):
                    if prev_rt.client:
                        try:
                            if hasattr(prev_rt.client, "stop_ptt"):
                                prev_rt.client.stop_ptt()
                            elif hasattr(prev_rt.client, "send_tx_end"):
                                prev_rt.client.send_tx_end()
                        except Exception:
                            pass
            prev_tx_id = prev_tx_call.id if prev_tx_call else (tx_st.call_id or "")
            if hasattr(self, "recorder") and self.recorder:
                try:
                    self.recorder.stop_tx(call_id=prev_tx_id)
                except Exception:
                    pass
            if prev_hid:
                self._notify_async({
                    "type": "dmr_activity",
                    "hotspot_id": prev_hid,
                    "slot": prev_slot,
                    "active": False,
                    "is_tx": True,
                    "call_id": prev_tx_id,
                    "duration": round(prev_dur, 1),
                    "user_id": uid,
                }, user_id=uid)
            tx_st.active = False
            tx_st.is_releasing = False
            tx_st.audio_buffer.clear()
            tx_st.call_id = None

        effective_hid = rt.config.id if rt else (hid or "default")
        is_allstar = bool(rt and getattr(rt.config, "network_type", "bm") == "allstar")
        src_id = rt.config.dmr_id if rt else 0
        src_callsign = rt.config.callsign if rt else "ME"
        send_ta = getattr(rt.config, "send_talker_alias", True) if rt else True
        talker_alias = ((rt.config.talker_alias or rt.config.callsign) if send_ta else "") if rt else "ME"
        src_name = "ME (ProxDMR)"
        tx_city = ""
        tx_country = ""

        # XLX guard: enforce slot=2, 7-digit src_id, sync module link if 4001..4026, and transmit voice via TG 9 GROUP
        if rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "xlx":
            slot = 2
            raw_dmr = str(src_id or getattr(rt.config, "repeater_id", "") or "").strip()
            if raw_dmr.isdigit() and len(raw_dmr) >= 7:
                src_id = int(raw_dmr[:7])
            from .constants import xlx_tg_to_module
            if 4001 <= dst_id <= 4026:
                new_mod = xlx_tg_to_module(dst_id)
                cur_mod = (getattr(rt.config, "xlx_module", "") or "").strip().upper()[:1]
                if new_mod and new_mod != cur_mod:
                    if cur_mod:
                        self._send_dmr_cmd_burst(rt, dst_id=4000, slot=2, call_type="PRIVATE")
                    self._send_dmr_cmd_burst(rt, dst_id=dst_id, slot=2, call_type="PRIVATE")
                    rt.config.xlx_module = new_mod
                    if rt.client:
                        rt.client.xlx_module = new_mod
                dst_id = 9
                call_type = "GROUP"
            elif dst_id == 0:
                dst_id = 9
                call_type = "GROUP"

        # DMR+ (IPSC2) guard: when transmitting on reflector number 4001..4999, link via PRIVATE TS2 and carry voice on TG 9 GROUP
        if rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "dmrplus" and 4001 <= dst_id <= 4999:
            slot = 2
            cur_ref = str(getattr(rt.config, "dmrplus_reflector", "") or "").strip()
            if str(dst_id) != cur_ref:
                if cur_ref:
                    self._send_dmr_cmd_burst(rt, dst_id=4000, slot=2, call_type="PRIVATE")
                self._send_dmr_cmd_burst(rt, dst_id=dst_id, slot=2, call_type="PRIVATE")
                rt.config.dmrplus_reflector = str(dst_id)
            dst_id = 9
            call_type = "GROUP"

        # AllStarLink: resolve user's own node & metadata dynamically and signal start of PTT
        if is_allstar:
            slot = 1
            own_node_str = str(getattr(rt.config, "allstar_node", "1999") or "1999").strip()
            src_id = int(own_node_str) if own_node_str.isdigit() else 1999
            try:
                from allstar_directory import allstar_dir_mgr
                own_info = allstar_dir_mgr.get_node_info(own_node_str, fallback_callsign=src_callsign) or {}
            except Exception:
                own_info = {}
            cfg_cs = str(getattr(rt.config, "callsign", "") or "").strip()
            src_callsign = (cfg_cs if (cfg_cs and cfg_cs.upper() != "N0CALL") else (own_info.get("callsign") or f"Node {own_node_str}")).strip()
            src_name = (own_info.get("name") or getattr(rt.config, "talker_alias", "") or src_callsign).strip()
            tx_city = (own_info.get("city") or own_info.get("location") or "").strip()
            tx_country = (own_info.get("country") or "").strip()
            talker_alias = f"{src_callsign} · {tx_city}".strip(" ·") if tx_city else src_callsign

            if rt.client and hasattr(rt.client, "start_ptt"):
                rt.client.start_ptt()
            elif hasattr(rt, "allstar_client") and rt.allstar_client:
                rt.allstar_client.start_ptt()

        # YSF: normalize slot 1, room id/name, and signal start of PTT
        is_ysf = bool(rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "ysf")
        ysf_room_name = ""
        if is_ysf:
            slot = 1
            call_type = "GROUP"
            ysf_rid_str = str(getattr(rt.config, "ysf_room_id", "") or getattr(rt.config, "ysf_room", "") or dst_id or "25000").strip()
            dst_id = int(ysf_rid_str) if ysf_rid_str.isdigit() else 25000
            ysf_room_name = str(getattr(rt.config, "ysf_room_name", "") or getattr(rt.config, "ysf_name", "") or f"YSF #{dst_id}").strip()
            src_id = 0
            if rt.client and hasattr(rt.client, "start_ptt"):
                rt.client.start_ptt()

        # M17: normalize slot 1, block LSTN/RX-only, and signal start of PTT
        is_m17 = bool(rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "m17")
        m17_dst_name = ""
        if is_m17:
            m17_inner = getattr(rt.client, "client", rt.client) if rt.client else None
            if (getattr(rt.config, "m17_link_mode", "conn") == "lstn") or (m17_inner and (getattr(m17_inner, "link_mode", "conn") == "lstn" or getattr(m17_inner, "rx_only", False))):
                logger.info(f"[TX] M17 TX blocked (LSTN/RX-only) for user {uid} on {effective_hid}")
                return False
            slot = 1
            call_type = "GROUP"
            dst_id = 0
            src_id = 0
            m17_ref = str(getattr(m17_inner, "reflector", "") or getattr(rt.config, "m17_reflector", "") or "M17").strip()
            m17_mod = str(getattr(m17_inner, "module", "") or getattr(rt.config, "m17_module", "C") or "C").strip()
            m17_dst_name = f"{m17_ref} {m17_mod}".strip()
            if rt.client and hasattr(rt.client, "start_ptt"):
                if not rt.client.start_ptt():
                    return False

        # D-STAR: normalize slot 1, block RX-only, and signal start of TX
        is_dstar = bool(rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "dstar")
        dstar_dst_name = ""
        if is_dstar:
            dstar_inner = getattr(rt.client, "client", rt.client) if rt.client else None
            if getattr(rt.config, "dstar_rx_only", False) or (dstar_inner and (getattr(dstar_inner, "rx_only", False) or getattr(dstar_inner, "server_ro", False))):
                logger.info(f"[TX] D-STAR TX blocked (RX-only) for user {uid} on {effective_hid}")
                return False
            slot = 1
            call_type = "GROUP"
            dst_id = 0
            src_id = 0
            d_ref = str(getattr(dstar_inner, "reflector", "") or getattr(rt.config, "dstar_reflector", "XLX250")).strip()
            d_mod = str(getattr(dstar_inner, "module", "") or getattr(rt.config, "dstar_module", "D")).strip()
            dstar_dst_name = f"{d_ref} {d_mod}".strip()
            if rt.client and hasattr(rt.client, "start_tx"):
                if not rt.client.start_tx():
                    return False

        # SVXReflector: normalize slot 1, check active TG > 0, block RX-only, and signal start of TX
        is_svx = bool(rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "svx")
        svx_dst_name = ""
        if is_svx:
            svx_inner = getattr(rt.client, "client", rt.client) if rt.client else None
            active_tg = int(getattr(svx_inner, "selected_tg", getattr(rt.config, "svx_tg", 1)) or 0)
            if active_tg == 0:
                logger.info(f"[TX] SVX TX blocked: active TG is 0 (Standby) for user {uid} on {effective_hid}")
                return False
            if getattr(rt.config, "svx_rx_only", False) or (svx_inner and getattr(svx_inner, "rx_only", False)):
                logger.info(f"[TX] SVX TX blocked (RX-only) for user {uid} on {effective_hid}")
                return False
            slot = 1
            call_type = "GROUP"
            dst_id = active_tg
            src_id = 0
            svx_dst_name = f"TG {active_tg}"
            if rt.client and hasattr(rt.client, "start_tx"):
                if not rt.client.start_tx():
                    return False

        tx_st.active = True
        tx_st.is_releasing = False
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
        if rt and hasattr(rt, "rx_jitter_buffers") and rt.rx_jitter_buffers.get(slot):
            rt.rx_jitter_buffers[slot].reset()
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
            dst_name=f"Node {dst_id}" if is_allstar else (ysf_room_name if is_ysf else (m17_dst_name if is_m17 else (dstar_dst_name if is_dstar else (svx_dst_name if is_svx else f"TG {dst_id}")))),
            city=tx_city,
            country=tx_country,
            call_type=tx_st.call_type,
            active=True,
            is_tx=True,
            network_type="allstar" if is_allstar else ("ysf" if is_ysf else ("m17" if is_m17 else ("dstar" if is_dstar else ("svx" if is_svx else getattr(rt.config, "network_type", "bm"))))),
            source_type="VoIP" if (is_allstar or is_ysf or is_m17 or is_dstar or is_svx) else "RF",
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
            "dst_name": tx_call.dst_name,
            "call_type": tx_st.call_type,
            "active": True,
            "is_tx": True,
            "call_entry": tx_call.to_dict(),
            "network_type": tx_call.network_type,
            "source_type": tx_call.source_type,
            "user_id": uid,
        }, user_id=uid)

        if not is_allstar and not is_ysf and not is_m17 and not is_dstar and not is_svx and rt and rt.client and rt.status == BMState.ONLINE:
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
            logger.info(f"[TX] Local TX started for user {uid} (BM status is {rt.status.value if rt else 'unknown'})")

        return True

    def process_tx_audio(self, pcm_bytes: bytes, user_id: Optional[int] = None):
        uid = user_id if user_id is not None else self.active_user_id
        tx_st = self._get_user_tx(uid)
        if not tx_st.active or getattr(tx_st, "is_releasing", False) or not tx_st.hotspot_id:
            logger.warning(f"[TX] process_tx_audio: TX not active (active={tx_st.active}, hid={tx_st.hotspot_id})")
            return

        if hasattr(self, "recorder") and self.recorder:
            self.recorder.feed_tx(pcm_bytes)

        rt = self.get_runtime(uid, tx_st.hotspot_id)
        if not rt:
            logger.warning(f"[TX] process_tx_audio: Runtime not found for hotspot {tx_st.hotspot_id}")
            return

        tx_st.audio_buffer.extend(pcm_bytes)

        if rt and getattr(rt.config, "network_type", "bm") == "allstar":
            # AllStarLink uses 20ms chunks (320 bytes PCM16 @ 8000Hz)
            while len(tx_st.audio_buffer) >= 320:
                chunk = bytes(tx_st.audio_buffer[:320])
                del tx_st.audio_buffer[:320]
                if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                    chunk = rt.tx_dsp.process_burst(chunk)
                if rt.client and hasattr(rt.client, "send_tx_audio_chunk"):
                    rt.client.send_tx_audio_chunk(chunk)
                elif hasattr(rt, "allstar_client") and rt.allstar_client:
                    rt.allstar_client.send_tx_audio_chunk(chunk)
            return

        if rt and getattr(rt.config, "network_type", "bm") == "ysf":
            # YSF uses 100ms frames (1600 bytes PCM16 @ 8000Hz)
            while len(tx_st.audio_buffer) >= 1600:
                chunk = bytes(tx_st.audio_buffer[:1600])
                del tx_st.audio_buffer[:1600]
                if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                    chunk = rt.tx_dsp.process_burst(chunk)
                if rt.client and hasattr(rt.client, "send_tx_audio_chunk"):
                    rt.client.send_tx_audio_chunk(chunk)
            return

        if rt and getattr(rt.config, "network_type", "bm") == "m17":
            # M17 uses 40ms Codec2 frames (640 bytes PCM16 @ 8000Hz)
            while len(tx_st.audio_buffer) >= 640:
                chunk = bytes(tx_st.audio_buffer[:640])
                del tx_st.audio_buffer[:640]
                if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                    chunk = rt.tx_dsp.process_burst(chunk)
                if rt.client and hasattr(rt.client, "send_tx_audio_chunk"):
                    rt.client.send_tx_audio_chunk(chunk)
            return

        if rt and getattr(rt.config, "network_type", "bm") == "dstar":
            # D-STAR uses 20ms AMBE-2020 frames (320 bytes PCM16 @ 8000Hz)
            while len(tx_st.audio_buffer) >= 320:
                chunk = bytes(tx_st.audio_buffer[:320])
                del tx_st.audio_buffer[:320]
                if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                    chunk = rt.tx_dsp.process_burst(chunk)
                if rt.client and hasattr(rt.client, "send_tx_pcm"):
                    rt.client.send_tx_pcm(chunk)
                elif rt.client and hasattr(rt.client, "send_tx_audio_chunk"):
                    rt.client.send_tx_audio_chunk(chunk)
            return

        if rt and getattr(rt.config, "network_type", "bm") == "svx":
            # SVXReflector uses 20ms Opus frames (320 bytes PCM16 @ 8000Hz)
            while len(tx_st.audio_buffer) >= 320:
                chunk = bytes(tx_st.audio_buffer[:320])
                del tx_st.audio_buffer[:320]
                if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                    chunk = rt.tx_dsp.process_burst(chunk)
                if rt.client and hasattr(rt.client, "send_tx_pcm"):
                    rt.client.send_tx_pcm(chunk)
                elif rt.client and hasattr(rt.client, "send_tx_audio_chunk"):
                    rt.client.send_tx_audio_chunk(chunk)
            return

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
                        if getattr(rt.config, "network_type", "bm") == "xlx":
                            raw_dmr = str(src_id or "").strip()
                            if raw_dmr.isdigit() and len(raw_dmr) >= 7:
                                src_id = int(raw_dmr[:7])
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

    async def stop_tx(self, user_id: Optional[int] = None, roger_beep: bool = False, roger_beep_pattern: str = "") -> bool:
        uid = user_id if user_id is not None else self.active_user_id
        tx_st = self._get_user_tx(uid)
        if not tx_st.active:
            return False

        tx_st.is_releasing = True
        hid = tx_st.hotspot_id
        rt = self.get_runtime(uid, hid) if hid else None
        slot = tx_st.slot

        # AllStarLink: flush remaining 20ms chunks and stop PTT via AllStarClientAdapter
        if rt and getattr(rt.config, "network_type", "bm") == "allstar":
            asl_target = rt.client if (rt.client and hasattr(rt.client, "stop_ptt")) else getattr(rt, "allstar_client", None)
            if asl_target:
                while len(tx_st.audio_buffer) >= 320:
                    chunk = bytes(tx_st.audio_buffer[:320])
                    del tx_st.audio_buffer[:320]
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        chunk = rt.tx_dsp.process_burst(chunk)
                    if hasattr(asl_target, "send_tx_audio_chunk"):
                        asl_target.send_tx_audio_chunk(chunk)
                asl_target.stop_ptt()
            tx_st.audio_buffer.clear()

        # YSF: flush remaining 100ms frames (+ padded tail) and stop PTT via YSFClientAdapter
        if rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "ysf":
            ysf_target = rt.client if (rt.client and hasattr(rt.client, "stop_ptt")) else None
            if ysf_target:
                while len(tx_st.audio_buffer) >= 1600:
                    chunk = bytes(tx_st.audio_buffer[:1600])
                    del tx_st.audio_buffer[:1600]
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        chunk = rt.tx_dsp.process_burst(chunk)
                    if hasattr(ysf_target, "send_tx_audio_chunk"):
                        ysf_target.send_tx_audio_chunk(chunk)
                if len(tx_st.audio_buffer) >= 320:
                    padded = bytes(tx_st.audio_buffer) + (b"\x00" * (1600 - len(tx_st.audio_buffer)))
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        padded = rt.tx_dsp.process_burst(padded)
                    if hasattr(ysf_target, "send_tx_audio_chunk"):
                        ysf_target.send_tx_audio_chunk(padded)
                ysf_target.stop_ptt()
            tx_st.audio_buffer.clear()

        # M17: flush remaining 40ms (640B) frames (+ roger beep / padded tail) and stop PTT via M17ClientAdapter
        if rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "m17":
            m17_target = rt.client if (rt.client and hasattr(rt.client, "stop_ptt")) else None
            if m17_target:
                if roger_beep and roger_beep_pattern:
                    try:
                        beep_pcm = BeepMarkerGenerator.get_marker_bytes(roger_beep_pattern)
                        if beep_pcm:
                            if hasattr(self, "recorder") and self.recorder:
                                self.recorder.feed_tx(beep_pcm)
                            tx_st.audio_buffer.extend(beep_pcm)
                    except Exception as e:
                        logger.debug(f"[TX] M17 roger beep error: {e}")
                while len(tx_st.audio_buffer) >= 640:
                    chunk = bytes(tx_st.audio_buffer[:640])
                    del tx_st.audio_buffer[:640]
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        chunk = rt.tx_dsp.process_burst(chunk)
                    if hasattr(m17_target, "send_tx_audio_chunk"):
                        m17_target.send_tx_audio_chunk(chunk)
                if len(tx_st.audio_buffer) >= 160:
                    padded = bytes(tx_st.audio_buffer) + (b"\x00" * (640 - len(tx_st.audio_buffer)))
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        padded = rt.tx_dsp.process_burst(padded)
                    if hasattr(m17_target, "send_tx_audio_chunk"):
                        m17_target.send_tx_audio_chunk(padded)
                m17_target.stop_ptt()
            tx_st.audio_buffer.clear()

        # D-STAR: flush remaining 20ms (320B) frames and stop TX
        if rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "dstar":
            dstar_target = rt.client
            if dstar_target:
                while len(tx_st.audio_buffer) >= 320:
                    chunk = bytes(tx_st.audio_buffer[:320])
                    del tx_st.audio_buffer[:320]
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        chunk = rt.tx_dsp.process_burst(chunk)
                    if hasattr(dstar_target, "send_tx_pcm"):
                        dstar_target.send_tx_pcm(chunk)
                if len(tx_st.audio_buffer) > 0:
                    padded = bytes(tx_st.audio_buffer) + (b"\x00" * (320 - len(tx_st.audio_buffer)))
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        padded = rt.tx_dsp.process_burst(padded)
                    if hasattr(dstar_target, "send_tx_pcm"):
                        dstar_target.send_tx_pcm(padded)
                if hasattr(dstar_target, "send_tx_end"):
                    dstar_target.send_tx_end()
            tx_st.audio_buffer.clear()

        # SVX: flush remaining 20ms (320B) frames and stop TX
        if rt and (getattr(rt.config, "network_type", "bm") or "").lower() == "svx":
            svx_target = rt.client
            if svx_target:
                while len(tx_st.audio_buffer) >= 320:
                    chunk = bytes(tx_st.audio_buffer[:320])
                    del tx_st.audio_buffer[:320]
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        chunk = rt.tx_dsp.process_burst(chunk)
                    if hasattr(svx_target, "send_tx_pcm"):
                        svx_target.send_tx_pcm(chunk)
                if len(tx_st.audio_buffer) > 0:
                    padded = bytes(tx_st.audio_buffer) + (b"\x00" * (320 - len(tx_st.audio_buffer)))
                    if hasattr(rt, "tx_dsp") and rt.tx_dsp:
                        padded = rt.tx_dsp.process_burst(padded)
                    if hasattr(svx_target, "send_tx_pcm"):
                        svx_target.send_tx_pcm(padded)
                if hasattr(svx_target, "send_tx_end"):
                    svx_target.send_tx_end()
            tx_st.audio_buffer.clear()

        if rt and rt.client and rt.status == BMState.ONLINE and getattr(rt.config, "network_type", "bm") not in ("allstar", "ysf", "m17", "dstar", "svx"):
            try:
                src_id = rt.config.dmr_id
                if getattr(rt.config, "network_type", "bm") == "xlx":
                    raw_dmr = str(src_id or "").strip()
                    if raw_dmr.isdigit() and len(raw_dmr) >= 7:
                        src_id = int(raw_dmr[:7])

                # If roger beep is requested, append Roger Beep PCM + 0.5s silence tail
                if roger_beep and roger_beep_pattern:
                    try:
                        beep_pcm = BeepMarkerGenerator.get_marker_bytes(roger_beep_pattern)
                        if beep_pcm:
                            # 1.0 sec silence carrier tail at 8000 Hz 16-bit mono = 16000 bytes (8000 samples)
                            silence_tail = b"\x00" * 16000
                            full_tail = beep_pcm + silence_tail
                            if hasattr(self, "recorder") and self.recorder:
                                self.recorder.feed_tx(full_tail)
                            tx_st.audio_buffer.extend(full_tail)
                            logger.info(f"[TX] Appended Roger Beep ({len(beep_pcm)} bytes) + 1.0s tail ({len(silence_tail)} bytes, '{roger_beep_pattern}')")
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

                        # Pace bursts at 60ms cadence if transmitting roger beep / tail so BM receives real-time stream
                        if roger_beep and roger_beep_pattern:
                            await asyncio.sleep(0.060)

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
                        if roger_beep and roger_beep_pattern:
                            await asyncio.sleep(0.060)

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

        # Measure duration at the very end so roger beep and 0.5s tail are included
        now = time.time()
        active_calls = self._get_user_active_calls(uid)
        tx_call_key = f"tx_{hid}_{slot}"
        active_tx_call = active_calls.pop(tx_call_key, None)
        duration = 0.0
        if active_tx_call:
            active_tx_call.active = False
            active_tx_call.duration = max(0.5, now - active_tx_call.timestamp)
            duration = active_tx_call.duration
            self._history_dirty.add(uid)
            self._save_calls_history(uid)
        elif tx_st.start_time > 0:
            duration = max(0.5, now - tx_st.start_time)

        tx_st.active = False
        tx_st.is_releasing = False
        tx_st.audio_buffer.clear()
        if rt and hasattr(rt, "tx_dsp") and rt.tx_dsp:
            rt.tx_dsp.reset()

        # Broadcast completion of TX call
        tx_call_finish_id = active_tx_call.id if active_tx_call else (tx_st.call_id or "")
        if hasattr(self, "recorder") and self.recorder:
            self.recorder.stop_tx(call_id=tx_call_finish_id)

        tx_net_type = (getattr(rt.config, "network_type", "bm") or "bm").lower() if rt else "bm"
        self._notify_async({
            "type": "dmr_activity",
            "hotspot_id": hid,
            "slot": slot,
            "active": False,
            "is_tx": True,
            "call_id": tx_call_finish_id,
            "duration": round(duration, 1),
            "network_type": tx_net_type,
            "source_type": "VoIP" if tx_net_type in ("allstar", "ysf", "m17", "dstar", "svx") else "RF",
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
