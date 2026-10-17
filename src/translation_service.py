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

logger = logging.getLogger("proxdmr.translation")

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
    "bg": "Bulgarian (Български)",
    "ja": "Japanese (日本語)",
    "zh": "Chinese (中文)"
}

try:
    import langdetect
    from langdetect import DetectorFactory
    DetectorFactory.seed = 0
    HAVE_LANGDETECT = True
except ImportError:
    HAVE_LANGDETECT = False

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
    Fast and robust automatic language detection from the first phrases.
    Uses multi-stage approach:
    1. Clean radio metadata, callsigns, numbers, and tags.
    2. Character script & specific unique alphabet letters analysis.
    3. Statistical n-gram detection via langdetect.
    4. Safe fallback.
    """
    if not text or not text.strip():
        return "ru"

    # Strip callsigns, brackets, and numbers for pure linguistic detection
    cleaned = re.sub(r"<call>[^<]*</call>", " ", text)
    cleaned = re.sub(r"\b[A-Z]{1,2}\d[A-Z0-9]+\b", " ", cleaned)
    cleaned = re.sub(r"\b\d+[:.]\d+\b", " ", cleaned)
    cleaned = re.sub(r"[\d.,!?:;\"'()\[\]{}–—\-+@#$%^&*]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    if not cleaned:
        return "ru"

    lower = cleaned.lower()

    # Stage 1: Explicit character markers
    # Ukrainian specific letters: і, ї, є, ґ
    if any(c in lower for c in ("і", "ї", "є", "ґ")):
        return "uk"

    # Russian specific letters: ы, э, ъ, ё
    if any(c in lower for c in ("ы", "э", "ъ", "ё")):
        return "ru"

    # German specific letters: ä, ö, ü, ß
    if any(c in lower for c in ("ä", "ö", "ü", "ß")):
        return "de"

    # French specific letters: é, è, ê, ë, ç, œ
    if any(c in lower for c in ("é", "è", "ê", "ë", "ç", "œ", "à", "ù")):
        return "fr"

    # Spanish specific letters: ñ, ¿, ¡, á, í, ó, ú
    if any(c in lower for c in ("ñ", "¿", "¡")):
        return "es"

    # Stage 2: Statistical language detection via langdetect
    if HAVE_LANGDETECT and len(lower) >= 3:
        try:
            detected = langdetect.detect(lower)
            if detected:
                det_code = detected.lower().strip()
                if det_code in ("ru", "uk", "en", "de", "es", "fr", "it", "pl", "pt", "tr", "nl", "cs", "bg", "ja", "zh"):
                    return det_code
        except Exception:
            pass

    # Stage 3: Script fallback (Cyrillic vs Latin)
    has_cyrillic = bool(re.search(r"[\u0400-\u04FF]", lower))
    if has_cyrillic:
        return "ru"

    # Latin fallback
    return "en"


class TranslationService:
    _instance: Optional["TranslationService"] = None

    def __init__(self):
        self._lock = threading.Lock()
        self._qwen_lock = threading.Lock()
        self._qwen_llm: Optional[Any] = None

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

    def _get_or_load_qwen(self):
        if not HAVE_LLAMA_CPP:
            raise RuntimeError("llama-cpp-python не установлен")
        if not self._qwen_file.exists():
            raise FileNotFoundError(f"Файл модели Qwen GGUF не найден: {self._qwen_file}")

        with self._lock:
            if self._qwen_llm is not None:
                return self._qwen_llm

            logger.info(f"[TRANSLATION] Loading Qwen 2.5 1.5B GGUF ({self._qwen_file.name})...")
            self._qwen_llm = Llama(
                model_path=str(self._qwen_file),
                n_ctx=1024,
                n_threads=4,
                n_batch=512,
                verbose=False
            )
            logger.info("[TRANSLATION] Qwen 2.5 1.5B loaded successfully.")
            return self._qwen_llm

    def translate_qwen_sync(
        self,
        text: str,
        target_lang: str = "ru",
        source_lang: Optional[str] = None
    ) -> Tuple[str, Optional[str]]:
        """Synchronous translation via Qwen 2.5 1.5B."""
        clean_text = (text or "").strip()
        if not clean_text:
            return text, None

        src = (source_lang or detect_language(clean_text)).lower().strip()[:2]
        tgt = (target_lang or "ru").lower().strip()[:2]

        if src == tgt:
            return clean_text, None

        tgt_name = LANG_DISPLAY_NAMES.get(tgt, tgt)
        src_name = LANG_DISPLAY_NAMES.get(src, src)

        try:
            with self._qwen_lock:
                llm = self._get_or_load_qwen()
                system_prompt = (
                    f"You are a professional radio operator and live interpreter. "
                    f"Translate the following speech transmission faithfully from {src_name} into {tgt_name}. "
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
                content = response["choices"][0]["message"]["content"].strip()
                # Clean possible surrounding markdown quotes
                content = re.sub(r'^["«\']|["»\']$', '', content).strip()
                return content or clean_text, None
        except Exception as e:
            logger.error(f"[TRANSLATION] Qwen translation error: {e}")
            return clean_text, f"Ошибка Qwen 2.5: {e}"

    async def translate_async(
        self,
        text: str,
        engine: str = "qwen",
        target_lang: str = "ru",
        source_lang: Optional[str] = None
    ) -> Tuple[str, Optional[str]]:
        """Asynchronous unified translation entry point."""
        return await asyncio.to_thread(
            self.translate_qwen_sync, text, target_lang=target_lang, source_lang=source_lang
        )
