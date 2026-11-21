# -*- coding: utf-8 -*-
"""
YSF (Yaesu System Fusion / C4FM) Reflector Directory Manager.
Downloads, parses, and caches official YSFReflector registry (YSFHosts.txt).
Caches in src/data/ysf_hosts_cache.json (TTL = 12h, i.e. refreshed twice a day).
"""

import asyncio
import json
import logging
import re
import socket
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("proxdmr.ysf_directory")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
YSF_HOSTS_CACHE = DATA_DIR / "ysf_hosts_cache.json"
YSF_TOP_ACTIVE_CACHE = DATA_DIR / "ysf_top_active_cache.json"
YSF_HOSTS_TTL_SEC = 12 * 3600
YSF_ACTIVE_SCAN_TTL_SEC = 1800  # 30 минут

# Стартовый список 12 популярных DG-ID для мультикомнатных хабов (YCS/FCS):
# 12 * 3 ASCII символа ("XX;") = ровно 36 байт — лимит поля опций YSFO.
YSF_STARTER_DG_IDS: Tuple[str, ...] = (
    "01", "02", "03", "05", "09", "10", "13", "20", "24", "65", "79", "90"
)
YSF_STARTER_DG_ID_OPT: str = ";".join(YSF_STARTER_DG_IDS) + ";"
YSF_MULTIROOM_STANDARD_RE = re.compile(
    r"(?:^|[^A-Z0-9])(YCS|FCS)(?:[0-9]{0,4}|[^A-Z0-9]|$)",
    re.IGNORECASE,
)
YSF_MULTIROOM_RE = YSF_MULTIROOM_STANDARD_RE
YSF_MULTIROOM_MUTANT_RE = re.compile(
    r"(?:^|[^A-Z0-9])(PYSF3|PYSFREFLECTOR3|YSFREFLECTOR3|MULTI[-_\s]?STREAM|DG[-_]?ID(?:_ENABLE|S|\d{1,2})?)(?:[^A-Z0-9]|$)",
    re.IGNORECASE,
)
YSF_MUTANT_KINDS = {"PYSF3", "PYSFREFLECTOR3", "YSFREFLECTOR3", "MULTISTREAM", "DGID", "LIVE_DGID", "MANUAL"}
_RUNTIME_MUTANT_ROOMS: Dict[str, str] = {}


def _normalize_mutant_token(raw_tok: str) -> str:
    up = re.sub(r"[^A-Z0-9]", "", str(raw_tok or "").upper())
    if not up:
        return ""
    if "PYSF" in up or "YSFREFLECTOR3" in up:
        return "PYSF3"
    if "MULTISTREAM" in up:
        return "MULTISTREAM"
    if up.startswith("DGID"):
        return "DGID"
    return up[:16]


def mark_ysf_runtime_mutant(room_id: str, kind: str = "LIVE_DGID") -> None:
    s_id = str(room_id or "").strip()
    if s_id:
        _RUNTIME_MUTANT_ROOMS[s_id] = str(kind or "LIVE_DGID").strip().upper() or "LIVE_DGID"


def is_ysf_runtime_mutant(room_id: str) -> bool:
    s_id = str(room_id or "").strip()
    return bool(s_id and s_id in _RUNTIME_MUTANT_ROOMS)


def classify_ysf_reflector(
    room: Optional[Dict[str, Any]] = None,
    name: str = "",
    description: str = "",
    host: str = "",
    reflector_name: str = "",
    room_id: str = "",
    override: str = "",
) -> Dict[str, Any]:
    """
    Классифицирует YSF-рефлектор строго по 3 типам:
      - 'single' (Тип 1): классический однокомнатный YSFReflector (DG-ID 00)
      - 'multi_standard' (Тип 2): стандартный многокомнатный хаб YCS / FCS
      - 'multi_mutant' (Тип 3): нестандартный многокомнатный (pYSF3, MultiStream, DGID, live DG-ID != 0, manual)
    """
    rid = str(room_id or (room.get("id") if isinstance(room, dict) else "") or "").strip()
    ovr = str(override or (room.get("room_type_override") if isinstance(room, dict) else "") or "").strip().lower()
    if ovr == "auto":
        ovr = ""

    candidates: List[str] = []
    if isinstance(room, dict):
        candidates.extend([
            str(room.get("name") or ""),
            str(room.get("reflector_name") or ""),
            str(room.get("description") or ""),
            str(room.get("host") or ""),
        ])
    candidates.extend([str(name or ""), str(reflector_name or ""), str(description or ""), str(host or "")])

    std_kind = ""
    mut_kind = ""
    for txt in candidates:
        if not txt:
            continue
        up = txt.upper()
        if not std_kind:
            m_std = YSF_MULTIROOM_STANDARD_RE.search(up)
            if m_std:
                std_kind = m_std.group(1).upper()
        if not mut_kind:
            m_mut = YSF_MULTIROOM_MUTANT_RE.search(up)
            if m_mut:
                mut_kind = _normalize_mutant_token(m_mut.group(1))

    if not std_kind and isinstance(room, dict):
        mk_existing = str(room.get("multiroom_kind") or "").strip().upper()
        if mk_existing in ("YCS", "FCS"):
            std_kind = mk_existing
        elif not mut_kind and mk_existing in YSF_MUTANT_KINDS:
            mut_kind = mk_existing

    if ovr == "single":
        return {"reflector_type": "single", "is_multiroom": False, "multiroom_kind": ""}
    if ovr == "multi_standard":
        return {"reflector_type": "multi_standard", "is_multiroom": True, "multiroom_kind": std_kind or "YCS"}
    if ovr == "multi_mutant":
        return {"reflector_type": "multi_mutant", "is_multiroom": True, "multiroom_kind": mut_kind or "MANUAL"}

    if std_kind:
        return {"reflector_type": "multi_standard", "is_multiroom": True, "multiroom_kind": std_kind}
    if mut_kind:
        return {"reflector_type": "multi_mutant", "is_multiroom": True, "multiroom_kind": mut_kind}
    if rid and rid in _RUNTIME_MUTANT_ROOMS:
        return {"reflector_type": "multi_mutant", "is_multiroom": True, "multiroom_kind": _RUNTIME_MUTANT_ROOMS[rid]}
    if isinstance(room, dict):
        rt_existing = str(room.get("reflector_type") or "").strip().lower()
        if rt_existing == "multi_mutant":
            return {
                "reflector_type": "multi_mutant",
                "is_multiroom": True,
                "multiroom_kind": str(room.get("multiroom_kind") or "LIVE_DGID").strip().upper() or "LIVE_DGID",
            }
    return {"reflector_type": "single", "is_multiroom": False, "multiroom_kind": ""}


