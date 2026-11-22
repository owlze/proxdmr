import json
import os
import uuid
from pathlib import Path
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field, field_validator, model_validator

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
SETTINGS_FILE = CONFIG_DIR / "settings.json"

class HotspotConfig(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4())[:8])
    name: str = "Main Hotspot"
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
    network_type: str = "bm"
    rpto_options: str = ""
    xlx_module: str = "D"
    dmrplus_reflector: str = "4530"
    ysf_host: str = "ysf.brandmeister.ru"
    ysf_port: int = 42000
    ysf_room_id: str = "25000"
    ysf_room_name: str = "YSF-Russia"
    ysf_room: Optional[str] = None
    ysf_name: Optional[str] = None
    ysf_dg_id: str = ""
    ysf_tx_dg_id: Optional[int] = None
    ysf_room_dg_ids: Dict[str, Any] = Field(default_factory=dict)
    m17_host: str = ""
    m17_port: int = 17000
    m17_reflector: str = ""
    m17_reflector_name: str = ""
    m17_module: str = "C"
    m17_callsign_suffix: str = "D"
    m17_can: int = 0
    m17_link_mode: str = "conn"
    m17_codec_mode: str = "3200"
    m17_dst_mode: str = "reflector"
    m17_meta_text: str = ""
    m17_server_type: str = "mrefd"
    m17_room_modules: Dict[str, str] = Field(default_factory=dict)

    @field_validator("m17_port", mode="before")
    @classmethod
    def validate_m17_port(cls, v: Any) -> int:
        try:
            p = int(v)
            if 1 <= p <= 65535:
                return p
        except (ValueError, TypeError):
            pass
        return 17000

    @field_validator("m17_module", mode="before")
    @classmethod
    def validate_m17_module(cls, v: Any) -> str:
        s = "".join(c for c in str(v or "C").strip().upper() if "A" <= c <= "Z")
        return s[0] if s else "C"

    @field_validator("m17_callsign_suffix", mode="before")
    @classmethod
    def validate_m17_suffix(cls, v: Any) -> str:
        if v is None:
            return "D"
        s = "".join(c for c in str(v).strip().upper() if ("A" <= c <= "Z" or "0" <= c <= "9"))
        return s[:1]

    @field_validator("m17_can", mode="before")
    @classmethod
    def validate_m17_can(cls, v: Any) -> int:
        try:
            c = int(v)
            return max(0, min(15, c))
        except (ValueError, TypeError):
            return 0

    @field_validator("m17_link_mode", mode="before")
    @classmethod
    def validate_m17_link_mode(cls, v: Any) -> str:
        val = str(v or "conn").strip().lower()
        return val if val in ("conn", "lstn") else "conn"

    @field_validator("m17_codec_mode", mode="before")
    @classmethod
    def validate_m17_codec_mode(cls, v: Any) -> str:
        val = str(v or "3200").strip()
        return val if val in ("3200", "1600") else "3200"

    @field_validator("m17_dst_mode", mode="before")
    @classmethod
    def validate_m17_dst_mode(cls, v: Any) -> str:
        val = str(v or "reflector").strip().lower()
        return val if val in ("reflector", "broadcast") else "reflector"

    @field_validator("m17_server_type", mode="before")
    @classmethod
    def validate_m17_server_type(cls, v: Any) -> str:
        val = str(v or "mrefd").strip().lower()
        return val if val in ("mrefd", "urfd", "vex", "custom") else "mrefd"

    @model_validator(mode="before")
    @classmethod
    def sync_ysf_fields(cls, values: Any) -> Any:
        if isinstance(values, dict):
            net_type = str(values.get("network_type") or "").strip().lower()
            if net_type == "m17":
                if values.get("m17_reflector"):
                    values["m17_reflector"] = str(values["m17_reflector"]).strip().upper()[:8]
                if values.get("m17_module"):
                    m_ch = "".join(c for c in str(values["m17_module"]).strip().upper() if "A" <= c <= "Z")
                    values["m17_module"] = m_ch[0] if m_ch else "C"
                m17_h = str(values.get("m17_host") or "").strip()
                m17_ref = str(values.get("m17_reflector") or "").strip().upper()
                if m17_h and (m17_h.upper() == m17_ref or m17_h.upper().startswith(("M17-", "URF", "VEX")) and "." not in m17_h):
                    values["m17_host"] = ""
                    m17_h = ""
                if not m17_h:
                    bm_h = str(values.get("bm_master_host") or "").strip()
                    if bm_h and "." in bm_h and "brandmeister.network" not in bm_h.lower():
                        values["m17_host"] = bm_h
            if "ysf_room" in values and values["ysf_room"] and not values.get("ysf_room_id"):
                values["ysf_room_id"] = str(values["ysf_room"])
            elif "ysf_room_id" in values and values["ysf_room_id"] and not values.get("ysf_room"):
                values["ysf_room"] = str(values["ysf_room_id"])

            if "ysf_name" in values and values["ysf_name"] and not values.get("ysf_room_name"):
                values["ysf_room_name"] = str(values["ysf_name"])
            elif "ysf_room_name" in values and values["ysf_room_name"] and not values.get("ysf_name"):
                values["ysf_name"] = str(values["ysf_room_name"])
        return values

    @field_validator("network_type", mode="before")
    @classmethod
    def validate_network_type(cls, v: Any) -> str:
        val = str(v or "bm").strip().lower()
        if val in ("bm", "tgif", "freedmr", "dmrplus", "xlx", "allstar", "custom", "adn", "ysf", "m17", "dstar", "svx"):
            return val
        return "bm"

    duplex: bool = True
    rx_freq: int = 438800000
    tx_freq: int = 431200000
    color_code: int = 1
    default_tg_ts1: int = 9990
    default_tg_ts2: int = 9990
    default_tg: int = 2501
    default_slot: int = 2
    autoconnect: bool = True
    rx_gain: float = 1.0
    tx_gain: float = 1.0
    talker_alias: str = ""
    send_talker_alias: bool = True
    collapsed: bool = False
    auto_tg_bm: bool = True
    auto_record: bool = True
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
    simultaneous_slots: bool = False
    check_mic_on_tx: bool = True
    theme: str = "dark"
    bg_type: str = "color"
    bg_color: str = "#04170c"
    bg_type_dark: str = "color"
    bg_color_dark: str = "#04170c"
    bg_type_light: str = "pattern"
    bg_color_light: str = "#f4f6f8"
    language: str = "ru"
    transcriber_enabled: bool = False
    transcriber_api_key: str = ""
    transcriber_api_keys: List[str] = Field(default_factory=list)
    transcriber_engine: str = "groq"
    transcriber_model: str = "gemini-3.5-flash"
    translation_engine: str = "groq"
    transcriber_target_lang: str = "ru"
    groq_api_key: str = ""
    groq_api_keys: List[str] = Field(default_factory=list)
    deepgram_api_key: str = ""
    gemini_use_first_key_only: bool = False
    groq_use_first_key_only: bool = False
    gemini_use_first_key: Optional[bool] = None
    gemini_use_other_keys: Optional[bool] = None
    groq_use_first_key: Optional[bool] = None
    groq_use_other_keys: Optional[bool] = None
    tts_enabled: bool = False
    tts_engine: str = "piper"
    tts_model: str = "gemini-3.1-flash-tts-preview"
    tts_voice: str = "ru_RU-terra5871-medium"
    tts_speed: float = 1.1
    tts_ducking_level: float = 0.80
    tts_pause_ducking_level: float = 1.0
    tts_mute_others: bool = True
    tts_announce_callsign: bool = False
    tts_skip_short_callsign: bool = True
    tts_style: str = "radio"
    quick_mem: Dict[str, Any] = Field(default_factory=dict)
    client_settings: Dict[str, Any] = Field(default_factory=dict)
    recordings_settings: Dict[str, Any] = Field(default_factory=dict)
    hamqth_username: str = ""
    hamqth_password: str = ""
    disable_update_notifications: bool = False
    enable_network_colors: bool = True
    network_brand_colors: Dict[str, Any] = Field(default_factory=dict)
    hotspots: List[HotspotConfig] = Field(default_factory=list)
    contacts: List[Dict[str, Any]] = Field(default_factory=list)
    contacts_gateway: Dict[str, Any] = Field(default_factory=lambda: {"hotspot_id": "default", "slot": 2})
    model_config = {"extra": "allow"}

    @model_validator(mode="after")
    def _normalize_api_key_mode_flags(self) -> "AppSettings":
        if self.gemini_use_first_key is None and self.gemini_use_other_keys is None:
            if self.gemini_use_first_key_only:
                self.gemini_use_first_key = True
                self.gemini_use_other_keys = False
            else:
                self.gemini_use_first_key = True
                self.gemini_use_other_keys = True
        else:
            self.gemini_use_first_key = True if self.gemini_use_first_key is None else bool(self.gemini_use_first_key)
            self.gemini_use_other_keys = True if self.gemini_use_other_keys is None else bool(self.gemini_use_other_keys)
            if not self.gemini_use_first_key and not self.gemini_use_other_keys:
                self.gemini_use_first_key = True
        self.gemini_use_first_key_only = bool(self.gemini_use_first_key and not self.gemini_use_other_keys)

        if self.groq_use_first_key is None and self.groq_use_other_keys is None:
            if self.groq_use_first_key_only:
                self.groq_use_first_key = True
                self.groq_use_other_keys = False
            else:
                self.groq_use_first_key = True
                self.groq_use_other_keys = True
        else:
            self.groq_use_first_key = True if self.groq_use_first_key is None else bool(self.groq_use_first_key)
            self.groq_use_other_keys = True if self.groq_use_other_keys is None else bool(self.groq_use_other_keys)
            if not self.groq_use_first_key and not self.groq_use_other_keys:
                self.groq_use_first_key = True
        self.groq_use_first_key_only = bool(self.groq_use_first_key and not self.groq_use_other_keys)
        return self

    def get_active_hotspot(self) -> Optional[HotspotConfig]:
        for hs in self.hotspots:
            if hs.id == self.active_hotspot_id:
                return hs
        return self.hotspots[0] if self.hotspots else None

