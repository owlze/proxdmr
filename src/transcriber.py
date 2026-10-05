import asyncio
import base64
import io
import json
import logging
import math
import re
import struct
import time
import urllib.error
import urllib.request
import wave
from collections import OrderedDict
from typing import Dict, Any, List, Optional, Callable, Tuple

try:
    import numpy as np
except ImportError:
    np = None

from tts_normalizer import (
    strip_callsigns_for_tts,
    normalize_for_russian_tts,
    filter_hesitation_fillers,
)

logger = logging.getLogger("proxdmr.transcriber")

LANG_NAMES: Dict[str, str] = {
    "ru": "русский",
    "en": "английский",
    "uk": "украинский",
    "de": "немецкий",
    "fr": "французский",
    "es": "испанский",
    "it": "итальянский",
    "pl": "польский",
    "pt": "португальский",
    "nl": "нидерландский",
    "tr": "турецкий",
    "ja": "японский",
    "zh": "китайский",
    "ko": "корейский",
    "cs": "чешский",
    "ro": "румынский",
    "bg": "болгарский",
    "el": "греческий",
    "hu": "венгерский",
    "sv": "шведский",
    "no": "норвежский",
    "fi": "финский",
    "da": "датский",
    "he": "иврит",
    "ar": "арабский",
    "none": "без перевода"
}

LANG_NAMES_EN: Dict[str, str] = {
    "ru": "Russian",
    "en": "English",
    "uk": "Ukrainian",
    "de": "German",
    "fr": "French",
    "es": "Spanish",
    "it": "Italian",
    "pl": "Polish",
    "pt": "Portuguese",
    "nl": "Dutch",
    "tr": "Turkish",
    "ja": "Japanese",
    "zh": "Chinese",
    "ko": "Korean",
    "cs": "Czech",
    "ro": "Romanian",
    "bg": "Bulgarian",
    "el": "Greek",
    "hu": "Hungarian",
    "sv": "Swedish",
    "no": "Norwegian",
    "fi": "Finnish",
    "da": "Danish",
    "he": "Hebrew",
    "ar": "Arabic",
    "none": "original language"
}

DEFAULT_MODELS_DATA: List[Dict[str, Any]] = [
    {
        "id": "gemini-3.1-flash-lite",
        "name": "Gemini 3.1 Flash-Lite — ⚡ Free Tier (Ультрабыстрая, для бесплатных ключей)",
        "description": "Наилучший выбор для бесплатных API-ключей: минимальная задержка, максимальная доступность и стабильная работа с аудио и переводом.",
        "badge": "Free Tier",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Free Tier", "Ультранизкая задержка"]
    },
    {
        "id": "gemini-3.5-flash",
        "name": "Gemini 3.5 Flash — ⚡ Речь + Перевод (Рекомендуется)",
        "description": "Оптимальный баланс скорости и качества для радиоэфира в реальном времени. Высокая точность радиотерминологии.",
        "badge": "Рекомендуется",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Низкая задержка"]
    },
    {
        "id": "gemini-3.5-flash-lite",
        "name": "Gemini 3.5 Flash-Lite — 🚀 Ультрабыстрая (Минимальная задержка)",
        "description": "Минимальная задержка отклика, идеальна при плотном радиообмене и экономии квот.",
        "badge": "Минимальная задержка",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Ультранизкая задержка"]
    },
    {
        "id": "gemini-3.1-flash-lite-preview",
        "name": "Gemini 3.1 Flash-Lite Preview — ⚡ Free Tier Preview",
        "description": "Предварительная версия 3.1 Flash-Lite для распознавания и перевода речи.",
        "badge": "Free Preview",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Free Tier"]
    },
    {
        "id": "gemini-3.6-flash",
        "name": "Gemini 3.6 Flash — ✨ Новое поколение (Высокая детализация)",
        "description": "Новейшая архитектура Flash с улучшенным распознаванием зашумленной речи и сложных позывных.",
        "badge": "Новое поколение",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Шумоподавление"]
    },
    {
        "id": "gemini-3.7-flash",
        "name": "Gemini 3.7 Flash — ⚡ Новая версия Flash",
        "description": "Новое поколение гибридной модели Flash с высокой скоростью и точностью.",
        "badge": "Flash 3.7",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод"]
    },
    {
        "id": "gemini-3.8-flash",
        "name": "Gemini 3.8 Flash — ⚡ Новейшая Flash",
        "description": "Самая современная модель серии Flash для обработки звука и текста.",
        "badge": "Flash 3.8",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод"]
    },
    {
        "id": "gemini-flash-latest",
        "name": "Gemini Flash Latest — 🔄 Всегда актуальная версия Flash",
        "description": "Автоматически использует самую свежую стабильную версию линейки Flash от Google.",
        "badge": "Авто-обновление",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Авто-обновление"]
    },
    {
        "id": "gemini-flash-lite-latest",
        "name": "Gemini Flash-Lite Latest — 🔄 Всегда актуальная Lite",
        "description": "Автоматически использует самую свежую облегченную версию Gemini Flash-Lite.",
        "badge": "Авто-обновление",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод", "Авто-обновление"]
    },
    {
        "id": "gemini-2.5-flash",
        "name": "Gemini 2.5 Flash — ⚡ Стабильная Flash (Free/Paid)",
        "description": "Надежная стабильная рабочая модель для транскрипции и перевода.",
        "badge": "Flash 2.5",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод"]
    },
    {
        "id": "gemini-2.5-flash-lite",
        "name": "Gemini 2.5 Flash-Lite — ⚡ Стабильная Lite (Free/Paid)",
        "description": "Легковесная стабильная модель линейки 2.5 с низким расходом квот.",
        "badge": "Lite 2.5",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Синхронный перевод"]
    },
    {
        "id": "gemini-3.5-transcribe",
        "name": "Gemini 3.5 Transcribe — 🎙️ Распознавание речи (ASR)",
        "description": "Специализированная аудио модель Google для распознавания речи.",
        "badge": "ASR",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "ASR"]
    },
    {
        "id": "gemini-3.1-pro-preview",
        "name": "Gemini 3.1 Pro — 🧠 Pro (Максимальная точность)",
        "description": "Флагманская модель Pro с максимальным качеством и глубоким пониманием радио-жаргона.",
        "badge": "Pro",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Высочайшее качество перевода", "Глубокий контекст"]
    },
    {
        "id": "gemini-2.5-pro",
        "name": "Gemini 2.5 Pro — 🧠 Pro (Высокое качество)",
        "description": "Качественная флагманская модель линейки 2.5 для точного контекстного анализа.",
        "badge": "Pro",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Высокая точность перевода", "Глубокий контекст"]
    },
    {
        "id": "gemini-pro-latest",
        "name": "Gemini Pro Latest — 🧠 Актуальная Pro",
        "description": "Самая свежая версия флагманской модели Pro от Google.",
        "badge": "Pro",
        "category": "transcribe",
        "capabilities": ["Распознавание речи", "Высокая точность перевода"]
    }
]

DEFAULT_TTS_MODELS_DATA: List[Dict[str, Any]] = [
    {
        "id": "gemini-3.1-flash-tts-preview",
        "name": "Gemini 3.1 Flash TTS Preview — ⚡ Новейшая (Рекомендуется)",
        "description": "Новейшая TTS: низкая задержка, 30 голосов, поддержка стриминга, мульти-спикеры.",
        "badge": "Рекомендуется",
        "category": "tts",
        "capabilities": ["Синтез речи", "30 голосов", "Низкая задержка", "Free Tier"]
    },
    {
        "id": "gemini-3.8-flash-lite-tts",
        "name": "Gemini 3.8 Flash-Lite TTS — ⚡ Быстрый синтез (TTS)",
        "description": "Облегченная модель генерации речи Text-to-Speech с ультранизкой задержкой.",
        "badge": "Быстрая TTS",
        "category": "tts",
        "capabilities": ["Синтез речи", "Низкая задержка", "Text-to-Speech"]
    },
    {
        "id": "gemini-3.8-flash-tts",
        "name": "Gemini 3.8 Flash TTS — 🔊 Синтез речи (TTS)",
        "description": "Полноформатная модель Text-to-Speech высокого качества.",
        "badge": "TTS",
        "category": "tts",
        "capabilities": ["Синтез речи", "Высокое качество", "Text-to-Speech"]
    },
    {
        "id": "gemini-2.5-flash-preview-tts",
        "name": "Gemini 2.5 Flash TTS Preview — 🚀 Быстрая (Free Tier)",
        "description": "Быстрая и экономичная генерация речи с минимальной задержкой.",
        "badge": "Быстрая",
        "category": "tts",
        "capabilities": ["Синтез речи", "Быстрый отклик", "Free Tier"]
    },
    {
        "id": "gemini-2.5-pro-preview-tts",
        "name": "Gemini 2.5 Pro TTS Preview — 🧠 Студийное качество (Paid)",
        "description": "Студийное качество синтеза речи — для подкастов и аудиокниг. Только платный тариф.",
        "badge": "Pro",
        "category": "tts",
        "capabilities": ["Синтез речи", "Студийное качество", "Paid Tier"]
    },
    {
        "id": "gemini-3.1-flash-live-preview",
        "name": "Gemini 3.1 Flash Live — 🎙️ Live Voice (Двустороннее аудио)",
        "description": "Интерактивная голосовая модель реального времени Live API.",
        "badge": "Live Voice",
        "category": "tts",
        "capabilities": ["Генерация речи в реальном времени", "Live API"]
    }
]

DEFAULT_MODELS = [m["id"] for m in DEFAULT_MODELS_DATA]

PHONETIC_LETTERS_MAP: Dict[str, str] = {
    # English NATO & common DX phonetic words
    "ALPHA": "A", "ALFA": "A", "AMERICA": "A",
    "BRAVO": "B", "BOSTON": "B", "BAKER": "B",
    "CHARLIE": "C", "CANADA": "C",
    "DELTA": "D", "DENMARK": "D", "DAVID": "D",
    "ECHO": "E", "ENGLAND": "E",
    "FOXTROT": "F", "FOX": "F", "FLORIDA": "F",
    "GOLF": "G", "GERMANY": "G", "GEORGE": "G",
    "HOTEL": "H", "HONOLULU": "H", "HAWAII": "H", "HENRY": "H",
    "INDIA": "I", "ITALY": "I",
    "JULIETT": "J", "JULIET": "J", "JAPAN": "J",
    "KILO": "K", "KILOWATT": "K", "KENTUCKY": "K",
    "LIMA": "L", "LONDON": "L",
    "MIKE": "M", "MEXICO": "M", "MARY": "M",
    "NOVEMBER": "N", "NORWAY": "N",
    "OSCAR": "O", "ONTARIO": "O", "OCEAN": "O",
    "PAPA": "P", "PACIFIC": "P", "PETER": "P",
    "QUEBEC": "Q", "QUEEN": "Q",
    "ROMEO": "R", "RADIO": "R", "ROBERT": "R",
    "SIERRA": "S", "SUGAR": "S", "SANTIAGO": "S",
    "TANGO": "T", "TEXAS": "T", "TOKYO": "T",
    "UNIFORM": "U", "UNITED": "U",
    "VICTOR": "V", "VICTORIA": "V",
    "WHISKEY": "W", "WASHINGTON": "W",
    "XRAY": "X", "X-RAY": "X",
    "YANKEE": "Y", "YORK": "Y",
    "ZULU": "Z", "ZANZIBAR": "Z",

    # Russian phonetic transliterations / equivalents
    "АЛЬФА": "A",
    "БРАВО": "B",
    "ЧАРЛИ": "C",
    "ДЕЛЬТА": "D",
    "ЭХО": "E",
    "ФОКСТРОТ": "F", "ФОКС": "F",
    "ГОЛЬФ": "G",
    "ОТЕЛЬ": "H", "ХОТЕЛ": "H",
    "ИНДИЯ": "I",
    "ДЖУЛЬЕТ": "J", "ДЖУЛЬЕТТ": "J",
    "КИЛО": "K",
    "ЛИМА": "L",
    "МАЙК": "M",
    "НОЯБРЬ": "N", "НОВЕМБЕР": "N",
    "ОСКАР": "O",
    "ПАПА": "P",
    "КВЕБЕК": "Q",
    "РОМЕО": "R", "РАДИО": "R",
    "СЬЕРРА": "S", "СИЕРРА": "S", "ШУГАР": "S", "СУГАР": "S",
    "ТАНГО": "T",
    "УНИФОРМ": "U", "ЮНИФОРМ": "U",
    "ВИКТОР": "V",
    "ВИСКИ": "W", "УИСКИ": "W",
    "ИКС-РЭЙ": "X", "ИКСРЭЙ": "X", "РЕНТГЕН": "X",
    "ЯНКИ": "Y",
    "ЗУЛУ": "Z", "ЗУЛУС": "Z"
}

