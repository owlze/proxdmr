# -*- coding: utf-8 -*-
"""
Constants and helper conversion functions for DMR networks (including XLX Reflector and FreeDMR).
"""

def xlx_module_to_tg(module: str) -> int:
    """Преобразует букву модуля 'A'..'Z' в TG 4001..4026 (или 4000, если пусто)."""
    m = (module or "").strip().upper()
    if len(m) == 1 and "A" <= m <= "Z":
        return 4001 + (ord(m) - ord("A"))
    return 4000


def xlx_tg_to_module(tg: int) -> str:
    """Преобразует TG 4001..4026 обратно в букву модуля 'A'..'Z'."""
    try:
        t = int(tg)
        if 4001 <= t <= 4026:
            return chr(ord("A") + (t - 4001))
    except (ValueError, TypeError):
        pass
    return ""


FREEDMR_MAX_RPTO_BYTES = 255  # Ограничение MAX_OPTIONS_LENGTH в FreeDMR hblink.py

FREEDMR_DEFAULT_OPTS = {
    "DIAL": "0",     # без Dial-a-TG по умолчанию
    "TIMER": "10",   # 10 минут вместо серверных 999
    "VOICE": "0",    # без 15-минутного голосового маяка и голосовых подсказок
    "SINGLE": "0",   # слышать все статические TG слота (поведение как в BrandMeister)
}


def normalize_freedmr_slots(ts1: list[int], ts2: list[int], opts: dict, prefer_slot: int = 2) -> tuple[list[int], list[int], dict]:
    """
    Гарантирует правила FreeDMR:
    - одна TG не может быть одновременно в TS1 и TS2;
    - TG из DIAL не может быть статической.
    prefer_slot — слот, который «выигрывает» при конфликте (слот, в который TG добавляли последним).
    """
    service = {0, 4000, 5000, 9990, 9991, 9999}
    ts1 = [t for t in dict.fromkeys(ts1) if t not in service]
    ts2 = [t for t in dict.fromkeys(ts2) if t not in service]
    dup = set(ts1) & set(ts2)
    if dup:
        if prefer_slot == 1:
            ts2 = [t for t in ts2 if t not in dup]
        else:
            ts1 = [t for t in ts1 if t not in dup]
    try:
        dial = int(str(opts.get("DIAL", "0")).strip() or 0)
    except ValueError:
        dial = 0
    if dial and (dial in ts1 or dial in ts2):
        opts["DIAL"] = "0"
    return ts1, ts2, opts


def parse_freedmr_rpto(rpto_str: str) -> dict:
    """
    Разбирает строку RPTO вида 'TS1=2501,2502;TS2=250;DIAL=0;TIMER=10;VOICE=1;SINGLE=0;LANG=en_GB;'
    Возвращает:
      {
        "ts1": [2501, 2502],
        "ts2": [250],
        "opts": OrderedDict([("DIAL", "0"), ("TIMER", "10"), ...])
      }
    """
    from collections import OrderedDict
    ts1: list[int] = []
    ts2: list[int] = []
    opts = OrderedDict()
    raw = (rpto_str or "").strip()
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        k_up = k.strip().upper()
        v_clean = v.strip()
        if k_up == "TS1":
            for item in v_clean.split(","):
                item = item.strip()
                if item.isdigit() and int(item) > 0 and int(item) not in ts1:
                    ts1.append(int(item))
        elif k_up == "TS2":
            for item in v_clean.split(","):
                item = item.strip()
                if item.isdigit() and int(item) > 0 and int(item) not in ts2:
                    ts2.append(int(item))
        else:
            opts[k_up] = v_clean
    return {"ts1": ts1, "ts2": ts2, "opts": opts}


def build_freedmr_rpto(ts1: list[int], ts2: list[int], opts: dict, prefer_slot: int = 2) -> str:
    """
    Собирает каноническую строку RPTO из списков TS1, TS2 и словаря дополнительных опций.
    Автоматически применяет нормализацию слотов и заполняет дефолтные параметры FreeDMR.
    """
    merged_opts = dict(opts or {})
    for k, v in FREEDMR_DEFAULT_OPTS.items():
        merged_opts.setdefault(k, v)
    clean_ts1, clean_ts2, merged_opts = normalize_freedmr_slots(ts1, ts2, merged_opts, prefer_slot=prefer_slot)
    parts = []
    if clean_ts1:
        parts.append("TS1=" + ",".join(str(x) for x in clean_ts1))
    if clean_ts2:
        parts.append("TS2=" + ",".join(str(x) for x in clean_ts2))
    for k, v in merged_opts.items():
        if str(v).strip() != "":
            parts.append(f"{k}={v}")
    if not parts:
        return ""
    return ";".join(parts) + ";"
