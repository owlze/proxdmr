# Инструкция по созданию универсального установочного архива ProxDMR

> **Назначение документа**: Данное руководство предназначено для агента или разработчика, формирующего автономный, полностью обезличенный установочный архив ProxDMR для распространения и развёртывания в любых средах Docker (x86_64, ARM64, Synology NAS Container Manager, Raspberry Pi, Debian/Ubuntu/Alpine).

---

## 1. Общие требования к установочному архиву

Установочный архив должен удовлетворять пяти фундаментальным критериям:
1. **Автономность синтеза речи (Piper TTS)**: движок, специальные модули для не-романских языков и предобученные голосовые модели основных языков должны быть уже упакованы в архив, обеспечивая мгновенную работу без обращения к сети.
2. **Полная компилируемость из коробки**: встроенный C-вокодер AMBE+2 (`src/c_vocoder`) и C++ расширения (`pyopenjtalk`) должны собираться в Docker без ошибок на любой архитектуре процессора.
3. **Абсолютная безопасность и обезличенность (Zero Secrets)**: никаких реальных API-ключей (Google Gemini), паролей (BrandMeister, HamQTH, веб-паролей), персональных позывных, DMR ID, приватных ключей шифрования (JWT, SSL), истории радиовызовов и аудиозаписей.
4. **Автоматическая самоинициализация (First-Run Provisioning)**: при первом старте контейнера система должна автоматически создавать чистую SQLite-базу данных, учётную запись супер-администратора, генерировать уникальный JWT-секрет и самоподписанный SSL-сертификат.
5. **Чистота архива**: отсутствие мусорных файлов ОС (`Thumbs.db`, `.DS_Store`), логов (`*.log`, `*.txt`), временных скриптов и закэшированных бинарников чужих платформ (`*.o`, `*.so`, `__pycache__`).

---

## 2. Компоненты синтеза речи Piper TTS

### 2.1. Python-зависимости синтезатора (`requirements.txt`)
Для работы синтезатора на всех поддерживаемых интерфейсом языках в `requirements.txt` должны присутствовать:
- `piper-tts>=1.2.0` — основной движок локального нейросинтеза.
- `onnxruntime>=1.17.0` — среда исполнения нейросетевых моделей ONNX.
- `pyopenjtalk>=0.4.1` — **обязательный модуль для японского языка** (фонетизатор кандзи/кана Open JTalk). Без него синтез `ja_JP` падает с критической ошибкой.
- `g2pw>=0.1.1` и `pypinyin>=0.50.0` — **обязательные модули для китайского языка** (Grapheme-to-Phoneme и транскрипция пиньинь).
- `transformers>=4.36.0` — зависимость для моделей токенизации восточноазиатских языков.
- `sentence_stream>=1.3.0` и `unicode-rbnf>=2.4.0` — потоковая разбивка фраз и нормализация чисел.

### 2.2. Системные сборочные зависимости (`Dockerfile`)
Для успешной компиляции `pyopenjtalk` и C-вокодера в базовом образе `python:3.11-slim` требуются системные пакеты:
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

### 2.3. Голосовые модели для архива (`config/piper_voices/`)
Каждая голосовая модель состоит из двух файлов: `<voice_id>.onnx` (веса нейросети) и `<voice_id>.onnx.json` (конфигурация фонетизатора и темпа). 

В директорию `config/piper_voices/` архива должны быть включены модели для всех поддерживаемых языков интерфейса:

| Язык | Название голоса | ID модели (ONNX + JSON) | Назначение |
|---|---|---|---|
| **Русский (RU)** | Дмитрий (Medium) | `ru_RU-dmitri-medium` | **Основной мужской голос по умолчанию** |
| **Английский (EN)** | Alan (Medium) | `en_GB-alan-medium` | **Основной английский голос по умолчанию** |
| **Немецкий (DE)** | Thorsten (Medium) | `de_DE-thorsten-medium` | Основной немецкий голос |
| **Польский (PL)** | Darkman (Medium) | `pl_PL-darkman-medium` | Основной польский голос |
| **Украинский (UK)** | Mykyta (High) | `uk_UA-mykyta-high` | Основной украинский голос |
| **Испанский (ES)** | Carlfm (Medium) | `es_ES-carlfm-medium` | Основной испанский голос |
| **Французский (FR)** | Siwis (Medium) | `fr_FR-siwis-medium` | Основной французский голос |
| **Итальянский (IT)** | Riccardo (Medium) | `it_IT-riccardo-medium` | Основной итальянский голос |
| **Японский (JA)** | Hi-Fi Captain (Medium) | `ja_JP-hi_fi_captain-medium` | Не-романский язык (требует `pyopenjtalk`) |
| **Китайский (ZH)** | Chaowen (Medium) | `zh_CN-chaowen-medium` | Не-романский язык (требует `g2pw`/`pypinyin`) |

*Опционально можно также включить русский женский голос `ru_RU-irina-medium` и альтернативный `ru_RU-ruslan-medium`.*

#### Прямые ссылки на репозиторий Hugging Face для скачивания:
Базовый URL: `https://huggingface.co/rhasspy/piper-voices/resolve/main/`
- `ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx` и `.onnx.json`
- `en/en_GB/alan/medium/en_GB-alan-medium.onnx` и `.onnx.json`
- `de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx` и `.onnx.json`
- `pl/pl_PL/darkman/medium/pl_PL-darkman-medium.onnx` и `.onnx.json`
- `uk/uk_UA/mykyta/high/uk_UA-mykyta-high.onnx` и `.onnx.json`
- `es/es_ES/carlfm/medium/es_ES-carlfm-medium.onnx` и `.onnx.json`
- `fr/fr_FR/siwis/medium/fr_FR-siwis-medium.onnx` и `.onnx.json`
- `it/it_IT/riccardo/medium/it_IT-riccardo-medium.onnx` и `.onnx.json`
- `ja/ja_JP/hi_fi_captain/medium/ja_JP-hi_fi_captain-medium.onnx` и `.onnx.json`
- `zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium.onnx` и `.onnx.json`

---

## 3. Базовый функционал и сборка вокодера AMBE+2

Встроенный вокодер ProxDMR (`src/c_vocoder/`) преобразует сжатые фреймы DMR AMBE+2 в PCM-звук и обратно.

### Правило очистки перед архивированием:
В рабочей директории разработчика часто присутствуют бинарные файлы, собранные под конкретную ОС (например, `c_wrapper.o` и `libambe_vocoder.so` под x86_64).
Перед созданием архива **ОБЯЗАТЕЛЬНО** удалить все скомпилированные артефакты:
```bash
rm -f src/c_vocoder/*.o src/c_vocoder/*.so
```
Сборка библиотеки `libambe_vocoder.so` должна происходить автоматически внутри контейнера командами из `Dockerfile`:
```dockerfile
RUN make -C src/c_vocoder clean && \
    make -C src/c_vocoder && \
    cp src/c_vocoder/libambe_vocoder.so /usr/local/lib/ && \
    ldconfig
```

---

## 4. Обезличивание и безопасность (Blacklist & Sanitization)

### 4.1. Список файлов, которые КАТЕГОРИЧЕСКИ ЗАПРЕЩЕНО включать в архив:

