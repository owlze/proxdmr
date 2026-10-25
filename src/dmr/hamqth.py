"""
HAM Web Portals XML API Service for ProxDMR
Supports official XML APIs:
1. QRZ.com (Official XML API: xmldata.qrz.com)
2. HamQTH.com (Official XML API: hamqth.com/xml.php)
Provides authentication session management, parallel lookups, priority merging, and caching.
"""

import asyncio
import logging
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger("proxdmr.hamqth")

QRZ_COM_XML_URL = "https://xmldata.qrz.com/xml/current/"
HAMQTH_XML_URL = "https://www.hamqth.com/xml.php"

USER_AGENT = "ProxDMR/1.50 (+https://github.com/)"


def _strip_ns(tag: str) -> str:
    """Removes XML namespace prefix if present."""
    return tag.split("}", 1)[-1] if "}" in tag else tag


def _clean_call(callsign: str) -> str:
    """Cleans callsign, removing SSID/suffixes like -9 if numeric."""
    call_upper = callsign.strip().upper()
    if "-" in call_upper:
        parts = call_upper.split("-")
        if len(parts) == 2 and parts[1].isdigit():
            call_upper = parts[0].strip()
    return call_upper


class HamQTHService:
    def __init__(self):
        # Session caches: username -> (session_id, timestamp)
        self._session_cache: Dict[str, Tuple[str, float]] = {}         # HamQTH
        self._qrz_com_session_cache: Dict[str, Tuple[str, float]] = {}  # QRZ.com

        # Lookup caches: callsign_upper -> (result_dict, timestamp)
        self._lookup_cache: Dict[str, Tuple[Dict[str, Any], float]] = {}

        # TTLs
        self.SESSION_TTL = 3000.0  # 50 minutes (server session is ~1 hour)
        self.LOOKUP_SUCCESS_TTL = 7200.0  # 2 hours for successful lookups
        self.LOOKUP_NOT_FOUND_TTL = 900.0  # 15 minutes for not-found lookups

    def _http_get(self, url: str, timeout: float = 8.0) -> str:
        """Synchronous HTTP GET with custom User-Agent and timeout."""
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": USER_AGENT,
                "Accept": "application/xml, text/xml, */*"
            }
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            return raw.decode("utf-8", errors="replace")

    def _parse_xml(self, xml_text: str) -> ET.Element:
        """Parses XML string into ElementTree Root."""
        return ET.fromstring(xml_text.strip())

    # ──────────────────────────────────────────────────────────────────────────
    # 1. QRZ.com Implementation
    # ──────────────────────────────────────────────────────────────────────────

    def _sync_get_qrz_com_session(self, username: str, password: str, force_refresh: bool = False) -> str:
        u_clean = username.strip()
        p_clean = password.strip()
        if not u_clean or not p_clean:
            raise ValueError("Логин и пароль QRZ.com обязательны")

        now = time.time()
        if not force_refresh and u_clean in self._qrz_com_session_cache:
            key, ts = self._qrz_com_session_cache[u_clean]
            if now - ts < self.SESSION_TTL:
                return key

        params = urllib.parse.urlencode({"username": u_clean, "password": p_clean, "agent": "ProxDMR"})
        url = f"{QRZ_COM_XML_URL}?{params}"
        xml_resp = self._http_get(url)
        root = self._parse_xml(xml_resp)

        key = None
        err_msg = None
        for elem in root.iter():
            tag = _strip_ns(elem.tag).lower()
            text = (elem.text or "").strip()
            if tag == "key" and text:
                key = text
            elif tag == "error" and text:
                err_msg = text

        if err_msg:
            raise ValueError(f"QRZ.com: {err_msg}")
        if not key:
            raise ValueError("Не получен сессионный ключ от QRZ.com")

        self._qrz_com_session_cache[u_clean] = (key, now)
        logger.info(f"[QRZ.com] Successfully authenticated user '{u_clean}' (key: {key[:8]}...)")
        return key

    def _sync_lookup_qrz_com(self, callsign: str, username: str, password: str) -> Dict[str, Any]:
        call_upper = _clean_call(callsign)
        if not call_upper:
            return {"status": "error", "message": "Позывной не указан"}

        u_clean = username.strip()
        p_clean = password.strip()
        if not u_clean or not p_clean:
            return {"status": "error", "message": "Учетные данные QRZ.com не настроены"}

        try:
            session_key = self._sync_get_qrz_com_session(u_clean, p_clean)
        except Exception as e:
            return {"status": "error", "message": f"Ошибка авторизации QRZ.com: {e}"}

        url = f"{QRZ_COM_XML_URL}?s={urllib.parse.quote(session_key)};callsign={urllib.parse.quote(call_upper)}"
        try:
            xml_resp = self._http_get(url)
            root = self._parse_xml(xml_resp)
        except Exception as e:
            return {"status": "error", "message": f"Ошибка запроса к QRZ.com: {e}"}

        # Check for session error / retry
        err_text = None
        for elem in root.iter():
            if _strip_ns(elem.tag).lower() == "error" and elem.text and elem.text.strip():
                err_text = elem.text.strip()
                break

        if err_text:
            err_lower = err_text.lower()
            if "session" in err_lower or "timeout" in err_lower or "invalid" in err_lower:
                # Retry once with refreshed session
                try:
                    session_key = self._sync_get_qrz_com_session(u_clean, p_clean, force_refresh=True)
                    url = f"{QRZ_COM_XML_URL}?s={urllib.parse.quote(session_key)};callsign={urllib.parse.quote(call_upper)}"
                    xml_resp = self._http_get(url)
                    root = self._parse_xml(xml_resp)
                    err_text = None
                    for elem in root.iter():
                        if _strip_ns(elem.tag).lower() == "error" and elem.text and elem.text.strip():
                            err_text = elem.text.strip()
                            break
                except Exception as e:
                    return {"status": "error", "message": f"Повторная ошибка авторизации QRZ.com: {e}"}

            if err_text:
                if "not found" in err_text.lower():
                    return {"status": "not_found", "found": False, "source": "QRZ.com", "callsign": call_upper}
                return {"status": "error", "message": f"QRZ.com: {err_text}"}

        # Parse <Callsign> block
        data: Dict[str, str] = {}
        for elem in root.iter():
            t = _strip_ns(elem.tag)
            if elem.text and elem.text.strip():
                data[t] = elem.text.strip()

        call = data.get("call", call_upper)
        fname = data.get("fname", "")
        name = data.get("name", "")
        attn = data.get("attn", "")
        full_name = f"{fname} {name}".strip()
        adr_name = attn or full_name

        mqsl = data.get("mqsl", "")
        lotw_raw = data.get("lotw", "")
        eqsl_raw = data.get("eqsl", "")

        record = {
            "callsign": call,
            "nick": fname or name,
            "name": full_name,
            "adr_name": adr_name,
            "city": data.get("addr2", "") or data.get("city", ""),
            "adr_city": data.get("addr2", "") or data.get("city", ""),
            "us_state": data.get("state", ""),
            "us_county": data.get("county", ""),
            "country": data.get("country", ""),
            "adif": data.get("ccode", "") or data.get("dxcc", ""),
            "grid": data.get("grid", ""),
            "latitude": data.get("lat", ""),
            "longitude": data.get("lon", ""),
            "itu": data.get("ituzone", ""),
            "cq": data.get("cqzone", ""),
            "continent": "",
            "utc_offset": data.get("GMTOffset", ""),
            "qsl": "Y" if mqsl == "1" else "",
            "qsldirect": "",
            "qsl_via": data.get("qslmgr", ""),
            "lotw": "Y" if lotw_raw == "1" else ("N" if lotw_raw == "0" else ""),
            "eqsl": "Y" if eqsl_raw == "1" else ("N" if eqsl_raw == "0" else ""),
            "mail": data.get("email", ""),
            "email": data.get("email", ""),
            "web": "",
            "picture": data.get("image", ""),
            "qslpic": data.get("image", ""),
            "bio": data.get("bio", ""),
            "lookups": data.get("u_views", ""),
            "birth_year": data.get("born", ""),
            "iota": data.get("iota", "")
        }

        return {
            "status": "ok",
            "found": True,
            "source": "QRZ.com",
            "callsign": call_upper,
            "data": record
        }

    # ──────────────────────────────────────────────────────────────────────────
    # 2. HamQTH.com Implementation
    # ──────────────────────────────────────────────────────────────────────────

    def _sync_get_session(self, username: str, password: str, force_refresh: bool = False) -> str:
        """Authenticate with HamQTH and obtain a session ID."""
        u_clean = username.strip()
        p_clean = password.strip()
        if not u_clean or not p_clean:
            raise ValueError("Логин и пароль HamQTH обязательны")

        now = time.time()
        if not force_refresh and u_clean in self._session_cache:
            sess_id, ts = self._session_cache[u_clean]
            if now - ts < self.SESSION_TTL:
                return sess_id

        params = urllib.parse.urlencode({"u": u_clean, "p": p_clean})
        url = f"{HAMQTH_XML_URL}?{params}"
        xml_resp = self._http_get(url)
        root = self._parse_xml(xml_resp)

        for elem in root.iter():
            if _strip_ns(elem.tag) == "error" and elem.text and elem.text.strip():
                err_msg = elem.text.strip()
                raise ValueError(f"HamQTH: {err_msg}")

        session_id = None
        for elem in root.iter():
            if _strip_ns(elem.tag) == "session_id" and elem.text and elem.text.strip():
                session_id = elem.text.strip()
                break

        if not session_id:
            raise ValueError("Не получен session_id от HamQTH")

        self._session_cache[u_clean] = (session_id, now)
        logger.info(f"[HamQTH] Successfully authenticated user '{u_clean}' (session: {session_id[:8]}...)")
        return session_id

    def _sync_lookup_hamqth(self, callsign: str, username: str = "", password: str = "", session_key: str = "") -> Dict[str, Any]:
        call_upper = _clean_call(callsign)
        if not call_upper:
            return {"status": "error", "message": "Позывной не указан"}

        u_clean = username.strip()
        p_clean = password.strip()
        k_clean = session_key.strip()

        session_id = None
        if u_clean and p_clean:
            try:
                session_id = self._sync_get_session(u_clean, p_clean)
            except Exception as e:
                return {"status": "error", "message": f"Ошибка авторизации HamQTH: {e}"}
        elif k_clean:
            session_id = k_clean
        else:
            return {"status": "error", "message": "Учетные данные HamQTH не настроены"}

        params = urllib.parse.urlencode({
            "id": session_id,
            "call": call_upper,
            "prg": "ProxDMR"
        })
        url = f"{HAMQTH_XML_URL}?{params}"

        try:
            xml_resp = self._http_get(url)
            root = self._parse_xml(xml_resp)
        except Exception as e:
            return {"status": "error", "message": f"Ошибка запроса к HamQTH: {e}"}

        # Check session expiry / retry
        err = None
        for elem in root.iter():
            if _strip_ns(elem.tag) == "error" and elem.text and elem.text.strip():
                err = elem.text.strip()
                break

        if err and ("session" in err.lower() or "expired" in err.lower()) and u_clean and p_clean:
            try:
                session_id = self._sync_get_session(u_clean, p_clean, force_refresh=True)
                params = urllib.parse.urlencode({
                    "id": session_id,
                    "call": call_upper,
                    "prg": "ProxDMR"
                })
                url = f"{HAMQTH_XML_URL}?{params}"
                xml_resp = self._http_get(url)
                root = self._parse_xml(xml_resp)
                err = None
                for elem in root.iter():
                    if _strip_ns(elem.tag) == "error" and elem.text and elem.text.strip():
                        err = elem.text.strip()
                        break
            except Exception as e:
                return {"status": "error", "message": f"Повторная ошибка авторизации HamQTH: {e}"}

        if err:
            err_lower = err.lower()
            if "not found" in err_lower or "callsign" in err_lower:
                return {"status": "not_found", "found": False, "source": "HamQTH.com", "callsign": call_upper}
            return {"status": "error", "message": f"HamQTH: {err}"}

        data: Dict[str, str] = {}
        for elem in root.iter():
            tag = _strip_ns(elem.tag)
            if elem.text and elem.text.strip():
                data[tag] = elem.text.strip()

        if not data or not data.get("callsign"):
            return {"status": "not_found", "found": False, "source": "HamQTH.com", "callsign": call_upper}

        record = {
            "callsign": data.get("callsign", call_upper),
            "nick": data.get("nick", ""),
            "name": data.get("name", ""),
            "adr_name": data.get("adr_name", ""),
            "city": data.get("adr_city", ""),
            "adr_city": data.get("adr_city", ""),
            "oblast": data.get("oblast", ""),
            "district": data.get("district", ""),
            "us_state": data.get("us_state", ""),
            "us_county": data.get("us_county", ""),
            "dok": data.get("dok", ""),
            "country": data.get("adr_country", ""),
            "adif": data.get("adr_adif", ""),
            "grid": data.get("grid", ""),
            "latitude": data.get("latitude", ""),
            "longitude": data.get("longitude", ""),
            "itu": data.get("itu", ""),
            "cq": data.get("cq", ""),
            "continent": data.get("continent", ""),
            "utc_offset": data.get("utc_offset", ""),
            "qsl": data.get("qsl", ""),
            "qsldirect": data.get("qsldirect", ""),
            "qsl_via": data.get("qsl_via", ""),
            "lotw": data.get("lotw", ""),
            "eqsl": data.get("eqsl", ""),
            "mail": data.get("mail", "") or data.get("email", ""),
            "email": data.get("email", "") or data.get("mail", ""),
            "web": data.get("web", ""),
            "picture": data.get("picture", "") or data.get("qslpic", ""),
            "qslpic": data.get("qslpic", "") or data.get("picture", ""),
            "bio": data.get("bio", "") or data.get("about", ""),
            "lookups": data.get("lookups", ""),
            "lic_year": data.get("lic_year", ""),
            "birth_year": data.get("birth_year", ""),
            "iota": data.get("iota", "")
        }

        return {
            "status": "ok",
            "found": True,
            "source": "HamQTH.com",
            "callsign": call_upper,
            "data": record
        }

    async def test_connection(self, username: str, password: str, session_key: str = "", portal: str = "hamqth") -> Dict[str, Any]:
        """Test credentials against a specific portal XML API."""
        p_name = (portal or "hamqth").strip().lower()
        u_clean = username.strip()
        p_clean = password.strip()
        k_clean = session_key.strip()

        if not u_clean and not p_clean and not k_clean:
            portal_label = "QRZ.com" if p_name == "qrz_com" else "HamQTH.com"
            return {
                "status": "error",
                "message": f"Укажите логин и пароль {portal_label}"
            }

        try:
            if p_name == "qrz_com":
                sess_id = await asyncio.to_thread(self._sync_get_qrz_com_session, u_clean, p_clean, True)
                return {
                    "status": "ok",
                    "message": "Успешная авторизация на QRZ.com",
                    "session_id": f"{sess_id[:8]}..."
                }
            else:  # hamqth
                if u_clean and p_clean:
                    sess_id = await asyncio.to_thread(self._sync_get_session, u_clean, p_clean, True)
                    return {
                        "status": "ok",
                        "message": "Успешная авторизация на HamQTH.com",
                        "session_id": f"{sess_id[:8]}..."
                    }
                elif k_clean:
                    res = await asyncio.to_thread(self._sync_lookup_hamqth, "W1AW", session_key=k_clean)
                    if res.get("status") in ("ok", "not_found"):
                        return {"status": "ok", "message": "Сессионный ключ HamQTH действителен"}
                    return {"status": "error", "message": res.get("message", "Сессионный ключ недействителен")}
                else:
                    return {"status": "error", "message": "Для авторизации требуются и логин, и пароль"}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    # ──────────────────────────────────────────────────────────────────────────
    # 5. Multi-Portal Parallel Lookup & Priority Merge
    # ──────────────────────────────────────────────────────────────────────────

    async def lookup_callsign_multi(self, callsign: str, creds: Dict[str, Tuple[str, str]]) -> Dict[str, Any]:
        """
        Queries all configured portals in parallel via asyncio.gather and merges fields
        by strict priority: 1. QRZ.com -> 2. HamQTH.com
        """
        call_upper = _clean_call(callsign)
        if not call_upper:
            return {"status": "error", "message": "Позывной не указан"}

        now = time.time()
        # Check cached combined lookup
        if call_upper in self._lookup_cache:
            res, ts = self._lookup_cache[call_upper]
            ttl = self.LOOKUP_SUCCESS_TTL if res.get("found") else self.LOOKUP_NOT_FOUND_TTL
            if now - ts < ttl:
                return res

        # Filter active credentials
        tasks = []
        portal_order: List[str] = []

        qrz_com_u, qrz_com_p = creds.get("qrz_com", ("", ""))
        if qrz_com_u.strip() and qrz_com_p.strip():
            portal_order.append("QRZ.com")
            tasks.append(asyncio.to_thread(self._sync_lookup_qrz_com, call_upper, qrz_com_u, qrz_com_p))

        hamqth_u, hamqth_p = creds.get("hamqth", ("", ""))
        if hamqth_u.strip() and hamqth_p.strip():
            portal_order.append("HamQTH.com")
            tasks.append(asyncio.to_thread(self._sync_lookup_hamqth, call_upper, hamqth_u, hamqth_p))
        if not tasks:
            return {
                "status": "no_credentials",
                "message": "Учетные данные HAM веб-порталов (QRZ.com, HamQTH.com) не настроены в Общих настройках"
            }

        raw_results = await asyncio.gather(*tasks, return_exceptions=True)

        results_by_portal: Dict[str, Dict[str, Any]] = {}
        errors: List[str] = []

        for p_name, r in zip(portal_order, raw_results):
            if isinstance(r, Exception):
                errors.append(f"{p_name}: {r}")
            elif isinstance(r, dict):
                results_by_portal[p_name] = r
                if r.get("status") == "error":
                    errors.append(f"{p_name}: {r.get('message', 'Ошибка')}")

        # Check if found in any portal
        sources_found = [p for p in ("QRZ.com", "HamQTH.com") if results_by_portal.get(p, {}).get("found")]

        if not sources_found:
            all_not_found = all(
                results_by_portal.get(p, {}).get("status") == "not_found"
                for p in portal_order
                if p in results_by_portal
            )
            if all_not_found or not errors:
                res = {
                    "status": "not_found",
                    "found": False,
                    "callsign": call_upper,
                    "message": f"Позывной {call_upper} не найден на порталах ({', '.join(portal_order)})"
                }
                self._lookup_cache[call_upper] = (res, now)
                return res

            return {
                "status": "error",
                "message": "; ".join(errors) or f"Не удалось получить информацию о позывном {call_upper}"
            }

        # Priority merge: 1. QRZ.com -> 2. HamQTH.com
        all_fields = [
            "callsign", "nick", "name", "adr_name", "city", "adr_city", "oblast",
            "district", "us_state", "us_county", "dok", "country", "adif", "grid",
            "latitude", "longitude", "itu", "cq", "continent", "utc_offset",
            "qsl", "qsldirect", "qsl_via", "lotw", "eqsl", "mail", "email",
            "web", "picture", "qslpic", "bio", "lookups", "lic_year", "birth_year", "iota"
        ]

        merged: Dict[str, Any] = {}
        for fld in all_fields:
            val = ""
            for p in ("QRZ.com", "HamQTH.com"):
                p_data = results_by_portal.get(p, {}).get("data", {})
                v = p_data.get(fld)
                if v is not None and str(v).strip():
                    val = v
                    break
            merged[fld] = val
        merged["sources_found"] = sources_found
        merged["sources_queried"] = portal_order

        res = {
            "status": "ok",
            "found": True,
            "callsign": call_upper,
            "data": merged,
            "sources_found": sources_found
        }
        self._lookup_cache[call_upper] = (res, now)
        return res

    # ──────────────────────────────────────────────────────────────────────────
    # 6. Backward Compatibility Wrappers
    # ──────────────────────────────────────────────────────────────────────────

    async def get_session(self, username: str, password: str, force_refresh: bool = False) -> str:
        return await asyncio.to_thread(self._sync_get_session, username, password, force_refresh)

    async def lookup_callsign(self, callsign: str, username: str = "", password: str = "", session_key: str = "") -> Dict[str, Any]:
        return await asyncio.to_thread(self._sync_lookup_hamqth, callsign, username, password, session_key)


hamqth_service = HamQTHService()
