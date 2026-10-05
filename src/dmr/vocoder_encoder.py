"""
DMR AMBE+2 Software Vocoder Encoder for ProxDMR
Encodes 8000 Hz 16-bit mono PCM into AMBE+2 72-bit (9-byte) frames using libambe_vocoder.so.
Includes 300 Hz High-Pass filter and peak limiter for broadcast-quality DMR voice.
"""

import ctypes
import ctypes.util
import logging
import math
import os
import struct
from typing import Optional, List

logger = logging.getLogger("proxdmr.vocoder_encoder")


class HighPassFilter300Hz:
    """
    2nd order IIR Butterworth High-Pass Filter @ 300 Hz cutoff (Fs = 8000 Hz).
    Removes low-frequency rumble, AC hum (50/60 Hz), and microphone plosives.
    """
    def __init__(self):
        C = math.tan(math.pi * 300.0 / 8000.0)
        C2 = C * C
        sqrt2 = math.sqrt(2.0)
        D = 1.0 + sqrt2 * C + C2
        self.b0 = 1.0 / D
        self.b1 = -2.0 / D
        self.b2 = 1.0 / D
        self.a1 = 2.0 * (C2 - 1.0) / D
        self.a2 = (1.0 - sqrt2 * C + C2) / D
        self.x1 = 0.0
        self.x2 = 0.0
        self.y1 = 0.0
        self.y2 = 0.0

    def process(self, samples: List[int]) -> List[int]:
        out = []
        b0, b1, b2 = self.b0, self.b1, self.b2
        a1, a2 = self.a1, self.a2
        x1, x2, y1, y2 = self.x1, self.x2, self.y1, self.y2

        for x0 in samples:
            y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = x0
            y2 = y1
            y1 = y0
            val = max(-32700.0, min(32700.0, y0))
            out.append(int(val))

        self.x1, self.x2, self.y1, self.y2 = x1, x2, y1, y2
        return out

    def reset(self):
        self.x1 = self.x2 = self.y1 = self.y2 = 0.0


# Standard ETSI DMR AMBE+2 Silence Frame (72-bit / 9-byte canonical bit pattern)
# Bit pattern: 0xACAA40200044408080
# Decodes to true digital silence in AMBE+2 vocoders without pitch estimation artifacts.
AMBE_SILENCE_FRAME = bytes.fromhex("acaa40200044408080")


class DMRVocoderEncoder:
    """
    AMBE+2 Voice Encoder for DMR.
    Converts 8000 Hz 16-bit PCM (480 samples = 60 ms) into 3 AMBE+2 frames (27 bytes = 216 bits).
    """
    def __init__(self):
        self.lib = self._load_library()
        self.enc = None
        self.hpf = HighPassFilter300Hz()
        self.is_ready = False
        self._pcm_buffer = bytearray()

        if self.lib:
            try:
                self.lib.ambe_encoder_create.restype = ctypes.c_void_p
                self.lib.ambe_encoder_destroy.argtypes = [ctypes.c_void_p]
                self.lib.ambe_encode_frame.argtypes = [
                    ctypes.c_void_p,
                    ctypes.POINTER(ctypes.c_int16),
                    ctypes.POINTER(ctypes.c_uint8)
                ]
                self.lib.ambe_encode_frame.restype = ctypes.c_int

                self.enc = self.lib.ambe_encoder_create()
                if self.enc:
                    self.is_ready = True
                    logger.info("[VOCODER_ENC] AMBE+2 Software Encoder initialized successfully")
                else:
                    logger.error("[VOCODER_ENC] Failed to create encoder instance")
            except Exception as e:
                logger.error(f"[VOCODER_ENC] Initialization error: {e}")
        else:
            logger.warning("[VOCODER_ENC] libambe_vocoder.so not found. Encoding disabled.")

    def _load_library(self) -> Optional[ctypes.CDLL]:
        candidates = [
            "/usr/local/lib/libambe_vocoder.so",
            "/app/src/c_vocoder/libambe_vocoder.so",
            os.path.join(os.path.dirname(__file__), "..", "c_vocoder", "libambe_vocoder.so"),
            "libambe_vocoder.so",
            ctypes.util.find_library("ambe_vocoder")
        ]
        for path in candidates:
            if not path:
                continue
            try:
                lib = ctypes.CDLL(path)
                logger.info(f"[VOCODER_ENC] Loaded vocoder library from {path}")
                return lib
            except Exception:
                continue
        return None

    def reset(self):
        """Reset filter states and input buffers on PTT start/stop."""
        self.hpf.reset()
        self._pcm_buffer.clear()
        if self.enc and self.lib:
            try:
                self.lib.ambe_encoder_destroy(self.enc)
                self.enc = self.lib.ambe_encoder_create()
            except Exception:
                pass

    def encode_20ms_frame(self, pcm_160_samples: List[int]) -> Optional[bytes]:
        """
        Encodes exactly 160 samples (20 ms) of 16-bit 8000 Hz PCM into a 9-byte AMBE+2 frame.
        """
        if not self.is_ready or not self.enc:
            return None

        # Check for silence or low background noise floor.
        # Below peak 70 / RMS ~30 (-53 dBFS), there is no intelligible speech phoneme.
        # Passing near-zero noise into libambe_vocoder causes its pitch estimator
        # to latch onto minimum lag (20 samples = 400 Hz) and generate high-frequency buzzing harmonics.
        peak = max(abs(s) for s in pcm_160_samples)
        if peak < 70:
            self.hpf.reset()
            return AMBE_SILENCE_FRAME

        # Filter audio
        filtered = self.hpf.process(pcm_160_samples)

        pcm_arr = (ctypes.c_int16 * 160)(*filtered)
        ambe_arr = (ctypes.c_uint8 * 9)()

        res = self.lib.ambe_encode_frame(self.enc, pcm_arr, ambe_arr)
        if res == 0:
            return bytes(ambe_arr)
        return None

    def encode_60ms_superframe(self, pcm_bytes_960: bytes) -> Optional[List[bytes]]:
        """
        Encodes 960 bytes (480 samples = 60 ms) of PCM into 3 AMBE+2 frames (9 bytes each).
        Returns list of 3 frames: [frame1 (9 bytes), frame2 (9 bytes), frame3 (9 bytes)]
        Total = 27 bytes (216 bits).
        """
        if len(pcm_bytes_960) < 960:
            return None

        num_samples = len(pcm_bytes_960) // 2
        samples = struct.unpack(f"<{num_samples}h", pcm_bytes_960[:960])

        # Fast path: if entire 60ms burst is silence, return 3 standard silence frames directly
        if max(abs(s) for s in samples) < 70:
            return [AMBE_SILENCE_FRAME, AMBE_SILENCE_FRAME, AMBE_SILENCE_FRAME]

        frames = []
        for i in range(3):
            chunk = samples[i * 160:(i + 1) * 160]
            f = self.encode_20ms_frame(chunk)
            if f:
                frames.append(f)
            else:
                return None

        return frames

    def close(self):
        """Explicitly release C-allocated encoder context. Call when done with hotspot."""
        if self.enc and self.lib:
            try:
                self.lib.ambe_encoder_destroy(self.enc)
            except Exception:
                pass
            self.enc = None

    def __del__(self):
        self.close()
