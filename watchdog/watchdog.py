# -*- coding: utf-8 -*-
"""
watchdog.py — независимый монитор ProxDMR и отправщик Telegram-алертов.
Работает в отдельном изолированном контейнере python:3.11-alpine (64MB RAM limit).
Только стандартная библиотека Python: urllib.request, ssl, json, time, os, signal.
"""
import copy
import json
import logging
import os
import signal
import socket
import ssl
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [WATCHDOG] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("watchdog")

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
PROXDMR_HOST = os.environ.get("PROXDMR_HOST", "proxdmr")
PROXDMR_PORT = int(os.environ.get("PROXDMR_PORT", "8266"))
SERVER_LABEL = os.environ.get("SERVER_LABEL") or socket.gethostname()
WATCHDOG_VERSION = "1.0"

TICK_SEC = 5
STATUS_INTERVAL_SEC = 15
HTTP_CHECK_INTERVAL_SEC = 30

COOLDOWNS = {
    "offline": 1800,
    "restart": 600,
    "oom": 600,
    "hang": 1800,
    "cmem_high": 1800,
    "leak_suspected": 3600,
    "host_ram_high": 1800,
    "host_swap_high": 1800,
    "host_disk_high": 3600,
}

CRITICAL_EVENTS = {"offline", "oom", "hang"}

