# -*- coding: utf-8 -*-
"""
AllStarLink official global nodes directory manager & cache service.
Fetches official node database from http://allmondb.allstarlink.org/ (~41,000 nodes).
Caches parsed nodes in src/data/allstar_nodes_cache.json (TTL = 24h).
Provides fast O(1) exact matching and sub-millisecond prefix/substring search.
"""

import asyncio
import json
import logging
import re
import socket
import struct
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    import aiohttp
except ImportError:
    aiohttp = None

logger = logging.getLogger("proxdmr.allstar_dir")

DATA_DIR = Path(__file__).resolve().parent / "data"
ASL_CACHE_FILE = DATA_DIR / "allstar_nodes_cache.json"
ASL_ALLMON_URL = "http://allmondb.allstarlink.org/"
ASL_CACHE_TTL_SEC = 12 * 3600  # 12 hours (twice daily)
PROBE_CACHE_TTL_SEC = 300.0    # 5 minutes (node telemetry cache)
CIRCUIT_BREAKER_COOLDOWN_SEC = 900.0  # 15 minutes
USER_AGENT = "ProxDMR/1.0"

CURATED_POPULAR_NODES = [
    {"node": "1999", "callsign": "PARROT", "name": "Parrot Echo", "location": "Эхо-репитер Попугай (проверка звука и микрофона)", "country": "LOCAL", "flag": "🦜"},
    {"node": "41522", "callsign": "HUBNET", "name": "HUBNet UK", "location": "United Kingdom National Hub", "country": "GB", "flag": "🇬🇧"},
    {"node": "27339", "callsign": "EASTC", "name": "East Coast Reflector", "location": "US East Coast ASL Hub", "country": "US", "flag": "🇺🇸"},
    {"node": "2143", "callsign": "WANRS", "name": "WAN RS System", "location": "Western PA & Ohio Hub", "country": "US", "flag": "🇺🇸"},
    {"node": "51010", "callsign": "WORLD", "name": "World Conference", "location": "Worldwide ASL Conference", "country": "GLOBAL", "flag": "🌐"},
    {"node": "28554", "callsign": "RU3AID", "name": "Moscow ASL Hub", "location": "Российский узел AllStarLink (RU3AID)", "country": "RU", "flag": "🇷🇺"},
    {"node": "52495", "callsign": "DL-NW", "name": "DL-Nordwest", "location": "German ASL Network", "country": "DE", "flag": "🇩🇪"},
    {"node": "2000", "callsign": "WESTC", "name": "Western Reflector", "location": "US Western System", "country": "US", "flag": "🇺🇸"},
    {"node": "43393", "callsign": "VKHUB", "name": "Australia ASL Hub", "location": "VK National Repeater Hub", "country": "AU", "flag": "🇦🇺"}
]

