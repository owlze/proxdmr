"""
Server-side Audio AGC (Automatic Gain Control) for DMR RX audio.

Classical amateur radio DSP AGC operating on 16-bit PCM @ 8000 Hz.
Processes 60ms bursts (480 samples) from the AMBE vocoder decoder.

Key design features:
- Per-slot (TS1/TS2) independent envelope tracking and gain control
- Schmitt trigger speech detector with hysteresis
- Fast attack (60ms) for speech onset, smooth decay (600ms) for syllabic tracking
- Hang time to freeze gain during natural inter-word pauses
- Sample-by-sample gain interpolation (anti-zipper noise)
- Soft limiter (tanh) to prevent int16 overflow
- Configurable profiles: soft, standard, deep, max

Fixes all bugs from the previous JavaScript client-side implementation:
1. Correct negative dB clamping (no Math.max(0, negative) bug)
2. Envelope initializes from actual signal (no artificial 0.16 bias)
3. Per-chunk release decay (no cumulative time bug)
4. Lower speech threshold (-44 dBFS vs -36 dBFS) to detect weak stations
"""

import math
import struct
import time
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger(__name__)

# ─── Constants ────────────────────────────────────────────────────────────────

CHUNK_DURATION = 0.06       # 60 ms per DMR voice burst (3 AMBE frames)
SAMPLES_PER_BURST = 480     # 3 frames × 160 samples @ 8000 Hz
BYTES_PER_BURST = 960       # 480 samples × 2 bytes (int16)

TARGET_RMS = 5200.0         # Nominal comfortable level (~-16 dBFS on int16 scale)
SPEECH_THRESHOLD = 200.0    # Speech activity detection (~-44 dBFS)
NOISE_GATE = 120.0          # Hysteresis release gate (~-49 dBFS)

SOFT_CLIP_THRESHOLD = 30000 # Start soft clipping above this (leaves 767 headroom)
INT16_MAX = 32767
INT16_MIN = -32768

# Pre-computed exponential smoothing alphas for 60ms chunk interval
ATTACK_ALPHA = math.exp(-CHUNK_DURATION / 0.060)   # 60ms attack (1 chunk convergence)
DECAY_ALPHA = math.exp(-CHUNK_DURATION / 0.600)     # 600ms syllabic decay
RELEASE_ALPHA = math.exp(-CHUNK_DURATION / 0.600)   # 600ms return to unity (per-chunk!)

# ─── AGC Profiles ─────────────────────────────────────────────────────────────

AGC_PROFILES: dict[str, dict] = {
    "soft": {
        "min_gain_db": -8.0,
        "max_gain_db": 8.0,
        "boost_ratio": 0.65,
        "atten_ratio": 0.65,
        "hang_time": 0.30,
    },
    "standard": {
        "min_gain_db": -12.0,
        "max_gain_db": 12.0,
        "boost_ratio": 0.85,
        "atten_ratio": 0.85,
        "hang_time": 0.35,
    },
    "deep": {
        "min_gain_db": -18.0,
        "max_gain_db": 18.0,
        "boost_ratio": 0.95,
        "atten_ratio": 0.95,
        "hang_time": 0.40,
    },
    "max": {
        "min_gain_db": -24.0,
        "max_gain_db": 24.0,
        "boost_ratio": 1.00,
        "atten_ratio": 1.00,
        "hang_time": 0.45,
    },
}


# ─── Per-Slot State ───────────────────────────────────────────────────────────

@dataclass
class SlotAgcState:
    """Independent AGC state for one timeslot (TS1 or TS2)."""
    envelope: float = 0.0           # Running speech envelope (int16 RMS scale)
    current_gain: float = 1.0       # Current linear gain multiplier
    last_applied_gain: float = 1.0  # Last gain applied (for interpolation)
    last_speech_time: float = 0.0   # monotonic timestamp of last speech
    is_speech_active: bool = False  # Schmitt trigger state
    initialized: bool = False       # Whether envelope has been initialized


