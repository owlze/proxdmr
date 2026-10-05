"""
DMR Callsign & Talker Alias Resolver for ProxDMR
Provides fast in-memory and persistent disk caching for DMR IDs,
asynchronous queries to RadioID.net API, and caller display formatting.
"""

import asyncio
import json
import logging
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger("proxdmr.resolver")

CACHE_DIR = Path(__file__).resolve().parent.parent / "data"
CACHE_FILE = CACHE_DIR / "callsign_cache.json"

# Pre-seeded well-known stations and IDs
DEFAULT_SEEDS = {
    2500967: {"callsign": "RA0ZIJ", "name": "Sandro", "country": "Russia", "city": "Viluchinsk"},
    2501: {"callsign": "TG 2501", "name": "Russia National", "country": "Russia", "city": ""},
    2502: {"callsign": "TG 2502", "name": "Russia Multi-Regional", "country": "Russia", "city": ""},
    250: {"callsign": "TG 250", "name": "CIS / Russian", "country": "Russia", "city": ""},
    91: {"callsign": "TG 91", "name": "Worldwide", "country": "Global", "city": ""},
    92: {"callsign": "TG 92", "name": "Europe", "country": "Europe", "city": ""},
    9990: {"callsign": "TG 9990", "name": "Parrot Echo", "country": "Global", "city": ""},
}


def clean_name(name: str) -> str:
    """Sanitizes user names from databases (removes placeholders)."""
    if not name:
        return ""
    n = name.strip()
    nl = n.lower()
    if "ask admin" in nl or nl in ("none", "no name", "unknown", "n/a"):
        return ""
    return n


def format_caller_display(
    dmr_id: int,
    callsign: str = "",
    name: str = "",
    talker_alias: str = "",
) -> str:
    """
    Formats the caller string according to user requirement:
    'вместо ID лучше имя/позывной или значение по Talker Alias, а ID уже в скобках'
    e.g.:
      'RA0ZIJ Sandro (2500967)'
      'RA0ZIJ (2500967)'
      'ID: 2500967' (if not yet resolved)
    """
    main_part = ""
    if talker_alias and talker_alias.strip():
        main_part = talker_alias.strip()
    elif callsign and callsign.strip() and callsign != "---" and not callsign.startswith("ID:"):
        call = callsign.strip().upper()
        c_name = clean_name(name)
        if c_name and c_name.upper() != call:
            main_part = f"{call} {c_name}"
        else:
            main_part = call

    if main_part and dmr_id:
        return f"{main_part} ({dmr_id})"
    elif main_part:
        return main_part
    elif dmr_id:
        return f"ID: {dmr_id}"
    return "---"


class DMRResolver:
    """
    Caches DMR ID lookups and queries RadioID.net asynchronously when unknown.
    """

    def __init__(self):
        self.cache: Dict[int, dict] = dict(DEFAULT_SEEDS)
        self.pending_lookups: Dict[int, asyncio.Future] = {}
        self._load_cache()

    def _load_cache(self):
        try:
            if CACHE_FILE.exists():
                with open(CACHE_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for k, v in data.items():
                        try:
                            self.cache[int(k)] = v
                        except ValueError:
                            pass
                logger.info(f"[RESOLVER] Loaded {len(self.cache)} cached callsigns from {CACHE_FILE}")
        except Exception as e:
            logger.warning(f"[RESOLVER] Could not load cache file: {e}")

    def _save_cache(self):
        try:
            CACHE_DIR.mkdir(parents=True, exist_ok=True)
            with open(CACHE_FILE, "w", encoding="utf-8") as f:
                json.dump(self.cache, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.warning(f"[RESOLVER] Could not save cache file: {e}")

    def get_cached(self, dmr_id: int) -> Optional[dict]:
        """Returns cached dict or None if never seen."""
        return self.cache.get(dmr_id)

    def set_talker_alias(self, dmr_id: int, alias: str):
        """Stores Talker Alias for an ID and updates cache."""
        if not alias or dmr_id <= 0:
            return
        entry = self.cache.get(dmr_id) or {}
        entry["talker_alias"] = alias.strip()
        self.cache[dmr_id] = entry
        self._save_cache()

    async def resolve(self, dmr_id: int) -> dict:
        """
        Asynchronously resolves DMR ID. Returns dict with callsign, name, country, city, talker_alias.
        If not in cache, queries RadioID.net. Deduplicates concurrent requests.
        """
        if dmr_id <= 0:
            return {}

        if dmr_id in self.cache and self.cache[dmr_id].get("callsign"):
            return self.cache[dmr_id]

        if dmr_id in self.pending_lookups:
            try:
                return await self.pending_lookups[dmr_id]
            except Exception:
                return self.cache.get(dmr_id, {})

        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self.pending_lookups[dmr_id] = future

        try:
            res = await self._fetch_from_radioid(dmr_id)
            if res:
                self.cache[dmr_id] = {**self.cache.get(dmr_id, {}), **res}
                self._save_cache()
                future.set_result(self.cache[dmr_id])
                return self.cache[dmr_id]
            else:
                fallback = self.cache.get(dmr_id, {"callsign": "", "name": "", "country": "", "city": ""})
                future.set_result(fallback)
                return fallback
        except Exception as e:
            logger.debug(f"[RESOLVER] Error resolving {dmr_id}: {e}")
            fallback = self.cache.get(dmr_id, {"callsign": "", "name": "", "country": "", "city": ""})
            future.set_result(fallback)
            return fallback
        finally:
            self.pending_lookups.pop(dmr_id, None)

    async def _fetch_from_radioid(self, dmr_id: int) -> Optional[dict]:
        """Queries database.radioid.net in a worker thread."""
        url = f"https://database.radioid.net/api/dmr/user/?id={dmr_id}"

        def _worker():
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "ProxDMR/1.0 (Amateur Radio Web Transceiver)"}
            )
            with urllib.request.urlopen(req, timeout=3.0) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode("utf-8"))
            return None

        try:
            data = await asyncio.to_thread(_worker)
            if data and data.get("count", 0) > 0 and data.get("results"):
                user = data["results"][0]
                callsign = (user.get("callsign") or "").strip().upper()
                fname = (user.get("fname") or "").strip()
                surname = (user.get("surname") or "").strip()
                name = clean_name(f"{fname} {surname}".strip() if fname or surname else "")
                country = (user.get("country") or "").strip()
                city = clean_name((user.get("city") or "").strip())
                return {
                    "callsign": callsign,
                    "name": name,
                    "country": country,
                    "city": city,
                }
        except Exception as e:
            logger.debug(f"[RESOLVER] RadioID query failed for {dmr_id}: {e}")
        return None
