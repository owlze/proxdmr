import asyncio
import collections
import json
import logging
import os
import socket
import struct
import time
from typing import Dict, List, Optional, Tuple, Deque, Any, Callable

logger = logging.getLogger("proxdmr.ping")

HISTORY_MAX_LEN = 20000  # Up to 20,000 data points per host (support 24-28h at 5s interval)

def _icmp_checksum(source_bytes: bytes) -> int:
    count_to = (len(source_bytes) // 2) * 2
    total = 0
    count = 0
    while count < count_to:
        val = source_bytes[count + 1] * 256 + source_bytes[count]
        total = (total + val) & 0xFFFFFFFF
        count += 2
    if count_to < len(source_bytes):
        total = (total + source_bytes[-1]) & 0xFFFFFFFF
    total = (total >> 16) + (total & 0xFFFF)
    total = total + (total >> 16)
    answer = (~total) & 0xFFFF
    return (answer >> 8) | ((answer << 8) & 0xFF00)

def measure_host_ping_and_loss(host: str, count: int = 3, timeout_per_probe: float = 0.5) -> Tuple[Optional[int], float]:
    """
    Measure ICMP round-trip time in milliseconds and packet loss percentage (0.0 - 100.0%)
    to the given host using unprivileged ICMP socket.
    Sends `count` echo requests spaced 40ms apart to measure true latency and loss.
    Returns (latency_ms, loss_percent).
    """
    if not host:
        return None, 100.0
    clean_host = host.strip()
    try:
        ip = socket.gethostbyname(clean_host)
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_ICMP)
        s.settimeout(timeout_per_probe)

        ident = int(time.time() * 1000) & 0xFFFF
        received_rtts = []

        for seq in range(1, count + 1):
            header = struct.pack("!BBHHH", 8, 0, 0, ident, seq)
            payload = b"ProxDMRPing"
            chk = _icmp_checksum(header + payload)
            packet = struct.pack("!BBHHH", 8, 0, chk, ident, seq) + payload

            t0 = time.time()
            try:
                s.sendto(packet, (ip, 1))
                recv_data, _ = s.recvfrom(1024)
                t1 = time.time()
                rtt = max(1, round((t1 - t0) * 1000))
                received_rtts.append(rtt)
            except (socket.timeout, TimeoutError):
                pass
            except Exception as e:
                logger.debug(f"[PING] Probe #{seq} error to {clean_host}: {e}")

            if seq < count:
                time.sleep(0.04)

        s.close()

        lost_count = count - len(received_rtts)
        loss_pct = round((lost_count / count) * 100.0, 1)
        avg_rtt = round(sum(received_rtts) / len(received_rtts)) if received_rtts else None
        return avg_rtt, loss_pct
    except Exception as e:
        logger.debug(f"[PING] ICMP ping to {clean_host} failed: {e}")
        return None, 100.0

def measure_host_ping(host: str, timeout: float = 2.0) -> Optional[int]:
    """
    Compatibility wrapper returning only latency.
    """
    rtt, _ = measure_host_ping_and_loss(host, count=1, timeout_per_probe=timeout)
    return rtt