def get_ysf_multiroom_type(
    room: Optional[Dict[str, Any]] = None,
    name: str = "",
    description: str = "",
    host: str = "",
    override: str = "",
    room_id: str = "",
) -> str:
    """Возвращает уточнённый код многокомнатности ('YCS', 'FCS', 'PYSF3', 'MULTISTREAM', 'DGID', ...), иначе ''."""
    info = classify_ysf_reflector(
        room=room,
        name=name,
        description=description,
        host=host,
        room_id=room_id,
        override=override,
    )
    return str(info.get("multiroom_kind") or "") if info.get("is_multiroom") else ""


def is_ysf_multiroom_room(
    room: Optional[Dict[str, Any]] = None,
    name: str = "",
    description: str = "",
    host: str = "",
    override: str = "",
    room_id: str = "",
) -> bool:
    """True для обоих многокомнатных типов (Тип 2 YCS/FCS и Тип 3 Мутант)."""
    ovr = str(override or (room.get("room_type_override") if isinstance(room, dict) else "") or "").strip().lower()
    if ovr == "single":
        return False
    if ovr in ("multi_standard", "multi_mutant"):
        return True
    info = classify_ysf_reflector(
        room=room,
        name=name,
        description=description,
        host=host,
        room_id=room_id,
        override=override,
    )
    return bool(info.get("is_multiroom"))


def parse_ysf_dg_id_list(raw: str) -> List[int]:
    """Разбирает строку подписки DG-ID (например '01;02;90;') в список уникальных номеров 1..99."""
    s = str(raw or "").strip()
    if not s or s == "00" or s.lower() == "all":
        return []
    out: List[int] = []
    for tok in re.split(r"[;,\s]+", s):
        t = tok.strip()
        if not t or not t.isdigit():
            continue
        val = int(t)
        if 1 <= val <= 99 and val not in out:
            out.append(val)
    return out[:12]


def normalize_ysf_dg_id_options(raw: str = "", is_multiroom: bool = False) -> str:
    """
    Нормализует опции подписки YSFO (до 36 байт ASCII):
    - для YCS/FCS запрещает '00' и пустую строку — возвращает 12 популярных DG-ID;
    - конкретные каналы 1..99 форматируются через ';' (макс. 12 ID, с завершающей ';').
    """
    s = str(raw or "").strip()
    ids = parse_ysf_dg_id_list(s)
    if ids:
        return ";".join(f"{n:02d}" for n in ids[:12]) + ";"
    if is_multiroom:
        return YSF_STARTER_DG_ID_OPT
    return "00"


def ensure_ysf_dg_id_includes_tx(rx_dg_id: str, tx_dg_id: Optional[int], is_multiroom: bool = False) -> str:
    """Гарантирует, что выбранный TX DG-ID входит в RX-подписку YSFO (если RX != '00')."""
    norm_rx = normalize_ysf_dg_id_options(rx_dg_id, is_multiroom=is_multiroom)
    if tx_dg_id is None:
        return norm_rx
    try:
        tx_val = int(tx_dg_id)
    except (ValueError, TypeError):
        return norm_rx
    if not (1 <= tx_val <= 99):
        return norm_rx
    if norm_rx == "00" and not is_multiroom:
        return "00"
    ids = parse_ysf_dg_id_list(norm_rx)
    if tx_val in ids:
        return ";".join(f"{n:02d}" for n in ids[:12]) + ";"
    if len(ids) >= 12:
        ids = ids[:11] + [tx_val]
    else:
        ids.append(tx_val)
    return ";".join(f"{n:02d}" for n in ids[:12]) + ";"


