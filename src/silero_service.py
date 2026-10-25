"""
Silero TTS Service for ProxDMR.
Provides high-quality offline speech synthesis using Silero Models v5/v4.
Runs locally on CPU with in-memory model caching.
"""

import asyncio
import io
import logging
import os
import threading
import time
import wave
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.silero_tts")

try:
    import torch
    import numpy as np
    HAVE_TORCH = True
except ImportError:
    torch = None
    np = None
    HAVE_TORCH = False


SILERO_VOICES_BY_LANG: Dict[str, List[Dict[str, Any]]] = {
    "ru": [
        {"id": "kseniya", "name": "Ксения (Женский, v5)", "gender": "female"},
        {"id": "aidar", "name": "Айдар (Мужской, v5)", "gender": "male"},
        {"id": "baya", "name": "Бая (Женский, v5)", "gender": "female"},
        {"id": "eugene", "name": "Евгений (Мужской, v5)", "gender": "male"},
        {"id": "xenia", "name": "Ксения 2 (Женский, v5)", "gender": "female"},
    ],
    "uk": [
        {"id": "mykyta", "name": "Микита (Чоловічий, v4)", "gender": "male"},
    ],
    "en": [
        {"id": "en_0", "name": "Voice 0 (Female)", "gender": "female"},
        {"id": "en_1", "name": "Voice 1 (Male)", "gender": "male"},
        {"id": "en_2", "name": "Voice 2 (Female)", "gender": "female"},
        {"id": "en_3", "name": "Voice 3 (Male)", "gender": "male"},
    ],
    "de": [
        {"id": "eva_k", "name": "Eva (Женский)", "gender": "female"},
        {"id": "karlsson", "name": "Karlsson (Мужской)", "gender": "male"},
        {"id": "bernd_ungerer", "name": "Bernd (Мужской)", "gender": "male"},
        {"id": "friedrich", "name": "Friedrich (Мужской)", "gender": "male"},
    ],
    "es": [
        {"id": "es_0", "name": "Voz 0 (Femenino)", "gender": "female"},
        {"id": "es_1", "name": "Voz 1 (Masculino)", "gender": "male"},
    ],
    "fr": [
        {"id": "fr_0", "name": "Voix 0 (Féminin)", "gender": "female"},
        {"id": "fr_1", "name": "Voix 1 (Masculin)", "gender": "male"},
    ]
}

DEFAULT_SILERO_VOICES: Dict[str, str] = {
    "ru": "kseniya",
    "uk": "mykyta",
    "en": "en_0",
    "de": "eva_k",
    "es": "es_0",
    "fr": "fr_0",
}