MESSAGES = {
    "ru": {
        "test_title": "🧪 Тестовое оповещение",
        "test_body": "Служба Watchdog и интеграция с Telegram работают в штатном режиме.",
        "offline_title": "🔴 ProxDMR недоступен (Offline)",
        "offline_body": "Контейнер ProxDMR не отвечает на запросы и не обновляет пульс более {sec} сек.",
        "restart_title": "🔄 Перезапуск ProxDMR",
        "restart_body": "Зафиксирован перезапуск процесса ProxDMR (новый запуск: {started_at}).",
        "oom_title": "💥 Аварийное падение ProxDMR (OOM)",
        "oom_body": "Процесс ProxDMR упал или был принудительно завершён из-за нехватки памяти (достигнут лимит {limit} МБ).",
        "hang_title": "⏳ Зависание ProxDMR (Event Loop Hang)",
        "hang_body": "HTTP API не отвечает более {sec} сек, хотя фоновый процесс активен. Вероятно зависание event loop.",
        "cmem_title": "⚠️ Высокое потребление памяти контейнером",
        "cmem_body": "Потребление памяти ProxDMR достигло {rss} МБ ({pct}% от лимита {limit} МБ).",
        "leak_title": "📈 Подозрение на утечку памяти",
        "leak_body": "Монотонный рост RSS за последний час: +{growth} МБ. Текущее значение: {rss} МБ.",
        "host_ram_title": "🖥 Высокая нагрузка на RAM хоста",
        "host_ram_body": "Использование оперативной памяти сервера достигло {pct}% ({used} МБ из {total} МБ).",
        "host_swap_title": "💾 Высокое использование Swap хоста",
        "host_swap_body": "Использование файла подкачки достигло {pct}% ({used} МБ из {total} МБ).",
        "host_disk_title": "💽 Заполнение диска хоста",
        "host_disk_body": "Дисковое пространство раздела данных заполнено на {pct}% (осталось {free_gb} ГБ).",
    },
    "en": {
        "test_title": "🧪 Test Notification",
        "test_body": "Watchdog service and Telegram integration are operational.",
        "offline_title": "🔴 ProxDMR Offline",
        "offline_body": "ProxDMR container is not responding and heartbeat has not updated for {sec}s.",
        "restart_title": "🔄 ProxDMR Restarted",
        "restart_body": "ProxDMR process restart detected (new start: {started_at}).",
        "oom_title": "💥 ProxDMR OOM Crash",
        "oom_body": "ProxDMR process crashed or was killed due to out of memory (limit {limit} MB).",
        "hang_title": "⏳ ProxDMR Event Loop Hang",
        "hang_body": "HTTP API is unresponsive for >{sec}s while heartbeat is active. Event loop may be blocked.",
        "cmem_title": "⚠️ High Container Memory Usage",
        "cmem_body": "ProxDMR memory usage reached {rss} MB ({pct}% of {limit} MB limit).",
        "leak_title": "📈 Suspected Memory Leak",
        "leak_body": "Monotonic RSS growth over last hour: +{growth} MB. Current: {rss} MB.",
        "host_ram_title": "🖥 High Host RAM Usage",
        "host_ram_body": "Host RAM usage reached {pct}% ({used} MB of {total} MB).",
        "host_swap_title": "💾 High Host Swap Usage",
        "host_swap_body": "Host Swap usage reached {pct}% ({used} MB of {total} MB).",
        "host_disk_title": "💽 High Host Disk Usage",
        "host_disk_body": "Data partition disk usage reached {pct}% ({free_gb} GB free).",
    },
    "uk": {
        "test_title": "🧪 Тестове сповіщення",
        "test_body": "Служба Watchdog та інтеграція з Telegram працюють у штатному режимі.",
        "offline_title": "🔴 ProxDMR недоступний (Offline)",
        "offline_body": "Контейнер ProxDMR не відповідає та не оновлює пульс понад {sec} сек.",
        "restart_title": "🔄 Перезапуск ProxDMR",
        "restart_body": "Зафіксовано перезапуск процесу ProxDMR (новий запуск: {started_at}).",
        "oom_title": "💥 Аварійне падіння ProxDMR (OOM)",
        "oom_body": "Процес ProxDMR впав або був зупинений через брак пам'яті (досягнуто ліміт {limit} МБ).",
        "hang_title": "⏳ Зависання ProxDMR (Event Loop Hang)",
        "hang_body": "HTTP API не відповідає понад {sec} сек при активному пульсі. Можливе зависання event loop.",
        "cmem_title": "⚠️ Високе споживання пам'яті контейнером",
        "cmem_body": "Споживання пам'яті ProxDMR досягло {rss} МБ ({pct}% від ліміту {limit} МБ).",
        "leak_title": "📈 Підозра на витік пам'яті",
        "leak_body": "Монотонне зростання RSS за останню годину: +{growth} МБ. Поточне: {rss} МБ.",
        "host_ram_title": "🖥 Високе навантаження на RAM хоста",
        "host_ram_body": "Використання оперативної пам'яті сервера досягло {pct}% ({used} МБ з {total} МБ).",
        "host_swap_title": "💾 Високе використання Swap хоста",
        "host_swap_body": "Використання файлу підкачки досягло {pct}% ({used} МБ з {total} МБ).",
        "host_disk_title": "💽 Заповнення диску хоста",
        "host_disk_body": "Дисковий простір розділу даних заповнено на {pct}% (залишилося {free_gb} ГБ).",
    },
    "de": {
        "test_title": "🧪 Testbenachrichtigung",
        "test_body": "Watchdog-Dienst und Telegram-Integration funktionieren ordnungsgemäß.",
        "offline_title": "🔴 ProxDMR Offline",
        "offline_body": "ProxDMR antwortet nicht und Heartbeat wurde seit {sec}s nicht aktualisiert.",
        "restart_title": "🔄 ProxDMR Neustart",
        "restart_body": "ProxDMR-Prozessneustart erkannt (neuer Start: {started_at}).",
        "oom_title": "💥 ProxDMR OOM-Absturz",
        "oom_body": "ProxDMR ist wegen Speichermangels abgestürzt (Limit {limit} MB erreicht).",
        "hang_title": "⏳ ProxDMR Event Loop blockiert",
        "hang_body": "HTTP API antwortet seit >{sec}s nicht. Mögliches Einfrieren der Event Loop.",
        "cmem_title": "⚠️ Hoher Speicherverbrauch des Containers",
        "cmem_body": "ProxDMR-Speicherverbrauch hat {rss} MB erreicht ({pct}% von {limit} MB).",
        "leak_title": "📈 Verdacht auf Speicherleck",
        "leak_body": "RSS-Wachstum der letzten Stunde: +{growth} MB. Aktuell: {rss} MB.",
        "host_ram_title": "🖥 Hohe Host-RAM-Auslastung",
        "host_ram_body": "Host-RAM-Auslastung hat {pct}% erreicht ({used} MB von {total} MB).",
        "host_swap_title": "💾 Hohe Host-Swap-Auslastung",
        "host_swap_body": "Host-Swap-Auslastung hat {pct}% erreicht ({used} MB von {total} MB).",
        "host_disk_title": "💽 Hohe Festplattenbelegung",
        "host_disk_body": "Datenpartition ist zu {pct}% voll ({free_gb} GB frei).",
    },
    "es": {
        "test_title": "🧪 Notificación de prueba",
        "test_body": "El servicio Watchdog y la integración con Telegram funcionan correctamente.",
        "offline_title": "🔴 ProxDMR Desconectado (Offline)",
        "offline_body": "El contenedor ProxDMR no responde y no actualiza heartbeat desde hace {sec} s.",
        "restart_title": "🔄 Reinicio de ProxDMR",
        "restart_body": "Reinicio del proceso ProxDMR detectado (inicio: {started_at}).",
        "oom_title": "💥 Caída de ProxDMR por OOM",
        "oom_body": "ProxDMR se detuvo por falta de memoria (límite de {limit} MB alcanzado).",
        "hang_title": "⏳ Bloqueo del Event Loop de ProxDMR",
        "hang_body": "La API HTTP no responde desde hace >{sec} s. Posible bloqueo del bucle de eventos.",
        "cmem_title": "⚠️ Alto consumo de memoria del contenedor",
        "cmem_body": "El consumo de ProxDMR alcanzó {rss} MB ({pct}% del límite de {limit} MB).",
        "leak_title": "📈 Sospecha de fuga de memoria",
        "leak_body": "Crecimiento monótono de RSS en la última hora: +{growth} MB. Actual: {rss} MB.",
        "host_ram_title": "🖥 Alto uso de RAM del host",
        "host_ram_body": "El uso de RAM del servidor alcanzó {pct}% ({used} MB de {total} MB).",
        "host_swap_title": "💾 Alto uso de Swap del host",
        "host_swap_body": "El uso de Swap alcanzó {pct}% ({used} MB de {total} MB).",
        "host_disk_title": "💽 Disco del host casi lleno",
        "host_disk_body": "La partición de datos está al {pct}% ({free_gb} GB libres).",
    },
    "fr": {
        "test_title": "🧪 Notification de test",
        "test_body": "Le service Watchdog et l'intégration Telegram fonctionnent correctement.",
        "offline_title": "🔴 ProxDMR Hors Ligne (Offline)",
        "offline_body": "Le conteneur ProxDMR ne répond pas et le heartbeat est inactif depuis {sec} s.",
        "restart_title": "🔄 Redémarrage de ProxDMR",
        "restart_body": "Redémarrage de ProxDMR détecté (nouveau démarrage: {started_at}).",
        "oom_title": "💥 Crash ProxDMR OOM",
        "oom_body": "ProxDMR a crashé en raison d'un manque de mémoire (limite {limit} Mo atteinte).",
        "hang_title": "⏳ Blocage de l'Event Loop ProxDMR",
        "hang_body": "L'API HTTP ne répond plus depuis >{sec} s. Possible blocage de l'event loop.",
        "cmem_title": "⚠️ Utilisation élevée de mémoire du conteneur",
        "cmem_body": "La mémoire de ProxDMR a atteint {rss} Mo ({pct}% de la limite {limit} Mo).",
        "leak_title": "📈 Suspicion de fuite de mémoire",
        "leak_body": "Croissance de RSS sur la dernière heure: +{growth} Mo. Actuel: {rss} Mo.",
        "host_ram_title": "🖥 Utilisation élevée de la RAM hôte",
        "host_ram_body": "La RAM de l'hôte a atteint {pct}% ({used} Mo sur {total} Mo).",
        "host_swap_title": "💾 Utilisation élevée du Swap hôte",
        "host_swap_body": "Le Swap de l'hôte a atteint {pct}% ({used} Mo sur {total} Mo).",
        "host_disk_title": "💽 Disque hôte presque plein",
        "host_disk_body": "La partition de données est occupée à {pct}% ({free_gb} Go libres).",
    },
    "it": {
        "test_title": "🧪 Notifica di prova",
        "test_body": "Il servizio Watchdog e l'integrazione con Telegram funzionano normalmente.",
        "offline_title": "🔴 ProxDMR Non Raggiungibile (Offline)",
        "offline_body": "Il container ProxDMR non risponde e l'heartbeat è fermo da {sec} s.",
        "restart_title": "🔄 Riavvio di ProxDMR",
        "restart_body": "Rilevato riavvio del processo ProxDMR (avviato alle: {started_at}).",
        "oom_title": "💥 Crash di ProxDMR per OOM",
        "oom_body": "ProxDMR è terminato per esaurimento memoria (limite di {limit} MB raggiunto).",
        "hang_title": "⏳ Blocco Event Loop ProxDMR",
        "hang_body": "L'API HTTP non risponde da oltre {sec} s. Possibile blocco dell'event loop.",
        "cmem_title": "⚠️ Elevato consumo di memoria del container",
        "cmem_body": "La memoria di ProxDMR ha raggiunto {rss} MB ({pct}% del limite {limit} MB).",
        "leak_title": "📈 Sospetta perdita di memoria",
        "leak_body": "Crescita di RSS nell'ultima ora: +{growth} MB. Attuale: {rss} MB.",
        "host_ram_title": "🖥 Elevato utilizzo RAM dell'host",
        "host_ram_body": "L'utilizzo della RAM dell'host ha raggiunto {pct}% ({used} MB su {total} MB).",
        "host_swap_title": "💾 Elevato utilizzo Swap dell'host",
        "host_swap_body": "L'utilizzo dello Swap dell'host ha raggiunto {pct}% ({used} MB su {total} MB).",
        "host_disk_title": "💽 Spazio su disco quasi esaurito",
        "host_disk_body": "La partizione dati è piena al {pct}% ({free_gb} GB liberi).",
    },
}


