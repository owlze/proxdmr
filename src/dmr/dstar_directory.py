# -*- coding: utf-8 -*-
"""
dstar_directory.py - D-STAR Reflector Directory Manager for ProxDMR.
Downloads, merges and caches DExtra, DCS, and DPlus hosts from Pi-Star and XLX catalogs,
manages reflector dashboards, and discovers active rooms/modules.
"""

import asyncio
from html.parser import HTMLParser
import json
import logging
import re
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("proxdmr.dstar_directory")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DSTAR_HOSTS_CACHE = DATA_DIR / "dstar_hosts_cache.json"
DSTAR_TOP_ACTIVE_CACHE = DATA_DIR / "dstar_top_active_cache.json"
XLX_HOSTS_CACHE = DATA_DIR / "xlx_hosts_cache.json"

DSTAR_HOSTS_TTL_SEC = 12 * 3600
DSTAR_DASH_CACHE_TTL_SEC = 30.0

DEXTRA_HOSTS_URL = "https://www.pistar.uk/downloads/DExtra_Hosts.txt"
DCS_HOSTS_URL = "https://www.pistar.uk/downloads/DCS_Hosts.txt"
DPLUS_HOSTS_URL = "https://www.pistar.uk/downloads/DPlus_Hosts.txt"

FALLBACK_DSTAR_REFLECTORS: List[Dict[str, Any]] = [
    {
        "id": "XLX250",
        "designator": "XLX250",
        "name": "XLX250 Russia Multiprotocol",
        "host": "xlx250.duckdns.org",
        "port": 30001,
        "protocol": "dextra",
        "supported_protocols": ["dextra", "dcs"],
        "url": "http://xlx250.duckdns.org",
        "modules": ["A", "B", "C", "D", "E"],
        "country": "RU",
        "country_code": "RU",
        "country_name": "Russia",
        "sponsor": "Russian Hamradio Community"
    },
    {
        "id": "XLX777",
        "designator": "XLX777",
        "name": "XLX777 International",
        "host": "xlx777.dstar.su",
        "port": 30001,
        "protocol": "dextra",
        "supported_protocols": ["dextra", "dcs"],
        "url": "http://xlx777.dstar.su",
        "modules": ["A", "B", "C", "D"],
        "country": "XX",
        "country_code": "XX",
        "country_name": "International",
        "sponsor": "XLX777 Group"
    },
    {
        "id": "REF001",
        "designator": "REF001",
        "name": "REF001 Worldwide DPlus",
        "host": "ref001.dstargateway.org",
        "port": 20001,
        "protocol": "dplus",
        "supported_protocols": ["dplus"],
        "url": "http://ref001.dstargateway.org",
        "modules": ["A", "B", "C", "D"],
        "country": "US",
        "country_code": "US",
        "country_name": "United States",
        "sponsor": "D-STAR US-TRUST"
    },
    {
        "id": "REF030",
        "designator": "REF030",
        "name": "REF030 USA High Activity",
        "host": "ref030.dstargateway.org",
        "port": 20001,
        "protocol": "dplus",
        "supported_protocols": ["dplus"],
        "url": "http://ref030.dstargateway.org",
        "modules": ["A", "B", "C", "D"],
        "country": "US",
        "country_code": "US",
        "country_name": "United States",
        "sponsor": "Georgia D-STAR"
    },
    {
        "id": "DCS001",
        "designator": "DCS001",
        "name": "DCS001 Global DCS Reflector",
        "host": "dcs001.xreflector.net",
        "port": 30051,
        "protocol": "dcs",
        "supported_protocols": ["dcs"],
        "url": "http://dcs001.xreflector.net",
        "modules": ["A", "B", "C", "D", "E"],
        "country": "DE",
        "country_code": "DE",
        "country_name": "Germany",
        "sponsor": "DCS System"
    },
    {
        "id": "DCS002",
        "designator": "DCS002",
        "name": "DCS002 Europe DCS Reflector",
        "host": "dcs002.xreflector.net",
        "port": 30051,
        "protocol": "dcs",
        "supported_protocols": ["dcs"],
        "url": "http://dcs002.xreflector.net",
        "modules": ["A", "B", "C", "D"],
        "country": "DE",
        "country_code": "DE",
        "country_name": "Germany",
        "sponsor": "DCS System"
    },
    {
        "id": "XRF001",
        "designator": "XRF001",
        "name": "XRF001 DExtra System",
        "host": "xrf001.openquad.net",
        "port": 30001,
        "protocol": "dextra",
        "supported_protocols": ["dextra"],
        "url": "http://xrf001.openquad.net",
        "modules": ["A", "B", "C", "D"],
        "country": "US",
        "country_code": "US",
        "country_name": "United States",
        "sponsor": "OpenQuad"
    },
    {
        "id": "XRF002",
        "designator": "XRF002",
        "name": "XRF002 DExtra Reflector",
        "host": "xrf002.openquad.net",
        "port": 30001,
        "protocol": "dextra",
        "supported_protocols": ["dextra"],
        "url": "http://xrf002.openquad.net",
        "modules": ["A", "B", "C", "D"],
        "country": "US",
        "country_code": "US",
        "country_name": "United States",
        "sponsor": "OpenQuad"
    },
    {
        "id": "XLX002",
        "designator": "XLX002",
        "name": "XLX002 Germany",
        "host": "xlx002.xreflector.net",
        "port": 30001,
        "protocol": "dextra",
        "supported_protocols": ["dextra", "dcs"],
        "url": "http://xlx002.xreflector.net",
        "modules": ["A", "B", "C", "D"],
        "country": "DE",
        "country_code": "DE",
        "country_name": "Germany",
        "sponsor": "DCS Germany"
    },
    {
        "id": "XLX950",
        "designator": "XLX950",
        "name": "XLX950 USA Multiprotocol",
        "host": "xlx950.com",
        "port": 30001,
        "protocol": "dextra",
        "supported_protocols": ["dextra", "dcs"],
        "url": "http://xlx950.com",
        "modules": ["A", "B", "C", "D", "E"],
        "country": "US",
        "country_code": "US",
        "country_name": "United States",
        "sponsor": "XLX950 Team"
    }
]


