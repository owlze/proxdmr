"""
svx_opus.py - ctypes wrapper around libopus for SVXReflector audio RX/TX pipeline.
Handles 8000 Hz 16-bit mono PCM decode/encode for SvxLink audio frames.
"""

import ctypes
import ctypes.util
import logging
import os
from typing import Optional, List

logger = logging.getLogger("proxdmr.svx_opus")

# Opus constants
OPUS_APPLICATION_VOIP = 2048
OPUS_SET_BITRATE_REQUEST = 4002
OPUS_SET_VBR_REQUEST = 4006
OPUS_SET_COMPLEXITY_REQUEST = 4010
OPUS_SET_SIGNAL_REQUEST = 4024
OPUS_SIGNAL_VOICE = 3001

_libopus: Optional[ctypes.CDLL] = None
_libopus_loaded = False


def _load_libopus() -> Optional[ctypes.CDLL]:
    global _libopus, _libopus_loaded
    if _libopus_loaded:
        return _libopus
    _libopus_loaded = True

    candidates = [
        "/usr/lib/aarch64-linux-gnu/libopus.so.0",
        "/usr/lib/x86_64-linux-gnu/libopus.so.0",
        "/usr/local/lib/libopus.so.0",
        "/usr/lib/libopus.so.0",
        "libopus.so.0",
        "libopus.so",
        "opus",
    ]
    found = ctypes.util.find_library("opus")
    if found:
        candidates.insert(0, found)

    for path in candidates:
        try:
            lib = ctypes.CDLL(path)
            # Check key symbols
            if hasattr(lib, "opus_decoder_create") and hasattr(lib, "opus_encoder_create"):
                logger.info(f"[SVX_OPUS] Successfully loaded libopus from {path}")
                _libopus = lib
                _setup_signatures(lib)
                return _libopus
        except Exception:
            continue

    logger.warning("[SVX_OPUS] libopus not found on host. SVXReflector Opus audio codec will operate in stub mode.")
    return None


def _setup_signatures(lib: ctypes.CDLL):
    lib.opus_decoder_create.argtypes = [ctypes.c_int32, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    lib.opus_decoder_create.restype = ctypes.c_void_p

    lib.opus_decoder_destroy.argtypes = [ctypes.c_void_p]
    lib.opus_decoder_destroy.restype = None

    lib.opus_decode.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_int32,
        ctypes.POINTER(ctypes.c_int16),
        ctypes.c_int,
        ctypes.c_int,
    ]
    lib.opus_decode.restype = ctypes.c_int

    lib.opus_encoder_create.argtypes = [ctypes.c_int32, ctypes.c_int, ctypes.c_int, ctypes.POINTER(ctypes.c_int)]
    lib.opus_encoder_create.restype = ctypes.c_void_p

    lib.opus_encoder_destroy.argtypes = [ctypes.c_void_p]
    lib.opus_encoder_destroy.restype = None

    lib.opus_encode.argtypes = [
        ctypes.c_void_p,
        ctypes.POINTER(ctypes.c_int16),
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_uint8),
        ctypes.c_int32,
    ]
    lib.opus_encode.restype = ctypes.c_int

    # Variable argument ctl
    lib.opus_encoder_ctl.restype = ctypes.c_int


