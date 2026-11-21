"""
ProxDMR Local Speech Recognition Service — Reson8/Rumble-2-Flash (Full Unquantized FP32)
Native Hugging Face Transformers (Qwen3-ASR architecture, Apache 2.0 license).
Stores weights persistently under data/asr_models/rumble-2-flash, loads lazily on demand,
limits CPU threads to protect real-time radio audio, and auto-unloads after 15 min idle.
"""

import asyncio
import gc
import io
import logging
import os
import re
import subprocess
import threading
import time
import wave
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import numpy as np

logger = logging.getLogger(__name__)

RUMBLE_REPO_ID = "Reson8/Rumble-2-Flash"
RUMBLE_TARGET_SR = 16000
RUMBLE_IDLE_UNLOAD_SEC = 900  # 15 minutes
RUMBLE_MIN_FREE_RAM_MB = 2200  # Required headroom for FP32 weights (~1.95 GB) + inference buffers


def _get_memory_headroom_mb() -> Optional[float]:
    """Return available RAM headroom in MB considering Docker cgroup v2/v1 limits and host MemAvailable."""
    candidates_mb = []

    # 1. Linux cgroup v2
    try:
        max_raw = Path("/sys/fs/cgroup/memory.max").read_text(encoding="utf-8").strip()
        cur_raw = Path("/sys/fs/cgroup/memory.current").read_text(encoding="utf-8").strip()
        if max_raw != "max":
            max_b = int(max_raw)
            cur_b = int(cur_raw)
            if 0 < max_b < (1 << 60):
                candidates_mb.append(max(0.0, (max_b - cur_b) / (1024.0 * 1024.0)))
    except Exception:
        pass

    # 2. Linux cgroup v1 fallback
    if not candidates_mb:
        try:
            max_b = int(Path("/sys/fs/cgroup/memory/memory.limit_in_bytes").read_text(encoding="utf-8").strip())
            cur_b = int(Path("/sys/fs/cgroup/memory/memory.usage_in_bytes").read_text(encoding="utf-8").strip())
            if 0 < max_b < (1 << 60):
                candidates_mb.append(max(0.0, (max_b - cur_b) / (1024.0 * 1024.0)))
        except Exception:
            pass

    # 3. Host /proc/meminfo MemAvailable
    try:
        for line in Path("/proc/meminfo").read_text(encoding="utf-8").splitlines():
            if line.startswith("MemAvailable:"):
                parts = line.split()
                if len(parts) >= 2:
                    candidates_mb.append(int(parts[1]) / 1024.0)
                break
    except Exception:
        pass

    return round(min(candidates_mb), 1) if candidates_mb else None

# Map ISO-2 codes -> Rumble-2-Flash English language names
ISO2_TO_RUMBLE_LANG: Dict[str, str] = {
    "ru": "Russian",
    "en": "English",
    "uk": "Ukrainian",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "nl": "Dutch",
    "pl": "Polish",
    "pt": "Portuguese",
    "tr": "Turkish",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "cs": "Czech",
    "ro": "Romanian",
    "el": "Greek",
    "hu": "Hungarian",
    "sv": "Swedish",
    "da": "Danish",
    "fi": "Finnish",
    "ar": "Arabic",
    "hi": "Hindi",
    "th": "Thai",
    "vi": "Vietnamese",
    "id": "Indonesian",
    "ms": "Malay",
    "fa": "Persian",
    "mk": "Macedonian",
    "fil": "Filipino",
}

# Map Rumble-2-Flash detected English language names -> ISO-2 codes
RUMBLE_LANG_TO_ISO2: Dict[str, str] = {v.lower(): k for k, v in ISO2_TO_RUMBLE_LANG.items()}
RUMBLE_LANG_TO_ISO2.update({
    "cantonese": "zh",
    "mandarin": "zh",
    "norwegian": "no",
    "bokmal": "no",
    "croatian": "hr",
    "serbian": "sr",
    "bosnian": "bs",
    "bulgarian": "bg",
    "slovak": "sk",
    "slovenian": "sl",
    "lithuanian": "lt",
    "latvian": "lv",
    "estonian": "et",
    "catalan": "ca",
    "basque": "eu",
    "hebrew": "he",
    "afrikaans": "af",
    "albanian": "sq",
    "icelandic": "is",
    "bengali": "bn",
})

