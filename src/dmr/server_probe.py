# -*- coding: utf-8 -*-
"""
ProxDMR - Unified DMR Server Probe Subsystem (src/dmr/server_probe.py)
Performs UDP handshake probes (RPTL -> RPTACK / MSTNAK) across DMR networks
(BrandMeister, FreeDMR, TGIF, DMR+, XLX) with parallel concurrency, RTT measurement,
ICMP fallback verification, atomic caching, and ranking/sorting.
"""

import asyncio
import errno
import json
import logging
import os
import socket
import struct
import time
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

try:
    from i18n_backend import tr as _tr
except ImportError:
    from src.i18n_backend import tr as _tr

logger = logging.getLogger("proxdmr.server_probe")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
PROBE_CACHE_FILE = DATA_DIR / "server_probe_cache.json"

DEFAULT_PROBE_COUNT = 4
DEFAULT_PROBE_TIMEOUT = 1.2
CACHE_TTL_FRESH = 1800  # 30 minutes for fresh indicator

KNOWN_TGIF_SERVERS: List[Dict[str, Any]] = [
    {
        "id": "TGIF-US",
        "country": "US",
        "country_name": "USA",
        "name": "TGIF Primary",
        "host": "tgif.network",
        "port": 62031,
        "password": "",
    }
]

KNOWN_DMRPLUS_SERVERS: List[Dict[str, Any]] = [
    {"id": "IPSC2-RU", "country": "RU", "country_name": "Russia", "name": "IPSC2-RU", "host": "ipsc2.ru", "port": 62031, "password": "PASSWORD"},
    {"id": "IPSC2-DE", "country": "DE", "country_name": "Germany", "name": "IPSC2-DL", "host": "ipsc2.dmr-dl.net", "port": 62031, "password": "PASSWORD"},
    {"id": "IPSC2-AT", "country": "AT", "country_name": "Austria", "name": "IPSC2-OE", "host": "ipsc2.oevsv.at", "port": 62031, "password": "PASSWORD"},
    {"id": "IPSC2-IT", "country": "IT", "country_name": "Italy", "name": "IPSC2-Italia", "host": "ipsc2-italia.ham-dl.com", "port": 62031, "password": "PASSWORD"},
    {"id": "IPSC2-NL", "country": "NL", "country_name": "Netherlands", "name": "IPSC2-NL", "host": "ipsc2.dutch-dmr.nl", "port": 62031, "password": "PASSWORD"},
    {"id": "IPSC2-US", "country": "US", "country_name": "USA", "name": "IPSC2-QuadNet", "host": "ipsc2.openquad.net", "port": 62031, "password": "PASSWORD"}
]

KNOWN_XLX_SERVERS: List[Dict[str, Any]] = [
    {"id": "XLX270", "country": "LU", "country_name": "Luxembourg", "name": "XLX270 LU", "host": "158.64.26.132", "port": 62030, "password": "passw0rd"},
    {"id": "XLX250", "country": "RU", "country_name": "Russia", "name": "XLX250 US/RU", "host": "23.130.172.11", "port": 62030, "password": "passw0rd"},
    {"id": "XLX777", "country": "RU", "country_name": "Russia", "name": "XLX777 CIS", "host": "194.182.80.219", "port": 62030, "password": "passw0rd"},
    {"id": "XLX002", "country": "DE", "country_name": "Germany", "name": "XLX002 DE", "host": "223.95.197.217", "port": 62030, "password": "passw0rd"},
    {"id": "XLX020", "country": "US", "country_name": "USA", "name": "XLX020 US", "host": "66.175.215.217", "port": 62030, "password": "passw0rd"},
    {"id": "XLX950", "country": "GB", "country_name": "United Kingdom", "name": "XLX950 UK", "host": "158.64.26.134", "port": 62030, "password": "passw0rd"}
]


def _quick_icmp_ping(host: str) -> Optional[int]:
    """Helper to check ICMP reachability if host refuses or drops UDP."""
    try:
        from ping import measure_host_ping_and_loss
        avg, loss = measure_host_ping_and_loss(host, count=2, timeout_per_probe=0.4)
        return avg
    except Exception:
        return None


