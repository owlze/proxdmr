# -*- coding: utf-8 -*-
"""
ProxDMR Local Translation Subsystem
Supports:
1. Qwen 2.5 1.5B-Instruct (GGUF) via llama-cpp-python (intelligent, conversational context-aware AI).
2. Automatic source language detection from the first phrases (langdetect / script heuristics).
"""

import asyncio
import logging
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional, Tuple, List

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

logger = logging.getLogger("proxdmr.translation")

QWEN_IDLE_UNLOAD_SEC = 900  # 15 minutes

LANG_DISPLAY_NAMES: Dict[str, str] = {
    "ru": "Russian (Русский)",
    "uk": "Ukrainian (Українська)",
    "en": "English",
    "de": "German (Deutsch)",
    "es": "Spanish (Español)",
    "fr": "French (Français)",
    "it": "Italian (Italiano)",
    "pl": "Polish (Polski)",
    "pt": "Portuguese (Português)",
    "tr": "Turkish (Türkçe)",
    "nl": "Dutch (Nederlands)",
    "cs": "Czech (Čeština)",
    "sk": "Slovak (Slovenčina)",
    "bg": "Bulgarian (Български)",
    "ro": "Romanian (Română)",
    "el": "Greek (Ελληνικά)",
    "hu": "Hungarian (Magyar)",
    "sv": "Swedish (Svenska)",
    "no": "Norwegian (Norsk)",
    "fi": "Finnish (Suomi)",
    "da": "Danish (Dansk)",
    "hr": "Croatian (Hrvatski)",
    "sr": "Serbian (Српски)",
    "sl": "Slovenian (Slovenščina)",
    "be": "Belarusian (Беларуская)",
    "he": "Hebrew (עברית)",
    "ar": "Arabic (العربية)",
    "ja": "Japanese (日本語)",
    "zh": "Chinese (中文)",
    "ko": "Korean (한국어)",
    "hi": "Hindi",
    "fa": "Persian",
    "vi": "Vietnamese",
    "id": "Indonesian",
}

try:
    try:
        from language_capabilities import LANG_DISPLAY_NAMES_ALL as _CAP_DISPLAY_NAMES
    except ImportError:
        from src.language_capabilities import LANG_DISPLAY_NAMES_ALL as _CAP_DISPLAY_NAMES
    for _k, _v in _CAP_DISPLAY_NAMES.items():
        LANG_DISPLAY_NAMES.setdefault(_k, _v)
except Exception:
    pass

try:
    import llama_cpp
    from llama_cpp import Llama
    HAVE_LLAMA_CPP = True
except ImportError:
    HAVE_LLAMA_CPP = False

try:
    import huggingface_hub
    HAVE_HF_HUB = True
except ImportError:
    HAVE_HF_HUB = False


def detect_language(text: str) -> str:
    """
    Ultra-fast automatic text language detection via FastLidService (FastText lid.176.ftz)
    with script/diacritics fallback.
    """
    if not text or not text.strip():
        return "ru"
    try:
        try:
            from fast_lid_service import FastLidService
        except ImportError:
            from src.fast_lid_service import FastLidService
        iso2, _conf = FastLidService.get_instance().detect_text_lang(text)
        if iso2:
            return iso2
    except Exception:
        pass
    if re.search(r"[\u0400-\u04FF]", text):
        return "ru"
    return "en"


