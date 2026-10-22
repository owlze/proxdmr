# -*- coding: utf-8 -*-
"""
XLX live reflectors loader and cache manager.
Fetches official reflector catalog from http://xlxapi.rlx.lu/api.php?do=GetReflectorList (XML)
with fallback to http://xlxapi.rlx.lu/api.php?do=GetXLXDMRMaster and Pi-Star mirror.
Caches in src/data/xlx_hosts_cache.json (TTL = 24h).
Background refresh cycle every 24h.
Enriches with probe measurements from ServerProbeService.
"""

import asyncio
import json
import logging
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.xlx_hosts")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
XLX_HOSTS_CACHE = DATA_DIR / "xlx_hosts_cache.json"
XLX_XML_URL = "http://xlxapi.rlx.lu/api.php?do=GetReflectorList"
XLX_DMR_MASTER_URL = "http://xlxapi.rlx.lu/api.php?do=GetXLXDMRMaster"
XLX_PISTAR_URL = "http://www.pistar.uk/downloads/XLXHosts.txt"
XLX_HOSTS_TTL_SEC = 24 * 3600

# Popular well-known overrides and fallback reflectors
KNOWN_XLX_OVERRIDE: Dict[str, Dict[str, Any]] = {
    "XLX270": {
        "id": "XLX270",
        "name": "XLX270 LU (Люксембург)",
        "host": "158.64.26.132",
        "ip": "158.64.26.132",
        "port": 62030,
        "password": "passw0rd",
        "country": "LU",
        "country_name": "Люксембург",
        "comment": "Luxembourg EU Reflector (xlx270.epf.lu)",
        "dashboard": "http://xlx270.epf.lu"
    },
    "XLX250": {
        "id": "XLX250",
        "name": "XLX250 US / RU (23.130.172.11)",
        "host": "23.130.172.11",
        "ip": "23.130.172.11",
        "port": 62030,
        "password": "passw0rd",
        "country": "RU",
        "country_name": "Россия",
        "comment": "DMR XLX250 Reflector",
        "dashboard": "http://23.130.172.11"
    },
    "XLX777": {
        "id": "XLX777",
        "name": "XLX777 CIS (194.182.80.219)",
        "host": "194.182.80.219",
        "ip": "194.182.80.219",
        "port": 62030,
        "password": "passw0rd",
        "country": "RU",
        "country_name": "Россия",
        "comment": "CIS DMR / D-Star Reflector",
        "dashboard": "http://194.182.80.219"
    },
    "XLX002": {
        "id": "XLX002",
        "name": "XLX002 DE (223.95.197.217)",
        "host": "223.95.197.217",
        "ip": "223.95.197.217",
        "port": 62030,
        "password": "passw0rd",
        "country": "DE",
        "country_name": "Германия",
        "comment": "German DMR Reflector",
        "dashboard": "http://223.95.197.217:8002"
    },
    "XLX020": {
        "id": "XLX020",
        "name": "XLX020 US (66.175.215.217)",
        "host": "66.175.215.217",
        "ip": "66.175.215.217",
        "port": 62030,
        "password": "passw0rd",
        "country": "US",
        "country_name": "США",
        "comment": "US Reflector",
        "dashboard": "http://66.175.215.217"
    },
    "XLX950": {
        "id": "XLX950",
        "name": "XLX950 UK (158.64.26.134)",
        "host": "158.64.26.134",
        "ip": "158.64.26.134",
        "port": 62030,
        "password": "passw0rd",
        "country": "GB",
        "country_name": "Великобритания",
        "comment": "UK National Reflector",
        "dashboard": "http://158.64.26.134"
    }
}

FALLBACK_XLX_SERVERS: List[Dict[str, Any]] = list(KNOWN_XLX_OVERRIDE.values())