try:
    import torch
    import transformers
    HAVE_RUMBLE_DEPS = hasattr(transformers, "AutoModelForMultimodalLM")
except Exception:
    torch = None  # type: ignore
    transformers = None  # type: ignore
    HAVE_RUMBLE_DEPS = False


def _decode_audio_to_16k_float32(audio_bytes: bytes, mime_type: str = "audio/wav") -> np.ndarray:
    """Decode WAV (fast stdlib) or other audio (ffmpeg) to 16 kHz mono float32 NumPy array."""
    if not audio_bytes:
        return np.zeros(0, dtype=np.float32)

    is_wav = audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"
    if is_wav:
        try:
            with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
                n_ch = wf.getnchannels()
                sw = wf.getsampwidth()
                sr = wf.getframerate()
                raw = wf.readframes(wf.getnframes())
            if sw == 2 and raw:
                samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
                if n_ch > 1:
                    samples = samples.reshape(-1, n_ch).mean(axis=1)
                if sr == RUMBLE_TARGET_SR:
                    return samples
                if sr > 0 and len(samples) > 1:
                    new_len = max(1, int(round(len(samples) * RUMBLE_TARGET_SR / sr)))
                    x_old = np.linspace(0.0, 1.0, num=len(samples), endpoint=False)
                    x_new = np.linspace(0.0, 1.0, num=new_len, endpoint=False)
                    return np.interp(x_new, x_old, samples).astype(np.float32)
                return samples
        except Exception as e:
            logger.debug(f"[RUMBLE-ASR] Fast WAV decode fallback to ffmpeg: {e}")

    # Fallback via ffmpeg for MP3 / non-PCM16 WAV / OGG
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-i", "pipe:0",
         "-ar", str(RUMBLE_TARGET_SR), "-ac", "1", "-f", "s16le", "pipe:1"],
        input=audio_bytes,
        capture_output=True,
        timeout=30,
    )
    if proc.returncode != 0 or not proc.stdout:
        err_msg = (proc.stderr or b"").decode("utf-8", errors="replace").strip()
        raise RuntimeError(f"ffmpeg decode failed: {err_msg or 'empty output'}")
    return np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0


def _parse_rumble_decoded_output(decoded_obj: Any, forced_lang_iso2: Optional[str] = None) -> Tuple[str, str]:
    """Extract (text, iso2_lang) from transformers Qwen3ASRProcessor decoded output."""
    text = ""
    lang_iso2 = forced_lang_iso2 or "ru"

    if isinstance(decoded_obj, list) and decoded_obj:
        decoded_obj = decoded_obj[0]

    if isinstance(decoded_obj, dict):
        text = str(decoded_obj.get("text") or decoded_obj.get("transcription") or "").strip()
        raw_lang = str(decoded_obj.get("language") or "").strip().lower()
        if raw_lang and not forced_lang_iso2:
            lang_iso2 = RUMBLE_LANG_TO_ISO2.get(raw_lang, raw_lang[:2] if len(raw_lang) >= 2 else "ru")
        return text, lang_iso2

    raw_str = str(decoded_obj or "").strip()
    # Standard Qwen3-ASR raw output format: "language Russian<asr_text>Привет..."
    m = re.match(r"^\s*language\s+([A-Za-z]+)\s*(?:<asr_text>)?\s*(.*)$", raw_str, re.S)
    if m:
        lang_name = m.group(1).strip().lower()
        text = m.group(2).strip()
        if not forced_lang_iso2:
            lang_iso2 = RUMBLE_LANG_TO_ISO2.get(lang_name, lang_name[:2] if len(lang_name) >= 2 else "ru")
    else:
        text = re.sub(r"<asr_text>", "", raw_str).strip()

    return text, lang_iso2


