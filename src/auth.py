"""
ProxDMR Auth Module — password hashing (bcrypt/PBKDF2) + JWT tokens.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import re
import time
from pathlib import Path

logger = logging.getLogger("proxdmr.auth")

# --- Optional dependencies with fallbacks ---

try:
    import bcrypt
    _HAS_BCRYPT = True
except ImportError:
    _HAS_BCRYPT = False
    logger.warning("[AUTH] bcrypt not installed, using PBKDF2 fallback")

try:
    import jwt as pyjwt
    _HAS_PYJWT = True
except ImportError:
    _HAS_PYJWT = False
    logger.warning("[AUTH] PyJWT not installed, using HMAC fallback")

# --- Configuration ---

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
JWT_SECRET_FILE = CONFIG_DIR / "jwt_secret.key"
JWT_EXPIRY_DAYS_REMEMBER = 3650  # 10 years (long-term session for remembered devices / APK)
JWT_EXPIRY_DAYS_SESSION = 1

LOGIN_MIN_LENGTH = 3
LOGIN_MAX_LENGTH = 30
LOGIN_PATTERN = re.compile(r'^[a-zA-Z0-9_.\-]+$')
PASSWORD_MIN_LENGTH = 6


# --- JWT Secret ---

_jwt_secret_cache: str | None = None


def _get_jwt_secret() -> str:
    """Load or generate JWT signing secret (cached in memory)."""
    global _jwt_secret_cache
    if _jwt_secret_cache:
        return _jwt_secret_cache
    if JWT_SECRET_FILE.exists():
        _jwt_secret_cache = JWT_SECRET_FILE.read_text(encoding="utf-8").strip()
        return _jwt_secret_cache
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    secret = base64.urlsafe_b64encode(os.urandom(32)).decode()
    JWT_SECRET_FILE.write_text(secret, encoding="utf-8")
    try:
        os.chmod(JWT_SECRET_FILE, 0o600)
    except OSError:
        pass
    logger.info("[AUTH] Generated new JWT secret")
    _jwt_secret_cache = secret
    return secret


# --- Password Hashing ---

def hash_password(password: str) -> str:
    """Hash a password using bcrypt (preferred) or PBKDF2 (fallback)."""
    if _HAS_BCRYPT:
        return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")
    # PBKDF2 fallback
    salt = os.urandom(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
    return f"pbkdf2${salt.hex()}${dk.hex()}"


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against its hash."""
    try:
        if password_hash.startswith("pbkdf2$"):
            _, salt_hex, dk_hex = password_hash.split("$")
            salt = bytes.fromhex(salt_hex)
            dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 200_000)
            return hmac.compare_digest(dk.hex(), dk_hex)
        if _HAS_BCRYPT:
            return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception as e:
        logger.error(f"[AUTH] Password verification error: {e}")
    return False


# --- JWT ---

def create_jwt(user_id: int, login: str, remember: bool = True, role: str = "user") -> str:
    """Create a JWT token for the given user."""
    secret = _get_jwt_secret()
    exp_days = JWT_EXPIRY_DAYS_REMEMBER if remember else JWT_EXPIRY_DAYS_SESSION
    payload = {
        "user_id": user_id,
        "login": login,
        "role": role,
        "exp": int(time.time()) + (exp_days * 86400),
        "iat": int(time.time()),
    }
    if _HAS_PYJWT:
        return pyjwt.encode(payload, secret, algorithm="HS256")
    # HMAC fallback
    payload_json = json.dumps(payload, separators=(",", ":"))
    payload_b64 = base64.urlsafe_b64encode(payload_json.encode()).decode().rstrip("=")
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def verify_jwt(token: str) -> dict | None:
    """Verify and decode a JWT token. Returns payload dict or None."""
    if not token:
        return None
    secret = _get_jwt_secret()
    try:
        if _HAS_PYJWT:
            return pyjwt.decode(token, secret, algorithms=["HS256"])
        # HMAC fallback
        parts = token.split(".")
        if len(parts) != 2:
            return None
        payload_b64, sig = parts
        expected_sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(sig, expected_sig):
            return None
        padding = 4 - len(payload_b64) % 4
        if padding != 4:
            payload_b64 += "=" * padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        if payload.get("exp", 0) < time.time():
            return None
        return payload
    except Exception:
        return None


# --- Validation ---

def validate_login(login: str) -> str | None:
    """Validate login format. Returns error message or None if valid."""
    if not login or len(login.strip()) < LOGIN_MIN_LENGTH:
        return f"Логин должен быть не менее {LOGIN_MIN_LENGTH} символов"
    if len(login) > LOGIN_MAX_LENGTH:
        return f"Логин не должен превышать {LOGIN_MAX_LENGTH} символов"
    if not LOGIN_PATTERN.match(login):
        return "Логин может содержать только латинские буквы, цифры, _ . -"
    return None


def validate_password(password: str) -> str | None:
    """Validate password strength. Returns error message or None if valid."""
    if not password or len(password) < PASSWORD_MIN_LENGTH:
        return f"Пароль должен быть не менее {PASSWORD_MIN_LENGTH} символов"
    return None