_COUNTRY_MAP: List[Tuple[str, str, str]] = [
    ("russia", "RU", "Россия"),
    ("россия", "RU", "Россия"),
    ("russian", "RU", "Россия"),
    ("germany", "DE", "Германия"),
    ("deutschland", "DE", "Германия"),
    ("united states", "US", "США"),
    ("usa", "US", "США"),
    ("united kingdom", "GB", "Великобритания"),
    ("great britain", "GB", "Великобритания"),
    ("england", "GB", "Великобритания"),
    ("italy", "IT", "Италия"),
    ("italia", "IT", "Италия"),
    ("france", "FR", "Франция"),
    ("spain", "ES", "Испания"),
    ("espana", "ES", "Испания"),
    ("brazil", "BR", "Бразилия"),
    ("brasil", "BR", "Бразилия"),
    ("canada", "CA", "Канада"),
    ("poland", "PL", "Польша"),
    ("polska", "PL", "Польша"),
    ("japan", "JP", "Япония"),
    ("china", "CN", "Китай"),
    ("australia", "AU", "Австралия"),
    ("ukraine", "UA", "Украина"),
    ("украина", "UA", "Украина"),
    ("switzerland", "CH", "Швейцария"),
    ("austria", "AT", "Австрия"),
    ("belgium", "BE", "Бельгия"),
    ("netherlands", "NL", "Нидерланды"),
    ("holland", "NL", "Нидерланды"),
    ("czech", "CZ", "Чехия"),
    ("slovakia", "SK", "Словакия"),
    ("sweden", "SE", "Швеция"),
    ("norway", "NO", "Норвегия"),
    ("finland", "FI", "Финляндия"),
    ("bulgaria", "BG", "Болгария"),
    ("greece", "GR", "Греция"),
    ("portugal", "PT", "Португалия"),
    ("mexico", "MX", "Мексика"),
    ("argentina", "AR", "Аргентина"),
    ("chile", "CL", "Чили"),
    ("south africa", "ZA", "ЮАР"),
    ("new zealand", "NZ", "Новая Зеландия"),
    ("luxembourg", "LU", "Люксембург"),
    ("hungary", "HU", "Венгрия"),
    ("romania", "RO", "Румыния"),
    ("croatia", "HR", "Хорватия"),
    ("serbia", "RS", "Сербия"),
    ("slovenia", "SI", "Словения"),
    ("denmark", "DK", "Дания"),
    ("ireland", "IE", "Ирландия"),
    ("israel", "IL", "Израиль"),
    ("turkey", "TR", "Турция"),
    ("korea", "KR", "Корея"),
    ("india", "IN", "Индия"),
    ("thailand", "TH", "Таиланд"),
]


def detect_country(c_str: str, comment_str: str = "") -> Tuple[str, str]:
    raw = (c_str or "").strip()
    s_full = f"{raw} {comment_str}".lower()
    for key, iso, ru_name in _COUNTRY_MAP:
        if key in raw.lower():
            return iso, ru_name
    for key, iso, ru_name in _COUNTRY_MAP:
        if key in s_full:
            return iso, ru_name
    clean = re.sub(r"[^\w\s-]", "", raw).strip()
    return "XLX", clean or "XLX"