def resolve_ysf_room_dg_id_settings(
    cfg: Any,
    room_id: str,
    room_info: Optional[Dict[str, Any]] = None,
    room_type_override: str = "",
) -> Tuple[str, Optional[int], bool, str]:
    """
    Определяет актуальные (rx_dg_id, tx_dg_id, is_multiroom, multiroom_kind) для комнаты YSF
    с учётом сохранённой карты cfg.ysf_room_dg_ids[room_id] и ручного типа комнаты.
    """
    s_room = str(room_id or "").strip()
    if room_info is None and s_room:
        try:
            room_info = ysf_dir_mgr.get_room_by_id(s_room)
        except Exception:
            room_info = None

    fallback_name = (
        getattr(cfg, "ysf_room_name", "")
        or getattr(cfg, "ysf_name", "")
        or ""
    )
    fallback_host = (
        getattr(cfg, "ysf_host", "")
        or getattr(cfg, "bm_master_host", "")
        or ""
    )
    cls_info = classify_ysf_reflector(
        room=room_info,
        name=fallback_name if not room_info else "",
        host=fallback_host if not room_info else "",
        room_id=s_room,
        override=room_type_override,
    )
    mr_kind = str(cls_info.get("multiroom_kind") or "")
    is_mr = bool(cls_info.get("is_multiroom"))
    if str(room_type_override or "").strip().lower() == "single":
        return "00", None, False, ""

    room_map = getattr(cfg, "ysf_room_dg_ids", None)
    saved_entry = room_map.get(s_room) if isinstance(room_map, dict) and s_room else None

    if isinstance(saved_entry, dict):
        rx_dg = normalize_ysf_dg_id_options(str(saved_entry.get("rx_dg_id") or ""), is_multiroom=is_mr)
        raw_tx = saved_entry.get("tx_dg_id", None)
        tx_dg: Optional[int] = None
        if raw_tx is not None and str(raw_tx).strip() != "":
            try:
                v = int(raw_tx)
                if 1 <= v <= 99:
                    tx_dg = v
            except (ValueError, TypeError):
                tx_dg = None
        if tx_dg is not None:
            rx_dg = ensure_ysf_dg_id_includes_tx(rx_dg, tx_dg, is_multiroom=is_mr)
        return rx_dg, tx_dg, is_mr, mr_kind

    cur_active_rid = str(getattr(cfg, "ysf_room_id", "") or getattr(cfg, "ysf_room", "") or "").strip()
    if s_room and cur_active_rid == s_room:
        raw_rx_cfg = str(getattr(cfg, "ysf_dg_id", "") or "").strip()
        raw_tx_cfg = getattr(cfg, "ysf_tx_dg_id", None)
        if raw_rx_cfg:
            rx_dg = normalize_ysf_dg_id_options(raw_rx_cfg, is_multiroom=is_mr)
            tx_dg = None
            if raw_tx_cfg is not None and str(raw_tx_cfg).strip() != "":
                try:
                    v = int(raw_tx_cfg)
                    if 1 <= v <= 99:
                        tx_dg = v
                except (ValueError, TypeError):
                    tx_dg = None
            if tx_dg is not None:
                rx_dg = ensure_ysf_dg_id_includes_tx(rx_dg, tx_dg, is_multiroom=is_mr)
            return rx_dg, tx_dg, is_mr, mr_kind

    return normalize_ysf_dg_id_options("", is_multiroom=is_mr), None, is_mr, mr_kind


# Primary URLs for YSF Reflector Registry (DVRef via Pi-Star hostfile)
YSF_REGISTRY_URLS = [
    "https://www.pistar.uk/downloads/YSF_Hosts.txt",
    "http://pistar.uk/downloads/YSF_Hosts.txt"
]

REFCHECK_URL = "https://refcheck.radio/"

# Well-known fallback rooms in case network registry is temporarily unreachable
FALLBACK_YSF_ROOMS: List[Dict[str, Any]] = [
    {
        "id": "25001",
        "name": "RU-RUSSIA",
        "description": "Russia National YSF Reflector",
        "host": "62.113.103.244",
        "port": 42000,
        "country": "RU",
        "country_name": "Russia"
    },
    {
        "id": "21080",
        "name": "America-Link",
        "description": "America-Link Multi-Protocol Room",
        "host": "americalink.duckdns.org",
        "port": 42000,
        "country": "US",
        "country_name": "USA"
    },
    {
        "id": "20000",
        "name": "Europe-Link",
        "description": "Europe-Link International Hub",
        "host": "eu-link.ysfreflector.de",
        "port": 42000,
        "country": "EU",
        "country_name": "Europe"
    },
    {
        "id": "26200",
        "name": "DL-Germany",
        "description": "Germany National C4FM YSF Room",
        "host": "ysf.xreflector.net",
        "port": 42000,
        "country": "DE",
        "country_name": "Germany"
    },
    {
        "id": "23400",
        "name": "UK-YSF",
        "description": "United Kingdom YSF Main Hub",
        "host": "uk-ysf.org.uk",
        "port": 42000,
        "country": "GB",
        "country_name": "United Kingdom"
    },
    {
        "id": "20800",
        "name": "France-YSF",
        "description": "French Fusion Network Room",
        "host": "ysf.france-fusion.fr",
        "port": 42000,
        "country": "FR",
        "country_name": "France"
    },
    {
        "id": "22200",
        "name": "Italy-YSF",
        "description": "Italy YSF National Reflector",
        "host": "ysf.dmrbrescia.it",
        "port": 42000,
        "country": "IT",
        "country_name": "Italy"
    },
    {
        "id": "28400",
        "name": "Bulgaria-YSF",
        "description": "Bulgaria National YSF Room",
        "host": "ysf.lz-ham.net",
        "port": 42000,
        "country": "BG",
        "country_name": "Bulgaria"
    },
    {
        "id": "20200",
        "name": "Hellas-YSF",
        "description": "Greece YSF Reflector",
        "host": "ysf.raag.org",
        "port": 42000,
        "country": "GR",
        "country_name": "Greece"
    },
    {
        "id": "72400",
        "name": "Brazil-YSF",
        "description": "Brazil National Fusion Hub",
        "host": "ysf.dvswitch.org.br",
        "port": 42000,
        "country": "BR",
        "country_name": "Brazil"
    }
]


