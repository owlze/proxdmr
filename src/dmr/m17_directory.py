# -*- coding: utf-8 -*-
"""
M17 Reflector Directory Manager (mrefd / urfd / vex).
Downloads, normalizes, and caches M17Hosts.json + RefCheck status,
parses live mrefd/urfd HTML dashboards, and powers the M17 Dice & Top Active scanner.
"""

import asyncio
import html as html_lib
from html.parser import HTMLParser
import json
import logging
import random
import re
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("proxdmr.m17_directory")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
M17_HOSTS_CACHE = DATA_DIR / "m17_hosts_cache.json"
M17_TOP_ACTIVE_CACHE = DATA_DIR / "m17_top_active_cache.json"
M17_HOSTS_TTL_SEC = 12 * 3600
M17_ACTIVE_SCAN_TTL_SEC = 1800  # 30 min
M17_DASH_CACHE_TTL_SEC = 30.0

M17_HOSTS_JSON_URL = "https://m17-project.github.io/hostfiles/M17Hosts.json"
M17_HOSTS_TXT_URLS = [
    "https://m17-project.github.io/hostfiles/M17Hosts.txt",
    "https://www.pistar.uk/downloads/M17_Hosts.txt",
    "http://pistar.uk/downloads/M17_Hosts.txt",
]
REFCHECK_URL = "https://refcheck.radio/"

FALLBACK_M17_REFLECTORS: List[Dict[str, Any]] = [
    {"designator": "M17-M17", "name": "M17 Project Official Reflector", "host": "107.191.121.105", "port": 17000, "url": "https://m17.openquad.net/", "server_type": "mrefd", "modules": ["A", "B", "C", "D"], "country": "US", "country_code": "US", "country_name": "United States"},
    {"designator": "M17-USA", "name": "M17 USA Reflector", "host": "m17-usa.openquad.net", "port": 17000, "url": "https://m17-usa.openquad.net/", "server_type": "mrefd", "modules": ["A", "B", "C", "D", "E"], "country": "US", "country_code": "US", "country_name": "United States"},
    {"designator": "M17-FRA", "name": "M17 France Reflector", "host": "m17-fra.openquad.net", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "FR", "country_code": "FR", "country_name": "France"},
    {"designator": "M17-ITA", "name": "M17 Italy Reflector", "host": "m17.iz2kvr.it", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "IT", "country_code": "IT", "country_name": "Italy"},
    {"designator": "M17-NLD", "name": "M17 Netherlands Reflector", "host": "m17.nld.ham-dmr.nl", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "NL", "country_code": "NL", "country_name": "Netherlands"},
    {"designator": "M17-LIM", "name": "M17 Limburg Reflector", "host": "m17.limburg-on-air.nl", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "NL", "country_code": "NL", "country_name": "Netherlands"},
    {"designator": "M17-BEL", "name": "M17 Belgium Reflector", "host": "m17.on4am.be", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "BE", "country_code": "BE", "country_name": "Belgium"},
    {"designator": "M17-CZ1", "name": "M17 Czechia Reflector", "host": "m17.ok0x.cz", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "CZ", "country_code": "CZ", "country_name": "Czechia"},
    {"designator": "M17-002", "name": "M17-002 Reflector", "host": "m17-002.dstarradio.com", "port": 17000, "url": "", "server_type": "mrefd", "modules": ["A", "B", "C"], "country": "DE", "country_code": "DE", "country_name": "Germany"},
    {"designator": "URF045", "name": "URF045 PennLink Multiprotocol", "host": "urf045.pennlinkgroup.com", "port": 17000, "url": "http://urf045.pennlinkgroup.com:8082/urfd/", "server_type": "urfd", "modules": ["A", "B", "C"], "country": "US", "country_code": "US", "country_name": "United States"},
    {"designator": "URF018", "name": "URF018 Multiprotocol Reflector", "host": "urf018.dstar.su", "port": 17000, "url": "", "server_type": "urfd", "modules": ["A", "B", "C"], "country": "GLOBAL", "country_code": "XX", "country_name": "International"},
    {"designator": "VEX777", "name": "VEX777 M17 Reflector", "host": "vex777.m17.link", "port": 17000, "url": "", "server_type": "vex", "modules": ["A", "B", "C"], "country": "GLOBAL", "country_code": "XX", "country_name": "International"},
]


