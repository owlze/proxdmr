"""
M17 Codec2 Vocoder wrapper via ctypes (no external Python dependencies).
Supports CODEC2_MODE_3200 (mode 0, 20ms=160 samples -> 8 bytes; 2 frames = 40ms/640B PCM16 <-> 16B)
and CODEC2_MODE_1600 (mode 2, 40ms=320 samples -> 8 bytes voice + 8 bytes aux = 16B).
"""

import ctypes
import ctypes.util
import logging
import threading
from typing import Optional

logger = logging.getLogger("proxdmr.m17.codec")

CODEC2_MODE_3200 = 0
CODEC2_MODE_1600 = 2

_LIB_LOCK = threading.Lock()
_LIB_LOADED = False
_LIB_CODEC2: Optional[ctypes.CDLL] = None


def _load_codec2_lib() -> Optional[ctypes.CDLL]:
    global _LIB_LOADED, _LIB_CODEC2
    if _LIB_LOADED:
        return _LIB_CODEC2
    with _LIB_LOCK:
        if _LIB_LOADED:
            return _LIB_CODEC2
        candidates = []
        found = ctypes.util.find_library("codec2")
        if found:
            candidates.append(found)
        candidates.extend([
            "libcodec2.so.1.2",
            "libcodec2.so.1.0",
            "libcodec2.so.0.9",
            "libcodec2.so",
            "codec2.dll",
        ])
        lib = None
        for name in candidates:
            try:
                lib = ctypes.CDLL(name)
                if lib is not None:
                    logger.info(f"[M17-CODEC2] Loaded shared library: {name}")
                    break
            except OSError:
                continue

        if lib is not None:
            try:
                lib.codec2_create.argtypes = [ctypes.c_int]
                lib.codec2_create.restype = ctypes.c_void_p

                lib.codec2_destroy.argtypes = [ctypes.c_void_p]
                lib.codec2_destroy.restype = None

                lib.codec2_encode.argtypes = [
                    ctypes.c_void_p,
                    ctypes.POINTER(ctypes.c_ubyte),
                    ctypes.POINTER(ctypes.c_int16),
                ]
                lib.codec2_encode.restype = None

                lib.codec2_decode.argtypes = [
                    ctypes.c_void_p,
                    ctypes.POINTER(ctypes.c_int16),
                    ctypes.POINTER(ctypes.c_ubyte),
                ]
                lib.codec2_decode.restype = None

                lib.codec2_samples_per_frame.argtypes = [ctypes.c_void_p]
                lib.codec2_samples_per_frame.restype = ctypes.c_int

                lib.codec2_bits_per_frame.argtypes = [ctypes.c_void_p]
                lib.codec2_bits_per_frame.restype = ctypes.c_int
            except Exception as e:
                logger.warning(f"[M17-CODEC2] Failed binding symbols: {e}")
                lib = None
        else:
            logger.warning("[M17-CODEC2] libcodec2 shared library not found; M17 audio will be silent")

        _LIB_CODEC2 = lib
        _LIB_LOADED = True
        return _LIB_CODEC2


class M17Codec2:
    """Thread-safe Codec2 wrapper with separate RX/TX states for 3200 and 1600 bps."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._rx_3200: Optional[int] = None
        self._tx_3200: Optional[int] = None
        self._rx_1600: Optional[int] = None
        self._tx_1600: Optional[int] = None

    @staticmethod
    def is_available() -> bool:
        return _load_codec2_lib() is not None

    def _get_state_locked(self, direction: str, mode: str) -> Optional[int]:
        lib = _load_codec2_lib()
        if lib is None:
            return None
        is_1600 = str(mode) == "1600"
        c_mode = CODEC2_MODE_1600 if is_1600 else CODEC2_MODE_3200
        attr = f"_{direction}_{'1600' if is_1600 else '3200'}"
        state = getattr(self, attr, None)
        if not state:
            state = lib.codec2_create(c_mode)
            setattr(self, attr, state)
        return state

    def decode_40ms(self, payload16: bytes, mode: str = "3200") -> bytes:
        """Decode 16-byte M17 Codec2 payload into 640 bytes (40ms @ 8000 Hz, 16-bit mono PCM)."""
        if not payload16 or len(payload16) < 16:
            return b"\x00" * 640
        lib = _load_codec2_lib()
        if lib is None:
            return b"\x00" * 640

        is_1600 = str(mode) == "1600"
        with self._lock:
            state = self._get_state_locked("rx", "1600" if is_1600 else "3200")
            if not state:
                return b"\x00" * 640
            if not is_1600:
                speech1 = (ctypes.c_int16 * 160)()
                speech2 = (ctypes.c_int16 * 160)()
                bits1 = (ctypes.c_ubyte * 8).from_buffer_copy(payload16[0:8])
                bits2 = (ctypes.c_ubyte * 8).from_buffer_copy(payload16[8:16])
                lib.codec2_decode(state, speech1, bits1)
                lib.codec2_decode(state, speech2, bits2)
                return ctypes.string_at(speech1, 320) + ctypes.string_at(speech2, 320)
            else:
                speech = (ctypes.c_int16 * 320)()
                bits = (ctypes.c_ubyte * 8).from_buffer_copy(payload16[0:8])
                lib.codec2_decode(state, speech, bits)
                return ctypes.string_at(speech, 640)

    def encode_40ms(
        self,
        pcm640: bytes,
        mode: str = "3200",
        aux_data8: bytes = b"\x00" * 8,
    ) -> bytes:
        """Encode 640 bytes (40ms @ 8000 Hz, 16-bit mono PCM) into 16-byte M17 payload."""
        lib = _load_codec2_lib()
        if lib is None:
            return b"\x00" * 16

        if not pcm640:
            pcm_buf = b"\x00" * 640
        elif len(pcm640) < 640:
            pcm_buf = pcm640 + b"\x00" * (640 - len(pcm640))
        else:
            pcm_buf = pcm640[:640]

        is_1600 = str(mode) == "1600"
        with self._lock:
            state = self._get_state_locked("tx", "1600" if is_1600 else "3200")
            if not state:
                return b"\x00" * 16
            if not is_1600:
                speech1 = (ctypes.c_int16 * 160).from_buffer_copy(pcm_buf[0:320])
                speech2 = (ctypes.c_int16 * 160).from_buffer_copy(pcm_buf[320:640])
                bits1 = (ctypes.c_ubyte * 8)()
                bits2 = (ctypes.c_ubyte * 8)()
                lib.codec2_encode(state, bits1, speech1)
                lib.codec2_encode(state, bits2, speech2)
                return bytes(bits1) + bytes(bits2)
            else:
                speech = (ctypes.c_int16 * 320).from_buffer_copy(pcm_buf)
                bits = (ctypes.c_ubyte * 8)()
                lib.codec2_encode(state, bits, speech)
                aux = (aux_data8 or b"")[:8].ljust(8, b"\x00")
                return bytes(bits) + aux

    def reset(self, direction: Optional[str] = None) -> None:
        """Destroy and reset Codec2 filter states between calls."""
        lib = _load_codec2_lib()
        attrs = []
        if direction in (None, "rx"):
            attrs.extend(["_rx_3200", "_rx_1600"])
        if direction in (None, "tx"):
            attrs.extend(["_tx_3200", "_tx_1600"])
        with self._lock:
            for attr in attrs:
                state = getattr(self, attr, None)
                if state and lib is not None:
                    try:
                        lib.codec2_destroy(state)
                    except Exception:
                        pass
                setattr(self, attr, None)

    def close(self) -> None:
        self.reset(None)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
