"""
Server-side 3-band Equalizer and De-emphasis filter for DMR RX audio.

Operates on 16-bit PCM @ 8000 Hz in 60ms DMR bursts (480 samples).
Uses standard Robert Bristow-Johnson (RBJ) Audio EQ Cookbook biquad filters
implemented in Direct Form II Transposed topology.

Key features:
- Independent filter states for Timeslot 1 (TS1) and Timeslot 2 (TS2)
- State preservation (s1, s2) across 60ms bursts for click-free filtering
- Instant zero-overhead bypass when all bands are at 0 dB and deemphasis is off
- Soft-clipping limiter (tanh) preventing int16 digital overflow
- Mathematical equivalence to standard W3C Web Audio API BiquadFilterNode
"""

import math
import struct
import logging
from typing import Optional

logger = logging.getLogger(__name__)

FS = 8000.0  # DMR audio sample rate: 8000 Hz (Nyquist: 4000 Hz)
SOFT_CLIP_THRESHOLD = 30000.0
INT16_MAX = 32767
INT16_MIN = -32768


class BiquadFilter:
    """
    Direct Form II Transposed IIR Biquad filter.

    Difference equations:
        y[n] = b0 * x[n] + s1
        s1   = b1 * x[n] - a1 * y[n] + s2
        s2   = b2 * x[n] - a2 * y[n]
    """

    __slots__ = ("b0", "b1", "b2", "a1", "a2", "s1", "s2", "active")

    def __init__(self):
        self.b0: float = 1.0
        self.b1: float = 0.0
        self.b2: float = 0.0
        self.a1: float = 0.0
        self.a2: float = 0.0
        self.s1: float = 0.0
        self.s2: float = 0.0
        self.active: bool = False

    def reset(self) -> None:
        """Reset internal filter state."""
        self.s1 = 0.0
        self.s2 = 0.0

    def set_coefficients(
        self, b0: float, b1: float, b2: float, a0: float, a1: float, a2: float
    ) -> None:
        """Normalize coefficients by a0."""
        inv_a0 = 1.0 / a0
        self.b0 = b0 * inv_a0
        self.b1 = b1 * inv_a0
        self.b2 = b2 * inv_a0
        self.a1 = a1 * inv_a0
        self.a2 = a2 * inv_a0

    def setup_lowshelf(self, f0: float, gain_db: float, fs: float = FS) -> None:
        """RBJ Low-shelf filter."""
        if abs(gain_db) < 0.05:
            self.active = False
            return
        self.active = True
        A = 10.0 ** (gain_db / 40.0)
        w0 = 2.0 * math.pi * f0 / fs
        cos_w0 = math.cos(w0)
        sin_w0 = math.sin(w0)
        alpha = (sin_w0 / 2.0) * math.sqrt(2.0)
        beta = 2.0 * math.sqrt(A) * alpha

        b0 = A * ((A + 1.0) - (A - 1.0) * cos_w0 + beta)
        b1 = 2.0 * A * ((A - 1.0) - (A + 1.0) * cos_w0)
        b2 = A * ((A + 1.0) - (A - 1.0) * cos_w0 - beta)
        a0 = (A + 1.0) + (A - 1.0) * cos_w0 + beta
        a1 = -2.0 * ((A - 1.0) + (A + 1.0) * cos_w0)
        a2 = (A + 1.0) + (A - 1.0) * cos_w0 - beta

        self.set_coefficients(b0, b1, b2, a0, a1, a2)

    def setup_peaking(
        self, f0: float, Q: float, gain_db: float, fs: float = FS
    ) -> None:
        """RBJ Peaking EQ filter."""
        if abs(gain_db) < 0.05:
            self.active = False
            return
        self.active = True
        A = 10.0 ** (gain_db / 40.0)
        w0 = 2.0 * math.pi * f0 / fs
        cos_w0 = math.cos(w0)
        sin_w0 = math.sin(w0)
        alpha = sin_w0 / (2.0 * Q)

        b0 = 1.0 + alpha * A
        b1 = -2.0 * cos_w0
        b2 = 1.0 - alpha * A
        a0 = 1.0 + alpha / A
        a1 = -2.0 * cos_w0
        a2 = 1.0 - alpha / A

        self.set_coefficients(b0, b1, b2, a0, a1, a2)

    def setup_highshelf(self, f0: float, gain_db: float, fs: float = FS) -> None:
        """RBJ High-shelf filter."""
        if abs(gain_db) < 0.05:
            self.active = False
            return
        self.active = True
        A = 10.0 ** (gain_db / 40.0)
        w0 = 2.0 * math.pi * f0 / fs
        cos_w0 = math.cos(w0)
        sin_w0 = math.sin(w0)
        alpha = (sin_w0 / 2.0) * math.sqrt(2.0)
        beta = 2.0 * math.sqrt(A) * alpha

        b0 = A * ((A + 1.0) + (A - 1.0) * cos_w0 + beta)
        b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cos_w0)
        b2 = A * ((A + 1.0) + (A - 1.0) * cos_w0 - beta)
        a0 = (A + 1.0) - (A - 1.0) * cos_w0 + beta
        a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cos_w0)
        a2 = (A + 1.0) - (A - 1.0) * cos_w0 - beta

        self.set_coefficients(b0, b1, b2, a0, a1, a2)

    def setup_lowpass(self, f0: float, Q: float = 0.7071, fs: float = FS) -> None:
        """RBJ Lowpass filter (used for FM de-emphasis emulation)."""
        self.active = True
        w0 = 2.0 * math.pi * f0 / fs
        cos_w0 = math.cos(w0)
        sin_w0 = math.sin(w0)
        alpha = sin_w0 / (2.0 * Q)

        b0 = (1.0 - cos_w0) / 2.0
        b1 = 1.0 - cos_w0
        b2 = (1.0 - cos_w0) / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w0
        a2 = 1.0 - alpha

        self.set_coefficients(b0, b1, b2, a0, a1, a2)

    def setup_highpass(self, f0: float, Q: float = 0.7071, fs: float = FS) -> None:
        """RBJ Highpass filter (used for microphone HPF low-cut)."""
        self.active = True
        w0 = 2.0 * math.pi * f0 / fs
        cos_w0 = math.cos(w0)
        sin_w0 = math.sin(w0)
        alpha = sin_w0 / (2.0 * Q)

        b0 = (1.0 + cos_w0) / 2.0
        b1 = -(1.0 + cos_w0)
        b2 = (1.0 + cos_w0) / 2.0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w0
        a2 = 1.0 - alpha

        self.set_coefficients(b0, b1, b2, a0, a1, a2)

    def process_sample(self, x: float) -> float:
        """Process a single sample through Direct Form II Transposed filter."""
        y = self.b0 * x + self.s1
        self.s1 = self.b1 * x - self.a1 * y + self.s2
        self.s2 = self.b2 * x - self.a2 * y
        return y


