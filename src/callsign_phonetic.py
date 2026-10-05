"""
callsign_phonetic.py - Amateur radio callsign phonetic spelling and announcement module for ProxDMR.

Transcribes callsigns into spoken phonetic words according to international / regional
amateur radio standards (ITU phonetic alphabet and language-specific pronunciations).
"""

import io
import re
import wave
from typing import Dict, List, Optional, Tuple


PHONETIC_LETTERS_RU: Dict[str, str] = {
    "A": "Альфа",
    "B": "Браво",
    "C": "Чарли",
    "D": "Дельта",
    "E": "Эко",
    "F": "Фокстрот",
    "G": "Гольф",
    "H": "Хотел",
    "I": "Индиа",
    "J": "Джулиэт",
    "K": "Кило",
    "L": "Лима",
    "M": "Майк",
    "N": "Новембер",
    "O": "Оскар",
    "P": "Папа",
    "Q": "Квебек",
    "R": "Ромео",
    "S": "Сиера",
    "T": "Танго",
    "U": "Юниформ",
    "V": "Виктор",
    "W": "Уиски",
    "X": "Эксрэй",
    "Y": "Янки",
    "Z": "Зулу",
}

# Phonetic letters specifically tuned for Russian letter-by-letter spelling in Piper TTS
PHONETIC_LETTERS_RU_PIPER: Dict[str, str] = {
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

# English letter names pronounced in Russian phonetics (A -> Эй, B -> Би...)
LETTER_NAMES_EN_RU: Dict[str, str] = {
    "A": "Эй",
    "B": "Би",
    "C": "Си",
    "D": "Ди",
    "E": "И",
    "F": "Эф",
    "G": "Джи",
    "H": "Эйч",
    "I": "Ай",
    "J": "Джей",
    "K": "Кей",
    "L": "Эл",
    "M": "Эм",
    "N": "Эн",
    "O": "Оу",
    "P": "Пи",
    "Q": "Кью",
    "R": "Ар",
    "S": "Эс",
    "T": "Ти",
    "U": "Ю",
    "V": "Ви",
    "W": "Дабл-ю",
    "X": "Экс",
    "Y": "Уай",
    "Z": "Зед",
}

DIGITS_RU: Dict[str, str] = {
    "0": "Ноль",
    "1": "Один",
    "2": "Два",
    "3": "Три",
    "4": "Четыре",
    "5": "Пять",
    "6": "Шесть",
    "7": "Семь",
    "8": "Восемь",
    "9": "Девять",
}

PHONETIC_LETTERS_UK: Dict[str, str] = {
    "A": "Альфа",
    "B": "Браво",
    "C": "Чарлі",
    "D": "Дельта",
    "E": "Еко",
    "F": "Фокстрот",
    "G": "Гольф",
    "H": "Хотел",
    "I": "Індіа",
    "J": "Джульєтт",
    "K": "Кіло",
    "L": "Ліма",
    "M": "Майк",
    "N": "Новембер",
    "O": "Оскар",
    "P": "Папа",
    "Q": "Квебек",
    "R": "Ромео",
    "S": "Сієрра",
    "T": "Танго",
    "U": "Юніформ",
    "V": "Віктор",
    "W": "Віскі",
    "X": "Ексрей",
    "Y": "Янкі",
    "Z": "Зулу",
}

DIGITS_UK: Dict[str, str] = {
    "0": "Нуль",
    "1": "Один",
    "2": "Два",
    "3": "Три",
    "4": "Чотири",
    "5": "П'ять",
    "6": "Шість",
    "7": "Сім",
    "8": "Вісім",
    "9": "Дев'ять",
}

PHONETIC_LETTERS_ITU: Dict[str, str] = {
    "A": "Alfa",
    "B": "Bravo",
    "C": "Charlie",
    "D": "Delta",
    "E": "Echo",
    "F": "Foxtrot",
    "G": "Golf",
    "H": "Hotel",
    "I": "India",
    "J": "Juliett",
    "K": "Kilo",
    "L": "Lima",
    "M": "Mike",
    "N": "November",
    "O": "Oscar",
    "P": "Papa",
    "Q": "Quebec",
    "R": "Romeo",
    "S": "Sierra",
    "T": "Tango",
    "U": "Uniform",
    "V": "Victor",
    "W": "Whiskey",
    "X": "X-ray",
    "Y": "Yankee",
    "Z": "Zulu",
}

DIGITS_EN: Dict[str, str] = {
    "0": "Zero",
    "1": "One",
    "2": "Two",
    "3": "Three",
    "4": "Four",
    "5": "Five",
    "6": "Six",
    "7": "Seven",
    "8": "Eight",
    "9": "Nine",
}

DIGITS_DE: Dict[str, str] = {
    "0": "Null",
    "1": "Eins",
    "2": "Zwei",
    "3": "Drei",
    "4": "Vier",
    "5": "Fünf",
    "6": "Sechs",
    "7": "Sieben",
    "8": "Acht",
    "9": "Neun",
}

DIGITS_ES: Dict[str, str] = {
    "0": "Cero",
    "1": "Uno",
    "2": "Dos",
    "3": "Tres",
    "4": "Cuatro",
    "5": "Cinco",
    "6": "Seis",
    "7": "Siete",
    "8": "Ocho",
    "9": "Nueve",
}

DIGITS_FR: Dict[str, str] = {
    "0": "Zéro",
    "1": "Un",
    "2": "Deux",
    "3": "Trois",
    "4": "Quatre",
    "5": "Cinq",
    "6": "Six",
    "7": "Sept",
    "8": "Huit",
    "9": "Neuf",
}

DIGITS_IT: Dict[str, str] = {
    "0": "Zero",
    "1": "Uno",
    "2": "Due",
    "3": "Tre",
    "4": "Quattro",
    "5": "Cinque",
    "6": "Sei",
    "7": "Sette",
    "8": "Otto",
    "9": "Nove",
}

DIGITS_PT: Dict[str, str] = {
    "0": "Zero",
    "1": "Um",
    "2": "Dois",
    "3": "Três",
    "4": "Quatro",
    "5": "Cinco",
    "6": "Seis",
    "7": "Sete",
    "8": "Oito",
    "9": "Nove",
}

PHONETIC_LETTERS_JA: Dict[str, str] = {
    "A": "エー",
    "B": "ビー",
    "C": "シー",
    "D": "ディー",
    "E": "イー",
    "F": "エフ",
    "G": "ジー",
    "H": "エイチ",
    "I": "アイ",
    "J": "ジェー",
    "K": "ケー",
    "L": "エル",
    "M": "エム",
    "N": "エヌ",
    "O": "オー",
    "P": "ピー",
    "Q": "キュー",
    "R": "アール",
    "S": "エス",
    "T": "ティー",
    "U": "ユー",
    "V": "ブイ",
    "W": "ダブリュー",
    "X": "エックス",
    "Y": "ワイ",
    "Z": "ゼット",
}

DIGITS_JA: Dict[str, str] = {
    "0": "ゼロ",
    "1": "いち",
    "2": "に",
    "3": "さん",
    "4": "よん",
    "5": "ご",
    "6": "ろく",
    "7": "なな",
    "8": "はち",
    "9": "きゅう",
}

PHONETIC_LETTERS_ZH: Dict[str, str] = {
    "A": "诶",
    "B": "必",
    "C": "西",
    "D": "弟",
    "E": "衣",
    "F": "艾弗",
    "G": "吉",
    "H": "艾尺",
    "I": "爱",
    "J": "杰",
    "K": "开",
    "L": "艾勒",
    "M": "艾姆",
    "N": "恩",
    "O": "欧",
    "P": "批",
    "Q": "丘",
    "R": "艾尔",
    "S": "艾斯",
    "T": "踢",
    "U": "优",
    "V": "微",
    "W": "达布溜",
    "X": "艾克斯",
    "Y": "歪",
    "Z": "贼德",
}

DIGITS_ZH: Dict[str, str] = {
    "0": "零",
    "1": "一",
    "2": "二",
    "3": "三",
    "4": "四",
    "5": "五",
    "6": "六",
    "7": "七",
    "8": "八",
    "9": "九",
}

PHONETIC_LETTERS_EL: Dict[str, str] = {
    "A": "άλφα",
    "B": "βήτα",
    "C": "τσάρλι",
    "D": "δέλτα",
    "E": "έψιλον",
    "F": "φι",
    "G": "γκολφ",
    "H": "χοτέλ",
    "I": "γιώτα",
    "J": "τζούλιετ",
    "K": "κάππα",
    "L": "λάμδα",
    "M": "μι",
    "N": "νι",
    "O": "όμικρον",
    "P": "πι",
    "Q": "κούεμπεκ",
    "R": "ρο",
    "S": "σίγμα",
    "T": "ταυ",
    "U": "γιούניφορμ",
    "V": "βίκτορ",
    "W": "ουίσκι",
    "X": "εξ-ρέι",
    "Y": "γιάνκι",
    "Z": "ζήτα",
}

DIGITS_EL: Dict[str, str] = {
    "0": "μηδέν",
    "1": "ένα",
    "2": "δύο",
    "3": "τρία",
    "4": "τέσσερα",
    "5": "πέντε",
    "6": "έξι",
    "7": "επτά",
    "8": "οκτώ",
    "9": "εννέα",
}

# Slash '/' pronunciation by language in radio communications
SLASH_BY_LANG: Dict[str, str] = {
    "ru": "Дробь",
    "uk": "Дріб",
    "en": "Stroke",
    "de": "Bruch",
    "es": "Barra",
    "fr": "Barre",
    "it": "Barra",
    "pt": "Barra",
    "ja": "スラッシュ",
    "zh": "斜杠",
    "el": "κάθετος",
}

# Introductory phrase: "Говорит CALL" in each target language
INTRO_PHRASE_BY_LANG: Dict[str, str] = {
    "ru": "Говорит",
    "uk": "Говорить",
    "en": "This is",
    "de": "Hier spricht",
    "es": "Aquí habla",
    "fr": "Ici parle",
    "it": "Qui parla",
    "pt": "Aqui fala",
    "ja": "こちらは",
    "zh": "这里是",
    "el": "Εδώ μιλάει",
}


def _get_lang_code(lang: Optional[str]) -> str:
    if not lang or lang == "none":
        return "ru"
    clean = lang.lower().strip()
    return clean.split("_")[0].split("-")[0]


def format_callsign_phonetic(
    callsign: str,
    lang: Optional[str] = "ru",
    separator: Optional[str] = None,
    engine: Optional[str] = None
) -> str:
    """
    Spells out an amateur radio callsign letter by letter using NATO/ITU or language phonetic tables.
    Phonemes are separated by a space by default (without em-dash pauses).
    Example: 'RX6AWG' in Russian -> 'Роо́ммео Э́кксс-рээйй Шесть А́льфа Уи́искии Ггольф' (Piper)
                                 -> 'Ромео Эксрэй Шесть Альфа Уиски Гольф' (Gemini).
    """
    if not callsign or not callsign.strip():
        return ""

    if separator is None:
        separator = " "

    code = _get_lang_code(lang)

    # Select letters mapping
    if code in ("ru", "rus"):
        if engine and "piper" in engine.lower():
            letters_map = PHONETIC_LETTERS_RU_PIPER
        else:
            letters_map = PHONETIC_LETTERS_RU
        digits_map = DIGITS_RU
        slash_word = SLASH_BY_LANG["ru"]
    elif code in ("uk", "ukr"):
        letters_map = PHONETIC_LETTERS_UK
        digits_map = DIGITS_UK
        slash_word = SLASH_BY_LANG["uk"]
    elif code in ("ja", "jpn"):
        letters_map = PHONETIC_LETTERS_JA
        digits_map = DIGITS_JA
        slash_word = SLASH_BY_LANG["ja"]
    elif code in ("zh", "zho", "chi"):
        letters_map = PHONETIC_LETTERS_ZH
        digits_map = DIGITS_ZH
        slash_word = SLASH_BY_LANG["zh"]
    elif code in ("el", "ell", "gre"):
        letters_map = PHONETIC_LETTERS_EL
        digits_map = DIGITS_EL
        slash_word = SLASH_BY_LANG["el"]
    elif code in ("de", "deu", "ger"):
        letters_map = PHONETIC_LETTERS_ITU
        digits_map = DIGITS_DE
        slash_word = SLASH_BY_LANG["de"]
    elif code in ("es", "esp", "spa"):
        letters_map = PHONETIC_LETTERS_ITU
        digits_map = DIGITS_ES
        slash_word = SLASH_BY_LANG["es"]
    elif code in ("fr", "fra", "fre"):
        letters_map = PHONETIC_LETTERS_ITU
        digits_map = DIGITS_FR
        slash_word = SLASH_BY_LANG["fr"]
    elif code in ("it", "ita"):
        letters_map = PHONETIC_LETTERS_ITU
        digits_map = DIGITS_IT
        slash_word = SLASH_BY_LANG["it"]
    elif code in ("pt", "por"):
        letters_map = PHONETIC_LETTERS_ITU
        digits_map = DIGITS_PT
        slash_word = SLASH_BY_LANG["pt"]
    else:
        letters_map = PHONETIC_LETTERS_ITU
        digits_map = DIGITS_EN
        slash_word = SLASH_BY_LANG["en"]

    clean_call = re.sub(r"[^A-Za-z0-9/]", "", callsign.strip().upper())
    parts: List[str] = []

    for char in clean_call:
        if char in letters_map:
            parts.append(letters_map[char])
        elif char in digits_map:
            parts.append(digits_map[char])
        elif char == "/":
            parts.append(slash_word)

    if not parts:
        return ""

    return separator.join(parts)


def get_callsign_announcement(
    callsign: str,
    lang: Optional[str] = "ru",
    engine: Optional[str] = None,
    separator: Optional[str] = None
) -> str:
    """
    Returns full announcement sentence:
    'Говорит, Ромео Эксрэй Шесть Альфа Уиски Гольф.'
    Phonemes are separated by space without em-dash pauses.
    """
    if not callsign or not callsign.strip():
        return ""
    code = _get_lang_code(lang)
    intro = INTRO_PHRASE_BY_LANG.get(code, INTRO_PHRASE_BY_LANG.get("en", "This is"))

    if separator is None:
        separator = " "

    formatted_call = format_callsign_phonetic(callsign, lang=code, separator=separator, engine=engine)
    if not formatted_call:
        return ""
    return f"{intro}, {formatted_call}."


def concatenate_wavs(wav_bytes_list: List[bytes], pause_ms: int = 150) -> Tuple[Optional[bytes], int]:
    """
    Concatenates multiple mono/stereo WAV audio byte strings into a single WAV,
    optionally inserting a brief silence pause between segments.
    Returns (combined_wav_bytes, framerate).
    """
    valid_wavs = [w for w in wav_bytes_list if w and len(w) > 44]
    if not valid_wavs:
        return None, 0
    if len(valid_wavs) == 1:
        try:
            with wave.open(io.BytesIO(valid_wavs[0]), "rb") as wf:
                return valid_wavs[0], wf.getframerate()
        except Exception:
            return valid_wavs[0], 22050

    try:
        first_bio = io.BytesIO(valid_wavs[0])
        with wave.open(first_bio, "rb") as wf:
            nchannels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            framerate = wf.getframerate()
            combined_frames = wf.readframes(wf.getnframes())

        pause_frames = b"\x00" * int(framerate * sampwidth * nchannels * (max(0, pause_ms) / 1000.0))

        for w in valid_wavs[1:]:
            wb = io.BytesIO(w)
            with wave.open(wb, "rb") as wf:
                # If sample rates or widths differ, still concatenate frames
                frames = wf.readframes(wf.getnframes())
                combined_frames += pause_frames + frames

        out_bio = io.BytesIO()
        with wave.open(out_bio, "wb") as out_wf:
            out_wf.setnchannels(nchannels)
            out_wf.setsampwidth(sampwidth)
            out_wf.setframerate(framerate)
            out_wf.writeframes(combined_frames)

        return out_bio.getvalue(), framerate
    except Exception as e:
        # Fallback to returning the first or largest wav
        return valid_wavs[0], 22050
