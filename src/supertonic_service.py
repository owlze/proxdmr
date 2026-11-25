"""
Supertonic 3 Local ONNX TTS Service for ProxDMR.
Handles on-demand downloading of the multilingual Supertonic 3 ONNX core (~380 MB)
and voice style JSONs (~0.3 MB each) into persistent config/supertonic3,
voice catalog & readiness checks, and local CPU speech synthesis (44.1 kHz WAV).
"""

import asyncio
import importlib.util
import inspect
import io
import logging
import os
import re
import threading
import time
import urllib.request
import wave
from typing import Any, Dict, List, Optional, Tuple

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

logger = logging.getLogger("proxdmr.supertonic")

BASE_HF_URL = "https://huggingface.co/Supertone/supertonic-3/resolve/main/"

SUPERTONIC_SUPPORTED_LANGUAGES: Tuple[str, ...] = (
    "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fi",
    "fr", "hi", "hr", "hu", "id", "it", "ja", "ko", "lt", "lv",
    "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi",
)
_SUPPORTED_LANG_SET = frozenset(SUPERTONIC_SUPPORTED_LANGUAGES)

# 6 core ONNX/config files (~379.9 MB total)
SUPERTONIC_CORE_FILES: List[Dict[str, Any]] = [
    {"rel": "onnx/tts.json", "min_bytes": 100, "approx_bytes": 10_000},
    {"rel": "onnx/unicode_indexer.json", "min_bytes": 10_000, "approx_bytes": 270_000},
    {"rel": "onnx/duration_predictor.onnx", "min_bytes": 500_000, "approx_bytes": 3_700_000},
    {"rel": "onnx/text_encoder.onnx", "min_bytes": 5_000_000, "approx_bytes": 36_400_000},
    {"rel": "onnx/vocoder.onnx", "min_bytes": 20_000_000, "approx_bytes": 101_400_000},
    {"rel": "onnx/vector_estimator.onnx", "min_bytes": 100_000_000, "approx_bytes": 256_500_000},
]

CORE_TOTAL_SIZE_MB = 380
VOICE_STYLE_SIZE_MB = 0.3
VOICE_STYLE_APPROX_BYTES = 295_000
VOICE_STYLE_MIN_BYTES = 10_000

# Supertonic 3 synthesis quality & experimental prosody boost
SUPERTONIC_TOTAL_STEPS = 8
SUPERTONIC_BOOST_PUNCTUATION = True
# Set True to restore amateur radio abbreviation expansion & Latin transliteration for Supertonic 3
SUPERTONIC_EXPAND_RADIO_ABBREVIATIONS = False
_SINGLE_EMPHATIC_PUNCT_RE = re.compile(r"(?<![?!])([?!])(?![?!])")


def boost_punctuation_for_supertonic(text: str) -> str:
    """
    Experimental prosody boost for Supertonic 3:
    doubles standalone '?' -> '??' and '!' -> '!!' while preserving
    already repeated/mixed sequences ('??', '!!!', '?!', '!?').
    """
    if not text:
        return text
    return _SINGLE_EMPHATIC_PUNCT_RE.sub(r"\1\1", text)


