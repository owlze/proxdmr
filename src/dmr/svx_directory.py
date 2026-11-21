# -*- coding: utf-8 -*-
"""
svx_directory.py - SVXReflector Server and TalkGroup Directory Manager for ProxDMR.
Maintains curated and cached SvxLink servers, status portal fetcher,
and popular TG presets.
"""

import asyncio
import json
import logging
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.svx_directory")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
SVX_HOSTS_CACHE = DATA_DIR / "svx_hosts_cache.json"
SVX_CACHE_TTL_SEC = 12 * 3600
SVX_STATUS_CACHE_TTL_SEC = 20.0

DEFAULT_SVX_TGS: List[Dict[str, Any]] = [
    {"tg": 0, "name": "Standby / Silent (Monitor Only)", "desc": "Отключение активной передачи, только приём групп мониторинга"},
    {"tg": 1, "name": "Global / General", "desc": "Общая глобальная группа SvxLink"},
    {"tg": 9, "name": "Local Repeater", "desc": "Локальная разговорная группа репитера"},
    {"tg": 91, "name": "Worldwide International", "desc": "Международная всемирная группа"},
    {"tg": 250, "name": "Russia (RU)", "desc": "Основная русскоязычная национальная группа"},
    {"tg": 2501, "name": "Russia Round Table", "desc": "Круглый стол и межрегиональные трафики RU"},
    {"tg": 2502, "name": "Russia Northwest / SPb", "desc": "Северо-Западный регион и Санкт-Петербург"},
    {"tg": 2503, "name": "Russia Center / Moscow", "desc": "Центральный регион и Москва"},
    {"tg": 262, "name": "Germany (DL)", "desc": "Германия национальная группа"},
    {"tg": 240, "name": "Sweden (SM)", "desc": "Швеция национальная группа"},
    {"tg": 260, "name": "Poland (SP)", "desc": "Польша национальная группа"},
    {"tg": 235, "name": "United Kingdom (UK)", "desc": "Великобритания национальная группа"},
    {"tg": 208, "name": "France (F)", "desc": "Франция национальная группа"},
    {"tg": 999, "name": "Echo / Audio Test", "desc": "Эхо-тест проверки передачи и звука"},
]

LEGACY_DEAD_SVX_HOSTS = frozenset({
    "reflector.sm0svx.se",
    "svx.qrz.ru",
    "reflector.dstar.su",
    "spb.svxlink.ru",
    "reflector.svxlink.de",
    "reflector.smnet.se",
    "reflector.svxlink.pl",
    "reflector.svxlink.uk",
    "svx.openquad.net",
})

FALLBACK_SVX_SERVERS: List[Dict[str, Any]] = [
    {
        "id": "SVX-DE-FMFUNKNETZ",
        "name": "FM-Funknetz Germany (Primary)",
        "host": "nc3.fm-funknetz.de",
        "port": 5308,
        "country": "DE",
        "country_code": "DE",
        "country_name": "Germany",
        "portal_url": "https://fm-funknetz.de/",
        "status_url": "",
        "recommended": True,
        "preset_tgs": [1, 262, 2620, 91, 999]
    },
    {
        "id": "SVX-DE-FMFUNKNETZ-2",
        "name": "FM-Funknetz Germany (Backup)",
        "host": "master2.fm-funknetz.de",
        "port": 5308,
        "country": "DE",
        "country_code": "DE",
        "country_name": "Germany",
        "portal_url": "https://fm-funknetz.de/",
        "status_url": "",
        "preset_tgs": [1, 262, 2620, 91, 999]
    },
    {
        "id": "SVX-SE-SM0SVX",
        "name": "Sweden SM0SVX / SK3W (Stockholm)",
        "host": "svxreflector-sthlm.sk3w.se",
        "port": 5300,
        "country": "SE",
        "country_code": "SE",
        "country_name": "Sweden",
        "portal_url": "https://svxportal.sm2ampr.net/",
        "status_url": "",
        "preset_tgs": [240, 2400, 2402, 999]
    },
    {
        "id": "SVX-SE-FERNEBO",
        "name": "Sweden SM0SVX / SK3W (Fernebo)",
        "host": "svxreflector-fernebo.sk3w.se",
        "port": 5300,
        "country": "SE",
        "country_code": "SE",
        "country_name": "Sweden",
        "portal_url": "https://svxportal.sm2ampr.net/",
        "status_url": "",
        "preset_tgs": [240, 2400, 2402, 999]
    },
    {
        "id": "SVX-BE-SVXLINK",
        "name": "Belgium SVXLink (ON)",
        "host": "reflector.be.svx.link",
        "port": 5300,
        "country": "BE",
        "country_code": "BE",
        "country_name": "Belgium",
        "portal_url": "https://portal.be.svx.link/",
        "status_url": "",
        "preset_tgs": [1, 206, 2060, 999]
    },
    {
        "id": "SVX-RO-ROLINK",
        "name": "Romania RoLink Network (YO)",
        "host": "rolink.network",
        "port": 5300,
        "country": "RO",
        "country_code": "RO",
        "country_name": "Romania",
        "portal_url": "https://rolink.network/",
        "status_url": "",
        "preset_tgs": [1, 226, 2261, 999]
    },
    {
        "id": "SVX-IT-ARI",
        "name": "Italy ARI SvxLink (I)",
        "host": "svx.ampr.ari.it",
        "port": 5300,
        "country": "IT",
        "country_code": "IT",
        "country_name": "Italy",
        "portal_url": "http://svx.ampr.ari.it/",
        "status_url": "",
        "preset_tgs": [1, 222, 999]
    },
    {
        "id": "SVX-FR-RRF",
        "name": "France RRF (Réseau Répéteurs Francophones)",
        "host": "rrf.f5nlg.ovh",
        "port": 5300,
        "country": "FR",
        "country_code": "FR",
        "country_name": "France",
        "portal_url": "http://rrf4.f5nlg.ovh:82/",
        "status_url": "",
        "preset_tgs": [1, 208, 999]
    },
    {
        "id": "SVX-PL-FMPOLAND",
        "name": "Poland FM-Poland (SP)",
        "host": "fm-poland.pl",
        "port": 5300,
        "country": "PL",
        "country_code": "PL",
        "country_name": "Poland",
        "portal_url": "https://fm-poland.pl/",
        "status_url": "",
        "preset_tgs": [1, 260, 2600, 999]
    },
    {
        "id": "SVX-UA-UARADIO",
        "name": "Ukraine UARadioLink (UR)",
        "host": "svx.uaradio.link",
        "port": 5300,
        "country": "UA",
        "country_code": "UA",
        "country_name": "Ukraine",
        "portal_url": "",
        "status_url": "",
        "preset_tgs": [1, 255, 999]
    }
]


