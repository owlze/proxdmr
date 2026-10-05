# Локальный синтез речи (TTS) для проекта ProxDMR

Исследование и практическое руководство по выбору легковесного локального движка Text-to-Speech (TTS) для интеграции в экосистему **ProxDMR** (Docker, FastAPI, лимит памяти 512 Мб).

---

## 1. Контекст и системные требования в ProxDMR

1. **Полный оффлайн и автономность:** Никаких облачных API (Google Cloud TTS, Yandex SpeechKit, Azure). Синтезатор обязан работать локально внутри контейнера или как соседний микросервис.
2. **Лимит ресурсов:** Контейнер `proxdmr` имеет ограничение `memory: 512M`. Движок TTS не должен потреблять больше **60–120 Мб RAM** в пике.
3. **Фонетика и специфика радиосвязи:**
   - Четкое произношение русских и английских позывных (например: *«R3ABC»* -> *«Эр Три Анна Борис Константин»* или *«Ар три эй-би-си»*).
   - Чтение цифр и идентификаторов TalkGroup (*«Таймслот один, группа двадцать пять ноль один»*).
   - Служебные статусы соединения с BrandMeister (*«Сервер BM 2501 доступен, пинг 45 миллисекунд»*).
4. **Формат вывода:** Аудиопоток `WAV / PCM 16-bit` (для передачи через WebSockets в браузер оператора либо в аудио-пакеты DMR).

---

## 2. Сравнительная таблица кандидатов

| Параметр | **Piper TTS** (Рекомендуемая нейронка) | **RHVoice** (Классический радио-стиль) |
| :--- | :--- | :--- |
| **Архитектура** | Нейросеть (VITS / ONNX) | Статистический параметрический (HTS) |
| **Потребление RAM** | ~60 – 100 Мб | ~20 – 40 Мб |
| **Размер на диске** | ~50 – 70 Мб (модель + ONNX) | ~15 – 30 Мб (голос + библиотека) |
| **Нагрузка на CPU** | 0.05 – 0.15 сек на фразу (в 10 раз быстрее Real-Time) | Мгновенно (< 0.02 сек, околонулевая нагрузка) |
| **Качество голоса** | Естественный, живой человеческий голос | Четкий, механический, «радийный/диспетчерский» |
| **Русские голоса** | `ru_RU-dmitri-medium`, `ru_RU-irina-medium`, `denis` | Александр, Елена, Анна, Юрий |
| **Установка в Python** | `pip install piper-tts` | `pip install rhvoice-wrapper` или C-библиотека |

---

## 3. Вариант №1: Piper TTS (Современная микро-нейронка)

Piper — современный стандарт открытого легковесного синтеза от разработчиков Home Assistant. Работает через легковесный движок `onnxruntime`.

### 3.1. Быстрый тест через CLI
```bash
# 1. Установка утилиты
pip install piper-tts

# 2. Скачивание русской модели (голос Дмитрия)
curl -L -o ru_dmitri.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx"
curl -L -o ru_dmitri.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx.json"

# 3. Синтез фразы в test_piper.wav
echo "ProxDMR подключен к серверу BrandMeister." | piper --model ru_dmitri.onnx --output_file test_piper.wav
```

### 3.2. Минимальный тестовый Python-скрипт (`test_piper.py`)
```python
import wave
from piper import PiperVoice

# Загрузка легковесной ONNX модели
model_path = "ru_dmitri.onnx"
config_path = "ru_dmitri.onnx.json"
voice = PiperVoice.load(model_path, config_path=config_path)

text = "Внимание. Таймслот 2. Активен вызов от позывного R3ABC."
output_wav = "output_piper.wav"

with wave.open(output_wav, "wb") as wav_file:
    voice.synthesize(text, wav_file)

print(f"Готово! Аудио сохранено в {output_wav}")
```

---

## 4. Вариант №2: RHVoice (Классический параметрический движок)

RHVoice идеально подходит для радиолюбительской связи: звук звучит разборчиво в шумном эфире и напоминает стандартный репитерный автоинформатор.

### 4.1. Быстрый тест через Python-библиотеку (`rhvoice-wrapper`)
```bash
pip install rhvoice-wrapper-bin rhvoice-wrapper
```

### 4.2. Минимальный тестовый Python-скрипт (`test_rhvoice.py`)
```python
from rhvoice_wrapper import TTS

# Инициализация (голоса скачиваются автоматически или берутся локально)
tts = TTS(threads=1)

text = "Внимание. Таймслот 1. Подключена разговорная группа двадцать пять ноль один."

# Синтез в бинарный поток WAV
audio_data = tts.to_wave(text, voice="aleksandr", format_="wav")

with open("output_rhvoice.wav", "wb") as f:
    f.write(audio_data)

print("Готово! Аудио RHVoice сохранено в output_rhvoice.wav")
```

---

## 5. Как это интегрируется в ProxDMR (FastAPI)

Пример готового микро-сервиса внутри вашего бекенда для отдачи звука оператору:

```python
import io
import wave
from fastapi import APIRouter, Response
from piper import PiperVoice

tts_router = APIRouter(prefix="/api/tts", tags=["TTS"])
voice = PiperVoice.load("config/tts/ru_dmitri.onnx", config_path="config/tts/ru_dmitri.onnx.json")

@tts_router.get("/speak")
async def speak(text: str):
    """
    Генерирует аудио на лету и отдает клиенту (Web UI)
    Использование в браузере: <audio src="/api/tts/speak?text=Привет" autoplay />
    """
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    
    return Response(content=buffer.getvalue(), media_type="audio/wav")
```

---

## 6. Рекомендации по озвучке радио-специфики

1. **Позывные:** Чтобы синтезатор не пытался прочитать английский позывной как единое слово (например, *UB3AAA* как «Уб три ааа»), перед передачей в TTS полезно разделять буквы точками или пробелами:  
   `"U B 3 A A A"` или фонетически: `"Ульяна Борис три Анна Анна Анна"`.
2. **Таймслоты и группы:** Числительные лучше передавать словами или разбивать пробелами, чтобы движок не читал *TG 2501* как год:  
   Вместо `"TG 2501"` отправлять `"Группа двадцать пять ноль один"`.
3. **Кэширование типовых фраз:** Фразы вроде *«Сервер подключен»*, *«Соединение разорвано»*, *«Таймслот 1 свободен»* генерируются ровно один раз и кэшируются в памяти, чтобы вообще не дергать процессор.
