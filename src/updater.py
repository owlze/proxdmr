"""
ProxDMR System Updater Subsystem
Checks GitHub repository for new releases and updates ProxDMR codebase.
"""
import os
import sys
import json
import re
import time
import shutil
import tarfile
import threading
import logging
import urllib.request
import urllib.error
from pathlib import Path
from typing import Optional, Dict, Any, Tuple

try:
    from version import APP_VERSION, APP_VERSION_DATE
except ImportError:
    from src.version import APP_VERSION, APP_VERSION_DATE

logger = logging.getLogger("proxdmr.updater")

REPO_OWNER = "owlze"
REPO_NAME = "proxdmr"
GITHUB_API_BASE = f"https://api.github.com/repos/{REPO_OWNER}/{REPO_NAME}"
USER_AGENT = "ProxDMR-Updater/1.0"

SUPPORTED_LANGUAGES = ["ru", "en", "uk", "de", "es", "fr", "it"]

_update_cache: Dict[str, Any] = {
    "checked_at": 0,
    "ttl_sec": 300,  # 5 minutes cache
    "data": None
}


def parse_version_tuple(v_str: str) -> Tuple[int, ...]:
    if not v_str:
        return (0,)
    clean = re.sub(r'^[^\d]*', '', str(v_str).strip())
    parts = re.split(r'[-+.]', clean)
    nums = []
    for p in parts:
        try:
            nums.append(int(p))
        except ValueError:
            m = re.match(r'(\d+)', p)
            if m:
                nums.append(int(m.group(1)))
    return tuple(nums) if nums else (0,)


def parse_multilingual_notes(raw_body: str) -> Dict[str, str]:
    notes: Dict[str, str] = {}
    if not raw_body:
        return {l: "" for l in SUPPORTED_LANGUAGES}

    # 1. Look for <!-- lang:xx --> or <!-- xx --> blocks
    pattern = r'<!--\s*(?:lang:)?([a-z]{2})\s*-->([\s\S]*?)(?=<!--\s*(?:lang:)?[a-z]{2}\s*-->|$)'
    matches = list(re.finditer(pattern, raw_body, re.IGNORECASE))
    if matches:
        for m in matches:
            l = m.group(1).lower()
            content = m.group(2).strip()
            if l in SUPPORTED_LANGUAGES:
                notes[l] = content

    # 2. Look for markdown header patterns: ## 🇷🇺 or ## [ru] or ## Русский
    if not notes:
        lang_headers = {
            "ru": [r"##\s*\[?ru\]?", r"##.*🇷🇺.*", r"##.*русск.*"],
            "en": [r"##\s*\[?en\]?", r"##.*🇬🇧.*", r"##.*🇺🇸.*", r"##.*english.*"],
            "uk": [r"##\s*\[?uk\]?", r"##.*🇺🇦.*", r"##.*україн.*"],
            "de": [r"##\s*\[?de\]?", r"##.*🇩🇪.*", r"##.*deutsch.*"],
            "es": [r"##\s*\[?es\]?", r"##.*🇪🇸.*", r"##.*español.*"],
            "fr": [r"##\s*\[?fr\]?", r"##.*🇫🇷.*", r"##.*français.*"],
            "it": [r"##\s*\[?it\]?", r"##.*🇮🇹.*", r"##.*italiano.*"],
        }
        header_pattern = r'(?m)^##\s+([^\n]+)'
        sections = re.split(header_pattern, raw_body)
        if len(sections) > 1:
            for i in range(1, len(sections), 2):
                hdr = sections[i].lower()
                text = sections[i + 1].strip() if i + 1 < len(sections) else ""
                matched_lang = None
                for l_code, patterns in lang_headers.items():
                    if any(re.search(p, hdr, re.IGNORECASE) for p in patterns):
                        matched_lang = l_code
                        break
                if matched_lang:
                    notes[matched_lang] = f"## {sections[i]}\n\n{text}".strip()

    # Fallback to full body if no language segments parsed
    if not notes:
        for l in SUPPORTED_LANGUAGES:
            notes[l] = raw_body.strip()
    else:
        fallback = notes.get("en") or notes.get("ru") or next(iter(notes.values()), raw_body)
        for l in SUPPORTED_LANGUAGES:
            if not notes.get(l):
                notes[l] = fallback

    return notes


