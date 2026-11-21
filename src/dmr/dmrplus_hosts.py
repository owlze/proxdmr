# -*- coding: utf-8 -*-
"""
DMR+ / IPSC2 live hosts loader and cache manager.
Fetches official server list from http://www.pistar.uk/downloads/DMR_Hosts.txt
Parses lines starting with DMR+_IPSC2- (Port 55555, Password PASSWORD).
Enriches with probe measurements from ServerProbeService.
Caches in src/data/dmrplus_hosts_cache.json (TTL = 24h).
"""

import asyncio
import json
import logging
import re
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("proxdmr.dmrplus_hosts")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DMRPLUS_HOSTS_CACHE = DATA_DIR / "dmrplus_hosts_cache.json"
DMRPLUS_HOSTS_URL = "http://www.pistar.uk/downloads/DMR_Hosts.txt"
DMRPLUS_HOSTS_TTL_SEC = 24 * 3600
DMRPLUS_USER_AGENT = "Pi-Star_4.1.6"

# Verified fallback list with key worldwide IPSC2 servers
FALLBACK_DMRPLUS_SERVERS: List[Dict[str, Any]] = [
    {
        "id": "IPSC2-DMR-DL",
        "country": "DE",
        "country_name": "Germany",
        "name": "IPSC2-DMR-DL DE (Germany)",
        "host": "5.28.41.138",
        "ip": "5.28.41.138",
        "port": 55555,
        "password": "PASSWORD"
    },
    {
        "id": "IPSC2-DL-HOTSPOT",
        "country": "DE",
        "country_name": "Germany",
        "name": "IPSC2-DL-HOTSPOT DE (Germany)",
        "host": "91.132.144.235",
        "ip": "91.132.144.235",
        "port": 55555,
        "password": "PASSWORD"
    },
    {
        "id": "IPSC2-Austria",
        "country": "AT",
        "country_name": "Austria",
        "name": "IPSC2-Austria AT (Austria)",
        "host": "80.120.211.234",
        "ip": "80.120.211.234",
        "port": 55555,
        "password": "PASSWORD"
    },
    {
        "id": "IPSC2-DIG-ITALIA",
        "country": "IT",
        "country_name": "Italy",
        "name": "IPSC2-DIG-ITALIA IT (Italy)",
        "host": "145.239.75.155",
        "ip": "145.239.75.155",
        "port": 55555,
        "password": "PASSWORD"
    },
    {
        "id": "IPSC2-AmComm",
        "country": "US",
        "country_name": "USA",
        "name": "IPSC2-AmComm US (USA)",
        "host": "45.33.17.82",
        "ip": "45.33.17.82",
        "port": 55555,
        "password": "PASSWORD"
    },
    {
        "id": "IPSC2-UK",
        "country": "GB",
        "country_name": "United Kingdom",
        "name": "IPSC2-UK GB (United Kingdom)",
        "host": "51.89.231.13",
        "ip": "51.89.231.13",
        "port": 55555,
        "password": "PASSWORD"
    },
    {
        "id": "IPSC2-RU",
        "country": "RU",
        "country_name": "Russia",
        "name": "IPSC2-RU RU (Russia)",
        "host": "ipsc2.ru",
        "ip": "ipsc2.ru",
        "port": 55555,
        "password": "PASSWORD"
    }
]

# Country keywords mapping for IPSC2 server names
_COUNTRY_KEYWORDS = [
    (r"(?:-DL\b|-DL-HOTSPOT|-DB0|\bGERMANY\b)", "DE", "Germany"),
    (r"(?:AUSTRIA|-OE\b)", "AT", "Austria"),
    (r"(?:ITALIA|ITALY|-IT\b)", "IT", "Italy"),
    (r"(?:FRANCE|-FR\b)", "FR", "France"),
    (r"(?:ANDALUCIA|CATALUNYA|SPAIN|-EA\b)", "ES", "Spain"),
    (r"(?:-UK\b|-GB\b|ENGLAND|SCOTLAND)", "GB", "United Kingdom"),
    (r"(?:CHICAGO|AMCOMM|FLORIDA|QUADNET|NEW-YORK|-US\b|USA)", "US", "USA"),
    (r"(?:AUSTRALIA|-AU\b)", "AU", "Australia"),
    (r"(?:BRASIL|BRAZIL|-BR\b)", "BR", "Brazil"),
    (r"(?:BULGARIA|-BG\b)", "BG", "Bulgaria"),
    (r"(?:RUSSIA|-RU\b)", "RU", "Russia"),
    (r"(?:CAN-|-CA\b|CANADA)", "CA", "Canada"),
    (r"(?:-DK\b|DENMARK)", "DK", "Denmark"),
    (r"(?:ARGENTINA)", "AR", "Argentina"),
    (r"(?:C-AMERICA)", "PA", "Central America"),
    (r"(?:SWEDEN|-SE\b)", "SE", "Sweden"),
    (r"(?:NORWAY|-NO\b)", "NO", "Norway"),
    (r"(?:FINLAND|-FI\b)", "FI", "Finland"),
    (r"(?:POLAND|-PL\b)", "PL", "Poland"),
    (r"(?:CZECH|-CZ\b)", "CZ", "Czech Republic"),
    (r"(?:SWISS|HELVETIA|-HB\b)", "CH", "Switzerland"),
    (r"(?:PORTUGAL|-CT\b)", "PT", "Portugal"),
    (r"(?:NETHERLANDS|-NL\b|HOLLAND)", "NL", "Netherlands"),
    (r"(?:BELGIUM|-ON\b)", "BE", "Belgium"),
    (r"(?:GREECE|-SV\b)", "GR", "Greece"),
    (r"(?:JAPAN|-JA\b)", "JP", "Japan"),
]


