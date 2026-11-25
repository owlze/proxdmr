# -*- coding: utf-8 -*-
"""
ProxDMR Adaptive TTS Tempo Controller & Pitch-Preserving Audio DSP.

Provides:
1. Per-slot virtual playhead tracking (real-time queue backlog estimation in seconds).
2. Self-calibrating per-(engine, voice, lang) speech rate (chars/sec EWMA).
3. Smooth dual-loop tempo control (deadband + backlog feedback + density feed-forward +
   asymmetric slew-rate limiting & hysteresis).
4. Leading/trailing WAV silence trimming (zero-click fades).
5. Pure-NumPy WSOLA pitch-preserving time-stretch for engines without native speed control
   (Silero, Gemini, Groq).
"""

import io
import logging
import math
import threading
import time
import wave
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

try:
    import numpy as np
    from numpy.lib.stride_tricks import sliding_window_view
except ImportError:
    np = None
    sliding_window_view = None

logger = logging.getLogger("proxdmr.tts_tempo")

NATIVE_SPEED_ENGINES = {"piper", "supertonic"}
WSOLA_ENGINES = {"silero", "gemini", "groq"}


@dataclass
class TempoPlan:
    effective_speed: float
    backlog_sec: float
    trim_silence: bool
    turn_pause_ms: int
    use_wsola: bool
    speed_applied_on_server: bool
    client_playback_rate: float


@dataclass
class _SlotTempoState:
    playhead_end_ts: float = 0.0
    current_speed: float = 1.0
    last_update_ts: float = 0.0
    last_backlog_sec: float = 0.0


def read_wav_pcm16(wav_bytes: bytes) -> Optional[Tuple["np.ndarray", int]]:
    """Decode mono 16-bit PCM WAV bytes into (float32 array in [-1, 1], sample_rate)."""
    if np is None or not wav_bytes or len(wav_bytes) < 44:
        return None
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            n_ch = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            sr = wf.getframerate()
            n_frames = wf.getnframes()
            if n_ch != 1 or sampwidth != 2 or sr < 8000 or n_frames <= 0:
                return None
            raw = wf.readframes(n_frames)
        pcm = np.frombuffer(raw, dtype=np.int16)
        if pcm.size == 0:
            return None
        return pcm.astype(np.float32) / 32768.0, int(sr)
    except Exception:
        return None


def write_wav_pcm16(samples_f32: "np.ndarray", sample_rate: int) -> bytes:
    """Encode float32 array in [-1, 1] into mono 16-bit PCM WAV bytes."""
    pcm = np.clip(samples_f32 * 32767.0, -32768.0, 32767.0).astype(np.int16)
    bio = io.BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(pcm.tobytes())
    return bio.getvalue()


def get_wav_duration_sec(wav_bytes: bytes) -> float:
    """Exact duration of a PCM WAV byte buffer in seconds (0.0 on failure)."""
    if not wav_bytes or len(wav_bytes) < 44:
        return 0.0
    try:
        with wave.open(io.BytesIO(wav_bytes), "rb") as wf:
            sr = wf.getframerate()
            n_frames = wf.getnframes()
            if sr > 0 and n_frames > 0:
                return float(n_frames) / float(sr)
    except Exception:
        pass
    return 0.0


