# -*- coding: utf-8 -*-
"""
ADN (Amateur Digital Network) live servers loader and cache manager.
Manages downloading, parsing, caching, and 24-hour background synchronization
of live ADN servers from https://adn.systems/api/status and https://adn.systems/status.
Caches in src/data/adn_hosts_cache.json (TTL = 24h).
"""

import asyncio
import json
import logging
import re
import ssl
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger("proxdmr.adn_hosts")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
ADN_HOSTS_CACHE = DATA_DIR / "adn_hosts_cache.json"
ADN_HOSTS_TTL_SEC = 24 * 3600
ADN_RETRY_COOLDOWN_SEC = 120.0
ADN_STATUS_API_URL = "https://adn.systems/api/status"
ADN_STATUS_PAGE_URL = "https://adn.systems/status"
ADN_LISTEN_TGS_URL = "https://listen.adn.systems/api/tgs"
ADN_SERVICE_TGS: Set[int] = {0, 4000, 5000, 9990, 9991, 9999}

COUNTRY_NAME_TO_ISO: Dict[str, str] = {
    "andorra": "AD",
    "argentina": "AR",
    "austria": "AT",
    "belarus": "BY",
    "belgium": "BE",
    "brazil": "BR",
    "bulgaria": "BG",
    "canada": "CA",
    "chile": "CL",
    "colombia": "CO",
    "costa rica": "CR",
    "croatia": "HR",
    "cuba": "CU",
    "czech republic": "CZ",
    "czechia": "CZ",
    "denmark": "DK",
    "dominican republic": "DO",
    "ecuador": "EC",
    "el salvador": "SV",
    "estonia": "EE",
    "finland": "FI",
    "france": "FR",
    "germany": "DE",
    "greece": "GR",
    "guatemala": "GT",
    "honduras": "HN",
    "hungary": "HU",
    "ireland": "IE",
    "israel": "IL",
    "italy": "IT",
    "kazakhstan": "KZ",
    "latvia": "LV",
    "lithuania": "LT",
    "luxembourg": "LU",
    "macedonia": "MK",
    "north macedonia": "MK",
    "mexico": "MX",
    "morocco": "MA",
    "netherlands": "NL",
    "nicaragua": "NI",
    "norway": "NO",
    "panama": "PA",
    "peru": "PE",
    "poland": "PL",
    "portugal": "PT",
    "puerto rico": "PR",
    "reunion": "RE",
    "réunion": "RE",
    "romania": "RO",
    "russia": "RU",
    "serbia": "RS",
    "slovakia": "SK",
    "slovenia": "SI",
    "spain": "ES",
    "sweden": "SE",
    "switzerland": "CH",
    "thailand": "TH",
    "turkey": "TR",
    "türkiye": "TR",
    "ukraine": "UA",
    "united kingdom": "GB",
    "uk": "GB",
    "united states": "US",
    "usa": "US",
    "uruguay": "UY",
    "venezuela": "VE",
    "international": "GLOBAL",
    "global": "GLOBAL",
}

MCC_PREFIX_TO_ISO: Dict[str, Tuple[str, str]] = {
    "202": ("GR", "Greece"),
    "204": ("NL", "Netherlands"),
    "206": ("BE", "Belgium"),
    "208": ("FR", "France"),
    "213": ("AD", "Andorra"),
    "214": ("ES", "Spain"),
    "220": ("RS", "Serbia"),
    "222": ("IT", "Italy"),
    "226": ("RO", "Romania"),
    "228": ("CH", "Switzerland"),
    "232": ("AT", "Austria"),
    "234": ("GB", "United Kingdom"),
    "235": ("GB", "United Kingdom"),
    "248": ("EE", "Estonia"),
    "250": ("RU", "Russia"),
    "255": ("UA", "Ukraine"),
    "260": ("PL", "Poland"),
    "262": ("DE", "Germany"),
    "268": ("PT", "Portugal"),
    "284": ("BG", "Bulgaria"),
    "286": ("TR", "Turkey"),
    "294": ("MK", "Macedonia"),
    "302": ("CA", "Canada"),
    "310": ("US", "United States"),
    "311": ("US", "United States"),
    "330": ("PR", "Puerto Rico"),
    "334": ("MX", "Mexico"),
    "368": ("CU", "Cuba"),
    "370": ("DO", "Dominican Republic"),
    "520": ("TH", "Thailand"),
    "604": ("MA", "Morocco"),
    "647": ("RE", "Reunion"),
    "706": ("SV", "El Salvador"),
    "708": ("HN", "Honduras"),
    "710": ("NI", "Nicaragua"),
    "712": ("CR", "Costa Rica"),
    "714": ("PA", "Panama"),
    "724": ("BR", "Brazil"),
    "730": ("CL", "Chile"),
    "732": ("CO", "Colombia"),
    "734": ("VE", "Venezuela"),
    "740": ("EC", "Ecuador"),
}