# ─── Server Audio AGC ─────────────────────────────────────────────────────────

class ServerAudioAgc:
    """
    Server-side AGC processor for DMR audio.

    Each HotspotRuntime should own one instance.
    Slots (TS1, TS2) are tracked independently.
    """

    def __init__(self):
        self.enabled: bool = True
        self.profile: str = "standard"

        # Target level
        self.target_rms: float = TARGET_RMS

        # Speech detector thresholds
        self.speech_threshold: float = SPEECH_THRESHOLD
        self.noise_gate: float = NOISE_GATE

        # Gain range (dB)
        self.min_gain_db: float = -12.0   # Max attenuation for loud stations
        self.max_gain_db: float = 12.0    # Max boost for quiet stations

        # Compression curve factors (0.0 = no compression, 1.0 = full compression)
        self.boost_ratio: float = 0.85
        self.atten_ratio: float = 0.85

        # Timing
        self.hang_time: float = 0.35      # 350ms hang (freeze gain in pauses)
        self.decay_time: float = 0.60     # 600ms release back to unity

        # Per-slot state
        self.slots: dict[int, SlotAgcState] = {
            1: SlotAgcState(),
            2: SlotAgcState(),
        }

    # ─── Profile & Parameter Management ───────────────────────────────────

    def set_profile(self, name: str) -> None:
        """Switch to a named AGC profile."""
        if name not in AGC_PROFILES:
            name = "standard"
        self.profile = name
        prof = AGC_PROFILES[name]
        self.min_gain_db = prof["min_gain_db"]
        self.max_gain_db = prof["max_gain_db"]
        self.boost_ratio = prof["boost_ratio"]
        self.atten_ratio = prof["atten_ratio"]
        self.hang_time = prof["hang_time"]

    def set_params(
        self,
        min_gain_db: Optional[float] = None,
        max_gain_db: Optional[float] = None,
        hang_time: Optional[float] = None,
    ) -> None:
        """Set custom AGC parameters (marks profile as 'custom')."""
        if min_gain_db is not None:
            # FIX for bug #1: store as negative directly, no Math.max(0, negative)
            self.min_gain_db = -abs(min(30.0, abs(float(min_gain_db))))
            self.atten_ratio = min(1.0, 0.50 + abs(self.min_gain_db) / 48.0)
        if max_gain_db is not None:
            self.max_gain_db = abs(min(30.0, abs(float(max_gain_db))))
            self.boost_ratio = min(1.0, 0.50 + self.max_gain_db / 48.0)
        if hang_time is not None:
            self.hang_time = max(0.1, min(2.0, float(hang_time)))
        self.profile = "custom"

    def get_settings(self) -> dict:
        """Return current AGC settings for client synchronization."""
        return {
            "enabled": self.enabled,
            "profile": self.profile,
            "min_gain_db": self.min_gain_db,
            "max_gain_db": self.max_gain_db,
            "hang_time": self.hang_time,
        }

    def reset_slot(self, slot: int) -> None:
        """Reset AGC state for a slot (call ended / timeout)."""
        if slot in self.slots:
            self.slots[slot] = SlotAgcState()

    # ─── Core Processing ──────────────────────────────────────────────────

    def process_burst(self, pcm_bytes: bytes, slot: int = 1) -> bytes:
        """
        Process a 960-byte PCM burst (480 samples, 16-bit signed LE, 8000 Hz).

        Returns processed PCM bytes with AGC applied.
        If AGC is disabled or input is invalid, returns original bytes unchanged.
        """
        if not self.enabled:
            return pcm_bytes

        num_samples = len(pcm_bytes) // 2
        if num_samples == 0:
            return pcm_bytes

        # Unpack int16 samples
        samples = list(struct.unpack(f"<{num_samples}h", pcm_bytes))

        # Get or create slot state
        state = self.slots.get(slot)
        if state is None:
            state = SlotAgcState()
            self.slots[slot] = state

        now = time.monotonic()

        # ── Step 1: Calculate RMS of this chunk ──
        sum_sq = 0.0
        for s in samples:
            sum_sq += s * s
        chunk_rms = math.sqrt(sum_sq / num_samples)

        # ── Step 2: Speech detection (Schmitt trigger with hysteresis) ──
        if not state.is_speech_active:
            if chunk_rms >= self.speech_threshold:
                state.is_speech_active = True
        else:
            if chunk_rms < self.noise_gate:
                state.is_speech_active = False

        # ── Step 3: Compute target gain ──
        target_gain = 1.0

        if state.is_speech_active:
            state.last_speech_time = now

            # FIX for bug #2: Initialize envelope from actual signal, not fixed 0.16
            if not state.initialized:
                state.envelope = chunk_rms
                state.initialized = True
            elif chunk_rms > state.envelope:
                # Attack: fast (60ms = 1 chunk) to catch speech onset
                state.envelope = (
                    ATTACK_ALPHA * state.envelope
                    + (1.0 - ATTACK_ALPHA) * chunk_rms
                )
            else:
                # Decay: smooth (600ms) for syllabic tracking
                state.envelope = (
                    DECAY_ALPHA * state.envelope
                    + (1.0 - DECAY_ALPHA) * chunk_rms
                )

            # Logarithmic dynamic range compression
            safe_env = max(10.0, state.envelope)  # Floor at ~-70 dBFS
            in_db = 20.0 * math.log10(safe_env / 32768.0)
            target_db = 20.0 * math.log10(self.target_rms / 32768.0)  # ~-16 dBFS
            diff_db = target_db - in_db

            if diff_db > 0:
                # Boost quiet speech (clamped to max_gain_db)
                gain_db = min(self.max_gain_db, diff_db * self.boost_ratio)
            else:
                # Attenuate loud speech (clamped to min_gain_db which is negative)
                # FIX for bug #1: min_gain_db is properly stored as negative value
                gain_db = max(self.min_gain_db, diff_db * self.atten_ratio)

            target_gain = 10.0 ** (gain_db / 20.0)
            state.current_gain = target_gain

        else:
            # Pause or background noise
            elapsed = (
                (now - state.last_speech_time)
                if state.last_speech_time > 0
                else 999.0
            )

            if elapsed < self.hang_time:
                # Hang: freeze current gain during natural inter-word pauses
                target_gain = state.current_gain
            else:
                # FIX for bug #3: Per-chunk release decay (NOT cumulative!)
                # Use fixed dt = CHUNK_DURATION, not cumulative elapsed time
                state.current_gain = (
                    RELEASE_ALPHA * state.current_gain
                    + (1.0 - RELEASE_ALPHA) * 1.0
                )
                state.envelope = (
                    RELEASE_ALPHA * state.envelope
                    + (1.0 - RELEASE_ALPHA) * 0.0
                )
                target_gain = state.current_gain

        # ── Step 4: Apply gain with sample-by-sample interpolation ──
        start_gain = state.last_applied_gain
        gain_step = (target_gain - start_gain) / num_samples
        curr_gain = start_gain

        for i in range(num_samples):
            curr_gain += gain_step
            sample = samples[i] * curr_gain

            # Soft clipping with tanh above 30000 (leaves 767 headroom for tanh)
            if sample > SOFT_CLIP_THRESHOLD:
                over = sample - SOFT_CLIP_THRESHOLD
                sample = SOFT_CLIP_THRESHOLD + 767.0 * math.tanh(over / 3000.0)
            elif sample < -SOFT_CLIP_THRESHOLD:
                over = sample + SOFT_CLIP_THRESHOLD
                sample = -SOFT_CLIP_THRESHOLD + 767.0 * math.tanh(over / 3000.0)

            # Hard clamp to int16 range
            if sample > INT16_MAX:
                sample = INT16_MAX
            elif sample < INT16_MIN:
                sample = INT16_MIN

            samples[i] = int(sample)

        state.last_applied_gain = target_gain

        # ── Step 5: Pack back to bytes ──
        return struct.pack(f"<{num_samples}h", *samples)
