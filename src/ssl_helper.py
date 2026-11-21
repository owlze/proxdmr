import ipaddress
import os
import socket
import datetime
from pathlib import Path
from cryptography import x509
from cryptography.x509.oid import NameOID
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives import serialization

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
CERT_FILE = CONFIG_DIR / "cert.pem"
KEY_FILE = CONFIG_DIR / "key.pem"

def detect_host_ip() -> str:
    """Detect the outgoing network interface IP (no packets are actually sent)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def ensure_ssl_certificates(host_ip: str = "") -> tuple[str, str]:
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    if CERT_FILE.exists() and KEY_FILE.exists():
        return str(CERT_FILE), str(KEY_FILE)

    host_ip = (host_ip or "").strip() or detect_host_ip()
    print(f"[SSL] Generating self-signed certificate for {host_ip} and localhost...")
    key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
    )

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COUNTRY_NAME, "RU"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "ProxDMR Amateur Radio"),
        x509.NameAttribute(NameOID.COMMON_NAME, host_ip),
    ])

    san_list = [
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.IPv4Address("127.0.0.1")),
    ]
    try:
        san_list.append(x509.IPAddress(ipaddress.IPv4Address(host_ip)))
    except ValueError:
        san_list.append(x509.DNSName(host_ip))
    try:
        detected_ip = detect_host_ip()
        if detected_ip not in (host_ip, "127.0.0.1"):
            san_list.append(x509.IPAddress(ipaddress.IPv4Address(detected_ip)))
        hostname = socket.gethostname()
        if hostname and hostname not in (host_ip, "localhost"):
            san_list.append(x509.DNSName(hostname))
    except (OSError, ValueError):
        pass

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName(san_list),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )

    with open(KEY_FILE, "wb") as f:
        f.write(
            key.private_bytes(
                encoding=serialization.Encoding.PEM,
                format=serialization.PrivateFormat.TraditionalOpenSSL,
                encryption_algorithm=serialization.NoEncryption(),
            )
        )

    with open(CERT_FILE, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    print(f"[SSL] Certificates saved: {CERT_FILE}, {KEY_FILE}")
    return str(CERT_FILE), str(KEY_FILE)