# Built-in regional nodes of the Amateur Digital Network (Fallback List)
FALLBACK_ADN_SERVERS: List[Dict[str, Any]] = [
    {
        "id": "ADN-GLOBAL",
        "country": "GLOBAL",
        "country_key": "countries.GLOBAL",
        "country_name": "International",
        "name": "ADN Global Master Hub",
        "host": "master.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-2131",
        "country": "AD",
        "country_name": "Andorra",
        "name": "ADN Andorra (2131)",
        "host": "2131.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-2481",
        "country": "EE",
        "country_name": "Estonia",
        "name": "ADN Estonia (2481)",
        "host": "2481.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-2021",
        "country": "GR",
        "country_name": "Greece",
        "name": "ADN Greece (2021)",
        "host": "2021.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-2221",
        "country": "IT",
        "country_name": "Italy",
        "name": "ADN Italy (2221)",
        "host": "2221.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-2841",
        "country": "BG",
        "country_name": "Bulgaria",
        "name": "ADN Bulgaria (2841)",
        "host": "2841.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-2082",
        "country": "FR",
        "country_name": "France",
        "name": "ADN France Digital (2082)",
        "host": "2082.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-7241",
        "country": "BR",
        "country_name": "Brazil",
        "name": "ADN Brazil (7241)",
        "host": "7241.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-7301",
        "country": "CL",
        "country_name": "Chile",
        "name": "ADN Chile (7301)",
        "host": "7301.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-3341",
        "country": "MX",
        "country_name": "Mexico",
        "name": "ADN Mexico (3341)",
        "host": "3341.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
    {
        "id": "ADN-3105",
        "country": "US",
        "country_name": "United States",
        "name": "ADN United States West (3105)",
        "host": "3105.adn.systems",
        "port": 62031,
        "password": "passw0rd",
        "online": True,
    },
]


def _resolve_adn_country_iso(country_name: str, net_id: str) -> Tuple[str, str]:
    c_clean = str(country_name or "").strip()
    iso = COUNTRY_NAME_TO_ISO.get(c_clean.lower(), "")
    mcc_key = str(net_id or "").strip()[:3]
    if not iso and mcc_key in MCC_PREFIX_TO_ISO:
        iso, fb_country = MCC_PREFIX_TO_ISO[mcc_key]
        if not c_clean:
            c_clean = fb_country
    if not c_clean and iso == "GLOBAL":
        c_clean = "International"
    return (iso or "GLOBAL"), (c_clean or "ADN")


def _format_adn_display_name(raw_name: str, country_name: str, net_id: str) -> str:
    nid = str(net_id or "").strip()
    c_clean = str(country_name or "").strip()
    rn = str(raw_name or "").strip()
    if rn.lower().startswith("adn_"):
        parts = rn[4:]
        if nid and parts.startswith(nid + "_"):
            parts = parts[len(nid) + 1:]
        parts = parts.replace("_", " ").strip()
        # Extract meaningful qualifier beyond plain country name
        lower_parts = parts.lower()
        lower_c = c_clean.lower()
        suffix = ""
        if c_clean and lower_parts.startswith(lower_c):
            suffix = parts[len(c_clean):].lstrip(" -—_")
        elif lower_c == "united states" and lower_parts.startswith("usa"):
            suffix = parts[3:].lstrip(" -—_")
        elif parts and lower_parts != lower_c:
            suffix = parts
        base_country = "USA" if lower_c == "united states" else (c_clean or parts)
        if suffix and suffix.lower() != base_country.lower():
            return f"ADN {base_country} — {suffix} ({nid})" if nid else f"ADN {base_country} — {suffix}"
        return f"ADN {base_country} ({nid})" if nid else f"ADN {base_country}"
    if rn and nid and nid not in rn:
        return f"{rn} ({nid})"
    return rn or (f"ADN {c_clean} ({nid})" if nid else f"ADN {c_clean}")


def _http_get_text(url: str, accept: str, timeout: int = 12) -> Optional[str]:
    headers = {
        "User-Agent": "ProxDMR/1.2 (+https://github.com/proxDMR)",
        "Accept": accept,
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(req, context=ctx, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="ignore")
    except Exception as exc:
        # Retry with relaxed TLS context if host CA bundle rejects upstream cert
        try:
            ctx_noverify = ssl.create_default_context()
            ctx_noverify.check_hostname = False
            ctx_noverify.verify_mode = ssl.CERT_NONE
            with urllib.request.urlopen(req, context=ctx_noverify, timeout=timeout) as resp:
                return resp.read().decode("utf-8", errors="ignore")
        except Exception:
            logger.debug(f"[ADN_HOSTS] Fetch failed for {url}: {exc}")
            return None


def _parse_adn_status_payload(raw_json_text: Optional[str], raw_html_text: Optional[str]) -> List[Dict[str, Any]]:
    parsed: List[Dict[str, Any]] = []

    if raw_json_text:
        try:
            doc = json.loads(raw_json_text)
            rows = doc.get("rows") if isinstance(doc, dict) else None
            if rows is None and isinstance(doc, dict):
                rows = doc.get("servers")
            if rows is None and isinstance(doc, list):
                rows = doc

            if isinstance(rows, list):
                for item in rows:
                    if not isinstance(item, dict):
                        continue
                    srv = item.get("server") if isinstance(item.get("server"), dict) else item
                    host = str(srv.get("hostname") or srv.get("host") or "").strip()
                    if not host:
                        continue
                    net_id = str(srv.get("net_id") or srv.get("id") or "").strip()
                    try:
                        port = int(srv.get("port") or 62031)
                    except (ValueError, TypeError):
                        port = 62031
                    raw_country = str(srv.get("country") or srv.get("country_name") or "").strip()
                    iso, country_name = _resolve_adn_country_iso(raw_country, net_id)
                    raw_name = str(srv.get("name") or "").strip()
                    disp_name = _format_adn_display_name(raw_name, country_name, net_id)
                    status_text = str(item.get("status_text") or "").strip().lower()
                    is_online = bool(item.get("online", True)) if "online" in item else (status_text != "offline")
                    parsed.append({
                        "id": f"ADN-{net_id}" if net_id else f"ADN-{host}",
                        "net_id": int(net_id) if net_id.isdigit() else 0,
                        "country": iso,
                        "country_name": country_name,
                        "name": disp_name,
                        "host": host,
                        "port": port,
                        "password": str(srv.get("password") or "passw0rd"),
                        "online": is_online,
                    })
        except Exception as e:
            logger.warning(f"[ADN_HOSTS] Could not parse JSON status from adn.systems: {e}")

    # Fallback HTML table parser for https://adn.systems/status if JSON API format changed
    if len(parsed) < 3 and raw_html_text:
        row_matches = re.findall(r"<tr[^>]*>(.*?)</tr>", raw_html_text, flags=re.IGNORECASE | re.DOTALL)
        for tr_html in row_matches:
            cells = [
                re.sub(r"<[^>]+>", "", c).strip()
                for c in re.findall(r"<td[^>]*>(.*?)</td>", tr_html, flags=re.IGNORECASE | re.DOTALL)
            ]
            if len(cells) < 2:
                continue
            joined = " ".join(cells)
            host_m = re.search(r"([a-z0-9.-]+\.adn\.systems)", joined, flags=re.IGNORECASE)
            if not host_m:
                continue
            host = host_m.group(1).lower()
            nid_m = re.match(r"^(\d{3,6})\.", host)
            net_id = nid_m.group(1) if nid_m else ""
            port = 62031
            port_m = re.search(r":(\d{4,5})\b", joined)
            if port_m:
                port = int(port_m.group(1))
            iso, country_name = _resolve_adn_country_iso("", net_id)
            parsed.append({
                "id": f"ADN-{net_id}" if net_id else f"ADN-{host}",
                "net_id": int(net_id) if net_id.isdigit() else 0,
                "country": iso,
                "country_name": country_name,
                "name": f"ADN {country_name} ({net_id})" if net_id else f"ADN {host}",
                "host": host,
                "port": port,
                "password": "passw0rd",
                "online": ("offline" not in joined.lower()),
            })

    if len(parsed) < 3:
        return []

    # Deduplicate by (host.lower(), port) while preserving order and injecting ADN Global hub at top
    seen = set()
    final_list: List[Dict[str, Any]] = []
    has_global = any(str(s.get("host") or "").lower() == "master.adn.systems" for s in parsed)
    if not has_global:
        global_entry = dict(FALLBACK_ADN_SERVERS[0])
        seen.add(("master.adn.systems", 62031))
        final_list.append(global_entry)

    parsed_sorted = sorted(
        parsed,
        key=lambda s: (str(s.get("country_name") or "").lower(), str(s.get("net_id") or s.get("id") or "")),
    )
    for s in parsed_sorted:
        key = (str(s.get("host") or "").lower(), int(s.get("port") or 62031))
        if key in seen:
            continue
        seen.add(key)
        final_list.append(s)
    return final_list


class AdnHostsManager:
    """Manages loading, caching, and 24-hour background sync of live ADN Systems servers."""

    def __init__(self):
        self._servers: List[Dict[str, Any]] = list(FALLBACK_ADN_SERVERS)
        self._last_loaded_ts: float = 0.0
        self._last_failed_attempt_ts: float = 0.0
        self._source: str = "fallback"
        self._bg_sync_task: Optional[asyncio.Task] = None
        self._fetch_lock: Optional[asyncio.Lock] = None
        self._live_tgs: List[Dict[str, Any]] = []
        self._recent_live_tgs: Dict[int, Dict[str, Any]] = {}
        self._last_live_fetch_ts: float = 0.0
        self._live_fetch_lock: Optional[asyncio.Lock] = None
        self._load_from_cache()

    def _get_lock(self) -> asyncio.Lock:
        if self._fetch_lock is None:
            self._fetch_lock = asyncio.Lock()
        return self._fetch_lock

    def _load_from_cache(self) -> bool:
        if not ADN_HOSTS_CACHE.exists():
            return False
        try:
            with open(ADN_HOSTS_CACHE, "r", encoding="utf-8") as f:
                data = json.load(f)
            servers = data.get("servers", [])
            gen_at = float(data.get("generated_at") or 0)
            src = str(data.get("source") or "").strip().lower()
            if isinstance(servers, list) and len(servers) >= 3:
                self._servers = servers
                # Treat legacy fallback-written caches (missing source=="live") as unverified so first entry triggers real parse
                if src == "live" and gen_at > 0:
                    self._last_loaded_ts = gen_at
                    self._source = "live"
                    logger.info(f"[ADN_HOSTS] Loaded {len(servers)} live servers from cache (updated: {time.ctime(gen_at)})")
                    return True
                self._last_loaded_ts = 0.0
                self._source = "fallback"
                logger.info(f"[ADN_HOSTS] Found legacy/non-live cache ({len(servers)} entries); will sync from adn.systems on ADN HS entry")
                return False
        except Exception as e:
            logger.warning(f"[ADN_HOSTS] Could not read cache {ADN_HOSTS_CACHE}: {e}")
        return False

    def _save_to_cache(self, servers: List[Dict[str, Any]], sync_ts: float):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = ADN_HOSTS_CACHE.with_suffix(".tmp")
            payload = {
                "status": "ok",
                "source": "live",
                "generated_at": int(sync_ts),
                "updated_at_iso": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(sync_ts)),
                "count": len(servers),
                "servers": servers,
            }
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
            tmp_path.replace(ADN_HOSTS_CACHE)
            logger.info(f"[ADN_HOSTS] Saved {len(servers)} live servers to {ADN_HOSTS_CACHE}")
        except Exception as e:
            logger.error(f"[ADN_HOSTS] Failed to save cache: {e}")

    def needs_sync(self, now: Optional[float] = None) -> bool:
        """Returns True if ADN servers have never been synced live, cache file is missing, or >24h elapsed."""
        ts_now = now if now is not None else time.time()
        if not ADN_HOSTS_CACHE.exists():
            return True
        if self._source != "live" or self._last_loaded_ts <= 0:
            return True
        return (ts_now - self._last_loaded_ts) >= ADN_HOSTS_TTL_SEC

    def is_sync_running(self) -> bool:
        return bool(self._bg_sync_task and not self._bg_sync_task.done())

    def ensure_fresh_background(self) -> bool:
        """
        Non-blocking check meant for any ADN hotspot entry:
        if >24h passed since last successful sync (or no live cache yet), schedules background fetch.
        Returns True if a background sync task is active/started.
        """
        now = time.time()
        if not self.needs_sync(now):
            return False
        if self.is_sync_running():
            return True
        if self._last_failed_attempt_ts > 0 and (now - self._last_failed_attempt_ts) < ADN_RETRY_COOLDOWN_SEC:
            return False
        try:
            loop = asyncio.get_running_loop()
            self._bg_sync_task = loop.create_task(self.fetch_hosts(force=True))
            return True
        except RuntimeError:
            return False

    async def fetch_hosts(self, force: bool = False) -> List[Dict[str, Any]]:
        """
        Fetches and parses live ADN servers from https://adn.systems/api/status (or /status HTML).
        Updates _last_loaded_ts and disk cache ONLY after successful completion.
        """
        now = time.time()
        if not force and not self.needs_sync(now):
            return self._servers

        async with self._get_lock():
            now = time.time()
            if not force and not self.needs_sync(now):
                return self._servers

            def _do_fetch() -> List[Dict[str, Any]]:
                raw_json = _http_get_text(ADN_STATUS_API_URL, accept="application/json")
                parsed = _parse_adn_status_payload(raw_json, None)
                if len(parsed) >= 3:
                    return parsed
                raw_html = _http_get_text(ADN_STATUS_PAGE_URL, accept="text/html,application/xhtml+xml")
                return _parse_adn_status_payload(raw_json, raw_html)

            valid_srvs = await asyncio.to_thread(_do_fetch)
            if valid_srvs and len(valid_srvs) >= 3:
                success_ts = time.time()
                self._servers = valid_srvs
                self._last_loaded_ts = success_ts
                self._last_failed_attempt_ts = 0.0
                self._source = "live"
                self._save_to_cache(valid_srvs, success_ts)
                logger.info(f"[ADN_HOSTS] Synchronized {len(valid_srvs)} live ADN servers; updated timestamp reset to {int(success_ts)}")
                return self._servers

            # Do NOT update _last_loaded_ts on failure! Retain existing servers and retry after cooldown.
            self._last_failed_attempt_ts = time.time()
            if not self._servers or len(self._servers) < 3:
                self._servers = list(FALLBACK_ADN_SERVERS)
            logger.warning("[ADN_HOSTS] Remote fetch/parse from adn.systems failed; retaining previous timestamp so next check can retry")
            return self._servers

    def get_hosts(self, enriched: bool = False) -> Dict[str, Any]:
        """Returns JSON-compatible payload for API."""
        return {
            "status": "ok",
            "source": self._source,
            "last_loaded": self._last_loaded_ts,
            "last_sync_ts": int(self._last_loaded_ts) if self._last_loaded_ts > 0 else 0,
            "sync_in_progress": self.is_sync_running(),
            "needs_sync": self.needs_sync(),
            "count": len(self._servers),
            "servers": list(self._servers),
        }

    def _get_live_lock(self) -> asyncio.Lock:
        if self._live_fetch_lock is None:
            self._live_fetch_lock = asyncio.Lock()
        return self._live_fetch_lock

    async def fetch_live_adn_tgs(self, force: bool = False) -> List[Dict[str, Any]]:
        now = time.time()
        if not force and (now - self._last_live_fetch_ts) < 15.0 and self._live_tgs:
            return self._live_tgs

        async with self._get_live_lock():
            now = time.time()
            if not force and (now - self._last_live_fetch_ts) < 15.0 and self._live_tgs:
                return self._live_tgs

            def _do_fetch_live() -> List[Dict[str, Any]]:
                raw = _http_get_text(ADN_LISTEN_TGS_URL, accept="application/json")
                if not raw:
                    return []
                try:
                    data = json.loads(raw)
                    if isinstance(data, dict):
                        return data.get("tgs", [])
                    if isinstance(data, list):
                        return data
                except Exception as e:
                    logger.warning(f"[ADN_HOSTS] Failed to parse live TGs JSON: {e}")
                return []

            raw_tgs = await asyncio.to_thread(_do_fetch_live)
            valid_list: List[Dict[str, Any]] = []

            try:
                from dmr.tg_resolver import tg_resolver
            except ImportError:
                try:
                    from src.dmr.tg_resolver import tg_resolver
                except ImportError:
                    tg_resolver = None

            for item in raw_tgs:
                if not isinstance(item, dict):
                    continue
                try:
                    tg_id = int(item.get("tg") or 0)
                except (ValueError, TypeError):
                    continue
                if tg_id <= 0 or tg_id in ADN_SERVICE_TGS:
                    continue

                tg_name = str(item.get("name") or "").strip()
                if not tg_name and tg_resolver:
                    tg_name = tg_resolver.get_name(tg_id, network_type="adn")

                listeners = int(item.get("listeners") or 0)
                active = bool(item.get("active"))
                talker_dict = item.get("talker") if isinstance(item.get("talker"), dict) else {}

                entry = {
                    "tg": tg_id,
                    "id": tg_id,
                    "name": tg_name,
                    "listeners": listeners,
                    "active": active,
                    "talker": talker_dict,
                    "last_seen_active_ts": now if active else self._recent_live_tgs.get(tg_id, {}).get("last_seen_active_ts", now),
                }
                valid_list.append(entry)
                self._recent_live_tgs[tg_id] = entry

            expired = [k for k, v in self._recent_live_tgs.items() if (now - v.get("last_seen_active_ts", 0)) > 1800.0]
            for k in expired:
                self._recent_live_tgs.pop(k, None)

            if valid_list:
                self._live_tgs = valid_list
                self._last_live_fetch_ts = now

            return self._live_tgs

    async def pick_live_or_active_adn_tg(self, exclude_ids: Optional[Set[int]] = None) -> Tuple[Optional[Dict[str, Any]], bool, str]:
        import random
        await self.fetch_live_adn_tgs(force=False)
        ex_set = set(exclude_ids or set()) | ADN_SERVICE_TGS

        active_pool = [t for t in self._live_tgs if t.get("active") and t.get("tg") not in ex_set]
        if active_pool:
            chosen = random.choice(active_pool)
            caller = (chosen.get("talker") or {}).get("call") or ""
            return chosen, True, caller

        recent_pool = [t for t in self._recent_live_tgs.values() if t.get("tg") not in ex_set]
        if recent_pool:
            chosen = random.choice(recent_pool)
            caller = (chosen.get("talker") or {}).get("call") or ""
            return chosen, bool(chosen.get("active")), caller

        fallback_pool = [t for t in self._live_tgs if t.get("tg") not in ex_set]
        if fallback_pool:
            chosen = random.choice(fallback_pool)
            caller = (chosen.get("talker") or {}).get("call") or ""
            return chosen, False, caller

        return None, False, ""


# Singleton instance
adn_hosts_mgr = AdnHostsManager()
