# Local Speech Synthesis (TTS) for ProxDMR

Research and practical guide on selecting a lightweight local Text-to-Speech (TTS) engine for integration into the **ProxDMR** ecosystem (Docker, FastAPI, 512 MB memory limit).

---

## 1. Context and System Requirements in ProxDMR

1. **Fully Offline & Self-Contained:** No external cloud APIs (Google Cloud TTS, Azure, etc.). The synthesis engine must run locally inside the container or as a companion microservice.
2. **Resource Constraints:** The `proxdmr` container operates within a `memory: 512M` limit. The TTS engine should not exceed **60–120 MB RAM** at peak load.
3. **Radio Phonetics & Terminology:**
   - Accurate pronunciation of amateur radio callsigns (e.g. *"R3ABC"* -> *"Romeo Three Alfa Bravo Charlie"* or phonetic spelling).
   - Reading digits and TalkGroup IDs (*"Timeslot one, TalkGroup twenty-five zero one"*).
   - System service statuses for BrandMeister connections (*"BM Master 2501 connected, ping 45 ms"*).
4. **Audio Output Format:** `WAV / Linear PCM 16-bit 8000 Hz / 16000 Hz / 22050 Hz` (streamed over WebSockets to operator browsers or fed into DMR audio frames).

---

## 2. Comparison of Candidate Engines

| Parameter | **Piper TTS** (Recommended Neural Engine) | **RHVoice** (Classic Parametric Radio Style) |
| :--- | :--- | :--- |
| **Architecture** | Neural network (VITS / ONNX) | Statistical parametric (HTS) |
| **RAM Usage** | ~60 – 100 MB | ~20 – 40 MB |
| **Disk Footprint** | ~50 – 70 MB (model + ONNX) | ~15 – 30 MB (voice + library) |
| **CPU Load** | 0.05 – 0.15 s per phrase (~10x faster than real-time) | Instantaneous (< 0.02 s, near-zero CPU load) |
| **Voice Quality** | Natural, pleasant human-like voice | Clear, robotic, "dispatch/repeater" voice |
| **Sample Voices** | `en_GB-alan-medium`, `en_US-lessac-medium`, `ru_RU-dmitri-medium` | Alan, Elena, Aleksandr |
| **Python Installation** | `pip install piper-tts` | `pip install rhvoice-wrapper` or native C bindings |

---

## 3. Option 1: Piper TTS (Modern Fast Neural Engine)

Piper is the modern open-source standard for fast, high-quality local text-to-speech created by the Home Assistant / Rhasspy team. It runs via `onnxruntime`.

### 3.1. CLI Quick Test
```bash
# 1. Install piper package
pip install piper-tts

# 2. Download ONNX model and config (e.g., English Alan voice)
curl -L -o en_alan.onnx "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx"
curl -L -o en_alan.onnx.json "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_GB/alan/medium/en_GB-alan-medium.onnx.json"

# 3. Synthesize phrase into test_piper.wav
echo "ProxDMR connected to BrandMeister master server." | piper --model en_alan.onnx --output_file test_piper.wav
```

### 3.2. Minimal Python Script (`test_piper.py`)
```python
import wave
from piper import PiperVoice

# Load lightweight ONNX model
model_path = "en_alan.onnx"
config_path = "en_alan.onnx.json"
voice = PiperVoice.load(model_path, config_path=config_path)

text = "Attention. Timeslot 2. Incoming call from callsign K1ABC."
output_wav = "output_piper.wav"

with wave.open(output_wav, "wb") as wav_file:
    voice.synthesize(text, wav_file)

print(f"Done! Audio saved to {output_wav}")
```

---

## 4. Option 2: RHVoice (Classic Parametric Engine)

RHVoice is an ultra-lightweight parametric engine suitable for high-noise radio channels.

### 4.1. Quick Test via Python Library (`rhvoice-wrapper`)
```bash
pip install rhvoice-wrapper-bin rhvoice-wrapper
```

### 4.2. Minimal Python Script (`test_rhvoice.py`)
```python
from rhvoice_wrapper import TTS

tts = TTS(threads=1)
text = "Attention. Timeslot 1. Connected to TalkGroup 3100."

audio_data = tts.to_wave(text, voice="alan", format_="wav")
with open("output_rhvoice.wav", "wb") as f:
    f.write(audio_data)

print("Done! Audio saved to output_rhvoice.wav")
```

---

## 5. Integration into ProxDMR (FastAPI Backend)

Example of an internal TTS router serving synthesized speech:

```python
import io
import wave
from fastapi import APIRouter, Response
from piper import PiperVoice

tts_router = APIRouter(prefix="/api/tts", tags=["TTS"])
voice = PiperVoice.load("config/tts/en_alan.onnx", config_path="config/tts/en_alan.onnx.json")

@tts_router.get("/speak")
async def speak(text: str):
    """
    Synthesize speech on the fly and stream back to the web UI.
    Usage in browser: <audio src="/api/tts/speak?text=Hello" autoplay />
    """
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav_file:
        voice.synthesize(text, wav_file)
    
    return Response(content=buffer.getvalue(), media_type="audio/wav")
```

---

## 6. Best Practices for Amateur Radio Speech

1. **Callsign Pronunciation:** Prevent the engine from reading alphanumeric callsigns as a single English word (e.g. *W3ABC* as *"wabc"*). Prepend letters with spaces or phonetic expansions:  
   `"W 3 A B C"` or phonetic: `"Whiskey Three Alfa Bravo Charlie"`.
2. **TalkGroups & Timeslots:** Spell out numbers or insert spaces so *TG 3100* is not read as year thirty-one hundred:  
   Send *"TalkGroup three one zero zero"* instead of *"TG 3100"*.
3. **Phrase Caching:** Static system phrases (*"Server connected"*, *"Connection lost"*, *"Timeslot 1 idle"*) are synthesized once and cached in memory to eliminate repeated CPU consumption.
