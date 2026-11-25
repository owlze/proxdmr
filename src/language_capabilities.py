# -*- coding: utf-8 -*-
"""
ProxDMR Dynamic Language Capabilities & Closest-Language ASR Resolver.

Single source of truth for:
1. Master catalog of supported languages (ISO-639-1 code, flag, native name, English name, 3-letter badge code).
2. Per-translator language capability lists (qwen, groq, gemini).
3. Per-ASR native language sets (rumble, groq, gemini).
4. Linguistically/phonetically closest fallback resolver for ASR when a language supported by the
   selected translator is not natively supported by the selected ASR engine.
"""

from collections import deque
from typing import Any, Dict, List, Optional, Set, Tuple

# Ordered master catalog (65 languages).
# Starts with the classic 25 languages in familiar order, followed by expanded regional/world languages.
LANGUAGE_CATALOG: List[Dict[str, str]] = [
    # --- Classic 25 (all engines) ---
    {"code": "en", "flag": "🇬🇧", "native": "English", "en": "English", "iso3": "ENG"},
    {"code": "uk", "flag": "🇺🇦", "native": "Українська", "en": "Ukrainian", "iso3": "UKR"},
    {"code": "de", "flag": "🇩🇪", "native": "Deutsch", "en": "German", "iso3": "DEU"},
    {"code": "fr", "flag": "🇫🇷", "native": "Français", "en": "French", "iso3": "FRA"},
    {"code": "es", "flag": "🇪🇸", "native": "Español", "en": "Spanish", "iso3": "ESP"},
    {"code": "it", "flag": "🇮🇹", "native": "Italiano", "en": "Italian", "iso3": "ITA"},
    {"code": "ru", "flag": "🇷🇺", "native": "Русский", "en": "Russian", "iso3": "RUS"},
    {"code": "pl", "flag": "🇵🇱", "native": "Polski", "en": "Polish", "iso3": "POL"},
    {"code": "pt", "flag": "🇵🇹", "native": "Português", "en": "Portuguese", "iso3": "POR"},
    {"code": "nl", "flag": "🇳🇱", "native": "Nederlands", "en": "Dutch", "iso3": "NLD"},
    {"code": "tr", "flag": "🇹🇷", "native": "Türkçe", "en": "Turkish", "iso3": "TUR"},
    {"code": "ja", "flag": "🇯🇵", "native": "日本語", "en": "Japanese", "iso3": "JPN"},
    {"code": "zh", "flag": "🇨🇳", "native": "中文", "en": "Chinese", "iso3": "CHN"},
    {"code": "ko", "flag": "🇰🇷", "native": "한국어", "en": "Korean", "iso3": "KOR"},
    {"code": "cs", "flag": "🇨🇿", "native": "Čeština", "en": "Czech", "iso3": "CZE"},
    {"code": "ro", "flag": "🇷🇴", "native": "Română", "en": "Romanian", "iso3": "RON"},
    {"code": "bg", "flag": "🇧🇬", "native": "Български", "en": "Bulgarian", "iso3": "BUL"},
    {"code": "el", "flag": "🇬🇷", "native": "Ελληνικά", "en": "Greek", "iso3": "GRE"},
    {"code": "hu", "flag": "🇭🇺", "native": "Magyar", "en": "Hungarian", "iso3": "HUN"},
    {"code": "sv", "flag": "🇸🇪", "native": "Svenska", "en": "Swedish", "iso3": "SWE"},
    {"code": "no", "flag": "🇳🇴", "native": "Norsk", "en": "Norwegian", "iso3": "NOR"},
    {"code": "fi", "flag": "🇫🇮", "native": "Suomi", "en": "Finnish", "iso3": "FIN"},
    {"code": "da", "flag": "🇩🇰", "native": "Dansk", "en": "Danish", "iso3": "DAN"},
    {"code": "he", "flag": "🇮🇱", "native": "עברית", "en": "Hebrew", "iso3": "HEB"},
    {"code": "ar", "flag": "🇸🇦", "native": "العربية", "en": "Arabic", "iso3": "ARA"},
    # --- Additional Qwen 2.5 core languages (+4 -> 29 total for Qwen) ---
    {"code": "vi", "flag": "🇻🇳", "native": "Tiếng Việt", "en": "Vietnamese", "iso3": "VIE"},
    {"code": "th", "flag": "🇹🇭", "native": "ไทย", "en": "Thai", "iso3": "THA"},
    {"code": "id", "flag": "🇮🇩", "native": "Bahasa Indonesia", "en": "Indonesian", "iso3": "IND"},
    {"code": "fa", "flag": "🇮🇷", "native": "فارسی", "en": "Persian", "iso3": "FAS"},
    # --- Additional Groq Cloud LLM languages (+22 -> 51 total for Groq) ---
    {"code": "ms", "flag": "🇲🇾", "native": "Bahasa Melayu", "en": "Malay", "iso3": "MSA"},
    {"code": "hi", "flag": "🇮🇳", "native": "हिन्दी", "en": "Hindi", "iso3": "HIN"},
    {"code": "tl", "flag": "🇵🇭", "native": "Filipino", "en": "Filipino", "iso3": "FIL"},
    {"code": "be", "flag": "🇧🇾", "native": "Беларуская", "en": "Belarusian", "iso3": "BEL"},
    {"code": "sk", "flag": "🇸🇰", "native": "Slovenčina", "en": "Slovak", "iso3": "SLK"},
    {"code": "sl", "flag": "🇸🇮", "native": "Slovenščina", "en": "Slovenian", "iso3": "SLV"},
    {"code": "hr", "flag": "🇭🇷", "native": "Hrvatski", "en": "Croatian", "iso3": "HRV"},
    {"code": "sr", "flag": "🇷🇸", "native": "Српски", "en": "Serbian", "iso3": "SRP"},
    {"code": "bs", "flag": "🇧🇦", "native": "Bosanski", "en": "Bosnian", "iso3": "BOS"},
    {"code": "mk", "flag": "🇲🇰", "native": "Македонски", "en": "Macedonian", "iso3": "MKD"},
    {"code": "lt", "flag": "🇱🇹", "native": "Lietuvių", "en": "Lithuanian", "iso3": "LIT"},
    {"code": "lv", "flag": "🇱🇻", "native": "Latviešu", "en": "Latvian", "iso3": "LAV"},
    {"code": "et", "flag": "🇪🇪", "native": "Eesti", "en": "Estonian", "iso3": "EST"},
    {"code": "ca", "flag": "🇪🇸", "native": "Català", "en": "Catalan", "iso3": "CAT"},
    {"code": "gl", "flag": "🇪🇸", "native": "Galego", "en": "Galician", "iso3": "GLG"},
    {"code": "eu", "flag": "🇪🇸", "native": "Euskara", "en": "Basque", "iso3": "EUS"},
    {"code": "kk", "flag": "🇰🇿", "native": "Қазақша", "en": "Kazakh", "iso3": "KAZ"},
    {"code": "az", "flag": "🇦🇿", "native": "Azərbaycanca", "en": "Azerbaijani", "iso3": "AZE"},
    {"code": "ka", "flag": "🇬🇪", "native": "ქართული", "en": "Georgian", "iso3": "KAT"},
    {"code": "hy", "flag": "🇦🇲", "native": "Հայերեն", "en": "Armenian", "iso3": "HYE"},
    {"code": "sq", "flag": "🇦🇱", "native": "Shqip", "en": "Albanian", "iso3": "SQI"},
    {"code": "is", "flag": "🇮🇸", "native": "Íslenska", "en": "Icelandic", "iso3": "ISL"},
    # --- Additional Gemini LLM languages (+14 -> 65 total for Gemini) ---
    {"code": "af", "flag": "🇿🇦", "native": "Afrikaans", "en": "Afrikaans", "iso3": "AFR"},
    {"code": "bn", "flag": "🇧🇩", "native": "বাংলা", "en": "Bengali", "iso3": "BEN"},
    {"code": "ur", "flag": "🇵🇰", "native": "اردو", "en": "Urdu", "iso3": "URD"},
    {"code": "ta", "flag": "🇮🇳", "native": "தமிழ்", "en": "Tamil", "iso3": "TAM"},
    {"code": "mr", "flag": "🇮🇳", "native": "मराठी", "en": "Marathi", "iso3": "MAR"},
    {"code": "uz", "flag": "🇺🇿", "native": "Oʻzbekcha", "en": "Uzbek", "iso3": "UZB"},
    {"code": "ky", "flag": "🇰🇬", "native": "Кыргызча", "en": "Kyrgyz", "iso3": "KIR"},
    {"code": "mn", "flag": "🇲🇳", "native": "Монгол", "en": "Mongolian", "iso3": "MON"},
    {"code": "ne", "flag": "🇳🇵", "native": "नेपाली", "en": "Nepali", "iso3": "NEP"},
    {"code": "lo", "flag": "🇱🇦", "native": "ລາວ", "en": "Lao", "iso3": "LAO"},
    {"code": "sw", "flag": "🇰🇪", "native": "Kiswahili", "en": "Swahili", "iso3": "SWA"},
    {"code": "cy", "flag": "🏴", "native": "Cymraeg", "en": "Welsh", "iso3": "CYM"},
    {"code": "ga", "flag": "🇮🇪", "native": "Gaeilge", "en": "Irish", "iso3": "GLE"},
    {"code": "mt", "flag": "🇲🇹", "native": "Malti", "en": "Maltese", "iso3": "MLT"},
]