def _benchmark_probe_worker(
    ip_addr: str,
    max_packets: int = 10,
    max_duration: float = 7.0,
    cancel_check: Optional[Callable[[], bool]] = None,
    packet_callback: Optional[Callable[[int, int, Optional[int]], None]] = None
) -> Dict[str, Any]:
    """
    Measures latency to ip_addr by sending up to max_packets (up to 10) or until max_duration (7s).
    Calls packet_callback(packets_sent, packets_recv, current_avg_rtt) on each packet.
    """
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_ICMP)
    ident = int(time.time() * 1000) & 0xFFFF
    rtts: List[int] = []
    t_start = time.time()
    packets_sent = 0

    try:
        for seq in range(1, max_packets + 1):
            if cancel_check and cancel_check():
                break
            elapsed = time.time() - t_start
            remaining = max_duration - elapsed
            if remaining <= 0.05:
                break

            probe_timeout = min(0.7, max(0.05, remaining))
            s.settimeout(probe_timeout)
            header = struct.pack("!BBHHH", 8, 0, 0, ident, seq)
            payload = b"ProxDMRBench"
            chk = _icmp_checksum(header + payload)
            packet = struct.pack("!BBHHH", 8, 0, chk, ident, seq) + payload

            packets_sent += 1
            t0 = time.time()
            try:
                s.sendto(packet, (ip_addr, 1))
                recv_data, _ = s.recvfrom(1024)
                t1 = time.time()
                rtt = max(1, round((t1 - t0) * 1000))
                rtts.append(rtt)
            except (socket.timeout, TimeoutError):
                pass
            except Exception as e:
                logger.debug(f"[BENCH] Probe #{seq} error to {ip_addr}: {e}")

            curr_avg = round(sum(rtts) / len(rtts)) if rtts else None
            if packet_callback:
                try:
                    packet_callback(packets_sent, len(rtts), curr_avg)
                except Exception:
                    pass

            if len(rtts) >= max_packets:
                break
            if time.time() - t_start >= max_duration:
                break

            time.sleep(0.04)
    finally:
        s.close()

    packets_recv = len(rtts)
    avg_ping = round(sum(rtts) / packets_recv) if packets_recv > 0 else None
    loss_pct = round(((packets_sent - packets_recv) / packets_sent) * 100.0, 1) if packets_sent > 0 else 100.0

    return {
        "avg_ping": avg_ping,
        "loss_pct": loss_pct,
        "packets_sent": packets_sent,
        "packets_recv": packets_recv,
        "status": "ok" if avg_ping is not None else "unreachable"
    }

