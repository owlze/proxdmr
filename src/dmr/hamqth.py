"""
HamQTH.com XML API Service for ProxDMR
Provides authentication session management, callsign lookups, and result caching.
"""

import asyncio
import logging
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger("proxdmr.hamqth")

HAMQTH_XML_URL = "https://www.hamqth.com/xml.php"
USER_AGENT = "ProxDMR/1.13 (+https://github.com/)"


def _strip_ns(tag: str) -> str:
    """Removes XML namespace prefix if present."""
    return tag.split("}", 1)[-1] if "}" in tag else tag


class HamQTHService:
    def __init__(self):
        # Cache for session: username -> (session_id, timestamp)
        self._session_cache: Dict[str, Tuple[str, float]] = {}
        # Cache for lookups: callsign_upper -> (result_dict, timestamp)
        self._lookup_cache: Dict[str, Tuple[Dict[str, Any], float]] = {}
        # TTLs
        self.SESSION_TTL = 3000.0  # 50 minutes (HamQTH server session is ~1 hour)
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

        # Query XML login
        params = urllib.parse.urlencode({"u": u_clean, "p": p_clean})
        url = f"{HAMQTH_XML_URL}?{params}"
        xml_resp = self._http_get(url)
        root = self._parse_xml(xml_resp)

        # Check for error
        for elem in root.iter():
            if _strip_ns(elem.tag) == "error" and elem.text and elem.text.strip():
                err_msg = elem.text.strip()
                raise ValueError(f"HamQTH: {err_msg}")

        # Look for session_id
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

    def _sync_lookup(self, callsign: str, username: str = "", password: str = "", session_key: str = "") -> Dict[str, Any]:
        """Perform callsign lookup synchronously."""
        call_upper = callsign.strip().upper()
        if "-" in call_upper:
            parts = call_upper.split("-")
            if len(parts) == 2 and parts[1].isdigit():
                call_upper = parts[0].strip()

        if not call_upper:
            return {"status": "error", "message": "Позывной не указан"}

        now = time.time()
        # Check lookup cache
        if call_upper in self._lookup_cache:
            res, ts = self._lookup_cache[call_upper]
            ttl = self.LOOKUP_SUCCESS_TTL if res.get("found") else self.LOOKUP_NOT_FOUND_TTL
            if now - ts < ttl:
                return res

        # Obtain or validate session ID
        u_clean = username.strip()
        p_clean = password.strip()
        k_clean = session_key.strip()

        session_id = None
        if u_clean and p_clean:
            try:
                session_id = self._sync_get_session(u_clean, p_clean)
            except Exception as e:
                logger.warning(f"[HamQTH] Auth failed for '{u_clean}': {e}")
                return {"status": "error", "message": f"Ошибка авторизации HamQTH: {e}"}
        elif k_clean:
            session_id = k_clean
        else:
            return {
                "status": "no_credentials",
                "message": "Учетные данные HamQTH.com не настроены в Общих настройках"
            }

        def fetch_with_session(sess: str) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
            params = urllib.parse.urlencode({
                "id": sess,
                "callsign": call_upper,
                "prg": "ProxDMR"
            })
            url = f"{HAMQTH_XML_URL}?{params}"
            xml_resp = self._http_get(url)
            root = self._parse_xml(xml_resp)

            # Check for error
            for elem in root.iter():
                if _strip_ns(elem.tag) == "error" and elem.text and elem.text.strip():
                    return elem.text.strip(), None

            # Look for search element
            fields: Dict[str, Any] = {}
            for child in root:
                if _strip_ns(child.tag) == "search":
                    for f in child:
                        t = _strip_ns(f.tag)
                        fields[t] = (f.text or "").strip()
            return None, fields

        # Attempt query
        try:
            err, data = fetch_with_session(session_id)
        except Exception as e:
            logger.warning(f"[HamQTH] Query error for '{call_upper}': {e}")
            return {"status": "error", "message": f"Сетевая ошибка HamQTH: {e}"}

        # If session expired, refresh once if username/password available
        if err and ("session" in err.lower() and ("expired" in err.lower() or "not exist" in err.lower())):
            if u_clean and p_clean:
                try:
                    logger.info("[HamQTH] Session expired, re-authenticating...")
                    session_id = self._sync_get_session(u_clean, p_clean, force_refresh=True)
                    err, data = fetch_with_session(session_id)
                except Exception as e:
                    return {"status": "error", "message": f"Ошибка повторной авторизации HamQTH: {e}"}
            else:
                return {
                    "status": "error",
                    "message": "Сессионный ключ HamQTH истек. Обновите учетные данные в Настройках."
                }

        # Check not found
        if err:
            err_lower = err.lower()
            if "not found" in err_lower or "callsign" in err_lower:
                res = {
                    "status": "not_found",
                    "found": False,
                    "callsign": call_upper,
                    "message": f"Позывной {call_upper} на HamQTH.com не найден"
                }
                self._lookup_cache[call_upper] = (res, now)
                return res
            return {"status": "error", "message": f"HamQTH: {err}"}

        if not data or not data.get("callsign"):
            res = {
                "status": "not_found",
                "found": False,
                "callsign": call_upper,
                "message": f"Данные о позывном {call_upper} на HamQTH.com отсутствуют"
            }
            self._lookup_cache[call_upper] = (res, now)
            return res

        # Normalize structured data
        record = {
            "callsign": data.get("callsign", call_upper),
            "nick": data.get("nick", ""),
            "name": data.get("name", ""),
            "adr_name": data.get("adr_name", ""),
            "city": data.get("adr_city", ""),
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
            "lotw": data.get("lotw", ""),
            "eqsl": data.get("eqsl", ""),
            "mail": data.get("mail", ""),
            "email": data.get("email", ""),
            "web": data.get("web", ""),
            "qslpic": data.get("qslpic", ""),
            "bio": data.get("bio", ""),
            "lookups": data.get("lookups", "")
        }

        result = {
            "status": "ok",
            "found": True,
            "callsign": call_upper,
            "data": record
        }
        self._lookup_cache[call_upper] = (result, now)
        return result

    async def get_session(self, username: str, password: str, force_refresh: bool = False) -> str:
        """Asynchronous wrapper for get_session."""
        return await asyncio.to_thread(self._sync_get_session, username, password, force_refresh)

    async def lookup_callsign(self, callsign: str, username: str = "", password: str = "", session_key: str = "") -> Dict[str, Any]:
        """Asynchronous wrapper for lookup_callsign."""
        return await asyncio.to_thread(self._sync_lookup, callsign, username, password, session_key)

    async def test_connection(self, username: str, password: str, session_key: str = "") -> Dict[str, Any]:
        """Test credentials against HamQTH XML API."""
        u_clean = username.strip()
        p_clean = password.strip()
        k_clean = session_key.strip()

        if not u_clean and not p_clean and not k_clean:
            return {
                "status": "error",
                "message": "Укажите логин и пароль (или сессионный ключ) HamQTH.com"
            }

        try:
            if u_clean and p_clean:
                sess_id = await self.get_session(u_clean, p_clean, force_refresh=True)
                return {
                    "status": "ok",
                    "message": "Успешная авторизация в HamQTH.com",
                    "session_id": f"{sess_id[:8]}..."
                }
            elif k_clean:
                # Test lookup of a known callsign with provided key
                res = await self.lookup_callsign("W1AW", session_key=k_clean)
                if res.get("status") == "ok" or res.get("status") == "not_found":
                    return {
                        "status": "ok",
                        "message": "Сессионный ключ HamQTH действителен"
                    }
                else:
                    return {
                        "status": "error",
                        "message": res.get("message", "Сессионный ключ недействителен")
                    }
            else:
                return {
                    "status": "error",
                    "message": "Для авторизации требуются и логин, и пароль"
                }
        except Exception as e:
            return {
                "status": "error",
                "message": str(e)
            }


hamqth_service = HamQTHService()
