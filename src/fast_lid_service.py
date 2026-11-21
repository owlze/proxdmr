# -*- coding: utf-8 -*-
"""
ProxDMR 3-Level Ultra-Fast Language Identification & ASR Guard (FastLID)

Level 1 (Pre-ASR, ~20-35 ms):
  Silero ONNX 95-language spoken audio classifier (lang_classifier_95.onnx, ~16.2 MB)
  running on onnxruntime + Amateur Radio Prior Boost (DMR MCC / ITU callsign prefix / TG).
Level 2 (Pre-Translator, ~0.05 ms):
  Meta AI FastText compressed text classifier (lid.176.ftz, 917 KB) via fasttext-numpy2-wheel,
  with clean script/diacritics fallback if fasttext is unavailable.
Level 3 (QSO Continuity, 0 ms):
  Sticky Speaker / QSO Language Lock (10-minute TTL per hotspot/slot/speaker) with smooth
  code-switching recovery when an operator genuinely switches languages mid-QSO.
Plus:
  Whisper / ASR noise & repetitive-loop hallucination suppressor.
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
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import numpy as np

logger = logging.getLogger("proxdmr.fast_lid")

SILERO_LID_REPO = "deepghs/silero-lang95-onnx"
SILERO_LID_ONNX_FILE = "lang_classifier_95.onnx"
SILERO_LID_DICT_FILE = "lang_dict_95.json"
FASTTEXT_LID_URL = "https://dl.fbaipublicfiles.com/fasttext/supervised-models/lid.176.ftz"
FASTTEXT_LID_FILE = "lid.176.ftz"

TARGET_SR = 16000
MAX_AUDIO_SAMPLES = TARGET_SR * 10  # Cap Audio LID slice at 10s for ultra-low latency
MIN_AUDIO_SAMPLES = int(TARGET_SR * 0.7)  # Need >= 0.7s speech for acoustic LID
STICKY_TTL_SEC = 600.0  # 10 minutes per speaker/QSO
STICKY_MAX_ENTRIES = 500

try:
    import onnxruntime as ort
    HAVE_ORT = True
except Exception:
    ort = None  # type: ignore
    HAVE_ORT = False

try:
    import fasttext  # type: ignore
    HAVE_FASTTEXT = True
except Exception:
    fasttext = None  # type: ignore
    HAVE_FASTTEXT = False

# Map 3-letter ISO codes (used in transcriber.py) -> canonical ISO-2 codes
ISO3_TO_ISO2: Dict[str, str] = {
    "rus": "ru", "eng": "en", "ukr": "uk", "deu": "de", "ger": "de",
    "fra": "fr", "fre": "fr", "esp": "es", "spa": "es", "ita": "it",
    "pol": "pl", "por": "pt", "nld": "nl", "dut": "nl", "tur": "tr",
    "jpn": "ja", "chn": "zh", "zho": "zh", "kor": "ko", "cze": "cs",
    "ces": "cs", "ron": "ro", "rum": "ro", "bul": "bg", "gre": "el",
    "ell": "el", "hun": "hu", "swe": "sv", "nor": "no", "fin": "fi",
    "dan": "da", "heb": "he", "ara": "ar", "bel": "be", "cat": "ca",
    "eus": "eu", "glg": "gl", "kaz": "kk", "kat": "ka", "hye": "hy",
    "aze": "az", "hin": "hi", "tha": "th", "vie": "vi", "ind": "id",
    "msa": "ms", "hrv": "hr", "srp": "sr", "slk": "sk", "slv": "sl",
    "lit": "lt", "lav": "lv", "est": "et", "fas": "fa", "per": "fa",
}

SUPPORTED_ISO2: Set[str] = set(ISO3_TO_ISO2.values())

# DMR Mobile Country Code (first 3 digits of 7-digit RadioID) -> primary spoken languages
DMR_MCC_LANGS: Dict[int, Tuple[str, ...]] = {
    202: ("el",),
    204: ("nl",),
    206: ("nl", "fr"),
    208: ("fr",),
    214: ("es", "ca"),
    216: ("hu",),
    218: ("bs", "hr", "sr"),
    219: ("hr",),
    220: ("sr",),
    222: ("it",),
    226: ("ro",),
    228: ("de", "fr", "it"),
    230: ("cs",),
    231: ("sk",),
    232: ("de",),
    234: ("en",),
    235: ("en",),
    238: ("da",),
    240: ("sv",),
    242: ("no",),
    244: ("fi",),
    246: ("lt",),
    247: ("lv",),
    248: ("et",),
    250: ("ru",),
    255: ("uk", "ru"),
    257: ("ru", "be"),
    259: ("ro", "ru"),
    260: ("pl",),
    262: ("de",),
    268: ("pt",),
    270: ("fr", "de"),
    272: ("en",),
    274: ("is",),
    276: ("sq",),
    278: ("en", "it"),
    280: ("el", "tr"),
    282: ("ka",),
    283: ("hy",),
    284: ("bg",),
    286: ("tr",),
    293: ("sl",),
    294: ("mk",),
    302: ("en", "fr"),
    310: ("en",),
    311: ("en",),
    312: ("en",),
    313: ("en",),
    314: ("en",),
    315: ("en",),
    316: ("en",),
    330: ("es", "en"),
    334: ("es",),
    401: ("kk", "ru"),
    404: ("hi", "en"),
    425: ("he", "ru"),
    440: ("ja",),
    441: ("ja",),
    450: ("ko",),
    454: ("zh", "en"),
    460: ("zh",),
    466: ("zh",),
    502: ("ms", "en"),
    505: ("en",),
    510: ("id",),
    515: ("tl", "en"),
    520: ("th",),
    525: ("en", "zh"),
    530: ("en",),
    655: ("en", "af"),
    716: ("es",),
    722: ("es",),
    724: ("pt",),
    730: ("es",),
    732: ("es",),
    734: ("es",),
    748: ("es",),
}

# ITU Callsign prefix rules (checked longest prefix first)
CALLSIGN_PREFIX_LANGS: List[Tuple[str, Tuple[str, ...]]] = [
    ("2E", ("en",)), ("2M", ("en",)), ("2W", ("en",)),
    ("4X", ("he", "ru")), ("4Z", ("he", "ru")),
    ("UA", ("ru",)), ("UB", ("ru",)), ("UC", ("ru",)), ("UD", ("ru",)),
    ("UE", ("ru",)), ("UF", ("ru",)), ("UG", ("ru",)), ("UH", ("ru",)), ("UI", ("ru",)),
    ("RA", ("ru",)), ("RB", ("ru",)), ("RC", ("ru",)), ("RD", ("ru",)), ("RE", ("ru",)),
    ("RF", ("ru",)), ("RG", ("ru",)), ("RH", ("ru",)), ("RI", ("ru",)), ("RJ", ("ru",)),
    ("RK", ("ru",)), ("RL", ("ru",)), ("RM", ("ru",)), ("RN", ("ru",)), ("RO", ("ru",)),
    ("RP", ("ru",)), ("RQ", ("ru",)), ("RR", ("ru",)), ("RS", ("ru",)), ("RT", ("ru",)),
    ("RU", ("ru",)), ("RV", ("ru",)), ("RW", ("ru",)), ("RX", ("ru",)), ("RY", ("ru",)), ("RZ", ("ru",)),
    ("UR", ("uk", "ru")), ("US", ("uk", "ru")), ("UT", ("uk", "ru")), ("UU", ("uk", "ru")),
    ("UV", ("uk", "ru")), ("UW", ("uk", "ru")), ("UX", ("uk", "ru")), ("UY", ("uk", "ru")), ("UZ", ("uk", "ru")),
    ("EM", ("uk", "ru")), ("EN", ("uk", "ru")), ("EO", ("uk", "ru")),
    ("EU", ("ru", "be")), ("EV", ("ru", "be")), ("EW", ("ru", "be")),
    ("UN", ("ru", "kk")), ("UP", ("ru", "kk")),
    ("DA", ("de",)), ("DB", ("de",)), ("DC", ("de",)), ("DD", ("de",)), ("DE", ("de",)),
    ("DF", ("de",)), ("DG", ("de",)), ("DH", ("de",)), ("DI", ("de",)), ("DJ", ("de",)),
    ("DK", ("de",)), ("DL", ("de",)), ("DM", ("de",)), ("DN", ("de",)), ("DO", ("de",)),
    ("DP", ("de",)), ("DQ", ("de",)), ("DR", ("de",)),
    ("OE", ("de",)),
    ("HB", ("de", "fr", "it")),
    ("EA", ("es",)), ("EB", ("es",)), ("EC", ("es",)), ("ED", ("es",)),
    ("EE", ("es",)), ("EF", ("es",)), ("EG", ("es",)), ("EH", ("es",)),
    ("CT", ("pt",)), ("CR", ("pt",)), ("CS", ("pt",)), ("CQ", ("pt",)),
    ("PP", ("pt",)), ("PQ", ("pt",)), ("PR", ("pt",)), ("PS", ("pt",)), ("PT", ("pt",)),
    ("PU", ("pt",)), ("PV", ("pt",)), ("PW", ("pt",)), ("PX", ("pt",)), ("PY", ("pt",)), ("PZ", ("pt",)),
    ("SP", ("pl",)), ("SQ", ("pl",)), ("SO", ("pl",)), ("SN", ("pl",)), ("HF", ("pl",)),
    ("PA", ("nl",)), ("PB", ("nl",)), ("PC", ("nl",)), ("PD", ("nl",)), ("PE", ("nl",)),
    ("PF", ("nl",)), ("PG", ("nl",)), ("PH", ("nl",)), ("PI", ("nl",)),
    ("ON", ("nl", "fr")), ("OO", ("nl", "fr")), ("OP", ("nl", "fr")), ("OQ", ("nl", "fr")),
    ("OK", ("cs",)), ("OL", ("cs",)), ("OM", ("sk",)),
    ("HA", ("hu",)), ("HG", ("hu",)),
    ("YO", ("ro",)), ("YP", ("ro",)), ("YQ", ("ro",)), ("YR", ("ro",)),
    ("LZ", ("bg",)),
    ("SV", ("el",)), ("SW", ("el",)), ("SX", ("el",)), ("SY", ("el",)), ("SZ", ("el",)),
    ("TA", ("tr",)), ("TB", ("tr",)), ("TC", ("tr",)), ("YM", ("tr",)),
    ("SM", ("sv",)), ("SA", ("sv",)), ("SB", ("sv",)), ("SC", ("sv",)), ("SD", ("sv",)),
    ("LA", ("no",)), ("LB", ("no",)), ("LC", ("no",)), ("LN", ("no",)),
    ("OH", ("fi",)), ("OF", ("fi",)), ("OG", ("fi",)), ("OI", ("fi",)),
    ("OZ", ("da",)), ("OU", ("da",)), ("OV", ("da",)), ("OX", ("da",)),
    ("LY", ("lt",)), ("YL", ("lv",)), ("ES", ("et",)),
    ("9A", ("hr",)), ("YU", ("sr",)), ("YT", ("sr",)), ("S5", ("sl",)),
    ("VA", ("en", "fr")), ("VB", ("en", "fr")), ("VC", ("en", "fr")), ("VD", ("en", "fr")),
    ("VE", ("en", "fr")), ("VF", ("en", "fr")), ("VG", ("en", "fr")), ("VO", ("en",)), ("VY", ("en",)),
    ("VK", ("en",)), ("ZL", ("en",)), ("EI", ("en",)), ("GI", ("en",)), ("GM", ("en",)), ("GW", ("en",)),
    ("AA", ("en",)), ("AB", ("en",)), ("AC", ("en",)), ("AD", ("en",)), ("AE", ("en",)),
    ("AF", ("en",)), ("AG", ("en",)), ("AH", ("en",)), ("AI", ("en",)), ("AJ", ("en",)),
    ("AK", ("en",)), ("AL", ("en",)),
    ("KA", ("en",)), ("KB", ("en",)), ("KC", ("en",)), ("KD", ("en",)), ("KE", ("en",)),
    ("KF", ("en",)), ("KG", ("en",)), ("KH", ("en",)), ("KI", ("en",)), ("KJ", ("en",)),
    ("KK", ("en",)), ("KL", ("en",)), ("KM", ("en",)), ("KN", ("en",)), ("KO", ("en",)),
    ("KP", ("es", "en")), ("KQ", ("en",)), ("KR", ("en",)), ("KS", ("en",)), ("KT", ("en",)),
    ("KU", ("en",)), ("KV", ("en",)), ("KW", ("en",)), ("KX", ("en",)), ("KY", ("en",)), ("KZ", ("en",)),
    ("WA", ("en",)), ("WB", ("en",)), ("WC", ("en",)), ("WD", ("en",)), ("WE", ("en",)),
    ("WF", ("en",)), ("WG", ("en",)), ("WH", ("en",)), ("WI", ("en",)), ("WJ", ("en",)),
    ("WK", ("en",)), ("WL", ("en",)), ("WM", ("en",)), ("WN", ("en",)), ("WO", ("en",)),
    ("WP", ("en",)), ("WQ", ("en",)), ("WR", ("en",)), ("WS", ("en",)), ("WT", ("en",)),
    ("WU", ("en",)), ("WV", ("en",)), ("WW", ("en",)), ("WX", ("en",)), ("WY", ("en",)), ("WZ", ("en",)),
    ("NA", ("en",)), ("NB", ("en",)), ("NC", ("en",)), ("ND", ("en",)), ("NE", ("en",)),
    ("NF", ("en",)), ("NG", ("en",)), ("NH", ("en",)), ("NI", ("en",)), ("NJ", ("en",)),
    ("NK", ("en",)), ("NL", ("en",)), ("NM", ("en",)), ("NN", ("en",)), ("NO", ("en",)),
    ("NP", ("en",)), ("NQ", ("en",)), ("NR", ("en",)), ("NS", ("en",)), ("NT", ("en",)),
    ("NU", ("en",)), ("NV", ("en",)), ("NW", ("en",)), ("NX", ("en",)), ("NY", ("en",)), ("NZ", ("en",)),
    ("JA", ("ja",)), ("JB", ("ja",)), ("JC", ("ja",)), ("JD", ("ja",)), ("JE", ("ja",)),
    ("JF", ("ja",)), ("JG", ("ja",)), ("JH", ("ja",)), ("JI", ("ja",)), ("JJ", ("ja",)),
    ("JK", ("ja",)), ("JL", ("ja",)), ("JM", ("ja",)), ("JN", ("ja",)), ("JO", ("ja",)),
    ("JP", ("ja",)), ("JQ", ("ja",)), ("JR", ("ja",)), ("JS", ("ja",)),
    ("HL", ("ko",)), ("DS", ("ko",)),
    ("BA", ("zh",)), ("BD", ("zh",)), ("BG", ("zh",)), ("BH", ("zh",)), ("BI", ("zh",)), ("BY", ("zh",)),
    ("LU", ("es",)), ("LW", ("es",)), ("XE", ("es",)), ("CE", ("es",)), ("HK", ("es",)),
    ("YV", ("es",)), ("CX", ("es",)), ("OA", ("es",)), ("HC", ("es",)), ("TI", ("es",)),
    ("F", ("fr",)), ("I", ("it",)), ("G", ("en",)), ("M", ("en",)),
    ("K", ("en",)), ("W", ("en",)), ("N", ("en",)), ("R", ("ru",)),
]

# Known Whisper / YouTube-subtitle noise hallucination patterns on radio static
HALLUCINATION_SUBSTRINGS: Tuple[str, ...] = (
    "субтитры сделал",
    "субтитры создавал",
    "субтитры подогнал",
    "dimatorzok",
    "диматорзок",
    "редактор субтитров",
    "корректор а.",
    "а.синецкая",
    "а.семкин",
    "а.егорова",
    "продолжение следует",
    "подписывайтесь на канал",
    "подпишитесь на канал",
    "ставьте лайк",
    "спасибо за просмотр",
    "благодарю за просмотр",
    "thanks for watching",
    "thank you for watching",
    "please subscribe",
    "like and subscribe",
    "subtitles by",
    "captioned by",
    "amara.org",
    "untertitel von",
    "untertitel der amara",
    "sous-titres réalisés",
    "sous-titrage st'",
    "subtítulos por",
    "subtítulos realizados por",
    "legendas pela comunidade",
    "inscreva-se no canal",
    "obrigado por assistir",
)

STANDALONE_HALLUCINATION_RE = re.compile(
    r"^\s*(?:[\[(]?\s*(?:music|música|музыка|applause|аплодисменты|laughter|смех|silence|тишина)\s*[\])]?\.?\s*)$",
    re.IGNORECASE,
)


def normalize_to_iso2(lang_code: Optional[str]) -> str:
    """Normalize any 2-letter, 3-letter, or FastText label language code to ISO-2."""
    raw = (lang_code or "").strip().lower()
    if raw.startswith("__label__"):
        raw = raw[len("__label__"):]
    if not raw or raw in ("auto", "none", "---", "unknown"):
        return ""
    if raw in ISO3_TO_ISO2:
        return ISO3_TO_ISO2[raw]
    if len(raw) >= 2:
        c2 = raw[:2]
        if c2 in SUPPORTED_ISO2:
            return c2
        return c2
    return ""


def _decode_audio_to_16k_f32(audio_bytes: bytes) -> np.ndarray:
    """Fast stdlib WAV decoder + linear resampler to 16 kHz mono float32."""
    if not audio_bytes:
        return np.zeros(0, dtype=np.float32)

    is_wav = len(audio_bytes) >= 44 and audio_bytes[:4] == b"RIFF" and audio_bytes[8:12] == b"WAVE"
    if not is_wav:
        return np.zeros(0, dtype=np.float32)

    try:
        with wave.open(io.BytesIO(audio_bytes), "rb") as wf:
            n_ch = wf.getnchannels()
            sw = wf.getsampwidth()
            sr = wf.getframerate()
            raw = wf.readframes(wf.getnframes())
        if sw != 2 or not raw or sr <= 0:
            return np.zeros(0, dtype=np.float32)
        samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if n_ch > 1:
            samples = samples.reshape(-1, n_ch).mean(axis=1)
        if sr != TARGET_SR and len(samples) > 1:
            new_len = max(1, int(round(len(samples) * TARGET_SR / float(sr))))
            x_old = np.linspace(0.0, 1.0, num=len(samples), endpoint=False)
            x_new = np.linspace(0.0, 1.0, num=new_len, endpoint=False)
            samples = np.interp(x_new, x_old, samples).astype(np.float32)
        if len(samples) > MAX_AUDIO_SAMPLES:
            samples = samples[:MAX_AUDIO_SAMPLES]
        return samples
    except Exception as e:
        logger.debug(f"[FAST-LID] WAV decode skipped: {e}")
        return np.zeros(0, dtype=np.float32)


def _clean_text_for_lid(text: str) -> str:
    """Remove callsigns, numbers, punctuation, and universal radio jargon before text LID."""
    if not text:
        return ""
    cleaned = re.sub(r"<call>[^<]*</call>", " ", text, flags=re.IGNORECASE)
    cleaned = re.sub(r"\b[A-Z]{1,2}\d[A-Z0-9]{1,4}(?:/[A-Z0-9]+)?\b", " ", cleaned)
    cleaned = re.sub(r"\b(?:QTH|QSO|QSL|QRZ|QRM|QRN|QRT|QRX|CQ|DMR|YSF|M17|RST|PTT|73|88|59|599)\b", " ", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"[\d.,!?:;\"'()\[\]{}–—\-+@#$%^&*/\\|~`]", " ", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def infer_radio_lang_priors(
    src_id: int = 0,
    callsign: str = "",
    dst_id: int = 0,
    target_lang: str = "ru",
) -> Dict[str, float]:
    """
    Build soft language prior multipliers from amateur radio metadata (0 ms):
      - Caller DMR MCC (first 3 digits of 7-digit RadioID)
      - Caller ITU callsign prefix (for DMR, YSF, M17, D-Star, AllStar, SVXLink)
      - National Talkgroup (dst_id)
      - International lingua franca ('en') and user target language
    """
    priors: Dict[str, float] = {}

    # 1. DMR MCC from 7-digit RadioID (e.g. 2501234 -> 250 -> ru, 7241234 -> 724 -> pt)
    if src_id and 1000000 <= int(src_id) <= 9999999:
        mcc = int(src_id) // 10000
        for idx, lang in enumerate(DMR_MCC_LANGS.get(mcc, ())):
            w = 2.0 if idx == 0 else 1.5
            priors[lang] = max(priors.get(lang, 1.0), w)

    # 2. ITU Callsign prefix
    cs = re.sub(r"[^A-Z0-9]", "", (callsign or "").upper().split("/")[0].split("-")[0])
    if cs and len(cs) >= 3 and any(ch.isdigit() for ch in cs):
        for pfx, langs in CALLSIGN_PREFIX_LANGS:
            if cs.startswith(pfx):
                # For 1-letter prefix ensure next char is digit (e.g. R3ABC, K4CBN, F5XYZ, I2ABC)
                if len(pfx) == 1 and not cs[1].isdigit():
                    continue
                for idx, lang in enumerate(langs):
                    w = 1.9 if idx == 0 else 1.45
                    priors[lang] = max(priors.get(lang, 1.0), w)
                break

    # 3. National Talkgroup (skip international TG 91/92/93 and Parrot 9990)
    tg = int(dst_id or 0)
    if tg >= 200 and tg not in (91, 92, 93, 9990):
        tg_mcc = 0
        if 200 <= tg <= 799:
            tg_mcc = tg
        elif 2000 <= tg <= 7999:
            tg_mcc = tg // 10
        elif 20000 <= tg <= 79999:
            tg_mcc = tg // 100
        elif 200000 <= tg <= 799999:
            tg_mcc = tg // 1000
        if tg_mcc in DMR_MCC_LANGS:
            for idx, lang in enumerate(DMR_MCC_LANGS[tg_mcc]):
                w = 1.65 if idx == 0 else 1.35
                priors[lang] = max(priors.get(lang, 1.0), w)

    # 4. International radio lingua franca (English) & user target language
    priors["en"] = max(priors.get("en", 1.0), 1.35)
    tgt = normalize_to_iso2(target_lang)
    if tgt:
        priors[tgt] = max(priors.get(tgt, 1.0), 1.15)

    return priors


def is_asr_hallucination(text: str) -> bool:
    """Detect notorious Whisper/ASR radio-static hallucinations & degenerate word loops."""
    if not text or not text.strip():
        return False
    low = text.strip().lower()

    if STANDALONE_HALLUCINATION_RE.match(low):
        return True

    for phrase in HALLUCINATION_SUBSTRINGS:
        if phrase in low:
            # Suppress if the hallucination constitutes the majority of the utterance
            if len(low) <= len(phrase) + 28:
                return True

    # Detect degenerate single-word repetition loops (e.g. "aí, aí, aí, aí, aí, aí, aí")
    words = re.findall(r"[A-Za-zА-Яа-яЁёÀ-ÿ]{1,12}", low)
    if len(words) >= 8:
        counts: Dict[str, int] = {}
        for w in words:
            counts[w] = counts.get(w, 0) + 1
        top_cnt = max(counts.values())
        if top_cnt >= 7 and (top_cnt / float(len(words))) >= 0.72:
            return True

    return False


def _heuristic_text_lang(cleaned: str) -> Tuple[str, float]:
    """Lightweight script & diacritics fallback when FastText model is not yet loaded."""
    if not cleaned:
        return "", 0.0
    lower = cleaned.lower()
    if any(c in lower for c in ("і", "ї", "є", "ґ")):
        return "uk", 0.85
    if any(c in lower for c in ("ы", "э", "ъ", "ё")):
        return "ru", 0.85
    if any(c in lower for c in ("ã", "õ", "ç")):
        return "pt", 0.78
    if any(c in lower for c in ("ł", "ą", "ę", "ś", "ź", "ż", "ń")):
        return "pl", 0.85
    if any(c in lower for c in ("ä", "ö", "ü", "ß")):
        return "de", 0.78
    if any(c in lower for c in ("ñ", "¿", "¡")):
        return "es", 0.85
    if any(c in lower for c in ("ğ", "ş", "ı")):
        return "tr", 0.85
    if any(c in lower for c in ("ř", "ě", "ů")):
        return "cs", 0.85
    if re.search(r"[\u0400-\u04FF]", lower):
        return "ru", 0.60
    if re.search(r"[\u3040-\u30FF]", lower):
        return "ja", 0.90
    if re.search(r"[\uAC00-\uD7AF]", lower):
        return "ko", 0.90
    if re.search(r"[\u4E00-\u9FFF]", lower):
        return "zh", 0.90
    if re.search(r"[\u0600-\u06FF]", lower):
        return "ar", 0.88
    if re.search(r"[\u0590-\u05FF]", lower):
        return "he", 0.88
    if re.search(r"[\u0370-\u03FF]", lower):
        return "el", 0.88
    return "", 0.0


class FastLidService:
    _instance: Optional["FastLidService"] = None

    def __init__(self) -> None:
        self._audio_lock = threading.Lock()
        self._text_lock = threading.Lock()
        self._sticky_lock = threading.Lock()
        self._preload_started = False

        base_dir = Path("/app/src/data")
        if not base_dir.exists():
            base_dir = Path("/app/data")
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent / "data"
        if not base_dir.exists():
            base_dir = Path(__file__).resolve().parent.parent / "data"

        self._lid_dir = base_dir / "lid_models"
        self._silero_dir = self._lid_dir / "silero_lang95"
        self._lid_dir.mkdir(parents=True, exist_ok=True)
        self._silero_dir.mkdir(parents=True, exist_ok=True)

        self._silero_onnx_path = self._silero_dir / SILERO_LID_ONNX_FILE
        self._silero_dict_path = self._silero_dir / SILERO_LID_DICT_FILE
        self._ft_model_path = self._lid_dir / FASTTEXT_LID_FILE

        self._ort_session: Optional[Any] = None
        self._silero_idx_to_iso2: Dict[int, str] = {}
        self._ft_model: Optional[Any] = None

        self._silero_failed_until: float = 0.0
        self._ft_failed_until: float = 0.0

        # Sticky speaker language cache: key -> {lang, conf, hits, updated_ts, pending_lang, pending_hits}
        self._sticky: OrderedDict = OrderedDict()

    @classmethod
    def get_instance(cls) -> "FastLidService":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @staticmethod
    def is_asr_hallucination(text: str) -> bool:
        return is_asr_hallucination(text)

    def start_preload_background(self) -> None:
        """Non-blocking warm-up download & load of tiny FastLID models (~17 MB total)."""
        if self._preload_started:
            return
        self._preload_started = True

        def _worker() -> None:
            try:
                self._ensure_fasttext_loaded()
            except Exception as e:
                logger.debug(f"[FAST-LID] FastText preload skipped: {e}")
            try:
                self._ensure_silero_loaded()
            except Exception as e:
                logger.debug(f"[FAST-LID] Silero Audio LID preload skipped: {e}")

        threading.Thread(target=_worker, name="fast-lid-preload", daemon=True).start()

    # ── Level 1: Silero ONNX Audio LID ────────────────────────────────────

    def _ensure_silero_loaded(self) -> Tuple[Optional[Any], Dict[int, str]]:
        if not HAVE_ORT:
            return None, {}
        if self._ort_session is not None and self._silero_idx_to_iso2:
            return self._ort_session, self._silero_idx_to_iso2
        if time.monotonic() < self._silero_failed_until:
            return None, {}

        with self._audio_lock:
            if self._ort_session is not None and self._silero_idx_to_iso2:
                return self._ort_session, self._silero_idx_to_iso2
            if time.monotonic() < self._silero_failed_until:
                return None, {}

            try:
                if not self._silero_onnx_path.is_file() or not self._silero_dict_path.is_file():
                    from huggingface_hub import hf_hub_download
                    logger.info(f"[FAST-LID] Downloading Silero Audio LID ({SILERO_LID_REPO}, ~16 MB)...")
                    hf_hub_download(
                        repo_id=SILERO_LID_REPO,
                        filename=SILERO_LID_ONNX_FILE,
                        local_dir=str(self._silero_dir),
                    )
                    hf_hub_download(
                        repo_id=SILERO_LID_REPO,
                        filename=SILERO_LID_DICT_FILE,
                        local_dir=str(self._silero_dir),
                    )

                raw_dict = json.loads(self._silero_dict_path.read_text(encoding="utf-8"))
                idx_map: Dict[int, str] = {}
                for k, v in raw_dict.items():
                    idx = int(k)
                    iso2 = str(v).split(",")[0].strip().lower()[:2]
                    idx_map[idx] = iso2

                opts = ort.SessionOptions()
                opts.intra_op_num_threads = max(1, min(2, (os.cpu_count() or 2) - 1))
                opts.inter_op_num_threads = 1
                opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL

                sess = ort.InferenceSession(
                    str(self._silero_onnx_path),
                    sess_options=opts,
                    providers=["CPUExecutionProvider"],
                )
                self._ort_session = sess
                self._silero_idx_to_iso2 = idx_map
                logger.info(f"[FAST-LID] Silero Audio LID ready ({len(idx_map)} languages, ONNX CPU).")
                return sess, idx_map
            except Exception as e:
                logger.warning(f"[FAST-LID] Silero Audio LID unavailable (retry in 5m): {e}")
                self._silero_failed_until = time.monotonic() + 300.0
                return None, {}

    def detect_audio_lang_sync(
        self,
        wav_bytes: bytes,
        priors: Optional[Dict[str, float]] = None,
    ) -> Tuple[str, float, Dict[str, float]]:
        """Run ONNX Silero Audio LID (~20-35 ms) with soft amateur-radio prior boosting."""
        sess, idx_map = self._ensure_silero_loaded()
        if sess is None or not idx_map:
            return "", 0.0, {}

        samples = _decode_audio_to_16k_f32(wav_bytes)
        if len(samples) < MIN_AUDIO_SAMPLES:
            return "", 0.0, {}

        # Check signal energy (skip pure silence)
        rms = float(np.sqrt(np.mean(samples * samples)))
        if rms < 0.004:
            return "", 0.0, {}

        try:
            inp_meta = sess.get_inputs()[0]
            inp_name = inp_meta.name
            inp_shape = inp_meta.shape or []
            feed = samples[None, :] if len(inp_shape) >= 2 else samples
            feed = np.ascontiguousarray(feed, dtype=np.float32)

            with self._audio_lock:
                outputs = sess.run(None, {inp_name: feed})

            # Pick output tensor whose last dimension matches 95 languages
            lang_logits = None
            target_n = len(idx_map)
            for out in outputs:
                arr = np.asarray(out, dtype=np.float32)
                if arr.ndim >= 1 and arr.shape[-1] == target_n:
                    lang_logits = arr.reshape(-1, target_n)[0]
                    break
            if lang_logits is None:
                arr = np.asarray(outputs[0], dtype=np.float32)
                lang_logits = arr.reshape(-1)

            # Numerically stable softmax
            shifted = lang_logits - float(np.max(lang_logits))
            exps = np.exp(shifted)
            probs = exps / float(np.sum(exps) + 1e-12)

            raw_top_idx = int(np.argmax(probs))
            raw_top_prob = float(probs[raw_top_idx])
            raw_top_lang = idx_map.get(raw_top_idx, "")

            # Apply soft radio priors unless raw acoustic model is overwhelmingly certain (>= 0.88)
            adj_scores: Dict[str, float] = {}
            use_priors = bool(priors) and raw_top_prob < 0.88
            for idx, p in enumerate(probs):
                iso2 = idx_map.get(idx, "")
                if not iso2:
                    continue
                prob_f = float(p)
                if use_priors and priors is not None:
                    mult = priors.get(iso2, 0.42)
                    adj_scores[iso2] = adj_scores.get(iso2, 0.0) + (prob_f * mult)
                else:
                    adj_scores[iso2] = adj_scores.get(iso2, 0.0) + prob_f

            total_adj = sum(adj_scores.values()) + 1e-12
            norm_scores = {k: v / total_adj for k, v in adj_scores.items()}
            ranked = sorted(norm_scores.items(), key=lambda kv: kv[1], reverse=True)
            best_lang, best_conf = ranked[0] if ranked else ("", 0.0)
            top3 = {k: round(v, 3) for k, v in ranked[:3]}
            if raw_top_lang and raw_top_lang != best_lang:
                top3[f"raw:{raw_top_lang}"] = round(raw_top_prob, 3)
            return best_lang, float(best_conf), top3
        except Exception as e:
            logger.debug(f"[FAST-LID] Audio LID inference error: {e}")
            return "", 0.0, {}

    # ── Level 2: FastText Text LID (lid.176.ftz, 917 KB) ──────────────────

    def _ensure_fasttext_loaded(self) -> Optional[Any]:
        if not HAVE_FASTTEXT:
            return None
        if self._ft_model is not None:
            return self._ft_model
        if time.monotonic() < self._ft_failed_until:
            return None

        with self._text_lock:
            if self._ft_model is not None:
                return self._ft_model
            if time.monotonic() < self._ft_failed_until:
                return None

            try:
                if not self._ft_model_path.is_file() or self._ft_model_path.stat().st_size < 100000:
                    logger.info("[FAST-LID] Downloading Meta FastText lid.176.ftz (~917 KB)...")
                    tmp_path = self._ft_model_path.with_suffix(".tmp")
                    req = urllib.request.Request(
                        FASTTEXT_LID_URL,
                        headers={"User-Agent": "ProxDMR-FastLID/1.0"},
                    )
                    with urllib.request.urlopen(req, timeout=20) as resp:
                        tmp_path.write_bytes(resp.read())
                    tmp_path.replace(self._ft_model_path)

                # Silence FastText warning about load_model
                try:
                    fasttext.FastText.eprint = lambda *_a, **_kw: None
                except Exception:
                    pass

                self._ft_model = fasttext.load_model(str(self._ft_model_path))
                logger.info("[FAST-LID] FastText lid.176.ftz ready (176 languages, <0.1 ms).")
                return self._ft_model
            except Exception as e:
                logger.warning(f"[FAST-LID] FastText LID unavailable (retry in 5m): {e}")
                self._ft_failed_until = time.monotonic() + 300.0
                return None

    def detect_text_lang(self, text: str) -> Tuple[str, float]:
        """Ultra-fast (~0.05 ms) text language detection returning (iso2, confidence)."""
        cleaned = _clean_text_for_lid(text)
        alpha_len = len(re.findall(r"[^\W\d_]", cleaned))
        if alpha_len < 3:
            return "", 0.0

        ft_model = self._ensure_fasttext_loaded()
        if ft_model is not None:
            try:
                labels, probs = ft_model.predict(cleaned.replace("\n", " "), k=3)
                if labels and probs is not None and len(labels) > 0:
                    best_iso = normalize_to_iso2(str(labels[0]))
                    best_prob = float(probs[0])
                    if best_iso:
                        return best_iso, best_prob
            except Exception as e:
                logger.debug(f"[FAST-LID] FastText predict error: {e}")

        return _heuristic_text_lang(cleaned)

    # ── Level 3: Sticky Speaker / QSO Language Lock ───────────────────────

    @staticmethod
    def _speaker_cache_key(hid: str, slot: int, src_id: int, callsign: str, call_id: str) -> str:
        cs = (callsign or "").strip().upper()
        if cs and cs not in ("UNKNOWN", "N0CALL", "———"):
            return f"{hid}:{slot}:cs:{cs}"
        if src_id and int(src_id) > 0:
            return f"{hid}:{slot}:id:{int(src_id)}"
        if call_id:
            return f"{hid}:{slot}:cid:{call_id}"
        return f"{hid}:{slot}:anon"

    def get_sticky_lang(
        self,
        hid: str,
        slot: int,
        src_id: int = 0,
        callsign: str = "",
        call_id: str = "",
    ) -> Optional[Tuple[str, int]]:
        key = self._speaker_cache_key(hid, slot, src_id, callsign, call_id)
        now = time.monotonic()
        with self._sticky_lock:
            entry = self._sticky.get(key)
            if not entry:
                return None
            if (now - entry["updated_ts"]) > STICKY_TTL_SEC:
                self._sticky.pop(key, None)
                return None
            self._sticky.move_to_end(key)
            return entry["lang"], int(entry["hits"])

    def update_sticky_lang(
        self,
        hid: str,
        slot: int,
        lang_iso2: str,
        confidence: float,
        alpha_len: int = 0,
        src_id: int = 0,
        callsign: str = "",
        call_id: str = "",
    ) -> str:
        iso2 = normalize_to_iso2(lang_iso2)
        if not iso2:
            return ""
        key = self._speaker_cache_key(hid, slot, src_id, callsign, call_id)
        now = time.monotonic()
        with self._sticky_lock:
            entry = self._sticky.get(key)
            if entry and (now - entry["updated_ts"]) <= STICKY_TTL_SEC:
                if entry["lang"] == iso2:
                    entry["hits"] = min(50, int(entry["hits"]) + 1)
                    entry["conf"] = max(float(entry["conf"]), confidence)
                    entry["updated_ts"] = now
                    entry["pending_lang"] = ""
                    entry["pending_hits"] = 0
                    self._sticky.move_to_end(key)
                    return iso2

                # Different language detected — allow smooth switch only if strong evidence
                if confidence >= 0.90 and alpha_len >= 18:
                    logger.info(
                        f"[FAST-LID] Speaker {key} switched language {entry['lang']} -> {iso2} "
                        f"(high-conf={confidence:.2f}, chars={alpha_len})"
                    )
                    entry["lang"] = iso2
                    entry["hits"] = 1
                    entry["conf"] = confidence
                    entry["updated_ts"] = now
                    entry["pending_lang"] = ""
                    entry["pending_hits"] = 0
                    self._sticky.move_to_end(key)
                    return iso2

                if confidence >= 0.72 and alpha_len >= 10:
                    if entry.get("pending_lang") == iso2:
                        entry["pending_hits"] = int(entry.get("pending_hits", 0)) + 1
                    else:
                        entry["pending_lang"] = iso2
                        entry["pending_hits"] = 1
                    if entry["pending_hits"] >= 2:
                        logger.info(
                            f"[FAST-LID] Speaker {key} switched language {entry['lang']} -> {iso2} "
                            f"(2 consecutive chunks)"
                        )
                        entry["lang"] = iso2
                        entry["hits"] = 2
                        entry["conf"] = confidence
                        entry["updated_ts"] = now
                        entry["pending_lang"] = ""
                        entry["pending_hits"] = 0
                        self._sticky.move_to_end(key)
                        return iso2
                return entry["lang"]

            # Create new lock entry
            self._sticky[key] = {
                "lang": iso2,
                "conf": confidence,
                "hits": 1,
                "updated_ts": now,
                "pending_lang": "",
                "pending_hits": 0,
            }
            self._sticky.move_to_end(key)
            while len(self._sticky) > STICKY_MAX_ENTRIES:
                self._sticky.popitem(last=False)
            return iso2

    # ── Orchestrators for transcriber.py ──────────────────────────────────

    def resolve_pre_asr_lang_sync(
        self,
        wav_bytes: bytes,
        hid: str = "",
        slot: int = 1,
        src_id: int = 0,
        callsign: str = "",
        dst_id: int = 0,
        call_id: str = "",
        target_lang: str = "ru",
    ) -> Tuple[Optional[str], Dict[str, Any]]:
        """
        Determine spoken language BEFORE running ASR (Rumble / Groq / Deepgram / Gemini).
        Returns (iso2_or_None, meta_dict).
        """
        t0 = time.monotonic()

        # 1. Check Sticky Speaker / QSO Lock (0 ms!)
        sticky = self.get_sticky_lang(hid, slot, src_id=src_id, callsign=callsign, call_id=call_id)
        if sticky:
            locked_lang, hits = sticky
            return locked_lang, {
                "source": "sticky_lock",
                "lang": locked_lang,
                "hits": hits,
                "ms": 0.0,
            }

        # 2. Compute amateur radio priors + run Silero ONNX Audio LID (~20-35 ms)
        priors = infer_radio_lang_priors(
            src_id=src_id, callsign=callsign, dst_id=dst_id, target_lang=target_lang
        )
        audio_lang, audio_conf, top3 = self.detect_audio_lang_sync(wav_bytes, priors=priors)
        elapsed_ms = round((time.monotonic() - t0) * 1000.0, 1)

        meta: Dict[str, Any] = {
            "source": "audio_lid" if audio_lang else "none",
            "lang": audio_lang,
            "conf": round(audio_conf, 3),
            "top3": top3,
            "ms": elapsed_ms,
        }

        if audio_lang and audio_conf >= 0.58:
            logger.info(
                f"[FAST-LID] Pre-ASR hint for {callsign or src_id or 'rx'} -> {audio_lang} "
                f"(conf={audio_conf:.2f}, {elapsed_ms:.1f}ms, top={top3})"
            )
            return audio_lang, meta

        return None, meta

    async def resolve_pre_asr_lang_async(
        self,
        wav_bytes: bytes,
        hid: str = "",
        slot: int = 1,
        src_id: int = 0,
        callsign: str = "",
        dst_id: int = 0,
        call_id: str = "",
        target_lang: str = "ru",
    ) -> Tuple[Optional[str], Dict[str, Any]]:
        return await asyncio.to_thread(
            self.resolve_pre_asr_lang_sync,
            wav_bytes,
            hid,
            slot,
            src_id,
            callsign,
            dst_id,
            call_id,
            target_lang,
        )

    def verify_post_asr_and_lock(
        self,
        text: str,
        asr_lang: str,
        hid: str = "",
        slot: int = 1,
        src_id: int = 0,
        callsign: str = "",
        dst_id: int = 0,
        call_id: str = "",
        pre_lid_meta: Optional[Dict[str, Any]] = None,
        manual_forced: bool = False,
    ) -> str:
        """
        Verify recognized text language with FastText (<0.1 ms) before translation
        and update the Sticky Speaker / QSO Language Lock.
        Returns verified canonical ISO-2 language code.
        """
        asr_iso2 = normalize_to_iso2(asr_lang)
        if manual_forced:
            return asr_iso2

        cleaned = _clean_text_for_lid(text)
        alpha_len = len(re.findall(r"[^\W\d_]", cleaned))
        text_iso2, text_conf = self.detect_text_lang(text)

        chosen_iso2 = asr_iso2
        chosen_conf = 0.5

        if text_iso2 and alpha_len >= 8 and text_conf >= 0.65:
            if text_iso2 != asr_iso2:
                logger.info(
                    f"[FAST-LID] Text LID corrected ASR lang {asr_iso2 or '?'} -> {text_iso2} "
                    f"(conf={text_conf:.2f}, chars={alpha_len}) for {callsign or src_id}"
                )
            chosen_iso2 = text_iso2
            chosen_conf = text_conf
        elif text_iso2 and text_iso2 == asr_iso2:
            chosen_conf = max(text_conf, 0.75)
        elif pre_lid_meta and pre_lid_meta.get("lang") == asr_iso2 and float(pre_lid_meta.get("conf", 0.0)) >= 0.58:
            chosen_conf = max(0.72, float(pre_lid_meta.get("conf", 0.0)))

        # Update sticky lock when confidence is solid
        if chosen_iso2 and (
            (alpha_len >= 10 and chosen_conf >= 0.72)
            or (text_iso2 and text_iso2 == asr_iso2 and alpha_len >= 6 and text_conf >= 0.55)
        ):
            self.update_sticky_lang(
                hid=hid,
                slot=slot,
                lang_iso2=chosen_iso2,
                confidence=chosen_conf,
                alpha_len=alpha_len,
                src_id=src_id,
                callsign=callsign,
                call_id=call_id,
            )

        return chosen_iso2 or asr_iso2 or "en"