LANGUAGE_BY_CODE: Dict[str, Dict[str, str]] = {item["code"]: item for item in LANGUAGE_CATALOG}

# Supported source languages per translation engine
_QWEN_CODES: List[str] = [
    "en", "uk", "de", "fr", "es", "it", "ru", "pl", "pt", "nl", "tr", "ja", "zh", "ko",
    "cs", "ro", "bg", "el", "hu", "sv", "no", "fi", "da", "he", "ar", "vi", "th", "id", "fa",
]

_GROQ_EXTRA_CODES: List[str] = [
    "ms", "hi", "tl", "be", "sk", "sl", "hr", "sr", "bs", "mk", "lt", "lv", "et",
    "ca", "gl", "eu", "kk", "az", "ka", "hy", "sq", "is",
]

_GEMINI_EXTRA_CODES: List[str] = [
    "af", "bn", "ur", "ta", "mr", "uz", "ky", "mn", "ne", "lo", "sw", "cy", "ga", "mt",
]

TRANSLATOR_LANGUAGES: Dict[str, List[str]] = {
    "qwen": list(_QWEN_CODES),
    "groq": list(_QWEN_CODES) + list(_GROQ_EXTRA_CODES),
    "gemini": list(_QWEN_CODES) + list(_GROQ_EXTRA_CODES) + list(_GEMINI_EXTRA_CODES),
}