def _country_to_cc(country_str: str, designator: str = "") -> Tuple[str, str, str]:
    raw = str(country_str or "").strip()
    if len(raw) == 2 and raw.isalpha():
        cc = raw.upper()
        return ("GLOBAL" if cc == "XX" else cc), cc, raw
    lower = raw.lower()
    mapping = {
        "united states": ("US", "US", "United States"),
        "usa": ("US", "US", "United States"),
        "germany": ("DE", "DE", "Germany"),
        "france": ("FR", "FR", "France"),
        "united kingdom": ("GB", "GB", "United Kingdom"),
        "uk": ("GB", "GB", "United Kingdom"),
        "italy": ("IT", "IT", "Italy"),
        "netherlands": ("NL", "NL", "Netherlands"),
        "belgium": ("BE", "BE", "Belgium"),
        "poland": ("PL", "PL", "Poland"),
        "spain": ("ES", "ES", "Spain"),
        "canada": ("CA", "CA", "Canada"),
        "australia": ("AU", "AU", "Australia"),
        "japan": ("JP", "JP", "Japan"),
        "brazil": ("BR", "BR", "Brazil"),
        "switzerland": ("CH", "CH", "Switzerland"),
        "austria": ("AT", "AT", "Austria"),
        "czech republic": ("CZ", "CZ", "Czechia"),
        "czechia": ("CZ", "CZ", "Czechia"),
        "russia": ("RU", "RU", "Russia"),
        "ukraine": ("UA", "UA", "Ukraine"),
        "sweden": ("SE", "SE", "Sweden"),
        "norway": ("NO", "NO", "Norway"),
        "finland": ("FI", "FI", "Finland"),
        "denmark": ("DK", "DK", "Denmark"),
        "portugal": ("PT", "PT", "Portugal"),
        "ireland": ("IE", "IE", "Ireland"),
        "new zealand": ("NZ", "NZ", "New Zealand"),
    }
    if lower in mapping:
        return mapping[lower]
    des = str(designator or "").upper()
    if "USA" in des:
        return "US", "US", "United States"
    if "FRA" in des:
        return "FR", "FR", "France"
    if "ITA" in des:
        return "IT", "IT", "Italy"
    if "NLD" in des or "LIM" in des:
        return "NL", "NL", "Netherlands"
    if "BEL" in des:
        return "BE", "BE", "Belgium"
    if "RUS" in des:
        return "RU", "RU", "Russia"
    return "GLOBAL", "XX", raw or "International"


def _detect_server_type(item: dict) -> str:
    des = str(item.get("designator") or "").strip().upper()
    src = str(item.get("source") or item.get("server_type") or "").strip().lower()
    mods = item.get("modules")
    if "urfd" in src or des.startswith("URF") or item.get("enabled_modes"):
        return "urfd"
    if isinstance(mods, list) and mods and isinstance(mods[0], dict):
        return "urfd"
    if "vex" in src or des.startswith("VEX"):
        return "vex"
    return "mrefd"


