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
    last_speech_time: float = 0.0   # Stream timestamp of last active speech
    stream_time: float = 0.0        # Cumulative audio stream time in seconds
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

        # Target level & peak ceiling guard (prevents high-crest speech from clipping)
        self.target_rms: float = TARGET_RMS
        self.peak_ceiling: float = 24000.0

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

    def process_float_samples(
        self,
        samples: list[float],
        slot: int = 1,
        apply_soft_clip: bool = False,
    ) -> list[float]:
        """
        Process a list of float PCM samples (int16 amplitude scale, 8000 Hz) in-place.
        Uses stream-synchronous timing and peak-ceiling protection so high-crest
        speech is never boosted into clipping.
        """
        if not self.enabled or not samples:
            return samples

        num_samples = len(samples)
        state = self.slots.get(slot)
        if state is None:
            state = SlotAgcState()
            self.slots[slot] = state

        chunk_dur = max(0.005, min(0.200, num_samples / 8000.0))
        state.stream_time += chunk_dur
        now = state.stream_time

        attack_alpha = math.exp(-chunk_dur / 0.060)
        decay_alpha = math.exp(-chunk_dur / 0.600)
        release_alpha = math.exp(-chunk_dur / max(0.100, self.decay_time))

        # ── Step 1: Calculate RMS and Peak of this chunk ──
        sum_sq = 0.0
        chunk_peak = 0.0
        for s in samples:
            sum_sq += s * s
            abs_s = -s if s < 0.0 else s
            if abs_s > chunk_peak:
                chunk_peak = abs_s
        chunk_rms = math.sqrt(sum_sq / num_samples)

        # ── Step 2: Speech detection (Schmitt trigger with hysteresis) ──
        if not state.is_speech_active:
            if chunk_rms >= self.speech_threshold:
                state.is_speech_active = True
        else:
            if chunk_rms < self.noise_gate:
                state.is_speech_active = False

        # ── Step 3: Compute target gain with Peak-Ceiling Guard ──
        target_gain = 1.0

        if state.is_speech_active:
            state.last_speech_time = now

            if not state.initialized:
                state.envelope = chunk_rms
                state.initialized = True
            elif chunk_rms > state.envelope:
                state.envelope = (
                    attack_alpha * state.envelope
                    + (1.0 - attack_alpha) * chunk_rms
                )
            else:
                state.envelope = (
                    decay_alpha * state.envelope
                    + (1.0 - decay_alpha) * chunk_rms
                )

            safe_env = max(10.0, state.envelope)
            in_db = 20.0 * math.log10(safe_env / 32768.0)
            target_db = 20.0 * math.log10(self.target_rms / 32768.0)
            diff_db = target_db - in_db

            if diff_db > 0:
                gain_db = min(self.max_gain_db, diff_db * self.boost_ratio)
            else:
                gain_db = max(self.min_gain_db, diff_db * self.atten_ratio)

            target_gain = 10.0 ** (gain_db / 20.0)

            # Peak-ceiling guard: never amplify high-crest speech peaks above peak_ceiling
            if self.peak_ceiling > 0.0 and chunk_peak > 1.0:
                if (chunk_peak * target_gain) > self.peak_ceiling:
                    min_lin = 10.0 ** (self.min_gain_db / 20.0)
                    safe_peak_gain = max(min_lin, self.peak_ceiling / chunk_peak)
                    if safe_peak_gain < target_gain:
                        target_gain = safe_peak_gain

            state.current_gain = target_gain

        else:
            elapsed = (
                (now - state.last_speech_time)
                if state.last_speech_time > 0.0
                else 999.0
            )

            if elapsed < self.hang_time:
                target_gain = state.current_gain
            else:
                state.current_gain = (
                    release_alpha * state.current_gain
                    + (1.0 - release_alpha) * 1.0
                )
                state.envelope = (
                    release_alpha * state.envelope
                    + (1.0 - release_alpha) * 0.0
                )
                target_gain = state.current_gain

            if self.peak_ceiling > 0.0 and chunk_peak > 1.0 and (chunk_peak * target_gain) > self.peak_ceiling:
                min_lin = 10.0 ** (self.min_gain_db / 20.0)
                target_gain = min(target_gain, max(min_lin, self.peak_ceiling / chunk_peak))

        # ── Step 4: Apply gain with sample-by-sample interpolation ──
        start_gain = state.last_applied_gain
        gain_step = (target_gain - start_gain) / num_samples
        curr_gain = start_gain
        soft_knee = 24576.0
        soft_headroom = 8191.0

        for i in range(num_samples):
            curr_gain += gain_step
            sample = samples[i] * curr_gain

            if apply_soft_clip:
                if sample > soft_knee:
                    over = sample - soft_knee
                    sample = soft_knee + soft_headroom * math.tanh(over / soft_headroom)
                elif sample < -soft_knee:
                    over = sample + soft_knee
                    sample = -soft_knee + soft_headroom * math.tanh(over / soft_headroom)

                if sample > INT16_MAX:
                    sample = float(INT16_MAX)
                elif sample < INT16_MIN:
                    sample = float(INT16_MIN)

            samples[i] = sample

        state.last_applied_gain = target_gain
        return samples

    def process_burst(self, pcm_bytes: bytes, slot: int = 1) -> bytes:
        """
        Process a PCM burst (16-bit signed LE, 8000 Hz).

        Returns processed PCM bytes with AGC and soft-clipping applied.
        If AGC is disabled or input is invalid, returns original bytes unchanged.
        """
        if not self.enabled:
            return pcm_bytes

        num_samples = len(pcm_bytes) // 2
        if num_samples == 0:
            return pcm_bytes

        samples = [float(s) for s in struct.unpack(f"<{num_samples}h", pcm_bytes)]
        self.process_float_samples(samples, slot=slot, apply_soft_clip=True)
        int_samples = [int(s) for s in samples]
        return struct.pack(f"<{num_samples}h", *int_samples)


