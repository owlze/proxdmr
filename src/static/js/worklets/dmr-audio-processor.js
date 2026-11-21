/**
 * ProxDMR - Real-Time AudioWorklet Processor
 * Runs inside the browser's dedicated real-time audio thread (WASAPI/CoreAudio/AAudio).
 * Provides lock-free ring-buffering, 8th-order Chebyshev Type II IIR / Hermite resampling,
 * dynamic jitter cushion, and zero-jank audio synthesis completely isolated from DOM/UI.
 */

// 8th-order Chebyshev Type II Lowpass (Passband 0..3800 Hz, Stopband >= 4000 Hz, Attenuation > 80 dB)
// 4 Second-Order Sections (SOS) in Direct Form II Transposed for 8000 Hz -> 48000 Hz (6x upsampling)
// High-Fidelity 8th-order Linear-Passband Anti-Imaging Resampler (0-3400 Hz: +/-0.15 dB, >4400 Hz: <-70 dB)
const CHEBY_B0 = new Float32Array([0.00179210, 1.0, 1.0, 1.0]);
const CHEBY_B1 = new Float32Array([0.00013708, -1.44747273, -1.66875045, -1.72030851]);
const CHEBY_B2 = new Float32Array([0.00179210, 1.0, 1.0, 1.0]);
const CHEBY_A1 = new Float32Array([-1.64783670, -1.69094764, -1.73401543, -1.76724683]);
const CHEBY_A2 = new Float32Array([0.69243186, 0.80556820, 0.91226991, 0.97631579]);

class RingBuffer {
  constructor(capacity = 96000) {
    this.capacity = capacity;
    this.buffer = new Float32Array(capacity);
    this.readIdx = 0;
    this.writeIdx = 0;
    this.available = 0;
  }

  write(samples) {
    const len = samples.length;
    if (len === 0) return;
    // Overrun guard: if buffer is full, drop oldest samples to prevent runaway latency
    if (this.available + len > this.capacity) {
      const drop = (this.available + len) - this.capacity;
      this.readIdx = (this.readIdx + drop) % this.capacity;
      this.available -= drop;
    }
    const part1 = Math.min(len, this.capacity - this.writeIdx);
    this.buffer.set(samples.subarray(0, part1), this.writeIdx);
    if (len > part1) {
      this.buffer.set(samples.subarray(part1), 0);
    }
    this.writeIdx = (this.writeIdx + len) % this.capacity;
    this.available += len;
  }

  read(outArray, count) {
    const toRead = Math.min(count, this.available);
    if (toRead <= 0) return 0;
    const part1 = Math.min(toRead, this.capacity - this.readIdx);
    outArray.set(this.buffer.subarray(this.readIdx, this.readIdx + part1), 0);
    if (toRead > part1) {
      outArray.set(this.buffer.subarray(0, toRead - part1), part1);
    }
    this.readIdx = (this.readIdx + toRead) % this.capacity;
    this.available -= toRead;
    return toRead;
  }

  clear() {
    this.readIdx = 0;
    this.writeIdx = 0;
    this.available = 0;
  }
}

class SlotAudioState {
  constructor(slotId, sampleRate) {
    this.slotId = slotId; // e.g. "default_1"
    this.sampleRate = sampleRate;
    // 6 seconds capacity at native rate (supports up to 2000ms jitter buffer + safety margin)
    this.ring = new RingBuffer(this.sampleRate * 6);
    this.isPlaying = false;
    this.txEnded = false;
    this.isRebuffering = false;
    this.underrunSamples = 0;
    this.fadeInRemaining = 0;
    this.lastPlayedSample = 0.0;
    this.samplesSinceLastFeed = 0;
    this.resampleBuf = null;
    this.resamplePos = 0.0;

    // Parameters
    this.volume = 1.0;
    this.muted = false;
    this.channelMuted = false;
    this.globalMuted = false;
    this.pan = "center"; // "center", "left", "right"
    this.duckGain = 1.0;
    this.targetDuckGain = 1.0;

    // Per-slot RX AGC state (stream-synchronous, isolated per hotspot & timeslot)
    this.agcEnvelope = 0.0;
    this.agcInitialized = false;
    this.agcIsSpeech = false;
    this.agcLastSpeechTime = 0.0;
    this.agcStreamTime = 0.0;
    this.agcCurrentGain = 1.0;
    this.agcLastAppliedGain = 1.0;

    // Resampling scratchpad (8000 Hz incoming stream)
    this.ratio = 8000.0 / sampleRate;
    this.tempChunk = new Float32Array(128);

    // 8th-order Chebyshev Type II IIR Resampler state (8000 Hz -> 48000 Hz)
    this.chebyS1 = new Float32Array(4);
    this.chebyS2 = new Float32Array(4);

    // Fade on start/stop to prevent clicks
    this.currentGain = 1.0;
    this.fadeStep = 1.0 / (sampleRate * 0.003); // 3ms micro-ramp
  }