RADIO_JARGON_PHONETIC_RU: Dict[str, str] = {
    r"\bQTH\b": "Кю-Ти-Эйч",
    r"\bQSO\b": "Кю-Эс-О",
    r"\bQSL\b": "Кю-Эс-Эл",
    r"\bQRZ\b": "Кю-Эр-Зет",
    r"\bQRM\b": "Кю-Эр-Эм",
    r"\bQRN\b": "Кю-Эр-Эн",
    r"\bQRO\b": "Кю-Эр-О",
    r"\bQRP\b": "Кю-Эр-Пи",
    r"\bQRT\b": "Кю-Эр-Ти",
    r"\bQRX\b": "Кю-Эр-Икс",
    r"\bQRV\b": "Кю-Эр-Ви",
    r"\bQSY\b": "Кю-Эс-Вай",
    r"\bQSB\b": "Кю-Эс-Би",
    r"\b73\b": "семьдесят три",
    r"\b73['’]?s\b": "семьдесят три",
    r"\bseventy[- ]three\b": "семьдесят три",
    r"\b88\b": "восемьдесят восемь",
    r"\beighty[- ]eight\b": "восемьдесят восемь",
    r"\bCQ\b": "Цэ-Кю",
    r"\bCW\b": "Си-Дабл-ю",
    r"\bSSB\b": "Эс-Эс-Би",
    r"\bDX\b": "Ди-Экс",
    r"\bRST\b": "Эр-Эс-Ти",
    r"\bRS\b": "эр-эс",
    r"\bOM\b": "олд мэн",
    r"\bYL\b": "ян лэди",
    r"\bRoger\b": "роджер",
    r"\bРоджер\b": "роджер",
    r"\bUTC\b": "ю-ти-си",
    r"\bHi-Hi\b": "ха-ха",
    r"\b599\b": "пять-девять-девять",
    r"\b59\b": "пять-девять",
    r"\bfive[- ]nine\b": "пять-девять",
    r"\bfive[- ]nine[- ]nine\b": "пять-девять-девять",
}

RADIO_JARGON_PHONETIC_EN: Dict[str, str] = {
    r"\b73\b": "seventy-three",
    r"\b73['’]?s\b": "seventy-three",
    r"\b88\b": "eighty-eight",
    r"\b599\b": "five-nine-nine",
    r"\b59\b": "five-nine",
}

RADIO_JARGON_PHONETIC_UK: Dict[str, str] = {
    r"\b73\b": "сімдесят три",
    r"\b73['’]?s\b": "сімдесят три",
    r"\bseventy[- ]three\b": "сімдесят три",
    r"\b88\b": "вісімдесят вісім",
    r"\beighty[- ]eight\b": "вісімдесят вісім",
    r"\b599\b": "п'ять-дев'ять-дев'ять",
    r"\b59\b": "п'ять-дев'ять",
    r"\bfive[- ]nine\b": "п'ять-дев'ять",
    r"\bfive[- ]nine[- ]nine\b": "п'ять-дев'ять-дев'ять",
    r"\bQTH\b": "к'ю-ті-ейч",
    r"\bQSO\b": "к'ю-ес-о",
    r"\bQSL\b": "к'ю-ес-ел",
    r"\bRoger\b": "роджер",
    r"\bРоджер\b": "роджер",
}

RADIO_JARGON_PHONETIC_DE: Dict[str, str] = {
    r"\b73\b": "dreiundsiebzig",
    r"\b73['’]?s\b": "dreiundsiebzig",
    r"\bseventy[- ]three\b": "dreiundsiebzig",
    r"\b88\b": "achtundachtzig",
    r"\beighty[- ]eight\b": "achtundachtzig",
    r"\b599\b": "fünf-neun-neun",
    r"\b59\b": "fünf-neun",
    r"\bfive[- ]nine\b": "fünf-neun",
    r"\bfive[- ]nine[- ]nine\b": "fünf-neun-neun",
}

RADIO_JARGON_PHONETIC_ES: Dict[str, str] = {
    r"\b73\b": "setenta y tres",
    r"\b73['’]?s\b": "setenta y tres",
    r"\bseventy[- ]three\b": "setenta y tres",
    r"\b88\b": "ochenta y ocho",
    r"\beighty[- ]eight\b": "ochenta y ocho",
    r"\b599\b": "cinco-nueve-nueve",
    r"\b59\b": "cinco-nueve",
    r"\bfive[- ]nine\b": "cinco-nueve",
    r"\bfive[- ]nine[- ]nine\b": "cinco-nueve-nueve",
}

RADIO_JARGON_PHONETIC_FR: Dict[str, str] = {
    r"\b73\b": "soixante-treize",
    r"\b73['’]?s\b": "soixante-treize",
    r"\bseventy[- ]three\b": "soixante-treize",
    r"\b88\b": "quatre-vingt-huit",
    r"\beighty[- ]eight\b": "quatre-vingt-huit",
    r"\b599\b": "cinq-neuf-neuf",
    r"\b59\b": "cinq-neuf",
    r"\bfive[- ]nine\b": "cinq-neuf",
    r"\bfive[- ]nine[- ]nine\b": "cinq-neuf-neuf",
}

RADIO_JARGON_PHONETIC_IT: Dict[str, str] = {
    r"\b73\b": "settantatré",
    r"\b73['’]?s\b": "settantatré",
    r"\bseventy[- ]three\b": "settantatré",
    r"\b88\b": "ottantotto",
    r"\beighty[- ]eight\b": "ottantotto",
    r"\b599\b": "cinque-nove-nove",
    r"\b59\b": "cinque-nove",
    r"\bfive[- ]nine\b": "cinque-nove",
    r"\bfive[- ]nine[- ]nine\b": "cinque-nove-nove",
}

RADIO_JARGON_PHONETIC_PL: Dict[str, str] = {
    r"\b73\b": "siedemdziesiąt trzy",
    r"\b73['’]?s\b": "siedemdziesiąt trzy",
    r"\bseventy[- ]three\b": "siedemdziesiąt trzy",
    r"\b88\b": "osiemdziesiąt osiem",
    r"\beighty[- ]eight\b": "osiemdziesiąt osiem",
    r"\b599\b": "pięć-dziewięć-dziewięć",
    r"\b59\b": "pięć-dziewięć",
    r"\bfive[- ]nine\b": "pięć-dziewięć",
    r"\bfive[- ]nine[- ]nine\b": "pięć-dziewięć-dziewięć",
}

HAM_73_PHONETIC_BY_LANG: Dict[str, str] = {
    "ru": "семьдесят три",
    "en": "seventy-three",
    "uk": "сімдесят три",
    "de": "dreiundsiebzig",
    "es": "setenta y tres",
    "fr": "soixante-treize",
    "it": "settantatré",
    "pl": "siedemdziesiąt trzy",
    "pt": "setenta e três",
    "nl": "drieënzeventig",
    "tr": "yetmiş üç",
    "ja": "七十三",
    "zh": "七十三",
    "ko": "칠십삼",
    "cs": "sedmdesát tři",
    "ro": "șaptezeci și trei",
    "bg": "седемдесет и три",
    "el": "εβδομήντα τρία",
    "hu": "hetvenhárom",
    "sv": "sjuttiotre",
    "no": "syttitre",
    "fi": "seitsemänkymmentäkolme",
    "da": "treoghalvfjerds",
    "he": "שבעים ושלוש",
    "ar": "ثلاثة وسبعون",
}

HAM_88_PHONETIC_BY_LANG: Dict[str, str] = {
    "ru": "восемьдесят восемь",
    "en": "eighty-eight",
    "uk": "вісімдесят вісім",
    "de": "achtundachtzig",
    "es": "ochenta y ocho",
    "fr": "quatre-vingt-huit",
    "it": "ottantotto",
    "pl": "osiemdziesiąt osiem",
    "pt": "oitenta e oito",
    "nl": "achtentachtig",
    "tr": "seksen sekiz",
    "ja": "八十八",
    "zh": "八十八",
    "ko": "팔십팔",
    "cs": "osmdesát osm",
    "ro": "optzeci și opt",
    "bg": "осемдесет и осем",
    "el": "ογδόντα οκτώ",
    "hu": "nyolcvannyolc",
    "sv": "åttioåtta",
    "no": "syttifire",
    "fi": "kahdeksankymmentäkahdeksan",
    "da": "otteogfirs",
    "he": "שמונים ושמונה",
    "ar": "ثمانية وثمانون",
}

DIGITS_PHONETIC_RU: Dict[str, str] = {
    "1": "один", "2": "два", "3": "три", "4": "четыре",
    "5": "пять", "6": "шесть", "7": "семь", "8": "восемь", "9": "девять", "0": "ноль"
}

DIGITS_PHONETIC_EN: Dict[str, str] = {
    "1": "one", "2": "two", "3": "three", "4": "four",
    "5": "five", "6": "six", "7": "seven", "8": "eight", "9": "nine", "0": "zero"
}

DIGITS_PHONETIC_DE: Dict[str, str] = {
    "1": "eins", "2": "zwei", "3": "drei", "4": "vier",
    "5": "fünf", "6": "sechs", "7": "sieben", "8": "acht", "9": "neun", "0": "null"
}

DIGITS_PHONETIC_ES: Dict[str, str] = {
    "1": "uno", "2": "dos", "3": "tres", "4": "cuatro",
    "5": "cinco", "6": "seis", "7": "siete", "8": "ocho", "9": "nueve", "0": "cero"
}

DIGITS_PHONETIC_FR: Dict[str, str] = {
    "1": "un", "2": "deux", "3": "trois", "4": "quatre",
    "5": "cinq", "6": "six", "7": "sept", "8": "huit", "9": "neuf", "0": "zéro"
}

DIGITS_PHONETIC_IT: Dict[str, str] = {
    "1": "uno", "2": "due", "3": "tre", "4": "quattro",
    "5": "cinque", "6": "sei", "7": "sette", "8": "otto", "9": "nove", "0": "zero"
}

DIGITS_PHONETIC_PL: Dict[str, str] = {
    "1": "jeden", "2": "dwa", "3": "trzy", "4": "cztery",
    "5": "pięć", "6": "sześć", "7": "siedem", "8": "osiem", "9": "dziewięć", "0": "zero"
}

DIGITS_PHONETIC_UK: Dict[str, str] = {
    "1": "один", "2": "два", "3": "три", "4": "чотири",
    "5": "п'ять", "6": "шість", "7": "сім", "8": "вісім", "9": "дев'ять", "0": "нуль"
}

TTS_TEST_PHRASES: Dict[str, str] = {
    "ru": "Всем радиолюбителям, семьдесят три! Проверка голосового синтеза ProxDMR.",
    "en": "To all radio amateurs, seventy-three! ProxDMR voice synthesis test.",
    "uk": "Всім радіоаматорам, сімдесят три! Перевірка голосового синтезу ProxDMR.",
    "de": "An alle Funkamateure, dreiundsiebzig! Test der ProxDMR-Sprachausgabe.",
    "fr": "À tous les radioamateurs, soixante-treize ! Test de synthèse vocale ProxDMR.",
    "es": "A todos los radioaficionados, setenta y tres! Prueba de síntesis de voz ProxDMR.",
    "it": "A tutti i radioamatori, settantatré! Test di sintesi vocale ProxDMR.",
    "pl": "Do wszystkich krótkofalowców, 73! Test syntezy mowy ProxDMR.",
    "pt": "A todos os radioamadores, 73! Teste de síntese de voz ProxDMR.",
    "nl": "Aan alle zendamateurs, 73! Test van ProxDMR-spraaksynthese.",
    "tr": "Tüm amatör telsizcilere, 73! ProxDMR ses sentezi testi.",
    "ja": "すべてのアマチュア無線家の皆様、73！ProxDMR音声合成テストです。",
    "zh": "致全体业余无线电爱好者，73！ProxDMR语音合成测试。",
    "ko": "모든 아마추어 무선사 여러분, 73! ProxDMR 음성 합성 테스트입니다.",
    "cs": "Všem radioamatérům, 73! Test hlasové syntézy ProxDMR.",
    "ro": "Către toți radioamatorii, 73! Test de sinteză vocală ProxDMR.",
    "bg": "До всички радиолюбители, 73! Проверка на гласовия синтез ProxDMR.",
    "el": "Προς όλους τους ραδιοερασιτέχνες, 73! Δοκιμή σύνθεσης φωνής ProxDMR.",
    "hu": "Minden rádióamatőrnek, 73! A ProxDMR beszédszintézis tesztje.",
    "sv": "Till alla radioamatörer, 73! Test av ProxDMR-talsyntes.",
    "no": "Til alle radioamatører, 73! Test av ProxDMR-talesyntese.",
    "fi": "Kaikille radioamatööreille, 73! ProxDMR-puhesynteesitesti.",
    "da": "Til alle radioamatører, 73! Test af ProxDMR-talesyntese.",
    "he": "לכל חובבי הרדיו, 73! בדיקת סינתזת דיבור ProxDMR.",
    "ar": "إلى جميع هواة اللاسلكي، 73! اختبار تركيب الصوت ProxDMR.",
}