# ─── AudioRX-Matched Recording AGC (1:1 port of dmr-audio-processor.js) ───────

@dataclass
class RxRecAgcState:
    """Per-(user, hotspot, slot) streaming AGC state for server-side RX recordings."""
    envelope: float = 0.0
    initialized: bool = False
    is_speech: bool = False
    last_speech_time: float = 0.0
    stream_time: float = 0.0
    current_gain: float = 1.0
    last_applied_gain: float = 1.0
    last_wall_time: float = 0.0

    def reset(self) -> None:
        self.envelope = 0.0
        self.initialized = False
        self.is_speech = False
        self.last_speech_time = 0.0
        self.stream_time = 0.0
        self.current_gain = 1.0
        self.last_applied_gain = 1.0


def process_rx_recording_pcm16(
    pcm_bytes: bytes,
    state: RxRecAgcState,
    agc_cfg: Optional[dict] = None,
) -> bytes:
    """
    Process 16-bit signed LE 8000 Hz RX PCM using the hotspot's AudioRX AGC profile:
      - enabled (agcEnable): bool
      - depth_db (agcDepth): 6..30 dB
      - gain_raw (agcGain): 10..120 (1.0x..12.0x)
      - limiter_enabled (limiterEnable): bool
    Mirrors src/static/js/worklets/dmr-audio-processor.js so saved history WAVs
    match live AudioRX loudness without affecting the live stream.
    """
    if not pcm_bytes:
        return pcm_bytes
    num_samples = len(pcm_bytes) // 2
    if num_samples == 0:
        return pcm_bytes

    now_mono = time.monotonic()
    if state.last_wall_time > 0.0 and (now_mono - state.last_wall_time) > 0.600:
        state.reset()
    state.last_wall_time = now_mono

    raw_ints = struct.unpack(f"<{num_samples}h", pcm_bytes[: num_samples * 2])
    in_samples = [0.0] * num_samples
    sum_sq = 0.0
    chunk_peak = 0.0
    inv_scale = 1.0 / 32768.0
    for i in range(num_samples):
        s = raw_ints[i] * inv_scale
        in_samples[i] = s
        sum_sq += s * s
        abs_s = -s if s < 0.0 else s
        if abs_s > chunk_peak:
            chunk_peak = abs_s

    cfg = agc_cfg if isinstance(agc_cfg, dict) else {}
    agc_enabled = bool(cfg.get("enabled", True))
    try:
        depth_db = max(6.0, min(30.0, float(cfg.get("depth_db", 18.0))))
    except (TypeError, ValueError):
        depth_db = 18.0
    try:
        gain_raw = max(10.0, min(120.0, float(cfg.get("gain_raw", 35.0))))
    except (TypeError, ValueError):
        gain_raw = 35.0
    limiter_enabled = bool(cfg.get("limiter_enabled", True))
    gain_mult = gain_raw / 10.0

    chunk_dur = max(0.005, min(0.200, num_samples / 8000.0))
    state.stream_time += chunk_dur
    agc_now = state.stream_time

    target_gain = 1.0
    if not agc_enabled:
        target_gain = min(4.0, max(0.4, gain_mult / 2.5))
        if chunk_peak > 0.001 and (chunk_peak * target_gain) > 1.05:
            target_gain = max(0.4, min(target_gain, 1.05 / chunk_peak))
        state.current_gain = target_gain
    else:
        chunk_rms = math.sqrt(sum_sq / num_samples)
        if not state.is_speech:
            if chunk_rms >= 0.006:
                state.is_speech = True
        elif chunk_rms < 0.0038:
            state.is_speech = False

        max_gain_db = depth_db
        min_gain_db = -min(16.0, float(round(depth_db * 0.8)))
        boost_ratio = min(1.0, 0.55 + (depth_db / 48.0))
        atten_ratio = 0.85
        target_rms = min(0.42, max(0.08, 0.065 * gain_mult))

        if state.is_speech:
            state.last_speech_time = agc_now
            att_alpha = math.exp(-chunk_dur / 0.045)
            dec_alpha = math.exp(-chunk_dur / 0.500)
            if not state.initialized:
                state.envelope = chunk_rms
                state.initialized = True
            elif chunk_rms > state.envelope:
                state.envelope = att_alpha * state.envelope + (1.0 - att_alpha) * chunk_rms
            else:
                state.envelope = dec_alpha * state.envelope + (1.0 - dec_alpha) * chunk_rms

            in_db = 20.0 * math.log10(max(0.001, state.envelope))
            target_db = 20.0 * math.log10(target_rms)
            diff_db = target_db - in_db
            if diff_db > 0.0:
                gain_db = min(max_gain_db, diff_db * boost_ratio)
            else:
                gain_db = max(min_gain_db, diff_db * atten_ratio)
            if gain_mult > 6.0:
                gain_db += 20.0 * math.log10(1.0 + (gain_mult - 6.0) * 0.12)
            target_gain = 10.0 ** (gain_db / 20.0)

            if chunk_peak > 0.001 and (chunk_peak * target_gain) > 0.96:
                min_lin = 10.0 ** (min_gain_db / 20.0)
                target_gain = max(min_lin, min(target_gain, 0.96 / chunk_peak))
            state.current_gain = target_gain
        else:
            elapsed = (agc_now - state.last_speech_time) if state.last_speech_time > 0.0 else 999.0
            if elapsed < 0.35:
                target_gain = state.current_gain
            else:
                rel_alpha = math.exp(-chunk_dur / 0.500)
                state.current_gain = rel_alpha * state.current_gain + (1.0 - rel_alpha) * 1.0
                state.envelope = rel_alpha * state.envelope
                target_gain = state.current_gain
            if chunk_peak > 0.001 and (chunk_peak * target_gain) > 0.96:
                min_lin = 10.0 ** (min_gain_db / 20.0)
                target_gain = max(min_lin, min(target_gain, 0.96 / chunk_peak))

    start_gain = state.last_applied_gain
    gain_step = (target_gain - start_gain) / num_samples
    curr_gain = start_gain
    out_ints = [0] * num_samples
    tanh = math.tanh
    for i in range(num_samples):
        curr_gain += gain_step
        s = in_samples[i] * curr_gain
        if limiter_enabled:
            if s > 0.82:
                s = 0.82 + 0.18 * tanh((s - 0.82) / 0.18)
            elif s < -0.82:
                s = -0.82 + 0.18 * tanh((s + 0.82) / 0.18)
        v = int(round(s * 32768.0))
        if v > INT16_MAX:
            v = INT16_MAX
        elif v < INT16_MIN:
            v = INT16_MIN
        out_ints[i] = v

    state.last_applied_gain = target_gain
    return struct.pack(f"<{num_samples}h", *out_ints)
