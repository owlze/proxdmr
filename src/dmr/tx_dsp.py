"""
Server-side DSP processing for DMR TX (Microphone -> DMR Network).

Processes 16-bit PCM @ 8000 Hz in 60ms bursts (480 samples = 960 bytes)
immediately before passing audio to the AMBE vocoder encoder.

Blocks included:
1. HPF (High-Pass Filter): 300 Hz low-cut filter to eliminate microphone breath pops and low-frequency rumble.
2. Presence Boost: Peaking EQ @ 2200 Hz (Q=1.2, 0..+6 dB) for enhanced speech intelligibility.
3. Digital Mic Gain: 0..+12 dB calibrated pre-amplification.
4. TX DSP AGC: Classical amateur radio DSP compressor with fast attack (60ms), syllabic release (600ms),
   and pause hang-time (350ms) to freeze gain during inter-word silence (preventing noise pump-up).
5. Soft-clipping limiter (tanh) for transparent headroom protection before AMBE encoding.
"""

import math
import struct
import logging
from typing import Optional

from dmr.audio_equalizer import BiquadFilter, FS, SOFT_CLIP_THRESHOLD, INT16_MAX, INT16_MIN
from dmr.audio_agc import ServerAudioAgc

logger = logging.getLogger(__name__)


class ServerTxDsp:
    """Complete server-side DSP chain for microphone audio."""

    def __init__(self):
        # Settings
        self.hpf_enabled: bool = True
        self.presence_boost: float = 3.0  # dB (default: +3 dB)
        self.mic_gain_db: float = 0.0     # dB (0..+12 dB)
        self.dsp_agc_enabled: bool = False

        # Internal multipliers
        self._linear_gain: float = 1.0

        # DSP Filter nodes
        self.hpf_filter = BiquadFilter()
        self.presence_filter = BiquadFilter()

        # Dedicated Server AGC instance for microphone audio
        self.agc = ServerAudioAgc()
        self.agc.enabled = False
        self.agc.set_profile("standard")

        self._update_dsp_nodes()

    def _update_dsp_nodes(self) -> None:
        """Update biquad filter coefficients and linear gains."""
        if self.hpf_enabled:
            self.hpf_filter.setup_highpass(300.0, 0.7071, FS)
        else:
            self.hpf_filter.active = False

        if self.presence_boost > 0.05:
            # Peaking EQ centered at 2200 Hz, Q=1.2
            self.presence_filter.setup_peaking(2200.0, 1.2, self.presence_boost, FS)
        else:
            self.presence_filter.active = False

        self._linear_gain = 10.0 ** (self.mic_gain_db / 20.0)
        self.agc.enabled = self.dsp_agc_enabled

    def set_settings(
        self,
        hpf_enabled: Optional[bool] = None,
        presence_boost: Optional[float] = None,
        mic_gain: Optional[float] = None,
        dsp_agc: Optional[bool] = None,
        agc_profile: Optional[str] = None,
    ) -> None:
        """Update TX DSP parameters on the fly."""
        changed = False
        if hpf_enabled is not None:
            val = bool(hpf_enabled)
            if val != self.hpf_enabled:
                self.hpf_enabled = val
                changed = True
        if presence_boost is not None:
            val = max(0.0, min(12.0, float(presence_boost)))
            if abs(val - self.presence_boost) > 0.05:
                self.presence_boost = val
                changed = True
        if mic_gain is not None:
            val = max(0.0, min(12.0, float(mic_gain)))
            if abs(val - self.mic_gain_db) > 0.05:
                self.mic_gain_db = val
                changed = True
        if dsp_agc is not None:
            val = bool(dsp_agc)
            if val != self.dsp_agc_enabled:
                self.dsp_agc_enabled = val
                changed = True
        if agc_profile is not None and agc_profile:
            self.agc.set_profile(str(agc_profile))

        if changed:
            self._update_dsp_nodes()

    def reset(self) -> None:
        """Reset internal filter states and AGC when starting or ending transmission."""
        self.hpf_filter.reset()
        self.presence_filter.reset()
        self.agc.reset_slot(1)

    def get_settings(self) -> dict:
        """Return current TX DSP settings."""
        return {
            "hpf_enabled": self.hpf_enabled,
            "presence_boost": self.presence_boost,
            "mic_gain": self.mic_gain_db,
            "dsp_agc": self.dsp_agc_enabled,
            "agc_profile": self.agc.profile,
        }

    def process_burst(self, pcm_bytes: bytes) -> bytes:
        """
        Process a 960-byte PCM burst (480 samples, 16-bit signed LE, 8000 Hz).

        Chain:
        HPF 300 Hz -> Presence Boost 2200 Hz -> Mic Gain -> Soft Limiter -> TX DSP AGC
        """
        num_samples = len(pcm_bytes) // 2
        if num_samples == 0:
            return pcm_bytes

        # If all DSP features are disabled, pass through directly
        if (
            not self.hpf_enabled
            and not self.presence_filter.active
            and abs(self.mic_gain_db) < 0.05
            and not self.dsp_agc_enabled
        ):
            return pcm_bytes

        samples = list(struct.unpack(f"<{num_samples}h", pcm_bytes))

        hpf = self.hpf_filter
        pres = self.presence_filter
        gain = self._linear_gain
        apply_gain = abs(gain - 1.0) > 0.005

        for i in range(num_samples):
            s = float(samples[i])

            # 1. High-Pass Filter (300 Hz)
            if hpf.active:
                s = hpf.process_sample(s)

            # 2. Presence Boost (2200 Hz)
            if pres.active:
                s = pres.process_sample(s)

            # 3. Digital Mic Gain
            if apply_gain:
                s *= gain

            # 4. Soft Limiter (tanh) above 30000 to prevent harsh digital clipping
            if s > SOFT_CLIP_THRESHOLD:
                over = s - SOFT_CLIP_THRESHOLD
                s = SOFT_CLIP_THRESHOLD + 767.0 * math.tanh(over / 3000.0)
            elif s < -SOFT_CLIP_THRESHOLD:
                over = s + SOFT_CLIP_THRESHOLD
                s = -SOFT_CLIP_THRESHOLD + 767.0 * math.tanh(over / 3000.0)

            if s > INT16_MAX:
                s = INT16_MAX
            elif s < INT16_MIN:
                s = INT16_MIN

            samples[i] = int(s)

        out_pcm = struct.pack(f"<{num_samples}h", *samples)

        # 5. TX AGC (automatic leveling with pause freeze)
        if self.dsp_agc_enabled:
            out_pcm = self.agc.process_burst(out_pcm, slot=1)

        return out_pcm
