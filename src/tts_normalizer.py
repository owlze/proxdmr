"""
Phonetic text normalizer for Text-to-Speech (TTS) in ProxDMR.
Converts amateur radio callsigns, Q-codes, abbreviations, and numbers into
natural, fully intelligible phonetic text based on ITU/ICAO standards.
"""

import re
from typing import Dict, Optional, Any

try:
    import num2words
    HAVE_NUM2WORDS = True
except ImportError:
    HAVE_NUM2WORDS = False

# ITU / ICAO phonetic alphabet transcribed in Russian letters with Piper TTS stress marks
ICAO_PHONETIC_RU: Dict[str, str] = {
    "A": "А́льфа",
    "B": "Бра́во",
    "C": "Ча́рли",
    "D": "Дэ́льта",
    "E": "Э́ко",
    "F": "Фо́кстрот",
    "G": "Гольф",
    "H": "Хо́тэл",
    "I": "И́ндиа",
    "J": "Джулиэ́т",
    "K": "Ки́ло",
    "L": "Ли́ма",
    "M": "Майк",
    "N": "Новэ́мбэр",
    "O": "О́скар",
    "P": "Папа́",
    "Q": "Квэбэ́к",
    "R": "Ро́мио",
    "S": "Сиэ́ра",
    "T": "Тэ́нго",
    "U": "Ю́ниформ",
    "V": "Ви́ктор",
    "W": "Уи́ски",
    "X": "Э́кс-рэй",
    "Y": "Я́нки",
    "Z": "Зу́лу",
}

# Digits reading in Russian within callsigns
DIGITS_RU: Dict[str, str] = {
    "0": "ноль",
    "1": "один",
    "2": "два",
    "3": "три",
    "4": "четыре",
    "5": "пять",
    "6": "шесть",
    "7": "семь",
    "8": "восемь",
    "9": "девять",
}

# Amateur radio Q-codes and standard abbreviations (Russian transcription)
Q_CODES_AND_ABBREVIATIONS_RU: Dict[str, str] = {
    "QTH": "Кю-Ти-Эйч",
    "QSL": "Кю-Эс-Эл",
    "QSO": "Кю-Эс-О",
    "QRZ": "Кю-Эр-Зет",
    "QRM": "Кю-Эр-Эм",
    "QRN": "Кю-Эр-Эн",
    "QRO": "Кю-Эр-О",
    "QRP": "Кю-Эр-Пи",
    "QRT": "Кю-Эр-Ти",
    "QRX": "Кю-Эр-Икс",
    "QRV": "Кю-Эр-Ви",
    "QSY": "Кю-Эс-Вай",
    "QSB": "Кю-Эс-Би",
    "CQ": "Цэ-Кю",
    "CW": "Си-Дабл-ю",
    "SSB": "Эс-Эс-Би",
    "RST": "Эр-Эс-Ти",
    "DX": "Ди-Экс",
    "DMR": "Ди-Эм-Эр",
    "PTT": "Пи-Ти-Ти",
    "VFO": "Вэ-Фэ-О",
    "TS1": "таймслот один",
    "TS2": "таймслот два",
    "TG": "Тэ-Гэ",
    "RX": "приём",
    "TX": "передача",
    "HF": "КВ",
    "VHF": "УКВ",
    "UHF": "ДЦВ",
}

# Regex pattern matching amateur radio callsigns
# Examples: R3ABC, RA3ABC, UA0AAA, DL1ABC, K1ABC, 4X4AA, 5B4AAA, R3ABC/P, UR5XYZ/M
CALLSIGN_REGEX = re.compile(
    r"\b(?:[A-Z]{1,2}\d[A-Z]{1,4}|[A-Z]\d{2}[A-Z]{1,4}|\d[A-Z]\d[A-Z]{1,4})(?:/[A-Z0-9]+)?\b",
    re.IGNORECASE
)


def normalize_callsign_ru(callsign: str) -> str:
    """
    Converts an amateur radio callsign (e.g. 'R3ABC', 'UA3AAA/P')
    into ICAO/ITU Russian phonetic transcription.
    """
    callsign = callsign.upper()
    parts = callsign.split("/")
    main_call = parts[0]
    
    tokens = []
    for ch in main_call:
        if ch in ICAO_PHONETIC_RU:
            tokens.append(ICAO_PHONETIC_RU[ch])
        elif ch in DIGITS_RU:
            tokens.append(DIGITS_RU[ch])
        else:
            tokens.append(ch)

    result = " ".join(tokens)

    if len(parts) > 1:
        for suffix in parts[1:]:
            result += " дробь"
            if suffix == "P":
                result += f" {ICAO_PHONETIC_RU['P']}"
            elif suffix == "M":
                result += f" {ICAO_PHONETIC_RU['M']}"
            elif suffix == "MM":
                result += f" {ICAO_PHONETIC_RU['M']} {ICAO_PHONETIC_RU['M']}"
            elif suffix == "QRP":
                result += f" {Q_CODES_AND_ABBREVIATIONS_RU.get('QRP', 'Кю-Эр-Пи')}"
            elif suffix == "A":
                result += f" {ICAO_PHONETIC_RU['A']}"
            else:
                for ch in suffix:
                    if ch in ICAO_PHONETIC_RU:
                        result += f" {ICAO_PHONETIC_RU[ch]}"
                    elif ch in DIGITS_RU:
                        result += f" {DIGITS_RU[ch]}"
                    else:
                        result += f" {ch}"

    return result


def strip_stress_marks(text: str) -> str:
    """
    Strips phonetic stress marks '+' and Unicode combining acute accents '\u0301' from text,
    keeping mathematical or signal reports '+' (e.g. 59+20, 59+).
    Removes '+' only when immediately followed by a letter.
    Supports Russian, Ukrainian, and Latin characters.
    Examples:
      'д+обрый в+ечер' -> 'добрый вечер'
      'до́брый ве́чер' -> 'добрый вечер'
      'прив+іт' -> 'привіт'
      'сп+асибо, 59+20' -> 'спасибо, 59+20'
      '+имя' -> 'имя'
    """
    if not text:
        return ""
    # Strip Unicode combining acute accent U+0301
    text = text.replace("\u0301", "")
    return re.sub(r"\+(?=[а-яёА-ЯЁa-zA-ZєіїЄІЇ])", "", text)


def convert_plus_stress_to_acute(text: str) -> str:
    """
    Converts '+' stress marks placed before Russian and Ukrainian vowels
    (e.g. '+яблоко', 'д+обрый', 'за+мок', 'прив+іт', 'д+якую')
    into Unicode combining acute accents '\u0301' directly following the stressed vowel
    as required by Piper TTS / eSpeak-NG (e.g. 'я́блоко', 'до́брый', 'замо́к', 'приві́т', 'дя́кую').
    Preserves '+' in signal reports or mathematics (e.g. 59+20).
    Strips any accidental '+' placed before consonants or standalone.
    """
    if not text:
        return ""
    # Convert +VOWEL into VOWEL + \u0301 (Russian + Ukrainian vowels)
    text = re.sub(
        r"\+([аеёєиіїоуыэюяАЕЁЄИІЇОУЫЭЮЯ])",
        lambda m: m.group(1) + "\u0301",
        text
    )
    # Strip any residual '+' before other letters (e.g. +consonant hallucinations)
    text = re.sub(r"\+(?=[а-яёА-ЯЁa-zA-ZєіїЄІЇ])", "", text)
    return text


CALLSIGN_PHONETIC_WORDS = set([
    # Digits (RU & EN)
    "ноль", "нуль", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять",
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
    # NATO & ITU phonetics
    "альфа", "alfa", "alpha",
    "браво", "bravo",
    "чарли", "charlie",
    "дельта", "дэльта", "delta",
    "эхо", "эко", "echo",
    "фокстрот", "foxtrot",
    "гольф", "golf", "голдшанки",
    "хотел", "хотэл", "отель", "hotel", "henry", "генри",
    "индиа", "индия", "india",
    "джулиэт", "джульет", "juliet", "juliett",
    "кило", "kilo",
    "лима", "lima",
    "майк", "mike",
    "новембер", "новэмбэр", "november",
    "оскар", "oscar",
    "папа", "papa",
    "квебек", "квэбэк", "quebec",
    "ромео", "ромио", "romeo",
    "сиера", "сиерра", "sierra",
    "танго", "тэнго", "tango",
    "юниформ", "uniform",
    "виктор", "victor",
    "уиски", "виски", "whiskey", "whisky",
    "эксрэй", "экс-рэй", "x-ray", "xray",
    "янки", "yankee",
    "зулу", "zulu",
    # Ham RU traditional names
    "анна", "борис", "василий", "григорий", "дмитрий", "елена", "женя", "зинаида", "иван",
    "константин", "леонид", "михаил", "николай", "ольга", "павел", "роман", "семен", "семён",
    "татьяна", "ульяна", "федор", "фёдор", "харитон", "цапля", "человек", "шура", "щука", "юрий", "яков",
    # Ham EN geographic names
    "america", "америка", "boston", "бостон", "canada", "канада", "denmark", "денмарк",
    "david", "дэвид", "florida", "флорида", "germany", "германия", "honolulu", "гонолулу",
    "italy", "италия", "japan", "япония", "london", "лондон", "mexico", "мексико",
    "norway", "норвегия", "ontario", "онтарио", "pacific", "пасифик", "queen", "квин",
    "radio", "радио", "sugar", "шугар", "tokyo", "токио", "united", "юнайтед",
    "victoria", "виктория", "washington", "вашингтон", "yokohama", "йокогама", "zanzibar", "занзибар",
    # Letter names (RU phonetic transliteration)
    "эй", "би", "си", "ди", "и", "эф", "джи", "эйч", "ай", "джей", "кей", "эл", "эм", "эн",
    "оу", "пи", "кью", "ар", "эс", "ти", "ю", "ви", "дабл-ю", "экс", "уай", "зед"
])

