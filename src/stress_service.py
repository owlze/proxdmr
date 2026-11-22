"""
Silero Stress Accentor Service for ProxDMR.
Provides automatic stress placement and homograph disambiguation
for Cyrillic/supported languages (Russian, Ukrainian, Belarusian, etc.),
converting silero-stress '+' notation into standard Unicode Combining Acute Accent (U+0301)
understood natively by both Supertonic 3 TTS and Piper TTS (eSpeak-NG).
"""

import importlib.util
import logging
import re
import threading
from typing import Any, Dict, List, Optional

logger = logging.getLogger("proxdmr.stress")

# Neural models loaded via silero_stress.load_accentor(model_code)
NEURAL_LANG_MAP: Dict[str, str] = {
    "ru": "ru",
    "uk": "ukr",
    "be": "bel",
}

# Dictionary/simple models loaded via SimpleAccentor (or load_accentor fallback)
SIMPLE_LANG_MAP: Dict[str, str] = {
    "kk": "kaz",
    "tt": "tat",
    "uz": "uzb_cyr",
    "az": "aze_cyr",
    "hy": "hye",
    "ka": "kat",
    "ky": "kir",
    "tg": "tgk",
}

ALL_SUPPORTED_LANG_MAP: Dict[str, str] = {
    **NEURAL_LANG_MAP,
    **SIMPLE_LANG_MAP,
}

# Vowels (Russian, Ukrainian, Belarusian, extended Cyrillic) excluding ё/Ё which are inherently stressed
_STRESSABLE_VOWELS_RE = re.compile(
    r"\+([аеиоуыэюяіїєґўөүәіұқАЕИОУЫЭЮЯІЇЄҐЎӨҮӘІҰҚ])(?!\u0301)"
)
# If a vowel already has combining acute after it, strip the duplicate leading '+'
_DUP_ACUTE_VOWEL_RE = re.compile(
    r"\+([аеиоуыэюяіїєґўөүәіұқАЕИОУЫЭЮЯІЇЄҐЎӨҮӘІҰҚ]\u0301)"
)
# '+ё' / '+Ё' (optionally followed by stray acute) -> bare 'ё' / 'Ё'
_PLUS_YO_RE = re.compile(r"\+([ёЁ])\u0301?")
_STRAY_YO_ACUTE_RE = re.compile(r"([ёЁ])\u0301")
# Any leftover '+' placed directly before a Cyrillic/Latin letter (e.g. consonant artifact)
_LEFTOVER_LETTER_PLUS_RE = re.compile(r"\+(?=[а-яёА-ЯЁєіїґЄІЇҐўЎa-zA-Z])")


def get_stress_service() -> "StressService":
    """Returns the StressService singleton instance."""
    return StressService.get_instance()