def parse_ysf_hosts_text(raw_text: str) -> List[Dict[str, Any]]:
    """
    Parses semicolon- or hash-delimited YSFHosts.txt format:
    Number;Name;Description;Host;Port;Connections
    """
    rooms: List[Dict[str, Any]] = []
    if not raw_text:
        return rooms

    for line in raw_text.splitlines():
        clean_line = line.strip()
        if not clean_line or clean_line.startswith("#"):
            continue

        parts = clean_line.split(";")
        if len(parts) < 5:
            continue

        room_id = parts[0].strip()
        name = parts[1].strip()
        desc = parts[2].strip()
        host = parts[3].strip()
        try:
            port = int(parts[4].strip())
        except (ValueError, TypeError):
            port = 42000

        if not room_id or not host or not (1 <= port <= 65535):
            continue

        # Extract country code and reflector name (YSF standard: CC-ReflectorName, e.g. LU-XLX032, XX-EUROPELINK)
        m_cc = re.match(r"^([A-Za-z]{2})[-_ ]\s*(.*)$", name)
        if m_cc:
            cc = m_cc.group(1).upper()
            ref_name = m_cc.group(2).strip()
        else:
            cc = "XX"
            ref_name = name

        country = "GLOBAL" if cc in ("XX", "GLOBAL") else cc
        country_code = cc
        country_name = "International" if cc in ("XX", "GLOBAL") else cc
        cls_info = classify_ysf_reflector(name=name, reflector_name=ref_name, description=desc, host=host, room_id=room_id)

        rooms.append({
            "id": room_id,
            "name": name,
            "reflector_name": ref_name,
            "description": desc,
            "host": host,
            "port": port,
            "country": country,
            "country_code": country_code,
            "country_name": country_name,
            "reflector_type": cls_info["reflector_type"],
            "is_multiroom": cls_info["is_multiroom"],
            "multiroom_kind": cls_info["multiroom_kind"],
        })

    return rooms