SUPERTONIC_VOICES: List[Dict[str, Any]] = [
    {"id": "M1", "name": "M1 — Male 1", "gender": "male", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/M1.json"},
    {"id": "M2", "name": "M2 — Male 2", "gender": "male", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/M2.json"},
    {"id": "M3", "name": "M3 — Male 3", "gender": "male", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/M3.json"},
    {"id": "M4", "name": "M4 — Male 4", "gender": "male", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/M4.json"},
    {"id": "M5", "name": "M5 — Male 5", "gender": "male", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/M5.json"},
    {"id": "F1", "name": "F1 — Female 1", "gender": "female", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/F1.json"},
    {"id": "F2", "name": "F2 — Female 2", "gender": "female", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/F2.json"},
    {"id": "F3", "name": "F3 — Female 3", "gender": "female", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/F3.json"},
    {"id": "F4", "name": "F4 — Female 4", "gender": "female", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/F4.json"},
    {"id": "F5", "name": "F5 — Female 5", "gender": "female", "size_mb": VOICE_STYLE_SIZE_MB, "style_rel": "voice_styles/F5.json"},
]

_VOICE_MAP: Dict[str, Dict[str, Any]] = {v["id"]: v for v in SUPERTONIC_VOICES}


def get_base_dir() -> str:
    """Returns the base project directory."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def get_model_dir() -> str:
    """Returns persistent directory for Supertonic 3 ONNX core and voice styles."""
    candidate = os.path.join(get_base_dir(), "config", "supertonic3")
    os.makedirs(os.path.join(candidate, "onnx"), exist_ok=True)
    os.makedirs(os.path.join(candidate, "voice_styles"), exist_ok=True)
    return candidate


def get_supertonic_service() -> "SupertonicService":
    """Returns the SupertonicService singleton instance."""
    return SupertonicService.get_instance()


class SupertonicService:
    _instance: Optional["SupertonicService"] = None
    _init_lock = threading.Lock()

    def __init__(self):
        self.model_dir = get_model_dir()
        self._synth_lock = threading.RLock()
        self._dl_lock = threading.Lock()
        self._downloads: Dict[str, Dict[str, Any]] = {}
        self._tts: Optional[Any] = None
        self._style_cache: Dict[str, Any] = {}
        self._sdk_available: Optional[bool] = None

    @classmethod
    def get_instance(cls) -> "SupertonicService":
        if cls._instance is None:
            with cls._init_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    @staticmethod
    def normalize_lang(lang: Optional[str]) -> str:
        """Normalizes ProxDMR language code (lowercase, strips region, ua -> uk)."""
        if not lang:
            return "ru"
        clean = str(lang).strip().lower()
        if "-" in clean:
            clean = clean.split("-", 1)[0]
        if "_" in clean:
            clean = clean.split("_", 1)[0]
        if clean == "ua":
            clean = "uk"
        return clean

    @staticmethod
    def normalize_voice_id(voice_id: Optional[str]) -> Optional[str]:
        if not voice_id:
            return None
        clean = str(voice_id).strip().upper()
        return clean if clean in _VOICE_MAP else None

    def is_sdk_available(self) -> bool:
        """Returns True if both supertonic and onnxruntime packages are importable."""
        if self._sdk_available is None:
            try:
                has_st = importlib.util.find_spec("supertonic") is not None
                has_ort = importlib.util.find_spec("onnxruntime") is not None
                self._sdk_available = bool(has_st and has_ort)
            except Exception:
                self._sdk_available = False
        return bool(self._sdk_available)

    def is_lang_supported(self, lang: Optional[str]) -> bool:
        clean = self.normalize_lang(lang)
        return clean in _SUPPORTED_LANG_SET

    def _dest_path(self, rel_path: str) -> str:
        return os.path.join(self.model_dir, *rel_path.split("/"))

    def _is_file_valid(self, rel_path: str, min_bytes: int) -> bool:
        p = self._dest_path(rel_path)
        try:
            return os.path.isfile(p) and os.path.getsize(p) >= min_bytes
        except OSError:
            return False

    def is_core_installed(self) -> bool:
        """Returns True if all 6 ONNX core files exist and meet size sanity thresholds."""
        for f in SUPERTONIC_CORE_FILES:
            if not self._is_file_valid(f["rel"], f["min_bytes"]):
                return False
        return True

    def is_voice_installed(self, voice_id: Optional[str]) -> bool:
        """Returns True if voice_styles/<voice_id>.json exists and is > 10 KB."""
        vid = self.normalize_voice_id(voice_id)
        if not vid:
            return False
        rel = _VOICE_MAP[vid]["style_rel"]
        return self._is_file_valid(rel, VOICE_STYLE_MIN_BYTES)

    def is_voice_ready(self, voice_id: Optional[str]) -> bool:
        """Returns True if both the ONNX core and the specified voice style are installed."""
        return self.is_core_installed() and self.is_voice_installed(voice_id)

    def list_installed_voices(self) -> List[Dict[str, Any]]:
        """Returns all installed (ready) voices."""
        core_ok = self.is_core_installed()
        result: List[Dict[str, Any]] = []
        for v in SUPERTONIC_VOICES:
            style_ok = self.is_voice_installed(v["id"])
            if core_ok and style_ok:
                result.append({
                    "id": v["id"],
                    "name": v["name"],
                    "gender": v["gender"],
                    "installed": True,
                    "style_installed": True,
                    "core_installed": True,
                    "size_mb": VOICE_STYLE_SIZE_MB,
                    "download_size_mb": 0,
                })
        return result

    def get_voices_for_lang(self, lang: Optional[str] = None) -> List[Dict[str, Any]]:
        """Returns all 10 Supertonic 3 voices with installation status and download sizes."""
        core_ok = self.is_core_installed()
        result: List[Dict[str, Any]] = []
        for v in SUPERTONIC_VOICES:
            style_ok = self.is_voice_installed(v["id"])
            ready = core_ok and style_ok
            dl_mb = 0 if ready else (VOICE_STYLE_SIZE_MB if core_ok else CORE_TOTAL_SIZE_MB)
            result.append({
                "id": v["id"],
                "name": v["name"],
                "gender": v["gender"],
                "installed": ready,
                "style_installed": style_ok,
                "core_installed": core_ok,
                "size_mb": VOICE_STYLE_SIZE_MB,
                "download_size_mb": dl_mb,
            })
        return result

    def get_default_voice(self, gender: str = "male") -> str:
        """Returns preferred installed voice or fallback default M1/F1."""
        resolved = self.resolve_voice("auto", gender=gender)
        if resolved:
            return resolved
        return "F1" if (gender or "").lower().strip() == "female" else "M1"

    def resolve_voice(self, requested_voice: Optional[str], gender: str = "male") -> Optional[str]:
        """
        Resolves requested voice ('M1'..'F5' or 'auto') to an installed voice_id.
        Returns None if core or no matching voice is installed.
        """
        if not self.is_core_installed():
            return None

        req = (requested_voice or "").strip()
        vid = self.normalize_voice_id(req)
        if vid and self.is_voice_installed(vid):
            return vid

        want_gender = "female" if (gender or "").lower().strip() == "female" else "male"
        # Prefer first installed voice of matching gender
        for v in SUPERTONIC_VOICES:
            if v["gender"] == want_gender and self.is_voice_installed(v["id"]):
                return v["id"]
        # Fallback to any installed voice
        for v in SUPERTONIC_VOICES:
            if self.is_voice_installed(v["id"]):
                return v["id"]
        return None

    def is_voice_ready_for_lang(
        self,
        lang: Optional[str],
        requested_voice: Optional[str] = None,
        gender: str = "male",
    ) -> Tuple[bool, Optional[str], str]:
        """
        Checks language support, SDK presence, ONNX core, and voice readiness.
        Returns (ready, resolved_voice_id, reason).
        """
        clean_lang = self.normalize_lang(lang)
        if not self.is_lang_supported(clean_lang):
            return False, None, "unsupported_lang"

        if not self.is_sdk_available():
            return False, None, "sdk_missing"

        # Determine target voice id (if explicitly requested and valid)
        vid = self.normalize_voice_id(requested_voice)
        if not self.is_core_installed():
            target_vid = vid or ("F1" if (gender or "").lower().strip() == "female" else "M1")
            active = self.get_any_active_download_status()
            if active.get("status") == "running":
                return False, target_vid, "downloading"
            return False, target_vid, "core_not_installed"

        if vid:
            if self.is_voice_installed(vid):
                return True, vid, "ok"
            dl_st = self.get_download_status(vid)
            if dl_st.get("status") == "running":
                return False, vid, "downloading"
            return False, vid, "voice_not_installed"

        resolved = self.resolve_voice("auto", gender=gender)
        if resolved:
            return True, resolved, "ok"

        target_vid = "F1" if (gender or "").lower().strip() == "female" else "M1"
        active = self.get_any_active_download_status()
        if active.get("status") == "running":
            return False, target_vid, "downloading"
        return False, target_vid, "voice_not_installed"

    def get_download_status(self, voice_id: str) -> Dict[str, Any]:
        """Returns download status dict for a specific voice_id."""
        vid = self.normalize_voice_id(voice_id) or "M1"
        with self._dl_lock:
            st = self._downloads.get(vid)
            if st is not None:
                return dict(st)
            # If another voice download is currently fetching the core, report that active status
            for active_st in reversed(list(self._downloads.values())):
                if active_st.get("status") == "running":
                    return dict(active_st)
        return {
            "voice_id": vid,
            "status": "idle",
            "progress": 100 if self.is_voice_ready(vid) else 0,
            "downloaded_mb": 0.0,
            "total_mb": 0.0,
            "current_file": "",
            "error": None,
        }

    def get_any_active_download_status(self) -> Dict[str, Any]:
        """Returns any currently running download status, or latest finished/idle."""
        with self._dl_lock:
            for st in reversed(list(self._downloads.values())):
                if st.get("status") == "running":
                    return dict(st)
            if self._downloads:
                return dict(list(self._downloads.values())[-1])
        return {
            "voice_id": "",
            "status": "idle",
            "progress": 0,
            "downloaded_mb": 0.0,
            "total_mb": 0.0,
            "current_file": "",
            "error": None,
        }

    def start_download(self, voice_id: str = "M1") -> Dict[str, Any]:
        """
        Starts asynchronous download of missing Supertonic 3 ONNX core files
        and the requested voice style JSON in a background thread.
        """
        vid = self.normalize_voice_id(voice_id) or "M1"

        with self._dl_lock:
            if self.is_voice_ready(vid):
                done_st = {
                    "voice_id": vid,
                    "status": "completed",
                    "progress": 100,
                    "downloaded_mb": 0.0,
                    "total_mb": 0.0,
                    "current_file": "",
                    "error": None,
                    "timestamp": time.time(),
                }
                self._downloads[vid] = done_st
                return dict(done_st)

            # Prevent duplicate concurrent downloads (core or same voice)
            for existing_vid, existing_st in self._downloads.items():
                if existing_st.get("status") == "running":
                    if existing_vid == vid or not self.is_core_installed():
                        return dict(existing_st)

            if len(self._downloads) > 30:
                for k in list(self._downloads.keys())[:-15]:
                    if self._downloads[k].get("status") in ("completed", "error"):
                        self._downloads.pop(k, None)

            status: Dict[str, Any] = {
                "voice_id": vid,
                "status": "running",
                "progress": 0,
                "downloaded_mb": 0.0,
                "total_mb": 0.0,
                "current_file": "",
                "error": None,
                "timestamp": time.time(),
            }
            self._downloads[vid] = status

        def _worker():
            tmp_path: Optional[str] = None
            try:
                os.makedirs(os.path.join(self.model_dir, "onnx"), exist_ok=True)
                os.makedirs(os.path.join(self.model_dir, "voice_styles"), exist_ok=True)

                queue: List[Dict[str, Any]] = []
                for f in SUPERTONIC_CORE_FILES:
                    if not self._is_file_valid(f["rel"], f["min_bytes"]):
                        queue.append(f)

                style_rel = _VOICE_MAP[vid]["style_rel"]
                if not self._is_file_valid(style_rel, VOICE_STYLE_MIN_BYTES):
                    queue.append({
                        "rel": style_rel,
                        "min_bytes": VOICE_STYLE_MIN_BYTES,
                        "approx_bytes": VOICE_STYLE_APPROX_BYTES,
                    })

                if not queue:
                    with self._dl_lock:
                        status["progress"] = 100
                        status["status"] = "completed"
                        status["timestamp"] = time.time()
                    return

                total_expected = sum(item["approx_bytes"] for item in queue)
                with self._dl_lock:
                    status["total_mb"] = round(total_expected / (1024 * 1024), 1)

                downloaded_so_far = 0
                chunk_size = 512 * 1024

                for item in queue:
                    rel = item["rel"]
                    min_bytes = item["min_bytes"]
                    approx_bytes = item["approx_bytes"]
                    dest = self._dest_path(rel)
                    tmp_path = dest + ".tmp"
                    url = BASE_HF_URL + rel

                    with self._dl_lock:
                        status["current_file"] = os.path.basename(rel)
                        status["timestamp"] = time.time()

                    logger.info(f"[SUPERTONIC] Downloading {rel} from {url}...")
                    req = urllib.request.Request(url, headers={"User-Agent": "ProxDMR/1.0 Mozilla/5.0"})
                    file_downloaded = 0
                    content_length = 0

                    with urllib.request.urlopen(req, timeout=120) as resp, open(tmp_path, "wb") as f_out:
                        cl_hdr = resp.headers.get("content-length")
                        if cl_hdr:
                            try:
                                content_length = int(cl_hdr)
                            except ValueError:
                                content_length = 0

                        # Refine total expected bytes with actual Content-Length
                        if content_length > 0 and content_length != approx_bytes:
                            total_expected = max(1, total_expected - approx_bytes + content_length)
                            with self._dl_lock:
                                status["total_mb"] = round(total_expected / (1024 * 1024), 1)

                        while True:
                            chunk = resp.read(chunk_size)
                            if not chunk:
                                break
                            f_out.write(chunk)
                            file_downloaded += len(chunk)
                            cur_total_dl = downloaded_so_far + file_downloaded
                            pct = min(99, int(cur_total_dl * 100 / max(1, total_expected)))
                            with self._dl_lock:
                                status["progress"] = pct
                                status["downloaded_mb"] = round(cur_total_dl / (1024 * 1024), 1)
                                status["timestamp"] = time.time()

                    if content_length > 0 and file_downloaded < content_length:
                        raise IOError(
                            f"Incomplete download for {rel}: got {file_downloaded} of {content_length} bytes"
                        )
                    if os.path.getsize(tmp_path) < min_bytes:
                        raise IOError(
                            f"Downloaded file {rel} is too small ({os.path.getsize(tmp_path)} bytes)"
                        )

                    os.replace(tmp_path, dest)
                    tmp_path = None
                    try:
                        os.chmod(dest, 0o644)
                    except Exception:
                        pass

                    downloaded_so_far += file_downloaded
                    logger.info(f"[SUPERTONIC] Saved {rel} ({round(file_downloaded / (1024 * 1024), 2)} MB)")

                with self._dl_lock:
                    status["progress"] = 100
                    status["status"] = "completed"
                    status["current_file"] = ""
                    status["downloaded_mb"] = round(downloaded_so_far / (1024 * 1024), 1)
                    status["timestamp"] = time.time()
                logger.info(f"[SUPERTONIC] Voice '{vid}' and core are ready.")

            except Exception as e:
                logger.error(f"[SUPERTONIC] Download failed for '{vid}': {e}")
                if tmp_path and os.path.exists(tmp_path):
                    try:
                        os.remove(tmp_path)
                    except Exception:
                        pass
                with self._dl_lock:
                    status["status"] = "error"
                    status["error"] = str(e)
                    status["timestamp"] = time.time()

        t = threading.Thread(target=_worker, daemon=True)
        t.start()
        return dict(status)

    def _get_or_load_tts(self) -> Any:
        """Lazily initializes and caches supertonic.TTS instance with CPU thread limits."""
        with self._synth_lock:
            if self._tts is not None:
                return self._tts

            if not self.is_core_installed():
                raise FileNotFoundError("Supertonic 3 ONNX core files are not installed")

            os.environ.setdefault("ORT_INTRA_OP_NUM_THREADS", "2")
            os.environ.setdefault("ORT_INTER_OP_NUM_THREADS", "1")

            import supertonic

            tts_cls = supertonic.TTS
            sig = inspect.signature(tts_cls.__init__)
            params = sig.parameters
            kwargs: Dict[str, Any] = {}

            if "model" in params:
                kwargs["model"] = "supertonic-3"
            elif "model_name" in params:
                kwargs["model_name"] = "supertonic-3"
            if "model_dir" in params:
                kwargs["model_dir"] = self.model_dir
            if "auto_download" in params:
                kwargs["auto_download"] = False
            if "intra_op_num_threads" in params:
                kwargs["intra_op_num_threads"] = 2
            if "inter_op_num_threads" in params:
                kwargs["inter_op_num_threads"] = 1
            elif "onnx_kwargs" in params:
                try:
                    import onnxruntime as ort
                    sess_opts = ort.SessionOptions()
                    sess_opts.intra_op_num_threads = 2
                    sess_opts.inter_op_num_threads = 1
                    kwargs["onnx_kwargs"] = {"sess_options": sess_opts}
                except Exception:
                    pass

            logger.info(f"[SUPERTONIC] Loading Supertonic 3 ONNX model from {self.model_dir}...")
            self._tts = tts_cls(**kwargs)
            logger.info(
                f"[SUPERTONIC] Supertonic 3 loaded (sample_rate={getattr(self._tts, 'sample_rate', 44100)} Hz)."
            )
            return self._tts

    def _get_or_load_style(self, tts: Any, voice_id: str) -> Any:
        """Loads and caches the voice style object for voice_id."""
        if voice_id in self._style_cache:
            return self._style_cache[voice_id]

        style_path = self._dest_path(_VOICE_MAP[voice_id]["style_rel"])
        if not os.path.isfile(style_path):
            raise FileNotFoundError(f"Supertonic 3 voice style '{voice_id}' not found at {style_path}")

        if hasattr(tts, "get_voice_style_from_path"):
            style = tts.get_voice_style_from_path(style_path)
        elif hasattr(tts, "get_voice_style"):
            style = tts.get_voice_style(voice_name=voice_id)
        else:
            raise AttributeError("supertonic.TTS does not expose get_voice_style_from_path/get_voice_style")

        self._style_cache[voice_id] = style
        return style

    def _synthesize_sync(
        self,
        text: str,
        voice_id: Optional[str] = None,
        lang: str = "ru",
        speed: float = 1.05,
    ) -> Tuple[Optional[bytes], int, Optional[str]]:
        """
        Synchronously synthesizes speech with Supertonic 3 into 44.1 kHz 16-bit mono WAV bytes.
        Returns (wav_bytes, sample_rate, error_message).
        """
        if not text or not text.strip():
            return None, 0, _tr("tts.empty_text", fallback="Empty text for speech synthesis")

        clean_lang = self.normalize_lang(lang)
        if not self.is_lang_supported(clean_lang):
            return None, 0, _tr(
                "transcriber.supertonic_lang_unsupported",
                fallback="Language [{lang}] is not supported in Supertonic 3 TTS",
                lang=clean_lang.upper(),
            )

        if not self.is_sdk_available():
            return None, 0, "Supertonic 3 SDK is not installed on server"

        vid = self.normalize_voice_id(voice_id) or self.resolve_voice("auto")
        if not vid or not self.is_voice_ready(vid):
            return None, 0, _tr(
                "transcriber.supertonic_not_ready",
                fallback="Supertonic 3 model is not installed yet",
            )

        import numpy as np

        with self._synth_lock:
            try:
                tts = self._get_or_load_tts()
                style = self._get_or_load_style(tts, vid)
                clamped_speed = max(0.85, min(1.4, float(speed or 1.05)))

                synth_sig = inspect.signature(tts.synthesize)
                synth_kwargs: Dict[str, Any] = {
                    "voice_style": style,
                    "lang": clean_lang,
                    "speed": clamped_speed,
                }
                if "total_steps" in synth_sig.parameters:
                    synth_kwargs["total_steps"] = SUPERTONIC_TOTAL_STEPS

                synth_text = text.strip()
                if SUPERTONIC_BOOST_PUNCTUATION:
                    synth_text = boost_punctuation_for_supertonic(synth_text)

                result = tts.synthesize(synth_text, **synth_kwargs)
                if isinstance(result, tuple):
                    wav_arr = result[0]
                else:
                    wav_arr = result

                arr = np.asarray(wav_arr, dtype=np.float32).reshape(-1)
                if arr.size == 0:
                    return None, 0, "Supertonic 3 returned empty audio"

                arr = np.clip(arr, -1.0, 1.0)
                pcm16 = (arr * 32767.0).astype(np.int16)

                sample_rate = int(getattr(tts, "sample_rate", 44100) or 44100)
                bio = io.BytesIO()
                with wave.open(bio, "wb") as wf:
                    wf.setnchannels(1)
                    wf.setsampwidth(2)
                    wf.setframerate(sample_rate)
                    wf.writeframes(pcm16.tobytes())

                return bio.getvalue(), sample_rate, None
            except Exception as e:
                logger.error(f"[SUPERTONIC] Synthesis exception (voice='{vid}', lang='{clean_lang}'): {e}", exc_info=True)
                return None, 0, str(e)

    async def synthesize_async(
        self,
        text: str,
        voice_id: Optional[str] = None,
        lang: str = "ru",
        speed: float = 1.05,
    ) -> Tuple[Optional[bytes], int, Optional[str]]:
        """Asynchronously synthesizes speech in a worker thread."""
        return await asyncio.to_thread(
            self._synthesize_sync,
            text=text,
            voice_id=voice_id,
            lang=lang,
            speed=speed,
        )
