"""
mbelib-neo based AMBE+2 Vocoder Decoder for ProxDMR
Decodes DMR 33-byte voice bursts into 8000 Hz 16-bit mono PCM and exports frame metadata.
Powered by arancormonk/mbelib-neo with WOLA 256-pt unvoiced synthesis and harmonic phase regeneration.
"""

import ctypes
import ctypes.util
import logging
import math
import os
from typing import Optional, Dict, Any, Tuple
import numpy as np

logger = logging.getLogger("proxdmr.vocoder")

try:
    import dmr_utils3.decode as dmr_decode
    DMR_UTILS_AVAILABLE = True
except ImportError:
    dmr_decode = None
    DMR_UTILS_AVAILABLE = False
    logger.warning("[VOCODER] dmr_utils3 not found.")


class _CMbeNeoFrameMeta(ctypes.Structure):
    _fields_ = [
        ("c0_errors", ctypes.c_int),
        ("protected_errors", ctypes.c_int),
        ("total_errors", ctypes.c_int),
        ("flags", ctypes.c_uint),
        ("w0", ctypes.c_float),
        ("L", ctypes.c_int),
        ("K", ctypes.c_int),
        ("voiced_bands", ctypes.c_int),
        ("repeat", ctypes.c_int),
    ]


class DMRVocoderDecoder:
    def __init__(self):
        self.lib = self._load_library()
        self.is_ready = False
        self._slots: Dict[int, Any] = {}
        self._out160 = (ctypes.c_int16 * 160)()
        self._meta_c = _CMbeNeoFrameMeta()
        self.spectral_enh = True
        self.high_band_gain_db = 0.5
        self.unvoiced_gain_db = -1.5
        self._last_sample_per_slot: Dict[int, float] = {1: 0.0, 2: 0.0}
        self._last_slope_per_slot: Dict[int, float] = {1: 0.0, 2: 0.0}

        if self.lib and DMR_UTILS_AVAILABLE:
            try:
                self._setup_c_signatures()
                self._slots[1] = self.lib.mbe_neo_create()
                self._slots[2] = self.lib.mbe_neo_create()
                self.is_ready = True
                logger.info("[VOCODER] mbelib-neo AMBE+2 Decoder initialized successfully (TS1/TS2)")
            except Exception as e:
                logger.error(f"[VOCODER] Failed to initialize mbelib-neo: {e}")

    def _load_library(self) -> Optional[ctypes.CDLL]:
        c_vocoder_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "c_vocoder"))
        local_so = os.path.join(c_vocoder_dir, "libmbe_neo_bridge.so")
        candidates = [
            local_so,
            "/app/src/c_vocoder/libmbe_neo_bridge.so",
            "/usr/local/lib/libmbe_neo_bridge.so",
            os.path.join(c_vocoder_dir, "mbe_neo_bridge.dll"),
            "libmbe_neo_bridge.so",
        ]
        for path in candidates:
            try:
                if os.path.exists(path) or not os.path.isabs(path):
                    lib = ctypes.CDLL(path)
                    logger.info(f"[VOCODER] Loaded mbelib-neo bridge from {path}")
                    return lib
            except Exception:
                continue

        if os.name != "nt" and os.path.isfile(os.path.join(c_vocoder_dir, "Makefile")):
            try:
                import subprocess
                import shutil
                logger.info(f"[VOCODER] libmbe_neo_bridge.so not found, building in {c_vocoder_dir}...")
                subprocess.run(["make", "-C", c_vocoder_dir], check=True, timeout=180)
                if os.path.isfile(local_so):
                    try:
                        shutil.copy2(local_so, "/usr/local/lib/libmbe_neo_bridge.so")
                    except Exception:
                        pass
                    lib = ctypes.CDLL(local_so)
                    logger.info(f"[VOCODER] Built and loaded mbelib-neo bridge from {local_so}")
                    return lib
            except Exception as e:
                logger.error(f"[VOCODER] Auto-build of libmbe_neo_bridge.so failed: {e}")
        return None

    def _setup_c_signatures(self):
        self.lib.mbe_neo_create.restype = ctypes.c_void_p
        self.lib.mbe_neo_destroy.argtypes = [ctypes.c_void_p]
        self.lib.mbe_neo_reset.argtypes = [ctypes.c_void_p]

        self.lib.mbe_neo_decode_72.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_uint8),
            ctypes.POINTER(ctypes.c_int16),
            ctypes.POINTER(_CMbeNeoFrameMeta)
        ]
        self.lib.mbe_neo_decode_72.restype = ctypes.c_int

        self.lib.mbe_neo_decode_49.argtypes = [
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_char),
            ctypes.POINTER(ctypes.c_int16),
            ctypes.POINTER(_CMbeNeoFrameMeta)
        ]
        self.lib.mbe_neo_decode_49.restype = ctypes.c_int

        if hasattr(self.lib, "mbe_neo_decode_imbe_144"):
            self.lib.mbe_neo_decode_imbe_144.argtypes = [
                ctypes.c_void_p,
                ctypes.POINTER(ctypes.c_uint8),
                ctypes.POINTER(ctypes.c_int16),
                ctypes.POINTER(_CMbeNeoFrameMeta)
            ]
            self.lib.mbe_neo_decode_imbe_144.restype = ctypes.c_int

        if hasattr(self.lib, "mbe_neo_set_tuning"):
            self.lib.mbe_neo_set_tuning.argtypes = [
                ctypes.c_void_p,
                ctypes.c_int,
                ctypes.c_float,
                ctypes.c_float,
            ]
            self.lib.mbe_neo_set_tuning.restype = None

    def set_settings(self, spectral_enh: bool = True, high_band_gain_db: float = 0.5, unvoiced_gain_db: float = -1.5, **kwargs):
        """
        Configure AMBE+2 speech synthesis parameters in mbelib-neo:
        - spectral_enh: bool (formant peak/valley contrast enhancement)
        - high_band_gain_db: 0..+6 dB (2500..3800 Hz harmonic scaling)
        - unvoiced_gain_db: -4..+4 dB (WOLA FFT unvoiced gain)
        """
        self.spectral_enh = bool(spectral_enh)
        self.high_band_gain_db = max(0.0, min(6.0, float(high_band_gain_db)))
        self.unvoiced_gain_db = max(-4.0, min(4.0, float(unvoiced_gain_db)))

        high_band_linear = math.pow(10.0, self.high_band_gain_db / 20.0)
        unvoiced_linear = math.pow(10.0, self.unvoiced_gain_db / 20.0)

        if self.lib and hasattr(self.lib, "mbe_neo_set_tuning"):
            for ctx in self._slots.values():
                if ctx:
                    try:
                        self.lib.mbe_neo_set_tuning(
                            ctx,
                            1 if self.spectral_enh else 0,
                            ctypes.c_float(high_band_linear),
                            ctypes.c_float(unvoiced_linear)
                        )
                    except Exception as e:
                        logger.error(f"[VOCODER] Error setting mbe_neo tuning: {e}")

    def reset_slot(self, slot: int):
        ctx = self._slots.get(slot)
        if ctx and self.lib:
            try:
                self.lib.mbe_neo_reset(ctx)
            except Exception:
                pass
        self._last_sample_per_slot[slot] = 0.0
        self._last_slope_per_slot[slot] = 0.0

    def decode_burst_with_meta(self, payload: bytes, slot: int = 1) -> Tuple[bytes, list]:
        """
        Decodes DMR 33-byte burst into 960 bytes (480 samples @ 8kHz) + metadata list.
        """
        if not self.is_ready or len(payload) < 33:
            return b"", []

        ctx = self._slots.get(slot)
        if not ctx:
            return b"", []

        try:
            burst_dict = dmr_decode.voice(payload[:33])
            ambe_frames = burst_dict.get("AMBE")
            if not ambe_frames or len(ambe_frames) != 3:
                return b"", []

            burst_samples = []
            meta_list = []

            for ambe72 in ambe_frames:
                # Pack 72 bits into 9 bytes for standard DMR deinterleaver
                raw9 = bytearray(9)
                for b_i in range(9):
                    val = 0
                    for bit_i in range(8):
                        val = (val << 1) | (1 if ambe72[b_i * 8 + bit_i] else 0)
                    raw9[b_i] = val

                c_buf = (ctypes.c_uint8 * 9).from_buffer_copy(bytes(raw9))
                self.lib.mbe_neo_decode_72(
                    ctx,
                    c_buf,
                    self._out160,
                    ctypes.byref(self._meta_c)
                )

                burst_samples.extend(self._out160)

                w0 = float(self._meta_c.w0)
                f0 = (w0 * 8000.0) / (2.0 * math.pi) if w0 > 0 else 0.0
                L = int(self._meta_c.L)
                vb = int(self._meta_c.voiced_bands)
                voiced = (float(vb) / float(L)) if L > 0 else 0.0

                meta_list.append({
                    "f0_hz": f0,
                    "voiced_ratio": voiced,
                    "rms": 0.0,
                    "errs": int(self._meta_c.c0_errors),
                    "errs2": int(self._meta_c.total_errors),
                    "repeat": int(self._meta_c.repeat)
                })

            if burst_samples:
                self._last_sample_per_slot[slot] = float(burst_samples[-1])
                self._last_slope_per_slot[slot] = float(burst_samples[-1] - burst_samples[-2]) if len(burst_samples) >= 2 else 0.0

            pcm_out = np.clip(burst_samples, -32768, 32767).astype(np.int16).tobytes()
            return pcm_out, meta_list
        except Exception as e:
            logger.debug(f"[VOCODER] Error decoding DMR burst on slot {slot}: {e}")
            return b"", []

    def decode_ysf_vd2(self, ambe49_list: list, slot: int = 1) -> Tuple[bytes, float]:
        """
        Decodes five 49-bit AMBE+2 vectors (100ms voice frame in VD mode 2)
        into 8000 Hz 16-bit mono PCM (800 samples = 1600 bytes) using mbelib-neo's
        mbe_neo_decode_49.
        """
        if not self.is_ready or not self.lib:
            return bytes(1600), 0.0

        ctx = self._slots.get(slot) or self._slots.get(1)
        if not ctx:
            return bytes(1600), 0.0

        pcm_all = bytearray()
        total_sq = 0.0
        total_samples = 0

        for ambe49 in ambe49_list:
            if not ambe49 or len(ambe49) < 49:
                pcm_all.extend(b"\x00" * 320)
                continue
            c_buf = bytes(ambe49[:49])
            try:
                self.lib.mbe_neo_decode_49(
                    ctx,
                    c_buf,
                    self._out160,
                    ctypes.byref(self._meta_c)
                )
                pcm_all.extend(bytes(self._out160))
                for s in self._out160:
                    total_sq += (s / 32768.0) ** 2
                total_samples += 160
            except Exception as err:
                logger.debug(f"[VOCODER] YSF VD2 vector decode error: {err}")
                pcm_all.extend(b"\x00" * 320)

        rms = math.sqrt(total_sq / max(1, total_samples)) if total_samples > 0 else 0.0
        if len(pcm_all) < 1600:
            pcm_all.extend(b"\x00" * (1600 - len(pcm_all)))
        return bytes(pcm_all[:1600]), float(min(1.0, max(0.0, rms)))

    def decode_ysf_vd1(self, ambe72_list: list, slot: int = 1) -> Tuple[bytes, float]:
        """
        Decodes five 72-bit (9-byte) AMBE+2 frames (100ms voice frame in VD mode 1)
        into 8000 Hz 16-bit mono PCM (800 samples = 1600 bytes) via mbe_neo_decode_72.
        """
        if not self.is_ready or not self.lib:
            return bytes(1600), 0.0

        ctx = self._slots.get(slot) or self._slots.get(1)
        if not ctx:
            return bytes(1600), 0.0

        pcm_all = bytearray()
        total_sq = 0.0
        total_samples = 0

        for raw9 in ambe72_list:
            if not raw9 or len(raw9) < 9:
                pcm_all.extend(b"\x00" * 320)
                continue
            c_buf = (ctypes.c_uint8 * 9).from_buffer_copy(bytes(raw9[:9]))
            try:
                self.lib.mbe_neo_decode_72(
                    ctx,
                    c_buf,
                    self._out160,
                    ctypes.byref(self._meta_c)
                )
                pcm_all.extend(bytes(self._out160))
                for s in self._out160:
                    total_sq += (s / 32768.0) ** 2
                total_samples += 160
            except Exception as err:
                logger.debug(f"[VOCODER] YSF VD1 frame decode error: {err}")
                pcm_all.extend(b"\x00" * 320)

        rms = math.sqrt(total_sq / max(1, total_samples)) if total_samples > 0 else 0.0
        if len(pcm_all) < 1600:
            pcm_all.extend(b"\x00" * (1600 - len(pcm_all)))
        return bytes(pcm_all[:1600]), float(min(1.0, max(0.0, rms)))

    def decode_ysf_vw(self, imbe144_list: list, slot: int = 1) -> Tuple[bytes, float]:
        """
        Decodes up to five 144-bit (18-byte) Full-Rate IMBE frames (YSF VW / dt=3)
        into 8000 Hz 16-bit mono PCM via mbe_neo_decode_imbe_144.
        """
        if not self.is_ready or not self.lib or not hasattr(self.lib, "mbe_neo_decode_imbe_144"):
            return bytes(len(imbe144_list or []) * 320), 0.0

        ctx = self._slots.get(slot) or self._slots.get(1)
        if not ctx or not imbe144_list:
            return b"", 0.0

        pcm_all = bytearray()
        total_sq = 0.0
        total_samples = 0

        for raw18 in imbe144_list:
            if not raw18 or len(raw18) < 18:
                pcm_all.extend(b"\x00" * 320)
                continue
            c_buf = (ctypes.c_uint8 * 18).from_buffer_copy(bytes(raw18[:18]))
            try:
                self.lib.mbe_neo_decode_imbe_144(
                    ctx,
                    c_buf,
                    self._out160,
                    ctypes.byref(self._meta_c)
                )
                pcm_all.extend(bytes(self._out160))
                for s in self._out160:
                    total_sq += (s / 32768.0) ** 2
                total_samples += 160
            except Exception as err:
                logger.debug(f"[VOCODER] YSF VW IMBE frame decode error: {err}")
                pcm_all.extend(b"\x00" * 320)

        rms = math.sqrt(total_sq / max(1, total_samples)) if total_samples > 0 else 0.0
        return bytes(pcm_all), float(min(1.0, max(0.0, rms)))

    def decode_ysf_frame(self, subframes: list, slot: int = 1) -> Tuple[bytes, float]:
        """
        Backwards-compatible wrapper calling decode_ysf_vd2.
        """
        return self.decode_ysf_vd2(subframes, slot=slot)

    def decode_erasure_burst(self, slot: int = 1) -> Tuple[bytes, list]:
        """
        Synthesizes a 60ms (480 samples @ 8kHz) erasure burst using mbelib-neo's
        native Packet Loss Concealment (PLC). Repeats pitch and spectral envelope
        with standard -2.5 dB attenuation and phase-continuous synthesis.
        """
        if not self.is_ready:
            return b"\x00" * 960, []

        ctx = self._slots.get(slot)
        if not ctx:
            return b"\x00" * 960, []

        try:
            # ETSI / TIA-102 AMBE+2 erasure frame bit pattern in ambe_d (49 bits):
            # b0 = 127 (bits 0, 1, 2, 3, 37, 38, 39 = 1), bit 4 = 0 (not tone frame).
            # Triggers MBE_AMBE2450_FRAME_ERASURE and MBE_PROCESS_FLAG_REPEAT.
            ambe_d = bytearray(49)
            for b in (0, 1, 2, 3, 37, 38, 39):
                ambe_d[b] = 1
            ambe_d_bytes = bytes(ambe_d)

            burst_samples = []
            meta_list = []
            prev_s = self._last_sample_per_slot.get(slot, 0.0)
            prev_slope = self._last_slope_per_slot.get(slot, 0.0)

            for _ in range(3):
                self.lib.mbe_neo_decode_49(
                    ctx,
                    ambe_d_bytes,
                    self._out160,
                    ctypes.byref(self._meta_c)
                )

                frame = list(self._out160)
                if frame:
                    cur_s = float(frame[0])
                    if abs(cur_s - prev_s) > 1200:
                        fade_len = min(4, len(frame))
                        for k in range(fade_len):
                            w = 0.5 * (1.0 - math.cos(math.pi * (k + 1) / (fade_len + 1)))
                            ext = prev_s + (k + 1) * prev_slope * 0.5
                            frame[k] = int(round(ext * (1.0 - w) + frame[k] * w))

                    if len(frame) >= 2:
                        prev_s = float(frame[-1])
                        prev_slope = float(frame[-1] - frame[-2])
                    elif len(frame) == 1:
                        prev_s = float(frame[-1])
                        prev_slope = 0.0

                burst_samples.extend(frame)

                w0 = float(self._meta_c.w0)
                f0 = (w0 * 8000.0) / (2.0 * math.pi) if w0 > 0 else 0.0
                L = int(self._meta_c.L)
                vb = int(self._meta_c.voiced_bands)
                voiced = (float(vb) / float(L)) if L > 0 else 0.0

                meta_list.append({
                    "f0_hz": f0,
                    "voiced_ratio": voiced,
                    "rms": 0.0,
                    "errs": 4,
                    "errs2": 4,
                    "repeat": 1,
                    "plc": True
                })

            self._last_sample_per_slot[slot] = prev_s
            self._last_slope_per_slot[slot] = prev_slope

            pcm_out = np.clip(burst_samples, -32768, 32767).astype(np.int16).tobytes()
            return pcm_out, meta_list
        except Exception as e:
            logger.debug(f"[VOCODER] Error in decode_erasure_burst on slot {slot}: {e}")
            return b"\x00" * 960, []

    def decode_burst(self, payload: bytes, slot: int = 1) -> bytes:
        pcm, _ = self.decode_burst_with_meta(payload, slot)
        return pcm

    def close(self):
        if self.lib and hasattr(self, "_slots"):
            for ctx in self._slots.values():
                if ctx:
                    try:
                        self.lib.mbe_neo_destroy(ctx)
                    except Exception:
                        pass
            self._slots.clear()
        self.is_ready = False

    def __del__(self):
        try:
            self.close()
        except Exception:
            pass