INTRO_WORDS = set([
    "говорит", "здесь", "это", "станция", "прием", "приём", "для", "мы", "на",
    "this", "is", "here", "from", "de", "calling"
])


def _is_callsign_token(token: str, callsign: str = "") -> bool:
    clean = re.sub(r"^<call>|</call>$", "", token.strip(), flags=re.IGNORECASE)
    clean = clean.strip(" ,.:;–-!?\"'()[]{}")
    if not clean:
        return False
    # If hyphenated, all subparts must be callsign-like
    parts = clean.split("-")
    if len(parts) > 1:
        return all(
            p.lower() in CALLSIGN_PHONETIC_WORDS
            or p.isdigit()
            or (p.isascii() and p.isupper() and len(p) <= 4)
            or (callsign and p.lower() == callsign.lower())
            or CALLSIGN_REGEX.fullmatch(p)
            for p in parts if p
        )

    low = clean.lower()
    if low in CALLSIGN_PHONETIC_WORDS or clean.isdigit():
        return True
    if callsign and low == callsign.lower():
        return True
    if CALLSIGN_REGEX.fullmatch(clean):
        return True
    # Uppercase ASCII code e.g. 'GY', 'DPN' or single uppercase Latin letter
    if clean.isascii() and clean.isupper() and len(clean) <= 4:
        return True
    return False


def clean_display_text(text: str, callsign: str = "") -> str:
    """
    Cleans caption display text for on-screen VFO card and CallLog:
    - Removes spelled-out phonetic callsign words (e.g. 'Девять-Генри-Один...', '9 Отель 1, GY')
    - Removes leading callsign mentions (e.g. '<call>9H1GY</call>:', '9H1GY,')
    - Removes radio preamble before callsigns (e.g. 'Говорит, ...', 'This is ...', 'Здесь ...')
    - Preserves meaningful message text. If the entire message was ONLY a callsign,
      falls back to cleanly formatted callsign.
    """
    if not text or not text.strip():
        return ""

    original = text.strip()

    # Step 1: Tokenize by whitespace and punctuation, keeping track of spans
    token_pattern = re.compile(r"(<call>[^<]*</call>|[^\s,.:;–\-!?\"'()\[\]{}]+)")
    matches = list(token_pattern.finditer(original))
    if not matches:
        return original

    # Find how many tokens at the start form a callsign / phonetic preamble
    cut_index = 0
    consecutive_callsign_tokens = 0
    saw_real_callsign_or_phonetic = False

    for i, m in enumerate(matches):
        tok = m.group(0)
        low_tok = tok.lower().strip(" ,.:;–-")

        if _is_callsign_token(tok, callsign):
            consecutive_callsign_tokens += 1
            if low_tok in CALLSIGN_PHONETIC_WORDS or CALLSIGN_REGEX.fullmatch(low_tok) or (callsign and low_tok == callsign.lower()):
                saw_real_callsign_or_phonetic = True
            cut_index = m.end()
        elif low_tok in INTRO_WORDS and consecutive_callsign_tokens < 6:
            # An intro word like "это", "здесь", "мы", "на" is accepted only if followed by callsign tokens
            if i + 1 < len(matches) and _is_callsign_token(matches[i+1].group(0), callsign):
                cut_index = m.end()
            else:
                break
        else:
            # First non-callsign, non-intro token encountered
            break

    # If we found at least 2 consecutive callsign tokens (or 1 explicit callsign / tag) at the start:
    if (consecutive_callsign_tokens >= 2 or saw_real_callsign_or_phonetic) and cut_index > 0:
        remaining = original[cut_index:].lstrip(" ,.:;–-").rstrip()
        if remaining:
            return remaining[0].upper() + remaining[1:]
        else:
            # Entire message was the callsign
            if callsign and callsign not in ("---", "UNKNOWN", "DMR") and not callsign.startswith("ID "):
                return f"<call>{callsign}</call>"
            return original

    # Step 2: Strip any standalone leading <call>...</call> tag or explicit callsign
    s = original
    s = re.sub(r"^(?:<call>[^<]*</call>[\s,:;–-]*)+", "", s, flags=re.IGNORECASE)
    if callsign and isinstance(callsign, str):
        cs = callsign.strip()
        if cs and cs not in ("---", "UNKNOWN", "DMR") and not cs.startswith("ID "):
            s = re.sub(rf"^(?:{re.escape(cs)}[\s,:;–-]*)+", "", s, flags=re.IGNORECASE)
    s = re.sub(r"^[\s,:;–\.-]+", "", s).rstrip()

    if s:
        return s[0].upper() + s[1:]
    return original