class SlotEqualizerState:
    """Filter bank for one DMR timeslot."""

    def __init__(self):
        self.low_filter = BiquadFilter()
        self.mid_filter = BiquadFilter()
        self.high_filter = BiquadFilter()
        self.deemph_filter = BiquadFilter()

    def reset(self) -> None:
        self.low_filter.reset()
        self.mid_filter.reset()
        self.high_filter.reset()
        self.deemph_filter.reset()


class ServerAudioEqualizer:
    """
    3-Band Equalizer + De-emphasis processor for DMR RX audio.

    Each HotspotRuntime owns one instance.
    Timeslots 1 and 2 maintain independent filter memory.
    """

    def __init__(self):
        self.eq_low: float = 0.0
        self.eq_mid: float = 0.0
        self.eq_high: float = 0.0
        self.deemphasis: bool = False
        self.is_bypass: bool = True

        self.slots: dict[int, SlotEqualizerState] = {
            1: SlotEqualizerState(),
            2: SlotEqualizerState(),
        }
        self._update_coefficients()

    def set_params(
        self,
        low_db: Optional[float] = None,
        mid_db: Optional[float] = None,
        high_db: Optional[float] = None,
        deemphasis: Optional[bool] = None,
    ) -> None:
        """Update equalizer parameters."""
        changed = False
        if low_db is not None:
            clamped_low = max(-12.0, min(12.0, float(low_db)))
            if abs(clamped_low - self.eq_low) > 0.01:
                self.eq_low = clamped_low
                changed = True
        if mid_db is not None:
            clamped_mid = max(-12.0, min(12.0, float(mid_db)))
            if abs(clamped_mid - self.eq_mid) > 0.01:
                self.eq_mid = clamped_mid
                changed = True
        if high_db is not None:
            clamped_high = max(-12.0, min(12.0, float(high_db)))
            if abs(clamped_high - self.eq_high) > 0.01:
                self.eq_high = clamped_high
                changed = True
        if deemphasis is not None:
            new_deemph = bool(deemphasis)
            if new_deemph != self.deemphasis:
                self.deemphasis = new_deemph
                changed = True

        if changed:
            self._update_coefficients()

    def _update_coefficients(self) -> None:
        """Recalculate filter coefficients across all slot instances."""
        self.is_bypass = (
            abs(self.eq_low) < 0.05
            and abs(self.eq_mid) < 0.05
            and abs(self.eq_high) < 0.05
            and not self.deemphasis
        )

        for state in self.slots.values():
            state.low_filter.setup_lowshelf(300.0, self.eq_low, FS)
            state.mid_filter.setup_peaking(1000.0, 1.0, self.eq_mid, FS)
            state.high_filter.setup_highshelf(3000.0, self.eq_high, FS)
            if self.deemphasis:
                # Standard FM de-emphasis roll-off modeled as 1200 Hz lowpass (Q=0.707)
                state.deemph_filter.setup_lowpass(1200.0, 0.7071, FS)
            else:
                state.deemph_filter.active = False

    def reset_slot(self, slot: int) -> None:
        """Reset filter states for a slot upon call termination."""
        if slot in self.slots:
            self.slots[slot].reset()

    def get_settings(self) -> dict:
        """Return current equalizer settings."""
        return {
            "eq_low": self.eq_low,
            "eq_mid": self.eq_mid,
            "eq_high": self.eq_high,
            "deemphasis": self.deemphasis,
            "is_bypass": self.is_bypass,
        }

    def process_burst(self, pcm_bytes: bytes, slot: int = 1) -> bytes:
        """
        Filter 960 bytes of 16-bit PCM @ 8000 Hz (480 samples).

        Returns filtered PCM bytes. If in bypass mode, returns original bytes instantly.
        """
        if self.is_bypass:
            return pcm_bytes

        num_samples = len(pcm_bytes) // 2
        if num_samples == 0:
            return pcm_bytes

        state = self.slots.get(slot)
        if state is None:
            state = SlotEqualizerState()
            self.slots[slot] = state
            self._update_coefficients()

        low_f = state.low_filter
        mid_f = state.mid_filter
        high_f = state.high_filter
        deemph_f = state.deemph_filter

        samples = list(struct.unpack(f"<{num_samples}h", pcm_bytes))

        for i in range(num_samples):
            s = float(samples[i])

            if low_f.active:
                s = low_f.process_sample(s)
            if mid_f.active:
                s = mid_f.process_sample(s)
            if high_f.active:
                s = high_f.process_sample(s)
            if deemph_f.active:
                s = deemph_f.process_sample(s)

            # Soft limiter protection (tanh) above 30000
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

        return struct.pack(f"<{num_samples}h", *samples)
