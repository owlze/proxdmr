#!/usr/bin/env python3
"""
Backend i18n helper for ProxDMR FastAPI / WebSocket / engine modules.
Loads the shared 8-language JSON dictionaries from src/static/locales/{lang}.json
and resolves per-request / per-WebSocket / per-user language cleanly.
"""
from __future__ import annotations

import contextvars
import json
import os
import re
import threading
from typing import Any, Optional

SUPPORTED_LANGS = ("en", "ru", "de", "es", "fr", "it", "nl", "uk")
DEFAULT_LANG = "ru"
FALLBACK_LANG = "en"

_LOCALES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static", "locales")
_LOCK = threading.Lock()
_LOCALES_CACHE: dict[str, dict[str, str]] = {}
_LOCALES_MTIME: dict[str, float] = {}

_REQUEST_LANG: contextvars.ContextVar[str] = contextvars.ContextVar("proxdmr_req_lang", default="")
_USER_LANGS: dict[int, str] = {}
_RUNTIME_DEFAULT_LANG: str = DEFAULT_LANG

_PH_RE = re.compile(r"\{([a-zA-Z0-9_]+)\}")


def normalize_lang(val: Optional[str]) -> str:
    """Normalize a BCP-47/short language code to one of SUPPORTED_LANGS, or return ''."""
    if not val or not isinstance(val, str):
        return ""
    code = val.strip().lower().replace("_", "-")
    if not code:
        return ""
    base = code.split("-", 1)[0]
    if base in SUPPORTED_LANGS:
        return base
    return ""


def parse_accept_language(header: Optional[str]) -> str:
    """Parse HTTP Accept-Language header ordered by q-weight."""
    if not header or not isinstance(header, str):
        return ""
    candidates: list[tuple[float, str]] = []
    for raw_part in header.split(","):
        part = raw_part.strip()
        if not part:
            continue
        lang_tag = part
        q = 1.0
        if ";" in part:
            pieces = part.split(";")
            lang_tag = pieces[0].strip()
            for p in pieces[1:]:
                p = p.strip()
                if p.startswith("q="):
                    try:
                        q = float(p[2:])
                    except ValueError:
                        q = 0.0
        norm = normalize_lang(lang_tag)
        if norm:
            candidates.append((q, norm))
    if not candidates:
        return ""
    candidates.sort(key=lambda item: item[0], reverse=True)
    return candidates[0][1]


def _load_lang_dict(lang: str) -> dict[str, str]:
    norm = normalize_lang(lang) or DEFAULT_LANG
    path = os.path.join(_LOCALES_DIR, f"{norm}.json")
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return _LOCALES_CACHE.get(norm, {})
    with _LOCK:
        if norm in _LOCALES_CACHE and _LOCALES_MTIME.get(norm) == mtime:
            return _LOCALES_CACHE[norm]
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                flat: dict[str, str] = {}
                for k, v in data.items():
                    if isinstance(v, str):
                        flat[str(k)] = v
                _LOCALES_CACHE[norm] = flat
                _LOCALES_MTIME[norm] = mtime
                return flat
        except Exception:
            pass
        return _LOCALES_CACHE.get(norm, {})


def preload_locales() -> None:
    """Preload all supported language JSON dictionaries into memory."""
    for l in SUPPORTED_LANGS:
        _load_lang_dict(l)


def set_request_lang(lang: Optional[str]) -> contextvars.Token:
    norm = normalize_lang(lang)
    return _REQUEST_LANG.set(norm)


def reset_request_lang(token: contextvars.Token) -> None:
    try:
        _REQUEST_LANG.reset(token)
    except Exception:
        pass


def get_request_lang() -> str:
    return _REQUEST_LANG.get()


def set_user_lang(user_id: Optional[int], lang: Optional[str], update_runtime_default: bool = True) -> str:
    norm = normalize_lang(lang)
    if not norm:
        return get_user_lang(user_id)
    global _RUNTIME_DEFAULT_LANG
    with _LOCK:
        if user_id is not None:
            _USER_LANGS[int(user_id)] = norm
            if update_runtime_default and int(user_id) == 1:
                _RUNTIME_DEFAULT_LANG = norm
        elif update_runtime_default:
            _RUNTIME_DEFAULT_LANG = norm
    return norm


