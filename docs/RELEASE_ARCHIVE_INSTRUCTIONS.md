# Instructions for Building the ProxDMR Universal Release Archive

> **Purpose**: This guide is intended for developers or autonomous agents preparing a self-contained, fully sanitized release archive of ProxDMR for distribution and deployment across Docker platforms (x86_64, ARM64, Synology NAS Container Manager, Raspberry Pi, Debian/Ubuntu/Alpine).

---

## 1. General Requirements for the Release Archive

The release archive must fulfill five fundamental criteria:
1. **Self-Contained Speech Synthesis (Piper TTS)**: Core architecture and catalog of voices configured for instant on-demand or pre-bundled offline playback.
2. **Out-of-the-Box Compilability**: Built-in AMBE+2 C vocoder (`src/c_vocoder`) and C++ extensions compile cleanly inside Docker across both x86_64 and ARM64.
3. **Absolute Sanitization (Zero Secrets)**: No live API keys (Gemini API), BrandMeister/HamQTH passwords, operator callsigns, DMR IDs, JWT signing keys, TLS certificates, or call audio recordings.
4. **First-Run Provisioning**: On initial launch, the system automatically creates clean database schemas, superadministrator credentials, unique JWT secret keys, and self-signed certificates.
5. **Clean Repository Footprint**: Free of OS metadata (`Thumbs.db`, `.DS_Store`), temporary build logs, local crash dumps, and pre-compiled host binaries (`*.o`, `*.so`, `__pycache__`).

---

## 2. Piper TTS Speech Synthesis Components

### 2.1. Python Dependencies (`requirements.txt`)
- `piper-tts>=1.2.0` — Primary local neural synthesis engine.
- `onnxruntime>=1.17.0` — ONNX neural runtime.
- `pyopenjtalk>=0.4.1` — Japanese language phonetizer.
- `g2pw>=0.1.1` and `pypinyin>=0.50.0` — Chinese language phonetizers.
- `transformers>=4.36.0` — Tokenization support.
- `sentence_stream>=1.3.0` and `unicode-rbnf>=2.4.0` — Streaming sentence splitting and number normalization.

### 2.2. System Build Dependencies (`Dockerfile`)
Base image `python:3.11-slim` requires:
```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    curl \
    openssl \
    ffmpeg \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*
```

---

## 3. AMBE+2 C Vocoder Build

The embedded vocoder (`src/c_vocoder/`) decodes compressed DMR AMBE+2 audio frames into Linear PCM and encodes PCM back to AMBE+2.

### Build Hygiene:
Before packaging any release archive, all host-compiled binaries must be cleaned:
```bash
rm -f src/c_vocoder/*.o src/c_vocoder/*.so
```
The shared library `libambe_vocoder.so` is built directly inside the container via `Dockerfile`:
```dockerfile
RUN make -C src/c_vocoder clean && \
    make -C src/c_vocoder && \
    cp src/c_vocoder/libambe_vocoder.so /usr/local/lib/ && \
    ldconfig
```

---

## 4. Sanitization and Security (Exclusions)

### 4.1. Prohibited Files:

| File / Path | Reason for Exclusion |
|---|---|
| `config/settings.json` | Contains operator credentials, API keys, callsigns, and DMR IDs |
| `config/settings.json.bak*` | Backup settings files containing sensitive data |
| `config/proxdmr.db*` | SQLite databases with password hashes, users, logs, and metadata |
| `config/jwt_secret.key` | Private 256-bit JWT signing key |
| `config/cert.pem`, `key.pem` | Host private SSL key and certificate |
| `config/recordings/*` | User audio recordings (`.wav`) |
| `config/calls_history_*.json` | Local hotspot call logs |
| `*.log`, `*.txt` (in root) | Local crash dumps or container logs |
| `src/c_vocoder/*.o`, `*.so` | Host compilation artifacts |
| `__pycache__`, `*.pyc` | Python bytecode |
| `.git/`, `.github/` | Repository history |

### 4.2. Clean Directory Structure in Archive:
```text
config/
├── .gitkeep
├── recordings/
│   └── .gitkeep
└── piper_voices/
    └── .gitkeep
```

### 4.3. Code Sanitization Checks:
Ensure no hardcoded host IP addresses exist in source files:
- Use `HOST_IP` environment variable in `src/main.py`.
- Default to `127.0.0.1` or `localhost` in fallback helpers.
- Use `window.location.host` dynamically in JavaScript.

---

## 5. Standard Dockerfile

```dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    curl \
    openssl \
    ffmpeg \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN make -C src/c_vocoder clean && \
    make -C src/c_vocoder && \
    cp src/c_vocoder/libambe_vocoder.so /usr/local/lib/ && \
    ldconfig

ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

EXPOSE 8266
EXPOSE 62031/udp

CMD ["python", "src/main.py"]
```

---

## 6. Standard docker-compose.yml

```yaml
version: '3.8'

services:
  proxdmr:
    build: .
    container_name: proxdmr
    restart: unless-stopped
    ports:
      - "8266:8266"
      - "62031:62031/udp"
    volumes:
      - ./config:/app/config
      - ./data:/app/data
    environment:
      - PORT=8266
      - USE_SSL=true
      - HOST_IP=127.0.0.1
      - ADMIN_USER=admin
      - ADMIN_PASSWORD=proxdmr123
```

---

## 7. Verification Checklist

Before publishing:
- [ ] **Archive Contents**: Clean archive containing only release files.
- [ ] **No Secrets**: Verify absence of real passwords, API keys, and personal credentials.
- [ ] **Clean Build**: Docker builds cleanly without network timeouts or compiler errors.
- [ ] **First Launch**: Service starts with HTTP 200 on port 8266, initializes database schemas, and provisions SSL certificate.