class SvxOpusCodec:
    """
    SvxLink Opus codec wrapper for 8000 Hz 16-bit mono audio.
    SvxReflector sends 20ms..60ms Opus frames.
    At 8000 Hz, 20ms is 160 samples (320 bytes).
    """

    def __init__(self, sample_rate: int = 8000, channels: int = 1, bitrate: int = 20000):
        self.sample_rate = sample_rate
        self.channels = channels
        self.bitrate = bitrate

        self.lib = _load_libopus()
        self.dec = None
        self.enc = None
        self.is_ready = False

        if self.lib:
            try:
                err = ctypes.c_int(0)
                self.dec = self.lib.opus_decoder_create(self.sample_rate, self.channels, ctypes.byref(err))
                if err.value != 0 or not self.dec:
                    logger.error(f"[SVX_OPUS] opus_decoder_create failed with error {err.value}")
                    self.dec = None

                self.enc = self.lib.opus_encoder_create(
                    self.sample_rate, self.channels, OPUS_APPLICATION_VOIP, ctypes.byref(err)
                )
                if err.value != 0 or not self.enc:
                    logger.error(f"[SVX_OPUS] opus_encoder_create failed with error {err.value}")
                    self.enc = None

                if self.enc:
                    # Set bitrate to 20 kbps (standard for SVXReflector)
                    self.lib.opus_encoder_ctl(self.enc, OPUS_SET_BITRATE_REQUEST, ctypes.c_int(self.bitrate))
                    self.lib.opus_encoder_ctl(self.enc, OPUS_SET_VBR_REQUEST, ctypes.c_int(1))
                    self.lib.opus_encoder_ctl(self.enc, OPUS_SET_SIGNAL_REQUEST, ctypes.c_int(OPUS_SIGNAL_VOICE))
                    self.lib.opus_encoder_ctl(self.enc, OPUS_SET_COMPLEXITY_REQUEST, ctypes.c_int(5))

                if self.dec and self.enc:
                    self.is_ready = True
                    logger.info("[SVX_OPUS] SvxOpusCodec initialized successfully")
            except Exception as e:
                logger.error(f"[SVX_OPUS] Initialization exception: {e}")

    def decode(self, opus_bytes: bytes, max_samples: int = 960) -> bytes:
        """
        Decodes incoming Opus packet into 16-bit mono PCM at 8000 Hz.
        max_samples default 960 = 120ms buffer at 8000 Hz.
        Returns bytes of 16-bit signed PCM (2 bytes per sample).
        """
        if not self.is_ready or not self.dec or not opus_bytes:
            return b""

        in_len = len(opus_bytes)
        c_in = (ctypes.c_uint8 * in_len)(*opus_bytes)
        c_out = (ctypes.c_int16 * max_samples)()

        try:
            samples_decoded = self.lib.opus_decode(
                self.dec,
                c_in,
                in_len,
                c_out,
                max_samples,
                0  # decode_fec = 0
            )
            if samples_decoded > 0:
                return ctypes.string_at(c_out, samples_decoded * 2)
            return b""
        except Exception as e:
            logger.debug(f"[SVX_OPUS] Decode error: {e}")
            return b""

    def encode(self, pcm320: bytes) -> bytes:
        """
        Encodes 20ms of 16-bit 8000 Hz PCM (160 samples = 320 bytes) into an Opus frame.
        """
        if not self.is_ready or not self.enc or not pcm320 or len(pcm320) < 320:
            return b""

        frame_size = 160  # 20ms @ 8000 Hz
        c_pcm = (ctypes.c_int16 * frame_size).from_buffer_copy(pcm320[:320])
        max_bytes = 512
        c_out = (ctypes.c_uint8 * max_bytes)()

        try:
            bytes_encoded = self.lib.opus_encode(
                self.enc,
                c_pcm,
                frame_size,
                c_out,
                max_bytes
            )
            if bytes_encoded > 0:
                return ctypes.string_at(c_out, bytes_encoded)
            return b""
        except Exception as e:
            logger.debug(f"[SVX_OPUS] Encode error: {e}")
            return b""

    def reset(self):
        """Reset internal decoder/encoder states."""
        # opus does not require explicit reset call, recreating if needed or ctl reset
        pass

    def close(self):
        if self.lib:
            if self.dec:
                try:
                    self.lib.opus_decoder_destroy(self.dec)
                except Exception:
                    pass
                self.dec = None
            if self.enc:
                try:
                    self.lib.opus_encoder_destroy(self.enc)
                except Exception:
                    pass
                self.enc = None
        self.is_ready = False

    def __del__(self):
        self.close()