def normalize_m17_host_entry(item: dict) -> Optional[Dict[str, Any]]:
    if not isinstance(item, dict):
        return None
    des = str(item.get("designator") or item.get("id") or "").strip().upper()[:8]
    host = str(item.get("dns") or item.get("host") or item.get("ipv4") or "").strip()
    if not des or not host:
        return None
    try:
        port = int(item.get("port") or 17000)
        if not (1 <= port <= 65535):
            port = 17000
    except (TypeError, ValueError):
        port = 17000

    server_type = _detect_server_type(item)
    encrypted_set: Set[str] = set()
    for em in (item.get("encrypted") or []):
        ch = re.sub(r"[^A-Z]", "", str(em or "").upper())
        if ch:
            encrypted_set.add(ch[0])

    raw_mods = item.get("modules") or []
    modules_meta: Dict[str, Dict[str, Any]] = {}
    all_letters: List[str] = []
    compat_letters: List[str] = []

    if isinstance(raw_mods, list):
        for entry in raw_mods:
            if isinstance(entry, dict):
                m_ch = re.sub(r"[^A-Z]", "", str(entry.get("module") or "").upper())
                if not m_ch:
                    continue
                m_letter = m_ch[0]
                mode_str = str(entry.get("mode") or "M17").strip()
                desc_str = str(entry.get("description") or "").strip()
                transcode = bool(entry.get("transcode", False))
                m17_compat = transcode or mode_str.lower() in ("all", "m17", "")
                is_enc = (m_letter in encrypted_set) or bool(entry.get("encrypted", False))
                modules_meta[m_letter] = {
                    "module": m_letter,
                    "mode": mode_str or "M17",
                    "description": desc_str,
                    "transcode": transcode,
                    "m17_compatible": m17_compat,
                    "encrypted": is_enc,
                }
                if m_letter not in all_letters:
                    all_letters.append(m_letter)
                if m17_compat and m_letter not in compat_letters:
                    compat_letters.append(m_letter)
            else:
                m_ch = re.sub(r"[^A-Z]", "", str(entry or "").upper())
                if not m_ch:
                    continue
                m_letter = m_ch[0]
                is_enc = m_letter in encrypted_set
                modules_meta[m_letter] = {
                    "module": m_letter,
                    "mode": "M17",
                    "description": "",
                    "transcode": False,
                    "m17_compatible": True,
                    "encrypted": is_enc,
                }
                if m_letter not in all_letters:
                    all_letters.append(m_letter)
                if m_letter not in compat_letters:
                    compat_letters.append(m_letter)

    all_letters.sort()
    compat_letters.sort()
    modules = compat_letters if compat_letters else (all_letters if all_letters else ["A", "C"])
    if not modules_meta:
        for m_letter in modules:
            modules_meta[m_letter] = {
                "module": m_letter,
                "mode": "M17",
                "description": "",
                "transcode": False,
                "m17_compatible": True,
                "encrypted": m_letter in encrypted_set,
            }

    country, cc, cname = _country_to_cc(item.get("country") or item.get("country_name") or "", des)
    if item.get("country_code") and len(str(item["country_code"])) == 2:
        cc = str(item["country_code"]).upper()
        country = "GLOBAL" if cc == "XX" else cc

    return {
        "id": des,
        "designator": des,
        "name": str(item.get("name") or des).strip(),
        "host": host,
        "ipv4": str(item.get("ipv4") or "").strip(),
        "port": port,
        "url": str(item.get("url") or "").strip(),
        "server_type": server_type,
        "modules": modules,
        "all_modules": all_letters if all_letters else modules,
        "modules_meta": modules_meta,
        "encrypted": sorted(encrypted_set),
        "enabled_modes": list(item.get("enabled_modes") or (["M17"] if server_type != "urfd" else ["M17"])),
        "country": country,
        "country_code": cc,
        "country_name": cname,
        "sponsor": str(item.get("sponsor") or "").strip(),
        "is_down": bool(item.get("is_down", False)),
    }


def parse_m17_hosts_json(raw_json: str) -> List[Dict[str, Any]]:
    data = json.loads(raw_json)
    items = data.get("reflectors", []) if isinstance(data, dict) else (data if isinstance(data, list) else [])
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for item in items:
        norm = normalize_m17_host_entry(item)
        if norm and norm["designator"] not in seen:
            seen.add(norm["designator"])
            out.append(norm)
    return out