class TranslationService:
    _instance: Optional["TranslationService"] = None

    def __init__(self):
        self._lock = threading.Lock()
        self._qwen_lock = threading.Lock()
        self._qwen_llm: Optional[Any] = None
        self._last_used_ts: float = 0.0
        self._unload_timer: Optional[threading.Timer] = None

        # Base directories
        # In Docker container: /app/src/data/translation_models
        # On host: /opt/proxdmr/data/translation_models
        base_dir = Path("/app/src/data")
        if not base_dir.exists():
            base_dir = Path("/app/data")
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent / "data"
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent.parent / "data"
        self._models_dir = base_dir / "translation_models"
        self._models_dir.mkdir(parents=True, exist_ok=True)

        self._qwen_file = self._models_dir / "qwen2.5-1.5b-instruct-q4_k_m.gguf"

        self._downloads: Dict[str, Dict[str, Any]] = {
            "qwen": {"active": False, "progress": 0, "status": "idle", "error": None}
        }

    @classmethod
    def get_instance(cls) -> "TranslationService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def is_qwen_available(self) -> bool:
        return HAVE_LLAMA_CPP and self._qwen_file.exists()

    def get_status(self) -> Dict[str, Any]:
        return {
            "qwen": {
                "available": self.is_qwen_available(),
                "installed": self._qwen_file.exists(),
                "loaded": self._qwen_llm is not None,
                "download": self._downloads["qwen"]
            }
        }

    def start_download_qwen_async(self) -> bool:
        if self._downloads["qwen"]["active"]:
            return False

        def _worker():
            self._downloads["qwen"] = {"active": True, "progress": 10, "status": "downloading", "error": None}
            try:
                logger.info("[TRANSLATION] Downloading Qwen 2.5 1.5B Instruct GGUF (Q4_K_M)...")
                from huggingface_hub import hf_hub_download
                hf_hub_download(
                    repo_id="Qwen/Qwen2.5-1.5B-Instruct-GGUF",
                    filename="qwen2.5-1.5b-instruct-q4_k_m.gguf",
                    local_dir=str(self._models_dir),
                    local_dir_use_symlinks=False
                )
                self._downloads["qwen"] = {"active": False, "progress": 100, "status": "ready", "error": None}
                logger.info("[TRANSLATION] Qwen 2.5 download completed successfully.")
            except Exception as e:
                logger.error(f"[TRANSLATION] Qwen 2.5 download failed: {e}")
                self._downloads["qwen"] = {"active": False, "progress": 0, "status": "failed", "error": str(e)}

        threading.Thread(target=_worker, daemon=True).start()
        return True

    def _schedule_idle_unload(self) -> None:
        if self._unload_timer is not None:
            try:
                self._unload_timer.cancel()
            except Exception:
                pass
        timer = threading.Timer(QWEN_IDLE_UNLOAD_SEC, self._idle_unload_check)
        timer.daemon = True
        timer.start()
        self._unload_timer = timer

    def _idle_unload_check(self) -> None:
        with self._qwen_lock:
            if self._qwen_llm is None:
                return
            if (time.monotonic() - self._last_used_ts) >= (QWEN_IDLE_UNLOAD_SEC - 5):
                import gc
                logger.info("[TRANSLATION] Auto-unloading Qwen 2.5 1.5B after 15 min idle to free RAM.")
                self._qwen_llm = None
                gc.collect()

    def _get_or_load_qwen(self):
        if not HAVE_LLAMA_CPP:
            raise RuntimeError(_tr("translation.llama_not_installed", fallback="llama-cpp-python is not installed"))
        if not self._qwen_file.exists():
            raise FileNotFoundError(_tr("translation.qwen_file_not_found", fallback="Qwen GGUF model file not found: {path}", path=self._qwen_file))

        with self._lock:
            if self._qwen_llm is not None:
                return self._qwen_llm

            cpu_cnt = os.cpu_count() or 2
            n_threads = max(1, min(3, cpu_cnt - 1))
            logger.info(f"[TRANSLATION] Loading Qwen 2.5 1.5B GGUF ({self._qwen_file.name}, threads={n_threads})...")
            self._qwen_llm = Llama(
                model_path=str(self._qwen_file),
                n_ctx=1024,
                n_threads=n_threads,
                n_batch=512,
                verbose=False
            )
            logger.info("[TRANSLATION] Qwen 2.5 1.5B loaded successfully.")
            return self._qwen_llm

    def translate_qwen_sync(
        self,
        text: str,
        target_lang: str = "ru",
        source_lang: Optional[str] = None,
        asr_hint_lang: Optional[str] = None
    ) -> Tuple[Optional[str], Optional[str]]:
        """Synchronous translation via Qwen 2.5 1.5B."""
        clean_text = (text or "").strip()
        if not clean_text:
            return text, None

        try:
            from fast_lid_service import normalize_to_iso2
            src = normalize_to_iso2(source_lang) or detect_language(clean_text)
        except Exception:
            src = (source_lang or detect_language(clean_text)).lower().strip()[:2]
        tgt = (target_lang or "ru").lower().strip()[:2]

        if src == tgt:
            return clean_text, None

        tgt_name = LANG_DISPLAY_NAMES.get(tgt, tgt)
        src_name = LANG_DISPLAY_NAMES.get(src, src)
        asr_note = ""
        if asr_hint_lang:
            asr_code = asr_hint_lang.lower().strip()[:2]
            if asr_code and asr_code != src:
                asr_name = LANG_DISPLAY_NAMES.get(asr_code, asr_code)
                asr_note = (
                    f" Note: the input was transcribed using a closely related {asr_name} ASR phonetic model "
                    f"for spoken {src_name}; infer the intended {src_name} meaning faithfully."
                )

        try:
            with self._qwen_lock:
                llm = self._get_or_load_qwen()
                system_prompt = (
                    f"You are a professional radio operator and live interpreter. "
                    f"Translate the following speech transmission faithfully from {src_name} into {tgt_name}.{asr_note} "
                    "Keep callsigns, RST signal reports (e.g. 59, 599), Q-codes, and etiquette numbers (73, 88) intact. "
                    "Output ONLY the translated text without explanations, quotes, or conversational notes."
                )
                response = llm.create_chat_completion(
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": clean_text}
                    ],
                    temperature=0.0,
                    max_tokens=256
                )
                self._last_used_ts = time.monotonic()
                self._schedule_idle_unload()
                content = response["choices"][0]["message"]["content"].strip()
                # Clean possible surrounding markdown quotes
                content = re.sub(r'^["«\']|["»\']$', '', content).strip()
                return content or clean_text, None
        except Exception as e:
            logger.error(f"[TRANSLATION] Qwen translation error: {e}")
            return None, _tr("translation.qwen_error", fallback="Qwen 2.5 error: {error}", error=e)

    async def translate_async(
        self,
        text: str,
        engine: str = "qwen",
        target_lang: str = "ru",
        source_lang: Optional[str] = None,
        asr_hint_lang: Optional[str] = None
    ) -> Tuple[str, Optional[str]]:
        """Asynchronous unified translation entry point."""
        return await asyncio.to_thread(
            self.translate_qwen_sync,
            text,
            target_lang=target_lang,
            source_lang=source_lang,
            asr_hint_lang=asr_hint_lang,
        )