def get_user_lang(user_id: Optional[int] = None) -> str:
    with _LOCK:
        if user_id is not None and int(user_id) in _USER_LANGS:
            return _USER_LANGS[int(user_id)]
        return _RUNTIME_DEFAULT_LANG or DEFAULT_LANG


def set_runtime_default_lang(lang: Optional[str]) -> str:
    global _RUNTIME_DEFAULT_LANG
    norm = normalize_lang(lang)
    if norm:
        with _LOCK:
            _RUNTIME_DEFAULT_LANG = norm
    return _RUNTIME_DEFAULT_LANG


def get_lang(explicit: Optional[str] = None, user_id: Optional[int] = None) -> str:
    norm = normalize_lang(explicit)
    if norm:
        return norm
    req_l = _REQUEST_LANG.get()
    if req_l:
        return req_l
    if user_id is not None:
        with _LOCK:
            ul = _USER_LANGS.get(int(user_id))
            if ul:
                return ul
    return _RUNTIME_DEFAULT_LANG or DEFAULT_LANG


def resolve_request_lang(request: Any, user_id: Optional[int] = None, is_demo: bool = False) -> str:
    """Determine request language: query ?lang= > X-ProxDMR-Lang > cookie proxdmr_lang > non-demo user pref > Accept-Language > runtime default."""
    try:
        qp = normalize_lang(request.query_params.get("lang"))
        if qp:
            return qp
    except Exception:
        pass
    try:
        hdr = normalize_lang(request.headers.get("x-proxdmr-lang"))
        if hdr:
            return hdr
    except Exception:
        pass
    try:
        ck = normalize_lang(request.cookies.get("proxdmr_lang"))
        if ck:
            return ck
    except Exception:
        pass
    if not is_demo and user_id is not None:
        with _LOCK:
            ul = _USER_LANGS.get(int(user_id))
            if ul:
                return ul
    try:
        al = parse_accept_language(request.headers.get("accept-language"))
        if al:
            return al
    except Exception:
        pass
    return _RUNTIME_DEFAULT_LANG or DEFAULT_LANG


def tr(
    key: str,
    lang: Optional[str] = None,
    user_id: Optional[int] = None,
    fallback: Optional[str] = None,
    **params: Any,
) -> str:
    """Translate a key for the active/specified language with safe placeholder formatting."""
    target = get_lang(explicit=lang, user_id=user_id)
    val = _load_lang_dict(target).get(key)
    if val is None and target != FALLBACK_LANG:
        val = _load_lang_dict(FALLBACK_LANG).get(key)
    if val is None and target != DEFAULT_LANG:
        val = _load_lang_dict(DEFAULT_LANG).get(key)
    if val is None:
        val = fallback if fallback is not None else key
    if params:
        val = _PH_RE.sub(lambda m: str(params.get(m.group(1), m.group(0))), val)
    return val


