"""
ProxDMR Version Management

Правила версионирования:
- Веб-приложение (APP_VERSION): при любом ощутимом исправлении бага или введении новой функциональности прибавлять +0.01 к версии.
- Android APK (APK_VERSION): новая система версионирования начиная с 1.00. За средние и большие изменения добавлять по +0.01 к версии (1.00, 1.01, 1.02...).
- Всегда фиксировать дату последнего повышения версии (DD.MM.YYYY).
"""

import re
import zipfile
from pathlib import Path

APP_VERSION = "1.38"
APP_VERSION_DATE = "08.10.2026"

APK_VERSION = "1.30"
APK_VERSION_DATE = "05.10.2026"


def detect_apk_version(apk_path: Path | str | None = None) -> str:
    """Возвращает версию Android APK по новой системе версионирования."""
    return APK_VERSION


def get_apk_filename(apk_path: Path | str | None = None) -> str:
    """Возвращает имя скачиваемого APK-файла с включенным номером версии."""
    ver = detect_apk_version(apk_path)
    return f"ProxDMR-{ver}.apk"