def probe_hb_server(
    host: str,
    port: int,
    probe_id: int,
    count: int = DEFAULT_PROBE_COUNT,
    timeout: float = DEFAULT_PROBE_TIMEOUT,
    cancel_check: Optional[Callable[[], bool]] = None,
    network_type: str = "bm",
    check_icmp: bool = True
) -> Dict[str, Any]:
    """
    Performs UDP Homebrew handshake probe (RPTL -> RPTACK / MSTNAK).
    Forced IPv4 resolution to prevent IPv6 mismatch.
    Measures RTT, loss %, and classifies server state:
    'online' | 'refused' | 'no_reply' | 'dns_fail' | 'icmp_only'
    """
    now_ts = time.time()
    clean_host = (host or "").strip()
    if not clean_host or port <= 0 or port > 65535:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "icmp_ms": None,
            "detail": _tr("probe.invalid_host_port", fallback="Invalid host or port"),
            "checked_at": now_ts,
        }

    # 1. Force IPv4 address resolution (DNS time excluded from RTT)
    try:
        addr_infos = socket.getaddrinfo(clean_host, port, socket.AF_INET, socket.SOCK_DGRAM)
        if not addr_infos:
            return {
                "host": clean_host,
                "port": port,
                "ip": None,
                "state": "dns_fail",
                "udp_ms": None,
                "min_ms": None,
                "loss_pct": 100.0,
                "sent": 0,
                "recv": 0,
                "icmp_ms": None,
                "detail": _tr("probe.dns_no_reply", fallback="DNS did not respond"),
                "checked_at": now_ts,
            }
        ip = addr_infos[0][4][0]
    except Exception as e:
        logger.debug(f"[PROBE] DNS resolution failed for {clean_host}: {e}")
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "icmp_ms": None,
            "detail": _tr("probe.dns_resolve_error", fallback="Domain name resolution error"),
            "checked_at": now_ts,
        }

    # 2. UDP handshake packet: RPTL + probe_id (4 bytes big-endian)
    req_pkt = b"RPTL" + struct.pack(">I", probe_id)
    sock = None
    rtts: List[float] = []
    sent_count = 0
    refused = False

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)

        for _ in range(max(1, count)):
            if cancel_check and cancel_check():
                break

            sent_count += 1
            t_start = time.perf_counter()
            try:
                sock.sendto(req_pkt, (ip, port))
                resp, _ = sock.recvfrom(1024)
                rtt_ms = (time.perf_counter() - t_start) * 1000.0

                # Valid handshake response must start with RPTACK or MSTNAK
                if resp.startswith(b"RPTACK") or resp.startswith(b"MSTNAK"):
                    rtts.append(rtt_ms)
                else:
                    if len(resp) >= 4 and (resp[:3] == b"RPT" or resp[:3] == b"MST"):
                        rtts.append(rtt_ms)
            except (ConnectionRefusedError, socket.error) as e:
                # ICMP port unreachable
                err_no = getattr(e, "errno", None)
                if isinstance(e, ConnectionRefusedError) or err_no in (errno.ECONNREFUSED, 111):
                    refused = True
                    break
            except socket.timeout:
                pass
            except Exception:
                pass

        # 3. Politely send RPTCL if we got at least one answer
        if rtts:
            try:
                close_pkt = b"RPTCL" + struct.pack(">I", probe_id)
                sock.sendto(close_pkt, (ip, port))
            except Exception:
                pass

    finally:
        if sock:
            try:
                sock.close()
            except Exception:
                pass

    recv_count = len(rtts)
    loss_pct = round(((sent_count - recv_count) / sent_count * 100.0), 1) if sent_count > 0 else 100.0

    icmp_ms = None
    detail = ""
    net_lower = (network_type or "bm").lower()

    if recv_count > 0:
        state = "online"
        udp_ms = round(sum(rtts) / recv_count, 1)
        min_ms = round(min(rtts), 1)
        detail = _tr("probe.udp_available", fallback="UDP available ({ms} ms)", ms=udp_ms)
    else:
        udp_ms = None
        min_ms = None
        if refused:
            state = "refused"
            detail = _tr("probe.port_refused", fallback="Port closed (Connection refused)")
        else:
            state = "no_reply"
            detail = _tr("probe.udp_no_reply", fallback="No reply to UDP requests")

        # Check ICMP to verify if physical host is online
        if check_icmp:
            icmp_ms = _quick_icmp_ping(ip)
            if icmp_ms is not None:
                if net_lower in ("xlx", "dmrplus"):
                    state = "icmp_only"
                    detail = _tr("probe.icmp_only_service_no_reply", fallback="Host alive (ICMP {ms} ms), UDP service did not reply", ms=icmp_ms)
                else:
                    detail = _tr("probe.udp_port_no_reply_icmp", fallback="Server not responding on UDP {port} (ICMP {ms} ms)", port=port, ms=icmp_ms)

    return {
        "host": clean_host,
        "port": port,
        "ip": ip,
        "state": state,
        "udp_ms": udp_ms,
        "min_ms": min_ms,
        "loss_pct": loss_pct,
        "sent": sent_count,
        "recv": recv_count,
        "icmp_ms": icmp_ms,
        "detail": detail,
        "checked_at": now_ts,
    }