class BMPingService:
    def __init__(self, get_hotspots_callback, broadcast_callback, interval: float = 5.0):
        self.get_hotspots = get_hotspots_callback
        self.broadcast = broadcast_callback
        self.interval = interval
        self.cached_pings: Dict[str, Optional[int]] = {}
        self.cached_host_pings: Dict[str, Optional[int]] = {}
        self.cached_losses: Dict[str, float] = {}
        self.cached_host_losses: Dict[str, float] = {}
        # host -> deque of (timestamp, latency_ms)
        self.history: Dict[str, Deque[Tuple[int, Optional[int]]]] = collections.defaultdict(
            lambda: collections.deque(maxlen=HISTORY_MAX_LEN)
        )
        # host -> deque of (timestamp, probe_loss_pct) for rolling window
        self.loss_history: Dict[str, Deque[Tuple[int, float]]] = collections.defaultdict(
            lambda: collections.deque(maxlen=1000)
        )
        self._task: Optional[asyncio.Task] = None
        self._running = False
        self._last_save_time = time.time()
        # Save to src/data/ping_history.json on mounted volume so 24/7 stats persist across restarts
        src_data_dir = os.path.join(os.path.dirname(__file__), "data")
        os.makedirs(src_data_dir, exist_ok=True)
        self._cache_file = os.path.join(src_data_dir, "ping_history.json")
        legacy_file = os.path.join(os.path.dirname(__file__), "..", "data", "ping_history.json")
        if not os.path.exists(self._cache_file) and os.path.exists(legacy_file):
            try:
                import shutil
                shutil.copy2(legacy_file, self._cache_file)
                logger.info(f"[PING] Migrated ping history cache from {legacy_file} to {self._cache_file}")
            except Exception as e:
                logger.debug(f"[PING] Migration error: {e}")
        self._load_history()
        # Benchmark subsystem
        self.cached_benchmark_results: List[Dict[str, Any]] = []
        self._benchmark_task: Optional[asyncio.Task] = None
        self._benchmark_cancel_event = asyncio.Event()
        self._benchmark_cache_file = os.path.join(src_data_dir, "bm_benchmark_results.json")
        self._load_benchmark_results()

    def _load_history(self):
        try:
            if os.path.exists(self._cache_file):
                with open(self._cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                cutoff = int(time.time()) - 86400 * 2  # keep up to 48h
                for host, pts in data.items():
                    valid_pts = [(int(p[0]), int(p[1]) if p[1] is not None else None) for p in pts if p[0] >= cutoff]
                    self.history[host] = collections.deque(valid_pts, maxlen=HISTORY_MAX_LEN)
                logger.info(f"[PING] Loaded ping history for {len(self.history)} hosts from cache.")
        except Exception as e:
            logger.debug(f"[PING] Could not load ping history cache: {e}")

    def _save_history(self):
        try:
            os.makedirs(os.path.dirname(self._cache_file), exist_ok=True)
            data = {host: list(q) for host, q in self.history.items()}
            with open(self._cache_file, "w", encoding="utf-8") as f:
                json.dump(data, f)
        except Exception as e:
            logger.debug(f"[PING] Could not save ping history cache: {e}")

    def _load_benchmark_results(self):
        try:
            if os.path.exists(self._benchmark_cache_file):
                with open(self._benchmark_cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, list):
                    self.cached_benchmark_results = data
                    logger.info(f"[PING] Loaded {len(data)} BM benchmark results from cache.")
        except Exception as e:
            logger.debug(f"[PING] Could not load benchmark cache: {e}")

    def _save_benchmark_results(self):
        try:
            os.makedirs(os.path.dirname(self._benchmark_cache_file), exist_ok=True)
            with open(self._benchmark_cache_file, "w", encoding="utf-8") as f:
                json.dump(self.cached_benchmark_results, f, ensure_ascii=False, indent=2)
        except Exception as e:
            logger.debug(f"[PING] Could not save benchmark cache: {e}")

    def get_history_dict(self, hours: float = 24.0, max_points: int = 2880) -> Dict[str, List[Tuple[int, Optional[int]]]]:
        cutoff = int(time.time() - hours * 3600)
        res = {}
        for host, q in self.history.items():
            pts = [p for p in q if p[0] >= cutoff]
            if len(pts) > max_points:
                step = len(pts) / max_points
                pts = [pts[int(i * step)] for i in range(max_points)]
            res[host] = pts
        return res

    def get_host_packet_loss(self, host: str, window_sec: int = 180) -> float:
        """
        Calculate rolling ICMP packet loss percentage (0.0 - 100.0%) over recent window_sec (default 3 min).
        """
        now_ts = int(time.time())
        cutoff = now_ts - window_sec
        q = self.loss_history.get(host)
        if not q:
            return 0.0
        recent = [item for item in q if item[0] >= cutoff]
        if not recent:
            return 0.0
        avg_loss = sum(item[1] for item in recent) / len(recent)
        return round(avg_loss, 1)

    def start(self):
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._run_loop())

    def stop(self):
        self._running = False
        self._save_history()
        if self._task and not self._task.done():
            self._task.cancel()

    async def ping_now(self):
        hotspots = self.get_hotspots()
        if not hotspots:
            return

        host_to_hids: Dict[str, List[str]] = {}
        for i, hs in enumerate(hotspots):
            hid = hs.get("id") if isinstance(hs, dict) else getattr(hs, "id", None)
            host = hs.get("bm_master_host") if isinstance(hs, dict) else getattr(getattr(hs, "config", hs), "bm_master_host", None)
            status = hs.get("status") if isinstance(hs, dict) else getattr(hs, "status", None)
            is_primary = hs.get("is_primary", False) if isinstance(hs, dict) else (i == 0)

            if not host:
                host = "2322.master.brandmeister.network"
            if not hid:
                hid = "default"

            # Primary (first) hotspot is pinged 24/7 continuously even when OFFLINE / disconnected
            if is_primary or i == 0:
                host_to_hids.setdefault(host, []).append(hid)
            else:
                # Secondary hotspots are only pinged when active
                is_active = status in ("ONLINE", "CONNECTING", "AUTHENTICATING", "CONFIGURING")
                if is_active:
                    host_to_hids.setdefault(host, []).append(hid)

        tasks = []
        hosts = list(host_to_hids.keys())
        for host in hosts:
            tasks.append(asyncio.to_thread(measure_host_ping_and_loss, host, 3, 0.5))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        now_ts = int(time.time())
        new_pings: Dict[str, Optional[int]] = {}
        new_host_pings: Dict[str, Optional[int]] = {}
        new_losses: Dict[str, Optional[float]] = {}
        new_host_losses: Dict[str, float] = {}

        for host, res in zip(hosts, results):
            if isinstance(res, tuple) and len(res) == 2:
                rtt, probe_loss = res
            elif isinstance(res, int):
                rtt, probe_loss = res, 0.0
            else:
                rtt, probe_loss = None, 100.0

            new_host_pings[host] = rtt
            self.history[host].append((now_ts, rtt))
            self.loss_history[host].append((now_ts, probe_loss))

            rolling_loss = self.get_host_packet_loss(host, window_sec=180)
            new_host_losses[host] = rolling_loss

            for hid in host_to_hids[host]:
                new_pings[hid] = rtt
                new_losses[hid] = rolling_loss

        # For inactive secondary hotspots, explicitly set ping and loss to None
        for i, hs in enumerate(hotspots):
            hid = hs.get("id") if isinstance(hs, dict) else getattr(hs, "id", None)
            if hid and hid not in new_pings:
                new_pings[hid] = None
                new_losses[hid] = None

        self.cached_pings = new_pings
        self.cached_host_pings = new_host_pings
        self.cached_losses = new_losses
        self.cached_host_losses = new_host_losses

        # Periodically persist history to cache every 5 minutes
        if now_ts - self._last_save_time > 300:
            self._last_save_time = now_ts
            self._save_history()

        if self.broadcast:
            try:
                await self.broadcast({
                    "type": "bm_ping",
                    "pings": self.cached_pings,
                    "hosts": self.cached_host_pings,
                    "host_pings": self.cached_host_pings,
                    "losses": self.cached_losses,
                    "host_losses": self.cached_host_losses,
                    "ts": now_ts,
                    "point": {
                        "ts": now_ts,
                        "pings": self.cached_pings,
                        "host_pings": self.cached_host_pings,
                        "losses": self.cached_losses,
                        "host_losses": self.cached_host_losses
                    }
                })
            except Exception as e:
                logger.debug(f"[PING] Broadcast error: {e}")

    async def _run_loop(self):
        logger.info(f"[PING] BMPingService background loop started (interval={self.interval}s)")
        try:
            while self._running:
                await self.ping_now()
                await asyncio.sleep(self.interval)
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error(f"[PING] Error in BMPingService loop: {e}")

    def is_benchmark_running(self) -> bool:
        return bool(self._benchmark_task and not self._benchmark_task.done())

    def get_benchmark_results(self) -> List[Dict[str, Any]]:
        return self.cached_benchmark_results

    def cancel_benchmark(self):
        if self.is_benchmark_running():
            self._benchmark_cancel_event.set()
            logger.info("[PING] BM Benchmark cancellation requested.")

    async def start_benchmark(self, servers: List[Dict[str, Any]]) -> bool:
        if self.is_benchmark_running():
            logger.warning("[PING] Benchmark already running, cancelling previous...")
            self.cancel_benchmark()
            try:
                await asyncio.wait_for(self._benchmark_task, timeout=2.0)
            except Exception:
                pass

        self._benchmark_cancel_event.clear()
        self._benchmark_task = asyncio.create_task(self._run_benchmark_task(servers))
        return True

    @staticmethod
    def _sort_benchmark_results(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        reachable = [it for it in items if it.get("avg_ping") is not None]
        unreachable = [it for it in items if it.get("avg_ping") is None]

        reachable.sort(key=lambda x: (x.get("avg_ping", 9999), x.get("loss_pct", 0), x.get("country_name", "")))
        unreachable.sort(key=lambda x: x.get("country_name", ""))

        result = []
        for rank, it in enumerate(reachable, 1):
            d = dict(it)
            d["rank"] = rank
            result.append(d)

        for it in unreachable:
            d = dict(it)
            d["rank"] = None
            result.append(d)

        return result

    async def _run_benchmark_task(self, servers: List[Dict[str, Any]]):
        total = len(servers)
        logger.info(f"[PING] Starting BM Benchmark for {total} servers...")
        tested_results: List[Dict[str, Any]] = []

        for idx, srv in enumerate(servers):
            if self._benchmark_cancel_event.is_set():
                logger.info("[PING] Benchmark stopped by user.")
                break

            srv_id = srv.get("id")
            c_code = srv.get("country_code") or srv.get("country") or ""
            c_name = srv.get("country_name") or c_code
            flag = srv.get("flag", "🌐")
            host = srv.get("host") or f"{srv_id}.master.brandmeister.network"
            ip = srv.get("ip")
            display_name = f"{flag} {c_name} (BM {srv_id})"

            srv_info = {
                "id": srv_id,
                "country_code": c_code,
                "country_name": c_name,
                "flag": flag,
                "host": host,
                "name": display_name,
            }

            if self.broadcast:
                try:
                    await self.broadcast({
                        "type": "bm_benchmark_progress",
                        "current_index": idx + 1,
                        "total_servers": total,
                        "percent": round((idx / total) * 100),
                        "progress_percent": round((idx / total) * 100),
                        "current_server": srv_info,
                        "server": srv_info,
                        "current_ping": None,
                        "current_avg_ping": None,
                        "packets_sent": 0,
                        "packets_recv": 0,
                        "results_so_far": self._sort_benchmark_results(tested_results)
                    })
                except Exception as e:
                    logger.debug(f"[PING] WS progress broadcast error: {e}")

            if not ip and host:
                try:
                    ip = await asyncio.to_thread(socket.gethostbyname, host)
                except Exception:
                    ip = None

            if not ip:
                res_item = {
                    "id": srv_id,
                    "country_code": c_code,
                    "country_name": c_name,
                    "flag": flag,
                    "host": host,
                    "name": display_name,
                    "avg_ping": None,
                    "loss_pct": 100.0,
                    "packets_sent": 0,
                    "packets_recv": 0,
                    "status": "unreachable"
                }
                tested_results.append(res_item)
                continue

            loop = asyncio.get_running_loop()

            def _on_packet(sent: int, recv: int, curr_avg: Optional[int]):
                if self._benchmark_cancel_event.is_set():
                    return
                sub_pct = min(0.95, (recv / 10.0)) if sent > 0 else 0.0
                prog_pct = round(((idx + sub_pct) / total) * 100)
                msg = {
                    "type": "bm_benchmark_progress",
                    "current_index": idx + 1,
                    "total_servers": total,
                    "percent": prog_pct,
                    "progress_percent": prog_pct,
                    "current_server": srv_info,
                    "server": srv_info,
                    "current_ping": curr_avg,
                    "current_avg_ping": curr_avg,
                    "packets_sent": sent,
                    "packets_recv": recv,
                    "results_so_far": self._sort_benchmark_results(tested_results)
                }
                if self.broadcast:
                    asyncio.run_coroutine_threadsafe(self.broadcast(msg), loop)

            probe_stats = await asyncio.to_thread(
                _benchmark_probe_worker,
                ip,
                max_packets=10,
                max_duration=7.0,
                cancel_check=self._benchmark_cancel_event.is_set,
                packet_callback=_on_packet
            )

            res_item = {
                "id": srv_id,
                "country_code": c_code,
                "country_name": c_name,
                "flag": flag,
                "host": host,
                "name": display_name,
                "avg_ping": probe_stats["avg_ping"],
                "loss_pct": probe_stats["loss_pct"],
                "packets_sent": probe_stats["packets_sent"],
                "packets_recv": probe_stats["packets_recv"],
                "status": probe_stats["status"]
            }
            tested_results.append(res_item)

            if probe_stats["avg_ping"] is not None:
                self.cached_host_pings[host] = probe_stats["avg_ping"]

            await asyncio.sleep(0.04)

        sorted_results = self._sort_benchmark_results(tested_results)
        self.cached_benchmark_results = sorted_results
        self._save_benchmark_results()

        is_cancelled = self._benchmark_cancel_event.is_set()
        logger.info(f"[PING] BM Benchmark completed (tested {len(tested_results)}/{total}, cancelled={is_cancelled})")

        if self.broadcast:
            try:
                await self.broadcast({
                    "type": "bm_benchmark_complete",
                    "cancelled": is_cancelled,
                    "total_servers": total,
                    "tested_count": len(tested_results),
                    "results": sorted_results
                })
            except Exception as e:
                logger.debug(f"[PING] WS complete broadcast error: {e}")



CLIENT_HISTORY_MAX_LEN = 15000  # Support up to 6-8 hours at 1.5-2s intervals

class ClientPingService:
    """
    Tracks round-trip latency (RTT) and packet loss between Web Client and ProxDMR Gateway.
    Persists history in src/data/client_ping_history.json.
    """
    def __init__(self):
        self.history: Deque[Tuple[int, Optional[int]]] = collections.deque(maxlen=CLIENT_HISTORY_MAX_LEN)
        self.current_rtt: Optional[int] = None
        self._last_save_time = time.time()
        src_data_dir = os.path.join(os.path.dirname(__file__), "data")
        os.makedirs(src_data_dir, exist_ok=True)
        self._cache_file = os.path.join(src_data_dir, "client_ping_history.json")
        self._load_history()

    def _load_history(self):
        try:
            if os.path.exists(self._cache_file):
                with open(self._cache_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                cutoff = int(time.time()) - 3600 * 8  # 8 hours
                valid_pts = [(int(p[0]), int(p[1]) if p[1] is not None else None) for p in data if p[0] >= cutoff]
                self.history = collections.deque(valid_pts, maxlen=CLIENT_HISTORY_MAX_LEN)
                if valid_pts and valid_pts[-1][1] is not None:
                    self.current_rtt = valid_pts[-1][1]
                logger.info(f"[PING] Loaded client ping history ({len(self.history)} points).")
        except Exception as e:
            logger.debug(f"[PING] Could not load client ping history: {e}")

    def _save_history(self):
        try:
            os.makedirs(os.path.dirname(self._cache_file), exist_ok=True)
            with open(self._cache_file, "w", encoding="utf-8") as f:
                json.dump(list(self.history), f)
        except Exception as e:
            logger.debug(f"[PING] Could not save client ping history: {e}")

    def record_client_ping(self, rtt_ms: Optional[int], is_lost: bool = False, client_loss: Optional[float] = None) -> Tuple[Optional[int], float]:
        now_ts = int(time.time())
        val = None
        if rtt_ms is not None:
            try:
                num = int(rtt_ms)
                if num >= 0 and num < 60000:
                    val = num
            except (ValueError, TypeError):
                val = None

        if is_lost:
            self.history.append((now_ts, None))
        elif val is not None:
            self.current_rtt = val
            self.history.append((now_ts, val))

        if now_ts - self._last_save_time > 180:
            self._last_save_time = now_ts
            self._save_history()

        if client_loss is not None:
            try:
                loss = round(float(client_loss), 1)
            except (ValueError, TypeError):
                loss = self.get_packet_loss()
        else:
            loss = self.get_packet_loss()
        return self.current_rtt, loss

    def get_packet_loss(self, window_sec: int = 180) -> float:
        cutoff = int(time.time()) - window_sec
        recent = [p for p in self.history if p[0] >= cutoff]
        if not recent:
            return 0.0
        lost = sum(1 for p in recent if p[1] is None)
        return round((lost / len(recent)) * 100.0, 1)

    def get_history_list(self, hours: float = 6.0, max_points: int = 2880) -> List[Tuple[int, Optional[int]]]:
        cutoff = int(time.time() - hours * 3600)
        pts = [p for p in self.history if p[0] >= cutoff]
        if len(pts) > max_points:
            step = len(pts) / max_points
            pts = [pts[int(i * step)] for i in range(max_points)]
        return pts

    def get_stats(self) -> dict:
        recent = [p[1] for p in self.history if p[1] is not None]
        return {
            "current_rtt": self.current_rtt,
            "packet_loss": self.get_packet_loss(),
            "min_rtt": min(recent) if recent else None,
            "max_rtt": max(recent) if recent else None,
            "count": len(self.history)
        }