def detect_country_flag(callsign: str, location: str, node: str) -> Tuple[str, str]:
    if node in ("1999", "9998", "9999"):
        return ("LOCAL", "🦜")
    if node == "51010":
        return ("GLOBAL", "🌐")
    if node == "28554":
        return ("RU", "🇷🇺")
    c = (callsign or "").upper().strip()
    loc = (location or "").upper()

    if any(c.startswith(p) for p in ("RA", "RC", "RD", "RG", "RN", "RO", "RT", "RU", "RV", "RW", "RX", "RY", "RZ", "UA", "UB", "UC", "UD", "UF", "UG", "UH", "UI")) or bool(re.search(r"\b(RUSSIA|RUSSIAN)\b", loc)):
        return ("RU", "🇷🇺")
    if any(c.startswith(p) for p in ("DL", "DJ", "DK", "DO", "DF", "DH", "DB", "DG", "DC", "DD", "DM")) or "GERMANY" in loc:
        return ("DE", "🇩🇪")
    if any(c.startswith(p) for p in ("G", "M", "2E", "2M", "2D")) or "UNITED KINGDOM" in loc or "ENGLAND" in loc or "UK" in loc:
        return ("GB", "🇬🇧")
    if any(c.startswith(p) for p in ("VK", "AX")) or "AUSTRALIA" in loc:
        return ("AU", "🇦🇺")
    if c.startswith("ZL") or "NEW ZEALAND" in loc:
        return ("NZ", "🇳🇿")
    if any(c.startswith(p) for p in ("VE", "VA", "VO", "VY")) or "CANADA" in loc:
        return ("CA", "🇨🇦")
    if any(c.startswith(p) for p in ("JA", "JH", "JR", "JE", "JF", "JG", "JI", "JJ", "JK", "JL", "JM", "JN", "JO", "JP", "7J", "7K", "7L", "7M", "7N")) or "JAPAN" in loc:
        return ("JP", "🇯🇵")
    if c.startswith("F") or "FRANCE" in loc:
        return ("FR", "🇫🇷")
    if c.startswith("I") or "ITALY" in loc:
        return ("IT", "🇮🇹")
    if any(c.startswith(p) for p in ("EA", "EB", "EC", "ED")) or "SPAIN" in loc:
        return ("ES", "🇪🇸")
    if any(c.startswith(p) for p in ("UR", "US", "UT", "UU", "UV", "UW", "UX", "UY", "UZ")) or "UKRAINE" in loc:
        return ("UA", "🇺🇦")
    if any(c.startswith(p) for p in ("SP", "SQ", "SN", "SO", "3Z")) or "POLAND" in loc:
        return ("PL", "🇵🇱")
    if c.startswith("OE") or "AUSTRIA" in loc:
        return ("AT", "🇦🇹")
    if any(c.startswith(p) for p in ("HB9", "HB0")) or "SWITZERLAND" in loc:
        return ("CH", "🇨🇭")
    if any(c.startswith(p) for p in ("PA", "PB", "PC", "PD", "PE", "PF", "PG", "PH", "PI")) or "NETHERLANDS" in loc:
        return ("NL", "🇳🇱")
    if any(c.startswith(p) for p in ("OH", "OF", "OG", "OI")) or "FINLAND" in loc:
        return ("FI", "🇫🇮")
    if any(c.startswith(p) for p in ("SM", "SA", "SB", "SC", "SD", "SE", "SF", "SG", "SH", "SI", "SJ", "SK")) or "SWEDEN" in loc:
        return ("SE", "🇸🇪")
    if any(c.startswith(p) for p in ("LA", "LB", "LC", "LD", "LE", "LF", "LG", "LH", "LI", "LJ", "LN")) or "NORWAY" in loc:
        return ("NO", "🇳🇴")
    if any(c.startswith(p) for p in ("ZS", "ZR", "ZT", "ZU")) or "SOUTH AFRICA" in loc:
        return ("ZA", "🇿🇦")
    if any(c.startswith(p) for p in ("LU", "LW", "AY", "AZ")) or "ARGENTINA" in loc:
        return ("AR", "🇦🇷")
    if any(c.startswith(p) for p in ("PY", "PP", "PR", "PS", "PT", "PU", "PV", "PW", "PX")) or "BRAZIL" in loc:
        return ("BR", "🇧🇷")
    if any(c.startswith(p) for p in ("W", "K", "N", "AA", "AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI", "AJ", "AK", "AL")) or ", US" in loc or "USA" in loc:
        return ("US", "🇺🇸")
    return ("INT", "🌐")

