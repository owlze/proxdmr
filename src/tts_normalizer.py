"""
Phonetic text normalizer for Text-to-Speech (TTS) in ProxDMR.
Converts amateur radio callsigns, Q-codes, abbreviations, and numbers into
natural, fully intelligible phonetic text based on ITU/ICAO standards.
"""

import re
from typing import Dict

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

    # Clean up excess spaces
    text = re.sub(r"\s+", " ", text).strip()
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


def transliterate_latin_to_cyrillic(text: str) -> str:
    """Transliterates Latin script text into Russian Cyrillic phonetics."""
    res = []
    i = 0
    n = len(text)
    while i < n:
        matched = False
        lower_sub = text[i:].lower()
        for pattern, repl in LATIN_TO_RU_MULTI:
            if lower_sub.startswith(pattern):
                src_piece = text[i:i + len(pattern)]
                if src_piece.isupper() and len(src_piece) > 1:
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
            if lower_ch in LATIN_TO_RU_SINGLE:
                repl = LATIN_TO_RU_SINGLE[lower_ch]
                if ch.isupper():
                    repl = repl.upper()
                res.append(repl)
            else:
                res.append(ch)
            i += 1
    return "".join(res)


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
    - If fragment length <= 16 characters: transliterates it to the target language alphabet.
    - If fragment length > 16 characters: cuts it out (removes it).
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
            if frag_len <= 16:
                if is_cyr_target:
                    trans = transliterate_latin_to_cyrillic(s_text)
                else:
                    trans = transliterate_cyrillic_to_latin(s_text)
                out_parts.append(trans + s_trailing)
            else:
                # Cut out foreign fragment > 16 characters
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