# Native ASR forced-language support sets
# 1) Rumble-2-Flash (Qwen3-ASR + Reson8 fine-tune): 30 native forced languages
_RUMBLE_NATIVE_CODES: List[str] = [
    "en", "uk", "de", "fr", "es", "it", "ru", "pl", "pt", "nl", "tr", "ja", "zh", "ko",
    "cs", "ro", "el", "hu", "sv", "fi", "da", "ar", "vi", "th", "id", "fa", "ms", "hi",
    "tl", "mk",
]

# 2) Groq Whisper Large-v3: official 99 Whisper ISO-639-1 codes
_GROQ_WHISPER_NATIVE_SET: Set[str] = {
    "af", "am", "ar", "as", "az", "ba", "be", "bg", "bn", "bo", "br", "bs", "ca", "cs",
    "cy", "da", "de", "el", "en", "es", "et", "eu", "fa", "fi", "fo", "fr", "gl", "gu",
    "ha", "haw", "he", "hi", "hr", "ht", "hu", "hy", "id", "is", "it", "ja", "jw", "ka",
    "kk", "km", "kn", "ko", "la", "lb", "ln", "lo", "lt", "lv", "mg", "mi", "mk", "ml",
    "mn", "mr", "ms", "mt", "my", "ne", "nl", "nn", "no", "oc", "pa", "pl", "ps", "pt",
    "ro", "ru", "sa", "sd", "si", "sk", "sl", "sn", "so", "sq", "sr", "su", "sv", "sw",
    "ta", "te", "tg", "th", "tk", "tl", "tr", "tt", "uk", "ur", "uz", "vi", "yi", "yo",
    "zh",
}

