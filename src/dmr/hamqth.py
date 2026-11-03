"""
HAM Web Portals XML API Service for ProxDMR
Supports official XML APIs:
1. QRZ.com (Official XML API: xmldata.qrz.com)
2. HamQTH.com (Official XML API: hamqth.com/xml.php)
Provides authentication session management, parallel lookups, priority merging, and caching.
"""

import asyncio
import json
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


US_STATE_GEO: Dict[str, Tuple[str, str, str]] = {
    "AL": ("5", "8", "NA"), "AK": ("1", "2", "NA"), "AZ": ("3", "6", "NA"),
    "AR": ("4", "8", "NA"), "CA": ("3", "6", "NA"), "CO": ("4", "7", "NA"),
    "CT": ("5", "8", "NA"), "DE": ("5", "8", "NA"), "FL": ("5", "8", "NA"),
    "GA": ("5", "8", "NA"), "HI": ("31", "61", "OC"), "ID": ("3", "6", "NA"),
    "IL": ("4", "8", "NA"), "IN": ("4", "8", "NA"), "IA": ("4", "7", "NA"),
    "KS": ("4", "7", "NA"), "KY": ("4", "8", "NA"), "LA": ("4", "8", "NA"),
    "ME": ("5", "8", "NA"), "MD": ("5", "8", "NA"), "MA": ("5", "8", "NA"),
    "MI": ("4", "8", "NA"), "MN": ("4", "7", "NA"), "MS": ("4", "8", "NA"),
    "MO": ("4", "7", "NA"), "MT": ("4", "7", "NA"), "NE": ("4", "7", "NA"),
    "NV": ("3", "6", "NA"), "NH": ("5", "8", "NA"), "NJ": ("5", "8", "NA"),
    "NM": ("4", "7", "NA"), "NY": ("5", "8", "NA"), "NC": ("5", "8", "NA"),
    "ND": ("4", "7", "NA"), "OH": ("4", "8", "NA"), "OK": ("4", "7", "NA"),
    "OR": ("3", "6", "NA"), "PA": ("5", "8", "NA"), "RI": ("5", "8", "NA"),
    "SC": ("5", "8", "NA"), "SD": ("4", "7", "NA"), "TN": ("4", "8", "NA"),
    "TX": ("4", "8", "NA"), "UT": ("3", "6", "NA"), "VT": ("5", "8", "NA"),
    "VA": ("5", "8", "NA"), "WA": ("3", "6", "NA"), "WV": ("5", "8", "NA"),
    "WI": ("4", "8", "NA"), "WY": ("4", "7", "NA"), "DC": ("5", "8", "NA"),
    "PR": ("8", "11", "NA"), "VI": ("8", "11", "NA"), "GU": ("27", "64", "OC"),
    "AS": ("32", "62", "OC"), "MP": ("27", "64", "OC")
}

US_STATE_NAMES: Dict[str, str] = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID",
    "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT",
    "vermont": "VT", "virginia": "VA", "washington": "WA", "west virginia": "WV",
    "wisconsin": "WI", "wyoming": "WY", "district of columbia": "DC", "puerto rico": "PR",
    "virgin islands": "VI", "guam": "GU"
}


def resolve_us_state(val: str) -> str:
    """Normalizes US state string (2-letter or full name) to 2-letter uppercase abbreviation."""
    v = (val or "").strip().upper()
    if v in US_STATE_GEO:
        return v
    return US_STATE_NAMES.get((val or "").strip().lower(), "")


def _is_us_callsign(call: str) -> bool:
    """Returns True if callsign matches US FCC prefix patterns (W, K, N, AA-AL)."""
    c = _clean_call(call)
    return bool(re.match(r"^([KWN][A-Z]?|A[A-L])[0-9]{1,3}[A-Z]{1,4}$", c))


def maidenhead_to_latlon(grid: str) -> Optional[Tuple[float, float]]:
    """Converts a 4- or 6-character Maidenhead locator to (lat, lon) degrees."""
    g = (grid or "").strip().upper()
    if len(g) < 4:
        return None
    try:
        lon = (ord(g[0]) - ord("A")) * 20.0 - 180.0
        lat = (ord(g[1]) - ord("A")) * 10.0 - 90.0
        lon += int(g[2]) * 2.0
        lat += int(g[3]) * 1.0
        if len(g) >= 6:
            lon += (ord(g[4]) - ord("A") + 0.5) * (2.0 / 24.0)
            lat += (ord(g[5]) - ord("A") + 0.5) * (1.0 / 24.0)
        else:
            lon += 1.0
            lat += 0.5
        return round(lat, 5), round(lon, 5)
    except Exception:
        return None