def parse_m17_hosts_txt(raw_text: str) -> List[Dict[str, Any]]:
    out: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    for line in (raw_text or "").splitlines():
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        # Format: M17-M17;host;port;modules or whitespace separated
        parts = s.split(";") if ";" in s else s.split()
        if len(parts) < 2:
            continue
        des = parts[0].strip().upper()[:8]
        host = parts[1].strip()
        port = 17000
        if len(parts) >= 3 and parts[2].strip().isdigit():
            port = int(parts[2].strip())
        mods = list("AC")
        if len(parts) >= 4:
            parsed_mods = [c for c in parts[3].upper() if "A" <= c <= "Z"]
            if parsed_mods:
                mods = sorted(set(parsed_mods))
        norm = normalize_m17_host_entry({
            "designator": des,
            "name": des,
            "host": host,
            "port": port,
            "modules": mods,
        })
        if norm and norm["designator"] not in seen:
            seen.add(norm["designator"])
            out.append(norm)
    return out


def fetch_refcheck_down_m17_ids() -> Set[str]:
    """Fetch currently down/unreachable M17 reflectors from refcheck.radio."""
    try:
        req = urllib.request.Request(
            REFCHECK_URL,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"},
        )
        with urllib.request.urlopen(req, timeout=6) as resp:
            html_str = resp.read().decode("utf-8", errors="ignore")
        m = re.search(r'<script\s+id="reflector-data"\s+type="application/json">(.*?)</script>', html_str, re.DOTALL)
        if m:
            data = json.loads(m.group(1))
            down_ids = {
                str(d.get("id") or d.get("designator") or "").strip().upper()
                for d in data
                if str(d.get("mode") or "").strip().lower() == "m17"
            }
            down_ids.discard("")
            logger.info(f"[M17_DIR] Loaded {len(down_ids)} down M17 reflectors from RefCheck")
            return down_ids
    except Exception as e:
        logger.warning(f"[M17_DIR] Could not load RefCheck M17 outages: {e}")
    return set()


def _strip_html(s: str) -> str:
    txt = re.sub(r"<[^>]+>", " ", s or "")
    txt = html_lib.unescape(txt)
    return re.sub(r"\s+", " ", txt).strip()