# Ordered catalog subset for Groq Whisper UI list (63 of 65 catalog languages; excludes ky, ga)
_GROQ_ASR_CATALOG_CODES: List[str] = [
    item["code"] for item in LANGUAGE_CATALOG if item["code"] in _GROQ_WHISPER_NATIVE_SET
]

# 3) Gemini multimodal ASR: supports all 65 catalog languages natively (+ extra ISO codes)
_GEMINI_ASR_CATALOG_CODES: List[str] = [item["code"] for item in LANGUAGE_CATALOG]

ASR_NATIVE_LANGUAGES: Dict[str, Set[str]] = {
    "rumble": set(_RUMBLE_NATIVE_CODES),
    "groq": set(_GROQ_WHISPER_NATIVE_SET),
    "gemini": set(_GEMINI_ASR_CATALOG_CODES) | set(_GROQ_WHISPER_NATIVE_SET),
}

ASR_UI_LANGUAGE_LISTS: Dict[str, List[str]] = {
    "rumble": list(_RUMBLE_NATIVE_CODES),
    "groq": list(_GROQ_ASR_CATALOG_CODES),
    "gemini": list(_GEMINI_ASR_CATALOG_CODES),
}

# Direct aliases (deprecated/regional/3-letter codes -> canonical ISO-639-1)
LANG_CODE_ALIASES: Dict[str, str] = {
    "fil": "tl",
    "tagalog": "tl",
    "filipino": "tl",
    "iw": "he",
    "nb": "no",
    "nn": "no",
    "bokmal": "no",
    "nynorsk": "no",
    "in": "id",
    "ji": "yi",
    "jw": "id",
    "ger": "de",
    "fre": "fr",
    "dut": "nl",
    "spa": "es",
    "chi": "zh",
    "zho": "zh",
    "chn": "zh",
    "gre": "el",
    "ell": "el",
    "cze": "cs",
    "ces": "cs",
    "slo": "sk",
    "rum": "ro",
    "per": "fa",
    "alb": "sq",
    "arm": "hy",
    "geo": "ka",
    "ice": "is",
    "mac": "mk",
    "wel": "cy",
    "baq": "eu",
    "bur": "my",
}

