"""
Piper TTS Service for ProxDMR.
Handles local neural speech synthesis, voice catalog management,
model downloading from Hugging Face, and in-memory model caching.
"""

import asyncio
import io
import json
import logging
import os
import re
import threading
import time
import urllib.request
import wave
from collections import OrderedDict
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.piper")

BASE_HF_URL = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"


def get_base_dir() -> str:
    """Returns the base project directory."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_voices_dir() -> str:
    """Returns the directory where downloaded Piper models are stored."""
    # Inside docker: /app/config/piper_voices
    # On host: Y:/ProxDMR/config/piper_voices
    candidate = os.path.join(get_base_dir(), "config", "piper_voices")
    os.makedirs(candidate, exist_ok=True)
    return candidate


def get_catalog_path() -> str:
    """Returns path to piper_voices.json."""
    return os.path.join(get_base_dir(), "src", "data", "piper_voices.json")


# Gender mapping heuristics for well-known Piper models
MALE_NAMES = {
    "ruslan", "denis", "dmitri", "ryan", "alan", "danny", "joe", "john",
    "bryce", "kusal", "mike", "norman", "thorsten", "thorsten_emotional", "karlsson", "riccardo",
    "gilles", "tom", "carlfm", "davefx", "mykyta", "oleksa", "pierre",
    "claude", "ald", "sushkov_v4", "sushkov", "mc_speech", "bass", "igm3804", "igm",
    "dfki", "dimitar", "jirka", "mihai", "chaowen", "kareem", "harri", "imre",
    "faber", "cadu", "tugao", "hi_fi_captain", "rdh", "talesyntese", "nvcc", "saspeech"
}

FEMALE_NAMES = {
    "irina", "amy", "alba", "jenny_dioco", "kathleen", "kristin", "lessac",
    "lada", "tetiana", "eva_k", "kerstin", "ramona", "paola", "serena",
    "siwis", "jessica", "daniela", "terra5871", "cori", "sharvard", "gosia",
    "kasandra", "kss", "huayan", "alma", "lisa", "berta", "anna", "joy",
    "rapunzelina", "nathalie"
}

VOICE_FRIENDLY_NAMES = {
    "terra5871": "Terra",
    "sushkov_v4": "Sushkov",
    "igm3804": "IGM",
    "igm": "IGM",
    "ukrainian_tts": "Ukrainian TTS",
    "thorsten_emotional": "Thorsten (Emotional)",
    "mc_speech": "MC Speech",
    "southern_english_female": "Southern English",
    "northern_english_male": "Northern English",
    "dfki": "DFKI",
    "hi_fi_captain": "Hi-Fi Captain",
    "talesyntese": "Talesyntese",
    "saspeech": "SASpeech",
}

LANG_PREFS: Dict[str, List[str]] = {
    "ru": ["ru_RU-igm3804-medium", "ru_RU-sushkov_v4-medium", "ru_RU-terra5871-medium"],
    "en": ["en_US-bryce-medium", "en_GB-alan-medium", "en_US-amy-medium"],
    "uk": ["uk_UA-ukrainian_tts-medium", "uk_UA-mykyta-high", "uk_UA-tetiana-high"],
    "de": ["de_DE-thorsten-medium", "de_DE-thorsten_emotional-medium"],
    "fr": ["fr_FR-siwis-medium", "fr_FR-upmc-medium"],
    "es": ["es_ES-davefx-medium", "es_ES-sharvard-medium"],
    "it": ["it_IT-paola-medium", "it_IT-serena-medium", "it_IT-riccardo-x_low"],
    "pl": ["pl_PL-darkman-medium", "pl_PL-gosia-medium"],
    "tr": ["tr_TR-dfki-medium"],
    "pt": ["pt_BR-faber-medium", "pt_BR-cadu-medium", "pt_PT-tugao-medium"],
    "nl": ["nl_BE-nathalie-medium", "nl_NL-mls-medium"],
    "cs": ["cs_CZ-jirka-medium", "cs_CZ-kasandra-medium"],
    "ro": ["ro_RO-mihai-medium"],
    "bg": ["bg_BG-dimitar-medium"],
    "el": ["el_GR-rapunzelina-medium", "el_GR-joy-medium"],
    "hu": ["hu_HU-berta-medium", "hu_HU-anna-medium", "hu_HU-imre-medium"],
    "sv": ["sv_SE-lisa-medium", "sv_SE-alma-medium"],
    "no": ["no_NO-talesyntese-medium", "no_NO-nvcc-medium"],
    "fi": ["fi_FI-harri-medium"],
    "da": ["da_DK-talesyntese-medium"],
    "he": ["he_IL-saspeech-medium"],
    "ar": ["ar_JO-kareem-medium"],
    "ja": ["ja_JP-hi_fi_captain-medium"],
    "zh": ["zh_CN-huayan-medium", "zh_CN-chaowen-medium"],
    "ko": ["ko_KR-kss-medium"],
}


def get_piper_service() -> "PiperService":
    """Returns the PiperService singleton instance."""
    return PiperService.get_instance()


def format_voice_name(voice_id: str, raw_name: str) -> str:
    """Formats voice name for user display."""
    norm = raw_name.lower().strip()
    if norm in VOICE_FRIENDLY_NAMES:
        return VOICE_FRIENDLY_NAMES[norm]
    return raw_name.replace("_", " ").title()


def resolve_voice_gender(name: str, catalog_gender: Optional[str] = None) -> str:
    """Resolves gender from catalog or name heuristics."""
    if catalog_gender in ("male", "female", "neutral"):
        return catalog_gender
    norm = name.lower().strip()
    if norm in MALE_NAMES:
        return "male"
    if norm in FEMALE_NAMES:
        return "female"
    return "neutral"


class PiperService:
    _instance: Optional["PiperService"] = None
    _lock = threading.Lock()

    def __init__(self):
        self.voices_dir = get_voices_dir()
        self.catalog_path = get_catalog_path()
        self._catalog: Optional[Dict[str, Any]] = None
        self._loaded_voices: OrderedDict[str, Any] = OrderedDict()
        self._loaded_voice: Optional[Any] = None
        self._loaded_voice_id: Optional[str] = None
        self._synth_lock = threading.RLock()
        self._dl_lock = threading.Lock()
        self._downloads: Dict[str, Dict[str, Any]] = {}

    @classmethod
    def get_instance(cls) -> "PiperService":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def load_catalog(self, force_reload: bool = False) -> Dict[str, Any]:
        """Loads and returns the Piper voices catalog."""
        try:
            mtime = os.path.getmtime(self.catalog_path) if os.path.exists(self.catalog_path) else 0
        except OSError:
            mtime = 0
        if self._catalog is not None and not force_reload and getattr(self, "_catalog_mtime", 0) == mtime:
            return self._catalog

        if os.path.exists(self.catalog_path):
            try:
                with open(self.catalog_path, "r", encoding="utf-8") as f:
                    self._catalog = json.load(f)
                    self._catalog_mtime = mtime
                    return self._catalog
            except Exception as e:
                logger.error(f"[PIPER] Error reading voices catalog from {self.catalog_path}: {e}")

        # Fallback empty
        self._catalog = {}
        self._catalog_mtime = 0
        return self._catalog

    def find_model_files(self, voice_id: str) -> Tuple[Optional[str], Optional[str]]:
        """
        Locates the .onnx and .onnx.json files for a given voice_id.
        Searches recursively inside self.voices_dir.
        """
        target_onnx = f"{voice_id}.onnx"
        target_json = f"{voice_id}.onnx.json"

        found_onnx = None
        found_json = None

        for root, _, files in os.walk(self.voices_dir):
            for f in files:
                if f == target_onnx:
                    found_onnx = os.path.join(root, f)
                elif f == target_json:
                    found_json = os.path.join(root, f)

        if found_onnx and found_json:
            return found_onnx, found_json
        return None, None

    def is_voice_installed(self, voice_id: str) -> bool:
        """Returns True if the voice model files exist on disk."""
        onnx_path, json_path = self.find_model_files(voice_id)
        if onnx_path and json_path:
            return os.path.getsize(onnx_path) > 1000 and os.path.getsize(json_path) > 100
        return False

    def list_installed_voices(self) -> List[Dict[str, Any]]:
        """Returns a list of all installed Piper voice models."""
        installed = []
        catalog = self.load_catalog()

        for root, _, files in os.walk(self.voices_dir):
            for f in files:
                if f.endswith(".onnx") and not f.endswith(".onnx.json"):
                    voice_id = f[:-5]
                    json_file = os.path.join(root, f"{voice_id}.onnx.json")
                    if os.path.exists(json_file):
                        onnx_path = os.path.join(root, f)
                        size_mb = round(os.path.getsize(onnx_path) / (1024 * 1024), 1)

                        info = catalog.get(voice_id, {})
                        lang_info = info.get("language", {})
                        code = lang_info.get("code", "")
                        lang_short = code.split("_")[0] if code else "unknown"

                        raw_name = info.get("name", voice_id.split("-")[1] if "-" in voice_id else voice_id)
                        name = format_voice_name(voice_id, raw_name)
                        quality = info.get("quality", voice_id.split("-")[-1] if "-" in voice_id else "medium")

                        gender = resolve_voice_gender(raw_name, info.get("gender"))

                        installed.append({
                            "id": voice_id,
                            "name": name,
                            "language_code": code,
                            "lang_short": lang_short,
                            "country": lang_info.get("country_english", ""),
                            "quality": quality,
                            "gender": gender,
                            "size_mb": size_mb,
                            "installed": True
                        })

        installed.sort(key=lambda x: (x["lang_short"], x["name"]))
        return installed

    def get_voices_for_lang(self, lang: str, force_reload: bool = False) -> List[Dict[str, Any]]:
        """
        Returns all voices for the specified language code (e.g. 'ru', 'en', 'uk', 'de').
        Both installed and available for download.
        """
        catalog = self.load_catalog(force_reload=force_reload)
        lang = lang.lower().strip()
        results = []

        for voice_id, v in catalog.items():
            code = v.get("language", {}).get("code", "")
            lang_short = code.split("_")[0].lower() if code else ""
            if lang_short == lang or code.lower() == lang:
                is_inst = self.is_voice_installed(voice_id)
                files = v.get("files", {})
                onnx_files = [f for f in files if f.endswith(".onnx") and not f.endswith(".onnx.json")]
                size_mb = round(files[onnx_files[0]]["size_bytes"] / (1024 * 1024), 1) if onnx_files else 60.0

                raw_name = v.get("name", "")
                name = format_voice_name(voice_id, raw_name)
                gender = resolve_voice_gender(raw_name, v.get("gender"))

                results.append({
                    "id": voice_id,
                    "name": name,
                    "language_code": code,
                    "lang_short": lang_short,
                    "quality": v.get("quality", "medium"),
                    "gender": gender,
                    "size_mb": size_mb,
                    "installed": is_inst,
                    "num_speakers": v.get("num_speakers", 1)
                })

        # Sort: installed first, then by quality (medium, high, low), then name
        def sort_voice(x):
            q_order = 0 if x["quality"] == "medium" else (1 if x["quality"] == "high" else 2)
            inst_order = 0 if x["installed"] else 1
            return (inst_order, q_order, x["name"])

        results.sort(key=sort_voice)
        return results

    def is_lang_supported(self, lang: str) -> bool:
        """Returns True if the Piper catalog has any voices for this language code."""
        catalog = self.load_catalog()
        lang = lang.lower().strip()
        for v in catalog.values():
            code = v.get("language", {}).get("code", "")
            if code and code.split("_")[0].lower() == lang:
                return True
        return False

    def has_installed_voice_for_lang(self, lang: str) -> bool:
        """Returns True if at least one voice is installed for this language."""
        voices = self.get_voices_for_lang(lang)
        return any(v["installed"] for v in voices)

    def get_voice_lang(self, voice_id: Optional[str]) -> str:
        """Returns 2-letter ISO language code for voice_id (e.g. 'ru', 'en', 'de', 'uk', 'es')."""
        if not voice_id:
            return ""
        catalog = self.load_catalog()
        if voice_id in catalog:
            code = catalog[voice_id].get("language", {}).get("code", "")
            if code:
                return code.split("_")[0].lower()
        m = re.match(r"^([a-z]{2,3})[_-]", voice_id.lower())
        if m:
            return m.group(1)
        return ""

    def get_installed_voice_for_lang(self, lang: str) -> Optional[str]:
        """Returns the ID of the preferred installed voice for this language, or None if none installed."""
        clean_lang = (lang or "").lower().strip()
        voices = self.get_voices_for_lang(clean_lang)
        installed = [v for v in voices if v.get("installed")]
        if not installed:
            return None

        prefs = LANG_PREFS.get(clean_lang, [])
        for p in prefs:
            match = next((v for v in installed if v["id"] == p), None)
            if match:
                return match["id"]

        for v in installed:
            if v.get("gender") == "male":
                return v["id"]
        return installed[0]["id"]

    def is_voice_loaded(self, voice_id: Optional[str]) -> bool:
        """Returns True if the voice model is already loaded in RAM."""
        if not voice_id:
            return False
        return (voice_id in self._loaded_voices) or (self._loaded_voice is not None and self._loaded_voice_id == voice_id)

    def is_voice_ready_for_lang(self, lang: str, voice_id: Optional[str] = None) -> Tuple[bool, Optional[str], str]:
        """
        Verifies if a voice is ready for speech synthesis in the given language.
        Returns (ready, resolved_voice_id, reason).
        """
        clean_lang = (lang or "").lower().strip()
        if not clean_lang or clean_lang == "none":
            clean_lang = "ru"

        target_v = voice_id
        # Discard voice_id if it belongs to another language or is auto
        if target_v:
            v_lang = self.get_voice_lang(target_v)
            if v_lang and v_lang != clean_lang:
                target_v = None

        if not target_v or target_v in ("auto", "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Zephyr", "Despina", "Achernar", "Orus", "Iapetus"):
            target_v = self.get_installed_voice_for_lang(clean_lang)
            if not target_v:
                target_v = self.get_default_voice_for_lang(clean_lang)

        if not target_v:
            return False, None, "no_voice_available"

        v_lang = self.get_voice_lang(target_v)
        if v_lang and v_lang != clean_lang:
            return False, target_v, f"mismatch_{v_lang}_vs_{clean_lang}"

        if not self.is_voice_installed(target_v):
            dl_st = self.get_download_status(target_v)
            if dl_st.get("status") == "downloading":
                return False, target_v, "downloading"
            return False, target_v, "not_installed"

        return True, target_v, "ready"

    async def preload_voice_async(self, voice_id: str) -> bool:
        """Preloads voice model into RAM in worker thread if installed."""
        if not voice_id or not self.is_voice_installed(voice_id):
            return False
        if self.is_voice_loaded(voice_id):
            return True
        try:
            await asyncio.to_thread(self._get_or_load_voice, voice_id)
            return True
        except Exception as e:
            logger.error(f"[PIPER] Preload error for '{voice_id}': {e}")
            return False

    def get_default_voice_for_lang(self, lang: str) -> Optional[str]:
        """Returns the default installed or recommended voice for a language."""
        clean_lang = (lang or "").lower().strip()
        voices = self.get_voices_for_lang(clean_lang)
        if not voices:
            return None

        prefs = LANG_PREFS.get(clean_lang, [])

        # 1. Preferred installed voice
        for p in prefs:
            match = next((v for v in voices if v["id"] == p and v["installed"]), None)
            if match:
                return match["id"]

        # 2. Any installed male voice
        for v in voices:
            if v["installed"] and v["gender"] == "male":
                return v["id"]

        # 3. Any installed voice
        for v in voices:
            if v["installed"]:
                return v["id"]

        # 4. Preferred voice from catalog even if not yet installed
        for p in prefs:
            match = next((v for v in voices if v["id"] == p), None)
            if match:
                return match["id"]

        # 5. Any male voice in catalog
        for v in voices:
            if v["gender"] == "male":
                return v["id"]

        return voices[0]["id"]

    def get_download_status(self, voice_id: str) -> Dict[str, Any]:
        """Returns current download status for a voice."""
        return self._downloads.get(voice_id, {
            "voice_id": voice_id,
            "status": "idle",
            "progress": 0,
            "error": None
        })

    def get_any_active_download_status(self) -> Dict[str, Any]:
        """Returns download status of any active download, or latest finished/idle."""
        with self._dl_lock:
            for st in reversed(list(self._downloads.values())):
                if st.get("status") == "downloading":
                    return st
            if self._downloads:
                return list(self._downloads.values())[-1]
            return {
                "voice_id": "",
                "status": "idle",
                "progress": 0,
                "error": None
            }

    def start_download(self, voice_id: str) -> Dict[str, Any]:
        """Starts asynchronous download of a voice model in a background thread."""
        with self._dl_lock:
            # If already installed on disk, return completed immediately
            if self.is_voice_installed(voice_id):
                status = {
                    "voice_id": voice_id,
                    "status": "completed",
                    "progress": 100,
                    "error": None,
                    "timestamp": time.time()
                }
                self._downloads[voice_id] = status
                return status

            if voice_id in self._downloads and self._downloads[voice_id].get("status") == "downloading":
                return self._downloads[voice_id]

            if len(self._downloads) > 50:
                for k in list(self._downloads.keys())[:-20]:
                    if self._downloads[k].get("status") in ("completed", "error"):
                        self._downloads.pop(k, None)

            status = {
                "voice_id": voice_id,
                "status": "downloading",
                "progress": 0,
                "error": None,
                "timestamp": time.time()
            }
            self._downloads[voice_id] = status

        def _worker():
            dest_onnx_tmp = None
            dest_json_tmp = None
            dest_onnx = None
            dest_json = None
            try:
                catalog = self.load_catalog()
                if voice_id not in catalog:
                    with self._dl_lock:
                        status["status"] = "error"
                        status["error"] = f"Voice {voice_id} not found in catalog"
                        status["timestamp"] = time.time()
                    return

                v_info = catalog[voice_id]
                files = v_info.get("files", {})
                onnx_rel = next((f for f in files if f.endswith(".onnx") and not f.endswith(".onnx.json")), None)
                json_rel = next((f for f in files if f.endswith(".onnx.json")), None)

                if not onnx_rel or not json_rel:
                    with self._dl_lock:
                        status["status"] = "error"
                        status["error"] = "Model files not found in catalog specification"
                        status["timestamp"] = time.time()
                    return

                lang_code = v_info.get("language", {}).get("code", "unknown")
                target_subdir = os.path.join(self.voices_dir, lang_code)
                os.makedirs(target_subdir, exist_ok=True)

                dest_onnx = os.path.join(target_subdir, f"{voice_id}.onnx")
                dest_json = os.path.join(target_subdir, f"{voice_id}.onnx.json")
                dest_onnx_tmp = os.path.join(target_subdir, f"{voice_id}.onnx.tmp")
                dest_json_tmp = os.path.join(target_subdir, f"{voice_id}.onnx.json.tmp")

                # Download json config to tmp
                url_json = v_info.get("url_json")
                if not url_json:
                    if json_rel.startswith("http://") or json_rel.startswith("https://"):
                        url_json = json_rel
                    else:
                        url_json = f"{BASE_HF_URL}{json_rel}"

                req_json = urllib.request.Request(url_json, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req_json, timeout=30) as resp, open(dest_json_tmp, "wb") as f_out:
                    f_out.write(resp.read())

                if os.path.getsize(dest_json_tmp) < 100:
                    raise IOError(f"Downloaded config file for '{voice_id}' is invalid or empty")

                # Download onnx model with progress to tmp
                url_onnx = v_info.get("url_onnx")
                if not url_onnx:
                    if onnx_rel.startswith("http://") or onnx_rel.startswith("https://"):
                        url_onnx = onnx_rel
                    else:
                        url_onnx = f"{BASE_HF_URL}{onnx_rel}"

                req_onnx = urllib.request.Request(url_onnx, headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req_onnx, timeout=60) as resp, open(dest_onnx_tmp, "wb") as f_out:
                    total_size = int(resp.headers.get("content-length", 0))
                    downloaded = 0
                    chunk_size = 512 * 1024
                    while True:
                        chunk = resp.read(chunk_size)
                        if not chunk:
                            break
                        f_out.write(chunk)
                        downloaded += len(chunk)
                        if total_size > 0:
                            status["progress"] = min(99, int(downloaded * 100 / total_size))

                expected_size = total_size or files.get(onnx_rel, {}).get("size_bytes", 0)
                if expected_size > 0 and downloaded < expected_size:
                    raise IOError(f"Incomplete download for {voice_id}: got {downloaded} of {expected_size} bytes")

                if os.path.getsize(dest_onnx_tmp) < 1000:
                    raise IOError(f"Downloaded model file {voice_id} is too small or corrupted")

                # Atomic replace into target files
                os.replace(dest_json_tmp, dest_json)
                os.replace(dest_onnx_tmp, dest_onnx)

                with self._dl_lock:
                    status["progress"] = 100
                    status["status"] = "completed"
                    status["timestamp"] = time.time()

                try:
                    os.chmod(target_subdir, 0o755)
                    if os.path.exists(dest_json):
                        os.chmod(dest_json, 0o644)
                    if os.path.exists(dest_onnx):
                        os.chmod(dest_onnx, 0o644)
                except Exception as perm_err:
                    logger.debug(f"[PIPER] Could not chmod voice files: {perm_err}")

                logger.info(f"[PIPER] Voice {voice_id} successfully downloaded to {dest_onnx}")

            except Exception as e:
                logger.error(f"[PIPER] Failed to download voice {voice_id}: {e}")
                with self._dl_lock:
                    status["status"] = "error"
                    status["error"] = str(e)
                    status["timestamp"] = time.time()
                for p in (dest_onnx_tmp, dest_json_tmp):
                    if p and os.path.exists(p):
                        try:
                            os.remove(p)
                        except Exception:
                            pass

        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        return status

    def _get_or_load_voice(self, voice_id: str) -> Any:
        """Loads and caches the PiperVoice instance in memory."""
        import piper.voice

        with self._synth_lock:
            if voice_id in self._loaded_voices:
                # LRU: перемещаем в конец списка
                voice = self._loaded_voices.pop(voice_id)
                self._loaded_voices[voice_id] = voice
                self._loaded_voice = voice
                self._loaded_voice_id = voice_id
                return voice

            onnx_path, json_path = self.find_model_files(voice_id)
            if not onnx_path or not json_path:
                raise FileNotFoundError(f"Piper voice model '{voice_id}' not found on disk")

            logger.info(f"[PIPER] Loading voice model '{voice_id}' from {onnx_path}...")
            voice = piper.voice.PiperVoice.load(onnx_path, json_path)

            # Limit ONNX runtime to 2 threads to prevent CPU starvation on Synology NAS
            try:
                if hasattr(voice, "session") and voice.session:
                    opts = voice.session.get_session_options()
                    opts.intra_op_num_threads = 2
                    opts.inter_op_num_threads = 1
            except Exception as e:
                logger.debug(f"[PIPER] Could not set session options: {e}")

            # Evict oldest voice if cache exceeds 3 models (each ONNX is ~60-120 MB)
            while len(self._loaded_voices) >= 3:
                try:
                    oldest_key, _ = self._loaded_voices.popitem(last=False)
                    logger.info(f"[PIPER] Evicting cached voice '{oldest_key}' from RAM to free memory")
                    if self._loaded_voice_id == oldest_key:
                        self._loaded_voice = None
                        self._loaded_voice_id = None
                except Exception:
                    break

            self._loaded_voices[voice_id] = voice
            self._loaded_voice = voice
            self._loaded_voice_id = voice_id
            return voice

    def synthesize(
        self,
        text: str,
        voice_id: Optional[str] = None,
        speed: float = 1.0,
        noise_scale: float = 0.7,
        noise_w: float = 0.8,
        speaker_id: Optional[int] = None
    ) -> Tuple[Optional[bytes], int, Optional[str]]:
        """
        Synchronously synthesizes speech from text using Piper.
        Returns: (wav_bytes, sample_rate, error_message)
        """
        if not text or not text.strip():
            return None, 0, "Текст для синтеза пуст"

        if not voice_id or not voice_id.strip():
            return None, 0, "Голос для синтеза речи не указан"

        voice_lang = self.get_voice_lang(voice_id) or "ru"
        try:
            from tts_normalizer import filter_piper_text_by_language
            text = filter_piper_text_by_language(text, target_lang=voice_lang)
        except Exception as e:
            logger.warning(f"[PIPER] Error filtering foreign text for voice '{voice_id}' ({voice_lang}): {e}")

        if not text or not text.strip():
            return None, 0, "Текст для синтеза пуст (отфильтрован как чужеродный язык)"

        if "+" in text:
            try:
                from tts_normalizer import convert_plus_stress_to_acute
                text = convert_plus_stress_to_acute(text)
            except Exception:
                pass

        import piper.config

        with self._synth_lock:
            try:
                voice = self._get_or_load_voice(voice_id)

                # Length scale is the inverse of speed
                # Clamp speed between 0.5x and 2.5x
                clamped_speed = max(0.5, min(2.5, float(speed)))
                length_scale = 1.0 / clamped_speed

                # Sample rate from model config (usually 22050 or 16000)
                sample_rate = getattr(voice.config, "sample_rate", 22050)

                syn_config = piper.config.SynthesisConfig(
                    speaker_id=speaker_id,
                    length_scale=length_scale,
                    noise_scale=float(noise_scale),
                    noise_w_scale=float(noise_w),
                    normalize_audio=True
                )

                buf = io.BytesIO()
                wav_file = wave.open(buf, "wb")
                try:
                    voice.synthesize_wav(
                        text,
                        wav_file,
                        syn_config=syn_config
                    )
                    wav_file.close()
                except Exception as synth_err:
                    try:
                        wav_file._file = None
                    except Exception:
                        pass
                    raise synth_err

                wav_bytes = buf.getvalue()
                return wav_bytes, sample_rate, None

            except Exception as e:
                logger.error(f"[PIPER] Synthesis exception for voice '{voice_id}': {e}", exc_info=True)
                return None, 0, str(e)

    async def synthesize_async(
        self,
        text: str,
        voice_id: Optional[str] = None,
        speed: float = 1.0,
        noise_scale: float = 0.7,
        noise_w: float = 0.8,
        speaker_id: Optional[int] = None
    ) -> Tuple[Optional[bytes], int, Optional[str]]:
        """Asynchronously synthesizes speech in a worker thread."""
        return await asyncio.to_thread(
            self.synthesize,
            text=text,
            voice_id=voice_id,
            speed=speed,
            noise_scale=noise_scale,
            noise_w=noise_w,
            speaker_id=speaker_id
        )