class RumbleAsrService:
    _instance: Optional["RumbleAsrService"] = None

    def __init__(self) -> None:
        self._infer_lock = threading.Lock()
        self._dl_lock = threading.Lock()
        self._processor: Optional[Any] = None
        self._model: Optional[Any] = None
        self._last_used_ts: float = 0.0
        self._unload_timer: Optional[threading.Timer] = None

        base_dir = Path("/app/src/data")
        if not base_dir.exists():
            base_dir = Path("/app/data")
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent / "data"
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent.parent / "data"

        self._model_dir = base_dir / "asr_models" / "rumble-2-flash"
        self._model_dir.mkdir(parents=True, exist_ok=True)

        self._download_state: Dict[str, Any] = {
            "active": False,
            "progress": 0,
            "status": "idle",
            "error": None,
        }

    @classmethod
    def get_instance(cls) -> "RumbleAsrService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def is_installed(self) -> bool:
        return (
            (self._model_dir / "model.safetensors").is_file()
            and (self._model_dir / "config.json").is_file()
        )

    def get_disk_size_mb(self) -> float:
        if not self._model_dir.exists():
            return 0.0
        total = 0
        for p in self._model_dir.rglob("*"):
            if p.is_file():
                try:
                    total += p.stat().st_size
                except OSError:
                    pass
        return round(total / (1024.0 * 1024.0), 1)

    def get_status(self) -> Dict[str, Any]:
        installed = self.is_installed()
        dl = dict(self._download_state)
        if installed and not dl.get("active") and dl.get("status") != "failed":
            dl["status"] = "ready"
            dl["progress"] = 100
        return {
            "repo_id": RUMBLE_REPO_ID,
            "deps_available": HAVE_RUMBLE_DEPS,
            "installed": installed,
            "loaded": self._model is not None,
            "size_mb": self.get_disk_size_mb(),
            "mem_free_mb": _get_memory_headroom_mb(),
            "mem_required_mb": RUMBLE_MIN_FREE_RAM_MB,
            "model_dir": str(self._model_dir),
            "download": dl,
        }

    def _download_sync(self) -> None:
        from huggingface_hub import snapshot_download

        with self._dl_lock:
            if self.is_installed():
                self._download_state = {"active": False, "progress": 100, "status": "ready", "error": None}
                return
            self._download_state = {"active": True, "progress": 10, "status": "downloading", "error": None}
            logger.info(f"[RUMBLE-ASR] Downloading {RUMBLE_REPO_ID} to {self._model_dir}...")
            try:
                snapshot_download(
                    repo_id=RUMBLE_REPO_ID,
                    local_dir=str(self._model_dir),
                    ignore_patterns=["*.md", ".gitattributes", "ctc/*"],
                )
                if not self.is_installed():
                    raise RuntimeError("Downloaded directory is missing model.safetensors or config.json")
                self._download_state = {"active": False, "progress": 100, "status": "ready", "error": None}
                logger.info(f"[RUMBLE-ASR] Download complete ({self.get_disk_size_mb()} MB).")
            except Exception as e:
                logger.error(f"[RUMBLE-ASR] Download failed: {e}")
                self._download_state = {"active": False, "progress": 0, "status": "failed", "error": str(e)}
                raise

    def start_download_async(self) -> bool:
        if self._download_state.get("active"):
            return False
        if self.is_installed():
            self._download_state = {"active": False, "progress": 100, "status": "ready", "error": None}
            return False

        def _worker() -> None:
            try:
                self._download_sync()
            except Exception:
                pass

        t = threading.Thread(target=_worker, name="rumble-asr-download", daemon=True)
        t.start()
        return True

    def _schedule_idle_unload(self) -> None:
        if self._unload_timer is not None:
            try:
                self._unload_timer.cancel()
            except Exception:
                pass
        timer = threading.Timer(RUMBLE_IDLE_UNLOAD_SEC, self._idle_unload_check)
        timer.daemon = True
        timer.start()
        self._unload_timer = timer

    def _idle_unload_check(self) -> None:
        with self._infer_lock:
            if self._model is None:
                return
            if (time.monotonic() - self._last_used_ts) >= (RUMBLE_IDLE_UNLOAD_SEC - 5):
                logger.info("[RUMBLE-ASR] Auto-unloading Rumble-2-Flash after 15 min idle to free RAM.")
                self._model = None
                self._processor = None
                gc.collect()

    def _ensure_loaded_locked(self) -> Tuple[Any, Any]:
        if not HAVE_RUMBLE_DEPS:
            raise RuntimeError("PyTorch/Transformers Qwen3-ASR dependencies are not available in container")
        if not self.is_installed():
            self._download_sync()
        if self._model is not None and self._processor is not None:
            return self._processor, self._model

        gc.collect()
        free_mb = _get_memory_headroom_mb()
        if free_mb is not None and free_mb < RUMBLE_MIN_FREE_RAM_MB:
            raise MemoryError(
                f"Insufficient container RAM for Rumble-2-Flash FP32 "
                f"(free: {free_mb:.0f} MB, required: >= {RUMBLE_MIN_FREE_RAM_MB} MB). "
                f"Increase memory limit in docker-compose.yml to 4608M or higher."
            )

        cpu_cnt = os.cpu_count() or 2
        # Keep 1 CPU core free for real-time radio UDP/audio streams & asyncio loop
        num_threads = max(1, min(3, cpu_cnt - 1))
        try:
            torch.set_num_threads(num_threads)
        except Exception:
            pass

        t0 = time.monotonic()
        logger.info(
            f"[RUMBLE-ASR] Loading {RUMBLE_REPO_ID} (FP32, threads={num_threads}, "
            f"ram_headroom={free_mb} MB) from {self._model_dir}..."
        )
        processor = transformers.AutoProcessor.from_pretrained(str(self._model_dir))
        model = transformers.AutoModelForMultimodalLM.from_pretrained(
            str(self._model_dir),
            dtype=torch.float32,
            low_cpu_mem_usage=True,
        )
        model.eval()
        gc.collect()
        self._processor = processor
        self._model = model
        logger.info(f"[RUMBLE-ASR] Model loaded in {time.monotonic() - t0:.2f}s.")
        return processor, model

    def transcribe_sync(
        self,
        audio_bytes: bytes,
        mime_type: str = "audio/wav",
        source_lang_iso2: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
        """Synchronous CPU inference returning ({'text': ..., 'lang': iso2}, error_str)."""
        try:
            audio_16k = _decode_audio_to_16k_float32(audio_bytes, mime_type=mime_type)
            if len(audio_16k) < 1600:  # < 0.1s
                return {"text": "", "lang": source_lang_iso2 or "ru"}, None

            forced_iso2 = None
            forced_lang_en = None
            if source_lang_iso2 and source_lang_iso2.lower() not in ("auto", "none", ""):
                forced_iso2 = source_lang_iso2.lower()[:2]
                forced_lang_en = ISO2_TO_RUMBLE_LANG.get(forced_iso2)

            with self._infer_lock:
                processor, model = self._ensure_loaded_locked()
                t0 = time.monotonic()
                req_kwargs: Dict[str, Any] = {"audio": audio_16k}
                if forced_lang_en:
                    req_kwargs["language"] = forced_lang_en
                inputs = None
                output = None
                generated = None
                try:
                    inputs = processor.apply_transcription_request(**req_kwargs)
                    inputs = {
                        k: (v.to(model.device) if hasattr(v, "to") else v)
                        for k, v in inputs.items()
                    }
                    with torch.inference_mode():
                        output = model.generate(**inputs, max_new_tokens=384, do_sample=False)

                    prompt_len = inputs["input_ids"].shape[-1]
                    generated = output[:, prompt_len:]

                    try:
                        if forced_lang_en:
                            decoded = processor.decode(generated, return_format="transcription_only")
                        else:
                            decoded = processor.decode(generated, return_format="parsed")
                    except TypeError:
                        decoded = processor.batch_decode(generated, skip_special_tokens=True)

                    text, detected_iso2 = _parse_rumble_decoded_output(decoded, forced_lang_iso2=forced_iso2)
                finally:
                    del inputs, output, generated
                elapsed = time.monotonic() - t0
                dur_s = len(audio_16k) / float(RUMBLE_TARGET_SR)
                logger.info(
                    f"[RUMBLE-ASR] Transcribed {dur_s:.1f}s audio in {elapsed:.2f}s "
                    f"(RTF={elapsed / max(dur_s, 0.1):.2f}, lang={detected_iso2}): {text[:80]}"
                )
                self._last_used_ts = time.monotonic()
                self._schedule_idle_unload()
                return {"text": text, "lang": detected_iso2}, None
        except Exception as e:
            logger.error(f"[RUMBLE-ASR] Transcription error: {e}", exc_info=True)
            return None, f"Rumble-2-Flash error: {e}"

    async def transcribe_async(
        self,
        audio_bytes: bytes,
        mime_type: str = "audio/wav",
        source_lang_iso2: Optional[str] = None,
    ) -> Tuple[Optional[Dict[str, str]], Optional[str]]:
        return await asyncio.to_thread(
            self.transcribe_sync, audio_bytes, mime_type, source_lang_iso2
        )