| Путь к файлу / каталогу | Причина исключения |
|---|---|
| `config/settings.json` | Содержит реальные ключи Gemini API, пароли BrandMeister, позывной и DMR ID владельца |
| `config/settings.json.bak*` | Резервные копии настроек с конфиденциальными данными |
| `config/proxdmr.db*` | SQLite база данных с хешами паролей, пользователями, логами и метаданными |
| `config/jwt_secret.key` | Приватный 256-битный ключ подписи сессионных JWT токенов |
| `config/cert.pem`, `key.pem` | Приватный SSL-ключ и сертификат существующего сервера |
| `config/recordings/*` | Все сохранённые WAV-файлы радиопереговоров (гигабайты приватного эфира) |
| `config/calls_history_*.json` | Локальная история вызовов хотспотов |
| `*.log`, `*.txt` (в корне) | Логи сборки, краш-дампы (`docker_log.txt`, `crash_log.txt` и т.д.) |
| `src/c_vocoder/*.o`, `*.so` | Бинарные артефакты компиляции |
| `__pycache__`, `*.pyc` | Байткод Python |
| `.git/`, `.github/` | История коммитов, в которой могут оставаться старые ключи |

### 4.2. Обеспечение структуры каталогов в архиве
Чтобы Docker-контейнер корректно примонтировал тома, внутри `config/` архива должны остаться только:
```text
config/
├── .gitkeep
├── recordings/
│   └── .gitkeep
├── piper_voices/
│   ├── ru_RU-dmitri-medium.onnx
│   ├── ru_RU-dmitri-medium.onnx.json
│   ├── en_GB-alan-medium.onnx
│   ├── en_GB-alan-medium.onnx.json
│   └── ... (остальные предустановленные голоса)
└── settings.example.json
```

### 4.3. Пример обезличенного файла `config/settings.example.json`
```json
{
  "active_hotspot_id": "default",
  "loopback_mode": false,
  "mute_on_ptt": true,
  "volume_down_ptt": true,
  "simultaneous_slots": false,
  "theme": "dark",
  "language": "ru",
  "transcriber_enabled": false,
  "transcriber_api_key": "",
  "transcriber_api_keys": [],
  "transcriber_model": "gemini-3.5-flash",
  "transcriber_target_lang": "ru",
  "tts_enabled": true,
  "tts_engine": "piper",
  "tts_voice": "ru_RU-dmitri-medium",
  "tts_speed": 1.0,
  "hotspots": [
    {
      "id": "default",
      "name": "Основной хотспот",
      "callsign": "N0CALL",
      "dmr_id": 1234567,
      "bm_ssid": 1,
      "bm_master_host": "2501.master.brandmeister.network",
      "bm_master_port": 62031,
      "bm_password": "",
      "bm_api_key": "",
      "duplex": true,
      "rx_freq": 438800000,
      "tx_freq": 431200000,
      "color_code": 1,
      "default_tg_ts1": 91,
      "default_tg_ts2": 2501,
      "autoconnect": false,
      "rx_gain": 1.0,
      "tx_gain": 1.0,
      "talker_alias": "",
      "send_talker_alias": true,
      "collapsed": false,
      "auto_tg_bm": true,
      "auto_record": true
    }
  ],
  "contacts": []
}
```