# Ordered phonetic/linguistic proximity graph used by BFS in resolve_asr_language().
# First matching language supported by the target ASR engine is chosen.
CLOSEST_LANG_CHAIN: Dict[str, Tuple[str, ...]] = {
    # Slavic
    "be": ("ru", "uk", "pl"),
    "bg": ("mk", "ru", "uk"),
    "mk": ("bg", "sr", "ru"),
    "sr": ("mk", "hr", "ru", "cs"),
    "hr": ("cs", "pl", "mk", "sr"),
    "bs": ("hr", "cs", "mk", "sr"),
    "sl": ("hr", "cs", "pl"),
    "sk": ("cs", "pl", "ru"),
    "cs": ("sk", "pl", "ru"),
    "uk": ("ru", "pl", "be"),
    "ru": ("uk", "be", "bg"),
    "pl": ("cs", "sk", "uk"),
    # Nordic & Germanic
    "no": ("da", "sv", "de"),
    "da": ("no", "sv", "de"),
    "sv": ("no", "da", "de"),
    "is": ("da", "no", "sv"),
    "fo": ("da", "is", "no"),
    "af": ("nl", "de", "en"),
    "nl": ("de", "af", "en"),
    "lb": ("de", "fr", "nl"),
    "fy": ("nl", "de", "en"),
    "yi": ("de", "he", "en"),
    "de": ("nl", "en", "da"),
    "en": ("de", "nl", "fr"),
    # Romance & Iberian
    "ca": ("es", "fr", "it"),
    "gl": ("pt", "es", "fr"),
    "eu": ("es", "fr"),
    "oc": ("fr", "es", "ca"),
    "es": ("pt", "it", "fr"),
    "pt": ("es", "it", "fr"),
    "it": ("es", "fr", "ro"),
    "fr": ("it", "es", "en"),
    "ro": ("it", "es", "fr"),
    # Baltic & Finno-Ugric
    "et": ("fi", "de", "ru"),
    "fi": ("et", "sv", "hu"),
    "lt": ("pl", "cs", "de", "ru"),
    "lv": ("cs", "pl", "de", "ru"),
    "hu": ("fi", "de", "ro"),
    # Balkan / Mediterranean / Celtic
    "sq": ("it", "el", "ro"),
    "el": ("it", "tr", "ro"),
    "mt": ("it", "ar", "en"),
    "cy": ("en", "fr"),
    "ga": ("en", "cy"),
    "gd": ("en", "cy"),
    "br": ("fr", "en"),
    # Semitic & Middle East & Caucasus
    "he": ("ar", "en"),
    "ar": ("he", "fa", "tr"),
    "am": ("ar", "en"),
    "fa": ("ar", "tr", "hi"),
    "ku": ("fa", "tr", "ar"),
    "tg": ("fa", "ru"),
    "ka": ("ru", "tr", "el"),
    "hy": ("ru", "el", "tr"),
    # Turkic & Mongolic
    "az": ("tr", "ru", "fa"),
    "tr": ("az", "fa", "el"),
    "tk": ("tr", "ru"),
    "uz": ("tr", "ru", "fa"),
    "ug": ("uz", "tr", "ru"),
    "kk": ("ru", "tr"),
    "ky": ("kk", "ru", "tr"),
    "tt": ("ru", "tr"),
    "ba": ("ru", "tr"),
    "mn": ("ru", "zh"),
    # South & Southeast Asia
    "ur": ("hi", "fa", "ar"),
    "mr": ("hi", "en"),
    "ne": ("hi", "en"),
    "bn": ("hi", "en"),
    "pa": ("hi", "en"),
    "ta": ("hi", "en"),
    "te": ("hi", "en"),
    "si": ("hi", "en"),
    "hi": ("ur", "fa", "en"),
    "lo": ("th", "vi"),
    "km": ("th", "vi"),
    "my": ("th", "zh"),
    "th": ("lo", "vi", "zh"),
    "vi": ("th", "zh", "en"),
    "id": ("ms", "tl", "en"),
    "ms": ("id", "tl", "en"),
    "tl": ("id", "ms", "es", "en"),
    # East Asia & Africa
    "zh": ("ja", "ko", "vi"),
    "ja": ("ko", "zh", "en"),
    "ko": ("ja", "zh", "en"),
    "sw": ("en", "ar"),
}

# Derived lookup dictionaries exported for transcriber.py / translation_service.py / fast_lid_service.py
LANG_NAMES_EN_ALL: Dict[str, str] = {item["code"]: item["en"] for item in LANGUAGE_CATALOG}
LANG_3LETTER_ALL: Dict[str, str] = {item["code"]: item["iso3"] for item in LANGUAGE_CATALOG}
LANG_NAME_TO_CODE_ALL: Dict[str, str] = {item["en"].lower(): item["code"] for item in LANGUAGE_CATALOG}
LANG_NAME_TO_CODE_ALL.update({"tagalog": "tl", "mandarin": "zh", "cantonese": "zh", "bokmal": "no"})

LANG_DISPLAY_NAMES_ALL: Dict[str, str] = {
    item["code"]: (f"{item['en']} ({item['native']})" if item["native"].lower() != item["en"].lower() else item["en"])
    for item in LANGUAGE_CATALOG
}