  _resetAgcState() {
    this.agcEnvelope = 0.0;
    this.agcInitialized = false;
    this.agcIsSpeech = false;
    this.agcLastSpeechTime = 0.0;
    this.agcStreamTime = 0.0;
    this.agcCurrentGain = 1.0;
    this.agcLastAppliedGain = 1.0;
  }

  feedPcm16(int16Array, preGainLinear, jitterSec, agcConfig = null) {
    const numSamples = int16Array.length;
    if (numSamples === 0) return;

    this.txEnded = false; // New packet arrived, transmission ongoing
    // Reset resampler & AGC state ONLY if stream was completely idle (>600ms) and ring is empty
    if (this.samplesSinceLastFeed > (this.sampleRate * 0.600) && this.ring.available === 0) {
      this.resampleBuf = null;
      this.resamplePos = 0.0;
      this.isRebuffering = false;
      this.chebyS1.fill(0);
      this.chebyS2.fill(0);
      this._resetAgcState();
    }
    this.samplesSinceLastFeed = 0;

    // 1. Convert Int16 PCM to float [-1..+1], apply real-time RX AGC & Base Gain + Soft-Knee Limiter
    const inSamples = new Float32Array(numSamples);
    let sumSq = 0.0;
    let chunkPeak = 0.0;
    for (let i = 0; i < numSamples; i++) {
      const s = (int16Array[i] / 32768.0) * preGainLinear;
      inSamples[i] = s;
      sumSq += s * s;
      const absS = s < 0.0 ? -s : s;
      if (absS > chunkPeak) chunkPeak = absS;
    }

    const agcEnabled = agcConfig ? Boolean(agcConfig.enabled) : true;
    const depthDb = agcConfig ? Math.max(6.0, Math.min(30.0, Number(agcConfig.depthDb) || 18.0)) : 18.0;
    const gainRaw = agcConfig ? Math.max(10.0, Math.min(120.0, Number(agcConfig.gainRaw) || 35.0)) : 35.0;
    const gainMult = gainRaw / 10.0; // slider 10..120 -> 1.0x..12.0x

    const chunkDur = Math.max(0.005, Math.min(0.200, numSamples / 8000.0));
    this.agcStreamTime += chunkDur;
    const agcNow = this.agcStreamTime;

    let targetGain = 1.0;
    if (!agcEnabled) {
      // Manual Base Gain mode when AGC is toggled OFF (1.0x..12.0x -> 0.4x..4.0x)
      targetGain = Math.min(4.0, Math.max(0.4, gainMult / 2.5));
      if (chunkPeak > 0.001 && (chunkPeak * targetGain) > 1.05) {
        targetGain = Math.max(0.4, Math.min(targetGain, 1.05 / chunkPeak));
      }
      this.agcCurrentGain = targetGain;
    } else {
      const chunkRms = Math.sqrt(sumSq / numSamples);
      // Schmitt trigger speech detector (-44.4 dBFS onset, -48.4 dBFS release)
      if (!this.agcIsSpeech) {
        if (chunkRms >= 0.006) this.agcIsSpeech = true;
      } else if (chunkRms < 0.0038) {
        this.agcIsSpeech = false;
      }

      const maxGainDb = depthDb;
      const minGainDb = -Math.min(16.0, Math.round(depthDb * 0.8));
      const boostRatio = Math.min(1.0, 0.55 + (depthDb / 48.0));
      const attenRatio = 0.85;
      // 3.5x -> ~0.228 RMS (-12.8 dBFS); 4.5x -> ~0.292 RMS (-10.7 dBFS)
      const targetRms = Math.min(0.42, Math.max(0.08, 0.065 * gainMult));

      if (this.agcIsSpeech) {
        this.agcLastSpeechTime = agcNow;
        const isFastAttack = this.agcInitialized && (chunkRms > this.agcEnvelope * 1.8);
        const attAlpha = Math.exp(-chunkDur / (isFastAttack ? 0.012 : 0.045));
        const decAlpha = Math.exp(-chunkDur / 0.500);
        if (!this.agcInitialized) {
          // Initialize envelope near nominal speech reference so a quiet breath/squelch lead-in
          // after PTT reset never pins AGC to +maxGainDb (+22 dB) before the first loud syllable.
          this.agcEnvelope = Math.max(chunkRms, targetRms * 0.75);
          this.agcInitialized = true;
        } else if (chunkRms > this.agcEnvelope) {
          this.agcEnvelope = attAlpha * this.agcEnvelope + (1.0 - attAlpha) * chunkRms;
        } else {
          this.agcEnvelope = decAlpha * this.agcEnvelope + (1.0 - decAlpha) * chunkRms;
        }

        const inDb = 20.0 * Math.log10(Math.max(0.001, this.agcEnvelope));
        const targetDb = 20.0 * Math.log10(targetRms);
        const diffDb = targetDb - inDb;
        let gainDb = (diffDb > 0)
          ? Math.min(maxGainDb, diffDb * boostRatio)
          : Math.max(minGainDb, diffDb * attenRatio);
        if (gainMult > 6.0) {
          gainDb += 20.0 * Math.log10(1.0 + (gainMult - 6.0) * 0.12);
        }
        targetGain = Math.pow(10.0, gainDb / 20.0);

        // Peak-ceiling guard prevents clipping high-crest speech transients
        if (chunkPeak > 0.001 && (chunkPeak * targetGain) > 0.96) {
          const minLin = Math.pow(10.0, minGainDb / 20.0);
          targetGain = Math.max(minLin, Math.min(targetGain, 0.96 / chunkPeak));
        }
        this.agcCurrentGain = targetGain;
      } else {
        const elapsed = (this.agcLastSpeechTime > 0.0) ? (agcNow - this.agcLastSpeechTime) : 999.0;
        if (elapsed < 0.35) {
          targetGain = this.agcCurrentGain;
        } else {
          const relAlpha = Math.exp(-chunkDur / 0.500);
          this.agcCurrentGain = relAlpha * this.agcCurrentGain + (1.0 - relAlpha) * 1.0;
          this.agcEnvelope = relAlpha * this.agcEnvelope + (1.0 - relAlpha) * (targetRms * 0.75);
          targetGain = this.agcCurrentGain;
        }
        if (chunkPeak > 0.001 && (chunkPeak * targetGain) > 0.96) {
          const minLin = Math.pow(10.0, minGainDb / 20.0);
          targetGain = Math.max(minLin, Math.min(targetGain, 0.96 / chunkPeak));
        }
      }
    }

    const startGain = (this.agcLastAppliedGain > targetGain * 1.35)
      ? (targetGain * 1.35)
      : this.agcLastAppliedGain;
    const gainStep = (targetGain - startGain) / numSamples;
    let currAgcGain = startGain;
    for (let i = 0; i < numSamples; i++) {
      currAgcGain += gainStep;
      let s = inSamples[i] * currAgcGain;
      if (s > 0.82) {
        s = 0.82 + 0.18 * Math.tanh((s - 0.82) / 0.18);
      } else if (s < -0.82) {
        s = -0.82 + 0.18 * Math.tanh((s + 0.82) / 0.18);
      }
      inSamples[i] = s;
    }
    this.agcLastAppliedGain = targetGain;

    // 2. Resample from 8000 Hz to target DAC sampleRate
    let outSamples;
    if (this.sampleRate === 8000) {
      outSamples = inSamples;
    } else if (this.sampleRate === 48000) {
      // High-Fidelity 8th-order Chebyshev Type II IIR Resampler (matched to #ambe2+ bench)
      const targetLen = numSamples * 6;
      outSamples = new Float32Array(targetLen);
      for (let i = 0; i < numSamples; i++) {
        outSamples[i * 6] = inSamples[i] * 6.0;
      }
      for (let s = 0; s < 4; s++) {
        let _s1 = this.chebyS1[s];
        let _s2 = this.chebyS2[s];
        const _b0 = CHEBY_B0[s], _b1 = CHEBY_B1[s], _b2 = CHEBY_B2[s];
        const _a1 = CHEBY_A1[s], _a2 = CHEBY_A2[s];
        for (let i = 0; i < targetLen; i++) {
          const inp = outSamples[i];
          const y = _b0 * inp + _s1;
          _s1 = _b1 * inp - _a1 * y + _s2;
          _s2 = _b2 * inp - _a2 * y;
          outSamples[i] = y;
        }
        this.chebyS1[s] = _s1;
        this.chebyS2[s] = _s2;
      }
    } else {
      // Continuous 4-point Hermite interpolation fallback for non-48k DAC rates (e.g. 44.1k)
      const ratio = 8000.0 / this.sampleRate;
      if (!this.resampleBuf || this.resampleBuf.length < 3) {
        const s0 = inSamples[0];
        this.resampleBuf = new Float32Array([s0, s0, s0]);
        this.resamplePos = 1.0;
      }

      const oldLen = this.resampleBuf.length;
      const combined = new Float32Array(oldLen + numSamples);
      combined.set(this.resampleBuf, 0);
      combined.set(inSamples, oldLen);

      const bufLen = combined.length;
      const maxPos = Math.max(1.0, bufLen - 2.001);
      let pos = this.resamplePos;
      const numOut = Math.max(0, Math.ceil((maxPos - pos) / ratio));
      outSamples = new Float32Array(numOut);

      for (let j = 0; j < numOut; j++) {
        const k = Math.floor(pos);
        const t = pos - k;
        const p0 = combined[Math.max(0, k - 1)];
        const p1 = combined[k];
        const p2 = combined[Math.min(bufLen - 1, k + 1)];
        const p3 = combined[Math.min(bufLen - 1, k + 2)];

        const c0 = p1;
        const c1 = 0.5 * (p2 - p0);
        const c2 = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
        const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);

        outSamples[j] = ((c3 * t + c2) * t + c1) * t + c0;
        pos += ratio;
      }

      const drop = Math.max(0, Math.floor(pos) - 1);
      this.resampleBuf = combined.slice(drop);
      this.resamplePos = pos - drop;
    }