def latlon_to_maidenhead(lat: float, lon: float) -> str:
    """Converts (lat, lon) in decimal degrees to 6-character Maidenhead locator."""
    try:
        adj_lon = (lon + 180.0) % 360.0
        adj_lat = lat + 90.0
        if adj_lat < 0.0:
            adj_lat = 0.0
        elif adj_lat > 180.0:
            adj_lat = 180.0

        f1 = chr(ord("A") + int(adj_lon / 20.0))
        f2 = chr(ord("A") + int(adj_lat / 10.0))
        rem_lon = adj_lon % 20.0
        rem_lat = adj_lat % 10.0

        s1 = str(int(rem_lon / 2.0))
        s2 = str(int(rem_lat / 1.0))
        rem_lon %= 2.0
        rem_lat %= 1.0

        ss1 = chr(ord("a") + int(rem_lon / (2.0 / 24.0)))
        ss2 = chr(ord("a") + int(rem_lat / (1.0 / 24.0)))
        return f"{f1}{f2}{s1}{s2}{ss1}{ss2}"
    except Exception:
        return ""


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
    # 3. Callook.info (FCC US Amateur Radio Database) Implementation
    # ──────────────────────────────────────────────────────────────────────────

    def _sync_lookup_callook(self, callsign: str) -> Dict[str, Any]:
        """
        Queries callook.info free JSON API for US (FCC) amateur radio licenses.
        Provides grid square, coordinates, operator class, license dates, and FCC ULS record.
        """
        call_upper = _clean_call(callsign)
        if not call_upper or not _is_us_callsign(call_upper):
            return {"status": "not_us", "found": False, "source": "Callook.info", "callsign": call_upper}

        url = f"https://callook.info/{urllib.parse.quote(call_upper)}/json"
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": USER_AGENT, "Accept": "application/json"}
            )
            with urllib.request.urlopen(req, timeout=5.0) as resp:
                raw = resp.read().decode("utf-8", errors="replace")
            data = json.loads(raw)
        except Exception as e:
            logger.warning(f"[Callook] Lookup error for {call_upper}: {e}")
            return {"status": "error", "message": f"Callook error: {e}", "found": False, "source": "Callook.info"}

        if data.get("status") != "VALID":
            return {"status": "not_found", "found": False, "source": "Callook.info", "callsign": call_upper}

        loc = data.get("location") or {}
        addr = data.get("address") or {}
        curr = data.get("current") or {}
        other = data.get("otherInfo") or {}

        raw_name = (data.get("name") or "").strip()
        formatted_name = raw_name.title() if raw_name else ""
        nick = formatted_name.split()[0] if formatted_name else ""

        line2 = (addr.get("line2") or "").strip()
        city = ""
        state = ""
        if line2:
            parts = line2.split(",")
            if len(parts) >= 2:
                city = parts[0].strip().title()
                sm = re.search(r"\b([A-Z]{2})\b", parts[1].strip())
                if sm:
                    state = sm.group(1).upper()
            else:
                city = line2.title()

        grid = (loc.get("gridsquare") or "").strip()
        lat = str(loc.get("latitude") or "").strip()
        lon = str(loc.get("longitude") or "").strip()

        if grid and (not lat or not lon):
            c = maidenhead_to_latlon(grid)
            if c:
                lat, lon = str(c[0]), str(c[1])
        elif (lat and lon) and not grid:
            try:
                grid = latlon_to_maidenhead(float(lat), float(lon))
            except Exception:
                pass

        cq, itu, cont = "", "", ""
        st_resolved = resolve_us_state(state)
        if st_resolved and st_resolved in US_STATE_GEO:
            cq, itu, cont = US_STATE_GEO[st_resolved]
        else:
            cont = "NA"

        grant_date = (other.get("grantDate") or "").strip()
        lic_year = grant_date.split("/")[-1] if "/" in grant_date else ""

        oper_class = (curr.get("operClass") or "").strip().title()
        expiry_date = (other.get("expiryDate") or "").strip()
        uls_url = (other.get("ulsUrl") or "").strip()
        frn = (other.get("frn") or "").strip()

        record = {
            "callsign": call_upper,
            "nick": nick,
            "name": formatted_name,
            "adr_name": formatted_name,
            "city": city,
            "adr_city": city,
            "us_state": state or st_resolved,
            "us_county": "",
            "country": "United States",
            "adif": "291",
            "grid": grid,
            "latitude": lat,
            "longitude": lon,
            "itu": itu,
            "cq": cq,
            "continent": cont,
            "utc_offset": "",
            "qsl": "",
            "qsldirect": "",
            "qsl_via": "",
            "lotw": "",
            "eqsl": "",
            "mail": "",
            "email": "",
            "web": "",
            "picture": "",
            "qslpic": "",
            "bio": "",
            "lookups": "",
            "lic_year": lic_year,
            "birth_year": "",
            "iota": "",
            "oper_class": oper_class,
            "lic_grant": grant_date,
            "lic_expires": expiry_date,
            "uls_url": uls_url,
            "frn": frn
        }

        return {
            "status": "ok",
            "found": True,
            "source": "Callook.info",
            "callsign": call_upper,
            "data": record
        }

    # ──────────────────────────────────────────────────────────────────────────
    # 4. Multi-Portal Parallel Lookup & Priority Merge
    # ──────────────────────────────────────────────────────────────────────────

    async def lookup_callsign_multi(self, callsign: str, creds: Dict[str, Tuple[str, str]]) -> Dict[str, Any]:
        """
        Queries all configured portals in parallel via asyncio.gather and merges fields
        by strict priority: 1. QRZ.com -> 2. HamQTH.com, and enriches US callsigns via Callook.info (FCC).
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

        is_us = _is_us_callsign(call_upper)

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

        # Include free FCC Callook lookup for US callsigns
        if is_us:
            portal_order.append("Callook.info")
            tasks.append(asyncio.to_thread(self._sync_lookup_callook, call_upper))

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

        # Check which sources were found
        sources_found = [p for p in ("QRZ.com", "HamQTH.com") if results_by_portal.get(p, {}).get("found")]
        callook_found = results_by_portal.get("Callook.info", {}).get("found", False)

        if not sources_found and not callook_found:
            all_not_found = all(
                results_by_portal.get(p, {}).get("status") in ("not_found", "not_us")
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
            "web", "picture", "qslpic", "bio", "lookups", "lic_year", "birth_year", "iota",
            "oper_class", "lic_grant", "lic_expires", "uls_url", "frn"
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

        # If Callook found, enrich missing or FCC-certified fields
        if callook_found:
            c_data = results_by_portal.get("Callook.info", {}).get("data", {})
            # FCC fields
            for f in ("oper_class", "lic_grant", "lic_expires", "uls_url", "frn"):
                if c_data.get(f):
                    merged[f] = c_data[f]

            # Missing primary fields
            for f in ("grid", "latitude", "longitude", "us_state", "city", "adr_city", "name", "adr_name", "nick", "lic_year"):
                if not merged.get(f) and c_data.get(f):
                    merged[f] = c_data[f]

            # If QRZ stripped grid or coords (free account limitation), take Callook's exact FCC coords
            if c_data.get("grid") and (not merged.get("grid") or merged.get("grid") == "—"):
                merged["grid"] = c_data["grid"]
            if c_data.get("latitude") and (not merged.get("latitude") or not merged.get("longitude")):
                merged["latitude"] = c_data["latitude"]
                merged["longitude"] = c_data["longitude"]

            sources_found.append("Callook (FCC)")

        # Post-merge Geo and Zone enrichment (Maidenhead <-> Lat/Lon & CQ/ITU zones)
        if merged.get("grid") and (not merged.get("latitude") or not merged.get("longitude")):
            c = maidenhead_to_latlon(merged["grid"])
            if c:
                merged["latitude"] = str(c[0])
                merged["longitude"] = str(c[1])
        elif (merged.get("latitude") and merged.get("longitude")) and not merged.get("grid"):
            try:
                merged["grid"] = latlon_to_maidenhead(float(merged["latitude"]), float(merged["longitude"]))
            except Exception:
                pass

        # US State CQ / ITU zones & continent resolution
        st_resolved = resolve_us_state(merged.get("us_state", ""))
        if st_resolved and st_resolved in US_STATE_GEO:
            cq_val, itu_val, cont_val = US_STATE_GEO[st_resolved]
            if not merged.get("cq"):
                merged["cq"] = cq_val
            if not merged.get("itu"):
                merged["itu"] = itu_val
            if not merged.get("continent"):
                merged["continent"] = cont_val
        elif is_us:
            if not merged.get("continent"):
                merged["continent"] = "NA"

        if is_us or st_resolved:
            if not merged.get("country"):
                merged["country"] = "United States"
            if not merged.get("adif"):
                merged["adif"] = "291"

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
