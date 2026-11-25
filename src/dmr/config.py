import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

try:
    from config import (
        CONFIG_DIR,
        SETTINGS_FILE,
        HotspotConfig,
        AppSettings,
        load_app_settings,
        save_app_settings,
    )
except ImportError:
    from src.config import (
        CONFIG_DIR,
        SETTINGS_FILE,
        HotspotConfig,
        AppSettings,
        load_app_settings,
        save_app_settings,
    )

__all__ = [
    "CONFIG_DIR",
    "SETTINGS_FILE",
    "HotspotConfig",
    "AppSettings",
    "load_app_settings",
    "save_app_settings",
]