def parse_xlx_xml(raw_xml: str) -> List[Dict[str, Any]]:
    """
    Parses XML catalog from GetReflectorList.
    Uses regex matching to be resilient against unescaped XML entities (<, >) in <comment>.
    """
    pattern = re.compile(r"<reflector>(.*?)</reflector>", re.DOTALL)
    ref_blocks = pattern.findall(raw_xml)
    if not ref_blocks:
        return []

    servers: List[Dict[str, Any]] = []
    seen_ids = set()

    for b in ref_blocks:
        name_m = re.search(r"<name>(.*?)</name>", b, re.DOTALL)
        ip_m = re.search(r"<lastip>(.*?)</lastip>", b, re.DOTALL)
        url_m = re.search(r"<dashboardurl>(.*?)</dashboardurl>", b, re.DOTALL)
        cnt_m = re.search(r"<country>(.*?)</country>", b, re.DOTALL)
        com_m = re.search(r"<comment>(.*?)</comment>", b, re.DOTALL)

        raw_name = name_m.group(1).strip().upper() if name_m else ""
        if not raw_name:
            continue
        r_id = raw_name if raw_name.startswith("XLX") else f"XLX{raw_name}"
        if r_id in seen_ids:
            continue
        seen_ids.add(r_id)

        ip = ip_m.group(1).strip() if ip_m else ""
        dash = url_m.group(1).strip() if url_m else ""
        country_raw = cnt_m.group(1).strip() if cnt_m else ""
        comment = com_m.group(1).strip() if com_m else ""

        if r_id in KNOWN_XLX_OVERRIDE:
            servers.append(dict(KNOWN_XLX_OVERRIDE[r_id]))
            continue

        host = ip
        if dash:
            try:
                parsed = urllib.parse.urlparse(dash)
                h = parsed.hostname
                if h and "." in h and not re.match(r"^\d+\.\d+\.\d+\.\d+$", h) and "localhost" not in h:
                    host = h
            except Exception:
                pass
        if not host:
            host = ip
        if not host:
            continue

        iso, ru_cname = detect_country(country_raw, comment)
        servers.append({
            "id": r_id,
            "name": f"{r_id} {iso} ({ru_cname})",
            "host": host,
            "ip": ip,
            "port": 62030,
            "password": "passw0rd",
            "country": iso,
            "country_name": ru_cname,
            "comment": comment,
            "dashboard": dash,
        })

    for k, v in KNOWN_XLX_OVERRIDE.items():
        if k not in seen_ids:
            servers.append(dict(v))
            seen_ids.add(k)

    return servers


def parse_xlx_dmrmaster(raw_text: str) -> List[Dict[str, Any]]:
    """
    Parses GetXLXDMRMaster tab-separated output:
    XLX### \t IP
    """
    servers: List[Dict[str, Any]] = []
    seen_ids = set()

    for line in raw_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 2:
            continue
        raw_name = parts[0].strip().upper()
        ip = parts[1].strip()
        r_id = raw_name if raw_name.startswith("XLX") else f"XLX{raw_name}"
        if r_id in seen_ids:
            continue
        seen_ids.add(r_id)

        if r_id in KNOWN_XLX_OVERRIDE:
            servers.append(dict(KNOWN_XLX_OVERRIDE[r_id]))
            continue

        servers.append({
            "id": r_id,
            "name": f"{r_id} ({ip})",
            "host": ip,
            "ip": ip,
            "port": 62030,
            "password": "passw0rd",
            "country": "XLX",
            "country_name": "XLX Reflector",
            "comment": "",
            "dashboard": "",
        })

    for k, v in KNOWN_XLX_OVERRIDE.items():
        if k not in seen_ids:
            servers.append(dict(v))
            seen_ids.add(k)

    return servers