def check_for_updates(force: bool = False) -> Dict[str, Any]:
    global _update_cache
    now = time.time()
    if not force and _update_cache["data"] and (now - _update_cache["checked_at"] < _update_cache["ttl_sec"]):
        return _update_cache["data"]

    url = f"{GITHUB_API_BASE}/releases/latest"
    req = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
    )

    release_data = None
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            release_data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 404:
            logger.info("[UPDATER] No GitHub releases found (404), checking tags...")
            try:
                tags_url = f"{GITHUB_API_BASE}/tags"
                req_t = urllib.request.Request(
                    tags_url,
                    headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json"}
                )
                with urllib.request.urlopen(req_t, timeout=8) as resp_t:
                    tags = json.loads(resp_t.read().decode("utf-8"))
                    if tags and isinstance(tags, list):
                        latest_tag = tags[0]
                        release_data = {
                            "tag_name": latest_tag["name"],
                            "name": f"Release {latest_tag['name']}",
                            "body": "Обновление ProxDMR",
                            "published_at": "",
                            "html_url": f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases/tag/{latest_tag['name']}",
                            "tarball_url": latest_tag.get("tarball_url")
                        }
            except Exception as te:
                logger.warning(f"[UPDATER] Tags check failed: {te}")
        else:
            logger.warning(f"[UPDATER] GitHub HTTP {e.code}: {e.reason}")
    except Exception as e:
        logger.warning(f"[UPDATER] Failed to check GitHub updates: {e}")

    current_ver = APP_VERSION
    current_tuple = parse_version_tuple(current_ver)

    if not release_data:
        fallback_notes = {l: "" for l in SUPPORTED_LANGUAGES}
        local_notes_file = Path(__file__).resolve().parent / "data" / "latest_release_notes.md"
        if local_notes_file.exists():
            try:
                local_raw = local_notes_file.read_text(encoding="utf-8")
                fallback_notes = parse_multilingual_notes(local_raw)
            except Exception:
                pass
        res = {
            "status": "ok",
            "has_update": False,
            "current_version": current_ver,
            "current_date": APP_VERSION_DATE,
            "latest_version": current_ver,
            "release_name": f"v{current_ver}",
            "release_date": APP_VERSION_DATE,
            "release_url": f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases",
            "notes_by_lang": fallback_notes,
            "raw_notes": "",
            "tarball_url": ""
        }
        _update_cache["checked_at"] = now
        _update_cache["data"] = res
        return res

    latest_tag = release_data.get("tag_name", "").lstrip("v")
    latest_tuple = parse_version_tuple(latest_tag)
    has_update = latest_tuple > current_tuple

    raw_body = release_data.get("body", "") or ""
    notes_by_lang = parse_multilingual_notes(raw_body)

    # Fallback to local multilingual release notes if remote body has no multilingual tags
    if not any(notes_by_lang.values()) or not raw_body or "<!-- lang:" not in raw_body:
        local_notes_file = Path(__file__).resolve().parent / "data" / "latest_release_notes.md"
        if local_notes_file.exists():
            try:
                local_raw = local_notes_file.read_text(encoding="utf-8")
                local_notes = parse_multilingual_notes(local_raw)
                for l, txt in local_notes.items():
                    if txt and not notes_by_lang.get(l):
                        notes_by_lang[l] = txt
                if not raw_body:
                    raw_body = local_raw
            except Exception as le:
                logger.warning(f"[UPDATER] Could not read local release notes: {le}")

    tarball = release_data.get("tarball_url") or f"https://github.com/{REPO_OWNER}/{REPO_NAME}/archive/refs/tags/{release_data.get('tag_name')}.tar.gz"

    res = {
        "status": "ok",
        "has_update": has_update,
        "current_version": current_ver,
        "current_date": APP_VERSION_DATE,
        "latest_version": latest_tag,
        "release_name": release_data.get("name") or f"v{latest_tag}",
        "release_date": (release_data.get("published_at") or "")[:10],
        "release_url": release_data.get("html_url") or f"https://github.com/{REPO_OWNER}/{REPO_NAME}/releases",
        "notes_by_lang": notes_by_lang,
        "raw_notes": raw_body,
        "tarball_url": tarball
    }

    _update_cache["checked_at"] = now
    _update_cache["data"] = res
    return res