def load_app_settings() -> AppSettings:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if not SETTINGS_FILE.exists():
        for def_path in (
            CONFIG_DIR / "default_settings.json",
            Path(__file__).resolve().parent.parent / "default_settings.json",
        ):
            if def_path.exists():
                try:
                    with open(def_path, "r", encoding="utf-8-sig") as f:
                        raw_def = json.load(f)
                    return AppSettings(**raw_def)
                except Exception as e:
                    print(f"[CONFIG] Error loading {def_path}: {e}")
        default_hs = HotspotConfig(id="default", name="Main Hotspot", autoconnect=False)
        return AppSettings(active_hotspot_id="default", hotspots=[default_hs])

    try:
        with open(SETTINGS_FILE, "r", encoding="utf-8-sig") as f:
            raw = json.load(f)

        # Migration from legacy single-hotspot settings.json
        if "hotspots" not in raw:
            hs = HotspotConfig(
                id="default",
                name="Main Hotspot",
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
            app_settings.hotspots.append(HotspotConfig(id="default", name="Main Hotspot"))
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
        default_hs = HotspotConfig(id="default", name="Main Hotspot")
        return AppSettings(active_hotspot_id="default", hotspots=[default_hs])

def save_app_settings(app_settings: AppSettings) -> None:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(app_settings.model_dump(), f, indent=2, ensure_ascii=False)