class SVXDirectoryManager:
    """Manages SVXReflector directories and JSON status."""

    def __init__(self):
        self._servers: List[Dict[str, Any]] = []
        self._servers_by_id: Dict[str, Dict[str, Any]] = {}
        self._status_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._last_loaded: float = 0.0
        self._lock = asyncio.Lock()

        self._load_cached_servers()

    def _load_cached_servers(self):
        if SVX_HOSTS_CACHE.is_file():
            try:
                with open(SVX_HOSTS_CACHE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict) and "servers" in data and isinstance(data["servers"], list):
                    cached_list = data["servers"]
                    has_dead_legacy = any(
                        str((item or {}).get("host") or "").strip().lower() in LEGACY_DEAD_SVX_HOSTS
                        for item in cached_list
                        if isinstance(item, dict)
                    )
                    if cached_list and not has_dead_legacy:
                        self._servers = cached_list
                        self._last_loaded = float(data.get("updated_at", 0.0))
                        self._rebuild_lookup()
                        logger.info(f"[SVX_DIR] Loaded {len(self._servers)} SVX servers from disk cache")
                        return
                    logger.warning("[SVX_DIR] Legacy dead SVX hosts found in disk cache — resetting to verified list")
            except Exception as e:
                logger.warning(f"[SVX_DIR] Error reading hosts cache: {e}")

        self._servers = list(FALLBACK_SVX_SERVERS)
        self._rebuild_lookup()

    def _rebuild_lookup(self):
        self._servers_by_id.clear()
        for s in self._servers:
            sid = (s.get("id") or "").upper()
            if sid:
                self._servers_by_id[sid] = s

    def get_servers(self) -> List[Dict[str, Any]]:
        return list(self._servers)

    def get_default_tgs(self) -> List[Dict[str, Any]]:
        return list(DEFAULT_SVX_TGS)

    def find_server(self, query: str) -> Optional[Dict[str, Any]]:
        clean = (query or "").strip().upper()
        if not clean:
            return None
        if clean in self._servers_by_id:
            return self._servers_by_id[clean]
        for sid, s in self._servers_by_id.items():
            if (
                sid.startswith(clean)
                or clean == (s.get("host") or "").strip().upper()
                or clean in (s.get("name") or "").upper()
            ):
                return s
        return None

    async def fetch_server_status_json(self, status_url: str, force: bool = False) -> Dict[str, Any]:
        clean_url = (status_url or "").strip()
        if not clean_url.startswith("http://") and not clean_url.startswith("https://"):
            return {"nodes": [], "active_tgs": []}

        now = time.time()
        if not force and clean_url in self._status_cache:
            ts, data = self._status_cache[clean_url]
            if now - ts < SVX_STATUS_CACHE_TTL_SEC:
                return data

        loop = asyncio.get_running_loop()

        def fetch_json() -> str:
            req = urllib.request.Request(clean_url, headers={"User-Agent": "ProxDMR/2.9"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                return resp.read().decode("utf-8", errors="replace")

        try:
            raw_text = await loop.run_in_executor(None, fetch_json)
            parsed = json.loads(raw_text)

            nodes_list: List[str] = []
            active_tgs: List[int] = []

            # Format 1: svxreflector /status returns dict of nodes
            if isinstance(parsed, dict):
                nodes_dict = parsed.get("nodes") or parsed.get("Nodes")
                if isinstance(nodes_dict, dict):
                    nodes_list = sorted(list(nodes_dict.keys()))
                elif isinstance(nodes_dict, list):
                    nodes_list = [str(n.get("callsign", n)) for n in nodes_dict]

                tgs = parsed.get("active_tgs") or parsed.get("talkgroups")
                if isinstance(tgs, list):
                    active_tgs = [int(tg) for tg in tgs if str(tg).isdigit()]

            res = {
                "nodes": nodes_list,
                "nodes_count": len(nodes_list),
                "active_tgs": active_tgs,
                "fetched_at": now
            }
            self._status_cache[clean_url] = (now, res)
            return res
        except Exception as e:
            logger.debug(f"[SVX_DIR] Status fetch failed for {clean_url}: {e}")
            res = {"nodes": [], "nodes_count": 0, "active_tgs": [], "error": str(e)}
            self._status_cache[clean_url] = (now, res)
            return res


svx_dir_mgr = SVXDirectoryManager()
