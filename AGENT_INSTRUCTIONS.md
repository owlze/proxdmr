# ProxDMR — INSTRUCTIONS FOR AN LLM INSTALLATION AGENT

You are an AI agent installing the **ProxDMR** package (DMR / BrandMeister web gateway) on behalf of a user.
Read this file completely before running any command. Talk to the user in **the language the user writes in**.
Human-oriented docs are in `README.md`; this file is the strict, machine-oriented procedure.

---

## 0. Ground rules (MUST follow)

1. **Install only. Do not modify the product.** Never edit files under `src/`, `Dockerfile`, `docker-compose.yml`, `requirements.txt`, `setup.*`. You may create/edit **only** the `.env` file (and, optionally, `config/default_settings.json` if the user explicitly asks).
2. **Ask before anything irreversible or system-wide:** installing Docker, opening firewall ports, deleting files, deleting `config/` or `data/`, overwriting an existing installation.
3. **Never invent secrets.** The administrator password and BrandMeister credentials come from the user. Never use or suggest a default password for a server reachable from the internet.
4. **Never print or log secrets** (`.env` contents, passwords, BrandMeister password) in your final report. Mask them (`********`).
5. **Do not touch existing user data.** If `config/` or `data/` already contain files, this is an **update**, not a fresh install (see section 7).
6. **Stop and ask** when a step fails twice in a row, or when the environment does not match section 1.

---

## 1. Preconditions — check, do not assume

Run and record the results:

| Check | Command | Required |
|---|---|---|
| Docker present | `docker --version` | 20.10+ |
| Compose v2 present | `docker compose version` | v2.x (v1 `docker-compose` is acceptable as fallback) |
| Docker daemon running | `docker info` | no error |
| CPU architecture | `uname -m` (Windows: `$env:PROCESSOR_ARCHITECTURE`) | `x86_64`/`amd64` or `aarch64`/`arm64` |
| Port 8266/TCP free | Linux: `ss -ltn "sport = :8266"` · Windows: `Get-NetTCPConnection -LocalPort 8266 -ErrorAction SilentlyContinue` | no listener |
| Port 62031/UDP free | Linux: `ss -lun "sport = :62031"` | no listener |
| Free disk | `df -h .` | several GB free |
| Internet | `curl -sI https://registry-1.docker.io` (or equivalent) | reachable |

Windows note: if `docker` is not on `PATH`, try `C:\Program Files\Docker\Docker\resources\bin\docker.exe`.
Synology note: DSM 7.x with the **Container Manager** package is required.

If Docker is missing: **ask the user** whether to install it. Linux: `curl -fsSL https://get.docker.com | sh`. Windows/macOS: instruct the user to install Docker Desktop (cannot be done silently). Synology: install *Container Manager* from Package Center.

---

## 2. Collect inputs from the user

Ask for exactly these (offer the default in brackets):