def get_tts_test_phrase(lang: Optional[str] = "ru") -> str:
    """Returns an authentic radio-amateur test phrase in the specified target language."""
    if not lang or lang == "none":
        lang = "ru"
    code = lang.lower().strip()
    return TTS_TEST_PHRASES.get(code, TTS_TEST_PHRASES.get("en", "To all radio amateurs, 73! ProxDMR voice synthesis test."))

def normalize_signal_reports_for_tts(text: str, target_lang: str = "ru") -> str:
    """
    Normalizes amateur radio signal reports (RS / RST) to single digit pronunciation:
    e.g. 59 -> 'пять-девять', 599 -> 'пять-девять-девять', 59+20 -> 'пять-девять плюс двадцать'.
    Also converts spelled-out words (e.g. 'пятьдесят девять' -> 'пять-девять').
    """
    if not text:
        return ""
    is_ru = target_lang in ("ru", "rus", "none")
    is_en = target_lang in ("en", "eng")
    is_uk = target_lang in ("uk", "ukr")
    is_de = target_lang in ("de", "deu")
    is_es = target_lang in ("es", "esp")
    is_fr = target_lang in ("fr", "fra")
    is_it = target_lang in ("it", "ita")
    is_pl = target_lang in ("pl", "pol")
    if not (is_ru or is_en or is_uk or is_de or is_es or is_fr or is_it or is_pl):
        return text

    # 1. Spelled-out reports in words (if transcribed or translated into words)
    if is_ru:
        ru_spelled = [
            (r"\bпять\s+девяносто\s+девять\b", "пять-девять-девять"),
            (r"\bпять\s+восемьдесят\s+девять\b", "пять-восемь-девять"),
            (r"\bпять\s+семьдесят\s+девять\b", "пять-семь-девять"),
            (r"\bпятьдесят\s+девять\b", "пять-девять"),
            (r"\bпятьдесят\s+восемь\b", "пять-восемь"),
            (r"\bпятьдесят\s+семь\b", "пять-семь"),
            (r"\bпятьдесят\s+шесть\b", "пять-шесть"),
            (r"\bпятьдесят\s+пять\b", "пять-пять"),
            (r"\bпятьдесят\s+четыре\b", "пять-четыре"),
            (r"\bпятьдесят\s+три\b", "пять-три"),
            (r"\bпятьдесят\s+два\b", "пять-два"),
            (r"\bпятьдесят\s+один\b", "пять-один"),
            (r"\bсорок\s+четыре\b", "четыре-четыре"),
            (r"\bтридцать\s+три\b", "три-три"),
        ]
        for pat, repl in ru_spelled:
            text = re.sub(pat, repl, text, flags=re.IGNORECASE)
    elif is_en:
        en_spelled = [
            (r"\bfive\s+ninety\s+nine\b", "five-nine-nine"),
            (r"\bfifty[\s-]nine\b", "five-nine"),
            (r"\bfifty[\s-]eight\b", "five-eight"),
            (r"\bfifty[\s-]seven\b", "five-seven"),
            (r"\bfifty[\s-]six\b", "five-six"),
            (r"\bfifty[\s-]five\b", "five-five"),
        ]
        for pat, repl in en_spelled:
            text = re.sub(pat, repl, text, flags=re.IGNORECASE)

    # 2. Reports with plus decibels (59+20, 59 + 20, 5-9+20, 5/9+20, 59+10db, etc.)
    db_map_ru = {"10": "десять", "20": "двадцать", "30": "тридцать", "40": "сорок", "50": "пятьдесят", "60": "шестьдесят"}
    db_map_fr = {"10": "dix", "20": "vingt", "30": "trente", "40": "quarante", "50": "cinquante", "60": "soixante"}
    db_map_de = {"10": "zehn", "20": "zwanzig", "30": "dreißig", "40": "vierzig", "50": "fünfzig", "60": "sechzig"}
    db_map_es = {"10": "diez", "20": "veinte", "30": "treinta", "40": "cuarenta", "50": "cincuenta", "60": "sesenta"}
    db_map_it = {"10": "dieci", "20": "venti", "30": "trenta", "40": "quaranta", "50": "cinquanta", "60": "sessanta"}
    db_map_uk = {"10": "десять", "20": "двадцять", "30": "тридцять", "40": "сорок", "50": "п'ятдесят", "60": "шістдесят"}
    db_map_pl = {"10": "dziesięć", "20": "dwadzieścia", "30": "trzydzieści", "40": "czterdzieści", "50": "pięćdziesiąt", "60": "sześćdziesiąt"}
    db_map_en = {"10": "ten", "20": "twenty", "30": "thirty", "40": "forty", "50": "fifty", "60": "sixty"}

    def _repl_plus_db(m):
        db = m.group(1)
        if is_ru:
            r_part = "пять-девять"; plus_word = "плюс"; db_word = db_map_ru.get(db, db)
        elif is_fr:
            r_part = "cinq-neuf"; plus_word = "plus"; db_word = db_map_fr.get(db, db)
        elif is_de:
            r_part = "fünf-neun"; plus_word = "plus"; db_word = db_map_de.get(db, db)
        elif is_es:
            r_part = "cinco-nueve"; plus_word = "más"; db_word = db_map_es.get(db, db)
        elif is_it:
            r_part = "cinque-nove"; plus_word = "più"; db_word = db_map_it.get(db, db)
        elif is_uk:
            r_part = "п'ять-дев'ять"; plus_word = "плюс"; db_word = db_map_uk.get(db, db)
        elif is_pl:
            r_part = "pięć-dziewięć"; plus_word = "plus"; db_word = db_map_pl.get(db, db)
        else:
            r_part = "five-nine"; plus_word = "plus"; db_word = db_map_en.get(db, db)
        return f"{r_part} {plus_word} {db_word}"

    text = re.sub(r"\b(?:59|5[-/]9)\s*(?:\+|плюс|plus)\s*(\d{1,2})\s*(?:дб|db)?\b", _repl_plus_db, text, flags=re.IGNORECASE)

    # Plus without number: 59+, 59 +
    if is_ru:
        plus_solo = "пять-девять с плюсом"
    elif is_fr:
        plus_solo = "cinq-neuf plus"
    elif is_de:
        plus_solo = "fünf-neun plus"
    elif is_es:
        plus_solo = "cinco-nueve más"
    elif is_it:
        plus_solo = "cinque-nove più"
    elif is_uk:
        plus_solo = "п'ять-дев'ять з плюсом"
    elif is_pl:
        plus_solo = "pięć-dziewięć z plusem"
    else:
        plus_solo = "five-nine plus"
    text = re.sub(r"\b(?:59|5[-/]9)\s*\+", plus_solo, text, flags=re.IGNORECASE)

    # 3. Contextual spaced reports e.g. 'рапорт 5 9', 'оценка 5 9 9'
    if is_ru:
        digits_map = DIGITS_PHONETIC_RU
    elif is_uk:
        digits_map = DIGITS_PHONETIC_UK
    elif is_de:
        digits_map = DIGITS_PHONETIC_DE
    elif is_es:
        digits_map = DIGITS_PHONETIC_ES
    elif is_fr:
        digits_map = DIGITS_PHONETIC_FR
    elif is_it:
        digits_map = DIGITS_PHONETIC_IT
    elif is_pl:
        digits_map = DIGITS_PHONETIC_PL
    else:
        digits_map = DIGITS_PHONETIC_EN

    def _repl_spaced(m):
        prefix = m.group(1)
        d1 = digits_map.get(m.group(2), m.group(2))
        d2 = digits_map.get(m.group(3), m.group(3))
        d3 = digits_map.get(m.group(4)) if m.group(4) else None
        if d3:
            return f"{prefix} {d1}-{d2}-{d3}"
        return f"{prefix} {d1}-{d2}"

    text = re.sub(r"\b(рапорт|сигнал|оценка|прием|слышу|слышимость|rst|rs|report)\s+([1-5])\s+([1-9])(?:\s+([1-9]))?\b", _repl_spaced, text, flags=re.IGNORECASE)

    # 4. Formats with separators: 5-9-9, 5/9/9, 5-9, 5/9, 5-8, 5/8
    def _repl_sep3(m):
        d1 = digits_map.get(m.group(1), m.group(1))
        d2 = digits_map.get(m.group(2), m.group(2))
        d3 = digits_map.get(m.group(3), m.group(3))
        return f"{d1}-{d2}-{d3}"

    text = re.sub(r"\b([1-5])[-/]([1-9])[-/]([1-9])\b", _repl_sep3, text)

    def _repl_sep2(m):
        d1 = digits_map.get(m.group(1), m.group(1))
        d2 = digits_map.get(m.group(2), m.group(2))
        return f"{d1}-{d2}"

    text = re.sub(r"\b([1-5])[-/]([1-9])\b", _repl_sep2, text)

    # 5. Standard 3-digit RST reports: 599, 589, 579, 569, 559, 549, 539, 529, 519, 449, 339
    rst_reports = [
        "599", "589", "579", "569", "559", "549", "539", "529", "519",
        "449", "339"
    ]
    for r in rst_reports:
        d1 = digits_map.get(r[0], r[0])
        d2 = digits_map.get(r[1], r[1])
        d3 = digits_map.get(r[2], r[2])
        text = re.sub(rf"\b{r}\b", f"{d1}-{d2}-{d3}", text)

    # 6. Standard 2-digit RS reports: 59, 58, 57, 56, 55, 54, 53, 52, 51, 44, 33
    rs_reports = [
        "59", "58", "57", "56", "55", "54", "53", "52", "51",
        "44", "33"
    ]
    for r in rs_reports:
        d1 = digits_map.get(r[0], r[0])
        d2 = digits_map.get(r[1], r[1])
        text = re.sub(rf"\b{r}\b", f"{d1}-{d2}", text)

    return text

