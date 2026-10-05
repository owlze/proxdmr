"""
DMR User Database Manager for ProxDMR
Maintains a local SQLite database of registered DMR amateur radio operators
from RadioID.net with fast full-text search (FTS5) and periodic 3-hour network updates.
"""

import asyncio
import csv
import io
import logging
import sqlite3
import time
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("proxdmr.user_db")

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
DB_PATH = DATA_DIR / "radioid_users.db"
RADIOID_USER_CSV_URL = "https://database.radioid.net/static/user.csv"



def clean_user_name(name: str) -> str:
    """Sanitizes user names from databases (removes placeholders)."""
    if not name:
        return ""
    n = name.strip()
    nl = n.lower()
    if "ask admin" in nl or nl in ("none", "no name", "unknown", "n/a", "null"):
        return ""
    return n

DEFAULT_USER_OVERRIDES = {
    2500967: {"callsign": "RA0ZIJ", "name": "Sandro", "country": "Russia", "city": "Viluchinsk"},
}


class UserDBManager:
    """
    Manages local SQLite database of amateur DMR IDs (~300,000 users worldwide).
    Provides lightning-fast search across callsigns, names, DMR IDs, cities, and countries.
    """

    def __init__(self, db_path: Path = DB_PATH):
        self.db_path = db_path
        self._lock: Optional[asyncio.Lock] = None
        self.last_check_time: float = 0
        self.total_users: int = 0
        self.delta: Optional[int] = None
        self.prev_count: int = 0
        self.last_update_ts: float = 0.0
        self._ensure_db()

    def _get_connection(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), timeout=10.0)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_db(self):
        """Initializes tables and indexes if they do not exist."""
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                CREATE TABLE IF NOT EXISTS users (
                    radio_id INTEGER PRIMARY KEY,
                    callsign TEXT COLLATE NOCASE,
                    first_name TEXT COLLATE NOCASE,
                    last_name TEXT COLLATE NOCASE,
                    city TEXT COLLATE NOCASE,
                    state TEXT COLLATE NOCASE,
                    country TEXT COLLATE NOCASE
                );
            """)
            cur.execute("CREATE INDEX IF NOT EXISTS idx_users_callsign ON users(callsign);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_users_country ON users(country);")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_users_city ON users(city);")

            # Try to create FTS5 table for ultra-fast full text search
            try:
                cur.execute("""
                    CREATE VIRTUAL TABLE IF NOT EXISTS users_fts USING fts5(
                        radio_id UNINDEXED,
                        callsign,
                        first_name,
                        last_name,
                        city,
                        state,
                        country,
                        content='users',
                        content_rowid='radio_id'
                    );
                """)
            except Exception as e:
                logger.warning(f"[USER_DB] FTS5 not available: {e}, falling back to standard SQL")

            # Metadata table to persist counts, delta, and timestamps across restarts
            cur.execute("""
                CREATE TABLE IF NOT EXISTS db_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            """)

            conn.commit()

            cur.execute("SELECT COUNT(*) FROM users")
            self.total_users = cur.fetchone()[0]
            if self.total_users > 0:
                self.last_check_time = time.time()

            # Load metadata
            cur.execute("SELECT key, value FROM db_meta")
            meta = dict(cur.fetchall())

            if "delta" in meta:
                try:
                    self.delta = int(meta["delta"])
                except (ValueError, TypeError):
                    self.delta = None
            elif self.total_users > 0:
                # Default initial delta if database already exists but no metadata saved yet
                self.delta = 27
                self.prev_count = max(0, self.total_users - 27)
                try:
                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('delta', ?)", (str(self.delta),))
                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('prev_count', ?)", (str(self.prev_count),))
                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('last_count', ?)", (str(self.total_users),))
                    conn.commit()
                except Exception as e:
                    logger.debug(f"[USER_DB] Failed to seed initial meta: {e}")

            if "prev_count" in meta:
                try:
                    self.prev_count = int(meta["prev_count"])
                except (ValueError, TypeError):
                    self.prev_count = 0

            if "last_update_ts" in meta:
                try:
                    self.last_update_ts = float(meta["last_update_ts"])
                except (ValueError, TypeError):
                    self.last_update_ts = 0.0
            elif self.db_path.exists():
                try:
                    self.last_update_ts = self.db_path.stat().st_mtime
                except Exception:
                    pass

            logger.info(f"[USER_DB] Initialized SQLite DB at {self.db_path}. Total users: {self.total_users}, Delta: {self.delta}")
        finally:
            conn.close()

    def search_users(self, query: str, limit: int = 50) -> List[Dict[str, Any]]:
        """
        Searches users across all fields: DMR ID, callsign, first/last name, city, country.
        Returns matching records up to `limit`.
        """
        q = query.strip()
        if not q:
            return []

        conn = self._get_connection()
        results = []
        try:
            cur = conn.cursor()

            # If user typed an exact or prefix number (DMR ID)
            if q.isdigit():
                q_id = int(q)
                cur.execute("""
                    SELECT radio_id, callsign, first_name, last_name, city, state, country
                    FROM users
                    WHERE radio_id = ? OR radio_id LIKE ?
                    ORDER BY (radio_id = ?) DESC, radio_id ASC
                    LIMIT ?
                """, (q_id, f"{q}%", q_id, limit))
                for row in cur.fetchall():
                    results.append(dict(row))
                if len(results) >= limit:
                    return results

            # Try FTS5 search first if available
            try:
                clean_q = q.replace('"', '""').replace("'", "''").strip()
                fts_query = f'"{clean_q}"*'
                cur.execute("""
                    SELECT radio_id, callsign, first_name, last_name, city, state, country
                    FROM users_fts
                    WHERE users_fts MATCH ?
                    LIMIT ?
                """, (fts_query, limit))
                for row in cur.fetchall():
                    if not any(r["radio_id"] == row["radio_id"] for r in results):
                        results.append(dict(row))
            except Exception:
                pass

            # If FTS returned fewer than limit or wasn't available, query indexed fields with LIKE
            if len(results) < limit:
                needed = limit - len(results)
                like_str = f"{q}%"
                like_any = f"%{q}%"
                cur.execute("""
                    SELECT radio_id, callsign, first_name, last_name, city, state, country
                    FROM users
                    WHERE callsign LIKE ? 
                       OR callsign LIKE ?
                       OR first_name LIKE ?
                       OR last_name LIKE ?
                       OR city LIKE ?
                       OR country LIKE ?
                    LIMIT ?
                """, (like_str, like_any, like_str, like_str, like_str, like_str, needed))
                for row in cur.fetchall():
                    if not any(r["radio_id"] == row["radio_id"] for r in results):
                        results.append(dict(row))

        except Exception as e:
            logger.error(f"[USER_DB] Search failed for '{q}': {e}")
        finally:
            conn.close()

        # Format full name cleanly and apply known overrides/sanitization
        for item in results:
            rid = item.get("radio_id")
            if rid in DEFAULT_USER_OVERRIDES:
                item["callsign"] = DEFAULT_USER_OVERRIDES[rid]["callsign"]
                item["name"] = DEFAULT_USER_OVERRIDES[rid]["name"]
                if DEFAULT_USER_OVERRIDES[rid].get("country"):
                    item["country"] = DEFAULT_USER_OVERRIDES[rid]["country"]
                if DEFAULT_USER_OVERRIDES[rid].get("city"):
                    item["city"] = DEFAULT_USER_OVERRIDES[rid]["city"]
                continue

            fname = clean_user_name(item.get("first_name") or "")
            lname = clean_user_name(item.get("last_name") or "")
            if fname and lname:
                item["name"] = f"{fname} {lname}"
            elif fname:
                item["name"] = fname
            elif lname:
                item["name"] = lname
            else:
                item["name"] = ""

            c_city = clean_user_name(item.get("city") or "")
            item["city"] = c_city

        return results

    def get_user_by_id(self, radio_id: int) -> Optional[Dict[str, Any]]:
        """Finds single user by their numeric DMR ID."""
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT radio_id, callsign, first_name, last_name, city, state, country
                FROM users WHERE radio_id = ? LIMIT 1
            """, (radio_id,))
            row = cur.fetchone()
            if not row:
                return None
            item = dict(row)
            fname = (item.get("first_name") or "").strip()
            lname = (item.get("last_name") or "").strip()
            item["name"] = f"{fname} {lname}".strip()
            return item
        finally:
            conn.close()

    async def update_from_network(self) -> int:
        """
        Downloads latest user.csv from RadioID.net and imports into SQLite database.
        Runs inside thread pool to prevent blocking the async loop.
        """
        if self._lock is None:
            self._lock = asyncio.Lock()
        async with self._lock:
            def _worker():
                logger.info("[USER_DB] Downloading fresh user.csv from RadioID.net...")
                req = urllib.request.Request(
                    RADIOID_USER_CSV_URL,
                    headers={"User-Agent": "ProxDMR/1.0 (Amateur Radio Web Transceiver)"}
                )
                t0 = time.time()
                with urllib.request.urlopen(req, timeout=60) as resp:
                    raw_data = resp.read().decode("utf-8", errors="ignore")

                download_time = time.time() - t0
                logger.info(f"[USER_DB] Downloaded {len(raw_data)/1024/1024:.2f} MB in {download_time:.2f}s. Parsing...")

                reader = csv.reader(io.StringIO(raw_data))
                try:
                    header = next(reader)
                except StopIteration:
                    return 0

                rows_to_insert = []
                for row in reader:
                    if len(row) < 2:
                        continue
                    try:
                        rid = int(row[0].strip())
                        call = row[1].strip().upper()
                        fname = row[2].strip() if len(row) > 2 else ""
                        lname = row[3].strip() if len(row) > 3 else ""
                        city = row[4].strip() if len(row) > 4 else ""
                        state = row[5].strip() if len(row) > 5 else ""
                        country = row[6].strip() if len(row) > 6 else ""
                        rows_to_insert.append((rid, call, fname, lname, city, state, country))
                    except (ValueError, IndexError):
                        continue

                if not rows_to_insert:
                    logger.warning("[USER_DB] No valid rows found in user.csv")
                    return 0

                t1 = time.time()
                conn = self._get_connection()
                try:
                    cur = conn.cursor()
                    cur.execute("SELECT COUNT(*) FROM users")
                    prev_count = cur.fetchone()[0]
                    if prev_count == 0 and self.total_users > 0:
                        prev_count = self.total_users

                    new_count = len(rows_to_insert)
                    delta = (new_count - prev_count) if prev_count > 0 else 0
                    now_ts = time.time()

                    cur.execute("PRAGMA synchronous = OFF;")
                    cur.execute("PRAGMA journal_mode = MEMORY;")
                    cur.execute("BEGIN TRANSACTION;")
                    cur.execute("DELETE FROM users;")
                    # Insert in chunks of 10000 to reduce RAM spikes and thread blocking
                    CHUNK_SIZE = 10000
                    for i in range(0, len(rows_to_insert), CHUNK_SIZE):
                        chunk = rows_to_insert[i:i + CHUNK_SIZE]
                        cur.executemany("""
                            INSERT OR REPLACE INTO users (radio_id, callsign, first_name, last_name, city, state, country)
                            VALUES (?, ?, ?, ?, ?, ?, ?)
                        """, chunk)

                    try:
                        cur.execute("DELETE FROM users_fts;")
                        cur.execute("""
                            INSERT INTO users_fts (rowid, radio_id, callsign, first_name, last_name, city, state, country)
                            SELECT radio_id, radio_id, callsign, first_name, last_name, city, state, country FROM users;
                        """)
                    except Exception as e:
                        logger.debug(f"[USER_DB] Note on FTS rebuild: {e}")

                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('prev_count', ?)", (str(prev_count),))
                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('last_count', ?)", (str(new_count),))
                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('delta', ?)", (str(delta),))
                    cur.execute("INSERT OR REPLACE INTO db_meta (key, value) VALUES ('last_update_ts', ?)", (str(now_ts),))

                    conn.commit()
                    self.prev_count = prev_count
                    self.total_users = new_count
                    self.delta = delta
                    self.last_update_ts = now_ts
                    import_time = time.time() - t1
                    delta_str = f"+{delta}" if delta > 0 else str(delta)
                    logger.info(f"[USER_DB] Successfully imported {self.total_users} users ({delta_str}) in {import_time:.2f}s")
                    return self.total_users
                finally:
                    conn.close()

            count = await asyncio.to_thread(_worker)
            self.last_check_time = time.time()
            return count

    async def check_and_update(self, interval_seconds: int = 10800) -> bool:
        """
        Checks if update is needed (every 3 hours / 10800s, or if DB is empty).
        Updates if needed.
        """
        now = time.time()
        if self.total_users == 0 or (now - self.last_check_time >= interval_seconds):
            logger.info(f"[USER_DB] Performing scheduled 3-hour check (current users: {self.total_users})...")
            try:
                updated = await self.update_from_network()
                return updated > 0
            except Exception as e:
                logger.error(f"[USER_DB] Network update failed: {e}")
        return False

    def get_stats(self) -> Dict[str, Any]:
        count = self.total_users
        updated_ts = self.last_update_ts
        if not updated_ts and self.db_path.exists():
            try:
                updated_ts = self.db_path.stat().st_mtime
            except Exception:
                pass
        return {
            "count": count,
            "delta": self.delta,
            "prev_count": self.prev_count,
            "updated_ts": updated_ts,
            "updated_str": time.strftime("%d.%m.%Y %H:%M", time.localtime(updated_ts)) if updated_ts else "Встроенная база"
        }


user_db = UserDBManager()