### 4.4. Проверка хардкода IP-адресов в исходном коде
Перед финальной сборкой убедиться, что в исходном коде нет захардкоженных тестовых IP-адресов (например, `10.0.99.250`):
1. В [`src/main.py`](file:///Y:/ProxDMR/src/main.py) генерация SSL должна использовать переменную окружения `HOST_IP`:
   ```python
   host_ip = os.environ.get("HOST_IP", "127.0.0.1")
   cert_file, key_file = ensure_ssl_certificates(host_ip)
   ```
2. В [`src/ssl_helper.py`](file:///Y:/ProxDMR/src/ssl_helper.py) дефолтный аргумент:
   ```python
   def ensure_ssl_certificates(host_ip: str = "127.0.0.1") -> tuple[str, str]:
   ```
3. В [`src/static/js/modules/network/watchdog.js`](file:///Y:/ProxDMR/src/static/js/modules/network/watchdog.js):
   ```javascript
   const host = window.location.host || "localhost:8266";
   ```
4. В [`src/templates/index.html`](file:///Y:/ProxDMR/src/templates/index.html) элементы `gwDetailText` должны содержать плейсхолдер `localhost:8266`, который на лету заполняется скриптом на основе `window.location.host`.

---

## 5. Эталонный Dockerfile для архива

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Установка системных утилит и сборочных инструментов для вокодера и pyopenjtalk
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    curl \
    openssl \
    ffmpeg \
    libasound2-dev \
    && rm -rf /var/lib/apt/lists/*

# Установка Python-зависимостей
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Копирование исходного кода проекта
COPY . .

# Очистка и сборка нативного AMBE+2 вокодера
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

## 6. Эталонный docker-compose.yml

Для работы нейросетевых моделей Piper TTS рекомендуется выделить контейнеру не менее **1 ГБ RAM** (оптимально 2 ГБ):

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
      - ./src:/app/src
    deploy:
      resources:
        limits:
          memory: 1536M
    environment:
      - PORT=8266
      - USE_SSL=true
      - HOST_IP=127.0.0.1
      - ADMIN_USER=admin
      - ADMIN_PASSWORD=proxdmr_setup_pass
```

---

## 7. Автоматизированный скрипт сборки архива

Ниже приведён готовый скрипт на Python (`build_release_archive.py`), который агент может запустить для создания готового архива `proxdmr_release.tar.gz`.

Скрипт выполняет:
1. Валидацию наличия всех голосов (скачивает недостающие с Hugging Face).
2. Очистку бинарных файлов вокодера.
3. Проверку на отсутствие приватных ключей и персональных баз данных.
4. Упаковку чистого архива.

```python
#!/usr/bin/env python3
"""
Скрипт создания чистого, обезличенного установочного архива ProxDMR.
Запуск: python build_release_archive.py
"""

import os
import shutil
import tarfile
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DIST_DIR = ROOT / "dist"
ARCHIVE_NAME = "proxdmr_installer.tar.gz"

VOICES = [
    ("ru/ru_RU/dmitri/medium", "ru_RU-dmitri-medium"),
    ("en/en_GB/alan/medium", "en_GB-alan-medium"),
    ("de/de_DE/thorsten/medium", "de_DE-thorsten-medium"),
    ("pl/pl_PL/darkman/medium", "pl_PL-darkman-medium"),
    ("uk/uk_UA/mykyta/high", "uk_UA-mykyta-high"),
    ("es/es_ES/carlfm/medium", "es_ES-carlfm-medium"),
    ("fr/fr_FR/siwis/medium", "fr_FR-siwis-medium"),
    ("it/it_IT/riccardo/medium", "it_IT-riccardo-medium"),
    ("ja/ja_JP/hi_fi_captain/medium", "ja_JP-hi_fi_captain-medium"),
    ("zh/zh_CN/chaowen/medium", "zh_CN-chaowen-medium"),
]

BASE_HF = "https://huggingface.co/rhasspy/piper-voices/resolve/main/"

EXCLUDE_PATTERNS = {
    "settings.json", "settings.json.bak", "settings.json.migrated",
    "proxdmr.db", "proxdmr.db-wal", "proxdmr.db-shm",
    "jwt_secret.key", "cert.pem", "key.pem",
    "crash_log.txt", "docker_log.txt", "docker_tail.log",
    "past_user_requests.txt", "sketch.png", "Thumbs.db",
    "__pycache__", ".git", ".idea", ".vscode"
}

def clean_c_vocoder():
    print("[1/5] Очистка бинарных артефактов c_vocoder...")
    voc_dir = ROOT / "src" / "c_vocoder"
    for f in voc_dir.glob("*.o"):
        f.unlink()
    for f in voc_dir.glob("*.so"):
        f.unlink()

def ensure_voices():
    print("[2/5] Проверка голосовых моделей Piper...")
    v_dir = ROOT / "config" / "piper_voices"
    v_dir.mkdir(parents=True, exist_ok=True)
    
    for hf_subpath, voice_id in VOICES:
        for ext in [".onnx", ".onnx.json"]:
            filename = f"{voice_id}{ext}"
            target = v_dir / filename
            if not target.exists() or target.stat().st_size < 100:
                url = f"{BASE_HF}{hf_subpath}/{filename}"
                print(f"  -> Скачивание {filename} с Hugging Face...")
                urllib.request.urlretrieve(url, target)

def prepare_clean_tree(stage_dir: Path):
    print("[3/5] Подготовка чистого дерева проекта...")
    stage_dir.mkdir(parents=True, exist_ok=True)
    
    # Копирование Dockerfile, docker-compose, requirements, README
    for fname in ["Dockerfile", "docker-compose.yml", "requirements.txt", "README.md"]:
        if (ROOT / fname).exists():
            shutil.copy2(ROOT / fname, stage_dir / fname)
            
    # Копирование исходников src/
    shutil.copytree(
        ROOT / "src", stage_dir / "src",
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.o", "*.so")
    )
    
    # Копирование тестов tests/
    if (ROOT / "tests").exists():
        shutil.copytree(
            ROOT / "tests", stage_dir / "tests",
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
        )
        
    # Формирование чистой config/
    clean_config = stage_dir / "config"
    clean_config.mkdir(parents=True, exist_ok=True)
    (clean_config / "recordings").mkdir(exist_ok=True)
    (clean_config / "recordings" / ".gitkeep").touch()
    
    # Копирование проверенных голосов
    shutil.copytree(ROOT / "config" / "piper_voices", clean_config / "piper_voices")
    
    # Шаблон настроек
    if (ROOT / "config" / "settings.example.json").exists():
        shutil.copy2(ROOT / "config" / "settings.example.json", clean_config / "settings.example.json")

def verify_no_secrets(stage_dir: Path):
    print("[4/5] Аудит на отсутствие ключей и персональных данных...")
    for root, dirs, files in os.walk(stage_dir):
        for f in files:
            if f in EXCLUDE_PATTERNS or f.endswith(".wav") or f.endswith(".key"):
                raise RuntimeError(f"ОШИБКА БЕЗОПАСНОСТИ: В архив пытается попасть файл {f}!")

def create_tarball(stage_dir: Path):
    print("[5/5] Создание tar.gz архива...")
    DIST_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = DIST_DIR / ARCHIVE_NAME
    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(stage_dir, arcname="proxdmr")
    print(f"\n[УСПЕХ] Архив готов: {archive_path} (Размер: {archive_path.stat().st_size / (1024*1024):.1f} MB)")

if __name__ == "__main__":
    stage = ROOT / "dist" / "stage_proxdmr"
    if stage.exists():
        shutil.rmtree(stage)
    try:
        clean_c_vocoder()
        ensure_voices()
        prepare_clean_tree(stage)
        verify_no_secrets(stage)
        create_tarball(stage)
    finally:
        if stage.exists():
            shutil.rmtree(stage)
```

---

## 8. Чек-лист проверки архива другим агентом

Перед релизом проверить сформированный архив по шагам:
- [ ] **Размер архива**: обычно от 600 до 850 МБ (за счёт включённых моделей Piper TTS).
- [ ] **Отсутствие паролей**: распаковать архив во временную папку и выполнить:
  ```bash
  grep -r "AIzaSy" .
  grep -r "10.0.99.250" .
  ls -la config/
  ```
  Не должно быть `proxdmr.db`, `settings.json`, `jwt_secret.key`, `cert.pem`.
- [ ] **Наличие голосов**:
  - `ru_RU-dmitri-medium.onnx` и `.onnx.json` на месте.
  - `en_GB-alan-medium.onnx` и `.onnx.json` на месте.
  - Голоса не-романских языков (`ja_JP`, `zh_CN`) на месте.
- [ ] **Чистая компиляция**:
  ```bash
  docker compose build --no-cache
  docker compose up -d
  docker compose logs -f
  ```
  Контейнер должен стартовать с HTTP 200 на порту 8266, автоматически создать таблицы БД, сгенерировать SSL и инициализировать вокодер.