def schedule_restart(delay_sec: float = 1.5):
    """
    Terminates Python process cleanly after delay, triggering Docker to restart container.
    """
    def _do_exit():
        time.sleep(delay_sec)
        logger.info("[UPDATER] Triggering container restart (os._exit)...")
        os._exit(0)

    t = threading.Thread(target=_do_exit, daemon=True)
    t.start()


def apply_update(tarball_url: Optional[str] = None) -> Tuple[bool, str]:
    """
    Downloads update archive from GitHub, backups current src,
    replaces files, and schedules process restart.
    """
    info = check_for_updates(force=True)
    download_url = tarball_url or info.get("tarball_url")
    if not download_url:
        return False, "Не найден URL для скачивания обновления"

    app_root = Path("/app")
    if not (app_root / "src").exists():
        # Fallback to local script directory
        app_root = Path(__file__).resolve().parent.parent

    src_dir = app_root / "src"
    config_dir = app_root / "config"
    backups_dir = config_dir / "backups"
    backups_dir.mkdir(parents=True, exist_ok=True)

    # 1. Create backup of current src
    backup_file = backups_dir / f"src_backup_{APP_VERSION}_{int(time.time())}.tar.gz"
    try:
        with tarfile.open(backup_file, "w:gz") as tar:
            tar.add(src_dir, arcname="src")
        logger.info(f"[UPDATER] Backup created: {backup_file}")
    except Exception as e:
        logger.warning(f"[UPDATER] Failed to create backup: {e}")

    # 2. Download tarball
    tmp_archive = Path("/tmp/proxdmr_update.tar.gz")
    extract_dir = Path("/tmp/proxdmr_extracted")
    if extract_dir.exists():
        shutil.rmtree(extract_dir, ignore_errors=True)
    extract_dir.mkdir(parents=True, exist_ok=True)

    try:
        req = urllib.request.Request(
            download_url,
            headers={"User-Agent": USER_AGENT, "Accept": "application/octet-stream"}
        )
        with urllib.request.urlopen(req, timeout=30) as resp, open(tmp_archive, "wb") as f:
            shutil.copyfileobj(resp, f)

        logger.info(f"[UPDATER] Downloaded {tmp_archive.stat().st_size} bytes")

        # 3. Extract tarball
        with tarfile.open(tmp_archive, "r:*") as tar:
            tar.extractall(extract_dir)

        # GitHub archives typically contain a top-level root folder e.g. owlze-proxdmr-sha/
        subdirs = [p for p in extract_dir.iterdir() if p.is_dir()]
        root_extracted = subdirs[0] if subdirs else extract_dir

        new_src = root_extracted / "src"
        if not new_src.exists():
            return False, "В скачанном обновлении отсутствует директория src"

        # 4. Copy updated files to /app/src, skipping data/ directory
        for item in new_src.iterdir():
            target_item = src_dir / item.name
            if item.name == "data":
                continue  # Never touch data directory
            if item.is_dir():
                shutil.copytree(item, target_item, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target_item)

        # Copy any root files if present (requirements.txt, README.md, etc.)
        for root_item in ["requirements.txt", "README.md", "Dockerfile", "docker-compose.yml"]:
            src_f = root_extracted / root_item
            if src_f.exists():
                try:
                    shutil.copy2(src_f, app_root / root_item)
                except Exception:
                    pass

        logger.info("[UPDATER] Update applied successfully to codebase.")

        # Cleanup tmp files
        try:
            if tmp_archive.exists():
                tmp_archive.unlink()
            if extract_dir.exists():
                shutil.rmtree(extract_dir, ignore_errors=True)
        except Exception:
            pass

        # Schedule restart
        schedule_restart(1.5)
        return True, "Обновление успешно установлено! Перезапуск сервера..."

    except Exception as e:
        logger.error(f"[UPDATER] Update failed: {e}", exc_info=True)
        return False, f"Ошибка установки обновления: {e}"
