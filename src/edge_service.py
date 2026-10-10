"""
Edge TTS Service for ProxDMR.
Provides free high-quality neural speech synthesis using Microsoft Edge Read Aloud API.
"""

import asyncio
import io
import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.edge_tts")

try:
    import edge_tts
    HAVE_EDGE_TTS = True
except ImportError:
    edge_tts = None
    HAVE_EDGE_TTS = False


EDGE_VOICES_BY_LANG: Dict[str, List[Dict[str, Any]]] = {
    "ru": [
        {"id": "ru-RU-SvetlanaNeural", "name": "Светлана (Женский)", "gender": "female"},
        {"id": "ru-RU-DmitryNeural", "name": "Дмитрий (Мужской)", "gender": "male"},
    ],
    "en": [
        {"id": "en-US-JennyNeural", "name": "Jenny (Female, US)", "gender": "female"},
        {"id": "en-US-GuyNeural", "name": "Guy (Male, US)", "gender": "male"},
        {"id": "en-GB-SoniaNeural", "name": "Sonia (Female, UK)", "gender": "female"},
        {"id": "en-GB-RyanNeural", "name": "Ryan (Male, UK)", "gender": "male"},
    ],
    "uk": [
        {"id": "uk-UA-PolinaNeural", "name": "Поліна (Жіночий)", "gender": "female"},
        {"id": "uk-UA-OstapNeural", "name": "Остап (Чоловічий)", "gender": "male"},
    ],
    "de": [
        {"id": "de-DE-KatjaNeural", "name": "Katja (Weiblich)", "gender": "female"},
        {"id": "de-DE-ConradNeural", "name": "Conrad (Männlich)", "gender": "male"},
    ],
    "es": [
        {"id": "es-ES-ElviraNeural", "name": "Elvira (Femenino)", "gender": "female"},
        {"id": "es-ES-AlvaroNeural", "name": "Álvaro (Masculino)", "gender": "male"},
    ],
    "fr": [
        {"id": "fr-FR-DeniseNeural", "name": "Denise (Féminin)", "gender": "female"},
        {"id": "fr-FR-HenriNeural", "name": "Henri (Masculin)", "gender": "male"},
    ],
    "it": [
        {"id": "it-IT-ElsaNeural", "name": "Elsa (Femminile)", "gender": "female"},
        {"id": "it-IT-DiegoNeural", "name": "Diego (Maschile)", "gender": "male"},
    ]
}

DEFAULT_EDGE_VOICES: Dict[str, str] = {
    "ru": "ru-RU-SvetlanaNeural",
    "en": "en-US-JennyNeural",
    "uk": "uk-UA-PolinaNeural",
    "de": "de-DE-KatjaNeural",
    "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",
    "it": "it-IT-ElsaNeural",
}


class EdgeTtsService:
    _instance: Optional["EdgeTtsService"] = None

    @classmethod
    def get_instance(cls) -> "EdgeTtsService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def is_available(self) -> bool:
        return HAVE_EDGE_TTS

    def get_voices_for_lang(self, lang: Optional[str] = None) -> List[Dict[str, Any]]:
        clean_lang = (lang or "ru").lower().strip()
        if clean_lang == "ua":
            clean_lang = "uk"
        return EDGE_VOICES_BY_LANG.get(clean_lang, EDGE_VOICES_BY_LANG["en"])

    def resolve_voice(self, requested_voice: Optional[str], lang: str = "ru", gender: str = "female") -> str:
        clean_lang = (lang or "ru").lower().strip()
        if clean_lang == "ua":
            clean_lang = "uk"
        if requested_voice and requested_voice != "auto":
            return requested_voice
        voices = self.get_voices_for_lang(clean_lang)
        for v in voices:
            if v["gender"] == gender:
                return v["id"]
        return DEFAULT_EDGE_VOICES.get(clean_lang, "en-US-JennyNeural")

    async def synthesize_async(
        self,
        text: str,
        voice: Optional[str] = None,
        lang: str = "ru",
        speed: float = 1.0,
        gender: str = "male"
    ) -> Tuple[Optional[bytes], Optional[str]]:
        if not HAVE_EDGE_TTS:
            return None, "Пакет edge-tts не установлен в системе"

        clean_text = (text or "").strip()
        if not clean_text:
            return None, "Пустой текст для озвучки"

        actual_voice = self.resolve_voice(voice, lang=lang, gender=gender)
        rate_offset = int(round((speed - 1.0) * 100))
        rate_str = f"{rate_offset:+d}%"

        try:
            communicate = edge_tts.Communicate(clean_text, actual_voice, rate=rate_str)
            mp3_chunks = []
            async for chunk in communicate.stream():
                if chunk["type"] == "audio":
                    mp3_chunks.append(chunk["data"])
            mp3_data = b"".join(mp3_chunks)
            if not mp3_data:
                return None, "Edge TTS вернул пустые аудиоданные"

            proc = await asyncio.create_subprocess_exec(
                "ffmpeg", "-y", "-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "-ar", "24000", "-ac", "1", "pipe:1",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL
            )
            wav_data, _ = await proc.communicate(input=mp3_data)
            if wav_data and len(wav_data) > 44:
                return wav_data, None

            return mp3_data, None
        except Exception as e:
            logger.warning(f"[EDGE-TTS] Synthesis error: {e}")
            return None, f"Ошибка Edge TTS: {e}"