# Map common Russian/English labels or ISO-2 country codes to canonical countries.<slug> keys
_COUNTRY_SLUG_ALIASES: dict[str, str] = {
    "AT": "at", "AU": "au", "AR": "ar", "AZ": "az", "AL": "al", "AM": "am",
    "BE": "be", "BG": "bg", "BO": "bo", "BR": "br", "BY": "by", "BA": "ba",
    "CA": "ca", "CH": "ch", "CL": "cl", "CN": "cn", "CO": "co", "CY": "cy", "CZ": "cz",
    "DE": "de", "DK": "dk", "DZ": "dz",
    "EE": "ee", "EG": "eg", "ES": "es", "EU": "eu",
    "FI": "fi", "FO": "fo", "FR": "fr",
    "GB": "gb", "UK": "gb", "GE": "ge", "GLOBAL": "global", "GR": "gr",
    "HK": "hk", "HR": "hr", "HU": "hu",
    "ID": "id", "IE": "ie", "IL": "il", "IN": "in", "IS": "is", "IT": "it",
    "JP": "jp",
    "KG": "kg", "KR": "kr", "KZ": "kz",
    "LI": "li", "LT": "lt", "LU": "lu", "LV": "lv",
    "MD": "md", "MK": "mk", "MN": "mn", "MT": "mt", "MX": "mx", "MY": "my",
    "NL": "nl", "NO": "no", "NZ": "nz",
    "PA": "central_america", "PH": "ph", "PL": "pl", "PT": "pt",
    "RO": "ro", "RS": "rs", "RU": "ru",
    "SA": "sa", "SE": "se", "SG": "sg", "SI": "si", "SK": "sk",
    "TH": "th", "TJ": "tj", "TM": "tm", "TR": "tr", "TW": "tw",
    "UA": "ua", "AE": "ae", "US": "us", "UY": "uy", "UZ": "uz",
    "XX": "global", "ZA": "za",
    # Descriptive country/hub names stored in host lists
    "РОССИЯ": "ru", "RUSSIA": "ru",
    "ГЕРМАНИЯ": "de", "GERMANY": "de",
    "ВЕЛИКОБРИТАНИЯ": "gb", "UNITED KINGDOM": "gb", "ENGLAND": "gb", "GREAT BRITAIN": "gb",
    "ШОТЛАНДИЯ": "gb_scotland", "SCOTLAND": "gb_scotland",
    "США": "us", "USA": "us", "UNITED STATES": "us",
    "США (ФЛОРИДА)": "us_fl", "USA FLORIDA": "us_fl",
    "США (САН-ФРАНЦИСКО)": "us_sf", "USA SAN FRANCISCO": "us_sf",
    "ЕВРОПА": "eu", "EUROPE": "eu",
    "ЕВРОПА (ХАБ)": "eu_hub", "EUROPE (MAIN HUB)": "eu_hub",
    "МЕЖДУНАРОДНЫЙ": "global", "МЕЖДУНАРОДНАЯ": "global", "INTERNATIONAL": "global",
    "ДРУГАЯ СТРАНА": "other", "OTHER COUNTRY": "other",
    "ЦЕНТРАЛЬНАЯ АМЕРИКА": "central_america", "CENTRAL AMERICA": "central_america",
    "АВСТРИЯ": "at", "AUSTRIA": "at",
    "ШВЕЙЦАРИЯ": "ch", "SWITZERLAND": "ch",
    "ФРАНЦИЯ": "fr", "FRANCE": "fr",
    "ИСПАНИЯ": "es", "SPAIN": "es",
    "ИТАЛИЯ": "it", "ITALY": "it",
    "НИДЕРЛАНДЫ": "nl", "NETHERLANDS": "nl",
    "ПОЛЬША": "pl", "POLAND": "pl",
    "ЧЕХИЯ": "cz", "CZECH REPUBLIC": "cz",
    "ШВЕЦИЯ": "se", "SWEDEN": "se",
    "ФИНЛЯНДИЯ": "fi", "FINLAND": "fi",
    "НОРВЕГИЯ": "no", "NORWAY": "no",
    "ДАНИЯ": "dk", "DENMARK": "dk",
    "ВЕНГРИЯ": "hu", "HUNGARY": "hu",
    "РУМЫНИЯ": "ro", "ROMANIA": "ro",
    "БОЛГАРИЯ": "bg", "BULGARIA": "bg",
    "СЛОВЕНИЯ": "si", "SLOVENIA": "si",
    "ПОРТУГАЛИЯ": "pt", "PORTUGAL": "pt",
    "ИРЛАНДИЯ": "ie", "IRELAND": "ie",
    "ГРЕЦИЯ": "gr", "GREECE": "gr",
    "БЕЛЬГИЯ": "be", "BELGIUM": "be",
    "КАНАДА": "ca", "CANADA": "ca",
    "ИЗРАИЛЬ": "il", "ISRAEL": "il",
    "АВСТРАЛИЯ": "au", "AUSTRALIA": "au",
    "ЮЖНАЯ КОРЕЯ": "kr", "КОРЕЯ": "kr", "SOUTH KOREA": "kr",
    "КИТАЙ": "cn", "CHINA": "cn",
    "МАЛАЙЗИЯ": "my", "MALAYSIA": "my",
    "ФИЛИППИНЫ": "ph", "PHILIPPINES": "ph",
    "ЮАР": "za", "SOUTH AFRICA": "za",
    "БРАЗИЛИЯ": "br", "BRAZIL": "br",
    "ЧИЛИ": "cl", "CHILE": "cl",
    "МЕКСИКА": "mx", "MEXICO": "mx",
    "УКРАИНА": "ua", "UKRAINE": "ua",
    "БЕЛАРУСЬ": "by", "BELARUS": "by",
    "КАЗАХСТАН": "kz", "KAZAKHSTAN": "kz",
    "АРМЕНИЯ": "am", "ARMENIA": "am",
    "ГРУЗИЯ": "ge", "GEORGIA": "ge",
    "АЗЕРБАЙДЖАН": "az", "AZERBAIJAN": "az",
    "УЗБЕКИСТАН": "uz", "UZBEKISTAN": "uz",
    "ТАДЖИКИСТАН": "tj", "TAJIKISTAN": "tj",
    "КЫРГЫЗСТАН": "kg", "KYRGYZSTAN": "kg",
    "ТУРКМЕНИСТАН": "tm", "TURKMENISTAN": "tm",
    "МОЛДОВА": "md", "MOLDOVA": "md",
    "ЛИТВА": "lt", "LITHUANIA": "lt",
    "ЛАТВИЯ": "lv", "LATVIA": "lv",
    "ЭСТОНИЯ": "ee", "ESTONIA": "ee",
    "ЛЮКСЕМБУРГ": "lu", "LUXEMBOURG": "lu",
    "СЕРБИЯ": "rs", "SERBIA": "rs",
    "ХОРВАТИЯ": "hr", "CROATIA": "hr",
    "ТУРЦИЯ": "tr", "TURKEY": "tr",
    "ИНДИЯ": "in", "INDIA": "in",
    "ТАИЛАНД": "th", "THAILAND": "th",
    "АРГЕНТИНА": "ar", "ARGENTINA": "ar",
    "НОВАЯ ЗЕЛАНДИЯ": "nz", "NEW ZEALAND": "nz",
    "ЯПОНИЯ": "jp", "JAPAN": "jp",
    "СЛОВАКИЯ": "sk", "SLOVAKIA": "sk",
}