ISO3_TO_ISO2_ALL: Dict[str, str] = {item["iso3"].lower(): item["code"] for item in LANGUAGE_CATALOG}
ISO3_TO_ISO2_ALL.update({
    k: v for k, v in LANG_CODE_ALIASES.items() if len(k) == 3 and v in LANGUAGE_BY_CODE
})


def normalize_lang_code(code: Optional[str]) -> str:
    """Normalize ISO-2 / ISO-3 / language name / alias to canonical ISO-639-1 code."""
    raw = (code or "").strip().lower()
    if not raw or raw in ("auto", "none", "---", "unknown"):
        return ""
    if raw in LANG_CODE_ALIASES:
        return LANG_CODE_ALIASES[raw]
    if raw in LANGUAGE_BY_CODE:
        return raw
    if raw in ISO3_TO_ISO2_ALL:
        return ISO3_TO_ISO2_ALL[raw]
    if raw in LANG_NAME_TO_CODE_ALL:
        return LANG_NAME_TO_CODE_ALL[raw]
    if len(raw) > 2 and "-" in raw:
        head = raw.split("-", 1)[0]
        if head in LANG_CODE_ALIASES:
            return LANG_CODE_ALIASES[head]
        return head[:2]
    if len(raw) == 2:
        return raw
    return raw[:2]


def resolve_asr_language(source_iso2: Optional[str], asr_engine: str) -> Tuple[Optional[str], bool]:
    """
    Resolve the best ASR recognition language code for `asr_engine` (`rumble`, `groq`, `gemini`).

    Returns `(resolved_iso2, is_fallback)`:
      - `(None, False)` if input is empty / `"auto"` / `"none"`.
      - `(canonical_iso2, False)` if natively supported by `asr_engine`.
      - `(closest_iso2, True)` if not natively supported — returns closest phonetically/linguistically
        related language supported by `asr_engine` via BFS over `CLOSEST_LANG_CHAIN`.
      - `(None, True)` if no supported neighbor exists (safe auto-detect fallback, never HTTP 400).
    """
    canonical = normalize_lang_code(source_iso2)
    if not canonical:
        return None, False

    eng = (asr_engine or "groq").strip().lower()
    native_set = ASR_NATIVE_LANGUAGES.get(eng)
    if native_set is None:
        return canonical, False

    if canonical in native_set:
        return canonical, False

    visited: Set[str] = {canonical}
    queue: deque = deque(CLOSEST_LANG_CHAIN.get(canonical, ()))
    while queue:
        cand = queue.popleft()
        if cand in visited:
            continue
        visited.add(cand)
        if cand in native_set:
            return cand, True
        for nxt in CLOSEST_LANG_CHAIN.get(cand, ()):
            if nxt not in visited:
                queue.append(nxt)

    return None, True


def get_translator_languages(translation_engine: str) -> List[str]:
    """Return ordered list of source language codes supported by the selected translator."""
    eng = (translation_engine or "groq").strip().lower()
    return list(TRANSLATOR_LANGUAGES.get(eng, TRANSLATOR_LANGUAGES["groq"]))


def get_asr_languages(asr_engine: str) -> List[str]:
    """Return ordered list of native language codes for the selected ASR engine."""
    eng = (asr_engine or "groq").strip().lower()
    return list(ASR_UI_LANGUAGE_LISTS.get(eng, ASR_UI_LANGUAGE_LISTS["groq"]))


def get_language_capabilities_payload() -> Dict[str, Any]:
    """Serializable capabilities payload served to the frontend via GET /api/transcriber/settings."""
    return {
        "catalog": LANGUAGE_CATALOG,
        "translators": TRANSLATOR_LANGUAGES,
        "asr_ui": ASR_UI_LANGUAGE_LISTS,
        "asr_native": {k: sorted(v) for k, v in ASR_NATIVE_LANGUAGES.items()},
        "closest_chain": {k: list(v) for k, v in CLOSEST_LANG_CHAIN.items()},
        "aliases": LANG_CODE_ALIASES,
    }
