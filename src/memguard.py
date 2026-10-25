# -*- coding: utf-8 -*-
"""
memguard.py — лёгкий самоконтроль памяти процесса ProxDMR и запись heartbeat.
Без внешних зависимостей: RSS читается из /proc/self/status (Linux).
"""
import asyncio
import json
import logging
import os
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Deque, Optional, Tuple, List, Dict, Any

logger = logging.getLogger("proxdmr.memguard")

SAMPLE_INTERVAL_SEC = 300          # замер раз в 5 минут
HEARTBEAT_INTERVAL_SEC = 30        # запись heartbeat каждые 30 секунд
HISTORY_LEN = 288                  # 24 часа истории (288 × 5 мин)
WARN_RSS_MB = 1500.0               # абсолютный порог предупреждения
GROWTH_WINDOW = 12                 # окно тренда: 12 замеров = 1 час
GROWTH_WARN_MB = 1200.0            # Trend window threshold in MB (adjusted for on-demand AI/PyTorch ~1GB)

_start_ts = time.time()
_started_at_iso = datetime.now(timezone.utc).isoformat()
_samples: Deque[Tuple[float, float]] = deque(maxlen=HISTORY_LEN)
_warnings: Deque[Dict[str, Any]] = deque(maxlen=20)
_task: Optional[asyncio.Task] = None
_data_dir: Optional[Path] = None


def get_default_data_dir() -> Path:
    p_src = Path(__file__).resolve().parent / "data"
    if (p_src / "ping_history.json").exists():
        return p_src
    p_parent = Path(__file__).resolve().parent.parent / "data"
    if (p_parent / "ping_history.json").exists():
        return p_parent
    p_src.mkdir(parents=True, exist_ok=True)
    return p_src


def started_at_iso() -> str:
    return _started_at_iso


def record_warning(text: str) -> None:
    _warnings.append({"ts": int(time.time()), "text": str(text)})


def get_warnings() -> List[Dict[str, Any]]:
    return list(_warnings)


def read_rss_mb() -> float:
    """Текущий RSS процесса в МБ. 0.0, если /proc недоступен."""
    try:
        with open("/proc/self/status", "r", encoding="ascii") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return round(int(line.split()[1]) / 1024.0, 1)  # kB → MB
    except Exception:
        pass
    return 0.0


def read_cgroup_limit_mb() -> float:
    """Лимит памяти контейнера (cgroup v2), 0.0 если безлимит/недоступно."""
    try:
        with open("/sys/fs/cgroup/memory.max", "r") as f:
            raw = f.read().strip()
        if raw and raw != "max":
            return round(int(raw) / (1024 * 1024), 1)
    except Exception:
        pass
    return 0.0


def uptime_sec() -> int:
    return int(time.time() - _start_ts)


def get_samples() -> list:
    return [{"ts": int(ts), "rss_mb": rss} for ts, rss in _samples]


def growth_over_window_mb() -> float:
    """Прирост RSS за последние GROWTH_WINDOW замеров (монотонный рост после 15 мин прогрева)."""
    warm_samples = [(ts, rss) for ts, rss in _samples if (ts - _start_ts) >= 900.0]
    if len(warm_samples) < GROWTH_WINDOW + 1:
        return 0.0
    window = warm_samples[-(GROWTH_WINDOW + 1):]
    values = [v for _, v in window]
    if min(values) < values[0] - 1.0:
        return 0.0
    # Проверяем, что рост действительно монотонный (не менее 8 повышений из 12 шагов)
    rising_steps = sum(1 for i in range(1, len(values)) if values[i] > values[i - 1] + 0.5)
    if rising_steps < 8:
        return 0.0
    return round(values[-1] - values[0], 1)


def write_heartbeat(data_dir: Optional[Path] = None) -> None:
    """Записывает атомарно proxdmr_heartbeat.json в data_dir."""
    target_dir = data_dir or _data_dir or get_default_data_dir()
    try:
        target_dir.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

    tasks_count = 0
    try:
        tasks_count = len(asyncio.all_tasks())
    except Exception:
        pass

    rss = read_rss_mb()
    limit = read_cgroup_limit_mb()
    growth = growth_over_window_mb()
    leak_suspected = bool(growth >= GROWTH_WARN_MB)

    payload = {
        "ts": int(time.time()),
        "uptime_sec": uptime_sec(),
        "rss_mb": rss,
        "tasks": tasks_count,
        "limit_mb": limit,
        "leak_suspected": leak_suspected,
        "leak_growth_mb": growth,
        "warnings": list(_warnings),
    }

    tmp_file = target_dir / "proxdmr_heartbeat.json.tmp"
    final_file = target_dir / "proxdmr_heartbeat.json"
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
        logger.debug(f"[MEMGUARD] Failed to write heartbeat: {e}")


def get_diag_dict() -> Dict[str, Any]:
    """Удобный хелпер для эндпоинта /api/admin/diag."""
    tasks_count = 0
    try:
        tasks_count = len(asyncio.all_tasks())
    except Exception:
        pass
    return {
        "uptime_sec": uptime_sec(),
        "started_at": started_at_iso(),
        "memory": {
            "rss_mb": read_rss_mb(),
            "container_limit_mb": read_cgroup_limit_mb(),
            "growth_last_hour_mb": growth_over_window_mb(),
            "history": get_samples(),
        },
        "asyncio_tasks": tasks_count,
        "warnings": list(_warnings),
    }


async def _loop():
    logger.info("[MEMGUARD] Started (heartbeat %ss, sample %ss, warn %s MB)",
                HEARTBEAT_INTERVAL_SEC, SAMPLE_INTERVAL_SEC, WARN_RSS_MB)
    last_sample_ts = 0.0
    while True:
        try:
            now = time.time()
            rss = read_rss_mb()

            if now - last_sample_ts >= SAMPLE_INTERVAL_SEC:
                last_sample_ts = now
                if rss > 0:
                    _samples.append((now, rss))
                    tasks = len(asyncio.all_tasks())
                    limit = read_cgroup_limit_mb()
                    logger.info(f"[MEMGUARD] RSS={rss} MB, tasks={tasks}, limit={limit or 'none'} MB")
                    if rss >= WARN_RSS_MB:
                        msg = f"RSS {rss} MB превысил порог {WARN_RSS_MB} MB"
                        logger.warning(f"[MEMGUARD] {msg}")
                        record_warning(f"[MEMGUARD] {msg}")
                    if limit and rss >= limit * 0.85:
                        msg = f"RSS {rss} MB ≥ 85% лимита контейнера {limit} MB — близко к OOM"
                        logger.warning(f"[MEMGUARD] {msg}")
                        record_warning(f"[MEMGUARD] {msg}")
                    growth = growth_over_window_mb()
                    if growth >= GROWTH_WARN_MB:
                        msg = f"Подозрение на утечку: +{growth} MB за последний час"
                        logger.warning(f"[MEMGUARD] {msg}")
                        record_warning(f"[MEMGUARD] {msg}")

            write_heartbeat()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.debug(f"[MEMGUARD] loop error: {e}")
        await asyncio.sleep(HEARTBEAT_INTERVAL_SEC)


def start(data_dir: Optional[Path] = None) -> None:
    global _task, _data_dir
    if data_dir is not None:
        _data_dir = data_dir
    else:
        _data_dir = get_default_data_dir()
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop())


def stop() -> None:
    global _task
    if _task and not _task.done():
        _task.cancel()
    _task = None