def strip_callsigns_for_tts(text: str, callsign: str = "") -> str:
    """
    Completely removes all auto-detected amateur radio callsigns from text before TTS:
    1. Removes all <call>...</call> tags and their contents.
    2. Removes explicit callsign from DMR metadata (if provided).
    3. Removes any remaining amateur radio callsigns matching CALLSIGN_REGEX.
    4. Cleans up dangling punctuation, colons, commas and extra spaces.
    """
    if not text:
        return ""

    # 0. Strip leading phonetic / spelled-out callsigns
    text = clean_display_text(text, callsign=callsign)

    # 1. Strip <call>...</call> tags and their contents
    text = re.sub(r"<call>[^<]*</call>", " ", text, flags=re.IGNORECASE)

    # 2. Strip explicit callsign if provided (e.g. from DMR metadata)
    if callsign and isinstance(callsign, str):
        cs = callsign.strip().upper()
        if cs and cs not in ("---", "UNKNOWN", "DMR") and not cs.startswith("ID "):
            text = re.sub(rf"\b{re.escape(cs)}\b", " ", text, flags=re.IGNORECASE)

    # 3. Strip any residual standard radio callsigns
    def _strip_cs(m):
        raw = m.group(0)
        if any(c.isalpha() for c in raw) and any(c.isdigit() for c in raw):
            return " "
        return raw

    text = CALLSIGN_REGEX.sub(_strip_cs, text)

    # 4. Clean up dangling/duplicate punctuation and spacing
    text = re.sub(r"\s+([,.:;!?])", r"\1", text)
    text = re.sub(r"[,:;–-]\s*([,.:;!?])", r"\1", text)
    text = re.sub(r"[,:;–-]{2,}", ",", text)
    text = re.sub(r"^[\s,:;–-]+", "", text)
    text = re.sub(r"[\s,:;–-]+$", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def filter_hesitation_fillers(text: str) -> str:
    """
    Filters out standalone hesitation interjections / filler sounds
    such as 'э', 'Э', 'э-э', 'Э-э', 'э-Э', 'Э-Э' (including dashes, hyphens,
    stress marks '+' or combining acute accents), without affecting any legitimate
    words containing or starting with 'э' (e.g. 'это', 'эхо', 'мэр', 'дуэт', 'экран').

    Cleans up surrounding punctuation (commas, spaces, colons, ellipses) and restores
    correct sentence-initial capitalization.
    """
    if not text:
        return ""

    # Matches standalone 'э', 'э-э', 'э-э-э' with any combination of upper/lowercase,
    # hyphens, en-dashes, em-dashes, and '+' or acute stress marks.
    filler_re = (
        r"(?<![а-яёА-ЯЁa-zA-Z0-9_])(?<![а-яёА-ЯЁa-zA-Z0-9_][-–—])"
        r"\+?[эЭ]\u0301?(?:[-–—]\+?[эЭ]\u0301?)*"
        r"(?![а-яёА-ЯЁa-zA-Z0-9_])(?!(?:[-–—][а-яёА-ЯЁa-zA-Z0-9_]))"
    )

    # 1. Clean up fillers set off by commas in sentence middle: ', э, ' -> ', '
    text = re.sub(rf",\s*{filler_re}\s*,", ",", text)

    # 2. Remove all remaining instances of the filler pattern
    text = re.sub(filler_re, "", text)

    # 3. Clean up punctuation artifacts left behind:
    text = re.sub(r",\s*(\.{2,})", r"\1", text)
    text = re.sub(r"(\.{2,})\s*,", r"\1", text)
    text = re.sub(r",\s*,+", ",", text)
    text = re.sub(r",\s*([.!?])", r"\1", text)
    text = re.sub(r":\s*,+", ": ", text)
    text = re.sub(r"^(<call>[^<]*</call>:\s*)[\s,–\-\.]+", r"\1", text)
    text = re.sub(r"^[\s,–\-\.]+", "", text)
    text = re.sub(r"([.!?]\s*)[,–\-]+\s*", r"\1", text)
    text = re.sub(r"[\s,–\-]+$", "", text)
    text = re.sub(r"\s+", " ", text).strip()

    # If nothing remains or only call tag / punctuation remains:
    clean_check = re.sub(r"<call>[^<]*</call>", "", text)
    if not re.search(r"[а-яёА-ЯЁa-zA-Z0-9]", clean_check):
        return ""

    # 4. Capitalize first letter of sentence if it was lowercase
    def cap_first(m):
        prefix = m.group(1) or ""
        ch = m.group(2)
        return prefix + ch.upper()

    text = re.sub(r"^((?:<call>[^<]*</call>:\s*)?[\"«\'“]?\+?)([а-яёєіїa-z])", cap_first, text)
    text = re.sub(r"([.!?]\s+[\"«\'“]?\+?)([а-яёєіїa-z])", lambda m: m.group(1) + m.group(2).upper(), text)

    return text



ONES_RU_M = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
ONES_RU_F = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"]
TEENS_RU = [
    "десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать",
    "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"
]
TENS_RU = [
    "", "", "двадцать", "тридцать", "сорок", "пятьдесят",
    "шестьдесят", "семьдесят", "восемьдесят", "девяносто"
]
HUNDREDS_RU = [
    "", "сто", "двести", "триста", "четыреста", "пятьсот",
    "шестьсот", "семьсот", "восемьсот", "девятьсот"
]

ONES_UK_M = ["", "один", "два", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"]
ONES_UK_F = ["", "одна", "дві", "три", "чотири", "п'ять", "шість", "сім", "вісім", "дев'ять"]
TEENS_UK = [
    "десять", "одинадцять", "дванадцять", "тринадцять", "чотирнадцять",
    "п'ятнадцять", "шістнадцять", "сімнадцять", "вісімнадцять", "дев'ятнадцять"
]
TENS_UK = [
    "", "", "двадцять", "тридцять", "сорок", "п'ятдесят",
    "шістдесят", "сімдесят", "вісімдесят", "дев'яносто"
]
HUNDREDS_UK = [
    "", "сто", "двісті", "триста", "чотириста", "п'ятсот",
    "шістсот", "сімсот", "вісімсот", "дев'ятсот"
]


def int_to_words_ru(n: int, gender: str = "m") -> str:
    """Converts integer 0..999_999_999 into Russian words."""
    if n == 0:
        return "ноль"
    if n < 0:
        return "минус " + int_to_words_ru(-n, gender)
    parts = []
    # Billions
    billions = (n // 1_000_000_000) % 1_000
    if billions > 0:
        b_words = _triad_to_words_ru(billions, gender="m")
        rem = billions % 10
        rem100 = billions % 100
        if 11 <= rem100 <= 19 or rem in (0, 5, 6, 7, 8, 9):
            b_suffix = "миллиардов"
        elif rem == 1:
            b_suffix = "миллиард"
        else:
            b_suffix = "миллиарда"
        parts.append(f"{b_words} {b_suffix}")
    # Millions
    millions = (n // 1_000_000) % 1_000
    if millions > 0:
        m_words = _triad_to_words_ru(millions, gender="m")
        rem = millions % 10
        rem100 = millions % 100
        if 11 <= rem100 <= 19 or rem in (0, 5, 6, 7, 8, 9):
            m_suffix = "миллионов"
        elif rem == 1:
            m_suffix = "миллион"
        else:
            m_suffix = "миллиона"
        parts.append(f"{m_words} {m_suffix}")
    # Thousands
    thousands = (n // 1_000) % 1_000
    if thousands > 0:
        t_words = _triad_to_words_ru(thousands, gender="f")
        rem = thousands % 10
        rem100 = thousands % 100
        if 11 <= rem100 <= 19 or rem in (0, 5, 6, 7, 8, 9):
            t_suffix = "тысяч"
        elif rem == 1:
            t_suffix = "тысяча"
        else:
            t_suffix = "тысячи"
        parts.append(f"{t_words} {t_suffix}")
    # Units
    units = n % 1_000
    if units > 0:
        u_words = _triad_to_words_ru(units, gender=gender)
        parts.append(u_words)
    return " ".join(parts).strip()


def _triad_to_words_ru(t: int, gender: str = "m") -> str:
    res = []
    h = t // 100
    rem = t % 100
    if h > 0:
        res.append(HUNDREDS_RU[h])
    if 10 <= rem <= 19:
        res.append(TEENS_RU[rem - 10])
    else:
        tens = rem // 10
        ones = rem % 10
        if tens > 0:
            res.append(TENS_RU[tens])
        if ones > 0:
            res.append(ONES_RU_F[ones] if gender == "f" else ONES_RU_M[ones])
    return " ".join(res).strip()


def int_to_words_uk(n: int, gender: str = "m") -> str:
    """Converts integer 0..999_999_999 into Ukrainian words."""
    if n == 0:
        return "нуль"
    if n < 0:
        return "мінус " + int_to_words_uk(-n, gender)
    parts = []
    billions = (n // 1_000_000_000) % 1_000
    if billions > 0:
        b_words = _triad_to_words_uk(billions, gender="m")
        rem = billions % 10
        rem100 = billions % 100
        if 11 <= rem100 <= 19 or rem in (0, 5, 6, 7, 8, 9):
            b_suffix = "мільярдів"
        elif rem == 1:
            b_suffix = "мільярд"
        else:
            b_suffix = "мільярди"
        parts.append(f"{b_words} {b_suffix}")
    millions = (n // 1_000_000) % 1_000
    if millions > 0:
        m_words = _triad_to_words_uk(millions, gender="m")
        rem = millions % 10
        rem100 = millions % 100
        if 11 <= rem100 <= 19 or rem in (0, 5, 6, 7, 8, 9):
            m_suffix = "мільйонів"
        elif rem == 1:
            m_suffix = "мільйон"
        else:
            m_suffix = "мільйони"
        parts.append(f"{m_words} {m_suffix}")
    thousands = (n // 1_000) % 1_000
    if thousands > 0:
        t_words = _triad_to_words_uk(thousands, gender="f")
        rem = thousands % 10
        rem100 = thousands % 100
        if 11 <= rem100 <= 19 or rem in (0, 5, 6, 7, 8, 9):
            t_suffix = "тисяч"
        elif rem == 1:
            t_suffix = "тисяча"
        else:
            t_suffix = "тисячі"
        parts.append(f"{t_words} {t_suffix}")
    units = n % 1_000
    if units > 0:
        u_words = _triad_to_words_uk(units, gender=gender)
        parts.append(u_words)
    return " ".join(parts).strip()


def _triad_to_words_uk(t: int, gender: str = "m") -> str:
    res = []
    h = t // 100
    rem = t % 100
    if h > 0:
        res.append(HUNDREDS_UK[h])
    if 10 <= rem <= 19:
        res.append(TEENS_UK[rem - 10])
    else:
        tens = rem // 10
        ones = rem % 10
        if tens > 0:
            res.append(TENS_UK[tens])
        if ones > 0:
            res.append(ONES_UK_F[ones] if gender == "f" else ONES_UK_M[ones])
    return " ".join(res).strip()


def get_declension(n: int, one: str, few: str, many: str) -> str:
    n = abs(n) % 100
    if 11 <= n <= 19:
        return many
    rem = n % 10
    if rem == 1:
        return one
    if rem in (2, 3, 4):
        return few
    return many


def get_declension_uk(n: int, one: str, few: str, many: str) -> str:
    n = abs(n) % 100
    if 11 <= n <= 19:
        return many
    rem = n % 10
    if rem == 1:
        return one
    if rem in (2, 3, 4):
        return few
    return many


def verbalize_time_ru(match: re.Match) -> str:
    h_str = match.group(1)
    m_str = match.group(2)
    s_str = match.group(3) if len(match.groups()) >= 3 and match.group(3) else None
    try:
        h = int(h_str)
        m = int(m_str)
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return match.group(0)
    except ValueError:
        return match.group(0)

    h_word = int_to_words_ru(h)
    if m == 0:
        m_word = "ноль ноль"
    elif m < 10:
        m_word = f"ноль {int_to_words_ru(m)}"
    else:
        m_word = int_to_words_ru(m)

    res = f"{h_word} {m_word}"
    if s_str:
        try:
            s = int(s_str)
            if 0 <= s <= 59:
                s_word = "ноль ноль" if s == 0 else (f"ноль {int_to_words_ru(s)}" if s < 10 else int_to_words_ru(s))
                res += f" {s_word}"
        except ValueError:
            pass
    return res


def verbalize_time_uk(match: re.Match) -> str:
    h_str = match.group(1)
    m_str = match.group(2)
    s_str = match.group(3) if len(match.groups()) >= 3 and match.group(3) else None
    try:
        h = int(h_str)
        m = int(m_str)
        if not (0 <= h <= 23 and 0 <= m <= 59):
            return match.group(0)
    except ValueError:
        return match.group(0)

    h_word = int_to_words_uk(h)
    if m == 0:
        m_word = "нуль нуль"
    elif m < 10:
        m_word = f"нуль {int_to_words_uk(m)}"
    else:
        m_word = int_to_words_uk(m)

    res = f"{h_word} {m_word}"
    if s_str:
        try:
            s = int(s_str)
            if 0 <= s <= 59:
                s_word = "нуль нуль" if s == 0 else (f"нуль {int_to_words_uk(s)}" if s < 10 else int_to_words_uk(s))
                res += f" {s_word}"
        except ValueError:
            pass
    return res


ORDINALS_RU_DICT = {
    "1-й": "первый", "1-го": "первого", "1-му": "первому", "1-м": "первом", "1-я": "первая", "1-ой": "первой", "1-е": "первое", "1-ю": "первую",
    "2-й": "второй", "2-го": "второго", "2-му": "второму", "2-м": "втором", "2-я": "вторая", "2-ой": "второй", "2-е": "второе", "2-ю": "вторую",
    "3-й": "третий", "3-го": "третьего", "3-му": "третьему", "3-м": "третьем", "3-я": "третья", "3-ей": "третьей", "3-е": "третье", "3-ю": "третью",
    "4-й": "четвёртый", "4-го": "четвёртого", "4-му": "четвёртому", "4-м": "четвёртом", "4-я": "четвёртая", "4-е": "четвёртое", "4-ю": "четвёртую",
    "5-й": "пятый", "5-го": "пятого", "5-му": "пятому", "5-м": "пятом", "5-я": "пятая", "5-е": "пятое",
    "6-й": "шестой", "6-го": "шестого", "7-й": "седьмой", "7-го": "седьмого",
    "8-й": "восьмой", "8-го": "восьмого", "9-й": "девятый", "9-го": "девятого",
    "10-й": "десятый", "10-го": "десятого"
}

ORDINALS_UK_DICT = {
    "1-й": "перший", "1-го": "першого", "1-му": "першому", "1-м": "першому", "1-а": "перша", "1-е": "перше", "1-у": "першу",
    "2-й": "другий", "2-го": "другого", "2-му": "другому", "2-м": "другому", "2-а": "друга", "2-е": "друге", "2-у": "другу",
    "3-й": "третій", "3-го": "третього", "3-му": "третьому", "3-м": "третьому", "3-я": "третя", "3-є": "третє", "3-ю": "третю",
    "4-й": "четвертий", "4-го": "четвертого", "4-му": "четвертому", "4-а": "четверта",
    "5-й": "п'ятий", "5-го": "п'ятого", "5-му": "п'ятому", "5-а": "п'ята",
    "6-й": "шостий", "6-го": "шостого", "7-й": "сьомий", "7-го": "сьомого",
    "8-й": "восьмий", "8-го": "восьмого", "9-й": "дев'ятий", "9-го": "дев'ятого",
    "10-й": "десятий", "10-го": "десятого"
}


def verbalize_symbols_and_numbers_ru(text: str) -> str:
    """
    Verbalizes all unpronounceable characters, time notations,
    currencies, percentages, units and numbers into natural spoken Russian words.
    """
    if not text:
        return ""

    # 1. Email addresses: e.g. user@domain.com -> user собака domain точка com
    def _sub_email(m):
        u = m.group(1)
        d = m.group(2)
        d_clean = d.replace(".", " точка ")
        return f"{u} собака {d_clean}"
    text = re.sub(r"\b([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b", _sub_email, text)

    # 2. Web domains (.com, .ru, .org, .net, etc.)
    text = re.sub(r"\b([a-zA-Z0-9-]+)\.(ru|com|org|net|de|ua|su|io|me|info|biz)\b", r"\1 точка \2", text, flags=re.IGNORECASE)

    # 3. Mention / handle @User and standalone @
    text = re.sub(r"(?<!\w)@([a-zA-Z0-9_а-яёА-ЯЁ]+)", r"собачка \1", text)
    text = text.replace("@", " собачка ")

    # 4. Time expressions: HH:MM:SS or HH:MM (e.g. 4:36, 15:00, 23:59:15)
    text = re.sub(r"(?<!\d\.)\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b(?!\.\d)", verbalize_time_ru, text)

    # 5. Temperature: +20°C, -5°C, 25°
    def _sub_temp(m):
        sign = m.group(1) or ""
        val = int(m.group(2))
        unit = m.group(3) or ""
        sign_word = "плюс " if sign == "+" else ("минус " if sign in ("-", "–", "—") else "")
        val_word = int_to_words_ru(val)
        decl = get_declension(val, "градус", "градуса", "градусов")
        cels = " Цельсия" if "c" in unit.lower() or "с" in unit.lower() else ""
        return f"{sign_word}{val_word} {decl}{cels}"
    text = re.sub(r"([+-–—])?(\d+)\s*°\s*([cCсС])?", _sub_temp, text)

    # 6. Percentages: 50%, 21%
    def _sub_percent(m):
        val = int(m.group(1))
        val_word = int_to_words_ru(val)
        decl = get_declension(val, "процент", "процента", "процентов")
        return f"{val_word} {decl}"
    text = re.sub(r"\b(\d+)\s*%", _sub_percent, text)

    # 7. Currencies: $100, 100$, 50€, 5000₽
    def _sub_currency_dollar(m):
        val = int(m.group(1))
        val_word = int_to_words_ru(val)
        decl = get_declension(val, "доллар", "доллара", "долларов")
        return f"{val_word} {decl}"
    text = re.sub(r"\$\s*(\d+)\b", _sub_currency_dollar, text)
    text = re.sub(r"\b(\d+)\s*\$", _sub_currency_dollar, text)

    def _sub_currency_euro(m):
        val = int(m.group(1))
        val_word = int_to_words_ru(val)
        return f"{val_word} евро"
    text = re.sub(r"€\s*(\d+)\b", _sub_currency_euro, text)
    text = re.sub(r"\b(\d+)\s*€", _sub_currency_euro, text)

    def _sub_currency_ruble(m):
        val = int(m.group(1))
        val_word = int_to_words_ru(val)
        decl = get_declension(val, "рубль", "рубля", "рублей")
        return f"{val_word} {decl}"
    text = re.sub(r"[₽]\s*(\d+)\b", _sub_currency_ruble, text)
    text = re.sub(r"\b(\d+)\s*[₽]", _sub_currency_ruble, text)
    text = re.sub(r"\b(\d+)\s*(?:руб\.|рублей|рубля|рубль)\b", _sub_currency_ruble, text)

    # 8. Units of measurement
    text = re.sub(r"\b(\d+)\s*(?:км/ч|км/час|km/h)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} километров в час", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(\d+)\s*(?:м/с|м/сек|m/s)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} метров в секунду", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(\d+)\s*(?:кВт|квт|kW)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} киловатт", text)
    text = re.sub(r"\b(\d+)\s*(?:Вт|вт|W)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} ватт", text)
    text = re.sub(r"\b(\d+)\s*(?:В|вольт|V)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} вольт", text)
    text = re.sub(r"\b(\d+)\s*(?:А|ампер|A)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} ампер", text)
    text = re.sub(r"\b(\d+)\s*(?:Ом|ом)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} ом", text)
    text = re.sub(r"\b(\d+)\s*(?:дБ|dB|дб)\b", lambda m: f"{int_to_words_ru(int(m.group(1)))} децибел", text)

    # 9. Number symbols № and #
    text = re.sub(r"[№#]\s*(\d+)", lambda m: f"номер {int_to_words_ru(int(m.group(1)))}", text)
    text = re.sub(r"#([a-zA-Zа-яёА-ЯЁ0-9_]+)", r"хэштег \1", text)
    text = text.replace("№", " номер ")
    text = text.replace("#", " номер ")

    # 10. Math & special symbols
    text = re.sub(r"&", " и ", text)
    text = re.sub(r"~", " примерно ", text)
    text = re.sub(r"\*", " звёздочка ", text)
    text = re.sub(r"=", " равно ", text)
    text = re.sub(r"±", " плюс-минус ", text)
    # Math plus/minus between words/numbers (preserve +stressmarks: +followed by Cyrillic vowel)
    text = re.sub(r"(?<=\d|\w)\s*\+(?![аеёєиіїоуыэюяАЕЁЄИІЇОУЫЭЮЯ])\s*(?=\d|\w)", " плюс ", text)
    text = re.sub(r"(?<=\d)\s*-\s*(?=\d)", " минус ", text)

    # 11. Ordinals with hyphens
    for ord_num, word in ORDINALS_RU_DICT.items():
        text = re.sub(rf"\b{re.escape(ord_num)}\b", word, text, flags=re.IGNORECASE)

    # 12. Decimal numbers: 3.5, 0.5
    def _sub_decimal(m):
        whole = int_to_words_ru(int(m.group(1)))
        frac = int_to_words_ru(int(m.group(2)))
        return f"{whole} точка {frac}"
    text = re.sub(r"\b(\d+)[.,](\d+)\b", _sub_decimal, text)

    # 13. Remaining standalone integers: 4, 36, 100, 2501
    def _sub_int(m):
        val = int(m.group(0))
        if val <= 999_999_999:
            return int_to_words_ru(val)
        return m.group(0)
    text = re.sub(r"\b\d+\b", _sub_int, text)

    # 14. Clean up formatting
    text = re.sub(r"[<>{}\[\]_|\\]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def verbalize_symbols_and_numbers_uk(text: str) -> str:
    """
    Verbalizes all unpronounceable characters, time notations,
    currencies, percentages, units and numbers into natural spoken Ukrainian words.
    """
    if not text:
        return ""

    # 1. Email addresses
    def _sub_email(m):
        u = m.group(1)
        d = m.group(2)
        d_clean = d.replace(".", " крапка ")
        return f"{u} собачка {d_clean}"
    text = re.sub(r"\b([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b", _sub_email, text)

    # 2. Web domains
    text = re.sub(r"\b([a-zA-Z0-9-]+)\.(ua|com|org|net|de|ru|io|info)\b", r"\1 крапка \2", text, flags=re.IGNORECASE)

    # 3. Mention / handle @User
    text = re.sub(r"(?<!\w)@([a-zA-Z0-9_а-яєіїА-ЯЄІЇ]+)", r"собачка \1", text)
    text = text.replace("@", " собачка ")

    # 4. Time: HH:MM
    text = re.sub(r"(?<!\d\.)\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b(?!\.\d)", verbalize_time_uk, text)

    # 5. Temperature
    def _sub_temp(m):
        sign = m.group(1) or ""
        val = int(m.group(2))
        unit = m.group(3) or ""
        sign_word = "плюс " if sign == "+" else ("мінус " if sign in ("-", "–", "—") else "")
        val_word = int_to_words_uk(val)
        decl = get_declension_uk(val, "градус", "градуси", "градусів")
        cels = " Цельсія" if "c" in unit.lower() or "с" in unit.lower() else ""
        return f"{sign_word}{val_word} {decl}{cels}"
    text = re.sub(r"([+-–—])?(\d+)\s*°\s*([cCсС])?", _sub_temp, text)

    # 6. Percentages
    def _sub_percent(m):
        val = int(m.group(1))
        val_word = int_to_words_uk(val)
        decl = get_declension_uk(val, "відсоток", "відсотки", "відсотків")
        return f"{val_word} {decl}"
    text = re.sub(r"\b(\d+)\s*%", _sub_percent, text)

    # 7. Currencies: $, €, ₴
    text = re.sub(r"\$\s*(\d+)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} доларів", text)
    text = re.sub(r"\b(\d+)\s*\$", lambda m: f"{int_to_words_uk(int(m.group(1)))} доларів", text)
    text = re.sub(r"€\s*(\d+)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} євро", text)
    text = re.sub(r"\b(\d+)\s*€", lambda m: f"{int_to_words_uk(int(m.group(1)))} євро", text)
    text = re.sub(r"[₴]\s*(\d+)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} гривень", text)
    text = re.sub(r"\b(\d+)\s*[₴]", lambda m: f"{int_to_words_uk(int(m.group(1)))} гривень", text)
    text = re.sub(r"\b(\d+)\s*(?:грн\.|гривень|гривні|гривня)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} гривень", text)

    # 8. Units
    text = re.sub(r"\b(\d+)\s*(?:км/год|km/h)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} кілометрів на годину", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(\d+)\s*(?:м/с|m/s)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} метрів на секунду", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(\d+)\s*(?:кВт|kW)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} кіловат", text)
    text = re.sub(r"\b(\d+)\s*(?:Вт|W)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} ват", text)
    text = re.sub(r"\b(\d+)\s*(?:В|V)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} вольт", text)
    text = re.sub(r"\b(\d+)\s*(?:А|A)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} ампер", text)
    text = re.sub(r"\b(\d+)\s*(?:дБ|dB)\b", lambda m: f"{int_to_words_uk(int(m.group(1)))} децибел", text)

    # 9. Number symbols
    text = re.sub(r"[№#]\s*(\d+)", lambda m: f"номер {int_to_words_uk(int(m.group(1)))}", text)
    text = text.replace("№", " номер ")
    text = text.replace("#", " номер ")

    # 10. Math & special symbols
    text = re.sub(r"&", " і ", text)
    text = re.sub(r"~", " приблизно ", text)
    text = re.sub(r"\*", " зірочка ", text)
    text = re.sub(r"=", " дорівнює ", text)
    text = re.sub(r"±", " плюс-мінус ", text)
    text = re.sub(r"(?<=\d|\w)\s*\+(?![аеєиіїоуюяАЕЄИІЇОУЮЯ])\s*(?=\d|\w)", " плюс ", text)
    text = re.sub(r"(?<=\d)\s*-\s*(?=\d)", " мінус ", text)

    # 11. Ordinals
    for ord_num, word in ORDINALS_UK_DICT.items():
        text = re.sub(rf"\b{re.escape(ord_num)}\b", word, text, flags=re.IGNORECASE)

    # 12. Decimal numbers
    def _sub_decimal_uk(m):
        whole = int_to_words_uk(int(m.group(1)))
        frac = int_to_words_uk(int(m.group(2)))
        return f"{whole} крапка {frac}"
    text = re.sub(r"\b(\d+)[.,](\d+)\b", _sub_decimal_uk, text)

    # 13. Remaining integers
    def _sub_int_uk(m):
        val = int(m.group(0))
        if val <= 999_999_999:
            return int_to_words_uk(val)
        return m.group(0)
    text = re.sub(r"\b\d+\b", _sub_int_uk, text)

    # 14. Clean up
    text = re.sub(r"[<>{}\[\]_|\\]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_for_russian_tts(text: str, strip_callsigns: bool = False, callsign: str = "") -> str:
    """
    Full text normalization for Russian speech synthesis:
    1. Filters hesitation fillers ('э', 'э-э').
    2. Strips callsigns if strip_callsigns=True, otherwise transcribes them phonetically.
    3. Replaces amateur radio abbreviations and Q-codes.
    4. Converts radio etiquette numbers (73 -> 'Семьдесят три', 88 -> 'Восемьдесят восемь').
    5. Expands frequency units (MHz -> мегагерц, kHz -> килогерц).
    """
    if not text:
        return ""

    text = filter_hesitation_fillers(text)
    if not text:
        return ""

    if strip_callsigns:
        text = strip_callsigns_for_tts(text, callsign=callsign)
    else:
        # Strip just the <call> tags if wrapping callsign to let phoneticizer or callsign parser see it
        # but if <call>TAG</call> is present, unpack to TAG
        text = re.sub(r"<call>([^<]*)</call>", r"\1", text, flags=re.IGNORECASE)

    # Normalize frequency notations (e.g. 14.150 MHz, 433.500 МГц, 145 MHz)
    def repl_freq(m):
        val = m.group(1).replace(".", " точка ").replace(",", " точка ")
        unit = m.group(2).lower()
        unit_str = "мегагерц" if "m" in unit or "м" in unit else "килогерц"
        return f"{val} {unit_str}"

    text = re.sub(
        r"\b(\d+(?:[.,]\d+)?)\s*(MHz|МГц|kHz|кГц)\b",
        repl_freq,
        text,
        flags=re.IGNORECASE
    )

    # Replace standalone radio etiquette greetings: 73 and 88
    # Match 73 or 88 with word boundaries or punctuation
    text = re.sub(r"(?<!\d)73(?!\d)", "Семьдесят три", text)
    text = re.sub(r"(?<!\d)88(?!\d)", "Восемьдесят восемь", text)

    # Replace signal report RST 59 / 599
    text = re.sub(r"\b(?:RST\s*)?599\b", "пять девять девять", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:RST\s*)?59\b", "пять девять", text, flags=re.IGNORECASE)

    # Replace Q-codes and radio abbreviations (longest first)
    sorted_q_codes = sorted(Q_CODES_AND_ABBREVIATIONS_RU.keys(), key=len, reverse=True)
    for code in sorted_q_codes:
        phonetic = Q_CODES_AND_ABBREVIATIONS_RU[code]
        # Match case-insensitively with word boundaries
        pattern = r"\b" + re.escape(code) + r"\b"
        text = re.sub(pattern, phonetic, text, flags=re.IGNORECASE)

    # Detect and replace callsigns with ICAO/ITU phonetic letters if not stripped
    if not strip_callsigns:
        def repl_callsign(match):
            raw_call = match.group(0)
            # Verify it has at least one letter and one digit
            if any(c.isalpha() for c in raw_call) and any(c.isdigit() for c in raw_call):
                return normalize_callsign_ru(raw_call)
            return raw_call

        text = CALLSIGN_REGEX.sub(repl_callsign, text)

    # Verbalize numbers, time expressions, currencies, percentages, symbols, and units in Russian
    text = verbalize_symbols_and_numbers_ru(text)

    # Transliterate any remaining Latin script words into Cyrillic phonetics
    text = transliterate_latin_to_cyrillic(text)

    # Clean up excess spaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_for_ukrainian_tts(text: str, strip_callsigns: bool = False, callsign: str = "") -> str:
    """
    Full text normalization for Ukrainian speech synthesis.
    """
    if not text:
        return ""

    text = filter_hesitation_fillers(text)
    if not text:
        return ""

    if strip_callsigns:
        text = strip_callsigns_for_tts(text, callsign=callsign)
    else:
        text = re.sub(r"<call>([^<]*)</call>", r"\1", text, flags=re.IGNORECASE)

    # Normalize frequency notations
    text = re.sub(
        r"\b(\d+(?:[.,]\d+)?)\s*(MHz|МГц)\b",
        lambda m: f"{m.group(1).replace('.', ' крапка ')} мегагерц",
        text,
        flags=re.IGNORECASE
    )
    text = re.sub(
        r"\b(\d+(?:[.,]\d+)?)\s*(kHz|кГц)\b",
        lambda m: f"{m.group(1).replace('.', ' крапка ')} кілогерц",
        text,
        flags=re.IGNORECASE
    )

    # Standalone radio etiquette greetings: 73 and 88
    text = re.sub(r"(?<!\d)73(?!\d)", "Сімдесят три", text)
    text = re.sub(r"(?<!\d)88(?!\d)", "Вісімдесят вісім", text)

    # Signal report RST 59 / 599
    text = re.sub(r"\b(?:RST\s*)?599\b", "п'ять дев'ять дев'ять", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(?:RST\s*)?59\b", "п'ять дев'ять", text, flags=re.IGNORECASE)

    # Verbalize numbers, time, currencies, percentages, symbols in Ukrainian
    text = verbalize_symbols_and_numbers_uk(text)

    # Transliterate any remaining Latin script words into Cyrillic phonetics
    text = transliterate_latin_to_cyrillic(text)

    # Clean up excess spaces
    text = re.sub(r"\s+", " ", text).strip()
    return text


def verbalize_symbols_and_numbers_multilang(text: str, target_lang: str = "ru") -> str:
    """
    Verbalizes numbers, time, currencies, percentages and symbols into written words
    for speech synthesis in the specified target language (RU, UK, EN, DE, ES, FR, IT, etc.).
    """
    if not text:
        return ""

    clean_lang = (target_lang or "ru").lower().strip()
    if clean_lang in ("none", "auto", ""):
        clean_lang = "ru"
    elif len(clean_lang) > 2:
        clean_lang = clean_lang[:2]

    if clean_lang in ("ru", "rus"):
        return verbalize_symbols_and_numbers_ru(text)
    if clean_lang in ("uk", "ukr", "ua"):
        return verbalize_symbols_and_numbers_uk(text)

    # Helper function to convert integer using num2words
    def _n2w(val: int) -> str:
        if HAVE_NUM2WORDS:
            try:
                return num2words.num2words(val, lang=clean_lang)
            except Exception:
                try:
                    return num2words.num2words(val, lang="en")
                except Exception:
                    return str(val)
        return str(val)

    # 1. Email addresses
    def _sub_email(m):
        u = m.group(1)
        d = m.group(2)
        at_word = "at"
        dot_word = "dot"
        if clean_lang == "de":
            dot_word = "Punkt"
        elif clean_lang == "es":
            at_word = "arroba"
            dot_word = "punto"
        elif clean_lang == "fr":
            at_word = "arobase"
            dot_word = "point"
        elif clean_lang == "it":
            at_word = "chiocciola"
            dot_word = "punto"
        d_clean = d.replace(".", f" {dot_word} ")
        return f"{u} {at_word} {d_clean}"
    text = re.sub(r"\b([a-zA-Z0-9_.+-]+)@([a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+)\b", _sub_email, text)

    # 2. Mentions & standalone @
    at_w = "at"
    if clean_lang == "es": at_w = "arroba"
    elif clean_lang == "fr": at_w = "arobase"
    elif clean_lang == "it": at_w = "chiocciola"
    text = re.sub(r"(?<!\w)@([a-zA-Z0-9_]+)", rf"{at_w} \1", text)
    text = text.replace("@", f" {at_w} ")

    # 3. Time: HH:MM or HH:MM:SS
    def _sub_time(m):
        h = int(m.group(1))
        mins = int(m.group(2))
        h_w = _n2w(h)
        m_w = _n2w(mins) if mins != 0 else ""
        if clean_lang == "en":
            if mins == 0:
                return f"{h_w} o'clock"
            if mins < 10:
                return f"{h_w} oh {_n2w(mins)}"
            return f"{h_w} {m_w}"
        elif clean_lang == "de":
            if mins == 0:
                return f"{h_w} Uhr"
            return f"{h_w} Uhr {m_w}"
        elif clean_lang == "es":
            return f"{h_w} y {m_w}" if mins != 0 else f"{h_w} en punto"
        elif clean_lang == "fr":
            return f"{h_w} heures {m_w}" if mins != 0 else f"{h_w} heures"
        elif clean_lang == "it":
            return f"{h_w} e {m_w}" if mins != 0 else f"{h_w} in punto"
        return f"{h_w} {m_w}".strip()

    text = re.sub(r"(?<!\d\.)\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b(?!\.\d)", _sub_time, text)

    # 4. Percentages: 50%
    pct_w = "percent"
    if clean_lang == "de": pct_w = "Prozent"
    elif clean_lang == "es": pct_w = "por ciento"
    elif clean_lang == "fr": pct_w = "pour cent"
    elif clean_lang == "it": pct_w = "per cento"
    text = re.sub(r"\b(\d+)\s*%", lambda m: f"{_n2w(int(m.group(1)))} {pct_w}", text)

    # 5. Currencies: $, €, ₴, руб
    d_w = "dollars" if clean_lang == "en" else "Dollar" if clean_lang == "de" else "dólares" if clean_lang == "es" else "dollars" if clean_lang == "fr" else "dollari"
    text = re.sub(r"\$\s*(\d+)\b", lambda m: f"{_n2w(int(m.group(1)))} {d_w}", text)
    text = re.sub(r"\b(\d+)\s*\$", lambda m: f"{_n2w(int(m.group(1)))} {d_w}", text)
    text = re.sub(r"\b(\d+)\s*(?:USD|dollars?)\b", lambda m: f"{_n2w(int(m.group(1)))} {d_w}", text, flags=re.IGNORECASE)

    e_w = "euros" if clean_lang in ("en", "es", "fr") else "Euro" if clean_lang == "de" else "euro"
    text = re.sub(r"€\s*(\d+)\b", lambda m: f"{_n2w(int(m.group(1)))} {e_w}", text)
    text = re.sub(r"\b(\d+)\s*€", lambda m: f"{_n2w(int(m.group(1)))} {e_w}", text)
    text = re.sub(r"\b(\d+)\s*(?:EUR|euros?)\b", lambda m: f"{_n2w(int(m.group(1)))} {e_w}", text, flags=re.IGNORECASE)

    hr_w = "hryvnias" if clean_lang == "en" else "Hrywnja" if clean_lang == "de" else "grivnas" if clean_lang in ("es", "it") else "hryvnias"
    text = re.sub(r"[₴]\s*(\d+)\b", lambda m: f"{_n2w(int(m.group(1)))} {hr_w}", text)
    text = re.sub(r"\b(\d+)\s*[₴]", lambda m: f"{_n2w(int(m.group(1)))} {hr_w}", text)
    text = re.sub(r"\b(\d+)\s*(?:UAH|грн\.?|гривен|гривень|гривні|гривня)\b", lambda m: f"{_n2w(int(m.group(1)))} {hr_w}", text, flags=re.IGNORECASE)

    r_w = "rubles" if clean_lang == "en" else "Rubel" if clean_lang == "de" else "rublos" if clean_lang == "es" else "roubles" if clean_lang == "fr" else "rubli"
    text = re.sub(r"[₽]\s*(\d+)\b", lambda m: f"{_n2w(int(m.group(1)))} {r_w}", text)
    text = re.sub(r"\b(\d+)\s*[₽]", lambda m: f"{_n2w(int(m.group(1)))} {r_w}", text)
    text = re.sub(r"\b(\d+)\s*(?:RUB|руб\.?|рублей|рубля)\b", lambda m: f"{_n2w(int(m.group(1)))} {r_w}", text, flags=re.IGNORECASE)

    # 6. Units: dB, kW, W
    db_w = "decibels" if clean_lang == "en" else "Dezibel" if clean_lang == "de" else "decibelios" if clean_lang == "es" else "décibels" if clean_lang == "fr" else "decibel"
    text = re.sub(r"\b(\d+)\s*(?:дБ|dB)\b", lambda m: f"{_n2w(int(m.group(1)))} {db_w}", text)
    text = re.sub(r"\b(\d+)\s*(?:Вт|W|watts?)\b", lambda m: f"{_n2w(int(m.group(1)))} watts", text, flags=re.IGNORECASE)
    text = re.sub(r"\b(\d+)\s*(?:кВт|kW)\b", lambda m: f"{_n2w(int(m.group(1)))} kilowatts", text, flags=re.IGNORECASE)

    # 7. Math & special symbols
    and_w = "and"
    if clean_lang == "de": and_w = "und"
    elif clean_lang == "es": and_w = "y"
    elif clean_lang == "fr": and_w = "et"
    elif clean_lang == "it": and_w = "e"
    text = re.sub(r"&", f" {and_w} ", text)

    plus_w = "plus"
    if clean_lang == "es": plus_w = "más"
    text = re.sub(r"(?<=\d|\w)\s*\+\s*(?=\d|\w)", f" {plus_w} ", text)

    num_w = "number"
    if clean_lang == "de": num_w = "Nummer"
    elif clean_lang == "es": num_w = "número"
    elif clean_lang == "fr": num_w = "numéro"
    elif clean_lang == "it": num_w = "numero"
    text = re.sub(r"[№#]\s*(\d+)", lambda m: f"{num_w} {_n2w(int(m.group(1)))}", text)
    text = text.replace("№", f" {num_w} ").replace("#", f" {num_w} ")

    # 8. Decimals: 15.5 or 15,5
    def _sub_decimal(m):
        w1 = _n2w(int(m.group(1)))
        w2 = _n2w(int(m.group(2)))
        pt_w = "point"
        if clean_lang == "de": pt_w = "Komma"
        elif clean_lang in ("es", "it"): pt_w = "punto"
        elif clean_lang == "fr": pt_w = "virgule"
        return f"{w1} {pt_w} {w2}"
    text = re.sub(r"\b(\d+)[.,](\d+)\b", _sub_decimal, text)

    # 9. Remaining integers: \b\d+\b
    def _sub_remaining_int(m):
        val = int(m.group(0))
        if val <= 999_999_999:
            return _n2w(val)
        return m.group(0)
    text = re.sub(r"\b\d+\b", _sub_remaining_int, text)

    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_text_for_tts(text: str, target_lang: str = "ru", strip_callsigns: bool = False, callsign: str = "") -> str:
    """
    Unified text verbalizer and phonetic normalizer for TTS speech synthesis.
    Converts numbers, time, currencies, percentages, symbols into words in target_lang.
    """
    if not text or not text.strip():
        return ""

    l_code = (target_lang or "ru").lower().strip()
    if l_code in ("none", "auto", ""):
        l_code = "ru"
    elif len(l_code) > 2:
        l_code = l_code[:2]

    if l_code in ("ru", "rus"):
        return normalize_for_russian_tts(text, strip_callsigns=strip_callsigns, callsign=callsign)
    if l_code in ("uk", "ukr", "ua"):
        return normalize_for_ukrainian_tts(text, strip_callsigns=strip_callsigns, callsign=callsign)

    # For other languages:
    text = filter_hesitation_fillers(text)
    if not text:
        return ""

    if strip_callsigns:
        text = strip_callsigns_for_tts(text, callsign=callsign)
    else:
        text = re.sub(r"<call>([^<]*)</call>", r"\1", text, flags=re.IGNORECASE)

    w_73_map = {
        "en": "seventy-three", "de": "dreiundsiebzig", "es": "setenta y tres",
        "fr": "soixante-treize", "it": "settantatré", "pl": "siedemdziesiąt trzy"
    }
    w_88_map = {
        "en": "eighty-eight", "de": "achtundachtzig", "es": "ochenta y ocho",
        "fr": "quatre-vingt-huit", "it": "ottantotto", "pl": "osiemdziesiąt osiem"
    }
    w_73 = w_73_map.get(l_code, "73")
    w_88 = w_88_map.get(l_code, "88")
    text = re.sub(r"(?<!\d)73(?!\d)", w_73, text)
    text = re.sub(r"(?<!\d)88(?!\d)", w_88, text)

    # Signal reports in target language
    d_map_by_lang = {
        "en": {"5": "five", "9": "nine", "4": "four", "3": "three", "2": "two", "1": "one", "6": "six", "7": "seven", "8": "eight"},
        "de": {"5": "fünf", "9": "neun", "4": "vier", "3": "drei", "2": "zwei", "1": "eins", "6": "sechs", "7": "sieben", "8": "acht"},
        "es": {"5": "cinco", "9": "nueve", "4": "cuatro", "3": "tres", "2": "dos", "1": "uno", "6": "seis", "7": "siete", "8": "ocho"},
        "fr": {"5": "cinq", "9": "neuf", "4": "quatre", "3": "trois", "2": "deux", "1": "un", "6": "six", "7": "sept", "8": "huit"},
        "it": {"5": "cinque", "9": "nove", "4": "quattro", "3": "tre", "2": "due", "1": "uno", "6": "sei", "7": "sette", "8": "otto"}
    }
    cur_d_map = d_map_by_lang.get(l_code, d_map_by_lang["en"])
    for r in ["599", "59", "58", "57", "56", "55", "54", "53", "52", "51", "44", "33"]:
        rep_words = "-".join([cur_d_map.get(c, c) for c in r])
        text = re.sub(rf"\b(?:RST\s*)?{r}\b", rep_words, text, flags=re.IGNORECASE)

    # Verbalize numbers, currencies, time, percentages, symbols
    text = verbalize_symbols_and_numbers_multilang(text, target_lang=l_code)

    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([,.:;!?])", r"\1", text)
    text = re.sub(r"^[,.:;!?\s]+", "", text).strip()
    return text


def is_cyrillic(char: str) -> bool:
    if not char:
        return False
    code = ord(char[0])
    return (0x0400 <= code <= 0x04FF) or (0x0500 <= code <= 0x052F)


def is_latin(char: str) -> bool:
    if not char:
        return False
    code = ord(char[0])
    return (0x0041 <= code <= 0x005A) or (0x0061 <= code <= 0x007A) or (0x00C0 <= code <= 0x024F)


# Dictionary of amateur radio equipment, digital software, brands, and common tech terms
HAM_AND_TECH_BRANDS_DICT: Dict[str, str] = {
    # Ham radio brands & equipment
    "anytone": "Энитон",
    "baofeng": "Баофенг",
    "yaesu": "Яесу",
    "icom": "Айком",
    "kenwood": "Кенвуд",
    "motorola": "Моторола",
    "moto": "Мото",
    "retevis": "Ретевис",
    "quansheng": "Куаньшенг",
    "wouxun": "Воксун",
    "tyt": "Ти-Вай-Ти",
    "alinco": "Алинко",
    "hytera": "Хайтера",
    "radioddity": "Радиодити",
    "xiegu": "Сегу",
    "elecraft": "Элекрафт",
    "flexradio": "Флекс-Радио",
    "uniden": "Юниден",
    "aor": "А-О-Эр",

    # Hotspots, protocols & digital ham radio software
    "pi-star": "Пай-Стар",
    "pistar": "Пай-Стар",
    "mmdvm": "Эм-Эм-Ди-Ви-Эм",
    "opengd77": "Опен Джи Ди 77",
    "openrtx": "Опен Эр-Ти-Икс",
    "brandmeister": "Брэндмейстер",
    "freedmr": "Фри Ди-Эм-Эр",
    "tgif": "Ти-Джи-Ай-Эф",
    "d-star": "Ди-Стар",
    "dstar": "Ди-Стар",
    "c4fm": "Си-Фор-Эф-Эм",
    "echolink": "Эхолинк",
    "allstar": "Оллстар",
    "droidstar": "Дроид-Стар",
    "peanut": "Пинат",
    "zello": "Зелло",
    "hotspot": "Хотспот",
    "hot-spot": "хот-спот",
    "nextion": "Некстион",
    "oled": "Олед",
    "simplex": "Симплекс",
    "duplex": "Дуплекс",

    # Mobile, Audio & IT apps
    "dg voice": "Ди Джи Войс",
    "dg-voice": "Ди Джи Войс",
    "dg": "Ди Джи",
    "voice": "Войс",
    "iphone": "Айфон",
    "ipad": "Айпад",
    "ios": "Ай-О-Эс",
    "android": "Андроид",
    "apple": "Эппл",
    "windows": "Виндовс",
    "linux": "Линукс",
    "bluetooth": "Блютуз",
    "wi-fi": "Вай-фай",
    "wifi": "Вай-фай",
    "type-c": "Тайп-Си",
    "micro-usb": "Микро Ю-Эс-Би",
    "usb": "Ю-Эс-Би",
    "raspberry pi": "Распберри Пай",
    "raspberry": "Распберри",
    "orange pi": "Орандж Пай",
    "nanopi": "Нано Пай",
    "telegram": "Телеграм",
    "whatsapp": "Ватсап",
    "youtube": "Ютуб",

    # Radio suffixes & short abbreviations
    "uv": "Ю-Ви",
    "pro": "Про",
    "plus": "Плюс",
    "max": "Макс",
    "mini": "Мини",
    "lite": "Лайт",
    "ultra": "Ультра",
    "george": "Джордж",
    "roger": "роджер",
}

LATIN_TO_RU_MULTI = [
    ("shch", "щ"), ("sch", "щ"),
    ("tion", "шн"),
    ("ight", "айт"),
    ("wi-fi", "вай-фай"), ("wifi", "вайфай"),
    ("roger", "роджер"),
    ("you", "ю"),
    ("ch", "ч"), ("sh", "ш"), ("zh", "ж"), ("kh", "х"),
    ("ts", "тс"), ("tz", "ц"),
    ("ph", "ф"), ("th", "т"), ("ck", "к"), ("qu", "кв"),
    ("ya", "я"), ("ye", "е"), ("yo", "ё"), ("yu", "ю"),
    ("ee", "и"), ("oo", "у"), ("ea", "и"),
    ("ai", "эй"), ("ay", "ей"), ("ey", "ей"),
]

LATIN_TO_RU_SINGLE = {
    "a": "а", "b": "б", "c": "к", "d": "д", "e": "е", "f": "ф", "g": "г",
    "h": "х", "i": "и", "j": "дж", "k": "к", "l": "л", "m": "м", "n": "н",
    "o": "о", "p": "п", "q": "к", "r": "р", "s": "с", "t": "т", "u": "у",
    "v": "в", "w": "в", "x": "кс", "y": "й", "z": "з",
    "ä": "э", "ö": "ё", "ü": "ю", "ß": "сс",
    "é": "е", "è": "е", "ê": "е", "ë": "е",
    "à": "а", "á": "а", "â": "а", "ã": "а",
    "ó": "о", "ò": "о", "ô": "о", "õ": "о",
    "ú": "у", "ù": "у", "û": "у",
    "í": "и", "ì": "и", "î": "и",
    "ñ": "нь", "ç": "с"
}


def transliterate_word_latin_to_cyrillic(word: str) -> str:
    """Phonetically transliterates a single Latin word into natural Russian Cyrillic with soft forms."""
    lw = word.lower()
    if lw in HAM_AND_TECH_BRANDS_DICT:
        repl = HAM_AND_TECH_BRANDS_DICT[lw]
        if word.isupper() and "-" not in repl and " " not in repl and len(word) <= 3:
            return repl.upper()
        if word.islower():
            return repl.lower()
        return repl

    s = lw

    # Suffixes & endings
    s = re.sub(r'ation\b', 'ейшн', s)
    s = re.sub(r'ition\b', 'ишн', s)
    s = re.sub(r'ution\b', 'юшн', s)
    s = re.sub(r'tion\b', 'шн', s)
    s = re.sub(r'sion\b', 'жн', s)
    s = re.sub(r'ture\b', 'чер', s)
    s = re.sub(r'ight\b', 'айт', s)
    s = re.sub(r'ie\b', 'и', s)
    s = re.sub(r'(?<=[bcdfghjklmnpqrstvwxz])y\b', 'и', s)

    # Double consonants before soft vowels
    s = re.sub(r'gg(?=[eiy])', 'дж', s)
    s = re.sub(r'bb', 'б', s)
    s = re.sub(r'dd', 'д', s)
    s = re.sub(r'ff', 'ф', s)
    s = re.sub(r'll', 'л', s)
    s = re.sub(r'mm', 'м', s)
    s = re.sub(r'nn', 'н', s)
    s = re.sub(r'pp', 'п', s)
    s = re.sub(r'rr', 'р', s)
    s = re.sub(r'ss', 'с', s)
    s = re.sub(r'tt', 'т', s)

    # Split digraphs with silent e at word end
    s = re.sub(r'ace\b', 'ейс', s)
    s = re.sub(r'ice\b', 'айс', s)
    s = re.sub(r'ake\b', 'ейк', s)
    s = re.sub(r'ate\b', 'ейт', s)
    s = re.sub(r'ame\b', 'ейм', s)
    s = re.sub(r'ave\b', 'ейв', s)
    s = re.sub(r'ike\b', 'айк', s)
    s = re.sub(r'ite\b', 'айт', s)
    s = re.sub(r'ide\b', 'айд', s)
    s = re.sub(r'ime\b', 'айм', s)
    s = re.sub(r'ine\b', 'айн', s)
    s = re.sub(r'one\b', 'он', s)
    s = re.sub(r'ole\b', 'оул', s)
    s = re.sub(r'ge\b', 'дж', s)
    s = re.sub(r'ce\b', 'с', s)

    multi = [
        ('shch', 'щ'), ('sch', 'щ'),
        ('ch', 'ч'), ('tch', 'ч'),
        ('sh', 'ш'), ('zh', 'ж'), ('kh', 'х'),
        ('ts', 'тс'), ('tz', 'ц'),
        ('ph', 'ф'), ('th', 'т'), ('ck', 'к'), ('qu', 'кв'),
        ('wh', 'в'), ('kn', 'н'), ('wr', 'р'),
        ('ee', 'и'), ('oo', 'у'), ('ea', 'и'),
        ('ai', 'эй'), ('ay', 'ей'), ('ey', 'ей'), ('ei', 'ей'),
        ('oi', 'ой'), ('oy', 'ой'),
        ('ya', 'я'), ('ye', 'е'), ('yo', 'ё'), ('yu', 'ю'),
    ]
    for pat, rep in multi:
        s = s.replace(pat, rep)

    # Soft C / G (мягкая форма: g перед e, i, y -> дж; c перед e, i, y -> с)
    s = re.sub(r'c(?=[eiyеи])', 'с', s)
    s = re.sub(r'g(?=[eiyеи])', 'дж', s)
    s = re.sub(r'c', 'к', s)
    s = re.sub(r'g', 'г', s)
    s = re.sub(r'j', 'дж', s)

    single = {
        'a': 'а', 'b': 'б', 'd': 'д', 'e': 'е', 'f': 'ф',
        'h': 'х', 'i': 'и', 'k': 'к', 'l': 'л', 'm': 'м', 'n': 'н',
        'o': 'о', 'p': 'п', 'q': 'к', 'r': 'р', 's': 'с', 't': 'т', 'u': 'у',
        'v': 'в', 'w': 'в', 'x': 'кс', 'y': 'й', 'z': 'з',
        'ä': 'э', 'ö': 'ё', 'ü': 'ю', 'ß': 'сс',
        'é': 'е', 'è': 'е', 'ê': 'е', 'ë': 'е',
        'à': 'а', 'á': 'а', 'â': 'а', 'ã': 'а',
        'ó': 'о', 'ò': 'о', 'ô': 'о', 'õ': 'о',
        'ú': 'у', 'ù': 'у', 'û': 'у',
        'í': 'и', 'ì': 'и', 'î': 'и',
        'ñ': 'нь', 'ç': 'с'
    }
    out = []
    for char in s:
        out.append(single.get(char, char))
    res = ''.join(out)

    if word.isupper() and len(word) <= 3:
        return res.upper()
    if word.isupper() and len(word) > 3:
        return res.capitalize()
    if word and word[0].isupper():
        return res.capitalize()
    return res


def transliterate_latin_to_cyrillic(text: str) -> str:
    """Transliterates Latin script text into Russian Cyrillic phonetics."""
    if not text:
        return ""

    text_work = text
    # 1. Match multi-word / hyphenated phrases from dictionary first
    for phrase in sorted(HAM_AND_TECH_BRANDS_DICT.keys(), key=len, reverse=True):
        if " " in phrase or "-" in phrase:
            def _sub_phrase(m):
                rep = HAM_AND_TECH_BRANDS_DICT[phrase]
                src = m.group(0)
                if src.isupper():
                    return rep.upper()
                if src.islower():
                    return rep.lower()
                return rep
            text_work = re.sub(rf"\b{re.escape(phrase)}\b", _sub_phrase, text_work, flags=re.IGNORECASE)

    # 2. Transliterate remaining individual Latin words
    def _repl_word(m):
        tok = m.group(0)
        return transliterate_word_latin_to_cyrillic(tok)

    return re.sub(r"[a-zA-Z\u00C0-\u024F]+", _repl_word, text_work)


RU_TO_LATIN_MULTI = [
    ("щ", "shch"), ("ш", "sh"), ("ч", "ch"), ("ж", "zh"), ("х", "kh"),
    ("ц", "ts"), ("ю", "yu"), ("я", "ya"), ("ё", "yo"),
    ("є", "ye"), ("ї", "yi")
]

RU_TO_LATIN_SINGLE = {
    "а": "a", "б": "b", "в": "v", "г": "g", "ґ": "g", "д": "d", "е": "e",
    "з": "z", "и": "i", "і": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "ы": "y", "э": "e", "ь": "", "ъ": ""
}


def transliterate_cyrillic_to_latin(text: str) -> str:
    """Transliterates Cyrillic script text into Latin phonetics."""
    res = []
    i = 0
    n = len(text)
    while i < n:
        matched = False
        lower_sub = text[i:].lower()
        for pattern, repl in RU_TO_LATIN_MULTI:
            if lower_sub.startswith(pattern):
                src_piece = text[i:i + len(pattern)]
                is_all_upper = src_piece.isupper() and (i + len(pattern) >= n or not text[i + len(pattern)].islower())
                if is_all_upper and len(src_piece) > 1:
                    res.append(repl.upper())
                elif src_piece[0].isupper():
                    res.append(repl.capitalize())
                else:
                    res.append(repl)
                i += len(pattern)
                matched = True
                break
        if not matched:
            ch = text[i]
            lower_ch = ch.lower()
            if lower_ch in RU_TO_LATIN_SINGLE:
                repl = RU_TO_LATIN_SINGLE[lower_ch]
                if ch.isupper():
                    repl = repl.upper()
                res.append(repl)
            else:
                res.append(ch)
            i += 1
    return "".join(res)


def filter_piper_text_by_language(text: str, target_lang: str = "ru") -> str:
    """
    Filters text before feeding to Piper TTS:
    - Identifies all fragments not matching the target voice language script.
    - If fragment length <= 18 characters: transliterates it to the target language alphabet.
    - If fragment length > 18 characters: cuts it out (removes it).
    - Cleans up duplicate or dangling punctuation and extra spaces.
    """
    if not text or not text.strip():
        return ""

    norm_lang = (target_lang or "ru").lower().strip()
    is_cyr_target = norm_lang in ("ru", "uk", "bg", "be", "sr", "mk", "kk")

    # Tokens: sequences of Cyrillic, Latin, Digits, Symbols, Whitespace
    tokens = re.findall(r'[\u0400-\u04FF\u0500-\u052F]+|[a-zA-Z\u00C0-\u024F]+|[0-9]+|[^\s\w]+|\s+', text)

    def classify_token(tok: str) -> str:
        if not tok or tok.isspace():
            return "space"
        c = tok[0]
        if is_cyr_target:
            if is_cyrillic(c):
                return "native"
            if is_latin(c):
                return "foreign"
        else:
            if is_latin(c):
                return "native"
            if is_cyrillic(c):
                return "foreign"
        return "neutral"

    token_types = [classify_token(t) for t in tokens]

    segments = []
    i = 0
    n = len(tokens)
    while i < n:
        if token_types[i] == "foreign":
            foreign_buf = []
            while i < n and token_types[i] != "native":
                foreign_buf.append(tokens[i])
                i += 1
            
            last_foreign_idx = -1
            for idx in range(len(foreign_buf) - 1, -1, -1):
                c = foreign_buf[idx][0] if foreign_buf[idx] and not foreign_buf[idx].isspace() else ""
                if (is_cyr_target and is_latin(c)) or (not is_cyr_target and is_cyrillic(c)):
                    last_foreign_idx = idx
                    break
            
            if last_foreign_idx != -1:
                actual_foreign_tokens = foreign_buf[:last_foreign_idx + 1]
                trailing_tokens = foreign_buf[last_foreign_idx + 1:]
                segments.append(("foreign", "".join(actual_foreign_tokens), "".join(trailing_tokens)))
            else:
                segments.append(("native", "".join(foreign_buf), ""))
        else:
            native_buf = []
            while i < n and token_types[i] != "foreign":
                native_buf.append(tokens[i])
                i += 1
            segments.append(("native", "".join(native_buf), ""))

    out_parts = []
    for seg_idx, (s_type, s_text, s_trailing) in enumerate(segments):
        if s_type == "native":
            out_parts.append(s_text)
        else:
            stripped = s_text.strip(" \t\r\n.,;:!?-–—\"'()[]{}")
            frag_len = len(stripped)
            if frag_len <= 18:
                if is_cyr_target:
                    trans = transliterate_latin_to_cyrillic(s_text)
                else:
                    trans = transliterate_cyrillic_to_latin(s_text)
                out_parts.append(trans + s_trailing)
            else:
                # Cut out foreign fragment > 18 characters
                has_next_native = any(s[0] == "native" and s[1].strip() for s in segments[seg_idx + 1:])
                if has_next_native:
                    prev = "".join(out_parts).rstrip()
                    punct = s_trailing.strip()
                    if punct and prev and prev[-1] not in ".!?,:;":
                        out_parts.append(s_trailing)
                    else:
                        out_parts.append(" ")

    res = "".join(out_parts)

    # Clean up formatting artifacts:
    res = re.sub(r'\s+([,.:;!?])', r'\1', res)
    res = re.sub(r'([,.:;!?]){2,}', r'\1', res)
    res = re.sub(r'[,:;–-]\s*([.!?])', r'\1', res)
    res = re.sub(r'^[\s,.:;!?–—-]+', '', res)
    res = re.sub(r'[\s,:;–—-]+$', '', res)
    res = re.sub(r'\s+', ' ', res).strip()

    if not re.search(r'[а-яёА-ЯЁєіїґa-zA-Z0-9]', res):
        return ""

    return res


def duplicate_soft_sign_ru(text: str) -> str:
    """
    Deprecated / No-op: previously doubled 'ь' -> 'ьь' for legacy Piper models.
    Disabled for modern Piper TTS models.
    """
    return text


def prepare_text_for_silero(text: str, lang: str = "ru") -> str:
    """
    Guarantees text is fully verbalized and conformant with Silero models:
    - Normalizes radio abbreviations, frequencies, and callsigns.
    - Verbalizes time expressions (4:36 -> четыре тридцать шесть), currencies,
      percentages, math/symbols, and all numbers into spoken words.
    - Transliterates any remaining Latin script words into Cyrillic phonetics.
    - Cleans up any characters not in Silero's vocabulary to prevent silent drops or ValueError.
    """
    if not text or not text.strip():
        return ""

    clean_lang = (lang or "ru").lower().strip()[:2]
    if clean_lang in ("ua", "uk"):
        text = normalize_for_ukrainian_tts(text)
    elif clean_lang == "ru":
        text = normalize_for_russian_tts(text)
    else:
        # For non-Cyrillic Silero models (de, en, es, fr):
        # Do basic character cleanup without Cyrillic transliteration
        text = re.sub(r"[/\\|]", " ", text)
        text = re.sub(r"[()\[\]{}<>]", ", ", text)
        text = re.sub(r"[\"«»“”„']", " ", text)
        text = re.sub(r"[,:;–-]\s*([,.:;!?])", r"\1", text)
        text = re.sub(r"[,:;]{2,}", ",", text)
        text = re.sub(r"\s+", " ", text).strip()
        return text

    # Final sanitization against Silero vocabulary:
    # Symbols in Silero: _~|!+,-.:;?абвгдежзийклмнопрстуфхцчшщъыьэюяё–… 
    text = re.sub(r"[/\\|]", " дробь ", text)
    text = re.sub(r"[()\[\]{}<>]", ", ", text)
    text = re.sub(r"[\"«»“”„']", " ", text)
    text = re.sub(r"[,:;–-]\s*([,.:;!?])", r"\1", text)
    text = re.sub(r"[,:;]{2,}", ",", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text