| Variable | Question | Default |
|---|---|---|
| `HOST_IP` | IP address or domain of **this server** as seen by the user's devices (LAN IP, not `127.0.0.1`, unless installation is for local use only) | auto-detected LAN IP |
| `PORT` | Web interface port | `8266` |
| `ADMIN_USER` | Administrator login (or the user's callsign) | `admin` |
| `ADMIN_PASSWORD` | Administrator password — **must be chosen by the user** | none (do not proceed with the default for internet-exposed hosts) |
| `ALLOW_REGISTRATION` | Allow open self-registration? | `false` |

Important facts to tell the user **before** installing:
* The admin account is created **only on the very first start** (when there are zero users). Changing `ADMIN_PASSWORD` later does **not** change the password of an existing user; instead, the password can be changed in the web UI under Settings → My Account → Security & Password.
* BrandMeister credentials (callsign, DMR ID, hotspot security password) are entered later in the web UI — you do not need them for installation.

---

## 3. Install

Work from the directory that contains `docker-compose.yml`.

### 3.1 Obtain and unpack

* Linux/Synology/RPi: `tar -xzf ProxDMR-Release.tar.gz && cd ProxDMR`
* Windows: `Expand-Archive ProxDMR-Release.zip -DestinationPath <target>` then `cd <target>\ProxDMR`

Verify: `docker-compose.yml`, `Dockerfile`, `.env.example`, `src/` exist.

### 3.2 Create `.env` (preferred non-interactive path)

Do **not** run the interactive `setup.*` scripts unless the user asks — they prompt for input. Write `.env` yourself:

```ini
HOST_IP=<value>
PORT=<value>
DMR_PORT=62031
USE_SSL=true
ADMIN_USER=<value>
ADMIN_PASSWORD=<value>
ALLOW_REGISTRATION=<true|false>
```

Start from `.env.example` (`cp .env.example .env`) and replace values. Keep `USE_SSL=true` (the browser microphone requires HTTPS).
`.env` must use LF line endings on Linux/Synology.

### 3.3 Build and start

```bash
docker compose up -d --build
```

(Fallback: `docker-compose up -d --build`.)
The first build is **long** (compiles the AMBE+2 vocoder, downloads Python packages; roughly 10–30 minutes and several GB). Do not interrupt it. Run it in the background and poll `docker compose ps` / `docker compose logs --tail 50`.

---

## 4. Verify (all must pass)

1. **Container running:** `docker compose ps` → service `proxdmr` state `running`.
2. **No crash loop:** `docker compose logs --tail 100` has no repeated tracebacks; look for `[BOOT] Starting HTTPS/WSS on port ...`.
3. **HTTP check** (self-signed cert → ignore verification):
   * Linux/macOS: `curl -k -s -o /dev/null -w "%{http_code}" https://<HOST_IP>:<PORT>/` → `200`
   * Windows: `curl.exe -k -s -o NUL -w "%{http_code}" https://<HOST_IP>:<PORT>/`
4. **APK endpoint:** `curl -k -s https://<HOST_IP>:<PORT>/api/apk/version` → JSON containing `"exists": true`.
5. **Files created by first start:** `config/cert.pem`, `config/key.pem`, `config/jwt_secret.key`, `config/proxdmr.db` exist.
6. **Login works:** `POST /api/auth/login` with the admin credentials returns success (only if the user agrees to you handling the password; otherwise ask the user to log in themselves in the browser).

Report which checks passed.

---

## 5. Hand over to the user

Tell the user (mask the password):

* Web UI: `https://<HOST_IP>:<PORT>` — the browser will warn about the self-signed certificate; this is expected → *Advanced → Proceed*.
* Login: `<ADMIN_USER>` / `********`.
* **Next steps for the user:** open hotspot settings and enter callsign, DMR ID, BrandMeister hotspot security password, BM master host (default `2322.master.brandmeister.network`). The RadioID database downloads automatically in the background.
* **Piper TTS voices are not bundled.** Voices are downloaded on demand from the TTS settings (internet required, ~60–70 MB each).
* **Android app:** download from `https://<HOST_IP>:<PORT>/download/apk`, allow installation from unknown sources, on first launch enter server address and port. The app remembers them afterwards.
* Remind: keep `ALLOW_REGISTRATION=false` for internet-reachable servers; prefer a VPN (Tailscale/WireGuard) over exposing port 8266.
* Remind the user to back up `config/`, `data/` and `.env`.

If the server must be reachable from other devices, tell the user which ports to open/forward: **8266/TCP** and **62031/UDP**. Do not change firewall or router settings yourself without explicit approval.

---

## 6. Troubleshooting (apply only the matching row)

| Symptom | Cause | Action |
|---|---|---|
| `port is already allocated` / bind error | 8266 or 62031 busy | Ask the user; change `PORT`/`DMR_PORT` in `.env`; `docker compose up -d` |
| Build fails with network/DNS errors | no internet / proxy | Verify connectivity; retry; ask about proxy |
| Build killed / out-of-memory | low RAM on host | Close other workloads; ensure Docker has ≥ 2 GB RAM; retry |
| Container restarts repeatedly | runtime error | Read `docker compose logs --tail 200`, report the first traceback to the user; do **not** edit source files |
| Cert issued for wrong IP (address changed) | stale cert | With user consent: edit `HOST_IP`, delete `config/cert.pem` and `config/key.pem`, `docker compose up -d --force-recreate` |
| Cannot log in | wrong password / admin already existed | Admin is created only at first start. Recovery (destructive — **ask first**): `docker compose down`, delete `config/proxdmr.db`, fix `.env`, `docker compose up -d` |
| No BrandMeister connection | wrong credentials or UDP blocked | Re-check callsign/DMR ID/password in UI; check UDP 62031 firewall/NAT |
| `docker` not found on Windows | PATH | Use `C:\Program Files\Docker\Docker\resources\bin\docker.exe`; ensure Docker Desktop is running |

---

## 7. Update of an existing installation

Detect an existing install: `config/proxdmr.db` or `.env` already present.

1. Tell the user it is an update and that data will be preserved. Ask for confirmation.
2. **Back up first:** copy `config/`, `data/`, `.env` to a timestamped folder outside the install dir.
3. `docker compose down`
4. Extract the new archive over the install directory. The archive does **not** contain `.env`, `config/proxdmr.db`, keys, certificates, recordings, voices — they are not overwritten. Only templates are replaced (`config/default_settings.json`, `data/piper_voices.json`); if the user customised `config/default_settings.json`, keep a copy and restore it.
5. `docker compose up -d --build`
6. Re-run the checks from section 4. The database schema is migrated automatically at startup.
7. Tell the user the Android app is updated separately (new APK at `/download/apk`).

---

## 8. Uninstall (only on explicit request)

`docker compose down`, then — **only after explicit confirmation and an offered backup** — delete the install directory. This destroys `config/` and `data/`.

---

## 9. Final report format

Produce a short text report:

```
ProxDMR installation report
- Host: <HOST_IP>:<PORT>   Architecture: <arch>   Docker: <version>
- Mode: fresh install | update
- Checks: container running [OK/FAIL] · HTTPS 200 [OK/FAIL] · APK endpoint [OK/FAIL] · first-start files [OK/FAIL]
- Admin login: <ADMIN_USER> / ********
- Registration: open | closed
- Open items for the user: hotspot credentials, firewall/port forwarding, Android app, backups
```

Never include real secrets in the report.
