# -*- coding: utf-8 -*-
"""
FreeDMR live hosts loader and cache manager.
Fetches official server list from http://downloads.freedmr.uk/downloads/FreeDMR_Hosts.txt
Enriches with UDP/ICMP probe measurements from ServerProbeService.
"""

import asyncio
import json
import logging
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("proxdmr.freedmr_hosts")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
FREEDMR_HOSTS_CACHE = DATA_DIR / "freedmr_hosts_cache.json"
FREEDMR_HOSTS_URL = "http://downloads.freedmr.uk/downloads/FreeDMR_Hosts.txt"
FREEDMR_HOSTS_TTL_SEC = 24 * 3600

# Verified fallback list with Germany 178.254.30.151 (working, 14ms) first
FALLBACK_FREEDMR_SERVERS: List[Dict[str, Any]] = [
    { "id": "FDMR-DE", "country": "DE", "country_name": "Германия", "name": "FreeDMR Германия (2621)", "host": "178.254.30.151", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-EU", "country": "EU", "country_name": "Европа (Хаб)", "name": "FreeDMR Europe (Main Hub)", "host": "freedmreu.gb7fr.org.uk", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-UK", "country": "GB", "country_name": "Великобритания", "name": "FreeDMR UK (2341)", "host": "hotspot.uk.freedmr.link", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-SCT", "country": "GB", "country_name": "Шотландия", "name": "FreeDMR Scotland (2345)", "host": "freedmr.m0xfn.radio", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-BG", "country": "BG", "country_name": "Болгария", "name": "FreeDMR Болгария (2841)", "host": "fdmrbg.ddns.net", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-GR", "country": "GR", "country_name": "Греция", "name": "FreeDMR Греция (2021)", "host": "dmr.freedmr.gr", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-SE", "country": "SE", "country_name": "Швеция", "name": "FreeDMR Швеция (2401)", "host": "2401.freedmrsweden.se", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-NO", "country": "NO", "country_name": "Норвегия", "name": "FreeDMR Норвегия (2421)", "host": "norway.freedmr.no", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-FR", "country": "FR", "country_name": "Франция", "name": "FreeDMR Франция (2082)", "host": "alpes-grenoble.ovh", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-IT", "country": "IT", "country_name": "Италия", "name": "FreeDMR Италия (2221)", "host": "hotspots.freedmr.it", "port": 62031, "password": "PASSWORD" },
    { "id": "FDMR-US-FL", "country": "US", "country_name": "США (Флорида)", "name": "FreeDMR USA Florida (3109)", "host": "freedmr.dvswitch.org", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-US-SF", "country": "US", "country_name": "США (Сан-Франциско)", "name": "FreeDMR USA West (3103)", "host": "us-sf.freedmr.cc", "port": 62031, "password": "passw0rd" },
    { "id": "FDMR-BR", "country": "BR", "country_name": "Бразилия", "name": "FreeDMR Бразилия (7242)", "host": "freedmr.network365.com.br", "port": 62031, "password": "passw0rd" },
    { "id": "ADN-GL", "country": "GLOBAL", "country_name": "ADN Systems", "name": "ADN Global Router", "host": "master.adn.systems", "port": 62031, "password": "passw0rd" },
]

# Country code detection for common countries in FreeDMR_Hosts.txt
_COUNTRY_MAP = {
    "australia": "AU",
    "brasil": "BR",
    "brazil": "BR",
    "bulgaria": "BG",
    "eu": "EU",
    "europe": "EU",
    "france": "FR",
    "germany": "DE",
    "greece": "GR",
    "italy": "IT",
    "macedonia": "MK",
    "maroc": "MA",
    "morocco": "MA",
    "mexico": "MX",
    "new zealand": "NZ",
    "nicaragua": "NI",
    "norway": "NO",
    "reunion island": "RE",
    "sardinia": "IT",
    "sweden": "SE",
    "turkey": "TR",
    "united kingdom": "GB",
    "usa": "US",
}


def _detect_country_code(name: str) -> str:
    n_low = name.lower()
    for k, v in _COUNTRY_MAP.items():
        if k in n_low:
            return v
    return "FDMR"


def parse_freedmr_hosts_text(raw_text: str) -> List[Dict[str, Any]]:
    """
    Parses FreeDMR_Hosts.txt (CSV or whitespace format).
    Header: #Country,DMR-ID,IP/Hostname,Password,Port
    Row: Australia-OZ-DMR,5052,australia.oz-dmr.network,passw0rd,62031
    """
    servers: List[Dict[str, Any]] = []
    seen_hosts = set()

    for line in raw_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue

        if "," in line:
            parts = [p.strip() for p in line.split(",")]
            if len(parts) < 5:
                continue
            c_name = parts[0]
            opb_id = parts[1]
            host = parts[2]
            password = parts[3]
            port_str = parts[4]
        else:
            parts = line.split()
            if len(parts) < 5:
                continue
            port_str = parts[-1]
            password = parts[-2]
            host = parts[-3]
            opb_id = parts[-4]
            c_name = " ".join(parts[:-4])

        try:
            port = int(port_str)
            if port <= 0 or port > 65535:
                continue
        except (ValueError, TypeError):
            continue

        host = host.strip()
        if not host or host.lower() in seen_hosts:
            continue
        seen_hosts.add(host.lower())

        country_code = _detect_country_code(c_name)
        clean_country = c_name.replace("FreeDMR_", "").replace("FreeDMR-", "").replace("FreeDMR", "").strip()
        server_name = f"FreeDMR {c_name} ({opb_id})"

        servers.append({
            "id": f"FDMR-{opb_id}",
            "country": country_code,
            "country_name": clean_country or c_name,
            "name": server_name,
            "host": host,
            "port": port,
            "password": password or "passw0rd",
        })

    # Always ensure ADN Global Router is present at the end if not in official list
    if not any(s["host"].lower() == "master.adn.systems" for s in servers):
        servers.append({
            "id": "ADN-GL",
            "country": "GLOBAL",
            "country_name": "ADN Systems",
            "name": "ADN Global Router",
            "host": "master.adn.systems",
            "port": 62031,
            "password": "passw0rd",
        })

    return servers


class FreeDmrHostsManager:
    """Manages downloading, caching, and serving live FreeDMR servers."""

    def __init__(self):
        self._servers: List[Dict[str, Any]] = list(FALLBACK_FREEDMR_SERVERS)
        self._last_loaded_ts: float = 0.0
        self._source: str = "fallback"
        self._load_from_cache()

    def _load_from_cache(self) -> bool:
        if not FREEDMR_HOSTS_CACHE.exists():
            return False
        try:
            with open(FREEDMR_HOSTS_CACHE, "r", encoding="utf-8") as f:
                data = json.load(f)
            servers = data.get("servers", [])
            gen_at = data.get("generated_at", 0)
            if isinstance(servers, list) and len(servers) >= 3:
                self._servers = servers
                self._last_loaded_ts = float(gen_at)
                self._source = "cache"
                logger.info(f"[FREEDMR_HOSTS] Loaded {len(servers)} servers from cache (generated: {time.ctime(gen_at)})")
                return True
        except Exception as e:
            logger.warning(f"[FREEDMR_HOSTS] Could not read cache {FREEDMR_HOSTS_CACHE}: {e}")
        return False

    def _save_to_cache(self, servers: List[Dict[str, Any]]):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = FREEDMR_HOSTS_CACHE.with_suffix(".tmp")
            payload = {
                "status": "ok",
                "generated_at": int(time.time()),
                "count": len(servers),
                "servers": servers,
            }
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(FREEDMR_HOSTS_CACHE)
            logger.info(f"[FREEDMR_HOSTS] Saved {len(servers)} servers to {FREEDMR_HOSTS_CACHE}")
        except Exception as e:
            logger.error(f"[FREEDMR_HOSTS] Failed to save cache: {e}")

    async def fetch_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        """
        Downloads official FreeDMR_Hosts.txt, parses it, updates cache.
        Returns list of servers.
        """
        now = time.time()
        if not force and self._last_loaded_ts > 0 and (now - self._last_loaded_ts) < FREEDMR_HOSTS_TTL_SEC:
            return self._servers

        req = urllib.request.Request(
            FREEDMR_HOSTS_URL,
            headers={"User-Agent": "ProxDMR/1.1", "Accept": "text/plain"}
        )

        def _do_fetch():
            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    return resp.read().decode("utf-8", errors="ignore")
            except Exception as e:
                logger.warning(f"[FREEDMR_HOSTS] Network download error: {e}")
                return None

        raw_text = await asyncio.to_thread(_do_fetch)
        if not raw_text:
            logger.warning("[FREEDMR_HOSTS] Empty or failed download, retaining current servers")
            return self._servers

        parsed = parse_freedmr_hosts_text(raw_text)
        if len(parsed) < 3:
            logger.warning(f"[FREEDMR_HOSTS] Download returned only {len(parsed)} servers (< 3), retaining cache")
            return self._servers

        self._servers = parsed
        self._last_loaded_ts = now
        self._source = "live"
        self._save_to_cache(parsed)
        return self._servers

    def get_hosts(self, enriched: bool = True) -> Dict[str, Any]:
        """Returns current hosts with metadata, optionally enriched with probe results."""
        servers = self._servers
        if enriched:
            try:
                from dmr.server_probe import server_probe_service
                servers = server_probe_service.enrich_servers_with_cache("freedmr", self._servers)
            except Exception:
                pass
        return {
            "status": "ok",
            "source": self._source,
            "generated_at": int(self._last_loaded_ts) if self._last_loaded_ts else int(time.time()),
            "count": len(servers),
            "servers": servers,
        }


# Global singleton instance
freedmr_hosts_mgr = FreeDmrHostsManager()