def fetch_refcheck_down_ysf_ids() -> set:
    """Fetches list of currently down/unreachable YSF reflectors from refcheck.radio."""
    try:
        req = urllib.request.Request(
            REFCHECK_URL,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        m = re.search(r'<script\s+id="reflector-data"\s+type="application/json">(.*?)</script>', html, re.DOTALL)
        if m:
            data = json.loads(m.group(1))
            down_ids = set(str(d.get("id")).strip() for d in data if d.get("mode") == "ysf")
            logger.info(f"[YSF_DIR] Loaded {len(down_ids)} down YSF reflectors from RefCheck blacklist")
            return down_ids
    except Exception as e:
        logger.warning(f"[YSF_DIR] Could not load RefCheck outages: {e}")
    return set()


class YsfsProbeProtocol(asyncio.DatagramProtocol):
    """Lightweight UDP client protocol for native YSF Status handshake."""
    def __init__(self, on_reply_cb):
        self.on_reply_cb = on_reply_cb

    def datagram_received(self, data, addr):
        if len(data) >= 42 and data.startswith(b"YSFS"):
            rid = data[4:9].decode("ascii", errors="ignore").strip()
            name = data[9:25].decode("ascii", errors="ignore").strip()
            cnt_str = data[39:42].decode("ascii", errors="ignore").strip()
            cnt = int(cnt_str) if cnt_str.isdigit() else 0
            self.on_reply_cb(rid, name, cnt, addr)


class YsfDirectoryManager:
    """Manages downloading, caching, and querying live YSF reflectors."""

    def __init__(self):
        self._rooms: List[Dict[str, Any]] = list(FALLBACK_YSF_ROOMS)
        self._top_active_rooms: List[Dict[str, Any]] = []
        self._last_loaded_ts: float = 0.0
        self._last_active_scan_ts: float = 0.0
        self._source: str = "fallback"
        self._load_from_cache()
        self._load_top_active_cache()

    @staticmethod
    def _enrich_room_flags(rooms: List[Dict[str, Any]]) -> None:
        for r in rooms:
            if isinstance(r, dict):
                cls_info = classify_ysf_reflector(
                    name=str(r.get("name") or ""),
                    reflector_name=str(r.get("reflector_name") or ""),
                    description=str(r.get("description") or ""),
                    host=str(r.get("host") or ""),
                    room_id=str(r.get("id") or ""),
                )
                r["reflector_type"] = cls_info["reflector_type"]
                r["is_multiroom"] = cls_info["is_multiroom"]
                r["multiroom_kind"] = cls_info["multiroom_kind"]

    def mark_runtime_mutant(self, room_id: str, kind: str = "LIVE_DGID") -> None:
        s_id = str(room_id or "").strip()
        if not s_id:
            return
        mark_ysf_runtime_mutant(s_id, kind)
        for pool in (self._rooms, self._top_active_rooms):
            for r in pool:
                if isinstance(r, dict) and str(r.get("id") or "").strip() == s_id:
                    if str(r.get("reflector_type") or "single") == "single":
                        r["reflector_type"] = "multi_mutant"
                        r["is_multiroom"] = True
                        r["multiroom_kind"] = str(kind or "LIVE_DGID").strip().upper() or "LIVE_DGID"

    def _load_from_cache(self) -> bool:
        if not YSF_HOSTS_CACHE.exists():
            return False
        try:
            with open(YSF_HOSTS_CACHE, "r", encoding="utf-8") as f:
                data = json.load(f)
            rooms = data.get("rooms", [])
            gen_at = data.get("generated_at", 0)
            if isinstance(rooms, list) and len(rooms) >= 5:
                self._enrich_room_flags(rooms)
                self._rooms = rooms
                self._last_loaded_ts = float(gen_at)
                self._source = "cache"
                logger.info(f"[YSF_DIR] Loaded {len(rooms)} rooms from cache (generated: {time.ctime(gen_at)})")
                return True
        except Exception as e:
            logger.warning(f"[YSF_DIR] Could not read cache {YSF_HOSTS_CACHE}: {e}")
        return False

    def _save_to_cache(self, rooms: List[Dict[str, Any]]):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = YSF_HOSTS_CACHE.with_suffix(".tmp")
            payload = {
                "status": "ok",
                "generated_at": int(time.time()),
                "count": len(rooms),
                "rooms": rooms,
            }
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(YSF_HOSTS_CACHE)
            logger.info(f"[YSF_DIR] Saved {len(rooms)} rooms to {YSF_HOSTS_CACHE}")
        except Exception as e:
            logger.error(f"[YSF_DIR] Failed to save cache: {e}")

    def _load_top_active_cache(self) -> bool:
        if not YSF_TOP_ACTIVE_CACHE.exists():
            return False
        try:
            with open(YSF_TOP_ACTIVE_CACHE, "r", encoding="utf-8") as f:
                data = json.load(f)
            rooms = data.get("top_active", [])
            gen_at = data.get("generated_at", 0)
            if isinstance(rooms, list) and rooms:
                self._enrich_room_flags(rooms)
                self._top_active_rooms = rooms
                self._last_active_scan_ts = float(gen_at)
                logger.info(f"[YSF_DIR] Loaded {len(rooms)} top active YSF rooms from cache")
                return True
        except Exception as e:
            logger.warning(f"[YSF_DIR] Could not read top active cache: {e}")
        return False

    def _save_top_active_cache(self, rooms: List[Dict[str, Any]]):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = YSF_TOP_ACTIVE_CACHE.with_suffix(".tmp")
            payload = {
                "status": "ok",
                "generated_at": int(time.time()),
                "count": len(rooms),
                "top_active": rooms
            }
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(YSF_TOP_ACTIVE_CACHE)
            logger.info(f"[YSF_DIR] Saved {len(rooms)} top active YSF rooms to cache")
        except Exception as e:
            logger.error(f"[YSF_DIR] Failed to save top active cache: {e}")

    async def _resolve_hosts_async(self, hostnames: List[str]) -> Dict[str, str]:
        """Asynchronously resolves hostnames to IPv4 with short cache and bounded concurrency."""
        if not hasattr(self, "_dns_cache"):
            self._dns_cache: Dict[str, Tuple[float, str]] = {}

        now = time.time()
        resolved: Dict[str, str] = {}
        to_lookup: List[str] = []

        for raw_h in hostnames:
            h = str(raw_h or "").strip()
            if not h or h in resolved:
                continue
            try:
                socket.inet_aton(h)
                resolved[h] = h
                continue
            except OSError:
                pass
            cached = self._dns_cache.get(h)
            if cached and (now - cached[0]) < 900.0:
                if cached[1]:
                    resolved[h] = cached[1]
            else:
                if h not in to_lookup:
                    to_lookup.append(h)

        if to_lookup:
            loop = asyncio.get_running_loop()
            sem = asyncio.Semaphore(48)

            async def _one(host_item: str):
                async with sem:
                    try:
                        infos = await asyncio.wait_for(
                            loop.getaddrinfo(host_item, None, family=socket.AF_INET, type=socket.SOCK_DGRAM),
                            timeout=1.5
                        )
                        ip = infos[0][4][0] if infos else ""
                    except Exception:
                        ip = ""
                    self._dns_cache[host_item] = (time.time(), ip)
                    if ip:
                        resolved[host_item] = ip

            await asyncio.gather(*[_one(h) for h in to_lookup], return_exceptions=True)

        return resolved

    async def refresh_top_active_rooms(self, force: bool = False, limit_top: int = 300) -> List[Dict[str, Any]]:
        """Scans active rooms via UDP YSFS protocol, excluding RefCheck down servers, ranks by online count."""
        now = time.time()
        if not force and self._top_active_rooms and (now - self._last_active_scan_ts) < YSF_ACTIVE_SCAN_TTL_SEC:
            return self._top_active_rooms

        if not self._rooms:
            await self.fetch_hosts(force=False)

        # 1. Получаем список сбойных рефлекторов с RefCheck
        loop = asyncio.get_running_loop()
        down_ids = await loop.run_in_executor(None, fetch_refcheck_down_ysf_ids)

        candidates = [r for r in self._rooms if str(r.get("id")).strip() not in down_ids]
        if not candidates:
            return self._top_active_rooms

        resolved_ips = await self._resolve_hosts_async([r.get("host", "") for r in candidates])

        # 2. Асинхронный опрос пачками по протоколу YSFS строго по готовым IP
        replies: Dict[str, int] = {}
        def on_reply(rid, name, cnt, addr):
            clean_id = str(rid).strip()
            clean_id_int = str(int(clean_id)) if clean_id.isdigit() else clean_id
            replies[clean_id] = cnt
            replies[clean_id_int] = cnt

        transport = None
        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: YsfsProbeProtocol(on_reply),
                local_addr=("0.0.0.0", 0)
            )

            # Отправка легковесных 4-байтовых пакетов YSFS
            for r in candidates:
                try:
                    ip = resolved_ips.get(str(r.get("host") or "").strip(), "")
                    port = int(r.get("port") or 42000)
                    if ip and 1 <= port <= 65535:
                        transport.sendto(b"YSFS", (ip, port))
                except Exception:
                    pass

            # Ожидание ответов 1.8 секунды
            await asyncio.sleep(1.8)
        except Exception as e:
            logger.warning(f"[YSF_DIR] UDP probe scan error: {e}")
        finally:
            if transport:
                transport.close()

        # 3. Сбор и сортировка по количеству активных абонентов
        active_list: List[Dict[str, Any]] = []
        for r in candidates:
            rid = str(r.get("id")).strip()
            cnt = replies.get(rid, 0)
            if cnt > 0:
                enriched = dict(r)
                enriched["connections"] = cnt
                enriched["online_count"] = cnt
                active_list.append(enriched)

        # Filter clone clusters on same host:port
        # If a host:port group has >=3 rooms with the exact same count, keep only 1 representative
        grouped_by_endpoint: Dict[Tuple[str, int], List[Dict[str, Any]]] = {}
        for r in active_list:
            ep = (str(r.get("host", "")).strip().lower(), int(r.get("port", 42000) or 42000))
            grouped_by_endpoint.setdefault(ep, []).append(r)

        filtered_active: List[Dict[str, Any]] = []
        for ep, grp in grouped_by_endpoint.items():
            if len(grp) >= 3:
                counts = {int(x.get("connections", 0)) for x in grp}
                if len(counts) == 1:
                    filtered_active.append(grp[0])
                    continue
            filtered_active.extend(grp)

        filtered_active.sort(key=lambda x: int(x.get("connections", 0)), reverse=True)
        top_pool = filtered_active[:limit_top]

        if top_pool:
            self._top_active_rooms = top_pool
            self._last_active_scan_ts = now
            self._save_top_active_cache(top_pool)
            logger.info(f"[YSF_DIR] Successfully updated TOP-{len(top_pool)} active YSF rooms (max clients: {top_pool[0].get('connections')})")
        else:
            logger.warning("[YSF_DIR] No active rooms responded with count > 0 during probe")

        return self._top_active_rooms

    async def fetch_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        """Downloads official YSF registry, updates cache, returns rooms."""
        now = time.time()
        if not force and self._last_loaded_ts > 0 and (now - self._last_loaded_ts) < YSF_HOSTS_TTL_SEC:
            return self._rooms

        raw_text = None
        for url in YSF_REGISTRY_URLS:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "ProxDMR/1.1", "Accept": "text/plain"}
            )
            def _do_fetch():
                try:
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        return resp.read().decode("utf-8", errors="ignore")
                except Exception as e:
                    logger.debug(f"[YSF_DIR] Fetch from {url} failed: {e}")
                    return None

            raw_text = await asyncio.to_thread(_do_fetch)
            if raw_text and len(raw_text) > 200:
                break

        if not raw_text:
            logger.warning("[YSF_DIR] All remote registry mirrors failed, retaining current rooms")
            if not self._rooms:
                self._rooms = list(FALLBACK_YSF_ROOMS)
            return self._rooms

        parsed = parse_ysf_hosts_text(raw_text)
        if len(parsed) < 5:
            logger.warning(f"[YSF_DIR] Download returned only {len(parsed)} rooms, retaining cache")
            return self._rooms

        self._rooms = parsed
        self._last_loaded_ts = now
        self._source = "live"
        self._save_to_cache(parsed)
        return self._rooms

    async def periodic_update_loop(self) -> None:
        """Background coroutine: keeps DVRef registry and TOP-300 active rooms pool fresh."""
        logger.info("[YSF_DIR] Started background update loop for YSF registry and top active rooms")
        try:
            await self.fetch_hosts(force=False)
            await self.refresh_top_active_rooms(force=False)
        except Exception as e:
            logger.warning(f"[YSF_DIR] Initial background update/probe failed: {e}")

        scan_ticks = 0
        while True:
            # Каждые 30 минут обновляем активность комнат (YSFS probe)
            await asyncio.sleep(YSF_ACTIVE_SCAN_TTL_SEC)
            scan_ticks += 1
            try:
                # Каждые 12 часов (24 тика по 30 мин) перекачиваем полный реестр хостов
                if scan_ticks >= 24:
                    scan_ticks = 0
                    await self.fetch_hosts(force=True)
                await self.refresh_top_active_rooms(force=True)
            except Exception as e:
                logger.error(f"[YSF_DIR] Periodic scan update failed: {e}")

    def get_hosts(self, enriched: bool = False) -> Dict[str, Any]:
        """Returns JSON-compatible payload for REST API."""
        return {
            "status": "ok",
            "source": self._source,
            "last_loaded": self._last_loaded_ts,
            "count": len(self._rooms),
            "rooms": list(self._rooms),
            "servers": list(self._rooms),
        }

    def search_rooms(self, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Searches rooms by id, name, description or country."""
        q = (query or "").strip().lower()
        if not q:
            return self._rooms[:limit]
        matched = []
        for r in self._rooms:
            if q in r["id"].lower() or q in r["name"].lower() or q in r["description"].lower() or q in r.get("country_name", "").lower():
                matched.append(r)
                if len(matched) >= limit:
                    break
        return matched

    def get_room_by_id(self, room_id: str) -> Optional[Dict[str, Any]]:
        target = str(room_id).strip()
        for r in self._rooms:
            if str(r.get("id")).strip() == target:
                return r
        return None

    def get_random_active_room(self) -> Optional[Dict[str, Any]]:
        """Picks a weighted random room from the active rooms pool avoiding recent duplicates."""
        import random
        import math
        pool = self._top_active_rooms or [r for r in self._rooms if int(r.get("connections", 0) or 0) > 0]
        if not pool:
            pool = self._rooms or list(FALLBACK_YSF_ROOMS)
        if not pool:
            return None

        if not hasattr(self, "_recent_dice_ids"):
            self._recent_dice_ids: List[str] = []

        available = [r for r in pool if str(r.get("id")).strip() not in self._recent_dice_ids]
        if not available:
            available = pool
            self._recent_dice_ids.clear()

        weights = [max(1.0, math.sqrt(float(r.get("connections", 1) or 1))) for r in available]
        chosen = random.choices(available, weights=weights, k=1)[0]

        rid = str(chosen.get("id")).strip()
        if rid:
            self._recent_dice_ids.append(rid)
            if len(self._recent_dice_ids) > 10:
                self._recent_dice_ids = self._recent_dice_ids[-10:]

        return chosen

    async def pick_live_or_active_dice_room(
        self,
        probe_callsign: str = "PROXDMR",
        exclude_ids: Optional[Set[str]] = None,
    ) -> Tuple[Optional[Dict[str, Any]], bool, str]:
        """Scouts up to 8 top active candidate rooms right now: prefers one with live YSFD speech, otherwise returns a live YSFS-reachable populated room."""
        import random
        import math
        pool = [r for r in (self._top_active_rooms or self._rooms or FALLBACK_YSF_ROOMS) if r.get("host")]
        if not pool:
            return None, False, ""

        excl = {str(x).strip() for x in (exclude_ids or set()) if str(x).strip()}
        if excl:
            non_excluded_pool = [r for r in pool if str(r.get("id")).strip() not in excl]
            if non_excluded_pool:
                pool = non_excluded_pool
            else:
                return None, False, ""

        if not hasattr(self, "_recent_dice_ids"):
            self._recent_dice_ids: List[str] = []

        available = [r for r in pool if str(r.get("id")).strip() not in self._recent_dice_ids]
        if not available:
            available = pool
            self._recent_dice_ids.clear()

        # Берём взвешенную выборку до 8 уникальных кандидатов
        k_sample = min(8, len(available))
        cands: List[Dict[str, Any]] = []
        seen_ids = set()
        weights = [max(1.0, math.sqrt(float(r.get("connections", 1) or 1))) for r in available]
        for _ in range(k_sample * 3):
            if len(cands) >= k_sample:
                break
            r = random.choices(available, weights=weights, k=1)[0]
            rid = str(r.get("id")).strip()
            if rid and rid not in seen_ids:
                seen_ids.add(rid)
                cands.append(r)

        resolved_ips = await self._resolve_hosts_async([c.get("host", "") for c in cands])
        addr_to_room: Dict[Tuple[str, int], Dict[str, Any]] = {}
        for c in cands:
            ip = resolved_ips.get(str(c.get("host") or "").strip(), "")
            port = int(c.get("port") or 42000)
            if ip and 1 <= port <= 65535:
                addr_to_room[(ip, port)] = c

        if not addr_to_room:
            chosen = random.choice(available) if available else self.get_random_active_room()
            rid_fb = str(chosen.get("id")).strip() if chosen else ""
            if rid_fb:
                self._recent_dice_ids.append(rid_fb)
                if len(self._recent_dice_ids) > 10:
                    self._recent_dice_ids = self._recent_dice_ids[-10:]
            return chosen, False, ""

        ysfs_alive: Dict[Tuple[str, int], int] = {}
        ysfd_talkers: Dict[Tuple[str, int], str] = {}
        call_b = f"{(probe_callsign or 'PROXDMR'):<10.10}".encode("ascii", errors="replace")
        ysfp_pkt = b"YSFP" + call_b
        ysfo_single_pkt = b"YSFO" + call_b + f"{'00':<36.36}".encode("ascii")
        ysfo_multi_pkt = b"YSFO" + call_b + f"{YSF_STARTER_DG_ID_OPT:<36.36}".encode("ascii")
        ysfu_pkt = b"YSFU" + call_b

        class _DiceScoutProto(asyncio.DatagramProtocol):
            def datagram_received(self, data, addr):
                if len(data) < 4:
                    return
                sig = data[:4]
                if sig == b"YSFS" and len(data) >= 42:
                    c_str = data[39:42].decode("ascii", errors="ignore").strip()
                    ysfs_alive[addr] = int(c_str) if c_str.isdigit() else 1
                elif sig == b"YSFP":
                    ysfs_alive.setdefault(addr, int(addr_to_room.get(addr, {}).get("connections", 1) or 1))
                elif sig == b"YSFD" and len(data) >= 155:
                    src = data[14:24].decode("ascii", errors="ignore").strip()
                    ysfs_alive.setdefault(addr, int(addr_to_room.get(addr, {}).get("connections", 1) or 1))
                    if addr not in ysfd_talkers:
                        ysfd_talkers[addr] = src

        loop = asyncio.get_running_loop()
        transport = None
        try:
            transport, _ = await loop.create_datagram_endpoint(lambda: _DiceScoutProto(), local_addr=("0.0.0.0", 0))
            for ep, room_cand in addr_to_room.items():
                try:
                    transport.sendto(b"YSFS", ep)
                    transport.sendto(ysfp_pkt, ep)
                    pkt_opt = ysfo_multi_pkt if is_ysf_multiroom_room(room_cand) else ysfo_single_pkt
                    transport.sendto(pkt_opt, ep)
                except Exception:
                    pass
            # Короткое окно 1.1с с ранним выходом, если кто-то прямо сейчас в эфире
            for _ in range(11):
                await asyncio.sleep(0.1)
                if ysfd_talkers:
                    break
            for ep in addr_to_room.keys():
                try:
                    transport.sendto(ysfu_pkt, ep)
                except Exception:
                    pass
        except Exception as e:
            logger.debug(f"[YSF_DIR] Dice scout error: {e}")
        finally:
            if transport:
                transport.close()

        chosen = None
        live_rx = False
        active_caller = ""
        if ysfd_talkers:
            best_ep = max(ysfd_talkers.keys(), key=lambda e: ysfs_alive.get(e, 0))
            chosen = dict(addr_to_room[best_ep])
            chosen["connections"] = ysfs_alive.get(best_ep, chosen.get("connections", 1))
            live_rx = True
            active_caller = ysfd_talkers[best_ep]
        elif ysfs_alive:
            best_ep = max(ysfs_alive.keys(), key=lambda e: ysfs_alive.get(e, 0))
            chosen = dict(addr_to_room[best_ep])
            chosen["connections"] = ysfs_alive.get(best_ep, chosen.get("connections", 0))
        else:
            chosen = cands[0]

        rid = str(chosen.get("id")).strip()
        if rid:
            self._recent_dice_ids.append(rid)
            if len(self._recent_dice_ids) > 10:
                self._recent_dice_ids = self._recent_dice_ids[-10:]

        return chosen, live_rx, active_caller

    async def probe_rooms_batch(self, room_ids: List[str], force: bool = False) -> Dict[str, Dict[str, Any]]:
        """Probes status & client count for a batch of YSF rooms via UDP YSFS protocol."""
        results: Dict[str, Dict[str, Any]] = {}
        if not room_ids:
            return results

        now = time.time()
        needed_probe = []

        if not hasattr(self, "_rooms_probe_cache"):
            self._rooms_probe_cache: Dict[str, tuple] = {}

        for rid in room_ids:
            clean_id = str(rid).strip()
            if not clean_id:
                continue
            hit = self._rooms_probe_cache.get(clean_id)
            if not force and hit and (now - hit[0]) < 45.0:
                results[clean_id] = dict(hit[1])
            else:
                needed_probe.append(clean_id)

        if not needed_probe:
            return results

        rooms_map = {str(r.get("id")).strip(): r for r in self._rooms}
        top_map = {str(r.get("id")).strip(): r for r in self._top_active_rooms}

        to_send = []
        for rid in needed_probe:
            r_info = rooms_map.get(rid) or top_map.get(rid)
            if r_info and r_info.get("host"):
                to_send.append((rid, r_info.get("host"), int(r_info.get("port") or 42000)))
            else:
                cached_top = top_map.get(rid)
                cnt = int(cached_top.get("connections", 0)) if cached_top else 0
                res = {
                    "room": rid,
                    "online": bool(cached_top),
                    "connections": cnt,
                    "keyed": False,
                    "traffic_level": "medium" if cnt > 0 else "zero"
                }
                self._rooms_probe_cache[rid] = (now, res)
                results[rid] = res

        if to_send:
            replies: Dict[str, int] = {}
            def on_reply(reply_rid, name, cnt, addr):
                c_id = str(reply_rid).strip()
                replies[c_id] = cnt
                if c_id.isdigit():
                    replies[str(int(c_id))] = cnt

            resolved_ips = await self._resolve_hosts_async([h for _, h, _ in to_send])
            loop = asyncio.get_running_loop()
            transport = None
            try:
                transport, _ = await loop.create_datagram_endpoint(
                    lambda: YsfsProbeProtocol(on_reply),
                    local_addr=("0.0.0.0", 0)
                )
                for rid, host, port in to_send:
                    try:
                        ip = resolved_ips.get(str(host or "").strip(), "")
                        if ip and 1 <= port <= 65535:
                            transport.sendto(b"YSFS", (ip, port))
                    except Exception:
                        pass
                await asyncio.sleep(0.65)
            except Exception as e:
                logger.warning(f"[YSF_DIR] Batch probe error: {e}")
            finally:
                if transport:
                    transport.close()

            for rid, host, port in to_send:
                clean_id_int = str(int(rid)) if rid.isdigit() else rid
                if rid in replies or clean_id_int in replies:
                    cnt = replies.get(rid, replies.get(clean_id_int, 0))
                    res = {
                        "room": rid,
                        "online": True,
                        "connections": cnt,
                        "keyed": False,
                        "traffic_level": "medium" if cnt > 0 else "zero"
                    }
                else:
                    res = {
                        "room": rid,
                        "online": False,
                        "connections": 0,
                        "keyed": False,
                        "traffic_level": "zero"
                    }
                self._rooms_probe_cache[rid] = (now, res)
                results[rid] = res

        return results


# Singleton instance
ysf_dir_mgr = YsfDirectoryManager()