class AllStarDirectoryManager:
    def __init__(self):
        self._nodes: List[Dict[str, Any]] = list(CURATED_POPULAR_NODES)
        self._node_index: Dict[str, Dict[str, Any]] = {n["node"]: n for n in CURATED_POPULAR_NODES}
        self._last_loaded_ts: float = 0.0
        self._source: str = "builtin"
        self._updating: bool = False
        self._probe_cache: Dict[str, Dict[str, Any]] = {}
        self._probe_cache_ts: Dict[str, float] = {}
        self._probe_sem: Optional[asyncio.Semaphore] = None
        self._stats_circuit_broken: bool = False
        self._stats_circuit_broken_ts: float = 0.0

    def get_stats(self) -> Dict[str, Any]:
        return {
            "total": len(self._nodes),
            "last_sync": int(self._last_loaded_ts),
            "source": self._source
        }

    def _load_cache(self) -> bool:
        if not ASL_CACHE_FILE.exists():
            return False
        try:
            with open(ASL_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            nodes = data.get("nodes", [])
            if isinstance(nodes, list) and len(nodes) > 10:
                self._nodes = nodes
                self._node_index = {str(n.get("node")): n for n in nodes if "node" in n}
                # Ensure curated nodes are present in index
                for cn in CURATED_POPULAR_NODES:
                    if cn["node"] not in self._node_index:
                        self._nodes.insert(0, cn)
                        self._node_index[cn["node"]] = cn
                self._last_loaded_ts = data.get("generated_at", ASL_CACHE_FILE.stat().st_mtime)
                self._source = "cache"
                logger.info(f"[ASL-DIR] Loaded {len(self._nodes)} nodes from cache")
                return True
        except Exception as e:
            logger.warning(f"[ASL-DIR] Failed to read cache {ASL_CACHE_FILE}: {e}")
        return False

    def _save_cache(self):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            payload = {
                "generated_at": int(time.time()),
                "count": len(self._nodes),
                "nodes": self._nodes
            }
            tmp_file = ASL_CACHE_FILE.with_suffix(".tmp")
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False)
            tmp_file.replace(ASL_CACHE_FILE)
            logger.info(f"[ASL-DIR] Saved {len(self._nodes)} nodes to {ASL_CACHE_FILE}")
        except Exception as e:
            logger.error(f"[ASL-DIR] Failed to write cache: {e}")

    def _download_and_parse(self) -> List[Dict[str, Any]]:
        req = urllib.request.Request(
            ASL_ALLMON_URL,
            headers={"User-Agent": USER_AGENT}
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            content = resp.read().decode("utf-8", errors="replace")

        lines = content.splitlines()
        parsed = []
        seen = set()

        # Add curated nodes first
        for cn in CURATED_POPULAR_NODES:
            parsed.append(cn)
            seen.add(cn["node"])

        for l in lines:
            parts = l.strip().split("|")
            if len(parts) >= 2:
                n_str = parts[0].strip()
                if not n_str or not n_str.isdigit():
                    continue
                if n_str in seen:
                    continue
                call = parts[1].strip()
                desc = parts[2].strip() if len(parts) > 2 else ""
                loc = parts[3].strip() if len(parts) > 3 else ""
                country, flag = detect_country_flag(call, loc, n_str)
                name = desc if desc else (f"{call} Repeater" if call else f"Node {n_str}")
                item = {
                    "node": n_str,
                    "callsign": call,
                    "name": name,
                    "location": loc or desc,
                    "country": country,
                    "flag": flag
                }
                parsed.append(item)
                seen.add(n_str)
        return parsed

    async def fetch_nodes(self, force: bool = False) -> List[Dict[str, Any]]:
        if self._updating:
            return self._nodes

        now = time.time()
        # If cache exists and fresh, and not forced, use it
        if not force and len(self._nodes) > 100 and (now - self._last_loaded_ts) < ASL_CACHE_TTL_SEC:
            return self._nodes

        # Try loading from disk if memory is empty
        if not force and len(self._nodes) <= len(CURATED_POPULAR_NODES):
            if self._load_cache():
                if (now - self._last_loaded_ts) < ASL_CACHE_TTL_SEC:
                    return self._nodes

        self._updating = True
        try:
            logger.info(f"[ASL-DIR] Fetching AllStarLink database from {ASL_ALLMON_URL}...")
            parsed = await asyncio.to_thread(self._download_and_parse)
            if len(parsed) > 100:
                self._nodes = parsed
                self._node_index = {n["node"]: n for n in parsed}
                self._last_loaded_ts = time.time()
                self._source = "allmondb.allstarlink.org"
                await asyncio.to_thread(self._save_cache)
                logger.info(f"[ASL-DIR] Successfully synchronized {len(self._nodes)} AllStarLink nodes")
        except Exception as e:
            logger.error(f"[ASL-DIR] Sync error: {e}")
            if len(self._nodes) <= len(CURATED_POPULAR_NODES):
                self._load_cache()
        finally:
            self._updating = False

        return self._nodes

    def get_node_info(self, node: str, fallback_callsign: str = "") -> Dict[str, Any]:
        """Returns normalized node information with flag, callsign, and extracted city name."""
        if not self._node_index:
            self._load_cache()
        n_str = str(node or "").strip()
        info = self._node_index.get(n_str)
        if info:
            loc = (info.get("location") or info.get("name") or "").strip()
            # Clean city: take first segment before comma or slash
            city = loc.split(",")[0].split("/")[0].strip() if loc else ""
            call = info.get("callsign") or f"Node {n_str}"
            flag = info.get("flag") or "🌐"
            country = info.get("country") or "INT"
            return {
                "node": n_str,
                "callsign": call,
                "name": info.get("name") or call,
                "location": loc,
                "city": city,
                "country": country,
                "flag": flag,
            }
        
        # Fallback if node not in global directory
        fb_call = (fallback_callsign or "").strip()
        country, flag = detect_country_flag(fb_call, "", n_str) if fb_call else ("INT", "🌐")
        return {
            "node": n_str,
            "callsign": fb_call or f"Node {n_str}",
            "name": f"Node {n_str}",
            "location": "",
            "city": "",
            "country": country,
            "flag": flag,
        }

    def search(self, query: str = "", limit: int = 50) -> Dict[str, Any]:
        q = (query or "").strip().lower()
        if not q:
            curated_keys = [cn["node"] for cn in CURATED_POPULAR_NODES]
            res = []
            seen = set()
            for k in curated_keys:
                if k in self._node_index:
                    res.append(self._node_index[k])
                    seen.add(k)
            for item in self._nodes:
                if item["node"] not in seen:
                    res.append(item)
                    seen.add(item["node"])
                if len(res) >= limit:
                    break
            return {
                "status": "ok",
                "total": len(self._nodes),
                "count": len(res),
                "last_sync": int(self._last_loaded_ts),
                "nodes": res
            }

        q_upper = q.upper()
        exact = []
        prefix_node = []
        prefix_call = []
        text_matches = []

        if q in self._node_index:
            exact.append(self._node_index[q])

        for item in self._nodes:
            n = item["node"]
            if n == q:
                continue
            call = item.get("callsign", "").upper()
            name = item.get("name", "").lower()
            loc = item.get("location", "").lower()

            if n.startswith(q):
                prefix_node.append(item)
            elif call == q_upper:
                prefix_call.insert(0, item)
            elif call.startswith(q_upper):
                prefix_call.append(item)
            elif q in name or q in loc or q in call.lower():
                text_matches.append(item)

            if len(exact) + len(prefix_node) + len(prefix_call) + len(text_matches) >= limit * 2:
                break

        combined = exact + prefix_node + prefix_call + text_matches
        results = []
        seen = set()
        for it in combined:
            if it["node"] not in seen:
                seen.add(it["node"])
                results.append(it)
                if len(results) >= limit:
                    break

        return {
            "status": "ok",
            "total": len(self._nodes),
            "count": len(results),
            "last_sync": int(self._last_loaded_ts),
            "nodes": results
        }


    @staticmethod
    def _query_dns_txt(node_str: str) -> Tuple[bool, str, int]:
        domain = f"{node_str}.nodes.allstarlink.org"
        q = struct.pack(">HHHHHH", 0x1234, 0x0100, 1, 0, 0, 0)
        for p in domain.split("."):
            q += bytes([len(p)]) + p.encode("ascii", "ignore")
        q += b"\x00" + struct.pack(">HH", 16, 1)

        for dns_ip in ("8.8.8.8", "1.1.1.1"):
            try:
                with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                    s.settimeout(0.75)
                    s.sendto(q, (dns_ip, 53))
                    resp, _ = s.recvfrom(1024)
                    ip_m = re.search(rb'IP=([0-9.]+)', resp)
                    pt_m = re.search(rb'PT=([0-9]+)', resp)
                    if ip_m:
                        ip = ip_m.group(1).decode("ascii")
                        port = int(pt_m.group(1).decode("ascii")) if pt_m else 4569
                        return True, ip, port
            except Exception:
                continue
        return False, "", 0

    @staticmethod
    def _iax_poke(ip: str, port: int) -> Tuple[bool, int]:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.settimeout(0.60)
                poke = struct.pack("!HHIBBBB", 0x8001, 0, 0, 0, 0, 6, 30)
                t0 = time.time()
                s.sendto(poke, (ip, port))
                data, addr = s.recvfrom(512)
                rtt_ms = max(1, round((time.time() - t0) * 1000))
                if len(data) >= 12:
                    sc, dc, ts, oseq, iseq, ftype, subclass = struct.unpack("!HHIBBBB", data[:12])
                    if ftype == 6 and subclass == 3:  # PONG
                        ack = struct.pack("!HHIBBBB", 0x8001, sc & 0x7FFF, ts, iseq, (oseq + 1) & 0xFF, 6, 4)
                        s.sendto(ack, addr)
                        return True, rtt_ms
        except Exception:
            pass
        return False, 0

    def is_stats_circuit_broken(self) -> bool:
        """Returns True if upstream AllStar stats API has consecutive failures and should be bypassed."""
        if getattr(self, "_stats_circuit_broken", False):
            if time.time() - getattr(self, "_stats_circuit_broken_ts", 0) > CIRCUIT_BREAKER_COOLDOWN_SEC:
                logger.info("[ASL-DIR] Stats API circuit breaker cooldown elapsed (15m), probing again.")
                self._stats_circuit_broken = False
                return False
            return True
        return False

    def _fetch_stats(self, node_str: str) -> dict:
        if self.is_stats_circuit_broken():
            return {}
        try:
            import ssl
            import urllib.error
            url = f"https://stats.allstarlink.org/api/stats/{node_str}"
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=2.5, context=ctx) as r:
                if r.status == 200:
                    d = json.loads(r.read().decode("utf-8", "ignore"))
                    return d.get("stats", {}).get("data", {}) or {}
        except urllib.error.HTTPError as e:
            if e.code == 429:
                logger.warning(f"[ASL-DIR] Rate limit 429 from stats.allstarlink.org ({node_str})! Tripping circuit breaker for 15 min.")
                self._stats_circuit_broken = True
                self._stats_circuit_broken_ts = time.time()
        except urllib.error.URLError as e:
            err_str = str(e).lower()
            if "111" in err_str or "connection refused" in err_str:
                logger.warning(f"[ASL-DIR] Connection refused from stats.allstarlink.org ({e}) for node {node_str}! Tripping circuit breaker for 15 min.")
                self._stats_circuit_broken = True
                self._stats_circuit_broken_ts = time.time()
        except Exception:
            pass
        return {}

    async def probe_nodes_batch(self, nodes: List[str], force: bool = False) -> Dict[str, Dict[str, Any]]:
        """
        Probes a batch of ASL nodes (DNS TXT + stateless IAX2 POKE + ASL Stats API).
        Results are cached in memory for 300 seconds (or 600s during circuit break).
        """
        now = time.time()
        results: Dict[str, Dict[str, Any]] = {}
        nodes_to_probe: List[str] = []
        is_circuit_broken = self.is_stats_circuit_broken()
        effective_ttl = 600.0 if is_circuit_broken else PROBE_CACHE_TTL_SEC

        for raw_n in (nodes or [])[:35]:
            n_str = str(raw_n).strip()
            if not n_str or not n_str.isdigit():
                continue
            if not force and n_str in self._probe_cache:
                cache_age = now - self._probe_cache_ts.get(n_str, 0)
                if cache_age < effective_ttl:
                    results[n_str] = self._probe_cache[n_str]
                    continue
            nodes_to_probe.append(n_str)

        if not nodes_to_probe:
            return results

        # Large batch (> 20 nodes, e.g. directory search) or circuit broken: skip HTTP stats completely
        fetch_http_stats = (len(nodes_to_probe) <= 20) and (not is_circuit_broken)

        # Step 1 & 2: DNS TXT + IAX2 POKE in parallel
        async def _probe_reachability(n_str: str) -> Dict[str, Any]:
            if n_str in ("1999", "9998", "9999"):
                return {
                    "node": n_str,
                    "online": True,
                    "pong": True,
                    "rtt_ms": 1,
                    "links_count": 0,
                    "keyed": False,
                    "traffic_level": "low",
                    "tx_duty_pct": 0.0,
                    "keyups_per_hour": 0.0,
                    "checked_at": int(now),
                    "checked_stats": True,
                }

            dns_found, ip, port = await asyncio.to_thread(self._query_dns_txt, n_str)
            pong = False
            rtt_ms = 0
            if dns_found and ip:
                pong, rtt_ms = await asyncio.to_thread(self._iax_poke, ip, port)

            online = bool(dns_found or pong)
            return {
                "node": n_str,
                "online": online,
                "pong": pong,
                "rtt_ms": rtt_ms if pong else 0,
                "links_count": 0,
                "keyed": False,
                "traffic_level": "offline" if not online else "low",
                "tx_duty_pct": 0.0,
                "keyups_per_hour": 0.0,
                "checked_at": int(now),
                "checked_stats": False,
            }

        reach_results = await asyncio.gather(*(_probe_reachability(n) for n in nodes_to_probe))
        node_map = {r["node"]: r for r in reach_results}

        # Step 3: For matrix buttons (<= 20 nodes), query stats sequentially with gentle pacing delay
        if fetch_http_stats:
            for n_str in nodes_to_probe:
                item = node_map[n_str]
                if not item["online"]:
                    continue
                if self.is_stats_circuit_broken():
                    break

                st = await asyncio.to_thread(self._fetch_stats, n_str)
                if st:
                    linked = st.get("linkedNodes") or st.get("links") or []
                    links_count = len(linked) if isinstance(linked, list) else 0
                    keyed = bool(st.get("keyed"))
                    uptime_sec = max(1, int(st.get("apprptuptime") or 0))
                    tx_sec = max(0, int(st.get("totaltxtime") or 0))
                    keyups = max(0, int(st.get("totalkeyups") or 0))

                    tx_duty_pct = 0.0
                    keyups_per_hour = 0.0
                    if uptime_sec >= 60:
                        tx_duty_pct = round(min(100.0, (tx_sec / uptime_sec) * 100.0), 1)
                        keyups_per_hour = round(keyups / max(0.1, uptime_sec / 3600.0), 1)

                    if keyed:
                        traffic_level = "live"
                    elif tx_duty_pct >= 8.0 or keyups_per_hour >= 35.0 or links_count >= 20:
                        traffic_level = "high"
                    elif tx_duty_pct >= 1.5 or keyups_per_hour >= 6.0 or links_count >= 3:
                        traffic_level = "medium"
                    else:
                        traffic_level = "low"

                    item["links_count"] = links_count
                    item["keyed"] = keyed
                    item["tx_duty_pct"] = tx_duty_pct
                    item["keyups_per_hour"] = keyups_per_hour
                    item["traffic_level"] = traffic_level
                    item["checked_stats"] = True

                await asyncio.sleep(0.35)

        for n_str, res in node_map.items():
            self._probe_cache[n_str] = res
            self._probe_cache_ts[n_str] = now
            results[n_str] = res

        return results

    def feed_node_stats(self, node: str, stats: Dict[str, Any]) -> Dict[str, Any]:
        """Allows client to feed stats obtained directly from stats.allstarlink.org."""
        node_str = str(node).strip()
        if not node_str:
            return {}
        cur = self._probe_cache.get(node_str) or {
            "node": node_str,
            "online": True,
            "pong": True,
            "rtt_ms": 1,
            "links_count": 0,
            "keyed": False,
            "traffic_level": "low",
            "tx_duty_pct": 0.0,
            "keyups_per_hour": 0.0,
            "checked_at": int(time.time()),
        }
        if stats and isinstance(stats, dict):
            linked = stats.get("linkedNodes") or stats.get("links") or []
            links_count = len(linked) if isinstance(linked, list) else int(stats.get("links_count") or 0)
            cur["links_count"] = links_count

            keyed = bool(stats.get("keyed"))
            cur["keyed"] = keyed

            uptime_sec = max(1, int(stats.get("apprptuptime") or 0))
            tx_sec = max(0, int(stats.get("totaltxtime") or 0))
            keyups = max(0, int(stats.get("totalkeyups") or 0))

            tx_duty_pct = 0.0
            keyups_per_hour = 0.0
            if uptime_sec >= 60:
                tx_duty_pct = round(min(100.0, (tx_sec / uptime_sec) * 100.0), 1)
                keyups_per_hour = round(keyups / max(0.1, uptime_sec / 3600.0), 1)
                cur["tx_duty_pct"] = tx_duty_pct
                cur["keyups_per_hour"] = keyups_per_hour

            if keyed:
                traffic_level = "live"
            elif tx_duty_pct >= 8.0 or keyups_per_hour >= 35.0 or links_count >= 20:
                traffic_level = "high"
            elif tx_duty_pct >= 1.5 or keyups_per_hour >= 6.0 or links_count >= 3:
                traffic_level = "medium"
            else:
                traffic_level = "low"
            cur["traffic_level"] = traffic_level
            cur["online"] = True
            cur["checked_stats"] = True
            cur["checked_at"] = int(time.time())
            cur["stats_fed_by_client"] = True

        self._probe_cache[node_str] = cur
        self._probe_cache_ts[node_str] = time.time()
        return cur

    async def periodic_update_loop(self):
        """Background loop to ensure nodes database is loaded on startup and updated daily."""
        try:
            await self.fetch_nodes(force=False)
        except Exception as e:
            logger.warning(f"[ASL-DIR] Initial startup fetch error: {e}")

        while True:
            try:
                await asyncio.sleep(ASL_CACHE_TTL_SEC)
                logger.info("[ASL-DIR] Running scheduled AllStarLink node directory refresh (twice daily, 12h)...")
                await self.fetch_nodes(force=True)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[ASL-DIR] Periodic update error: {e}")

allstar_dir_mgr = AllStarDirectoryManager()
allstar_dir = allstar_dir_mgr