def detect_country(server_id: str) -> tuple[str, str]:
    """Detects country code and country name from server ID."""
    upper = server_id.upper()
    for pattern, code, name in _COUNTRY_KEYWORDS:
        if re.search(pattern, upper):
            return code, name
    return "GLOBAL", "Global IPSC2"


class DmrPlusHostsManager:
    """Manages downloading, caching, and 24-hour background sync of live DMR+ IPSC2 hosts."""

    def __init__(self) -> None:
        self._servers: List[Dict[str, Any]] = list(FALLBACK_DMRPLUS_SERVERS)
        self._last_loaded_ts: float = 0.0
        self._last_failed_attempt_ts: float = 0.0
        self._source: str = "fallback"
        self._lock = asyncio.Lock()
        self._bg_sync_task: Optional[asyncio.Task] = None
        self._load_cache_from_disk()

    def _load_cache_from_disk(self) -> bool:
        """Reads cached servers from disk if valid."""
        try:
            if not DMRPLUS_HOSTS_CACHE.exists():
                return False
            with open(DMRPLUS_HOSTS_CACHE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                return False
            cached_servers = data.get("servers", [])
            ts = float(data.get("generated_at", 0) or 0)
            src = str(data.get("source") or "").strip().lower()
            if isinstance(cached_servers, list) and len(cached_servers) >= 5:
                self._servers = cached_servers
                if ts > 0 and src in ("pistar_live", "live", "disk_cache"):
                    self._last_loaded_ts = ts
                    self._source = "disk_cache"
                    logger.info(f"[DMR+_HOSTS] Loaded {len(cached_servers)} servers from disk cache (age {int(time.time() - ts)}s)")
                    return True
                self._last_loaded_ts = 0.0
                self._source = "fallback"
                return False
        except Exception as e:
            logger.warning(f"[DMR+_HOSTS] Failed to read disk cache {DMRPLUS_HOSTS_CACHE}: {e}")
        return False

    def _save_cache_to_disk(self) -> None:
        """Persists current servers list to disk cache atomically."""
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            payload = {
                "status": "ok",
                "generated_at": int(self._last_loaded_ts),
                "updated_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(self._last_loaded_ts)),
                "count": len(self._servers),
                "source": self._source,
                "servers": self._servers
            }
            tmp_path = DMRPLUS_HOSTS_CACHE.with_suffix(".tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(DMRPLUS_HOSTS_CACHE)
            logger.info(f"[DMR+_HOSTS] Saved {len(self._servers)} servers to disk cache")
        except Exception as e:
            logger.error(f"[DMR+_HOSTS] Failed to write cache {DMRPLUS_HOSTS_CACHE}: {e}")

    def _parse_hosts_content(self, raw_text: str) -> List[Dict[str, Any]]:
        """Parses DMR_Hosts.txt content into server dictionaries."""
        servers: List[Dict[str, Any]] = []
        seen = set()

        for line in raw_text.splitlines():
            line = line.strip()
            if not line.startswith("DMR+_IPSC2-"):
                continue
            parts = re.split(r"\s+", line)
            if len(parts) < 3:
                continue

            raw_id = parts[0]
            srv_id = raw_id.replace("DMR+_", "").strip()
            ip = parts[2].strip()
            port = int(parts[4]) if len(parts) >= 5 and parts[4].isdigit() else 55555
            password = parts[3].strip() if len(parts) >= 4 else "PASSWORD"

            # Deduplicate by (srv_id, ip)
            dedup_key = (srv_id.lower(), ip.lower())
            if dedup_key in seen:
                continue
            seen.add(dedup_key)

            c_code, c_name = detect_country(srv_id)
            nice_name = f"{srv_id} {c_code} ({c_name})" if c_code != "GLOBAL" else srv_id

            servers.append({
                "id": srv_id,
                "name": nice_name,
                "host": ip,
                "ip": ip,
                "port": port,
                "password": password,
                "country": c_code,
                "country_name": c_name
            })

        return servers

    def needs_sync(self, now: Optional[float] = None) -> bool:
        ts_now = now if now is not None else time.time()
        if not DMRPLUS_HOSTS_CACHE.exists():
            return True
        if self._source == "fallback" or self._last_loaded_ts <= 0:
            return True
        return (ts_now - self._last_loaded_ts) >= DMRPLUS_HOSTS_TTL_SEC

    def is_sync_running(self) -> bool:
        return bool(self._bg_sync_task and not self._bg_sync_task.done())

    def ensure_fresh_background(self) -> bool:
        now = time.time()
        if not self.needs_sync(now):
            return False
        if self.is_sync_running():
            return True
        if self._last_failed_attempt_ts > 0 and (now - self._last_failed_attempt_ts) < 120.0:
            return False
        try:
            loop = asyncio.get_running_loop()
            self._bg_sync_task = loop.create_task(self.fetch_hosts(force=True))
            return True
        except RuntimeError:
            return False

    async def fetch_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        """
        Fetches official DMR+ hosts list from pistar if cache expired.
        Updates timestamp ONLY after successful download & parse.
        """
        async with self._lock:
            now = time.time()
            if not force and not self.needs_sync(now):
                return self._servers

            def _fetch_sync() -> Optional[str]:
                try:
                    req = urllib.request.Request(
                        DMRPLUS_HOSTS_URL,
                        headers={"User-Agent": DMRPLUS_USER_AGENT}
                    )
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        if resp.status == 200:
                            return resp.read().decode("utf-8", errors="ignore")
                except Exception as e:
                    logger.warning(f"[DMR+_HOSTS] Download error from {DMRPLUS_HOSTS_URL}: {e}")
                return None

            raw_text = await asyncio.to_thread(_fetch_sync)
            if raw_text:
                parsed = self._parse_hosts_content(raw_text)
                if len(parsed) >= 5:
                    success_ts = time.time()
                    self._servers = parsed
                    self._last_loaded_ts = success_ts
                    self._last_failed_attempt_ts = 0.0
                    self._source = "pistar_live"
                    logger.info(f"[DMR+_HOSTS] Fetched and parsed {len(parsed)} servers from Pi-Star")
                    self._save_cache_to_disk()
                    return self._servers

            self._last_failed_attempt_ts = time.time()
            if not self._servers:
                self._servers = list(FALLBACK_DMRPLUS_SERVERS)
                self._source = "fallback"

            return self._servers

    def get_hosts(self, enriched: bool = True) -> List[Dict[str, Any]]:
        """Returns DMR+ servers list, enriched with probe/ping results if available."""
        servers = list(self._servers)
        if not enriched:
            return servers

        try:
            from dmr.server_probe import server_probe_service
            return server_probe_service.enrich_servers_with_cache("dmrplus", servers)
        except Exception as e:
            logger.debug(f"[DMR+_HOSTS] Enrichment error: {e}")
            return servers

    def get_hosts_payload(self, enriched: bool = True) -> Dict[str, Any]:
        """Returns dictionary payload expected by frontend refreshDmrPlusServers()."""
        servers = self.get_hosts(enriched=enriched)
        return {
            "status": "ok",
            "source": self._source,
            "generated_at": int(self._last_loaded_ts) if self._last_loaded_ts > 0 else 0,
            "last_sync_ts": int(self._last_loaded_ts) if self._last_loaded_ts > 0 else 0,
            "sync_in_progress": self.is_sync_running(),
            "needs_sync": self.needs_sync(),
            "count": len(servers),
            "servers": servers,
        }

    async def periodic_update_loop(self) -> None:
        """Background coroutine that keeps DMR+ hosts updated every 24h."""
        logger.info("[DMR+_HOSTS] Started background update loop (interval: 24h)")
        while True:
            try:
                await self.fetch_hosts(force=False)
            except Exception as e:
                logger.warning(f"[DMR+_HOSTS] Background update failed: {e}")
            await asyncio.sleep(DMRPLUS_HOSTS_TTL_SEC)


dmrplus_hosts_mgr = DmrPlusHostsManager()
