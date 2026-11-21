# ProxDMR

**ProxDMR** is a multi-protocol client-server amateur radio transceiver that turns your web browser or Android smartphone into a full-featured digital radio across **DMR (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), YSF, D-STAR, M17, SVXLink, XLX Reflectors, and AllStarLink v3 (ASL3)** — powered by 100% software vocoders without requiring a physical transceiver, MMDVM hotspot, or USB vocoder.

**Live Demo (listen-only):** [https://proxdmr.duckdns.org](https://proxdmr.duckdns.org)

> **Need step-by-step installation help?**
> Download the AI-ready guide ([proxdmr-ai-guide.txt](https://raw.githubusercontent.com/owlze/proxdmr/main/proxdmr-ai-guide.txt)) and drop it into any AI chat — it will walk you through Docker, Linux, NAS, or Windows setup one step at a time.

[Key Features](#key-features) • [Prerequisites](#prerequisites) • [Installation](#installation) • [First Launch](#first-launch--network-configuration) • [Android App](#android-application) • [Operations & Backup](#operations-updates--backup)

---

## Key Features

* **100% Software Vocoders** — Server-side software **AMBE+2 (`mbelib-neo`)**, **Codec2**, and **Opus** encoding/decoding; no physical radio, MMDVM hotspot, or USB vocoder required.
* **Multi-Protocol & Multi-Hotspot** — Run multiple independent virtual gateways on one screen across **DMR** (BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2), **YSF**, **D-STAR**, **M17**, **SVXLink**, **XLX**, and **AllStarLink v3 (ASL3)**, with direct BM/TGIF API talkgroup control, live reflector catalogs, favorites, and channel scanning.
* **Low-Latency Web & Android Clients** — Real-time voice streaming in any modern browser or via the dedicated Android app with background reception and Tailscale VPN support — a convenient solution for hosting ProxDMR on a home server or NAS.
* **Live Transcription, Translation & Neural TTS** — Real-time QSO speech-to-text, automatic language detection, multi-language translation, and voice readout — supporting both cloud APIs (Groq, Gemini) and fully offline local AI (local ASR, FastLID, Qwen 2.5, and Piper TTS with amateur radio phonetics).
* **RX/TX Audio DSP & Safety** — 10-band RX equalizer with presets, AGC, limiter, adaptive jitter buffer, AMBE vocoder tuning, L/R timeslot panning, TX microphone DSP (EQ, HPF, noise gate, AGC), and configurable Time-Out Timer (TOT).
* **Server Probe & Live Diagnostics** — Benchmark master servers for ping, jitter, and packet loss to find the fastest node, with real-time latency charts.
* **QSO Audio Archive & Callsign Lookup** — Built-in `.wav` call recorder with instant search and automatic RadioID sync (300,000+ callsigns).
* **Multi-User, SWL & Guest Demo Mode** — SQLite-backed user accounts with isolated settings and hotspots, listen-only SWL/guest demo mode, backup/restore, and an 8-language UI.
* **Watchdog, Telegram Alerts & 1-Click Updates** — Independent watchdog container monitoring health and host resources with Telegram notifications, plus 1-click updates directly from the web UI.

---

## Prerequisites

* **Docker 20.10+** and **Docker Compose v2** on **x86_64** or **ARM64** (Linux, Windows Docker Desktop, Raspberry Pi 4/5, Synology NAS).
* **Resources:** Minimum 2 GB RAM (4 GB+ recommended if using local offline AI transcription/translation).
* **Amateur Radio Credentials:** Licensed Callsign and credentials for your target networks (e.g., DMR ID from [radioid.net](https://www.radioid.net) & Hotspot Security password for DMR, or node/reflector credentials for ASL3 / SVXLink).
* **Open Host Ports:**

| Port | Protocol | Purpose |
| :--- | :--- | :--- |
| `8266` | TCP | Web UI and Android client (HTTPS / WSS) |
| `62031` | UDP | HomeBrew protocol communication with DMR master servers |

*(YSF, D-STAR, M17, and SVXLink use standard outbound connections and require no extra inbound port forwarding.)*

---

## Installation

Choose **Option A** (interactive setup script for Linux/Windows), **Option B** (pre-built multi-arch Docker image — fastest, no build required), or **Option C** (manual Docker Compose build).

### Option A: Interactive Setup Script (Linux, Raspberry Pi, Windows, NAS SSH)

Download `ProxDMR-Release.tar.gz` / `ProxDMR-Release.zip` from [GitHub Releases](https://github.com/owlze/proxdmr/releases) or clone the repository. The script interactively generates `.env`, builds, and starts the containers.

* **Linux / Raspberry Pi / Synology SSH:**

```bash
git clone https://github.com/owlze/proxdmr.git
cd proxdmr
chmod +x setup.sh && ./setup.sh
```

* **Windows (Docker Desktop):** extract `ProxDMR-Release.zip` to `C:\ProxDMR` and run `setup.bat` (or `powershell -ExecutionPolicy Bypass -File .\setup.ps1`). Allow `com.docker.backend` on Private networks if prompted by Firewall.

> **Note:** `ADMIN_PASSWORD` is applied only on initial database creation. Change passwords afterward in the web UI under **Settings → My Account → Security & Password**.

### Option B: Pre-Built Image & Synology Container Manager (No Build Required)

Use the official multi-arch image `ghcr.io/owlze/proxdmr:latest` (or Docker Hub mirror `andrelli/proxdmr:latest`) via `docker-compose.yml` or Synology GUI (**Container Manager → Project → Create → Create docker-compose.yml**):

```yaml
services:
  proxdmr:
    image: ghcr.io/owlze/proxdmr:latest
    container_name: proxdmr
    restart: unless-stopped
    ports:
      - "8266:8266"
      - "62031:62031/udp"
    volumes:
      - ./config:/app/config
      - ./data:/app/src/data
      - /var/run/docker.sock:/var/run/docker.sock   # Optional: required for AllStarLink v3
    environment:
      - HOST_IP=192.168.1.50          # Replace with your server's LAN IP or domain
      - ADMIN_USER=admin
      - ADMIN_PASSWORD=YourSecurePassword
      - ALLOW_REGISTRATION=false
```

Or launch directly with `docker run`:

```bash
docker run -d \
  --name proxdmr \
  --restart unless-stopped \
  -p 8266:8266 \
  -p 62031:62031/udp \
  -v ./config:/app/config \
  -v ./data:/app/src/data \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -e HOST_IP=192.168.1.50 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=YourSecurePassword \
  -e ALLOW_REGISTRATION=false \
  ghcr.io/owlze/proxdmr:latest
```

### Option C: Manual Build via Docker Compose

```bash
cp .env.example .env   # Edit .env to configure HOST_IP, ADMIN_USER, ADMIN_PASSWORD, DEMO_MODE, etc.
docker compose up -d --build
```

---

## First Launch & Network Configuration

1. **Wait 1–2 minutes** on first start while the container generates TLS certificates, initializes the database, and downloads the RadioID directory (check progress with `docker compose logs -f`).
2. Open `https://<SERVER_IP>:8266` in your browser.
3. Accept the self-signed TLS certificate warning (*Advanced → Proceed*) — HTTPS is required by browsers for Web Audio and microphone access.
4. Sign in and open **Hotspot Settings** to add one or more virtual gateways:

| Network | Supported Features & Protocol Options |
| :--- | :--- |
| **DMR Networks** *(BrandMeister, TGIF, FreeDMR, ADN, DMR+ / IPSC2)* | HomeBrew/MMDVM protocol (TS1/TS2), BM API v2 & TGIF API TG control, RPTO / `StartRef` options, live TG directories & server latency probe |
| **XLX Reflectors** | Multiprotocol reflector gateway (D-STAR / DMR), module selection (`A–Z`) on TS2 |
| **Yaesu System Fusion (YSF)** | Native YSFReflector UDP client, live room catalog, favorites & scanner |
| **D-STAR** | Native DExtra / DCS / DPlus reflector client with module selection (`A–Z`) and live directory |
| **M17** | Native M17 UDP client (`mrefd` / `urfd` / `vex`) with software Codec2 vocoder, module selection & live catalog |
| **SVXLink / SVXReflector** | Native TCP+UDP SVXReflector client with software Opus codec, talkgroup switching & favorites |
| **AllStarLink v3 (ASL3)** | Managed Docker sidecar (Asterisk/IAX2) with node directory, quick presets, DTMF & scanner |

---

## Android Application

1. Download the APK from your server at `https://<SERVER_IP>:8266/download/apk` (or from [GitHub Releases](https://github.com/owlze/proxdmr/releases)).
2. Install the APK (allow installation from unknown sources if prompted).
3. Enter your **Server IP/domain**, **Port** (`8266`), optional **Tailscale VPN** auto-connect preference, and login credentials.

---

## Operations, Updates & Backup

* **Persistent Data** *(stored on the host, survives upgrades)*:
  * `.env` — host IP, ports, initial admin credentials, and demo mode settings.
  * `config/` — SQLite database (`proxdmr.db`), TLS certificates, JWT key, `.wav` QSO recordings, cached Piper TTS voices, and automatic update backups.
  * `data/` — RadioID directory, network/TG caches, local AI/translation models, ASL3 instances, and watchdog/alert configs.
* **Upgrading:**
  * **1-Click Web UI:** **Settings → System Update** backs up code to `config/backups/`, applies the release, and restarts the app *(for releases with new system/Python dependencies, pull or rebuild the Docker image)*.
  * **Pre-Built Image:** `docker compose pull && docker compose up -d`.
  * **Local Build:** pull/extract over your directory (`config/`, `data/`, `.env` stay untouched) and run `docker compose up -d --build`.
  * **Android App:** download the updated APK from `https://<SERVER_IP>:8266/download/apk`.
* **Backup & Restore:** stop the stack (`docker compose down`), copy `config/`, `data/`, and `.env` (to restore, place them back and run `docker compose up -d`).
* **Security:** use strong passwords, never share `.env` or `config/`, and prefer VPN access (Tailscale / WireGuard) over exposing ports publicly.

```bash
docker compose logs -f          # Follow live container logs
docker compose ps               # Check container status (proxdmr & proxdmr-watchdog)
docker compose restart          # Restart services
docker compose down             # Stop services
docker compose up -d --build    # Rebuild and start in background
```