def country_name(code_or_name: Optional[str], lang: Optional[str] = None, user_id: Optional[int] = None, fallback: str = "") -> str:
    """Resolve an ISO-2 country code or descriptive country label to localized text."""
    raw = (code_or_name or "").strip()
    if not raw:
        return tr("countries.other", lang=lang, user_id=user_id, fallback=fallback or "")
    slug = _COUNTRY_SLUG_ALIASES.get(raw.upper())
    if slug:
        return tr(f"countries.{slug}", lang=lang, user_id=user_id, fallback=fallback or raw)
    return fallback or raw


_SPECIAL_TG_KEYS: dict[int, str] = {
    1: "tg_catalog.tg_1",
    2: "tg_catalog.tg_2",
    8: "tg_catalog.tg_8",
    9: "tg_catalog.tg_9",
    20: "tg_catalog.tg_20",
    91: "tg_catalog.tg_91",
    92: "tg_catalog.tg_92",
    93: "tg_catalog.tg_93",
    94: "tg_catalog.tg_94",
    95: "tg_catalog.tg_95",
    96: "tg_catalog.tg_96",
    97: "tg_catalog.tg_97",
    98: "tg_catalog.tg_98",
    113: "tg_catalog.tg_113",
    250: "tg_catalog.tg_250",
    2501: "tg_catalog.tg_2501",
    2502: "tg_catalog.tg_2502",
    2503: "tg_catalog.tg_2503",
    2504: "tg_catalog.tg_2504",
    2505: "tg_catalog.tg_2505",
    2506: "tg_catalog.tg_2506",
    2507: "tg_catalog.tg_2507",
    2508: "tg_catalog.tg_2508",
    2509: "tg_catalog.tg_2509",
    25011: "tg_catalog.tg_25011",
    25020: "tg_catalog.tg_25020",
    25033: "tg_catalog.tg_25033",
    4000: "tg_catalog.tg_4000",
    4001: "tg_catalog.tg_4001",
    4020: "tg_catalog.tg_4020",
    4030: "tg_catalog.tg_4030",
    4400: "tg_catalog.tg_4400",
    4500: "tg_catalog.tg_4500",
    4530: "tg_catalog.tg_4530",
    4700: "tg_catalog.tg_4700",
    4800: "tg_catalog.tg_4800",
    5000: "tg_catalog.tg_5000",
    9990: "tg_catalog.tg_9990",
}


def tg_special_name(tg_id: Any, lang: Optional[str] = None, user_id: Optional[int] = None, fallback: str = "") -> str:
    """Return localized label for well-known special/service/regional TG IDs, or fallback."""
    try:
        n = int(tg_id)
    except (TypeError, ValueError):
        return fallback
    key = _SPECIAL_TG_KEYS.get(n)
    if key:
        return tr(key, lang=lang, user_id=user_id, fallback=fallback)
    return fallback
