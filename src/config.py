import json
import os
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
SETTINGS_FILE = CONFIG_DIR / "settings.json"

class HotspotConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = "Основной хотспот"
    callsign: str = "N0CALL"
    dmr_id: int = 0
    bm_ssid: int = Field(default=1, ge=1, le=99)

    @field_validator("bm_ssid", mode="before")
    @classmethod
    def validate_bm_ssid(cls, v: Any) -> int:
        try:
            val = int(v)
            if val < 1:
                return 1
            if val > 99:
                return 99
            return val
        except (ValueError, TypeError):
            return 1
    bm_master_host: str = "2322.master.brandmeister.network"
    bm_master_port: int = 62031
    bm_password: str = ""
    bm_api_key: str = ""
    duplex: bool = True
    rx_freq: int = 438800000
    tx_freq: int = 431200000
    color_code: int = 1
    default_tg_ts1: int = 9990
    default_tg_ts2: int = 9990
    autoconnect: bool = True
    rx_gain: float = 1.0
    tx_gain: float = 1.0
    talker_alias: str = ""
    send_talker_alias: bool = True
    collapsed: bool = False
    auto_tg_bm: bool = True
    auto_record: bool = False
    model_config = {"extra": "allow"}

class AppSettings(BaseModel):
    active_hotspot_id: str = "default"
    loopback_mode: bool = False
    mute_on_ptt: bool = True
    volume_down_ptt: bool = True
    volume_up_ptt: bool = True
    sync_hotspot_volume: bool = True
    sync_system_volume: bool = True
    haptic_feedback: bool = True
    haptic_duration: int = 45
    simultaneous_slots: bool = True
    theme: str = "dark"
    bg_type: str = "pattern"
    bg_color: str = "#0f1115"
    bg_type_dark: str = "pattern"
    bg_color_dark: str = "#0f1115"
    bg_type_light: str = "pattern"
    bg_color_light: str = "#f4f6f8"
    language: str = "ru"
    transcriber_enabled: bool = False
    transcriber_api_key: str = ""
    transcriber_api_keys: List[str] = Field(default_factory=list)
    transcriber_model: str = "gemini-3.5-flash"
    transcriber_target_lang: str = "ru"
    tts_enabled: bool = False
    tts_engine: str = "gemini"
    tts_model: str = "gemini-3.1-flash-tts-preview"
    tts_voice: str = "auto"
    tts_speed: float = 1.1
    tts_ducking_level: float = 0.80
    tts_pause_ducking_level: float = 1.0
    tts_mute_others: bool = True
    tts_announce_callsign: bool = False
    tts_style: str = "radio"
    quick_mem: Dict[str, Any] = Field(default_factory=dict)
    client_settings: Dict[str, Any] = Field(default_factory=dict)
    recordings_settings: Dict[str, Any] = Field(default_factory=dict)
    hamqth_username: str = ""
    hamqth_password: str = ""
    hotspots: List[HotspotConfig] = Field(default_factory=list)
    contacts: List[Dict[str, Any]] = Field(default_factory=list)
    contacts_gateway: Dict[str, Any] = Field(default_factory=lambda: {"hotspot_id": "default", "slot": 2})
    model_config = {"extra": "allow"}

    def get_active_hotspot(self) -> Optional[HotspotConfig]:
        for hs in self.hotspots:
            if hs.id == self.active_hotspot_id:
                return hs
        return self.hotspots[0] if self.hotspots else None

def load_app_settings() -> AppSettings:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        default_hs = HotspotConfig(id="default", name="Основной хотспот")
        app_settings = AppSettings(active_hotspot_id="default", hotspots=[default_hs])
        save_app_settings(app_settings)
        return app_settings

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8-sig") as f:
            raw = json.load(f)

        # Migration from legacy single-hotspot settings.json
        if "hotspots" not in raw:
            hs = HotspotConfig(
                id="default",
                name="Основной хотспот",
                callsign=raw.get("callsign", "N0CALL"),
                dmr_id=raw.get("dmr_id", 0),
                bm_ssid=raw.get("bm_ssid", 1) if raw.get("bm_ssid", 0) > 0 else 1,
                bm_master_host=raw.get("bm_master_host", "2322.master.brandmeister.network"),
                bm_master_port=raw.get("bm_master_port", 62031),
                bm_password=raw.get("bm_password", ""),
                duplex=True,
                rx_freq=438800000,
                tx_freq=431200000,
                color_code=1,
                default_tg_ts1=91,
                default_tg_ts2=raw.get("default_tg", 2501),
                autoconnect=raw.get("bm_autoconnect", False),
                rx_gain=raw.get("rx_gain", 1.0),
                tx_gain=raw.get("tx_gain", 1.0),
            )
            app_settings = AppSettings(
                active_hotspot_id="default",
                loopback_mode=raw.get("loopback_mode", False),
                hotspots=[hs],
            )
            save_app_settings(app_settings)
            return app_settings

        app_settings = AppSettings(**raw)
        settings_modified = False
        if not app_settings.hotspots:
            app_settings.hotspots.append(HotspotConfig(id="default", name="Основной хотспот"))
            settings_modified = True

        for raw_hs in raw.get("hotspots", []):
            if isinstance(raw_hs, dict) and (raw_hs.get("bm_ssid") is None or not (1 <= raw_hs.get("bm_ssid", 1) <= 99)):
                settings_modified = True
                break

        # Migrate deprecated Gemini models to gemini-3.5-flash
        if any(dep in app_settings.transcriber_model.lower() for dep in ["gemini-2.5-", "gemini-2.0-", "gemini-1.5-"]):
            app_settings.transcriber_model = "gemini-3.5-flash"
            settings_modified = True

        # Validate contacts_gateway hotspot_id
        valid_hs_ids = {h.id for h in app_settings.hotspots}
        gw_hid = (app_settings.contacts_gateway or {}).get("hotspot_id")
        if gw_hid not in valid_hs_ids:
            fallback_id = app_settings.hotspots[0].id if app_settings.hotspots else "default"
            if not app_settings.contacts_gateway:
                app_settings.contacts_gateway = {"hotspot_id": fallback_id, "slot": 2}
            else:
                app_settings.contacts_gateway["hotspot_id"] = fallback_id
            settings_modified = True

        # Migrate legacy bg_type
        if getattr(app_settings, "bg_type", None) in ("pattern1", "pattern2"):
            app_settings.bg_type = "pattern"
            settings_modified = True
        if getattr(app_settings, "bg_type_dark", None) in ("pattern1", "pattern2"):
            app_settings.bg_type_dark = "pattern"
            settings_modified = True
        if getattr(app_settings, "bg_type_light", None) in ("pattern1", "pattern2"):
            app_settings.bg_type_light = "pattern"
            settings_modified = True

        if settings_modified:
            save_app_settings(app_settings)
        return app_settings
    except Exception as e:
        print(f"[CONFIG] Error loading settings: {e}, using default")
        default_hs = HotspotConfig(id="default", name="Основной хотспот")
        return AppSettings(active_hotspot_id="default", hotspots=[default_hs])

def save_app_settings(app_settings: AppSettings) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(app_settings.model_dump(), f, indent=2, ensure_ascii=False)