class _M17DashTableParser(HTMLParser):
    """Minimal zero-dependency nested HTML table parser for mrefd/urfd dashboards."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.top_tables: List[Dict[str, Any]] = []
        self._stack: List[Dict[str, Any]] = []

    def handle_starttag(self, tag: str, attrs: list) -> None:
        t = tag.lower()
        if t == "table":
            tbl: Dict[str, Any] = {"rows": []}
            if not self._stack:
                self.top_tables.append(tbl)
            else:
                parent = self._stack[-1]
                if parent["rows"] and parent["rows"][-1]:
                    parent["rows"][-1][-1]["nested"].append(tbl)
            self._stack.append(tbl)
        elif t == "tr" and self._stack:
            self._stack[-1]["rows"].append([])
        elif t in ("td", "th") and self._stack and self._stack[-1]["rows"]:
            self._stack[-1]["rows"][-1].append({"tag": t, "parts": [], "nested": []})
        elif t == "br" and self._stack and self._stack[-1]["rows"] and self._stack[-1]["rows"][-1]:
            self._stack[-1]["rows"][-1][-1]["parts"].append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "table" and self._stack:
            self._stack.pop()

    def handle_data(self, data: str) -> None:
        if self._stack and self._stack[-1]["rows"] and self._stack[-1]["rows"][-1]:
            s = re.sub(r"\s+", " ", data).strip()
            if s:
                self._stack[-1]["rows"][-1][-1]["parts"].append(s)


def _dash_cell_text(cell: Dict[str, Any]) -> str:
    return re.sub(r"\s+", " ", " ".join(cell.get("parts") or [])).strip()


def _extract_dash_module_letter(header_text: str) -> str:
    s = (header_text or "").strip()
    if not s:
        return ""
    m_mod = re.search(r"\bModule\s+([A-Z])\b", s, re.IGNORECASE)
    if m_mod:
        return m_mod.group(1).upper()
    m_end = re.search(r"(?:^|\s)([A-Z])\s*$", s)
    if m_end:
        return m_end.group(1).upper()
    return ""


def parse_m17_dashboard_html(html_str: str) -> Dict[str, Any]:
    """
    Parse both mrefd (https://m17.openquad.net/) and urfd (http://.../urfd/) HTML dashboards
    using nested-table-aware HTMLParser.
    Returns {links_count, peers_count, module_clients, last_heard}.
    """
    if not html_str:
        return {"links_count": 0, "peers_count": 0, "module_clients": {}, "last_heard": []}

    links_count = 0
    peers_count = 0
    m_links = re.search(r"Links\s*\(\s*(\d+)\s*\)", html_str, re.IGNORECASE)
    if m_links:
        links_count = int(m_links.group(1))
    m_peers = re.search(r"Peers\s*\(\s*(\d+)\s*\)", html_str, re.IGNORECASE)
    if m_peers:
        peers_count = int(m_peers.group(1))

    parser = _M17DashTableParser()
    try:
        parser.feed(html_str)
    except Exception:
        pass

    module_clients: Dict[str, List[str]] = {}
    last_heard: List[Dict[str, Any]] = []

    for tbl in parser.top_tables:
        rows = tbl.get("rows") or []
        if len(rows) < 2:
            continue

        # 1. Detect Last Heard table by column headers (Source/Callsign/Indicativo + Last heard)
        hdr_idx = -1
        col_cs = -1
        col_tm = -1
        col_mod = -1
        for ri, row in enumerate(rows[:4]):
            if not row or len(row) < 4:
                continue
            if not any(c["tag"] == "th" for c in row):
                continue
            th_texts = [_dash_cell_text(c).lower() for c in row]
            found_cs = -1
            found_tm = -1
            found_mod = -1
            for ci, txt in enumerate(th_texts):
                if found_cs < 0 and any(k in txt for k in ("source", "callsign", "indicativo", "mycall")):
                    found_cs = ci
                elif found_tm < 0 and any(k in txt for k in ("last heard", "lastheard", "última atividade", "ultima atividade", "time", "date")):
                    found_tm = ci
                elif found_mod < 0 and ("module" in txt or txt in ("mod", "m")):
                    found_mod = ci
            if found_cs >= 0 and found_tm >= 0:
                hdr_idx = ri
                col_cs = found_cs
                col_tm = found_tm
                col_mod = found_mod
                break

        if hdr_idx >= 0 and not last_heard:
            for row in rows[hdr_idx + 1:]:
                if len(row) <= max(col_cs, col_tm):
                    continue
                if all(c["tag"] == "th" for c in row):
                    continue
                cs = _dash_cell_text(row[col_cs]).upper()
                if not cs or cs in ("SOURCE", "CALLSIGN", "INDICATIVO", "NONE", "---"):
                    continue
                tm = _dash_cell_text(row[col_tm])
                mod = ""
                if col_mod >= 0 and col_mod < len(row):
                    cand_m = _dash_cell_text(row[col_mod]).upper()
                    if len(cand_m) == 1 and "A" <= cand_m <= "Z":
                        mod = cand_m
                if not mod:
                    last_c = _dash_cell_text(row[-1]).upper()
                    if len(last_c) == 1 and "A" <= last_c <= "Z":
                        mod = last_c
                last_heard.append({
                    "callsign": cs,
                    "module": mod or "C",
                    "time": tm,
                })
                if len(last_heard) >= 25:
                    break
            continue

        # 2. Detect Modules table (header row of module letters + data row with nested callsign tables)
        hdr_row = rows[0]
        if hdr_row and all(c["tag"] == "th" for c in hdr_row):
            mod_letters = [_extract_dash_module_letter(_dash_cell_text(c)) for c in hdr_row]
            if mod_letters and all(mod_letters):
                data_row = rows[1]
                if len(data_row) == len(mod_letters):
                    for idx, mod_letter in enumerate(mod_letters):
                        cell = data_row[idx]
                        cs_list: List[str] = []
                        if cell["nested"]:
                            for nt in cell["nested"]:
                                for nr in nt.get("rows") or []:
                                    for nc in nr:
                                        txt = _dash_cell_text(nc).upper()
                                        if txt and txt not in ("NONE", "EMPTY", "LINK", "MODE", "MODULE") and txt not in cs_list:
                                            cs_list.append(txt)
                        else:
                            for tok in re.findall(r"\b([A-Z0-9]{3,8}(?:\s+[A-Z0-9]|/[A-Z0-9]+)?)\b", _dash_cell_text(cell).upper()):
                                if tok not in ("NONE", "EMPTY", "LINK", "MODE", "MODULE") and tok not in cs_list:
                                    cs_list.append(tok)
                        module_clients[mod_letter] = cs_list

    if links_count == 0 and module_clients:
        links_count = sum(len(v) for v in module_clients.values())

    return {
        "links_count": links_count,
        "peers_count": peers_count,
        "module_clients": module_clients,
        "last_heard": last_heard,
    }


class M17DirectoryManager:
    """Singleton manager for M17 hosts registry, RefCheck, live dashboards, and Dice."""

    def __init__(self) -> None:
        self._hosts: List[Dict[str, Any]] = []
        self._hosts_by_des: Dict[str, Dict[str, Any]] = {}
        self._last_updated: float = 0.0
        self._top_active: List[Dict[str, Any]] = []
        self._last_active_scan: float = 0.0
        self._dash_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._dash_sem = asyncio.Semaphore(8)
        self._lock = asyncio.Lock()
        self._load_caches()

    def _load_caches(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        if M17_HOSTS_CACHE.exists():
            try:
                raw = json.loads(M17_HOSTS_CACHE.read_text(encoding="utf-8"))
                hosts = raw.get("hosts", []) if isinstance(raw, dict) else []
                if hosts:
                    self._set_hosts(hosts)
                    self._last_updated = float(raw.get("updated_at", 0.0))
            except Exception as e:
                logger.warning(f"[M17_DIR] Failed reading hosts cache: {e}")

        if not self._hosts:
            fallback_norm = [h for h in (normalize_m17_host_entry(x) for x in FALLBACK_M17_REFLECTORS) if h]
            self._set_hosts(fallback_norm)

        if M17_TOP_ACTIVE_CACHE.exists():
            try:
                raw_top = json.loads(M17_TOP_ACTIVE_CACHE.read_text(encoding="utf-8"))
                if isinstance(raw_top, dict):
                    self._top_active = raw_top.get("items", []) or []
                    self._last_active_scan = float(raw_top.get("updated_at", 0.0))
            except Exception:
                pass

    def _set_hosts(self, hosts: List[Dict[str, Any]]) -> None:
        self._hosts = list(hosts)
        self._hosts_by_des = {str(h["designator"]).upper(): h for h in self._hosts if h.get("designator")}

    def get_hosts(self) -> List[Dict[str, Any]]:
        return list(self._hosts)

    def find_host(self, query: str) -> Optional[Dict[str, Any]]:
        q = str(query or "").strip().upper()
        if not q:
            return None
        if q in self._hosts_by_des:
            return self._hosts_by_des[q]
        ql = q.lower()
        for h in self._hosts:
            if str(h.get("host", "")).lower() == ql or str(h.get("ipv4", "")).lower() == ql:
                return h
        return None

    async def refresh_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        if not force and self._hosts and (time.time() - self._last_updated) < M17_HOSTS_TTL_SEC and len(self._hosts) > 20:
            return self.get_hosts()

        async with self._lock:
            if not force and self._hosts and (time.time() - self._last_updated) < M17_HOSTS_TTL_SEC and len(self._hosts) > 20:
                return self.get_hosts()

            loop = asyncio.get_running_loop()

            def _fetch_sync() -> Tuple[List[Dict[str, Any]], Set[str]]:
                parsed: List[Dict[str, Any]] = []
                try:
                    req = urllib.request.Request(M17_HOSTS_JSON_URL, headers={"User-Agent": "ProxDMR/2.0"})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        raw_json = resp.read().decode("utf-8", errors="ignore")
                    parsed = parse_m17_hosts_json(raw_json)
                except Exception as e:
                    logger.warning(f"[M17_DIR] M17Hosts.json fetch failed: {e}")

                if not parsed:
                    for txt_url in M17_HOSTS_TXT_URLS:
                        try:
                            req = urllib.request.Request(txt_url, headers={"User-Agent": "ProxDMR/2.0"})
                            with urllib.request.urlopen(req, timeout=8) as resp:
                                raw_txt = resp.read().decode("utf-8", errors="ignore")
                            parsed = parse_m17_hosts_txt(raw_txt)
                            if parsed:
                                break
                        except Exception:
                            continue

                down_ids = fetch_refcheck_down_m17_ids()
                return parsed, down_ids

            parsed, down_ids = await loop.run_in_executor(None, _fetch_sync)
            if parsed:
                for h in parsed:
                    h["is_down"] = h["designator"].upper() in down_ids
                self._set_hosts(parsed)
                self._last_updated = time.time()
                try:
                    DATA_DIR.mkdir(parents=True, exist_ok=True)
                    M17_HOSTS_CACHE.write_text(
                        json.dumps({"updated_at": self._last_updated, "hosts": self._hosts}, ensure_ascii=False),
                        encoding="utf-8",
                    )
                except Exception as e:
                    logger.warning(f"[M17_DIR] Failed writing hosts cache: {e}")
                logger.info(f"[M17_DIR] Refreshed {len(self._hosts)} M17 reflectors (down={len(down_ids)})")
            return self.get_hosts()

    async def fetch_reflector_dashboard_live(self, url: str, force: bool = False) -> Dict[str, Any]:
        u = str(url or "").strip()
        if not u or not (u.startswith("http://") or u.startswith("https://")):
            return {"links_count": 0, "peers_count": 0, "module_clients": {}, "last_heard": []}

        now = time.time()
        if not force and u in self._dash_cache:
            ts, cached = self._dash_cache[u]
            if (now - ts) < M17_DASH_CACHE_TTL_SEC:
                return cached

        async with self._dash_sem:
            loop = asyncio.get_running_loop()

            def _get_html() -> str:
                req = urllib.request.Request(u, headers={"User-Agent": "ProxDMR/2.0"})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    return resp.read().decode("utf-8", errors="ignore")

            try:
                raw_html = await loop.run_in_executor(None, _get_html)
                parsed = parse_m17_dashboard_html(raw_html)
            except Exception:
                parsed = {"links_count": 0, "peers_count": 0, "module_clients": {}, "last_heard": []}

            self._dash_cache[u] = (time.time(), parsed)
            return parsed

    async def refresh_top_active(self, max_scan: int = 35) -> List[Dict[str, Any]]:
        if self._top_active and (time.time() - self._last_active_scan) < M17_ACTIVE_SCAN_TTL_SEC:
            return list(self._top_active)

        candidates = [h for h in self._hosts if not h.get("is_down") and h.get("url")]
        if not candidates:
            candidates = [h for h in self._hosts if not h.get("is_down")]

        # Prioritize well-known + random slice so total scan stays fast
        priority_des = {"M17-M17", "M17-USA", "M17-FRA", "M17-ITA", "M17-NLD", "M17-LIM", "M17-BEL", "M17-CZ1", "M17-002", "URF045", "URF018", "VEX777"}
        prio = [h for h in candidates if h["designator"] in priority_des]
        rest = [h for h in candidates if h["designator"] not in priority_des]
        random.shuffle(rest)
        to_scan = (prio + rest)[:max_scan]

        async def _scan_one(h: Dict[str, Any]) -> Optional[Dict[str, Any]]:
            dash = await self.fetch_reflector_dashboard_live(h.get("url", ""), force=False)
            links = int(dash.get("links_count") or 0)
            lh = dash.get("last_heard") or []
            mod_clients = dash.get("module_clients") or {}
            best_mod = "C" if "C" in (h.get("modules") or []) else ((h.get("modules") or ["A"])[0])
            best_cnt = 0
            for m_letter in (h.get("modules") or []):
                meta = (h.get("modules_meta") or {}).get(m_letter, {})
                if meta.get("encrypted") or not meta.get("m17_compatible", True):
                    continue
                cnt = len(mod_clients.get(m_letter) or [])
                if cnt > best_cnt:
                    best_cnt = cnt
                    best_mod = m_letter
            if best_cnt == 0 and lh:
                lh_mod = str(lh[0].get("module") or "").upper()
                if lh_mod in (h.get("modules") or []):
                    meta = (h.get("modules_meta") or {}).get(lh_mod, {})
                    if not meta.get("encrypted") and meta.get("m17_compatible", True):
                        best_mod = lh_mod
            return {
                "designator": h["designator"],
                "name": h["name"],
                "host": h["host"],
                "port": h["port"],
                "url": h.get("url", ""),
                "server_type": h.get("server_type", "mrefd"),
                "module": best_mod,
                "links_count": max(links, best_cnt),
                "has_last_heard": bool(lh),
                "last_caller": str(lh[0].get("callsign") or "") if lh else "",
                "last_heard_time": str(lh[0].get("time") or "") if lh else "",
                "country_code": h.get("country_code", "XX"),
            }

        results = await asyncio.gather(*[_scan_one(h) for h in to_scan], return_exceptions=True)
        items = [r for r in results if isinstance(r, dict)]
        items.sort(key=lambda x: (1 if x["has_last_heard"] else 0, x["links_count"]), reverse=True)
        self._top_active = items[:100]
        self._last_active_scan = time.time()
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            M17_TOP_ACTIVE_CACHE.write_text(
                json.dumps({"updated_at": self._last_active_scan, "items": self._top_active}, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass
        return list(self._top_active)

    def get_top_active(self) -> List[Dict[str, Any]]:
        return list(self._top_active)

    async def pick_dice_target(
        self,
        exclude_keys: Optional[Set[str]] = None,
        min_links: int = 0,
        prefer_recent_min: int = 60,
    ) -> Optional[Dict[str, Any]]:
        excl = {str(k).strip().upper() for k in (exclude_keys or set()) if k}
        if not self._top_active:
            await self.refresh_top_active(max_scan=20)

        pool = []
        for item in self._top_active:
            des = str(item.get("designator") or "").upper()
            mod = str(item.get("module") or "C").upper()
            key = f"{des}:{mod}"
            if des in excl or key in excl:
                continue
            host_obj = self.find_host(des)
            if host_obj and host_obj.get("is_down"):
                continue
            if int(item.get("links_count") or 0) < min_links and not item.get("has_last_heard"):
                continue
            pool.append(item)

        if pool:
            active_pool = [p for p in pool if p.get("has_last_heard") or p.get("links_count", 0) > 0]
            return random.choice(active_pool if active_pool else pool)

        # Fallback to any non-down reflector in registry
        fallback_pool = []
        for h in self._hosts:
            if h.get("is_down"):
                continue
            des = h["designator"].upper()
            valid_mods = [
                m for m in (h.get("modules") or ["C"])
                if not (h.get("modules_meta") or {}).get(m, {}).get("encrypted")
                and (h.get("modules_meta") or {}).get(m, {}).get("m17_compatible", True)
            ]
            if not valid_mods:
                continue
            mod = "C" if "C" in valid_mods else valid_mods[0]
            if des in excl or f"{des}:{mod}" in excl:
                continue
            fallback_pool.append({
                "designator": des,
                "name": h["name"],
                "host": h["host"],
                "port": h["port"],
                "url": h.get("url", ""),
                "server_type": h.get("server_type", "mrefd"),
                "module": mod,
                "links_count": 0,
                "country_code": h.get("country_code", "XX"),
            })
        return random.choice(fallback_pool) if fallback_pool else None

    async def periodic_update_loop(self) -> None:
        while True:
            try:
                await self.refresh_hosts(force=False)
                await self.refresh_top_active(max_scan=25)
            except Exception as e:
                logger.warning(f"[M17_DIR] Periodic update error: {e}")
            await asyncio.sleep(1800)


m17_dir_mgr = M17DirectoryManager()