class DStarDashboardHTMLParser(HTMLParser):
    """Parses standard XLX/DCS/DStar dashboard HTML."""

    def __init__(self):
        super().__init__()
        self.in_table = False
        self.in_td = False
        self.current_row: List[str] = []
        self.rows: List[List[str]] = []
        self.connected_callsigns: List[str] = []
        self.links_count = 0
        self.modules_active: Dict[str, int] = {}

    def handle_starttag(self, tag, attrs):
        if tag == "table":
            self.in_table = True
        elif tag == "tr" and self.in_table:
            self.current_row = []
        elif tag in ("td", "th") and self.in_table:
            self.in_td = True

    def handle_endtag(self, tag):
        if tag == "table":
            self.in_table = False
        elif tag == "tr" and self.in_table:
            if self.current_row:
                self.rows.append(self.current_row)
            self.current_row = []
        elif tag in ("td", "th"):
            self.in_td = False

    def handle_data(self, data):
        if self.in_td:
            txt = data.strip()
            if txt:
                self.current_row.append(txt)


class DStarDirectoryManager:
    """Manages D-STAR host directories and dashboard fetching."""

    def __init__(self):
        self._hosts: List[Dict[str, Any]] = []
        self._hosts_by_designator: Dict[str, Dict[str, Any]] = {}
        self._top_active: List[Dict[str, Any]] = []
        self._last_loaded: float = 0.0
        self._last_active_scan: float = 0.0
        self._dash_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._lock = asyncio.Lock()
        self._bg_task: Optional[asyncio.Task] = None

        self._load_cached_hosts()

    def _load_cached_hosts(self):
        """Loads hosts from JSON cache if present, else fallback."""
        if DSTAR_HOSTS_CACHE.is_file():
            try:
                with open(DSTAR_HOSTS_CACHE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and "hosts" in data and isinstance(data["hosts"], list):
                    self._hosts = data["hosts"]
                    self._last_loaded = float(data.get("updated_at", 0.0))
                    self._rebuild_lookup()
                    logger.info(f"[DSTAR_DIR] Loaded {len(self._hosts)} reflectors from disk cache")
                    return
            except Exception as e:
                logger.warning(f"[DSTAR_DIR] Error reading hosts cache: {e}")

        self._hosts = list(FALLBACK_DSTAR_REFLECTORS)
        self._rebuild_lookup()

    def _rebuild_lookup(self):
        self._hosts_by_designator.clear()
        for h in self._hosts:
            desig = (h.get("designator") or h.get("id") or "").upper()
            if desig:
                self._hosts_by_designator[desig] = h

    def get_hosts(self) -> List[Dict[str, Any]]:
        return list(self._hosts)

    def get_probe_candidates(self, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Returns up to `limit` representative D-STAR reflectors for latency probing:
        1. Primary curated reflectors from FALLBACK_DSTAR_REFLECTORS (with live host metadata if present).
        2. Reflectors with known country metadata balanced across DExtra (XLX/XRF), DCS, and DPlus (REF).
        3. Remaining reflectors from the directory up to `limit`.
        """
        max_items = max(1, int(limit or 50))
        selected: List[Dict[str, Any]] = []
        seen_keys: Set[str] = set()

        def _add_item(item: Dict[str, Any]) -> bool:
            if not item or len(selected) >= max_items:
                return False
            desig = str(item.get("designator") or item.get("id") or "").strip().upper()
            host = str(item.get("host") or "").strip().lower()
            if not host:
                return False
            key = f"{desig}|{host}"
            if key in seen_keys:
                return False
            seen_keys.add(key)
            selected.append(dict(item))
            return True

        for fb in FALLBACK_DSTAR_REFLECTORS:
            desig = str(fb.get("designator") or fb.get("id") or "").strip().upper()
            live = self._hosts_by_designator.get(desig)
            if live:
                merged_fb = {**fb, **live}
                if fb.get("country") and fb.get("country") != "XX" and live.get("country") in (None, "", "XX"):
                    merged_fb["country"] = fb["country"]
                    merged_fb["country_code"] = fb.get("country_code") or fb["country"]
                    merged_fb["country_name"] = fb.get("country_name") or live.get("country_name") or fb["country"]
                _add_item(merged_fb)
            else:
                _add_item(fb)

        with_country = [
            h for h in self._hosts
            if str(h.get("country") or "").strip().upper() not in ("", "XX", "GLOBAL")
        ]
        by_proto: Dict[str, List[Dict[str, Any]]] = {"dextra": [], "dcs": [], "dplus": []}
        for h in with_country:
            p = str(h.get("protocol") or "dextra").strip().lower()
            by_proto.setdefault(p, []).append(h)

        idx = 0
        while len(selected) < max_items:
            added_in_round = False
            for p_key in ("dextra", "dcs", "dplus"):
                bucket = by_proto.get(p_key) or []
                if idx < len(bucket):
                    _add_item(bucket[idx])
                    added_in_round = True
                    if len(selected) >= max_items:
                        break
            if not added_in_round:
                break
            idx += 1

        if len(selected) < max_items:
            proto_all: Dict[str, List[Dict[str, Any]]] = {"dextra": [], "dcs": [], "dplus": []}
            for h in self._hosts:
                p = str(h.get("protocol") or "dextra").strip().lower()
                proto_all.setdefault(p, []).append(h)
            idx2 = 0
            while len(selected) < max_items:
                added_any = False
                for p_key in ("dextra", "dcs", "dplus"):
                    bucket = proto_all.get(p_key) or []
                    if idx2 < len(bucket):
                        _add_item(bucket[idx2])
                        added_any = True
                        if len(selected) >= max_items:
                            break
                if not added_any:
                    break
                idx2 += 1

        return selected

    def find_host(self, query: str) -> Optional[Dict[str, Any]]:
        clean = (query or "").strip().upper()
        if not clean:
            return None
        if clean in self._hosts_by_designator:
            return self._hosts_by_designator[clean]
        for desig, h in self._hosts_by_designator.items():
            if desig.startswith(clean) or clean in desig:
                return h
        return None

    async def ensure_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        if not force and self._hosts and (now - self._last_loaded < DSTAR_HOSTS_TTL_SEC):
            return self._hosts

        async with self._lock:
            if not force and self._hosts and (now - self._last_loaded < DSTAR_HOSTS_TTL_SEC):
                return self._hosts
            await self._refresh_hosts_worker()
            return self._hosts

    async def _refresh_hosts_worker(self):
        logger.info("[DSTAR_DIR] Fetching D-STAR host directories...")
        merged: Dict[str, Dict[str, Any]] = {}

        # 1. Load XLX cache for metadata enrichment
        xlx_meta: Dict[str, Dict[str, Any]] = {}
        if XLX_HOSTS_CACHE.is_file():
            try:
                with open(XLX_HOSTS_CACHE, "r", encoding="utf-8") as f:
                    xlx_data = json.load(f)
                servers = xlx_data.get("servers", [])
                for s in servers:
                    sid = (s.get("id") or "").upper()
                    if sid:
                        xlx_meta[sid] = s
            except Exception:
                pass

        # Helper to parse Pi-Star host text lines
        def parse_hosts_txt(text: str, default_proto: str, default_port: int):
            for line in text.splitlines():
                line = line.strip()
                if not line or line.startswith("#"):
                    continue
                parts = re.split(r"\s+", line)
                if len(parts) >= 2:
                    desig = parts[0].strip().upper()
                    host = parts[1].strip()
                    if not desig or not host:
                        continue

                    entry = merged.get(desig)
                    if not entry:
                        proto = default_proto
                        port = default_port
                        if desig.startswith("DCS"):
                            proto = "dcs"
                            port = 30051
                        elif desig.startswith("REF"):
                            proto = "dplus"
                            port = 20001
                        elif desig.startswith("XRF") or desig.startswith("XLX"):
                            proto = "dextra"
                            port = 30001

                        meta = xlx_meta.get(desig) or {}
                        country = meta.get("country") or "XX"
                        country_name = meta.get("country_name") or "International"
                        dash_url = meta.get("dashboard") or ""
                        sponsor = meta.get("comment") or ""

                        # Modules
                        modules = ["A", "B", "C", "D", "E"]

                        merged[desig] = {
                            "id": desig,
                            "designator": desig,
                            "name": meta.get("name") or f"{desig} Reflector",
                            "host": host,
                            "port": port,
                            "protocol": proto,
                            "supported_protocols": [proto],
                            "url": dash_url,
                            "modules": modules,
                            "country": country,
                            "country_code": country,
                            "country_name": country_name,
                            "sponsor": sponsor
                        }
                    else:
                        if default_proto not in entry["supported_protocols"]:
                            entry["supported_protocols"].append(default_proto)

        # Download Pi-Star host files
        loop = asyncio.get_running_loop()

        def fetch_url(url: str) -> str:
            req = urllib.request.Request(url, headers={"User-Agent": "ProxDMR/2.9"})
            with urllib.request.urlopen(req, timeout=8) as resp:
                return resp.read().decode("utf-8", errors="replace")

        for url, proto, port in [
            (DEXTRA_HOSTS_URL, "dextra", 30001),
            (DCS_HOSTS_URL, "dcs", 30051),
            (DPLUS_HOSTS_URL, "dplus", 20001),
        ]:
            try:
                content = await loop.run_in_executor(None, fetch_url, url)
                parse_hosts_txt(content, proto, port)
                logger.info(f"[DSTAR_DIR] Fetched {url} -> current hosts: {len(merged)}")
            except Exception as e:
                logger.warning(f"[DSTAR_DIR] Failed to fetch {url}: {e}")

        # Integrate Fallback if empty or supplement
        for fb in FALLBACK_DSTAR_REFLECTORS:
            desig = fb["designator"]
            if desig not in merged:
                merged[desig] = dict(fb)

        result_list = sorted(merged.values(), key=lambda x: x["designator"])
        self._hosts = result_list
        self._last_loaded = time.time()
        self._rebuild_lookup()

        # Save cache
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            with open(DSTAR_HOSTS_CACHE, "w", encoding="utf-8") as f:
                json.dump({"updated_at": self._last_loaded, "count": len(self._hosts), "hosts": self._hosts}, f, indent=2)
            logger.info(f"[DSTAR_DIR] Saved {len(self._hosts)} D-STAR reflectors to {DSTAR_HOSTS_CACHE}")
        except Exception as e:
            logger.error(f"[DSTAR_DIR] Error saving hosts cache: {e}")

    async def fetch_reflector_dashboard_live(self, url: str, force: bool = False) -> Dict[str, Any]:
        """
        Fetches and parses live dashboard HTML (XLX, DCS, DStar).
        Returns links count, active modules count, and last heard calls.
        """
        clean_url = (url or "").strip()
        if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
            return {"links": 0, "modules": {}, "last_heard": []}

        now = time.time()
        if not force and clean_url in self._dash_cache:
            ts, data = self._dash_cache[clean_url]
            if now - ts < DSTAR_DASH_CACHE_TTL_SEC:
                return data

        loop = asyncio.get_running_loop()

        def fetch_html() -> str:
            req = urllib.request.Request(clean_url, headers={"User-Agent": "Mozilla/5.0 (ProxDMR 2.9)"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                return resp.read().decode("utf-8", errors="replace")

        try:
            html_text = await loop.run_in_executor(None, fetch_html)
            parser = DStarDashboardHTMLParser()
            parser.feed(html_text)

            # Analyze parsed table rows for links and last heard
            last_heard: List[Dict[str, Any]] = []
            call_regex = re.compile(r"\b[A-Z0-9]{1,3}[0-9][A-Z0-9]{1,4}\b")
            links = 0
            mod_counts: Dict[str, int] = {}

            for row in parser.rows:
                row_str = " ".join(row)
                calls = call_regex.findall(row_str)
                for call in calls:
                    if len(call) >= 3 and not call.startswith("XLX") and not call.startswith("DCS") and not call.startswith("REF"):
                        if call not in [lh.get("callsign") for lh in last_heard]:
                            last_heard.append({"callsign": call, "time": ""})
                            if len(last_heard) >= 15:
                                break

            links = max(len(last_heard), 1) if last_heard else 0

            res = {
                "links": links,
                "modules": mod_counts,
                "last_heard": last_heard[:15],
                "fetched_at": now
            }
            self._dash_cache[clean_url] = (now, res)
            return res
        except Exception as e:
            logger.debug(f"[DSTAR_DIR] Dashboard fetch failed for {clean_url}: {e}")
            res = {"links": 0, "modules": {}, "last_heard": [], "error": str(e)}
            self._dash_cache[clean_url] = (now, res)
            return res

    async def refresh_top_active(self, max_scan: int = 25) -> List[Dict[str, Any]]:
        """Scans candidate reflectors with dashboard URLs to find top active."""
        hosts_with_url = [h for h in self._hosts if h.get("url")]
        candidates = hosts_with_url[:max_scan]

        tasks = [self.fetch_reflector_dashboard_live(h["url"]) for h in candidates]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        top_list: List[Dict[str, Any]] = []
        for h, res in zip(candidates, results):
            if isinstance(res, dict) and not res.get("error"):
                links = res.get("links", 0)
                if links > 0:
                    top_list.append({
                        **h,
                        "links": links,
                        "last_heard": res.get("last_heard", [])
                    })

        top_list.sort(key=lambda x: x.get("links", 0), reverse=True)
        self._top_active = top_list

        try:
            with open(DSTAR_TOP_ACTIVE_CACHE, "w", encoding="utf-8") as f:
                json.dump({"updated_at": time.time(), "top_active": self._top_active}, f, indent=2)
        except Exception:
            pass

        return self._top_active

    def periodic_update_loop(self):
        """Starts background periodic refresh task if not already running."""
        if self._bg_task is None or self._bg_task.done():
            self._bg_task = asyncio.create_task(self._periodic_worker())

    async def _periodic_worker(self):
        while True:
            try:
                await self.ensure_hosts(force=False)
            except Exception as e:
                logger.error(f"[DSTAR_DIR] Periodic update error: {e}")
            await asyncio.sleep(3600 * 6)


dstar_dir_mgr = DStarDirectoryManager()