class SileroService:
    _instance: Optional["SileroService"] = None

    def __init__(self):
        self._models: Dict[str, Any] = {}
        self._lock = threading.Lock()
        if HAVE_TORCH:
            try:
                torch.set_num_threads(2)
            except Exception:
                pass

    @classmethod
    def get_instance(cls) -> "SileroService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def is_available(self) -> bool:
        return HAVE_TORCH

    def is_lang_supported(self, lang: Optional[str] = None) -> bool:
        clean_lang = (lang or "ru").lower().strip()
        if clean_lang == "ua":
            clean_lang = "uk"
        return clean_lang in SILERO_VOICES_BY_LANG

    def get_voices_for_lang(self, lang: Optional[str] = None) -> List[Dict[str, Any]]:
        clean_lang = (lang or "ru").lower().strip()
        if clean_lang == "ua":
            clean_lang = "uk"
        return SILERO_VOICES_BY_LANG.get(clean_lang, [])

    def resolve_voice(self, requested_voice: Optional[str] = None, lang: str = "ru", gender: str = "UNKNOWN") -> str:
        clean_lang = (lang or "ru").lower().strip()[:2]
        if clean_lang == "ua":
            clean_lang = "uk"
        if not self.is_lang_supported(clean_lang):
            clean_lang = "ru"

        voices = self.get_voices_for_lang(clean_lang)
        valid_ids = {v["id"] for v in voices}

        legacy_map = {"eva": "eva_k", "karl": "karlsson"}
        if requested_voice in legacy_map and legacy_map[requested_voice] in valid_ids:
            return legacy_map[requested_voice]

        if requested_voice and requested_voice != "auto" and requested_voice in valid_ids:
            return requested_voice

        target_gender = "male" if str(gender).upper() == "MALE" else ("female" if str(gender).upper() == "FEMALE" else None)
        if target_gender:
            for v in voices:
                if v.get("gender") == target_gender:
                    return v["id"]

        return DEFAULT_SILERO_VOICES.get(clean_lang, "kseniya" if clean_lang == "ru" else (voices[0]["id"] if voices else ""))

    def _get_or_load_model(self, lang: str):
        if not HAVE_TORCH:
            raise RuntimeError("PyTorch не установлен")
        clean_lang = (lang or "ru").lower().strip()
        if clean_lang == "ua":
            clean_lang = "uk"

        if clean_lang not in SILERO_VOICES_BY_LANG:
            supported = ", ".join(SILERO_VOICES_BY_LANG.keys()).upper()
            raise ValueError(f"Язык '{lang}' не поддерживается в Silero TTS (доступны: {supported})")

        with self._lock:
            if clean_lang in self._models:
                return self._models[clean_lang]

            speaker_tag = "v5_ru" if clean_lang == "ru" else ("v4_ua" if clean_lang == "uk" else f"v3_{clean_lang}")
            model_lang = "ru" if clean_lang == "ru" else ("ua" if clean_lang == "uk" else clean_lang)
            logger.info(f"[SILERO] Loading model for {clean_lang} ({speaker_tag})...")
            model, _ = torch.hub.load(
                "snakers4/silero-models",
                "silero_tts",
                language=model_lang,
                speaker=speaker_tag,
                trust_repo=True
            )
            model.to(torch.device("cpu"))
            self._models[clean_lang] = model
            logger.info(f"[SILERO] Model {speaker_tag} loaded successfully.")
            return model

    def _synthesize_sync(
        self,
        text: str,
        speaker: str,
        lang: str,
        sample_rate: int = 24000
    ) -> Tuple[Optional[bytes], Optional[str]]:
        try:
            clean_lang = (lang or "ru").lower().strip()
            if clean_lang == "ua":
                clean_lang = "uk"

            if clean_lang not in SILERO_VOICES_BY_LANG:
                return None, f"Язык '{lang}' не поддерживается в Silero TTS. Выберите Piper TTS или Gemini API."

            model = self._get_or_load_model(lang)

            # Pre-normalize and verbalize text to prevent Silero from dropping digits/@/symbols or raising ValueError
            try:
                from tts_normalizer import prepare_text_for_silero
                text = prepare_text_for_silero(text, lang=clean_lang)
            except Exception as pe:
                logger.debug(f"[SILERO] Pre-normalization warning: {pe}")

            if not text or not text.strip():
                return None, "Пустой текст после нормализации для Silero TTS"

            with self._lock:
                audio = model.apply_tts(
                    text=text,
                    speaker=speaker,
                    sample_rate=sample_rate,
                    put_accent=(clean_lang == "ru"),
                    put_yo=(clean_lang == "ru")
                )
            audio_np = (audio.numpy() * 32767).clip(-32768, 32767).astype(np.int16)
            bio = io.BytesIO()
            with wave.open(bio, "wb") as wf:
                wf.setnchannels(1)
                wf.setsampwidth(2)
                wf.setframerate(sample_rate)
                wf.writeframes(audio_np.tobytes())
            return bio.getvalue(), None
        except Exception as e:
            err_msg = str(e) or type(e).__name__
            logger.warning(f"[SILERO] Synthesis error: {err_msg}")
            return None, f"Ошибка Silero TTS: {err_msg}"

    async def synthesize_async(
        self,
        text: str,
        voice: Optional[str] = None,
        lang: str = "ru",
        speed: float = 1.0,
        gender: str = "male"
    ) -> Tuple[Optional[bytes], Optional[str]]:
        if not HAVE_TORCH:
            return None, "PyTorch не установлен в системе"

        clean_text = (text or "").strip()
        if not clean_text:
            return None, "Пустой текст для озвучки"

        clean_lang = "uk" if lang in ("ua", "uk") else (lang or "ru").lower().strip()
        if not self.is_lang_supported(clean_lang):
            return None, f"Язык '{clean_lang.upper()}' не поддерживается в Silero TTS. Рекомендуется использовать Piper TTS или Gemini API."

        actual_voice = self.resolve_voice(voice, lang=clean_lang, gender=gender)

        wav_bytes, err = await asyncio.to_thread(
            self._synthesize_sync,
            clean_text,
            actual_voice,
            clean_lang
        )
        return wav_bytes, err
