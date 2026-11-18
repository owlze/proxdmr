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


def normalize_freedmr_slots(ts1: list[int], ts2: list[int], opts: dict = None, prefer_slot: int = 2, duplex: bool = True):
    """
    Гарантирует правила FreeDMR / ADN:
    - в симплексном режиме (duplex=False) все статические TG сводятся на TS2, TS1 очищается;
    - одна TG не может быть одновременно в TS1 и TS2;
    - TG из DIAL не может быть статической.
    prefer_slot — слот, который «выигрывает» при конфликте (слот, в который TG добавляли последним).
    """
    service = {0, 4000, 5000, 9990, 9991, 9999}
    ts1 = [t for t in dict.fromkeys(ts1) if t not in service]
    ts2 = [t for t in dict.fromkeys(ts2) if t not in service]
    if not duplex:
        for t in ts1:
            if t not in ts2:
                ts2.append(t)
        ts1 = []
    else:
        dup = set(ts1) & set(ts2)
        if dup:
            if prefer_slot == 1:
                ts2 = [t for t in ts2 if t not in dup]
            else:
                ts1 = [t for t in ts1 if t not in dup]
    if opts is not None:
        try:
            dial = int(str(opts.get("DIAL", "0")).strip() or 0)
        except ValueError:
            dial = 0
        if dial and (dial in ts1 or dial in ts2):
            opts["DIAL"] = "0"
        return ts1, ts2, opts
    return ts1, ts2


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


DMRPLUS_MAX_STATIC_PER_SLOT = 5
DMRPLUS_MAX_RPTO_BYTES = 255


def parse_dmrplus_rpto(rpto_str: str, fallback_reflector: str = "") -> dict:
    """
    Разбирает строку RPTO протокола DMR+ / IPSC2 вида:
      'StartRef=4530;RelinkTime=60;UserLink=1;TS1_1=250;TS1_2=2;TS2_1=8;'
    Возвращает:
      {
        "start_ref": int (0 если отключен/4000, либо 4001..4999),
        "relink_time": int (по умолчанию 60),
        "user_link": int (по умолчанию 1),
        "ts1": list[int] (до 5 уникальных TG),
        "ts2": list[int] (до 5 уникальных TG),
        "opts": OrderedDict (прочие ключи)
      }
    """
    from collections import OrderedDict
    ts1: list[int] = []
    ts2: list[int] = []
    opts = OrderedDict()
    start_ref = 0
    has_explicit_start_ref = False
    relink_time = 60
    user_link = 1

    service = {0, 4000, 5000, 9990, 9991, 9999}
    raw = (rpto_str or "").strip()
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        k_up = k.strip().upper()
        v_clean = v.strip()
        if k_up == "STARTREF":
            has_explicit_start_ref = True
            if v_clean.isdigit():
                val = int(v_clean)
                start_ref = val if (4001 <= val <= 4999) else 0
        elif k_up == "RELINKTIME":
            if v_clean.isdigit():
                relink_time = max(1, min(1440, int(v_clean)))
        elif k_up == "USERLINK":
            if v_clean in ("0", "1"):
                user_link = int(v_clean)
        elif k_up.startswith("TS1_"):
            if v_clean.isdigit():
                tg_val = int(v_clean)
                if tg_val > 0 and tg_val not in service and tg_val not in ts1:
                    ts1.append(tg_val)
        elif k_up.startswith("TS2_"):
            if v_clean.isdigit():
                tg_val = int(v_clean)
                if tg_val > 0 and tg_val not in service and tg_val != 9 and tg_val not in ts2:
                    ts2.append(tg_val)
        elif k_up == "TS1":
            for item in v_clean.split(","):
                item = item.strip()
                if item.isdigit():
                    tg_val = int(item)
                    if tg_val > 0 and tg_val not in service and tg_val not in ts1:
                        ts1.append(tg_val)
        elif k_up == "TS2":
            for item in v_clean.split(","):
                item = item.strip()
                if item.isdigit():
                    tg_val = int(item)
                    if tg_val > 0 and tg_val not in service and tg_val != 9 and tg_val not in ts2:
                        ts2.append(tg_val)
        else:
            opts[k_up] = v_clean

    if not has_explicit_start_ref:
        fb_str = str(fallback_reflector or "").strip()
        if fb_str.isdigit():
            fb_val = int(fb_str)
            if 4001 <= fb_val <= 4999:
                start_ref = fb_val

    return {
        "start_ref": start_ref,
        "relink_time": relink_time,
        "user_link": user_link,
        "ts1": ts1[:DMRPLUS_MAX_STATIC_PER_SLOT],
        "ts2": ts2[:DMRPLUS_MAX_STATIC_PER_SLOT],
        "opts": opts,
    }


def build_dmrplus_rpto(
    start_ref: int,
    ts1: list[int],
    ts2: list[int],
    relink_time: int = 60,
    user_link: int = 1,
    extra_opts: dict = None,
) -> str:
    """
    Собирает каноническую строку Options (RPTO) для серверов DMR+ / IPSC2.
    """
    service = {0, 4000, 5000, 9990, 9991, 9999}
    clean_ts1 = [t for t in dict.fromkeys(ts1 or []) if t > 0 and t not in service][:DMRPLUS_MAX_STATIC_PER_SLOT]
    clean_ts2 = [t for t in dict.fromkeys(ts2 or []) if t > 0 and t not in service and t != 9][:DMRPLUS_MAX_STATIC_PER_SLOT]

    eff_ref = int(start_ref) if (start_ref and 4001 <= int(start_ref) <= 4999) else 4000
    eff_relink = max(1, min(1440, int(relink_time or 60)))
    eff_ulink = 1 if int(user_link if user_link is not None else 1) else 0

    parts = [
        f"StartRef={eff_ref}",
        f"RelinkTime={eff_relink}",
        f"UserLink={eff_ulink}",
    ]
    for idx, tg in enumerate(clean_ts1, start=1):
        parts.append(f"TS1_{idx}={tg}")
    for idx, tg in enumerate(clean_ts2, start=1):
        parts.append(f"TS2_{idx}={tg}")
    if extra_opts:
        for k, v in extra_opts.items():
            k_up = str(k).strip().upper()
            v_str = str(v).strip()
            if k_up and v_str != "" and k_up not in ("STARTREF", "RELINKTIME", "USERLINK", "TS1", "TS2") and not k_up.startswith(("TS1_", "TS2_")):
                parts.append(f"{k_up}={v_str}")
    return ";".join(parts) + ";"