    // 3. Write to ring buffer
    this.ring.write(outSamples);

    // 4. Runaway drift guard (scaled for up to 2000ms jitter buffer)
    const maxAllowedSamples = Math.round(Math.max(0.800, jitterSec * 2.5) * this.sampleRate);
    if (this.ring.available > maxAllowedSamples) {
      const targetKeep = Math.round(jitterSec * this.sampleRate);
      const dropCount = this.ring.available - targetKeep;
      if (dropCount > 0) {
        this.ring.readIdx = (this.ring.readIdx + dropCount) % this.ring.capacity;
        this.ring.available -= dropCount;
      }
    }

    // 5. Start / resume playback with dynamic pre-buffer cushion
    if (this.underrunSamples > 0) {
      // Packet arrived during grace window -> smooth micro-fade-in and continue immediately
      this.underrunSamples = 0;
      this.fadeInRemaining = 64;
    }
    if (!this.isPlaying) {
      // One DMR/ASL coalesced packet is 60ms.
      // On fresh transmission start: accumulate 240..360ms (4..6 chunks of 60ms) pre-buffer
      // so initial connection/hub jitter never starves the first syllable.
      // On rebuffer resume: also accumulate 240..360ms (4..6 chunks) so playback has a full safety cushion.
      const targetSec = this.isRebuffering
        ? Math.min(0.360, Math.max(0.240, jitterSec * 0.85))
        : Math.min(0.360, Math.max(0.240, jitterSec));
      const minStartSamples = Math.round(targetSec * this.sampleRate);
      if (this.ring.available >= minStartSamples) {
        this.isPlaying = true;
        this.isRebuffering = false;
        this.underrunSamples = 0;
        this.fadeInRemaining = 64; // ~1.3ms micro-fade-in
      }
    }
  }

  process(outL, outR, frames) {
    this.samplesSinceLastFeed += frames;

    if (!this.isPlaying) {
      if (this.txEnded && this.ring.available > 0) {
        this.isPlaying = true;
        this.fadeInRemaining = 64;
      } else {
        return;
      }
    }

    const readCount = this.ring.read(this.tempChunk, frames);
    if (readCount === 0) {
      if (this.txEnded) {
        this.isPlaying = false;
        this.txEnded = false;
        this.isRebuffering = false;
        this.underrunSamples = 0;
        this.resampleBuf = null;
        this.resamplePos = 0.0;
        this._resetAgcState();
        return;
      }
      // Grace period (up to 180ms = 3 coalesced 60ms packets) for late network/WebSocket packets
      // before triggering full rebuffer gate
      this.underrunSamples += frames;
      if (Math.abs(this.lastPlayedSample) > 0.0001) {
        let panL = (this.pan === "right" || this.pan === "R") ? 0.0 : 1.0;
        let panR = (this.pan === "left" || this.pan === "L") ? 0.0 : 1.0;
        let decay = this.lastPlayedSample;
        for (let i = 0; i < frames; i++) {
          decay *= 0.94;
          outL[i] += decay * panL;
          outR[i] += decay * panR;
        }
        this.lastPlayedSample = decay;
      }
      if (this.underrunSamples > Math.round(this.sampleRate * 0.180)) {
        this.isPlaying = false;
        this.isRebuffering = true;
        this.underrunSamples = 0;
      }
      return;
    }
    this.underrunSamples = 0;

    // Smooth ducking interpolation
    if (Math.abs(this.duckGain - this.targetDuckGain) > 0.001) {
      this.duckGain += (this.targetDuckGain - this.duckGain) * 0.08;
    } else {
      this.duckGain = this.targetDuckGain;
    }

    const isEffectiveMuted = this.muted || this.channelMuted || this.globalMuted;
    const targetGain = isEffectiveMuted ? 0.0 : (this.volume * this.duckGain);

    let panL = 1.0;
    let panR = 1.0;
    if (this.pan === "left" || this.pan === "L") {
      panL = 1.0;
      panR = 0.0;
    } else if (this.pan === "right" || this.pan === "R") {
      panL = 0.0;
      panR = 1.0;
    }

    for (let i = 0; i < readCount; i++) {
      if (Math.abs(this.currentGain - targetGain) > this.fadeStep) {
        this.currentGain += (this.currentGain < targetGain) ? this.fadeStep : -this.fadeStep;
      } else {
        this.currentGain = targetGain;
      }

      let sample = this.tempChunk[i] * this.currentGain;

      // Micro-fade-in de-click ramp
      if (this.fadeInRemaining > 0) {
        const ramp = 1.0 - (this.fadeInRemaining / 64.0);
        sample *= ramp;
        this.fadeInRemaining--;
      }

      this.lastPlayedSample = sample;
      outL[i] += sample * panL;
      outR[i] += sample * panR;
    }

    // De-click ramp down on partial read before dry buffer
    if (readCount < frames) {
      const remaining = frames - readCount;
      let decay = this.lastPlayedSample;
      for (let i = 0; i < remaining; i++) {
        decay *= 0.90;
        const idx = readCount + i;
        outL[idx] += decay * panL;
        outR[idx] += decay * panR;
      }
      this.lastPlayedSample = decay;
      if (this.txEnded) {
        this.isPlaying = false;
        this.txEnded = false;
        this.isRebuffering = false;
        this.underrunSamples = 0;
        this.resampleBuf = null;
        this.resamplePos = 0.0;
        this._resetAgcState();
      } else {
        // Enter short grace period instead of immediately killing isPlaying
        this.underrunSamples = remaining;
      }
    }
  }

  reset() {
    this.ring.clear();
    this.isPlaying = false;
    this.txEnded = false;
    this.isRebuffering = false;
    this.underrunSamples = 0;
    this.fadeInRemaining = 0;
    this.lastPlayedSample = 0.0;
    this.samplesSinceLastFeed = 0;
    this.resampleBuf = null;
    this.resamplePos = 0.0;
    this.chebyS1.fill(0);
    this.chebyS2.fill(0);
    this._resetAgcState();
  }
}

class DMRAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.slots = new Map(); // key: "hotspotId_slot" -> SlotAudioState
    this.channelVolumes = new Map(); // key: "hotspotId" -> number
    this.channelMutes = new Map();   // key: "hotspotId" -> boolean
    this.preGainDb = 0;
    this.preGainLinear = 1.0;
    this.jitterSec = 0.120; // 120ms default
    this.globalMuted = false;
    this.agcConfig = {
      enabled: true,
      depthDb: 18,
      gainRaw: 35
    };

    this.port.onmessage = this.handleMessage.bind(this);
  }

  getSlot(hid, slot) {
    const normHid = hid || "default";
    const key = `${normHid}_${slot || 1}`;
    let st = this.slots.get(key);
    if (!st) {
      st = new SlotAudioState(key, sampleRate);
      st.globalMuted = this.globalMuted;
      if (this.channelVolumes.has(normHid)) {
        st.volume = this.channelVolumes.get(normHid);
      } else if (this.channelVolumes.has("default")) {
        st.volume = this.channelVolumes.get("default");
      }
      if (this.channelMutes.has(normHid)) {
        st.channelMuted = this.channelMutes.get(normHid);
      }
      this.slots.set(key, st);
    }
    return st;
  }

  handleMessage(event) {
    const data = event.data;
    if (!data || !data.type) return;

    switch (data.type) {
      case "feed": {
        const slotState = this.getSlot(data.hotspotId, data.slot);
        const int16 = new Int16Array(data.buffer);
        slotState.feedPcm16(int16, this.preGainLinear, this.jitterSec, this.agcConfig);
        break;
      }

      case "set_agc_config": {
        if (data.enabled !== undefined) {
          this.agcConfig.enabled = Boolean(data.enabled);
        }
        if (data.depthDb !== undefined) {
          const d = parseFloat(data.depthDb);
          if (!isNaN(d)) this.agcConfig.depthDb = Math.max(6, Math.min(30, d));
        }
        if (data.gainRaw !== undefined) {
          const g = parseFloat(data.gainRaw);
          if (!isNaN(g)) this.agcConfig.gainRaw = Math.max(10, Math.min(120, g));
        }
        break;
      }

      case "set_pre_gain": {
        this.preGainDb = Math.max(-20, Math.min(12, parseFloat(data.db) || 0));
        this.preGainLinear = Math.pow(10.0, this.preGainDb / 20.0);
        break;
      }

      case "set_jitter_buffer": {
        const ms = Math.max(40, Math.min(2000, parseFloat(data.ms) || 120));
        this.jitterSec = ms / 1000.0;
        break;
      }

      case "set_slot_mute": {
        const st = this.getSlot(data.hotspotId, data.slot);
        st.muted = Boolean(data.muted);
        break;
      }

      case "set_channel_mute": {
        const hid = data.hotspotId || "default";
        const isMuted = Boolean(data.muted);
        this.channelMutes.set(hid, isMuted);
        for (const slot of [1, 2]) {
          const st = this.getSlot(hid, slot);
          st.channelMuted = isMuted;
        }
        break;
      }

      case "set_global_mute": {
        this.globalMuted = Boolean(data.muted);
        for (const st of this.slots.values()) {
          st.globalMuted = this.globalMuted;
        }
        break;
      }

      case "set_slot_pan": {
        const st = this.getSlot(data.hotspotId, data.slot);
        st.pan = data.pan || "center";
        break;
      }

      case "set_slot_ducking": {
        const st = this.getSlot(data.hotspotId, data.slot);
        const lvl = parseFloat(data.duckLevel);
        const target = data.ducked ? (!isNaN(lvl) ? Math.max(0.0, Math.min(1.0, lvl)) : 0.20) : 1.0;
        st.targetDuckGain = target;
        if (!st.isPlaying) {
          st.duckGain = target;
        }
        break;
      }

      case "set_channel_volume": {
        const hid = data.hotspotId || "default";
        const parsedVol = parseFloat(data.volume);
        const vol = Math.max(0.0, Math.min(25.0, isNaN(parsedVol) ? 1.0 : parsedVol));
        this.channelVolumes.set(hid, vol);
        for (const slot of [1, 2]) {
          const st = this.getSlot(hid, slot);
          st.volume = vol;
        }
        break;
      }

      case "tx_ended": {
        const st = this.getSlot(data.hotspotId, data.slot);
        st.txEnded = true;
        // Do not force st.isPlaying = false immediately; let process() play all buffered samples
        break;
      }

      case "reset": {
        if (data.hotspotId) {
          const hid = String(data.hotspotId);
          if (data.slot) {
            const st = this.slots.get(`${hid}_${data.slot}`);
            if (st) st.reset();
          } else {
            for (const s of [1, 2]) {
              const st = this.slots.get(`${hid}_${s}`);
              if (st) st.reset();
            }
          }
        } else {
          // Global reset only when no specific hotspotId is provided
          for (const st of this.slots.values()) {
            st.reset();
          }
        }
        break;
      }
    }
  }

  process(inputs, outputs, parameters) {
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const outL = output[0];
    const outR = output.length > 1 ? output[1] : outL;
    const frames = outL.length; // 128 samples

    outL.fill(0.0);
    if (outR !== outL) {
      outR.fill(0.0);
    }

    // Mix all active hotspot slots in real-time
    for (const slotState of this.slots.values()) {
      slotState.process(outL, outR, frames);
    }

    return true; // Keep processor alive
  }
}

registerProcessor("dmr-audio-processor", DMRAudioProcessor);
