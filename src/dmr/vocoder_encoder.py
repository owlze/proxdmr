"""
DMR AMBE+2 Software Vocoder Encoder for ProxDMR
Encodes 8000 Hz 16-bit mono PCM into AMBE+2 72-bit (9-byte) frames using libmbe_neo_bridge.so.
Includes 300 Hz High-Pass filter and silence thresholding for broadcast-quality DMR voice.
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
    2nd order IIR Butterworth High-Pass Filter @ 130 Hz cutoff (Fs = 8000 Hz).
    Removes sub-vocal rumble, DC offset, and AC hum (50/60 Hz) without cutting vocal warmth.
    """
    def __init__(self):
        C = math.tan(math.pi * 130.0 / 8000.0)
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
AMBE_SILENCE_FRAME = bytes.fromhex("acaa40200044408080")

# Valid AMBE 2450 49-bit silence vector (b0 = 124 -> MBE_AMBE2450_FRAME_SILENCE)
AMBE_SILENCE_49 = bytes(1 if i in (0, 1, 2, 3, 37) else 0 for i in range(49))


class DMRVocoderEncoder:
    """
    AMBE+2 Voice Encoder for DMR and YSF powered by mbelib-neo.
    Converts 8000 Hz 16-bit PCM into 72-bit (DMR) or 49-bit (YSF VD2) AMBE+2 frames.
    """
    def __init__(self):
        self.lib = self._load_library()
        self.enc = None
        self.hpf = HighPassFilter300Hz()
        self.dstar_hpf = HighPassFilter300Hz()
        self.is_ready = False
        self.has_encode_49 = False
        self.has_encode_dstar = False
        self.dstar_enc = None
        self._pcm_buffer = bytearray()

        if self.lib:
            try:
                self.lib.mbe_neo_encoder_create.restype = ctypes.c_void_p
                self.lib.mbe_neo_encoder_destroy.argtypes = [ctypes.c_void_p]
                self.lib.mbe_neo_encoder_reset.argtypes = [ctypes.c_void_p]
                self.lib.mbe_neo_encode_72.argtypes = [
                    ctypes.c_void_p,
                    ctypes.POINTER(ctypes.c_int16),
                    ctypes.POINTER(ctypes.c_uint8)
                ]
                self.lib.mbe_neo_encode_72.restype = ctypes.c_int

                if hasattr(self.lib, "mbe_neo_encode_49"):
                    self.lib.mbe_neo_encode_49.argtypes = [
                        ctypes.c_void_p,
                        ctypes.POINTER(ctypes.c_int16),
                        ctypes.POINTER(ctypes.c_uint8)
                    ]
                    self.lib.mbe_neo_encode_49.restype = ctypes.c_int
                    self.has_encode_49 = True

                if hasattr(self.lib, "mbe_neo_dstar_encoder_create"):
                    self.lib.mbe_neo_dstar_encoder_create.restype = ctypes.c_void_p
                    self.lib.mbe_neo_dstar_encoder_destroy.argtypes = [ctypes.c_void_p]
                    self.lib.mbe_neo_dstar_encoder_reset.argtypes = [ctypes.c_void_p]
                    self.lib.mbe_neo_encode_dstar_72.argtypes = [
                        ctypes.c_void_p,
                        ctypes.POINTER(ctypes.c_int16),
                        ctypes.POINTER(ctypes.c_uint8)
                    ]
                    self.lib.mbe_neo_encode_dstar_72.restype = ctypes.c_int

                    self.dstar_enc = self.lib.mbe_neo_dstar_encoder_create()
                    if self.dstar_enc:
                        self.has_encode_dstar = True
                        logger.info("[VOCODER_ENC] mbelib-neo D-STAR AMBE 3600x2400 Encoder initialized")

                self.enc = self.lib.mbe_neo_encoder_create()
                if self.enc:
                    self.is_ready = True
                    logger.info(f"[VOCODER_ENC] mbelib-neo AMBE+2 Encoder initialized (encode_49={self.has_encode_49})")
                else:
                    logger.error("[VOCODER_ENC] Failed to create mbelib-neo encoder instance")
            except Exception as e:
                logger.error(f"[VOCODER_ENC] Initialization error: {e}")
        else:
            logger.warning("[VOCODER_ENC] libmbe_neo_bridge.so not found. Encoding disabled.")

    def _load_library(self) -> Optional[ctypes.CDLL]:
        c_vocoder_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "c_vocoder"))
        local_so = os.path.join(c_vocoder_dir, "libmbe_neo_bridge.so")
        candidates = [
            "/usr/local/lib/libmbe_neo_bridge.so",
            "/app/src/c_vocoder/libmbe_neo_bridge.so",
            local_so,
            os.path.join(c_vocoder_dir, "mbe_neo_bridge.dll"),
            "libmbe_neo_bridge.so",
        ]
        for path in candidates:
            if not path:
                continue
            try:
                if os.path.exists(path) or not os.path.isabs(path):
                    lib = ctypes.CDLL(path)
                    if hasattr(lib, "mbe_neo_encode_dstar_72"):
                        logger.info(f"[VOCODER_ENC] Loaded vocoder encoder with D-STAR from {path}")
                        return lib
            except Exception:
                continue

        if os.name != "nt" and os.path.isfile(os.path.join(c_vocoder_dir, "Makefile")):
            try:
                import subprocess
                import shutil
                logger.info(f"[VOCODER_ENC] libmbe_neo_bridge.so outdated or not found, building in {c_vocoder_dir}...")
                subprocess.run(["make", "-C", c_vocoder_dir, "clean"], check=False, timeout=60)
                subprocess.run(["make", "-C", c_vocoder_dir], check=True, timeout=180)
                if os.path.isfile(local_so):
                    try:
                        shutil.copy2(local_so, "/usr/local/lib/libmbe_neo_bridge.so")
                    except Exception:
                        pass
                    lib = ctypes.CDLL(local_so)
                    logger.info(f"[VOCODER_ENC] Built and loaded vocoder encoder from {local_so}")
                    return lib
            except Exception as e:
                logger.error(f"[VOCODER_ENC] Auto-build of libmbe_neo_bridge.so failed: {e}")

        # Fallback to loading existing library even if D-STAR encoder symbol is absent
        for path in candidates:
            if not path:
                continue
            try:
                if os.path.exists(path) or not os.path.isabs(path):
                    lib = ctypes.CDLL(path)
                    logger.info(f"[VOCODER_ENC] Loaded vocoder encoder from {path}")
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
                self.lib.mbe_neo_encoder_reset(self.enc)
            except Exception:
                pass
        self.reset_dstar()

    def reset_dstar(self):
        """Reset D-STAR encoder filter state and mbelib-neo context."""
        self.dstar_hpf.reset()
        if self.dstar_enc and self.lib and hasattr(self.lib, "mbe_neo_dstar_encoder_reset"):
            try:
                self.lib.mbe_neo_dstar_encoder_reset(self.dstar_enc)
            except Exception:
                pass

    def encode_20ms_frame(self, pcm_160_samples: List[int]) -> Optional[bytes]:
        """
        Encodes exactly 160 samples (20 ms) of 16-bit 8000 Hz PCM into a 9-byte AMBE+2 frame.
        """
        if not self.is_ready or not self.enc:
            return None

        # Filter audio continuously so IIR state never clicks on quiet consonant transitions
        filtered = self.hpf.process(pcm_160_samples)

        # Check for silence or low background noise floor after DC/rumble removal
        peak = max(abs(s) for s in filtered)
        if peak < 70:
            return AMBE_SILENCE_FRAME

        pcm_arr = (ctypes.c_int16 * 160)(*filtered)
        ambe_arr = (ctypes.c_uint8 * 9)()

        res = self.lib.mbe_neo_encode_72(self.enc, pcm_arr, ambe_arr)
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

    def encode_ysf_20ms_49(self, pcm_160_samples: List[int]) -> bytes:
        """
        Encodes exactly 160 samples (20 ms) of 16-bit 8000 Hz PCM into a 49-bit AMBE+2 vector
        (49 bytes of 0/1) for YSF VD Mode 2.
        """
        if not self.is_ready or not self.enc or not self.has_encode_49:
            return AMBE_SILENCE_49

        filtered = self.hpf.process(pcm_160_samples)
        peak = max(abs(s) for s in filtered)
        if peak < 70:
            return AMBE_SILENCE_49

        pcm_arr = (ctypes.c_int16 * 160)(*filtered)
        ambe49_arr = (ctypes.c_uint8 * 49)()

        res = self.lib.mbe_neo_encode_49(self.enc, pcm_arr, ambe49_arr)
        if res == 0:
            return bytes(ambe49_arr)
        return AMBE_SILENCE_49

    def encode_ysf_100ms_frame(self, pcm_bytes_1600: bytes) -> List[bytes]:
        """
        Encodes 1600 bytes (800 samples = 100 ms) of 8000 Hz 16-bit PCM into 5 AMBE+2
        49-bit vectors for one YSF VD2 packet.
        """
        if not pcm_bytes_1600:
            return [AMBE_SILENCE_49] * 5

        buf = pcm_bytes_1600[:1600]
        if len(buf) < 1600:
            buf = buf + (b"\x00" * (1600 - len(buf)))

        samples = struct.unpack("<800h", buf)
        if max(abs(s) for s in samples) < 70:
            return [AMBE_SILENCE_49] * 5

        return [self.encode_ysf_20ms_49(samples[i * 160:(i + 1) * 160]) for i in range(5)]

    def encode_dstar_frame(self, pcm320: bytes) -> Optional[bytes]:
        """
        Encodes 160 samples (320 bytes) of 16-bit 8000 Hz PCM into a 9-byte AMBE 3600x2400 frame for D-STAR.
        """
        if not self.has_encode_dstar or not self.dstar_enc or not self.lib:
            return None
        if not pcm320 or len(pcm320) < 320:
            return AMBE_SILENCE_FRAME

        samples = list(struct.unpack("<160h", pcm320[:320]))
        filtered = self.dstar_hpf.process(samples)

        peak = max(abs(s) for s in filtered)
        if peak < 70:
            return AMBE_SILENCE_FRAME

        pcm_arr = (ctypes.c_int16 * 160)(*filtered)
        raw72_arr = (ctypes.c_uint8 * 9)()

        try:
            res = self.lib.mbe_neo_encode_dstar_72(self.dstar_enc, pcm_arr, raw72_arr)
            if res < 0:
                return AMBE_SILENCE_FRAME
            return bytes(raw72_arr)
        except Exception as e:
            logger.debug(f"[VOCODER_ENC] D-STAR encode error: {e}")
            return AMBE_SILENCE_FRAME

    def close(self):
        """Explicitly release C-allocated encoder context."""
        if self.enc and self.lib:
            try:
                self.lib.mbe_neo_encoder_destroy(self.enc)
            except Exception:
                pass
            self.enc = None
        if self.dstar_enc and self.lib and hasattr(self.lib, "mbe_neo_dstar_encoder_destroy"):
            try:
                self.lib.mbe_neo_dstar_encoder_destroy(self.dstar_enc)
            except Exception:
                pass
            self.dstar_enc = None
        self.is_ready = False
        self.has_encode_dstar = False

    def __del__(self):
        self.close()