class Watchdog:
    def __init__(self):
        self.start_ts = time.time()
        self.running = True
        self.alerts_sent_total = 0
        self.last_alert_ts = 0.0
        self.last_test_result: Optional[Dict[str, Any]] = None
        self.last_http_ok_ts = 0.0
        self.last_started_at: Optional[str] = None
        self.last_rss_mb = 0.0
        self.last_limit_mb = 0.0
        self.proxdmr_state = "online"
        self.cooldowns: Dict[str, float] = {}
        self.alert_history: List[float] = []

        self.last_cfg_mtime = 0.0
        self.cfg: Dict[str, Any] = {}
        self.ssl_ctx = ssl._create_unverified_context()

    def load_config(self) -> None:
        cfg_file = DATA_DIR / "alerts.json"
        if not cfg_file.is_file():
            self.cfg = {"enabled": False}
            return
        try:
            mtime = cfg_file.stat().st_mtime
            if mtime != self.last_cfg_mtime:
                self.last_cfg_mtime = mtime
                with open(cfg_file, "r", encoding="utf-8") as f:
                    self.cfg = json.load(f)
                logger.info("Loaded alerts config (enabled=%s, lang=%s)",
                            self.cfg.get("enabled"), self.cfg.get("language"))
        except Exception as e:
            logger.warning(f"Error reading alerts.json: {e}")

    def write_status(self) -> None:
        payload = {
            "ts": int(time.time()),
            "status": "online",
            "version": WATCHDOG_VERSION,
            "uptime_sec": int(time.time() - self.start_ts),
            "last_check_proxdmr": int(self.last_http_ok_ts),
            "proxdmr_state": self.proxdmr_state,
            "alerts_sent_total": self.alerts_sent_total,
            "last_alert_ts": int(self.last_alert_ts),
            "last_test": self.last_test_result,
        }
        tmp_file = DATA_DIR / "watchdog_status.json.tmp"
        final_file = DATA_DIR / "watchdog_status.json"
        try:
            with open(tmp_file, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, indent=2)
                f.flush()
                os.fsync(f.fileno())
            try:
                os.chmod(tmp_file, 0o644)
            except Exception:
                pass
            os.replace(tmp_file, final_file)
            try:
                os.chmod(final_file, 0o644)
            except Exception:
                pass
        except Exception as e:
            logger.warning(f"Failed to write watchdog_status.json: {e}")

    def is_in_silence_hours(self) -> bool:
        sh = self.cfg.get("silence_hours") or {}
        if not sh.get("enabled"):
            return False
        try:
            start_s = sh.get("start", "23:00")
            end_s = sh.get("end", "07:00")
            sh_start = datetime.strptime(start_s, "%H:%M").time()
            sh_end = datetime.strptime(end_s, "%H:%M").time()
            now_time = datetime.now(timezone.utc).time()
            if sh_start <= sh_end:
                return sh_start <= now_time <= sh_end
            else:
                return now_time >= sh_start or now_time <= sh_end
        except Exception as e:
            logger.debug(f"Silence hour check error: {e}")
            return False

    def can_send_alert(self, event_type: str) -> bool:
        if not self.cfg.get("enabled"):
            return False
        token = str(self.cfg.get("bot_token", "") or "").strip()
        chat_id = str(self.cfg.get("chat_id", "") or "").strip()
        if not token or not chat_id:
            return False

        notify_on = self.cfg.get("notify_on") or {}
        if not notify_on.get(event_type, True):
            return False

        now = time.time()
        # Cooldown check
        cd = COOLDOWNS.get(event_type, 600)
        if now - self.cooldowns.get(event_type, 0.0) < cd:
            return False

        # Silence hours check
        if self.is_in_silence_hours():
            allow_crit = bool(self.cfg.get("silence_hours", {}).get("allow_critical", True))
            if not (allow_crit and event_type in CRITICAL_EVENTS):
                return False

        # Rate limit check (sliding 1-hour window)
        rate_limit = int(self.cfg.get("rate_limit_per_hour", 10))
        one_hour_ago = now - 3600
        self.alert_history = [t for t in self.alert_history if t > one_hour_ago]
        if len(self.alert_history) >= rate_limit:
            if event_type not in CRITICAL_EVENTS:
                return False

        return True

    def get_server_header(self) -> Tuple[str, str]:
        is_demo = str(os.environ.get("DEMO_MODE", "")).strip().lower() in ("1", "true", "yes", "on") or "demo" in SERVER_LABEL.lower()
        default_icon = "🟧" if is_demo else "🟦"
        raw_icon = self.cfg.get("server_icon")
        icon = default_icon if raw_icon is None else str(raw_icon).strip()[:16]
        label = str(self.cfg.get("server_label") or "").strip()[:64] or SERVER_LABEL
        prefix = f"{icon} [{label}]" if icon else f"[{label}]"
        return prefix, label

    def send_telegram(self, html_text: str) -> Tuple[bool, str]:
        token = str(self.cfg.get("bot_token", "") or "").strip()
        chat_id = str(self.cfg.get("chat_id", "") or "").strip()
        if not token or not chat_id:
            return False, "Bot token or chat ID is empty"

        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload: Dict[str, Any] = {
            "chat_id": chat_id,
            "text": html_text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        thread_id = self.cfg.get("thread_id")
        if thread_id not in (None, "", 0):
            try:
                tid = int(thread_id)
                if tid > 0:
                    payload["message_thread_id"] = tid
            except (ValueError, TypeError):
                pass

        body = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": f"ProxDMR-Watchdog/{WATCHDOG_VERSION}",
            },
            method="POST",
        )
        try:
            ctx = ssl.create_default_context()
            with urllib.request.urlopen(req, timeout=10, context=ctx) as resp:
                resp_data = json.loads(resp.read().decode("utf-8"))
                if resp_data.get("ok"):
                    self.alerts_sent_total += 1
                    self.last_alert_ts = time.time()
                    self.alert_history.append(self.last_alert_ts)
                    return True, ""
                return False, str(resp_data.get("description", "Unknown Telegram error"))
        except urllib.error.HTTPError as e:
            err_msg = e.read().decode("utf-8", errors="ignore")
            try:
                err_json = json.loads(err_msg)
                return False, f"HTTP {e.code}: {err_json.get('description', err_msg)}"
            except Exception:
                return False, f"HTTP {e.code}: {err_msg}"
        except Exception as e:
            return False, str(e)

    def format_and_send(self, event_type: str, **kwargs) -> bool:
        if not self.can_send_alert(event_type):
            return False

        prefix_map = {
            "cmem_high": "cmem",
            "leak_suspected": "leak",
            "host_ram_high": "host_ram",
            "host_swap_high": "host_swap",
            "host_disk_high": "host_disk",
        }
        msg_prefix = prefix_map.get(event_type, event_type)

        lang = str(self.cfg.get("language", "ru") or "ru").lower()
        lang_dict = MESSAGES.get(lang) or MESSAGES["ru"]
        title_tmpl = (
            lang_dict.get(f"{msg_prefix}_title")
            or lang_dict.get(f"{event_type}_title")
            or MESSAGES["en"].get(f"{msg_prefix}_title")
            or MESSAGES["en"].get(f"{event_type}_title", "Alert")
        )
        body_tmpl = (
            lang_dict.get(f"{msg_prefix}_body")
            or lang_dict.get(f"{event_type}_body")
            or MESSAGES["en"].get(f"{msg_prefix}_body")
            or MESSAGES["en"].get(f"{event_type}_body", "")
        )

        try:
            body_text = body_tmpl.format(**kwargs)
        except Exception:
            body_text = body_tmpl

        utc_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        srv_prefix, _ = self.get_server_header()
        message = (
            f"<b>{srv_prefix} {title_tmpl}</b>\n\n"
            f"{body_text}\n\n"
            f"<i>⏱ {utc_time}</i>"
        )

        ok, err = self.send_telegram(message)
        if ok:
            logger.info(f"Alert '{event_type}' sent successfully")
            self.cooldowns[event_type] = time.time()
            return True
        else:
            logger.warning(f"Failed to send alert '{event_type}': {err}")
            return False

    def handle_command(self) -> None:
        cmd_file = DATA_DIR / "watchdog_cmd.json"
        if not cmd_file.is_file():
            return
        try:
            text = cmd_file.read_text(encoding="utf-8")
        except Exception:
            text = ""
        try:
            cmd_file.unlink()
        except Exception:
            pass

        if not text.strip():
            return

        try:
            cmd_data = json.loads(text)
            if not isinstance(cmd_data, dict):
                return

            if cmd_data.get("cmd") == "test_alert":
                test_id = cmd_data.get("id", "test")
                logger.info(f"Processing test alert command (id={test_id})")
                self.load_config()

                lang = str(self.cfg.get("language", "ru") or "ru").lower()
                lang_dict = MESSAGES.get(lang) or MESSAGES["ru"]
                title = lang_dict["test_title"]
                body = lang_dict["test_body"]
                utc_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")

                srv_prefix, effective_label = self.get_server_header()
                msg = (
                    f"<b>{srv_prefix} {title}</b>\n\n"
                    f"{body}\n\n"
                    f"• Watchdog: <code>v{WATCHDOG_VERSION}</code>\n"
                    f"• Host: <code>{effective_label}</code>\n"
                    f"• Mode: <code>Watchdog Container</code>\n\n"
                    f"<i>⏱ {utc_time}</i>"
                )
                ok, err = self.send_telegram(msg)
                self.last_test_result = {
                    "id": test_id,
                    "ok": ok,
                    "error": err,
                    "ts": int(time.time()),
                }
                self.write_status()
        except Exception as e:
            logger.warning(f"Error handling watchdog_cmd.json: {e}")

    def query_http_health(self) -> Tuple[bool, Optional[Dict[str, Any]]]:
        url = f"https://{PROXDMR_HOST}:{PROXDMR_PORT}/api/health"
        req = urllib.request.Request(url, headers={"User-Agent": "ProxDMR-Watchdog/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=5, context=self.ssl_ctx) as resp:
                if resp.status == 200:
                    data = json.loads(resp.read().decode("utf-8"))
                    return True, data
        except Exception as e:
            logger.debug(f"HTTP health query failed: {e}")
        return False, None

    def read_host_metrics(self) -> Dict[str, float]:
        metrics = {
            "ram_pct": 0.0,
            "ram_used_mb": 0.0,
            "ram_total_mb": 0.0,
            "swap_pct": 0.0,
            "swap_used_mb": 0.0,
            "swap_total_mb": 0.0,
            "disk_pct": 0.0,
            "disk_free_gb": 0.0,
        }
        # /proc/meminfo
        try:
            mem = {}
            with open("/proc/meminfo", "r", encoding="ascii") as f:
                for line in f:
                    parts = line.split(":")
                    if len(parts) == 2:
                        k = parts[0].strip()
                        v = int(parts[1].split()[0])  # kB
                        mem[k] = v
            total = mem.get("MemTotal", 0) / 1024.0
            avail = mem.get("MemAvailable", mem.get("MemFree", 0)) / 1024.0
            used = total - avail
            if total > 0:
                metrics["ram_total_mb"] = round(total, 1)
                metrics["ram_used_mb"] = round(used, 1)
                metrics["ram_pct"] = round((used / total) * 100.0, 1)

            sw_total = mem.get("SwapTotal", 0) / 1024.0
            sw_free = mem.get("SwapFree", 0) / 1024.0
            sw_used = sw_total - sw_free
            if sw_total > 0:
                metrics["swap_total_mb"] = round(sw_total, 1)
                metrics["swap_used_mb"] = round(sw_used, 1)
                metrics["swap_pct"] = round((sw_used / sw_total) * 100.0, 1)
        except Exception as e:
            logger.debug(f"Host meminfo read error: {e}")

        # statvfs /data
        try:
            st = os.statvfs(str(DATA_DIR))
            total_b = st.f_blocks * st.f_frsize
            free_b = st.f_bavail * st.f_frsize
            used_b = total_b - free_b
            if total_b > 0:
                metrics["disk_pct"] = round((used_b / total_b) * 100.0, 1)
                metrics["disk_free_gb"] = round(free_b / (1024 * 1024 * 1024.0), 1)
        except Exception as e:
            logger.debug(f"Host statvfs read error: {e}")

        return metrics

    def run_check_cycle(self, check_http: bool) -> None:
        now = time.time()
        hb_file = DATA_DIR / "proxdmr_heartbeat.json"
        hb_data: Dict[str, Any] = {}
        hb_fresh = False

        if hb_file.is_file():
            try:
                mtime = hb_file.stat().st_mtime
                if now - mtime <= 45:
                    hb_fresh = True
                with open(hb_file, "r", encoding="utf-8") as f:
                    hb_data = json.load(f)
            except Exception as e:
                logger.debug(f"Error reading heartbeat: {e}")

        thresholds = self.cfg.get("thresholds") or {}
        hang_timeout = int(thresholds.get("hang_timeout_sec", 60))

        http_ok = False
        health_data = None
        if check_http:
            http_ok, health_data = self.query_http_health()
            if http_ok:
                self.last_http_ok_ts = now
                curr_started_at = health_data.get("started_at") if health_data else None

                # Restart check
                if curr_started_at and self.last_started_at:
                    if curr_started_at != self.last_started_at:
                        logger.warning(f"ProxDMR restarted! Old: {self.last_started_at}, New: {curr_started_at}")
                        # Check if crash was OOM
                        if self.last_limit_mb > 0 and (self.last_rss_mb / self.last_limit_mb) >= 0.95:
                            self.format_and_send("oom", limit=self.last_limit_mb)
                        else:
                            self.format_and_send("restart", started_at=curr_started_at)
                if curr_started_at:
                    self.last_started_at = curr_started_at

        # Determine ProxDMR state
        rss = hb_data.get("rss_mb", 0.0)
        limit = hb_data.get("limit_mb", 0.0)
        if rss > 0:
            self.last_rss_mb = rss
        if limit > 0:
            self.last_limit_mb = limit

        http_unresponsive = (self.last_http_ok_ts > 0 and (now - self.last_http_ok_ts > hang_timeout))
        if not hb_fresh and (http_unresponsive or self.last_http_ok_ts == 0):
            # OFFLINE
            self.proxdmr_state = "offline"
            sec_offline = int(now - max(self.last_http_ok_ts, hb_file.stat().st_mtime if hb_file.is_file() else now))
            self.format_and_send("offline", sec=max(sec_offline, 60))
        elif hb_fresh and http_unresponsive:
            # HANG: Heartbeat is alive but HTTP API is dead > hang_timeout
            self.proxdmr_state = "hang"
            self.format_and_send("hang", sec=hang_timeout)
        else:
            self.proxdmr_state = "online"

        # Container memory alerts
        if hb_fresh and rss > 0 and limit > 0:
            cmem_pct = (rss / limit) * 100.0
            cmem_thresh = float(thresholds.get("cmem_percent", 85))
            if cmem_pct >= cmem_thresh:
                self.format_and_send("cmem_high", rss=rss, pct=round(cmem_pct, 1), limit=limit)

        if hb_fresh and hb_data.get("leak_suspected"):
            growth = hb_data.get("leak_growth_mb", 0.0)
            self.format_and_send("leak_suspected", growth=growth, rss=rss)

        # Host resource metrics
        h_metrics = self.read_host_metrics()
        ram_thresh = float(thresholds.get("host_ram_percent", 90))
        if h_metrics["ram_pct"] >= ram_thresh:
            self.format_and_send(
                "host_ram_high",
                pct=h_metrics["ram_pct"],
                used=h_metrics["ram_used_mb"],
                total=h_metrics["ram_total_mb"],
            )

        swap_thresh = float(thresholds.get("host_swap_percent", 50))
        if h_metrics["swap_pct"] >= swap_thresh:
            self.format_and_send(
                "host_swap_high",
                pct=h_metrics["swap_pct"],
                used=h_metrics["swap_used_mb"],
                total=h_metrics["swap_total_mb"],
            )

        disk_thresh = float(thresholds.get("host_disk_percent", 90))
        if h_metrics["disk_pct"] >= disk_thresh:
            self.format_and_send(
                "host_disk_high",
                pct=h_metrics["disk_pct"],
                free_gb=h_metrics["disk_free_gb"],
            )

    def run(self) -> None:
        logger.info(f"Starting ProxDMR Watchdog v{WATCHDOG_VERSION} for server '{SERVER_LABEL}'")
        logger.info(f"Data dir: {DATA_DIR}, Target: https://{PROXDMR_HOST}:{PROXDMR_PORT}")

        last_status_write = 0.0
        last_http_check = 0.0

        # Wait initial 5s for network/services to stabilize
        time.sleep(2)

        while self.running:
            try:
                now = time.time()
                self.load_config()
                self.handle_command()

                do_http = (now - last_http_check >= HTTP_CHECK_INTERVAL_SEC)
                if do_http:
                    last_http_check = now

                self.run_check_cycle(check_http=do_http)

                if now - last_status_write >= STATUS_INTERVAL_SEC:
                    self.write_status()
                    last_status_write = now

            except Exception as e:
                logger.error(f"Error in watchdog tick: {e}", exc_info=True)

            time.sleep(TICK_SEC)

    def stop(self, signum=None, frame=None) -> None:
        logger.info("Watchdog shutting down...")
        self.running = False


if __name__ == "__main__":
    wd = Watchdog()
    signal.signal(signal.SIGTERM, wd.stop)
    signal.signal(signal.SIGINT, wd.stop)
    wd.run()