def trim_wav_silence(
    wav_bytes: bytes,
    threshold_amp: float = 0.008,
    keep_lead_ms: float = 35.0,
    keep_trail_ms: float = 45.0,
    fade_ms: float = 5.0
) -> bytes:
    """
    Safely trims leading/trailing silence from a 16-bit mono PCM WAV while preserving
    short breathing margins and applying 5 ms zero-click linear edge fades.
    """
    decoded = read_wav_pcm16(wav_bytes)
    if decoded is None:
        return wav_bytes
    samples, sr = decoded
    n = samples.size
    min_samples = int(sr * 0.25)
    if n <= min_samples:
        return wav_bytes

    frame_len = max(1, int(round(sr * 0.010)))  # 10 ms analysis frames
    n_frames = n // frame_len
    if n_frames < 4:
        return wav_bytes

    framed = np.abs(samples[: n_frames * frame_len].reshape(n_frames, frame_len))
    frame_peaks = np.max(framed, axis=1)
    active = np.nonzero(frame_peaks >= threshold_amp)[0]
    if active.size == 0:
        return wav_bytes

    lead_pad = int(round(sr * (keep_lead_ms / 1000.0)))
    trail_pad = int(round(sr * (keep_trail_ms / 1000.0)))
    start_idx = max(0, int(active[0]) * frame_len - lead_pad)
    end_idx = min(n, (int(active[-1]) + 1) * frame_len + trail_pad)

    if (end_idx - start_idx) < min_samples:
        return wav_bytes
    # Skip rewrite if total savings < 60 ms
    if (n - (end_idx - start_idx)) < int(sr * 0.060):
        return wav_bytes

    trimmed = samples[start_idx:end_idx].copy()
    fade_n = min(int(round(sr * (fade_ms / 1000.0))), trimmed.size // 4)
    if fade_n > 1:
        ramp = np.linspace(0.0, 1.0, fade_n, dtype=np.float32)
        if start_idx > 0:
            trimmed[:fade_n] *= ramp
        if end_idx < n:
            trimmed[-fade_n:] *= ramp[::-1]

    return write_wav_pcm16(trimmed, sr)


def _wsola_stretch_f32(samples_f32: "np.ndarray", sample_rate: int, speed: float) -> "np.ndarray":
    """
    Fast pure-NumPy WSOLA (Waveform Similarity Overlap-Add) pitch-preserving time-stretch.
    speed > 1.0 shortens duration while keeping vocal pitch identical.
    """
    n = samples_f32.size
    spd = max(0.75, min(1.80, float(speed)))
    win_len = max(128, int(round(sample_rate * 0.028)))  # ~28 ms window (2-4 pitch periods)
    if win_len % 2 == 1:
        win_len += 1
    syn_hop = win_len // 2
    if n < win_len * 3 or abs(spd - 1.0) < 0.015:
        return samples_f32

    ana_hop_f = syn_hop * spd
    search_rad = max(16, int(round(sample_rate * 0.008)))  # +/- 8 ms similarity search
    step_stride = 2 if sample_rate >= 20000 else 1

    # Periodic Hann window satisfies exact 50% overlap-add COLA = 1.0
    hann = (0.5 * (1.0 - np.cos(2.0 * np.pi * np.arange(win_len, dtype=np.float32) / win_len))).astype(np.float32)
    est_frames = int(math.floor((n - win_len) / ana_hop_f)) + 2
    if est_frames < 2:
        return samples_f32

    out_len = (est_frames - 1) * syn_hop + win_len
    out = np.zeros(out_len, dtype=np.float32)
    out[:win_len] = samples_f32[:win_len] * hann

    # Prefix sum of squares for O(1) candidate window energy computation
    sq_cumsum = np.empty(n + 1, dtype=np.float64)
    sq_cumsum[0] = 0.0
    np.cumsum(samples_f32.astype(np.float64) ** 2, out=sq_cumsum[1:])

    prev_in_pos = 0
    out_pos = syn_hop
    frame_idx = 1

    while True:
        ideal_in = int(round(frame_idx * ana_hop_f))
        if ideal_in + win_len > n:
            break

        nat_pos = prev_in_pos + syn_hop
        best_pos = ideal_in

        if sliding_window_view is not None and nat_pos + syn_hop <= n:
            ref = samples_f32[nat_pos : nat_pos + syn_hop]
            ref_energy = float(sq_cumsum[nat_pos + syn_hop] - sq_cumsum[nat_pos])
            if ref_energy > 1e-6:
                lo = max(0, ideal_in - search_rad)
                hi = min(n - win_len, ideal_in + search_rad)
                if hi > lo:
                    region = samples_f32[lo : hi + syn_hop]
                    wins = sliding_window_view(region, syn_hop)[::step_stride]
                    if wins.shape[0] > 0:
                        dots = wins @ ref
                        starts = np.arange(lo, hi + 1, step_stride)
                        energies = sq_cumsum[starts + syn_hop] - sq_cumsum[starts]
                        norms = np.sqrt(np.maximum(energies, 0.0) + 1e-9)
                        best_idx = int(np.argmax(dots / norms))
                        best_pos = int(starts[best_idx])

        if out_pos + win_len > out.size:
            out = np.pad(out, (0, out_pos + win_len - out.size))
        out[out_pos : out_pos + win_len] += samples_f32[best_pos : best_pos + win_len] * hann
        prev_in_pos = best_pos
        out_pos += syn_hop
        frame_idx += 1

    return out[: out_pos + syn_hop]


def time_stretch_wav_wsola(wav_bytes: bytes, speed: float) -> bytes:
    """
    Applies pitch-preserving WSOLA time-stretch to 16-bit mono PCM WAV bytes.
    Returns original wav_bytes untouched if numpy is unavailable, speed ~= 1.0, or format unsupported.
    """
    if np is None or not wav_bytes or abs(float(speed) - 1.0) < 0.02:
        return wav_bytes
    decoded = read_wav_pcm16(wav_bytes)
    if decoded is None:
        return wav_bytes
    samples, sr = decoded
    try:
        stretched = _wsola_stretch_f32(samples, sr, float(speed))
        if stretched is samples:
            return wav_bytes
        return write_wav_pcm16(stretched, sr)
    except Exception as e:
        logger.debug(f"[TTS_TEMPO] WSOLA stretch fallback ({e})")
        return wav_bytes


class TtsTempoController:
    """
    Dual-loop adaptive speech-tempo controller for live amateur radio TTS.
    Thread-safe; lightweight in-memory state per (hotspot_id, slot).
    """

    DEADBAND_SEC = 1.2
    DEBT_GAIN_PER_SEC = 0.045
    MAX_UP_STEP = 0.06
    URGENT_UP_STEP = 0.10
    MAX_DOWN_STEP = 0.04
    IDLE_RESET_SEC = 12.0
    DEFAULT_CPS_1X = 14.5

    def __init__(self):
        self._lock = threading.Lock()
        self._slots: Dict[Tuple[str, int], _SlotTempoState] = {}
        self._cps_ewma: Dict[Tuple[str, str, str], float] = {}

    @staticmethod
    def _engine_speed_cap(engine: str) -> float:
        eng = (engine or "").lower().strip()
        if eng == "supertonic":
            return 1.40
        if eng in WSOLA_ENGINES:
            return 1.65
        return 1.75

    def reset_slot(self, hid: str, slot: int) -> None:
        key = (str(hid or ""), int(slot or 1))
        with self._lock:
            self._slots.pop(key, None)

    def reset_all(self) -> None:
        with self._lock:
            self._slots.clear()

    def note_auxiliary_wav(self, hid: str, slot: int, wav_bytes: bytes, playback_rate: float = 1.0, now: Optional[float] = None) -> float:
        """Records duration of standalone auxiliary audio (e.g. early callsign announcement) on the virtual playhead."""
        dur = get_wav_duration_sec(wav_bytes)
        if dur <= 0.0:
            return 0.0
        eff_dur = dur / max(0.5, float(playback_rate or 1.0))
        ts = time.time() if now is None else float(now)
        key = (str(hid or ""), int(slot or 1))
        with self._lock:
            st = self._slots.setdefault(key, _SlotTempoState(playhead_end_ts=ts, last_update_ts=ts))
            st.playhead_end_ts = max(ts, st.playhead_end_ts) + eff_dur
            st.last_update_ts = ts
        return dur

    def plan_speed(
        self,
        hid: str,
        slot: int,
        engine: str,
        voice: str,
        lang: str,
        text: str,
        orig_audio_sec: float,
        base_speed: float,
        max_speed: float,
        auto_enabled: bool,
        is_new_turn: bool = False,
        now: Optional[float] = None
    ) -> TempoPlan:
        eng = (engine or "piper").lower().strip()
        ts = time.time() if now is None else float(now)
        base = max(1.0, min(2.0, float(base_speed or 1.0)))
        eng_cap = self._engine_speed_cap(eng)
        hi = max(base, min(eng_cap, max(1.10, min(1.75, float(max_speed or 1.40)))))
        if eng == "supertonic":
            base = min(base, 1.40)
            hi = min(hi, 1.40)

        key = (str(hid or ""), int(slot or 1))
        cps_key = (eng, (voice or "default").strip().lower(), (lang or "ru").strip().lower()[:2])

        with self._lock:
            st = self._slots.get(key)
            if st is None:
                st = _SlotTempoState(playhead_end_ts=0.0, current_speed=base, last_update_ts=ts)
                self._slots[key] = st
            elif (ts - st.last_update_ts) > self.IDLE_RESET_SEC:
                st.current_speed = base

            backlog_sec = max(0.0, st.playhead_end_ts - ts)
            cps_1x = self._cps_ewma.get(cps_key, self.DEFAULT_CPS_1X)
            prev_speed = max(base, min(hi, st.current_speed))

        if not auto_enabled:
            is_native = eng in NATIVE_SPEED_ENGINES
            return TempoPlan(
                effective_speed=round(base, 2),
                backlog_sec=round(backlog_sec, 2),
                trim_silence=False,
                turn_pause_ms=280,
                use_wsola=False,
                speed_applied_on_server=is_native,
                client_playback_rate=(1.0 if is_native else round(base, 2))
            )

        # Loop 1: Feedback from accumulated playback queue backlog (with deadband)
        excess_debt = max(0.0, backlog_sec - self.DEADBAND_SEC)
        fb_boost = excess_debt * self.DEBT_GAIN_PER_SEC

        # Loop 2: Feed-forward from translated text density vs original radio chunk duration
        ff_boost = 0.0
        clean_len = len((text or "").strip())
        if orig_audio_sec >= 1.5 and clean_len >= 18:
            est_dur_at_base = float(clean_len) / max(5.0, cps_1x * base)
            density_ratio = est_dur_at_base / float(orig_audio_sec)
            if density_ratio > 1.18 or (backlog_sec > 0.5 and density_ratio > 1.06):
                ff_boost = min(0.22, max(0.0, (density_ratio - 1.10) * 0.45))

        raw_target = base + fb_boost + (ff_boost * (0.65 if backlog_sec > self.DEADBAND_SEC else 1.0))
        raw_target = max(base, min(hi, raw_target))

        # Asymmetric slew-rate limiter (smooth ramp up, even gentler ramp down)
        up_step = self.URGENT_UP_STEP if backlog_sec >= 6.0 else self.MAX_UP_STEP
        if raw_target > prev_speed:
            next_speed = min(raw_target, prev_speed + up_step)
        else:
            next_speed = max(raw_target, prev_speed - self.MAX_DOWN_STEP)

        next_speed = round(max(base, min(hi, next_speed)), 2)
        trim_silence = (backlog_sec >= 0.8) or (next_speed > base + 0.02)
        turn_pause_ms = 80 if (backlog_sec >= 1.5 or next_speed > base + 0.04) else 280

        if eng in NATIVE_SPEED_ENGINES:
            return TempoPlan(
                effective_speed=next_speed,
                backlog_sec=round(backlog_sec, 2),
                trim_silence=trim_silence,
                turn_pause_ms=turn_pause_ms,
                use_wsola=False,
                speed_applied_on_server=True,
                client_playback_rate=1.0
            )
        if eng in WSOLA_ENGINES:
            use_wsola = next_speed > 1.02
            return TempoPlan(
                effective_speed=next_speed,
                backlog_sec=round(backlog_sec, 2),
                trim_silence=trim_silence,
                turn_pause_ms=turn_pause_ms,
                use_wsola=use_wsola,
                speed_applied_on_server=use_wsola,
                client_playback_rate=(1.0 if use_wsola else next_speed)
            )
        # Browser SpeechSynthesis uses native pitch-preserving utterance.rate
        return TempoPlan(
            effective_speed=next_speed,
            backlog_sec=round(backlog_sec, 2),
            trim_silence=False,
            turn_pause_ms=turn_pause_ms,
            use_wsola=False,
            speed_applied_on_server=False,
            client_playback_rate=next_speed
        )

    def commit_synthesized_wav(
        self,
        hid: str,
        slot: int,
        engine: str,
        voice: str,
        lang: str,
        text: str,
        wav_bytes: bytes,
        applied_speed: float,
        client_playback_rate: float = 1.0,
        turn_pause_ms: int = 280,
        is_new_turn: bool = False,
        now: Optional[float] = None
    ) -> float:
        """
        Commits final WAV duration into the slot's virtual playhead and updates
        the self-calibrating chars/sec EWMA for this voice. Returns final WAV duration (sec).
        """
        wav_dur = get_wav_duration_sec(wav_bytes)
        if wav_dur <= 0.0:
            return 0.0
        ts = time.time() if now is None else float(now)
        eng = (engine or "piper").lower().strip()
        key = (str(hid or ""), int(slot or 1))
        cps_key = (eng, (voice or "default").strip().lower(), (lang or "ru").strip().lower()[:2])
        play_dur = wav_dur / max(0.5, float(client_playback_rate or 1.0))

        char_count = len((text or "").strip())
        total_spd = max(0.5, float(applied_speed or 1.0)) * (
            1.0 if eng in NATIVE_SPEED_ENGINES else max(0.5, float(client_playback_rate or 1.0))
        )
        # For WSOLA-stretched WAVs, client_playback_rate == 1.0 and applied_speed == effective_speed.
        if eng in WSOLA_ENGINES and abs(client_playback_rate - 1.0) < 0.01:
            total_spd = max(0.5, float(applied_speed or 1.0))

        with self._lock:
            if wav_dur >= 0.6 and char_count >= 12:
                obs_cps_1x = max(7.0, min(28.0, (float(char_count) / wav_dur) / total_spd))
                prev_cps = self._cps_ewma.get(cps_key, self.DEFAULT_CPS_1X)
                self._cps_ewma[cps_key] = 0.80 * prev_cps + 0.20 * obs_cps_1x

            st = self._slots.setdefault(key, _SlotTempoState(playhead_end_ts=ts, current_speed=float(applied_speed or 1.0), last_update_ts=ts))
            backlog_before = max(0.0, st.playhead_end_ts - ts)
            pause_sec = (max(0, int(turn_pause_ms)) / 1000.0) if (is_new_turn and backlog_before > 0.05) else 0.0
            st.playhead_end_ts = max(ts, st.playhead_end_ts) + pause_sec + play_dur
            st.current_speed = float(applied_speed or 1.0)
            st.last_update_ts = ts
            st.last_backlog_sec = backlog_before

        return wav_dur

    def commit_browser_utterance(
        self,
        hid: str,
        slot: int,
        engine: str,
        voice: str,
        lang: str,
        text: str,
        applied_speed: float,
        turn_pause_ms: int = 280,
        is_new_turn: bool = False,
        now: Optional[float] = None
    ) -> float:
        """Estimates and commits Browser SpeechSynthesis playback duration onto the virtual playhead."""
        ts = time.time() if now is None else float(now)
        eng = (engine or "browser").lower().strip()
        key = (str(hid or ""), int(slot or 1))
        cps_key = (eng, (voice or "default").strip().lower(), (lang or "ru").strip().lower()[:2])
        char_count = len((text or "").strip())
        with self._lock:
            cps_1x = self._cps_ewma.get(cps_key, self.DEFAULT_CPS_1X)
            est_dur = max(0.5, float(char_count) / max(5.0, cps_1x * max(0.7, float(applied_speed or 1.0))))
            st = self._slots.setdefault(key, _SlotTempoState(playhead_end_ts=ts, current_speed=float(applied_speed or 1.0), last_update_ts=ts))
            backlog_before = max(0.0, st.playhead_end_ts - ts)
            pause_sec = (max(0, int(turn_pause_ms)) / 1000.0) if (is_new_turn and backlog_before > 0.05) else 0.0
            st.playhead_end_ts = max(ts, st.playhead_end_ts) + pause_sec + est_dur
            st.current_speed = float(applied_speed or 1.0)
            st.last_update_ts = ts
            st.last_backlog_sec = backlog_before
        return est_dur