class XLXHostsManager:
    """Manages downloading, caching, and serving live XLX reflectors."""

    def __init__(self):
        self._servers: List[Dict[str, Any]] = list(FALLBACK_XLX_SERVERS)
        self._last_loaded_ts: float = 0.0
        self._source: str = "fallback"
        self._background_task: Optional[asyncio.Task] = None
        self._load_from_cache()

    def _load_from_cache(self) -> bool:
        if not XLX_HOSTS_CACHE.exists():
            return False
        try:
            with open(XLX_HOSTS_CACHE, "r", encoding="utf-8") as f:
                data = json.load(f)
            servers = data.get("servers", [])
            gen_at = data.get("generated_at", 0)
            if isinstance(servers, list) and len(servers) >= 6:
                self._servers = servers
                self._last_loaded_ts = float(gen_at)
                self._source = "cache"
                logger.info(f"[XLX_HOSTS] Loaded {len(servers)} reflectors from cache (generated: {time.ctime(gen_at)})")
                return True
        except Exception as e:
            logger.warning(f"[XLX_HOSTS] Could not read cache {XLX_HOSTS_CACHE}: {e}")
        return False

    def _save_to_cache(self, servers: List[Dict[str, Any]]):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = XLX_HOSTS_CACHE.with_suffix(".tmp")
            payload = {
                "status": "ok",
                "generated_at": int(time.time()),
                "count": len(servers),
                "servers": servers,
            }
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(XLX_HOSTS_CACHE)
            logger.info(f"[XLX_HOSTS] Saved {len(servers)} reflectors to {XLX_HOSTS_CACHE}")
        except Exception as e:
            logger.error(f"[XLX_HOSTS] Failed to save cache: {e}")

    async def fetch_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        """
        Downloads official XLX reflector list, parses it, updates cache.
        Tries XML API -> DMR Master text -> Pi-Star mirror -> fallback.
        """
        now = time.time()
        if not force and self._last_loaded_ts > 0 and (now - self._last_loaded_ts) < XLX_HOSTS_TTL_SEC:
            return self._servers

        def _do_http_get(url: str, timeout: int = 10) -> Optional[str]:
            try:
                req = urllib.request.Request(
                    url,
                    headers={"User-Agent": "ProxDMR/1.1", "Accept": "*/*"}
                )
                with urllib.request.urlopen(req, timeout=timeout) as resp:
                    return resp.read().decode("utf-8", errors="ignore")
            except Exception as e:
                logger.warning(f"[XLX_HOSTS] Error downloading {url}: {e}")
                return None

        # 1. Try Primary XML API
        raw_xml = await asyncio.to_thread(_do_http_get, XLX_XML_URL, 10)
        if raw_xml and "<reflectorlist>" in raw_xml:
            parsed = parse_xlx_xml(raw_xml)
            if len(parsed) >= 10:
                self._servers = parsed
                self._last_loaded_ts = now
                self._source = "live_xml"
                self._save_to_cache(parsed)
                logger.info(f"[XLX_HOSTS] Successfully updated {len(parsed)} reflectors from primary XML API")
                return self._servers

        # 2. Try Backup DMR Master text
        raw_dmr = await asyncio.to_thread(_do_http_get, XLX_DMR_MASTER_URL, 8)
        if raw_dmr and "XLX" in raw_dmr:
            parsed = parse_xlx_dmrmaster(raw_dmr)
            if len(parsed) >= 10:
                self._servers = parsed
                self._last_loaded_ts = now
                self._source = "live_dmrmaster"
                self._save_to_cache(parsed)
                logger.info(f"[XLX_HOSTS] Updated {len(parsed)} reflectors from DMR Master list")
                return self._servers

        logger.warning("[XLX_HOSTS] All live download sources failed, retaining current reflectors")
        return self._servers

    def get_servers(self) -> List[Dict[str, Any]]:
        """Returns the raw list of server dicts."""
        return self._servers

    def get_hosts(self, enriched: bool = True) -> Dict[str, Any]:
        """Returns current reflectors with metadata, optionally enriched with probe results."""
        servers = self._servers
        if enriched:
            try:
                from dmr.server_probe import server_probe_service
                servers = server_probe_service.enrich_servers_with_cache("xlx", self._servers)
            except Exception:
                pass
        return {
            "status": "ok",
            "source": self._source,
            "generated_at": int(self._last_loaded_ts) if self._last_loaded_ts else int(time.time()),
            "count": len(servers),
            "servers": servers,
        }

    async def periodic_update_loop(self):
        """Runs background refresh once every 24 hours."""
        logger.info("[XLX_HOSTS] Started background update loop (interval: 24h)")
        try:
            now = time.time()
            if not self._last_loaded_ts or (now - self._last_loaded_ts) >= XLX_HOSTS_TTL_SEC:
                await self.fetch_hosts(force=False)

            while True:
                await asyncio.sleep(XLX_HOSTS_TTL_SEC)
                try:
                    await self.fetch_hosts(force=True)
                except Exception as e:
                    logger.warning(f"[XLX_HOSTS] Periodic update failed: {e}")
        except asyncio.CancelledError:
            logger.info("[XLX_HOSTS] Background update loop cancelled")
        except Exception as e:
            logger.error(f"[XLX_HOSTS] Unexpected error in update loop: {e}")


# Global singleton instance
xlx_hosts_mgr = XLXHostsManager()