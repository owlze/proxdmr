"""
DMR AMBE+2 Software Vocoder Decoder for ProxDMR
Powered by DSD-FME (Digital Speech Decoder - Florida Man Edition) Core
Decodes DMR 33-byte voice bursts into 16-bit PCM @ 8000 Hz with high-quality formant enhancement and soft limiting.
"""

import ctypes
import ctypes.util
import logging
import os
from typing import Optional, Dict, Any

logger = logging.getLogger("proxdmr.vocoder")

try:
    import dmr_utils3.decode as dmr_decode
    import dmr_utils3.ambe_utils as ambe_utils
    DMR_UTILS_AVAILABLE = True
except ImportError:
    dmr_decode = None
    ambe_utils = None
    DMR_UTILS_AVAILABLE = False
    logger.warning("[VOCODER] dmr_utils3 not found. Voice burst unpacking will be disabled.")


class DMRVocoderDecoder:
    """
    DSD-FME based AMBE+2 Vocoder Decoder for DMR.
    Decodes DMR 33-byte voice bursts (3 AMBE frames) into 8000 Hz 16-bit mono PCM (960 bytes = 60 ms).
    Maintains separate vocoder state and synthesis parameters for TS1 and TS2.
    """

    def __init__(self):
        self.lib = self._load_library()
        self.is_ready = False
        self._slots: Dict[int, Any] = {}

        # Default DSD-FME parameters
        self.uvquality = 3
        self.spectral_enh = True
        self.float_mode = True
        self.max_repeats = 3
        self.repeat_decay = 0.75
        self.fec_tolerance = 1
        self.audio_gain = 7.0

        if self.lib and DMR_UTILS_AVAILABLE:
            try:
                self._setup_c_signatures()
                self._slots[1] = self.lib.dsdfme_decoder_create()
                self._slots[2] = self.lib.dsdfme_decoder_create()
                self._apply_params_to_all_slots()
                self.is_ready = True
                logger.info("[VOCODER] DSD-FME AMBE+2 Decoder initialized successfully (TS1/TS2)")
            except Exception as e:
                logger.error(f"[VOCODER] Failed to initialize DSD-FME decoder contexts: {e}")
        else:
            if not self.lib:
                logger.warning("[VOCODER] libambe_vocoder.so not found. DSD-FME Decoder is NOT available")
            if not DMR_UTILS_AVAILABLE:
                logger.warning("[VOCODER] dmr_utils3 is not available")

    def _load_library(self) -> Optional[ctypes.CDLL]:
        candidates = [
            "/usr/local/lib/libambe_vocoder.so",
            "/app/src/c_vocoder/libambe_vocoder.so",
            os.path.join(os.path.dirname(__file__), "..", "c_vocoder", "libambe_vocoder.so"),
            "libambe_vocoder.so",
            ctypes.util.find_library("ambe_vocoder"),
        ]

        for path in candidates:
            if not path:
                continue
            try:
                lib = ctypes.CDLL(path)
                logger.info(f"[VOCODER] Loaded DSD-FME vocoder library from {path}")
                return lib
            except Exception:
                continue

        return None

    def _setup_c_signatures(self):
        self.lib.dsdfme_decoder_create.restype = ctypes.c_void_p
        self.lib.dsdfme_decoder_destroy.argtypes = [ctypes.c_void_p]

        self.lib.dsdfme_decoder_reset.argtypes = [ctypes.c_void_p]

        self.lib.dsdfme_decoder_set_params.argtypes = [
            ctypes.c_void_p,
            ctypes.c_int,    # uvquality
            ctypes.c_int,    # spectral_enh
            ctypes.c_int,    # float_mode
            ctypes.c_int,    # max_repeats
            ctypes.c_float,  # repeat_decay
            ctypes.c_int,    # fec_tolerance
            ctypes.c_float,  # audio_gain
        ]

        self.lib.dsdfme_decoder_decode_49bit.argtypes = [
            ctypes.c_void_p,
            ctypes.c_char_p,                  # ambe_49bit (49 bytes 0/1)
            ctypes.POINTER(ctypes.c_int16),   # pcm_160 (160 samples)
        ]
        self.lib.dsdfme_decoder_decode_49bit.restype = ctypes.c_int

    def _apply_params_to_all_slots(self):
        if not self.lib:
            return
        for ctx in self._slots.values():
            if ctx:
                self.lib.dsdfme_decoder_set_params(
                    ctx,
                    int(self.uvquality),
                    1 if self.spectral_enh else 0,
                    1 if self.float_mode else 0,
                    int(self.max_repeats),
                    float(self.repeat_decay),
                    int(self.fec_tolerance),
                    float(self.audio_gain),
                )

    def set_settings(
        self,
        uvquality: int = 3,
        spectral_enh: bool = True,
        float_mode: bool = True,
        max_repeats: int = 3,
        repeat_decay: float = 0.75,
        fec_tolerance: int = 1,
        audio_gain: float = 7.0
    ):
        """Dynamically update DSD-FME synthesis parameters."""
        self.uvquality = max(1, min(8, int(uvquality)))
        self.spectral_enh = bool(spectral_enh)
        self.float_mode = bool(float_mode)
        self.max_repeats = max(0, min(10, int(max_repeats)))
        self.repeat_decay = max(0.50, min(1.00, float(repeat_decay)))
        self.fec_tolerance = max(0, min(2, int(fec_tolerance)))
        self.audio_gain = max(1.0, min(8.0, float(audio_gain)))
        self._apply_params_to_all_slots()
        logger.info(
            f"[VOCODER] DSD-FME params updated: uvquality={self.uvquality}, "
            f"spectral_enh={self.spectral_enh}, float_mode={self.float_mode}, "
            f"max_repeats={self.max_repeats}, repeat_decay={self.repeat_decay}, "
            f"fec_tolerance={self.fec_tolerance}, audio_gain={self.audio_gain}"
        )

    def reset_slot(self, slot: int):
        """Reset vocoder filter state for a given timeslot (TS1 or TS2) on transmission end."""
        ctx = self._slots.get(slot)
        if ctx and self.lib:
            try:
                self.lib.dsdfme_decoder_reset(ctx)
            except Exception:
                pass

    def decode_burst(self, payload: bytes, slot: int = 1) -> bytes:
        """
        Decodes a 33-byte DMR voice burst (3 AMBE frames) into 960 bytes of 16-bit PCM @ 8000 Hz.
        """
        if not self.is_ready or len(payload) < 33:
            return b""

        ctx = self._slots.get(slot)
        if not ctx:
            return b""

        try:
            burst_dict = dmr_decode.voice(payload[:33])
            ambe_frames = burst_dict.get("AMBE")
            if not ambe_frames or len(ambe_frames) != 3:
                return b""

            pcm_out = bytearray()
            pcm_160 = (ctypes.c_int16 * 160)()

            for ambe72 in ambe_frames:
                ambe49 = ambe_utils.convert72BitTo49BitAMBE(ambe72)
                raw_49_bytes = bytes([1 if b else 0 for b in ambe49])

                self.lib.dsdfme_decoder_decode_49bit(
                    ctx,
                    raw_49_bytes,
                    pcm_160,
                )
                pcm_out.extend(bytes(pcm_160))

            return bytes(pcm_out)

        except Exception as e:
            logger.debug(f"[VOCODER] Error decoding DMR burst on slot {slot}: {e}")
            return b""

    def close(self):
        """Explicitly release C-allocated vocoder contexts. Call when done with hotspot."""
        if self.lib and hasattr(self, "_slots"):
            for ctx in self._slots.values():
                if ctx:
                    try:
                        self.lib.dsdfme_decoder_destroy(ctx)
                    except Exception:
                        pass
            self._slots.clear()
        self.is_ready = False

    def __del__(self):
        self.close()
