# ProxDMR — START HERE

A web platform and gateway for the **DMR (BrandMeister)** amateur radio network: voice reception and transmission (PTT) directly from the browser or the official Android app, multi-hotspot support, dual timeslots (TS1 / TS2), Last Heard activity log, recording, and offline neural speech synthesis.

---

## Table of Contents

1. [Package Contents](#1-package-contents)
2. [Prerequisites](#2-prerequisites)
3. [Installation — Choose Your Method](#3-installation--choose-your-method)
   * [A. Linux / Raspberry Pi (Terminal)](#a-linux--raspberry-pi-terminal)
   * [B. Windows (Docker Desktop)](#b-windows-docker-desktop)
   * [C. Synology NAS — via SSH](#c-synology-nas--via-ssh)
   * [D. Synology NAS — via GUI (Container Manager)](#d-synology-nas--via-gui-container-manager)
   * [E. Manual Start via Docker Compose (Any OS)](#e-manual-start-via-docker-compose-any-os)
   * [F. Run via Pre-Built Docker Image](#f-run-via-pre-built-docker-image)
4. [First Launch and Sign In](#4-first-launch-and-sign-in)
5. [BrandMeister Hotspot Configuration](#5-brandmeister-hotspot-configuration)
6. [Piper Speech Synthesis (TTS) Voices](#6-piper-speech-synthesis-tts-voices)
7. [Android Application](#7-android-application)
8. [Data Persistence & Storage](#8-data-persistence--storage)
9. [Upgrading to a New Version](#9-upgrading-to-a-new-version)
10. [Backup & Restore](#10-backup--restore)
11. [Security Recommendations](#11-security-recommendations)
12. [Useful Commands](#12-useful-commands)
13. [Troubleshooting](#13-troubleshooting)
14. [Uninstallation](#14-uninstallation)

---

## 1. Package Contents

Two release archives are provided with **identical contents**:

| Archive | Intended For |
|---|---|
| `ProxDMR-Release.tar.gz` | Linux, Raspberry Pi, Synology NAS |
| `ProxDMR-Release.zip` | Windows (Docker Desktop) |

The archive contains **no private data**, passwords, API keys, call recordings, databases, or voice models. Everything is automatically provisioned or downloaded upon your initial launch.

---

## 2. Prerequisites

* **Docker** 20.10+ and **Docker Compose v2** (built into Docker Desktop and Synology Container Manager).
* **Architecture:** x86_64 or ARM64 (Raspberry Pi 4/5, modern ARM Synology NAS). The AMBE+2 vocoder compiles directly inside the container for your hardware.
* **Internet Connection** during initial launch: downloads the base Python image, packages, RadioID database, and required Piper voices.
* **Available Ports** on your host:

| Port | Protocol | Purpose |
|---|---|---|
| `8266` | TCP | Web interface and Android app (HTTPS/WSS) |
| `62031` | UDP | HomeBrew protocol exchange with BrandMeister master server |

* **BrandMeister Account** and amateur radio credentials: Callsign, DMR ID, and Hotspot Security Password (from your profile on brandmeister.network).

---

## 3. Installation — Choose Your Method

During interactive setup, you will be prompted for:

| Prompt | What to Enter |
|---|---|
| Host IP or domain for SSL | Local IP of your server (auto-detected default provided) |
| Web interface port | `8266` (Press Enter) |
| Admin username | `admin` or your callsign |
| Admin password | **Enter your secure password** (default `proxdmr123`) |
| Disable open registration? | `Y` (recommended) |

> ⚠️ **Admin Password:** Configured upon first startup (default `proxdmr123` or your chosen password). Once logged in, you can change your password at any time directly in the web UI under **Settings → My Account → Security & Password**. Changing `ADMIN_PASSWORD` in `.env` later will not affect existing users in the database.

### A. Linux / Raspberry Pi (Terminal)

```bash
tar -xzf ProxDMR-Release.tar.gz
cd ProxDMR
chmod +x setup.sh
./setup.sh
```

The script verifies Docker, generates `.env`, asks the prompts above, builds, and launches the container. Upon completion, it outputs your login URL.

If Docker is not yet installed (Debian/Ubuntu/Raspberry Pi OS):
```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # then log out and back in
```

### B. Windows (Docker Desktop)

1. Install **Docker Desktop** (<https://www.docker.com/products/docker-desktop/>) and start it. Ensure Docker is running in the system tray.
2. Extract `ProxDMR-Release.zip` (for example to `C:\ProxDMR`).
3. Open the `ProxDMR` folder and double-click **`setup.bat`**.  
   Alternatively, in PowerShell:
   ```powershell
   cd C:\ProxDMR\ProxDMR
   powershell -ExecutionPolicy Bypass -File .\setup.ps1
   ```
4. Follow the setup prompts and wait for the launch confirmation.

*If Windows Defender Firewall prompts for Docker/`com.docker.backend`, allow access on **Private networks** so other local devices can connect.*

### C. Synology NAS — via SSH

Suitable for DSM 7.x with **Container Manager** installed:

1. Enable SSH: *Control Panel → Terminal & SNMP → Enable SSH service*.
2. Upload `ProxDMR-Release.tar.gz` to a shared folder (e.g. `docker`) via File Station.
3. Connect via SSH and run:
   ```bash
   cd /volume1/docker
   sudo tar -xzf ProxDMR-Release.tar.gz
   cd ProxDMR
   sudo chmod +x setup.sh
   sudo ./setup.sh
   ```
4. Complete the configuration prompts.

### D. Synology NAS — via GUI (Container Manager)

No SSH required:

1. **Upload & Extract:**
   * Open **File Station**, create a folder `docker/proxdmr`.
   * Upload `ProxDMR-Release.tar.gz` (or `.zip`), right-click → **Extract Here**.
   * Structure should be: `docker/proxdmr/ProxDMR/...` (containing `docker-compose.yml`, `Dockerfile`, `.env.example`).
2. **Create `.env`:**
   * In `ProxDMR`, duplicate `.env.example` and rename it to **`.env`**.
   * Open `.env` in DSM Text Editor and specify:
     ```ini
     HOST_IP=192.168.1.50        # Local IP of your NAS
     PORT=8266
     ADMIN_USER=admin
     ADMIN_PASSWORD=YourSecurePassword
     ALLOW_REGISTRATION=false
     ```
3. **Create Project:**
   * Open **Container Manager → Project → Create**.
   * Project name: `proxdmr`. Path: select `docker/proxdmr/ProxDMR`.
   * Source: **Use existing docker-compose.yml**.
   * Next → uncheck "Web portal" → **Done**.
   * Container Manager will build the image and start the container.
4. **DSM Firewall** (if enabled): *Control Panel → Security → Firewall* — allow inbound `8266/TCP` and `62031/UDP`.

### E. Manual Start via Docker Compose (Any OS)

```bash
cp .env.example .env        # Windows: copy .env.example .env
```

Edit `.env` to set `HOST_IP` (your server IP or domain), `ADMIN_USER`, and `ADMIN_PASSWORD`. Then:

```bash
docker compose up -d --build
```

### F. Run via Pre-Built Docker Image

If you prefer not to build locally:

```bash
docker run -d \
  --name proxdmr \
  --restart unless-stopped \
  -p 8266:8266 \
  -p 62031:62031/udp \
  -v proxdmr_config:/app/config \
  -v proxdmr_data:/app/data \
  -e HOST_IP=192.168.1.50 \
  -e ADMIN_USER=admin \
  -e ADMIN_PASSWORD=YourSecurePassword \
  ghcr.io/owlze/proxdmr:latest
```

---

## 4. First Launch and Sign In

1. Allow 1–2 minutes after initial start: the container generates TLS certificates, session signing keys, initializes user database schemas, and downloads the RadioID database.  
   Monitor logs with: `docker compose logs -f` (exit with `Ctrl+C`).
2. Open your web browser:
   ```text
   https://<SERVER_IP>:8266
   ```
3. **Browser Certificate Warning:** The service generates a local self-signed TLS certificate required by browsers for Web Audio and microphone access. Click *Advanced → Proceed to site*.
4. Sign in with the credentials specified during setup (default `admin` / `proxdmr123`).

---

## 5. BrandMeister Hotspot Configuration

In the web interface, open hotspot settings and configure:

| Field | Description |
|---|---|
| **Callsign** | Your licensed amateur radio callsign |
| **DMR ID** | Your DMR ID (registered via radioid.net) |
| **BM Password** | *Hotspot Security Password* from your brandmeister.network profile |
| **BM Master Host** | Closest master server (default `2322.master.brandmeister.network`) |

Click **Save** — the gateway will connect to BrandMeister. Multiple virtual hotspots can be configured simultaneously.

---

## 6. Piper Speech Synthesis (TTS) Voices

Voice models are downloaded on demand:

* Open speech synthesis (TTS) settings and choose a voice model — it downloads automatically in the background.
* Downloaded models are cached in `config/piper_voices/` and persist across container restarts and updates.

---

## 7. Android Application

The mobile app provides a native Android client with low-latency PTT, background audio service, and Bluetooth PTT button support.

1. **Download APK** from your server:
   ```text
   https://<SERVER_IP>:8266/download/apk
   ```
   *(or use `src/static/ProxDMR.apk` from the release archive).*
2. Allow installation from unknown sources on your Android device and install the package.
3. On first run, enter:
   * **Server IP or domain**;
   * **Port** (default `8266`);
   * Tailscale VPN auto-connect preference (if accessing remotely).
4. Enter your login credentials. The application persists session tokens for seamless reconnects.

---

## 8. Data Persistence & Storage

All user configurations and persistent records reside **outside the container**, preserving data across updates:

| Path | Contents |
|---|---|
| `.env` | Environment configuration (host IP, ports, admin credentials) |
| `config/proxdmr.db` | SQLite database (users, settings, call logs) |
| `config/jwt_secret.key` | JWT session encryption key |
| `config/cert.pem`, `config/key.pem` | TLS certificates |
| `config/recordings/` | Audio recordings (`.wav`) |
| `config/piper_voices/` | Cached Piper TTS voice models |
| `data/` | RadioID database and TalkGroup cache |

---

## 9. Upgrading to a New Version

1. Stop the service and create a backup (see Section 10):
   ```bash
   docker compose down
   ```
2. Extract the new archive over your installation directory. Existing `.env`, `config/`, and `data/` directories will remain untouched.
3. Rebuild and launch:
   ```bash
   docker compose up -d --build
   ```
4. Database migrations apply automatically upon startup.
5. Update the Android app via `/download/apk` if a new APK version is available.

---

## 10. Backup & Restore

To back up, stop the service and copy **`config/`**, **`data/`**, and **`.env`**.  
To restore, copy these items back into the project root and run `docker compose up -d`.

---

## 11. Security Recommendations

* Keep `ALLOW_REGISTRATION=false` if exposing the port externally to prevent unauthorized transmission access.
* Prefer accessing your server remotely through a **VPN (Tailscale / WireGuard)** rather than opening public WAN ports.
* Always replace the default `proxdmr123` password with a strong password.
* Never share `.env` or `config/` files, as they contain passwords and session keys.

---

## 12. Useful Commands

```bash
docker compose logs -f              # Follow logs in real time
docker compose ps                   # View container status
docker compose restart              # Restart service
docker compose down                 # Stop service
docker compose up -d --build        # Rebuild and start in background
```

---

## 13. Troubleshooting

| Issue | Resolution |
|---|---|
| `docker: command not found` | Install Docker; on Windows, start Docker Desktop and wait for initialization |
| Port `8266` or `62031` in use | Adjust `PORT` / `DMR_PORT` in `.env`, then run `docker compose up -d` |
| Browser certificate warning | Expected with self-signed TLS. Accept the certificate exception |
| TLS certificate host mismatch | Change `HOST_IP` in `.env`, delete `config/cert.pem` and `key.pem`, then recreate container |
| Forgotten admin password | Reset password in the web UI. If locked out, stop container, delete `config/proxdmr.db`, set `ADMIN_PASSWORD` in `.env`, and start container |
| No BrandMeister connection | Verify callsign, DMR ID, BM password, and UDP port `62031` firewall routing |
| No microphone/audio in browser | Connect using `https://`, grant browser microphone permissions |
| App cannot connect | Verify server IP, port, network reachability, and Tailscale connection |

---

## 14. Uninstallation

```bash
docker compose down
```

Remove the project folder. *Note: Deleting the directory will remove your databases and recordings in `config/` and `data/`.*