def prepare_text_for_tts(text: str, target_lang: str = "ru", callsign: str = "") -> str:
    """
    Prepares text for TTS speech synthesis:
    1. Removes all callsign tags <call>...</call>, explicit callsign and auto-detected callsigns completely.
    2. Normalizes signal reports (RS / RST) to single digit pronunciation (59 -> пять-девять, 599 -> пять-девять-девять).
    3. Normalizes amateur radio 73 / 88 numbers to spoken words strictly in the TARGET language.
    4. Phoneticizes radio jargon (Q-codes, CQ, Roger) according to target language pronunciation.
    5. Cleans up extra whitespace and punctuation.
    """
    if not text:
        return ""
    # Strip callsigns and their tags (e.g. "<call>KD9CRD</call>", explicit callsign, or CALLSIGN_REGEX)
    clean = strip_callsigns_for_tts(text, callsign=callsign)
    # Normalize signal reports to single digit pronunciation
    clean = normalize_signal_reports_for_tts(clean, target_lang=target_lang)

    # Determine 2-letter lang code
    l_code = (target_lang or "ru").lower().strip()
    if l_code in ("none", "auto", ""):
        l_code = "ru"
    elif len(l_code) > 2:
        l_code = l_code[:2]

    # Universal 73 / 88 normalization for target language (no English "seventy-three" or "севенти фри"!)
    w_73 = HAM_73_PHONETIC_BY_LANG.get(l_code, "семьдесят три" if l_code == "ru" else "73")
    w_88 = HAM_88_PHONETIC_BY_LANG.get(l_code, "восемьдесят восемь" if l_code == "ru" else "88")

    clean = re.sub(r"\b73['’]?s?\b", w_73, clean, flags=re.IGNORECASE)
    clean = re.sub(r"\bseventy[- ]three\b", w_73, clean, flags=re.IGNORECASE)
    clean = re.sub(r"\b88['’]?s?\b", w_88, clean, flags=re.IGNORECASE)
    clean = re.sub(r"\beighty[- ]eight\b", w_88, clean, flags=re.IGNORECASE)

    # Phoneticize radio jargon for pronunciation
    if target_lang in ("ru", "rus", "none"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_RU.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("en", "eng"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_EN.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("uk", "ukr"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_UK.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("de", "deu"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_DE.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("es", "esp"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_ES.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("fr", "fra"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_FR.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("it", "ita"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_IT.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    elif target_lang in ("pl", "pol"):
        for pattern, replacement in RADIO_JARGON_PHONETIC_PL.items():
            clean = re.sub(pattern, replacement, clean, flags=re.IGNORECASE)
    # Clean formatting and leading/trailing punctuation
    clean = re.sub(r"\s+", " ", clean).strip()
    clean = re.sub(r"\s+([,.:;!?])", r"\1", clean)
    clean = re.sub(r"^[,.:;!?\s]+", "", clean).strip()
    return clean

TTS_STYLE_CONFIG: Dict[str, Dict[str, Any]] = {
    "radio": {
        "prefix": "Say in a calm, flat, neutral, monotone radio operator tone: ",
        "temperature": 0.1,
    },
    "monotone": {
        "prefix": "Say in a strictly flat, monotone, unemotional voice without intonation: ",
        "temperature": 0.0,
    },
    "clear": {
        "prefix": "Say in a clear, professional, neutral broadcaster tone: ",
        "temperature": 0.2,
    },
    "natural": {
        "prefix": "",
        "temperature": 0.7,
    },
}

def resolve_tts_voice(requested_voice: str, gender: str = "male", pitch: str = "medium") -> str:
    """
    Selects prebuilt Gemini TTS voice:
    - If requested_voice is specified and not 'auto', returns it.
    - If 'auto', resolves based on detected operator gender and pitch:
      * female: high -> Aoede, low -> Despina, otherwise -> Kore
      * male/other: low -> Charon, high -> Fenrir, otherwise -> Puck
    """
    if requested_voice and requested_voice.lower() != "auto":
        return requested_voice

    g = (gender or "male").lower().strip()
    p = (pitch or "medium").lower().strip()

    if g == "female":
        if p == "high":
            return "Aoede"
        elif p == "low":
            return "Despina"
        return "Kore"
    else:
        if p == "low":
            return "Charon"
        elif p == "high":
            return "Fenrir"
        return "Puck"

def clean_callsign_word(call: str) -> str:
    """Replaces trailing phonetic word with its letter, e.g. KD9CHARLIE -> KD9C."""
    for word, letter in sorted(PHONETIC_LETTERS_MAP.items(), key=lambda x: -len(x[0])):
        if call.endswith(word) and len(call) > len(word):
            call = call[:-len(word)] + letter
            break
    return call

def clean_transcription_text(text: str) -> str:
    """
    Cleans up transcription output:
    1. Fixes <call> tags ending with phonetic words (e.g. <call>KD9CHARLIE</call> -> <call>KD9C</call>).
    2. Converts untagged callsigns ending with phonetic words.
    3. Recognizes phonetic sequences (e.g. 'Чарли Радио Дельта' or 'Charlie Radio Delta' -> 'CRD').
    4. Merges prefix callsign with phonetic suffix (e.g. KD9C, CRD -> KD9CRD; KD9CRD, CRD -> KD9CRD).
    5. Deduplicates repeated callsigns.
    """
    if not text:
        return ""

    # 1. Clean <call> tag contents ending with phonetic word (e.g. <call>KD9CHARLIE</call> -> <call>KD9C</call>)
    def fix_call_tag(m):
        c = m.group(1).strip()
        return f"<call>{clean_callsign_word(c.upper())}</call>"

    text = re.sub(r"<call>([^<]+)</call>", fix_call_tag, text, flags=re.IGNORECASE)

    # 2. Check untagged callsigns ending with phonetic word (e.g. KD9CHARLIE -> KD9C)
    for word, letter in sorted(PHONETIC_LETTERS_MAP.items(), key=lambda x: -len(x[0])):
        pattern = r"\b([A-Za-z]{1,2}\d[A-Za-z0-9]*)" + re.escape(word) + r"\b"
        text = re.sub(pattern, r"\1" + letter, text, flags=re.IGNORECASE)

    # 3. Detect sequences of 2+ phonetic words (e.g. 'Чарли Радио Дельта' or 'Charlie Radio Delta')
    sorted_words = sorted(PHONETIC_LETTERS_MAP.keys(), key=lambda x: -len(x))
    word_pattern = "|".join(re.escape(w) for w in sorted_words)
    phonetic_seq_regex = re.compile(
        r"\b(?:" + word_pattern + r")(?:\s*[,–-]?\s*(?:" + word_pattern + r"))+\b",
        re.IGNORECASE
    )

    def replace_phonetic_seq(match):
        seq = match.group(0)
        parts = re.split(r"[\s,–-]+", seq)
        letters = [PHONETIC_LETTERS_MAP[p.upper()] for p in parts if p.upper() in PHONETIC_LETTERS_MAP]
        return "".join(letters)

    text = phonetic_seq_regex.sub(replace_phonetic_seq, text)

    # 4. Merge callsign with suffix letters (e.g. KD9C, CRD -> KD9CRD; KD9CRD, CRD -> KD9CRD)
    def merge_call_and_letters(m):
        call = m.group(1).upper()
        letters = m.group(2).upper()
        if call.endswith(letters):
            return f"<call>{call}</call>"
        if len(letters) >= 2:
            if call.endswith(letters[0]):
                return f"<call>{call[:-1]}{letters}</call>"
            elif re.search(r"\d$", call):
                return f"<call>{call}{letters}</call>"
        return f"<call>{call}</call>, {letters}"

    # <call>TAG</call> followed by comma/dash/spaces and 2-4 uppercase letters
    text = re.sub(
        r"<call>([A-Za-z0-9]+)</call>\s*[,–-]\s*([A-Za-z]{2,4})\b",
        merge_call_and_letters,
        text
    )

    # Untagged call followed by comma/dash/spaces and 2-4 uppercase letters
    text = re.sub(
        r"\b([A-Za-z]{1,2}\d[A-Za-z0-9]*)\s*[,–-]\s*([A-Za-z]{2,4})\b",
        merge_call_and_letters,
        text
    )

    # 5. Remove redundant repetition: <call>KD9CRD</call>, KD9CRD or <call>KD9CRD</call>, <call>KD9CRD</call>
    text = re.sub(r"<call>([A-Za-z0-9]+)</call>\s*[,–-]?\s*(?:<call>)?\1(?:</call>)?", r"<call>\1</call>", text)

    # 6. Ensure no nested <call> tags
    while "<call><call>" in text or "</call></call>" in text:
        text = text.replace("<call><call>", "<call>").replace("</call></call>", "</call>")

    # 7. Strip standalone hesitation sounds ("э", "э-э", etc.)
    text = filter_hesitation_fillers(text)

    return text.strip()


class SlotAudioBuffer:
    def __init__(self, hid: str, slot: int):
        self.hid = hid
        self.slot = slot
        self.pcm = bytearray()
        self.src_id: int = 0
        self.callsign: str = ""
        self.call_id: str = ""
        self.last_speech_time: float = 0.0
        self.silence_frames: int = 0
        self.speech_frames: int = 0
        self.chunk_seq: int = 0
        self.active: bool = False

    def reset(self):
        self.pcm.clear()
        self.src_id = 0
        self.callsign = ""
        self.call_id = ""
        self.last_speech_time = 0.0
        self.silence_frames = 0
        self.speech_frames = 0
        self.chunk_seq = 0
        self.active = False

    def feed_frame(self, pcm_bytes: bytes, src_id: int, callsign: str, call_id: str = "") -> Optional[bytes]:
        """
        Feeds 16-bit 8000 Hz PCM (e.g. 960 bytes = 60 ms).
        Returns wav bytes if a chunk is ready to dispatch, else None.
        """
        if not self.active:
            self.reset()
            self.active = True
            self.src_id = src_id
            self.callsign = callsign
            self.call_id = call_id

        if src_id and not self.src_id:
            self.src_id = src_id
        if callsign and not self.callsign:
            self.callsign = callsign
        if call_id and not self.call_id:
            self.call_id = call_id

        self.pcm.extend(pcm_bytes)

        # Calculate RMS energy for speech activity detection
        num_samples = len(pcm_bytes) // 2
        if num_samples > 0:
            if np is not None:
                arr = np.frombuffer(pcm_bytes, dtype=np.int16).astype(np.float32)
                rms = float(np.sqrt(np.mean(arr * arr)))
            else:
                shorts = struct.unpack(f"<{num_samples}h", pcm_bytes)
                sum_sq = sum(s * s for s in shorts)
                rms = math.sqrt(sum_sq / num_samples)
        else:
            rms = 0.0

        # Silence vs speech threshold
        if rms > 350.0:
            self.speech_frames += 1
            self.silence_frames = 0
            self.last_speech_time = time.time()
        else:
            self.silence_frames += 1

        duration_sec = len(self.pcm) / (8000.0 * 2.0)

        # Trigger conditions:
        # 1. Intra-phrase pause: >= 3.0s total audio, >= 0.7s silence (silence_frames * 0.06 >= 0.72)
        # 2. Hard limit: >= 12.0s audio to keep latency low and fit chunks
        should_chunk = False
        if duration_sec >= 3.0 and (self.silence_frames * 0.06 >= 0.72) and (self.speech_frames >= 10):
            should_chunk = True
        elif duration_sec >= 12.0 and (self.speech_frames >= 10):
            should_chunk = True

        if should_chunk:
            return self.extract_pcm()

        return None

    def extract_pcm(self) -> bytes:
        chunk = bytes(self.pcm)
        self.pcm.clear()
        self.silence_frames = 0
        self.speech_frames = 0
        self.chunk_seq += 1
        return chunk

    def finalize(self) -> Optional[bytes]:
        """Called when transmission ends (PTT released / slot timeout)."""
        duration_sec = len(self.pcm) / (8000.0 * 2.0)
        # Only dispatch if >= 0.9s of audio and had some speech
        if duration_sec >= 0.9 and (self.speech_frames >= 5 or len(self.pcm) >= 16000):
            chunk = bytes(self.pcm)
            self.reset()
            return chunk
        self.reset()
        return None


class GeminiTranscriberService:
    def __init__(self, broadcast_fn: Optional[Callable[[Dict[str, Any]], Any]] = None):
        self.broadcast_fn = broadcast_fn
        self.enabled: bool = False
        self.api_key: str = ""
        self.api_keys: List[str] = []
        self._key_index: int = 0
        self.model: str = "gemini-3.1-flash-lite"
        self.target_lang: str = "ru"

        # TTS configuration
        self.tts_enabled: bool = False
        self.tts_engine: str = "gemini"
        self.tts_model: str = "gemini-3.1-flash-tts-preview"
        self.tts_voice: str = "auto"
        self.tts_speed: float = 1.1
        self.tts_ducking_level: float = 0.80
        self.tts_pause_ducking_level: float = 1.0
        self.tts_mute_others: bool = True
        self.tts_announce_callsign: bool = False
        self.tts_style: str = "radio"
        self._announced_call_ids: OrderedDict = OrderedDict()
        self._tts_enabled_slots: set = set()

        # Rate limiter (sliding window, max 15 requests in 60 seconds)
        self._request_timestamps: List[float] = []
        self._rate_limit_lock = asyncio.Lock()

        # Audio buffers per (hid, slot)
        self._buffers: Dict[str, SlotAudioBuffer] = {}
        # Set of active (hid, slot) keys that have transcription turned ON
        self._enabled_slots: set = set()

    def configure(
        self,
        enabled: bool,
        api_key: str,
        model: str,
        target_lang: str,
        api_keys: Optional[List[str]] = None,
        tts_enabled: bool = False,
        tts_engine: str = "gemini",
        tts_model: str = "gemini-3.1-flash-tts-preview",
        tts_voice: str = "auto",
        tts_speed: float = 1.1,
        tts_ducking_level: float = 0.80,
        tts_pause_ducking_level: float = 1.0,
        tts_mute_others: bool = True,
        tts_announce_callsign: bool = False,
        tts_style: str = "radio"
    ):
        clean_key = (api_key or "").strip()
        cleaned_keys = [k.strip() for k in (api_keys or []) if k and k.strip()]
        if clean_key and clean_key not in cleaned_keys:
            cleaned_keys.insert(0, clean_key)
        self.api_keys = cleaned_keys
        self.api_key = clean_key or (self.api_keys[0] if self.api_keys else "")
        self.enabled = bool(enabled and (self.api_key or self.api_keys))

        m = model.strip() if model and model.strip() else "gemini-3.1-flash-lite"
        if any(dep in m.lower() for dep in ["gemini-2.5-", "gemini-2.0-", "gemini-1.5-"]):
            m = "gemini-3.1-flash-lite"
        self.model = m
        self.target_lang = target_lang.strip() if target_lang and target_lang.strip() else "ru"
        self.tts_enabled = bool(tts_enabled)
        self.tts_engine = tts_engine or "gemini"
        self.tts_model = tts_model or "gemini-3.1-flash-tts-preview"
        self.tts_voice = tts_voice or "auto"
        self.tts_speed = float(tts_speed or 1.1)
        self.tts_ducking_level = float(tts_ducking_level if tts_ducking_level is not None else 0.80)
        self.tts_pause_ducking_level = float(tts_pause_ducking_level if tts_pause_ducking_level is not None else 1.0)
        self.tts_mute_others = bool(tts_mute_others)
        self.tts_announce_callsign = bool(tts_announce_callsign)
        self.tts_style = (tts_style or "radio").lower().strip()

        if self.tts_engine == "piper":
            try:
                from piper_service import PiperService
                psrv = PiperService.get_instance()
                eff_l = (self.target_lang or "ru").lower().strip()
                if eff_l != "none":
                    v_lang = psrv.get_voice_lang(self.tts_voice)
                    if not self.tts_voice or self.tts_voice in ("auto", "Puck", "Charon", "Kore", "Fenrir", "Aoede", "Leda", "Zephyr", "Despina", "Achernar", "Orus", "Iapetus") or v_lang != eff_l:
                        new_v = psrv.get_installed_voice_for_lang(eff_l) or psrv.get_default_voice_for_lang(eff_l)
                        if new_v:
                            self.tts_voice = new_v
                    if self.tts_voice and psrv.is_voice_installed(self.tts_voice):
                        try:
                            loop = asyncio.get_running_loop()
                            loop.create_task(psrv.preload_voice_async(self.tts_voice))
                        except RuntimeError:
                            pass
            except Exception as e:
                logger.debug(f"[TRANSCRIBER] Piper configure voice check error: {e}")

        logger.info(
            f"[TRANSCRIBER] Configured: enabled={self.enabled}, model={self.model}, "
            f"target_lang={self.target_lang}, keys={len(self.api_keys)}, "
            f"tts={self.tts_enabled}/{self.tts_engine}/{self.tts_model}"
        )

    def is_enabled(self) -> bool:
        return self.enabled and bool(self.api_key or self.api_keys)

    def get_all_keys(self) -> List[str]:
        if self.api_keys:
            return list(self.api_keys)
        return [self.api_key] if self.api_key else []

    def _get_next_key(self) -> str:
        keys = self.get_all_keys()
        if not keys:
            return ""
        key = keys[self._key_index % len(keys)]
        self._key_index = (self._key_index + 1) % len(keys)
        return key

    def set_slot_enabled(self, hid: str, slot: int, enabled: bool):
        key = f"{hid}_{slot}"
        if enabled:
            self._enabled_slots.add(key)
        else:
            self._enabled_slots.discard(key)
            self._tts_enabled_slots.discard(key)
            if key in self._buffers:
                self._buffers[key].reset()
        logger.info(f"[TRANSCRIBER] Slot {key} enabled={enabled} (total active: {len(self._enabled_slots)})")

    def set_slot_tts_enabled(self, hid: str, slot: int, enabled: bool):
        key = f"{hid}_{slot}"
        if enabled:
            self._tts_enabled_slots.add(key)
            # Auto-enable transcription if TTS is turned on
            self.set_slot_enabled(hid, slot, True)
        else:
            self._tts_enabled_slots.discard(key)
        logger.info(f"[TRANSCRIBER] Slot {key} TTS enabled={enabled} (total active: {len(self._tts_enabled_slots)})")

    def is_slot_tts_enabled(self, hid: str, slot: int) -> bool:
        if not self.is_enabled():
            return False
        return f"{hid}_{slot}" in self._tts_enabled_slots

    def disable_all_slots(self):
        """Disables speech recognition and TTS on all slots across all hotspots and clears audio buffers."""
        prev_count = len(self._enabled_slots)
        self._enabled_slots.clear()
        self._tts_enabled_slots.clear()
        for buf in list(self._buffers.values()):
            try:
                buf.reset()
            except Exception:
                pass
        self._buffers.clear()
        logger.info(f"[TRANSCRIBER] All slots disabled ({prev_count} previously active) and audio buffers cleared")

    def disable_hotspot(self, hid: str):
        """Disables speech recognition for all slots on a specific hotspot and clears its audio buffers."""
        self.set_slot_enabled(hid, 1, False)
        self.set_slot_enabled(hid, 2, False)
        self.set_slot_tts_enabled(hid, 1, False)
        self.set_slot_tts_enabled(hid, 2, False)
        for slot in (1, 2):
            key = f"{hid}_{slot}"
            if key in self._buffers:
                try:
                    self._buffers[key].reset()
                except Exception:
                    pass
                self._buffers.pop(key, None)
        logger.info(f"[TRANSCRIBER] Disabled all transcribe/TTS slots for hotspot '{hid}'")

    def is_slot_enabled(self, hid: str, slot: int) -> bool:
        if not self.is_enabled():
            return False
        return f"{hid}_{slot}" in self._enabled_slots

    def _get_buffer(self, hid: str, slot: int) -> SlotAudioBuffer:
        key = f"{hid}_{slot}"
        if key not in self._buffers:
            self._buffers[key] = SlotAudioBuffer(hid, slot)
        return self._buffers[key]

    def feed_audio(self, hid: str, slot: int, src_id: int, callsign: str, pcm_bytes: bytes, call_id: str = ""):
        if not self.is_slot_enabled(hid, slot):
            return

        buf = self._get_buffer(hid, slot)
        chunk_pcm = buf.feed_frame(pcm_bytes, src_id, callsign, call_id=call_id)
        if chunk_pcm:
            asyncio.create_task(
                self._process_chunk(hid, slot, buf.src_id, buf.callsign, chunk_pcm, is_final=False, call_id=buf.call_id)
            )

    def on_call_ended(self, hid: str, slot: int, call_id: str = ""):
        if not self.is_slot_enabled(hid, slot):
            return

        buf = self._get_buffer(hid, slot)
        src_id = buf.src_id
        callsign = buf.callsign
        cid = call_id or buf.call_id
        final_pcm = buf.finalize()
        if final_pcm:
            asyncio.create_task(
                self._process_chunk(hid, slot, src_id, callsign, final_pcm, is_final=True, call_id=cid)
            )

    def _pcm_to_wav(self, pcm_bytes: bytes, sample_rate: int = 8000) -> bytes:
        bio = io.BytesIO()
        with wave.open(bio, "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(sample_rate)
            wav.writeframes(pcm_bytes)
        return bio.getvalue()

    async def _check_rate_limit(self) -> bool:
        async with self._rate_limit_lock:
            now = time.time()
            self._request_timestamps = [t for t in self._request_timestamps if now - t < 60.0]
            if len(self._request_timestamps) >= 15:
                logger.warning(
                    f"[TRANSCRIBER] Rate limit reached: {len(self._request_timestamps)} reqs in last 60s. Skipping."
                )
                return False
            self._request_timestamps.append(now)
            return True

    def _build_stage1_asr_instruction(self) -> str:
        return (
            "You are a professional, highly disciplined speech-to-text transcriber specializing in amateur radio communications (DMR / Ham Radio).\n"
            "Your task is to listen to the amateur radio operator's voice transmission and return an accurate, verbatim transcription IN THE ORIGINAL LANGUAGE SPOKEN without translation.\n\n"
            "VOICE CHARACTERISTICS DETECTION:\n"
            "- Determine the speaker's biological voice gender: 'male' or 'female'. If uncertain, use 'male'.\n"
            "- Determine the speaker's vocal pitch/timbre: 'low', 'medium', or 'high'. If uncertain, use 'medium'.\n\n"
            "TRANSCRIPTION COMPLETENESS:\n"
            "- Transcribe every intelligible word accurately in the original spoken language without omission or translation.\n\n"
            "PRIMARY RULE: CALLSIGN RECOGNITION, SUFFIX REPETITION AND ASSEMBLY\n"
            "In radio communications, operators state their callsigns and frequently repeat the suffix letters using NATO/ITU phonetic words "
            "(e.g. 'KD9CRD, Charlie Radio Delta', or 'KD9C, Charlie Radio Delta', or 'Kilo Delta Nine Charlie Radio Delta').\n"
            "- CRITICAL: Callsigns consist of 1-2 prefix letters, 1 digit, and 1-3 suffix letters (e.g. KD9CRD).\n"
            "- Phonetic words (Charlie, Radio, Delta, etc.) represent INDIVIDUAL LETTERS ('C', 'R', 'D'). They are NEVER full words in a callsign (NEVER write '<call>KD9CHARLIE</call>').\n"
            "- Phonetic words used to spell or confirm letters MUST NEVER BE TRANSLATED into Russian or other languages (NEVER write 'Чарли Радио Дельта')!\n"
            "- Redundant phonetic repetition of the callsign suffix ('Charlie Radio Delta' right after 'KD9CRD' or 'KD9C') MUST BE ASSEMBLED directly into the callsign: '<call>KD9CRD</call>'. Do NOT repeat the letters or phonetic words in the text.\n"
            "- WHENEVER YOU HEAR A SEQUENCE OF PHONETIC WORDS AND DIGITS, IT IS A RADIO CALLSIGN!\n"
            "  Always assemble sequences of phonetic letter words and digits into a single standard callsign in UPPERCASE LATIN LETTERS "
            "and wrap it in the <call>CALLSIGN</call> tag (e.g. <call>RF5LI</call>, <call>KD9CRD</call>).\n\n"
            "PHONETIC WORDS DICTIONARY FOR CALLSIGN LETTERS (NATO, Romance, DX):\n"
            "A: Alpha, Alfa, America; B: Bravo, Boston; C: Charlie, Canada; D: Delta, Denmark; E: Echo, England; "
            "F: Foxtrot, Fox; G: Golf, Germany; H: Hotel, Honolulu; I: India, Italy; J: Juliett, Juliet, Japan; "
            "K: Kilo, Kilowatt; L: Lima, London; M: Mike, Mexico; N: November, Norway; O: Oscar, Ontario; "
            "P: Papa, Pacific; Q: Quebec; R: Radio, Romeo; S: Sierra, Sugar; T: Tango, Texas; U: Uniform, United; "
            "V: Victor, Victoria; W: Whiskey, Washington; X: X-ray; Y: Yankee; Z: Zulu, Zanzibar.\n\n"
            "ADDITIONAL REQUIREMENTS:\n"
            "1. Always format callsigns in UPPERCASE LATIN LETTERS wrapped in <call>CALLSIGN</call>.\n"
            "2. Preserve amateur radio jargon, Q-codes (73, QTH, QSO, QSL, Roger) and RST signal reports (59, 599, 58, 57, 59+20, etc.) without alteration. Keep signal reports as digits, NEVER write them out in words.\n"
            "3. Ignore radio static, noise bursts, clicks, and filler sounds. If no intelligible speech is detected, return an empty text field.\n"
            "4. Response MUST strictly be in valid JSON format:\n"
            '{"lang": "3-letter uppercase ISO language code of original speech (e.g. RUS, ENG, SPA, FRA, DEU, UKR, etc.)", "gender": "male or female", "pitch": "low, medium, or high", "text": "verbatim transcription in original spoken language with callsigns in <call>...</call>"}'
        )

    def _build_stage2_translation_instruction(self, source_lang_en: str, target_lang_en: str) -> str:
        return (
            f"You are a professional, highly disciplined real-time translator specializing in amateur radio communications (DMR / Ham Radio).\n"
            f"Your task is to translate the amateur radio transmission from {source_lang_en.upper()} into {target_lang_en.upper()}.\n\n"
            f"CRITICAL REQUIREMENT: COMPLETE 100% TRANSLATION — ZERO CODE-SWITCHING / NO MIXED LANGUAGES\n"
            f"- Every single word, sentence, and clause MUST be fully translated into {target_lang_en}.\n"
            f"- It is STRICTLY FORBIDDEN to leave words, fragments, or phrases in the source language.\n"
            f"- Do NOT translate or output filler hesitation sounds like 'uh', 'um', 'er', 'ah', 'uh-huh' into 'э' or 'э-э'. Completely omit standalone filler hesitation sounds.\n"
            f"- The ONLY elements permitted in Latin characters in the output are:\n"
            f"  1) Radio callsigns wrapped in <call>...</call> (e.g. <call>K9CJD</call>, <call>KR4ELD</call>). KEEP CALLSIGNS UNCHANGED.\n"
            f"  2) Standard international radio Q-codes (QTH, QSO, QSL, 73, CQ, Roger) and RST reports (59, 599, 58, 59+20, etc.).\n"
            f"- Signal reports (59, 599, etc.) MUST ALWAYS be preserved as digits, NEVER translated or spelled out in words (do NOT write 'пятьдесят девять' or 'fifty-nine')!\n"
            f"- ALL OTHER TEXT MUST BE 100% IN {target_lang_en.upper()}.\n\n"
            f"- Response MUST strictly be in valid JSON format:\n"
            f'{{"text": "fully translated text in {target_lang_en} with callsigns in <call>...</call>"}}'
        )

    def _http_post_json_with_retry(
        self, endpoint: str, payload: Dict[str, Any]
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        keys = self.get_all_keys()
        if not keys:
            return None, "Не указан API ключ Gemini"

        attempts = min(len(keys), 5)
        last_err = None
        for _ in range(attempts):
            key = self._get_next_key()
            url = f"https://generativelanguage.googleapis.com/v1beta/{endpoint}?key={key}"
            result_json, err = self._http_post_json(url, payload)
            if not err and result_json:
                return result_json, None
            last_err = err
            if err and any(term in str(err).lower() for term in ["429", "quota", "resource_exhausted", "limit"]):
                logger.warning(f"[TRANSCRIBER] Gemini key ...{key[-6:] if len(key)>6 else key} rate limit ({err}). Switching key...")
                continue
            else:
                break
        return None, last_err

    async def synthesize_speech(
        self,
        text: str,
        model: Optional[str] = None,
        voice: Optional[str] = None,
        api_key: Optional[str] = None,
        gender: str = "male",
        pitch: str = "medium",
        target_lang: Optional[str] = None,
        engine: Optional[str] = None,
        speed: Optional[float] = None,
        callsign: str = "",
        announce_callsign: bool = False,
        style: Optional[str] = None
    ) -> Tuple[Optional[bytes], Optional[str]]:
        """
        Synthesizes text to speech using Piper TTS or Gemini TTS model.
        Returns (wav_bytes, error_message).
        """
        effective_lang = (target_lang or self.target_lang or "ru").lower().strip()
        if effective_lang == "none":
            effective_lang = "ru"

        if (engine == "piper") or (self.tts_engine == "piper" and engine != "gemini"):
            from piper_service import PiperService
            from callsign_phonetic import get_callsign_announcement, concatenate_wavs

            piper_srv = PiperService.get_instance()
            if voice and voice != "auto":
                v_lang = piper_srv.get_voice_lang(voice)
                if v_lang and v_lang != effective_lang and piper_srv.is_voice_installed(voice):
                    effective_lang = v_lang

            ready, voice_id, reason = piper_srv.is_voice_ready_for_lang(effective_lang, voice)
            if not ready or not voice_id:
                logger.warning(f"[TRANSCRIBER] Piper TTS not ready for language '{effective_lang}': {reason}")
                return None, f"Модель речи для языка '{effective_lang.upper()}' не готова ({reason})"

            call_announcement_wav = None
            if announce_callsign and callsign:
                call_phrase = get_callsign_announcement(callsign, lang=effective_lang, engine="piper")
                if call_phrase:
                    c_wav, _, _ = await piper_srv.synthesize_async(
                        text=call_phrase,
                        voice_id=voice_id,
                        speed=0.9,
                        noise_scale=0.7,
                        noise_w=0.8
                    )
                    if c_wav:
                        call_announcement_wav = c_wav

            speech_text = strip_callsigns_for_tts(text, callsign=callsign)
            if effective_lang == "ru":
                speech_text = normalize_for_russian_tts(speech_text, strip_callsigns=True, callsign=callsign)

            try:
                from tts_normalizer import filter_piper_text_by_language
                speech_text = filter_piper_text_by_language(speech_text, target_lang=effective_lang)
            except Exception as e:
                logger.warning(f"[TRANSCRIBER] Failed to filter foreign text for Piper: {e}")

            if not speech_text or not speech_text.strip():
                if call_announcement_wav:
                    return call_announcement_wav, None
                return None, "Пустой текст для озвучки (отфильтрован как чужеродный язык)"

            wav_bytes, sample_rate, err = await piper_srv.synthesize_async(
                text=speech_text,
                voice_id=voice_id,
                speed=speed or self.tts_speed,
                noise_scale=0.7,
                noise_w=0.8
            )
            if call_announcement_wav and wav_bytes:
                comb, _ = concatenate_wavs([call_announcement_wav, wav_bytes], pause_ms=200)
                return comb or wav_bytes, err
            return wav_bytes or call_announcement_wav, err

        from callsign_phonetic import get_callsign_announcement
        eff_engine = (engine or self.tts_engine or "gemini").lower().strip()
        call_phrase = get_callsign_announcement(callsign, lang=effective_lang, engine=eff_engine) if (announce_callsign and callsign) else ""
        clean_text = prepare_text_for_tts(text, effective_lang, callsign=callsign)
        if call_phrase:
            clean_text = f"{call_phrase} {clean_text}".strip() if clean_text else call_phrase
        if not clean_text or not clean_text.strip():
            return None, "Пустой текст для озвучки"

        eff_style = (style or self.tts_style or "radio").lower().strip()
        style_cfg = TTS_STYLE_CONFIG.get(eff_style, TTS_STYLE_CONFIG["radio"])
        style_prefix = style_cfg["prefix"]
        style_temp = style_cfg["temperature"]
        prompt_text = f"{style_prefix}{clean_text}" if style_prefix else clean_text

        tts_model = model or self.tts_model or "gemini-3.1-flash-tts-preview"
        if tts_model.startswith("models/"):
            tts_model = tts_model[len("models/"):]
        raw_voice = voice or self.tts_voice or "auto"
        tts_voice = resolve_tts_voice(raw_voice, gender=gender, pitch=pitch)

        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt_text
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseModalities": ["AUDIO"],
                "temperature": style_temp,
                "speechConfig": {
                    "voiceConfig": {
                        "prebuiltVoiceConfig": {
                            "voiceName": tts_voice
                        }
                    }
                }
            }
        }

        endpoint = f"models/{tts_model}:generateContent"
        if api_key and api_key.strip():
            url = f"https://generativelanguage.googleapis.com/v1beta/{endpoint}?key={api_key.strip()}"
            result_json, err = await asyncio.to_thread(self._http_post_json, url, payload)
        else:
            result_json, err = await asyncio.to_thread(
                self._http_post_json_with_retry, endpoint, payload
            )
        if err or not result_json:
            return None, err or "Пустой ответ Gemini TTS"

        candidates = result_json.get("candidates", [])
        if not candidates:
            return None, "Нет кандидатов в ответе TTS"

        parts = candidates[0].get("content", {}).get("parts", [])
        if not parts:
            return None, "Нет данных аудио в кандидате TTS"

        inline_data = parts[0].get("inlineData", {})
        b64_audio = inline_data.get("data", "")
        if not b64_audio:
            return None, "Пустые аудиоданные TTS"

        try:
            pcm_bytes = base64.b64decode(b64_audio)
            wav_bytes = self._pcm_to_wav(pcm_bytes, sample_rate=24000)
            return wav_bytes, None
        except Exception as e:
            return None, f"Ошибка декодирования аудио TTS: {e}"

    async def _notify_error(self, hid: str, slot: int, error_text: str):
        if self.broadcast_fn:
            try:
                await self.broadcast_fn({
                    "type": "transcription_error",
                    "hotspot_id": hid,
                    "slot": slot,
                    "error": error_text
                })
            except Exception as e:
                logger.debug(f"[TRANSCRIBER] Failed to broadcast error: {e}")

    async def _process_chunk(
        self, hid: str, slot: int, src_id: int, callsign: str, pcm_bytes: bytes, is_final: bool, call_id: str = ""
    ):
        if not self.api_key and not self.api_keys:
            err = "Не указан API ключ Gemini"
            logger.warning(f"[TRANSCRIBER] TS{slot}: {err}")
            await self._notify_error(hid, slot, err)
            return

        if not await self._check_rate_limit():
            err = "Превышен лимит запросов (Rate Limit: 15 req/min)"
            logger.warning(f"[TRANSCRIBER] TS{slot}: {err}")
            await self._notify_error(hid, slot, err)
            return

        wav_bytes = self._pcm_to_wav(pcm_bytes)
        b64_audio = base64.b64encode(wav_bytes).decode("ascii")

        # --- STAGE 1: SPEECH RECOGNITION (ASR in original language) ---
        stage1_instruction = self._build_stage1_asr_instruction()
        user_prompt_stage1 = (
            "Transcribe this amateur radio audio recording verbatim in its original spoken language. "
            "Detect spoken language, speaker voice gender (male/female), and pitch (low/medium/high). Do not translate. Assemble callsigns into <call>...</call>. "
            "Output strictly valid JSON: {\"lang\": \"...\", \"gender\": \"...\", \"pitch\": \"...\", \"text\": \"...\"}."
        )

        payload_stage1 = {
            "contents": [
                {
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": "audio/wav",
                                "data": b64_audio
                            }
                        },
                        {
                            "text": user_prompt_stage1
                        }
                    ]
                }
            ],
            "system_instruction": {
                "parts": [
                    {
                        "text": stage1_instruction
                    }
                ]
            },
            "generationConfig": {
                "temperature": 0.0,
                "response_mime_type": "application/json"
            }
        }

        model_name = self.model
        if model_name.startswith("models/"):
            model_name = model_name[len("models/"):]
        endpoint = f"models/{model_name}:generateContent"

        try:
            result_json, err = await asyncio.to_thread(
                self._http_post_json_with_retry, endpoint, payload_stage1
            )
            if err or not result_json:
                error_text = err or "Пустой ответ Gemini API (ASR)"
                logger.warning(f"[TRANSCRIBER] TS{slot} Stage 1 error: {error_text}")
                await self._notify_error(hid, slot, error_text)
                return

            if "promptFeedback" in result_json and result_json["promptFeedback"].get("blockReason"):
                reason = result_json["promptFeedback"]["blockReason"]
                err = f"Блокировка фильтром Gemini ({reason})"
                logger.warning(f"[TRANSCRIBER] TS{slot}: {err}")
                await self._notify_error(hid, slot, err)
                return

            if "candidates" in result_json and result_json["candidates"]:
                cand = result_json["candidates"][0]
                finish_reason = cand.get("finishReason")
                if finish_reason and finish_reason not in ("STOP", "MAX_TOKENS"):
                    err = f"Отклонено Gemini ({finish_reason})"
                    logger.warning(f"[TRANSCRIBER] TS{slot}: {err}")
                    await self._notify_error(hid, slot, err)
                    return

            parsed = self._extract_result(result_json)
            if not parsed or not parsed.get("text"):
                return

            detected_lang = parsed.get("lang", "---").upper().strip()
            if len(detected_lang) > 3:
                detected_lang = detected_lang[:3]
            detected_gender = parsed.get("gender", "male").lower().strip()
            detected_pitch = parsed.get("pitch", "medium").lower().strip()
            original_text = parsed.get("text", "").strip()
            original_text = clean_transcription_text(original_text)

            if not original_text:
                return

            # --- STAGE 2: TRANSLATION (LLM in same model) ---
            target_lang_code = self.target_lang.lower().strip()
            is_direct = target_lang_code == "none"

            is_same_lang = False
            d_lower = detected_lang.lower()
            if target_lang_code in (d_lower, d_lower[:2]):
                is_same_lang = True
            elif target_lang_code == "ru" and d_lower in ("rus", "ru"):
                is_same_lang = True
            elif target_lang_code == "uk" and d_lower in ("ukr", "uk"):
                is_same_lang = True
            elif target_lang_code == "en" and d_lower in ("eng", "en"):
                is_same_lang = True

            if is_direct or is_same_lang:
                translated_text = original_text
            else:
                source_lang_en = LANG_NAMES_EN.get(d_lower[:2], detected_lang)
                target_lang_en = LANG_NAMES_EN.get(target_lang_code, target_lang_code)
                stage2_instruction = self._build_stage2_translation_instruction(source_lang_en, target_lang_en)

                payload_stage2 = {
                    "contents": [
                        {
                            "parts": [
                                {
                                    "text": f"Translate this amateur radio transmission from {source_lang_en} into {target_lang_en}:\n{original_text}"
                                }
                            ]
                        }
                    ],
                    "system_instruction": {
                        "parts": [
                            {
                                "text": stage2_instruction
                            }
                        ]
                    },
                    "generationConfig": {
                        "temperature": 0.0,
                        "response_mime_type": "application/json"
                    }
                }

                result2_json, err2 = await asyncio.to_thread(
                    self._http_post_json_with_retry, endpoint, payload_stage2
                )
                if result2_json:
                    parsed2 = self._extract_result(result2_json)
                    if parsed2 and parsed2.get("text"):
                        translated_text = clean_transcription_text(parsed2.get("text", "").strip())
                    else:
                        translated_text = original_text
                else:
                    logger.warning(f"[TRANSCRIBER] TS{slot} Stage 2 translation failed: {err2}. Falling back to original.")
                    translated_text = original_text

            final_text = original_text if is_direct else translated_text
            if not is_direct:
                final_text = filter_hesitation_fillers(final_text)
            display_text = final_text

            if not display_text or not display_text.strip():
                logger.info(
                    f"[TRANSCRIBER] TS{slot} [{detected_lang}->{self.target_lang}] Ignored hesitation-only utterance from {callsign or src_id}."
                )
                return

            logger.info(
                f"[TRANSCRIBER] TS{slot} [{detected_lang}->{self.target_lang}] ({detected_gender}/{detected_pitch}) {callsign or src_id}: {display_text}"
            )

            # Broadcast call_transcription (shows ONLY final translated text on screen)
            if self.broadcast_fn:
                await self.broadcast_fn({
                    "type": "call_transcription",
                    "hotspot_id": hid,
                    "slot": slot,
                    "src_id": src_id,
                    "callsign": callsign,
                    "lang": detected_lang,
                    "gender": detected_gender,
                    "pitch": detected_pitch,
                    "text": display_text,
                    "original_text": original_text,
                    "is_final": is_final,
                    "call_id": call_id
                })

            # --- STAGE 3: SPEECH SYNTHESIS (TTS) ---
            if self.is_slot_tts_enabled(hid, slot):
                actual_voice = resolve_tts_voice(self.tts_voice, gender=detected_gender, pitch=detected_pitch)
                if self.tts_engine == "piper":
                    try:
                        from piper_service import PiperService

                        piper_srv = PiperService.get_instance()
                        eff_lang = (detected_lang if is_direct else self.target_lang) or "ru"
                        eff_lang = eff_lang.lower().strip()
                        if eff_lang == "none":
                            eff_lang = (detected_lang or "ru").lower().strip()

                        # Strict readiness check: ensures model exists, belongs to eff_lang, and is not downloading
                        ready, voice_id, reason = piper_srv.is_voice_ready_for_lang(eff_lang, self.tts_voice)

                        if not ready or not voice_id:
                            logger.info(
                                f"[TRANSCRIBER] TS{slot} Piper TTS paused for language '{eff_lang}': "
                                f"model '{voice_id}' not ready ({reason}). "
                                f"Skipping speech synthesis until model is downloaded and loaded."
                            )
                            if reason in ("not_installed", "downloading") and voice_id:
                                dl_st = piper_srv.get_download_status(voice_id)
                                should_start = True
                                if dl_st.get("status") == "error":
                                    last_err_time = dl_st.get("timestamp", 0)
                                    import time
                                    if time.time() - last_err_time < 60:
                                        should_start = False
                                if should_start:
                                    piper_srv.start_download(voice_id)
                                if self.broadcast_fn:
                                    try:
                                        await self.broadcast_fn({
                                            "type": "tts_error",
                                            "hotspot_id": hid,
                                            "slot": slot,
                                            "error": f"⏳ Загрузка модели Piper для языка [{eff_lang.upper()}]... Озвучка возобновится после готовности."
                                        })
                                    except Exception:
                                        pass
                            # DO NOT SYNTHESIZE! Stop reading immediately until model is loaded.
                            return

                        # Ensure voice is in RAM
                        if not piper_srv.is_voice_loaded(voice_id):
                            logger.info(f"[TRANSCRIBER] TS{slot} Loading Piper voice '{voice_id}' into memory...")
                            loaded_ok = False
                            try:
                                loaded_ok = await asyncio.wait_for(
                                    piper_srv.preload_voice_async(voice_id),
                                    timeout=3.5
                                )
                            except asyncio.TimeoutError:
                                logger.warning(f"[TRANSCRIBER] TS{slot} Timeout loading voice '{voice_id}'. Skipping utterance.")
                                return
                            if not loaded_ok:
                                logger.warning(f"[TRANSCRIBER] TS{slot} Failed to load voice '{voice_id}'. Skipping utterance.")
                                return

                        # Strip all callsigns completely from TTS text first to evaluate utterance length
                        speech_text = strip_callsigns_for_tts(final_text, callsign=callsign)

                        if eff_lang == "ru":
                            speech_text = normalize_for_russian_tts(speech_text, strip_callsigns=True, callsign=callsign)

                        try:
                            from tts_normalizer import filter_piper_text_by_language
                            speech_text = filter_piper_text_by_language(speech_text, target_lang=eff_lang)
                        except Exception as e:
                            logger.warning(f"[TRANSCRIBER] TS{slot} Failed to filter foreign text for Piper: {e}")

                        clean_replica = (speech_text or "").strip()
                        is_short_replica = len(clean_replica) <= 20

                        effective_callsign = (callsign or "").strip()
                        call_seg_id = call_id or f"{hid}_{slot}_{src_id}"
                        call_announcement_wav = None
                        announced_phrase = ""

                        if self.tts_announce_callsign and effective_callsign and is_short_replica:
                            logger.info(
                                f"[TRANSCRIBER] TS{slot} Skipping callsign announcement: short replica "
                                f"(<= 20 chars, len={len(clean_replica)}): '{clean_replica}'"
                            )

                        if self.tts_announce_callsign and effective_callsign and not is_short_replica and call_seg_id not in self._announced_call_ids:
                            self._announced_call_ids[call_seg_id] = True
                            if len(self._announced_call_ids) > 500:
                                self._announced_call_ids.popitem(last=False)
                            from callsign_phonetic import get_callsign_announcement
                            announced_phrase = get_callsign_announcement(effective_callsign, lang=eff_lang, engine="piper")
                            if announced_phrase:
                                logger.info(
                                    f"[TRANSCRIBER] TS{slot} Announcing callsign [{effective_callsign}] ({eff_lang}): "
                                    f"'{announced_phrase}' at 0.9x"
                                )
                                c_wav, _, c_err = await piper_srv.synthesize_async(
                                    text=announced_phrase,
                                    voice_id=voice_id,
                                    speed=0.9,
                                    noise_scale=0.7,
                                    noise_w=0.8
                                )
                                if c_wav:
                                    call_announcement_wav = c_wav
                                elif c_err:
                                    logger.warning(f"[TRANSCRIBER] TS{slot} Callsign announcement synthesis failed: {c_err}")

                        if not speech_text or not speech_text.strip():
                            if call_announcement_wav:
                                wav_bytes = call_announcement_wav
                                speech_text = announced_phrase
                            else:
                                logger.info(f"[TRANSCRIBER] TS{slot} Piper TTS skipped: text empty after foreign filter / callsign strip.")
                                return
                        else:
                            wav_bytes, sample_rate, tts_err = await piper_srv.synthesize_async(
                                text=speech_text,
                                voice_id=voice_id,
                                speed=self.tts_speed,
                                noise_scale=0.7,
                                noise_w=0.8
                            )
                            if call_announcement_wav and wav_bytes:
                                from callsign_phonetic import concatenate_wavs
                                comb_wav, _ = concatenate_wavs([call_announcement_wav, wav_bytes], pause_ms=200)
                                if comb_wav:
                                    wav_bytes = comb_wav
                            elif call_announcement_wav and not wav_bytes:
                                wav_bytes = call_announcement_wav
                        if wav_bytes and self.broadcast_fn:
                            b64_wav = base64.b64encode(wav_bytes).decode("ascii")
                            await self.broadcast_fn({
                                "type": "tts_speech",
                                "hotspot_id": hid,
                                "slot": slot,
                                "audio_base64": b64_wav,
                                "text": speech_text,
                                "call_id": call_id,
                                "engine": "piper",
                                "voice": voice_id,
                                "gender": detected_gender,
                                "pitch": detected_pitch,
                                "speed": self.tts_speed,
                                "ducking_level": self.tts_ducking_level,
                                "pause_ducking_level": self.tts_pause_ducking_level,
                                "mute_others": self.tts_mute_others
                            })
                        elif tts_err:
                            logger.warning(f"[TRANSCRIBER] Piper TTS failed TS{slot}: {tts_err}")
                            if self.broadcast_fn:
                                try:
                                    await self.broadcast_fn({
                                        "type": "tts_error",
                                        "hotspot_id": hid,
                                        "slot": slot,
                                        "error": f"Piper TTS: {tts_err}"
                                    })
                                except Exception:
                                    pass
                    except Exception as e:
                        logger.warning(f"[TRANSCRIBER] Piper TTS exception TS{slot}: {e}")
                elif self.tts_engine == "gemini":
                    try:
                        clean_text = strip_callsigns_for_tts(display_text, callsign=callsign)
                        effective_callsign = (callsign or "").strip()
                        call_seg_id = call_id or f"{hid}_{slot}_{src_id}"
                        eff_l = (detected_lang if is_direct else self.target_lang) or "ru"
                        clean_replica = (clean_text or "").strip()
                        is_short_replica = len(clean_replica) <= 20

                        if self.tts_announce_callsign and effective_callsign and is_short_replica:
                            logger.info(
                                f"[TRANSCRIBER] TS{slot} Skipping callsign announcement (Gemini): short replica "
                                f"(<= 20 chars, len={len(clean_replica)}): '{clean_replica}'"
                            )

                        if self.tts_announce_callsign and effective_callsign and not is_short_replica and call_seg_id not in self._announced_call_ids:
                            self._announced_call_ids[call_seg_id] = True
                            if len(self._announced_call_ids) > 500:
                                self._announced_call_ids.popitem(last=False)
                            from callsign_phonetic import get_callsign_announcement
                            call_phrase = get_callsign_announcement(effective_callsign, lang=eff_l, engine="gemini")
                            if call_phrase:
                                logger.info(f"[TRANSCRIBER] TS{slot} Announcing callsign [{effective_callsign}] ({eff_l}): '{call_phrase}'")
                                clean_text = f"{call_phrase} {clean_text}".strip() if clean_text else call_phrase
                        if not clean_text or not clean_text.strip():
                            logger.info(f"[TRANSCRIBER] TS{slot} Gemini TTS skipped: text empty after callsign strip.")
                        else:
                            wav_bytes, tts_err = await self.synthesize_speech(
                                clean_text,
                                gender=detected_gender,
                                pitch=detected_pitch,
                                callsign=callsign
                            )
                            if wav_bytes and self.broadcast_fn:
                                b64_wav = base64.b64encode(wav_bytes).decode("ascii")
                                await self.broadcast_fn({
                                    "type": "tts_speech",
                                    "hotspot_id": hid,
                                    "slot": slot,
                                    "audio_base64": b64_wav,
                                    "text": clean_text,
                                    "call_id": call_id,
                                    "engine": "gemini",
                                    "voice": actual_voice,
                                    "gender": detected_gender,
                                    "pitch": detected_pitch,
                                    "speed": self.tts_speed,
                                    "style": self.tts_style,
                                    "ducking_level": self.tts_ducking_level,
                                    "pause_ducking_level": self.tts_pause_ducking_level,
                                    "mute_others": self.tts_mute_others
                                })
                            elif tts_err:
                                logger.warning(f"[TRANSCRIBER] TTS failed TS{slot}: {tts_err}")
                                if self.broadcast_fn:
                                    try:
                                        await self.broadcast_fn({
                                            "type": "tts_error",
                                            "hotspot_id": hid,
                                            "slot": slot,
                                            "error": tts_err
                                        })
                                    except Exception as be:
                                        logger.debug(f"[TRANSCRIBER] Failed to broadcast tts_error: {be}")
                    except Exception as e:
                        logger.warning(f"[TRANSCRIBER] TTS exception TS{slot}: {e}")
                elif self.tts_engine == "browser":
                    if self.broadcast_fn:
                        clean_speech = strip_callsigns_for_tts(display_text, callsign=callsign)
                        clean_speech = prepare_text_for_tts(clean_speech, self.target_lang, callsign=callsign)
                        if clean_speech and clean_speech.strip():
                            await self.broadcast_fn({
                                "type": "tts_speech",
                                "hotspot_id": hid,
                                "slot": slot,
                                "text": clean_speech,
                                "call_id": call_id,
                                "engine": "browser",
                                "voice": actual_voice,
                                "gender": detected_gender,
                                "pitch": detected_pitch,
                                "speed": self.tts_speed,
                                "ducking_level": self.tts_ducking_level,
                                "pause_ducking_level": self.tts_pause_ducking_level,
                                "mute_others": self.tts_mute_others
                            })
        except Exception as e:
            logger.warning(f"[TRANSCRIBER] Processing failed for TS{slot}: {e}")
            await self._notify_error(hid, slot, f"Сбой обработки: {e}")

    async def transcribe_wav(
        self,
        wav_bytes: bytes,
        src_callsign: str = "",
        src_id: int = 0,
        mime_type: str = "audio/wav"
    ) -> Tuple[Optional[str], Optional[str], Optional[str]]:
        """
        Transcribes a complete WAV file session for offline/batch transcription (2-stage).
        Returns (transcribed_text, detected_lang, error_str).
        """
        if not self.api_key and not self.api_keys:
            return None, None, "Не указан API ключ Gemini"

        b64_audio = base64.b64encode(wav_bytes).decode("ascii")
        stage1_instruction = self._build_stage1_asr_instruction()
        user_prompt_stage1 = (
            "Transcribe this amateur radio audio recording verbatim in its original spoken language. "
            "Detect spoken language, speaker voice gender (male/female), and pitch (low/medium/high). Do not translate. Assemble callsigns into <call>...</call>. "
            "Output strictly valid JSON: {\"lang\": \"...\", \"gender\": \"...\", \"pitch\": \"...\", \"text\": \"...\"}."
        )

        payload_stage1 = {
            "contents": [
                {
                    "parts": [
                        {
                            "inline_data": {
                                "mime_type": mime_type or "audio/wav",
                                "data": b64_audio
                            }
                        },
                        {
                            "text": user_prompt_stage1
                        }
                    ]
                }
            ],
            "system_instruction": {
                "parts": [
                    {
                        "text": stage1_instruction
                    }
                ]
            },
            "generationConfig": {
                "temperature": 0.0,
                "response_mime_type": "application/json"
            }
        }

        model_name = self.model
        if model_name.startswith("models/"):
            model_name = model_name[len("models/"):]
        endpoint = f"models/{model_name}:generateContent"

        try:
            result_json, err = await asyncio.to_thread(
                self._http_post_json_with_retry, endpoint, payload_stage1
            )
            if err or not result_json:
                return None, None, err or "Пустой ответ Gemini API (ASR)"

            if "promptFeedback" in result_json and result_json["promptFeedback"].get("blockReason"):
                return None, None, f"Блокировка фильтром Gemini ({result_json['promptFeedback']['blockReason']})"

            parsed = self._extract_result(result_json)
            if not parsed or not parsed.get("text"):
                return None, None, "Не удалось распознать речь"

            detected_lang = parsed.get("lang", "---").upper().strip()
            if len(detected_lang) > 3:
                detected_lang = detected_lang[:3]
            original_text = clean_transcription_text(parsed.get("text", "").strip())
            if not original_text:
                return None, detected_lang, "Речь не обнаружена"

            target_lang_code = self.target_lang.lower().strip()
            is_direct = target_lang_code == "none"

            is_same_lang = False
            d_lower = detected_lang.lower()
            if target_lang_code in (d_lower, d_lower[:2]):
                is_same_lang = True
            elif target_lang_code == "ru" and d_lower in ("rus", "ru"):
                is_same_lang = True
            elif target_lang_code == "uk" and d_lower in ("ukr", "uk"):
                is_same_lang = True
            elif target_lang_code == "en" and d_lower in ("eng", "en"):
                is_same_lang = True

            if is_direct or is_same_lang:
                return original_text, detected_lang, None

            source_lang_en = LANG_NAMES_EN.get(d_lower[:2], detected_lang)
            target_lang_en = LANG_NAMES_EN.get(target_lang_code, target_lang_code)
            stage2_instruction = self._build_stage2_translation_instruction(source_lang_en, target_lang_en)

            payload_stage2 = {
                "contents": [
                    {
                        "parts": [
                            {
                                "text": f"Translate this amateur radio transmission from {source_lang_en} into {target_lang_en}:\n{original_text}"
                            }
                        ]
                    }
                ],
                "system_instruction": {
                    "parts": [
                        {
                            "text": stage2_instruction
                        }
                    ]
                },
                "generationConfig": {
                    "temperature": 0.0,
                    "response_mime_type": "application/json"
                }
            }

            result2_json, err2 = await asyncio.to_thread(
                self._http_post_json_with_retry, endpoint, payload_stage2
            )
            if result2_json:
                parsed2 = self._extract_result(result2_json)
                if parsed2 and parsed2.get("text"):
                    translated_text = clean_transcription_text(parsed2.get("text", "").strip())
                    translated_text = filter_hesitation_fillers(translated_text)
                    return translated_text, detected_lang, None

            return original_text, detected_lang, None
        except Exception as e:
            logger.warning(f"[TRANSCRIBER] Offline transcription exception: {e}")
            return None, None, str(e)

    async def translate_text(
        self,
        text: str,
        target_lang: str,
        source_lang: Optional[str] = None
    ) -> Tuple[str, Optional[str]]:
        """Translates text into target_lang using Gemini. Returns (translated_text, error)."""
        if not text or not text.strip():
            return text, None
        target_code = (target_lang or "ru").lower().strip()
        if target_code == "none":
            return text, None
        target_lang_en = LANG_NAMES_EN.get(target_code, target_code)
        source_lang_en = LANG_NAMES_EN.get((source_lang or "").lower()[:2], "any language")
        stage2_instruction = self._build_stage2_translation_instruction(source_lang_en, target_lang_en)
        payload_stage2 = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": f"Translate this amateur radio transmission from {source_lang_en} into {target_lang_en}:\n{text}"
                        }
                    ]
                }
            ],
            "system_instruction": {
                "parts": [
                    {
                        "text": stage2_instruction
                    }
                ]
            },
            "generationConfig": {
                "temperature": 0.0,
                "response_mime_type": "application/json"
            }
        }
        model_name = self.model
        if model_name.startswith("models/"):
            model_name = model_name[len("models/"):]
        endpoint = f"models/{model_name}:generateContent"
        try:
            result2_json, err2 = await asyncio.to_thread(
                self._http_post_json_with_retry, endpoint, payload_stage2
            )
            if result2_json:
                parsed2 = self._extract_result(result2_json)
                if parsed2 and parsed2.get("text"):
                    translated_text = clean_transcription_text(parsed2.get("text", "").strip())
                    translated_text = filter_hesitation_fillers(translated_text)
                    return translated_text, None
            return text, err2
        except Exception as e:
            return text, str(e)

    def _http_post_json(self, url: str, payload: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "ProxDMR-Transcriber/0.54"
            },
            method="POST"
        )
        try:
            with urllib.request.urlopen(req, timeout=12.0) as resp:
                data = resp.read().decode("utf-8")
                return json.loads(data), None
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            logger.error(f"[TRANSCRIBER] Gemini API HTTP {e.code}: {err_body}")
            clean_msg = f"HTTP {e.code}"
            try:
                err_data = json.loads(err_body)
                if isinstance(err_data, dict) and "error" in err_data:
                    m = err_data["error"].get("message", "")
                    s = err_data["error"].get("status", "")
                    if m:
                        clean_msg = f"{s}: {m}" if s else m
            except Exception:
                if err_body:
                    clean_msg = f"HTTP {e.code}: {err_body[:80]}"
            return None, clean_msg
        except urllib.error.URLError as e:
            logger.error(f"[TRANSCRIBER] Gemini network error: {e.reason}")
            return None, f"Ошибка сети: {e.reason}"
        except TimeoutError:
            logger.error(f"[TRANSCRIBER] Gemini timeout (>12s)")
            return None, "Таймаут соединения с Gemini API (>12с)"
        except Exception as e:
            logger.error(f"[TRANSCRIBER] Gemini request error: {e}")
            return None, f"Ошибка запроса: {e}"

    def _extract_result(self, resp_json: Dict[str, Any]) -> Optional[Dict[str, str]]:
        try:
            candidates = resp_json.get("candidates", [])
            if not candidates:
                return None
            parts = candidates[0].get("content", {}).get("parts", [])
            if not parts:
                return None
            raw_text = parts[0].get("text", "").strip()
            if not raw_text:
                return None

            # Attempt clean JSON parse
            try:
                data = json.loads(raw_text)
                if isinstance(data, dict):
                    return {
                        "lang": str(data.get("lang", "---")),
                        "gender": str(data.get("gender", "male")).lower().strip(),
                        "pitch": str(data.get("pitch", "medium")).lower().strip(),
                        "text": str(data.get("text", ""))
                    }
            except Exception:
                pass

            # Fallback if markdown fence was included
            if "```" in raw_text:
                clean = raw_text.split("```")[1]
                if clean.startswith("json"):
                    clean = clean[4:]
                data = json.loads(clean.strip())
                if isinstance(data, dict):
                    return {
                        "lang": str(data.get("lang", "---")),
                        "gender": str(data.get("gender", "male")).lower().strip(),
                        "pitch": str(data.get("pitch", "medium")).lower().strip(),
                        "text": str(data.get("text", ""))
                    }

            # Fallback: treat whole response as text
            return {"lang": "---", "gender": "male", "pitch": "medium", "text": raw_text}
        except Exception as e:
            logger.debug(f"[TRANSCRIBER] Failed to parse model candidate: {e}")
            return None

    @staticmethod
    def fetch_available_models(api_key: str) -> List[Dict[str, Any]]:
        """Queries Gemini API models.list and returns models capable of speech recognition/translation and TTS speech synthesis."""
        fallback_all = list(DEFAULT_MODELS_DATA) + list(DEFAULT_TTS_MODELS_DATA)
        if not api_key:
            return fallback_all

        url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key.strip()}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "ProxDMR-Transcriber/0.56"},
            method="GET"
        )
        try:
            with urllib.request.urlopen(req, timeout=10.0) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                models = data.get("models", [])
                result = []

                # Exclude truly unrelated modalities: images, videos, music, robotics, deep research, embeddings
                exclude_substrings = [
                    "image", "nano-banana", "imagen", "lyria", "music", "robotics",
                    "computer-use", "antigravity", "deep-research", "gemma", "customtools",
                    "aqa", "veo", "embedding", "gemini-omni"
                ]

                known_map = {m["id"]: m for m in (DEFAULT_MODELS_DATA + DEFAULT_TTS_MODELS_DATA)}

                for m in models:
                    name = m.get("name", "")
                    short_id = name[len("models/"):] if name.startswith("models/") else name
                    id_lower = short_id.lower()

                    if not id_lower.startswith("gemini-"):
                        continue

                    # Filter out non-audio modalities
                    if any(ex in id_lower for ex in exclude_substrings):
                        continue

                    # If already in curated catalog, use curated details
                    if short_id in known_map:
                        result.append(dict(known_map[short_id]))
                    else:
                        disp = m.get("displayName") or short_id
                        disp_lower = disp.lower()
                        if "tts" in id_lower or "tts" in disp_lower or "native-audio" in id_lower:
                            category = "tts"
                            badge = "TTS"
                            desc = "Специализированная модель синтеза речи Gemini (Text-to-Speech)."
                            caps = ["Синтез речи", "Text-to-Speech"]
                            name_str = f"{disp} — 🔊 Синтез речи (TTS)"
                        elif "live-translate" in id_lower:
                            category = "transcribe"
                            badge = "Live Translate"
                            desc = "Модель перевода речи в реальном времени."
                            caps = ["Распознавание речи", "Синхронный перевод"]
                            name_str = f"{disp} — 🌐 Синхронный перевод (Live)"
                        elif "live" in id_lower:
                            category = "tts"
                            badge = "Live Voice"
                            desc = "Интерактивная голосовая модель Live API с генерацией речи."
                            caps = ["Синтез речи", "Live Audio"]
                            name_str = f"{disp} — 🎙️ Live Voice"
                        elif "transcribe" in id_lower:
                            category = "transcribe"
                            badge = "ASR"
                            desc = "Специализированная модель для аудио-транскрипции и перевода речи."
                            caps = ["Транскрипция речи", "Синхронный перевод"]
                            name_str = f"{disp} — ⚡ Распознавание речи (ASR)"
                        elif "lite" in id_lower:
                            category = "transcribe"
                            badge = "Flash-Lite"
                            desc = "Облегченная модель с минимальным временем отклика для распознавания речи и перевода."
                            caps = ["Распознавание речи", "Синхронный перевод", "Низкая задержка"]
                            name_str = f"{disp} — ⚡ Речь + Перевод ({badge})"
                        elif "pro" in id_lower:
                            category = "transcribe"
                            badge = "Pro"
                            desc = "Флагманская модель Pro с высоким качеством понимания сложного контекста речи."
                            caps = ["Распознавание речи", "Высокая точность перевода", "Глубокий контекст"]
                            name_str = f"{disp} — 🧠 Pro (Максимальная точность)"
                        else:
                            category = "transcribe"
                            badge = "Flash"
                            desc = "Скоростная модель для распознавания речи радиоэфира и синхронного перевода."
                            caps = ["Распознавание речи", "Синхронный перевод"]
                            name_str = f"{disp} — ⚡ Речь + Перевод ({badge})"

                        result.append({
                            "id": short_id,
                            "name": name_str,
                            "description": desc,
                            "badge": badge,
                            "category": category,
                            "capabilities": caps
                        })

                # Ensure we always have both transcription and TTS models even if Google API omitted preview models
                existing_ids = {m["id"] for m in result}
                has_tts = any(m.get("category") == "tts" for m in result)
                if not has_tts:
                    for dm in DEFAULT_TTS_MODELS_DATA:
                        if dm["id"] not in existing_ids:
                            result.append(dict(dm))

                has_transcribe = any(m.get("category") == "transcribe" for m in result)
                if not has_transcribe:
                    for dm in DEFAULT_MODELS_DATA:
                        if dm["id"] not in existing_ids:
                            result.append(dict(dm))

                # Sort: transcription models first, then TTS models
                def sort_key(item):
                    cid = item["id"].lower()
                    cat = item.get("category", "transcribe")
                    if cat == "transcribe":
                        order = 0
                        if cid == "gemini-3.1-flash-lite": sub = 0
                        elif cid == "gemini-3.5-flash": sub = 1
                        elif cid == "gemini-3.5-flash-lite": sub = 2
                        elif cid == "gemini-3.1-flash-lite-preview": sub = 3
                        elif cid == "gemini-3.6-flash": sub = 4
                        elif cid == "gemini-3.7-flash": sub = 5
                        elif cid == "gemini-3.8-flash": sub = 6
                        elif cid == "gemini-flash-latest": sub = 7
                        elif cid == "gemini-flash-lite-latest": sub = 8
                        elif cid == "gemini-2.5-flash": sub = 9
                        elif cid == "gemini-2.5-flash-lite": sub = 10
                        elif cid == "gemini-3.5-transcribe": sub = 11
                        elif "flash-lite" in cid: sub = 12
                        elif "flash" in cid: sub = 13
                        elif "transcribe" in cid: sub = 14
                        elif "pro" in cid: sub = 15
                        else: sub = 16
                    else:
                        order = 1
                        if cid == "gemini-3.1-flash-tts-preview": sub = 0
                        elif cid == "gemini-3.8-flash-lite-tts": sub = 1
                        elif cid == "gemini-3.8-flash-tts": sub = 2
                        elif cid == "gemini-2.5-flash-preview-tts": sub = 3
                        elif cid == "gemini-2.5-pro-preview-tts": sub = 4
                        elif "live" in cid or "native-audio" in cid: sub = 5
                        elif "tts" in cid: sub = 6
                        else: sub = 7
                    return (order, sub, cid)

                result.sort(key=sort_key)
                return result if result else fallback_all
        except Exception as e:
            logger.error(f"[TRANSCRIBER] fetch_available_models error: {e}")
            return fallback_all