def sort_server_probe_results(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Ranks and sorts probe results according to the specification:
    1. 'online' servers sorted by udp_ms ASC, then loss_pct ASC, then host/name
    2. 'icmp_only' servers sorted by icmp_ms ASC
    3. Untested servers
    4. Dead servers ('no_reply', 'refused', 'dns_fail') at the very end
    """
    def _sort_key(it: Dict[str, Any]) -> Tuple[int, float, float, str]:
        st = it.get("state") or ""
        name = str(it.get("name") or it.get("host") or "").lower()

        if st == "online":
            udp = float(it.get("udp_ms") if it.get("udp_ms") is not None else 9999.0)
            loss = float(it.get("loss_pct") or 0.0)
            return (1, udp, loss, name)
        elif st == "icmp_only":
            icmp = float(it.get("icmp_ms") if it.get("icmp_ms") is not None else 9999.0)
            loss = float(it.get("loss_pct") or 0.0)
            return (2, icmp, loss, name)
        elif st in ("no_reply", "refused", "dns_fail", "unreachable"):
            return (4, 9999.0, 100.0, name)
        else:
            # Untested or idle
            return (3, 9999.0, 0.0, name)

    sorted_list = sorted(items, key=_sort_key)
    result = []
    rank_counter = 1

    for it in sorted_list:
        d = dict(it)
        st = d.get("state")
        if st in ("online", "icmp_only"):
            d["rank"] = rank_counter
            rank_counter += 1
        else:
            d["rank"] = None
        result.append(d)

    return result


def probe_ysf_server(
    host: str,
    port: int = 42000,
    count: int = 1,
    timeout: float = DEFAULT_PROBE_TIMEOUT,
    cancel_check: Optional[Callable[[], bool]] = None,
    callsign: str = "N0CALL"
) -> Dict[str, Any]:
    """
    Performs UDP YSFP handshake probe to Yaesu System Fusion reflector (port 42000).
    Measures RTT and packet loss.
    """
    now_ts = time.time()
    clean_host = (host or "").strip()
    if not clean_host or port <= 0 or port > 65535:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.invalid_host_port", fallback="Invalid host or port"),
            "checked_at": now_ts,
        }

    try:
        addr_infos = socket.getaddrinfo(clean_host, port, socket.AF_INET, socket.SOCK_DGRAM)
        if not addr_infos:
            return {
                "host": clean_host,
                "port": port,
                "ip": None,
                "state": "dns_fail",
                "udp_ms": None,
                "min_ms": None,
                "loss_pct": 100.0,
                "sent": 0,
                "recv": 0,
                "detail": _tr("probe.dns_no_reply", fallback="DNS did not respond"),
                "checked_at": now_ts,
            }
        ip = addr_infos[0][4][0]
    except Exception as e:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.dns_error_detail", fallback="DNS error: {error}", error=e),
            "checked_at": now_ts,
        }

    call_padded = f"{callsign:<10.10}".encode("ascii")
    req_pkt = b"YSFP" + call_padded
    rtts: List[float] = []
    sent_count = 0

    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        for _ in range(max(1, count)):
            if cancel_check and cancel_check():
                break
            sent_count += 1
            t_start = time.perf_counter()
            try:
                sock.sendto(req_pkt, (ip, port))
                resp, _ = sock.recvfrom(256)
                rtt_ms = (time.perf_counter() - t_start) * 1000.0
                if resp.startswith(b"YSFP") or resp.startswith(b"YSFI"):
                    rtts.append(rtt_ms)
            except socket.timeout:
                pass
            except Exception:
                break
    finally:
        if sock:
            sock.close()

    recv_count = len(rtts)
    loss_pct = 100.0 if sent_count == 0 else round((1.0 - (recv_count / sent_count)) * 100.0, 1)
    if recv_count > 0:
        avg_rtt = round(sum(rtts) / recv_count, 1)
        min_rtt = round(min(rtts), 1)
        state = "online"
        detail = _tr("probe.ysf_available", fallback="YSF reflector available")
    else:
        avg_rtt = None
        min_rtt = None
        state = "no_reply"
        detail = _tr("probe.ysf_no_reply", fallback="Reflector did not respond to YSFP")

    return {
        "host": clean_host,
        "port": port,
        "ip": ip,
        "state": state,
        "udp_ms": avg_rtt,
        "min_ms": min_rtt,
        "loss_pct": loss_pct,
        "sent": sent_count,
        "recv": recv_count,
        "detail": detail,
        "checked_at": now_ts,
    }


def probe_m17_server(
    host: str,
    port: int = 17000,
    count: int = 3,
    timeout: float = 1.5,
    cancel_check: Optional[Callable[[], bool]] = None,
    callsign: str = "SWL99999",
    module: str = "C",
) -> Dict[str, Any]:
    """
    Performs UDP LSTN -> ACKN/NACK -> DISC probe to an M17 reflector (default port 17000).
    Measures RTT and packet loss.
    """
    from dmr.m17_frame import build_disc_packet, build_lstn_packet

    now_ts = time.time()
    clean_host = (host or "").strip()
    if not clean_host or port <= 0 or port > 65535:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.invalid_host_port", fallback="Invalid host or port"),
            "checked_at": now_ts,
        }

    try:
        addr_infos = socket.getaddrinfo(clean_host, port, socket.AF_INET, socket.SOCK_DGRAM)
        if not addr_infos:
            return {
                "host": clean_host,
                "port": port,
                "ip": None,
                "state": "dns_fail",
                "udp_ms": None,
                "min_ms": None,
                "loss_pct": 100.0,
                "sent": 0,
                "recv": 0,
                "detail": _tr("probe.dns_no_reply", fallback="DNS did not respond"),
                "checked_at": now_ts,
            }
        ip = addr_infos[0][4][0]
    except Exception as e:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.dns_error_detail", fallback="DNS error: {error}", error=e),
            "checked_at": now_ts,
        }

    lstn_pkt = build_lstn_packet(callsign, module)
    disc_pkt = build_disc_packet(callsign)
    rtts: List[float] = []
    sent_count = 0
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        for _ in range(max(1, count)):
            if cancel_check and cancel_check():
                break
            sent_count += 1
            t_start = time.perf_counter()
            try:
                sock.sendto(lstn_pkt, (ip, port))
                resp, _ = sock.recvfrom(256)
                rtt_ms = (time.perf_counter() - t_start) * 1000.0
                if resp.startswith(b"ACKN") or resp.startswith(b"NACK"):
                    rtts.append(rtt_ms)
                    try:
                        sock.sendto(disc_pkt, (ip, port))
                    except Exception:
                        pass
            except socket.timeout:
                pass
            except Exception:
                break
    finally:
        if sock:
            sock.close()

    recv_count = len(rtts)
    loss_pct = 100.0 if sent_count == 0 else round((1.0 - (recv_count / sent_count)) * 100.0, 1)
    if recv_count > 0:
        avg_rtt = round(sum(rtts) / recv_count, 1)
        min_rtt = round(min(rtts), 1)
        state = "online"
        detail = _tr("probe.m17_available", fallback="M17 reflector available")
    else:
        avg_rtt = None
        min_rtt = None
        state = "no_reply"
        detail = _tr("probe.m17_no_reply", fallback="Reflector did not respond to M17 LSTN")

    return {
        "host": clean_host,
        "port": port,
        "ip": ip,
        "state": state,
        "udp_ms": avg_rtt,
        "min_ms": min_rtt,
        "loss_pct": loss_pct,
        "sent": sent_count,
        "recv": recv_count,
        "detail": detail,
        "checked_at": now_ts,
    }


def probe_dstar_server(
    host: str,
    port: int = 30001,
    protocol: str = "auto",
    count: int = 3,
    timeout: float = 1.5,
    cancel_check: Optional[Callable[[], bool]] = None,
    callsign: str = "SWL99999",
    module: str = "D",
) -> Dict[str, Any]:
    """
    Performs UDP connect/ping probe to a D-STAR reflector (DExtra/DCS/DPlus).
    Measures RTT and reachability.
    """
    try:
        from dmr.dstar_frame import (
            build_dextra_connect,
            build_dextra_disconnect,
            build_dcs_connect,
            build_dcs_disconnect,
            DPLUS_INIT_STEP1,
            DPLUS_DISCONNECT,
        )
    except ImportError:
        from src.dmr.dstar_frame import (
            build_dextra_connect,
            build_dextra_disconnect,
            build_dcs_connect,
            build_dcs_disconnect,
            DPLUS_INIT_STEP1,
            DPLUS_DISCONNECT,
        )

    now_ts = time.time()
    clean_host = (host or "").strip()
    if not clean_host or port <= 0 or port > 65535:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.invalid_host_port", fallback="Invalid host or port"),
            "checked_at": now_ts,
        }

    try:
        addr_infos = socket.getaddrinfo(clean_host, port, socket.AF_INET, socket.SOCK_DGRAM)
        if not addr_infos:
            return {
                "host": clean_host,
                "port": port,
                "ip": None,
                "state": "dns_fail",
                "udp_ms": None,
                "min_ms": None,
                "loss_pct": 100.0,
                "sent": 0,
                "recv": 0,
                "detail": _tr("probe.dns_no_reply", fallback="DNS did not respond"),
                "checked_at": now_ts,
            }
        ip = addr_infos[0][4][0]
    except Exception as e:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.dns_error_detail", fallback="DNS error: {error}", error=e),
            "checked_at": now_ts,
        }

    proto = (protocol or "auto").lower()
    if proto not in ("dextra", "dcs", "dplus"):
        if port == 30051:
            proto = "dcs"
        elif port == 20001:
            proto = "dplus"
        else:
            proto = "dextra"

    if proto == "dcs":
        conn_pkt = build_dcs_connect(callsign, "D", "DCS001", module)
        disc_pkt = build_dcs_disconnect(callsign, "D", "DCS001")
    elif proto == "dplus":
        conn_pkt = DPLUS_INIT_STEP1
        disc_pkt = DPLUS_DISCONNECT
    else:
        conn_pkt = build_dextra_connect(callsign, "D", module)
        disc_pkt = build_dextra_disconnect(callsign, "D")

    rtts: List[float] = []
    sent_count = 0
    sock = None
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(timeout)
        for _ in range(max(1, count)):
            if cancel_check and cancel_check():
                break
            sent_count += 1
            t_start = time.perf_counter()
            try:
                sock.sendto(conn_pkt, (ip, port))
                resp, _ = sock.recvfrom(256)
                rtt_ms = (time.perf_counter() - t_start) * 1000.0
                if resp:
                    rtts.append(rtt_ms)
                    try:
                        sock.sendto(disc_pkt, (ip, port))
                    except Exception:
                        pass
            except socket.timeout:
                pass
            except Exception:
                break
    finally:
        if sock:
            sock.close()

    recv_count = len(rtts)
    loss_pct = 100.0 if sent_count == 0 else round((1.0 - (recv_count / sent_count)) * 100.0, 1)
    if recv_count > 0:
        avg_rtt = round(sum(rtts) / recv_count, 1)
        min_rtt = round(min(rtts), 1)
        state = "online"
        detail = f"D-STAR ({proto.upper()}) reflector online"
    else:
        avg_rtt = None
        min_rtt = None
        state = "no_reply"
        detail = f"Reflector did not respond to D-STAR ({proto.upper()}) probe"

    return {
        "host": clean_host,
        "port": port,
        "ip": ip,
        "state": state,
        "udp_ms": avg_rtt,
        "min_ms": min_rtt,
        "loss_pct": loss_pct,
        "sent": sent_count,
        "recv": recv_count,
        "detail": detail,
        "checked_at": now_ts,
    }


def probe_svx_server(
    host: str,
    port: int = 5300,
    timeout: float = 1.5,
    cancel_check: Optional[Callable[[], bool]] = None,
) -> Dict[str, Any]:
    """
    Performs TCP connect probe to an SVXReflector instance.
    Measures TCP handshake latency.
    """
    now_ts = time.time()
    clean_host = (host or "").strip()
    if not clean_host or port <= 0 or port > 65535:
        return {
            "host": clean_host,
            "port": port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.invalid_host_port", fallback="Invalid host or port"),
            "checked_at": now_ts,
        }

    target_host = clean_host
    target_port = port
    try:
        from dmr.svx_client import resolve_svx_srv_sync
        srv_targets = resolve_svx_srv_sync(clean_host, timeout=1.0)
        if srv_targets:
            target_host, target_port = srv_targets[0]
    except Exception:
        pass

    try:
        addr_infos = socket.getaddrinfo(target_host, target_port, socket.AF_INET, socket.SOCK_STREAM)
        if not addr_infos:
            return {
                "host": clean_host,
                "port": target_port,
                "ip": None,
                "state": "dns_fail",
                "udp_ms": None,
                "min_ms": None,
                "loss_pct": 100.0,
                "sent": 0,
                "recv": 0,
                "detail": _tr("probe.dns_no_reply", fallback="DNS did not respond"),
                "checked_at": now_ts,
            }
        ip = addr_infos[0][4][0]
    except Exception as e:
        return {
            "host": clean_host,
            "port": target_port,
            "ip": None,
            "state": "dns_fail",
            "udp_ms": None,
            "min_ms": None,
            "loss_pct": 100.0,
            "sent": 0,
            "recv": 0,
            "detail": _tr("probe.dns_error_detail", fallback="DNS error: {error}", error=e),
            "checked_at": now_ts,
        }

    sock = None
    rtt_ms = None
    state = "no_reply"
    detail = "TCP connection timed out"

    t_start = time.perf_counter()
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect((ip, target_port))
        rtt_ms = round((time.perf_counter() - t_start) * 1000.0, 1)
        state = "online"
        detail = f"SVXReflector TCP:{target_port} reachable ({rtt_ms} ms)"
    except socket.timeout:
        state = "no_reply"
        detail = "SVXReflector connection timed out"
    except ConnectionRefusedError:
        state = "refused"
        detail = "Connection refused by SVX server"
    except Exception as e:
        state = "error"
        detail = f"TCP error: {e}"
    finally:
        if sock:
            sock.close()

    return {
        "host": clean_host,
        "port": target_port,
        "ip": ip,
        "state": state,
        "udp_ms": rtt_ms,
        "min_ms": rtt_ms,
        "loss_pct": 0.0 if state == "online" else 100.0,
        "sent": 1,
        "recv": 1 if state == "online" else 0,
        "detail": detail,
        "checked_at": now_ts,
    }


class ServerProbeService:
    """
    Manages DMR server UDP probes, concurrent testing, background tasks,
    atomic persistence in data/server_probe_cache.json, and result querying.
    """

    def __init__(self):
        self._cache: Dict[str, Any] = {}
        self._active_task: Optional[asyncio.Task] = None
        self._active_net: Optional[str] = None
        self._cancel_event = asyncio.Event()
        self._lock = asyncio.Lock()
        self._load_cache()

    def _load_cache(self):
        if not PROBE_CACHE_FILE.exists():
            return
        try:
            with open(PROBE_CACHE_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
            if isinstance(data, dict):
                self._cache = data
                logger.info(f"[SERVER_PROBE] Loaded probe cache for {len(data)} networks")
        except Exception as e:
            logger.warning(f"[SERVER_PROBE] Failed to read cache {PROBE_CACHE_FILE}: {e}")

    def _save_cache(self):
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            tmp_path = PROBE_CACHE_FILE.with_suffix(".tmp")
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(self._cache, f, ensure_ascii=False, indent=2)
            tmp_path.replace(PROBE_CACHE_FILE)
            logger.debug("[SERVER_PROBE] Probe cache successfully persisted to disk")
        except Exception as e:
            logger.error(f"[SERVER_PROBE] Failed to save probe cache: {e}")

    def is_probe_running(self, network_type: Optional[str] = None) -> bool:
        if not self._active_task or self._active_task.done():
            return False
        if network_type:
            return (self._active_net or "").lower() == network_type.lower()
        return True

    def get_probe_results(self, network_type: str) -> Dict[str, Any]:
        """Returns sorted results and metadata for network."""
        net_key = (network_type or "bm").strip().lower()
        cached = self._cache.get(net_key, {})
        running = self.is_probe_running(net_key)
        return {
            "status": "ok",
            "network_type": net_key,
            "running": running,
            "checked_at": cached.get("checked_at", 0),
            "results": cached.get("results", []),
            "results_map": cached.get("results_map", {}),
        }

    def cancel_probe(self, network_type: Optional[str] = None):
        if self.is_probe_running(network_type):
            self._cancel_event.set()
            logger.info(f"[SERVER_PROBE] Cancellation requested for {self._active_net or 'all'}")

    async def start_probe(
        self,
        network_type: str,
        servers: List[Dict[str, Any]],
        probe_id: int = 123456799,
        broadcast_cb: Optional[Callable[[Dict[str, Any]], Any]] = None,
        concurrency: int = 10
    ) -> bool:
        """
        Starts parallel probing for server list.
        Only one probe task is permitted at a time.
        """
        async with self._lock:
            if self.is_probe_running():
                logger.warning(f"[SERVER_PROBE] Probe already running for {self._active_net}, reject start")
                return False

            net_key = (network_type or "bm").strip().lower()
            self._active_net = net_key
            self._cancel_event.clear()
            self._active_task = asyncio.create_task(
                self._run_probe_task(net_key, servers, probe_id, broadcast_cb, concurrency)
            )
            return True

    async def _run_probe_task(
        self,
        network_type: str,
        servers: List[Dict[str, Any]],
        probe_id: int,
        broadcast_cb: Optional[Callable[[Dict[str, Any]], Any]],
        concurrency: int = 10
    ):
        servers = list((servers or [])[:50])
        total = len(servers)
        logger.info(f"[SERVER_PROBE] Starting probe for {total} servers on network '{network_type}'...")
        sem = asyncio.Semaphore(max(1, min(20, concurrency)))
        tested_results: List[Dict[str, Any]] = []
        completed_count = 0

        async def _probe_one(srv: Dict[str, Any], idx: int):
            nonlocal completed_count
            if self._cancel_event.is_set():
                return

            host = srv.get("host") or ""
            default_net_port = (
                17000 if network_type == "m17"
                else (42000 if network_type == "ysf"
                      else (5300 if network_type == "svx"
                            else (30001 if network_type == "dstar" else 62031)))
            )
            port = int(srv.get("port") or default_net_port)

            async with sem:
                if self._cancel_event.is_set():
                    return
                # Run protocol-specific probe in thread
                if network_type == "m17":
                    probe_res = await asyncio.to_thread(
                        probe_m17_server,
                        host,
                        port,
                        DEFAULT_PROBE_COUNT,
                        DEFAULT_PROBE_TIMEOUT,
                        self._cancel_event.is_set
                    )
                elif network_type == "ysf":
                    probe_res = await asyncio.to_thread(
                        probe_ysf_server,
                        host,
                        port,
                        DEFAULT_PROBE_COUNT,
                        DEFAULT_PROBE_TIMEOUT,
                        self._cancel_event.is_set
                    )
                elif network_type == "svx":
                    probe_res = await asyncio.to_thread(
                        probe_svx_server,
                        host,
                        port,
                        DEFAULT_PROBE_TIMEOUT,
                        self._cancel_event.is_set
                    )
                elif network_type == "dstar":
                    dstar_proto = str(srv.get("protocol") or "auto")
                    probe_res = await asyncio.to_thread(
                        probe_dstar_server,
                        host,
                        port,
                        dstar_proto,
                        2,
                        DEFAULT_PROBE_TIMEOUT,
                        self._cancel_event.is_set
                    )
                else:
                    probe_res = await asyncio.to_thread(
                        probe_hb_server,
                        host,
                        port,
                        probe_id,
                        DEFAULT_PROBE_COUNT,
                        DEFAULT_PROBE_TIMEOUT,
                        self._cancel_event.is_set,
                        network_type
                    )

            # Merge server metadata with probe stats
            merged = {**srv, **probe_res}
            tested_results.append(merged)
            completed_count += 1

            # Dispatch progress broadcast
            if broadcast_cb and not self._cancel_event.is_set():
                pct = round((completed_count / total) * 100) if total > 0 else 0
                sorted_so_far = sort_server_probe_results(tested_results)
                msg = {
                    "type": "server_probe_progress",
                    "network_type": network_type,
                    "current_index": completed_count,
                    "total_servers": total,
                    "percent": pct,
                    "current_server": merged,
                    "results_so_far": sorted_so_far,
                }
                try:
                    res = broadcast_cb(msg)
                    if asyncio.iscoroutine(res):
                        await res
                except Exception as e:
                    logger.debug(f"[SERVER_PROBE] Progress broadcast error: {e}")

        # Launch all server probes bounded by semaphore
        tasks = [asyncio.create_task(_probe_one(srv, i)) for i, srv in enumerate(servers[:50])]
        await asyncio.gather(*tasks, return_exceptions=True)

        is_cancelled = self._cancel_event.is_set()
        sorted_final = sort_server_probe_results(tested_results)

        # Build quick key lookup: 'host:port' and 'host'
        results_map: Dict[str, Dict[str, Any]] = {}
        for r in sorted_final:
            h = (r.get("host") or "").lower()
            default_map_port = (
                17000 if network_type == "m17"
                else (42000 if network_type == "ysf"
                      else (5300 if network_type == "svx"
                            else (30001 if network_type == "dstar" else 62031)))
            )
            p = r.get("port") or default_map_port
            results_map[f"{h}:{p}"] = r
            results_map[h] = r

        # Save to memory and disk cache immediately
        now_ts = int(time.time())
        self._cache[network_type] = {
            "checked_at": now_ts,
            "results": sorted_final,
            "results_map": results_map,
        }
        self._save_cache()

        # Sync BM probe table back to bm_ping_service benchmark table
        if network_type == "bm" and sorted_final:
            try:
                import main as _main_mod
                if hasattr(_main_mod, "bm_ping_service") and _main_mod.bm_ping_service:
                    synced_bm = []
                    for item in sorted_final:
                        d_item = dict(item)
                        if d_item.get("avg_ping") is None and d_item.get("udp_ms") is not None:
                            d_item["avg_ping"] = int(round(float(d_item["udp_ms"])))
                        d_item["udp_ok"] = (d_item.get("state") == "online")
                        d_item["status"] = "ok" if d_item.get("state") in ("online", "icmp_only") else "unreachable"
                        synced_bm.append(d_item)
                    _main_mod.bm_ping_service.cached_benchmark_results = synced_bm
                    _main_mod.bm_ping_service._save_benchmark_results()
            except Exception as e:
                logger.debug(f"[SERVER_PROBE] Could not sync BM probe results to bm_ping_service: {e}")

        logger.info(
            f"[SERVER_PROBE] Probe for '{network_type}' completed "
            f"({len(tested_results)}/{total} tested, cancelled={is_cancelled})"
        )

        # Broadcast completion
        if broadcast_cb:
            msg = {
                "type": "server_probe_complete",
                "network_type": network_type,
                "cancelled": is_cancelled,
                "total_servers": total,
                "tested_count": len(tested_results),
                "results": sorted_final,
            }
            try:
                res = broadcast_cb(msg)
                if asyncio.iscoroutine(res):
                    await res
            except Exception as e:
                logger.debug(f"[SERVER_PROBE] Complete broadcast error: {e}")

    def enrich_servers_with_cache(
        self,
        network_type: str,
        base_servers: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Enriches a list of servers with latest probe cache data,
        then returns them sorted according to the ranking algorithm.
        """
        net_key = (network_type or "bm").strip().lower()
        cached = self._cache.get(net_key, {})
        cached_map = cached.get("results_map", {})
        enriched: List[Dict[str, Any]] = []
        default_net_port = (
            17000 if net_key == "m17"
            else (42000 if net_key == "ysf"
                  else (5300 if net_key == "svx"
                        else (30001 if net_key == "dstar" else 62031)))
        )

        for srv in base_servers:
            h = (srv.get("host") or "").lower()
            p = srv.get("port") or default_net_port
            key = f"{h}:{p}"
            probe_data = cached_map.get(key) or cached_map.get(h)
            if probe_data:
                # Merge probe fields (state, udp_ms, min_ms, loss_pct, etc.)
                merged = {**srv, **{k: v for k, v in probe_data.items() if k in (
                    "state", "udp_ms", "min_ms", "loss_pct", "icmp_ms", "checked_at", "ip", "detail"
                )}}
            else:
                merged = {**srv, "state": None, "udp_ms": None, "loss_pct": None, "checked_at": 0}
            enriched.append(merged)

        return sort_server_probe_results(enriched)


# Global singleton instance
server_probe_service = ServerProbeService()