class StressService:
    _instance: Optional["StressService"] = None
    _init_lock = threading.Lock()

    def __init__(self):
        self._lock = threading.Lock()
        self._accentors: Dict[str, Any] = {}
        self._failed_langs: set = set()
        self._sdk_available: Optional[bool] = None
        self._torch_threads_configured: bool = False

    @classmethod
    def get_instance(cls) -> "StressService":
        if cls._instance is None:
            with cls._init_lock:
                if cls._instance is None:
                    cls._instance = cls()
        return cls._instance

    def is_available(self) -> bool:
        """Returns True if the silero_stress package is importable."""
        if self._sdk_available is None:
            try:
                self._sdk_available = importlib.util.find_spec("silero_stress") is not None
            except Exception:
                self._sdk_available = False
        return bool(self._sdk_available)

    @staticmethod
    def normalize_lang(lang: Optional[str]) -> str:
        """Normalizes ProxDMR language code (lowercase, strips region, ua -> uk)."""
        if not lang:
            return ""
        clean = str(lang).strip().lower()
        if "-" in clean:
            clean = clean.split("-", 1)[0]
        if "_" in clean:
            clean = clean.split("_", 1)[0]
        if clean == "ua":
            clean = "uk"
        return clean

    def is_lang_supported(self, lang: Optional[str]) -> bool:
        """Returns True if the normalized language code is supported by silero-stress."""
        clean = self.normalize_lang(lang)
        return clean in ALL_SUPPORTED_LANG_MAP

    def get_supported_languages(self) -> List[str]:
        """Returns list of supported 2-letter ISO language codes."""
        return list(ALL_SUPPORTED_LANG_MAP.keys())

    def _configure_torch_threads_once(self) -> None:
        if self._torch_threads_configured:
            return
        self._torch_threads_configured = True
        try:
            import torch
            torch.set_num_threads(1)
        except Exception as e:
            logger.debug(f"[STRESS] Could not set torch num_threads=1: {e}")

    def _get_or_load_accentor(self, lang_code: str) -> Optional[Any]:
        """Lazily loads and caches a silero-stress accentor under self._lock."""
        if lang_code in self._accentors:
            return self._accentors[lang_code]
        if lang_code in self._failed_langs:
            return None
        if not self.is_available():
            return None

        model_key = ALL_SUPPORTED_LANG_MAP.get(lang_code)
        if not model_key:
            return None

        self._configure_torch_threads_once()

        try:
            import silero_stress
            accentor = None
            if lang_code in NEURAL_LANG_MAP:
                logger.info(f"[STRESS] Loading silero-stress neural accentor for '{lang_code}' (model='{model_key}')...")
                accentor = silero_stress.load_accentor(model_key)
            else:
                logger.info(f"[STRESS] Loading silero-stress simple accentor for '{lang_code}' (model='{model_key}')...")
                simple_cls = getattr(silero_stress, "SimpleAccentor", None)
                if simple_cls is None:
                    try:
                        from silero_stress.simple_accentor import SimpleAccentor as simple_cls  # type: ignore
                    except Exception:
                        simple_cls = None
                if simple_cls is not None:
                    accentor = simple_cls(model_key)
                else:
                    accentor = silero_stress.load_accentor(model_key)

            if accentor is not None:
                self._accentors[lang_code] = accentor
                logger.info(f"[STRESS] Accentor for '{lang_code}' loaded successfully.")
                return accentor
        except Exception as e:
            logger.warning(f"[STRESS] Failed to load accentor for '{lang_code}' ({model_key}): {e}")
            self._failed_langs.add(lang_code)
        return None

    @staticmethod
    def convert_plus_to_unicode_acute(text: str) -> str:
        """
        Converts silero-stress '+<vowel>' stress markers into '<vowel>\\u0301' (U+0301).
        - '+ё' / '+Ё' -> 'ё' / 'Ё' (no combining acute on inherently stressed ё/Ё)
        - '+<vowel>' -> '<vowel>\\u0301'
        - Preserves arithmetic/signal '+' not followed by letters (e.g. '59+20', '+10 дБ')
        - Removes any stray '+' directly before letters.
        """
        if not text:
            return text
        res = _PLUS_YO_RE.sub(r"\1", text)
        res = _STRAY_YO_ACUTE_RE.sub(r"\1", res)
        res = _DUP_ACUTE_VOWEL_RE.sub(r"\1", res)
        res = _STRESSABLE_VOWELS_RE.sub(lambda m: m.group(1) + "\u0301", res)
        res = _LEFTOVER_LETTER_PLUS_RE.sub("", res)
        return res

    def apply_stress_unicode(self, text: str, lang: str = "ru") -> str:
        """
        Applies stress marks to text using silero-stress and converts them
        to Unicode Combining Acute Accent (U+0301).
        Never raises: returns original text on any error or unsupported language.
        """
        if not text or not text.strip():
            return text
        if not self.is_available():
            return text

        clean_lang = self.normalize_lang(lang)
        if not self.is_lang_supported(clean_lang):
            return text

        try:
            with self._lock:
                accentor = self._get_or_load_accentor(clean_lang)
                if accentor is None:
                    return text
                stressed = accentor(text)
            if not isinstance(stressed, str) or not stressed:
                return text
            return self.convert_plus_to_unicode_acute(stressed)
        except Exception as e:
            logger.warning(f"[STRESS] apply_stress_unicode failed for lang='{clean_lang}': {e}")
            return text
