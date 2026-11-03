/**
 * ProxDMR - Real-Time AudioWorklet Processor
 * Runs inside the browser's dedicated real-time audio thread (WASAPI/CoreAudio/AAudio).
 * Provides lock-free ring-buffering, cubic Hermite resampling (8000Hz -> native DAC),
 * dynamic jitter cushion, and zero-jank audio synthesis completely isolated from DOM/UI.
 */

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

    // Resampling scratchpad
    this.ratio = 8000.0 / sampleRate;
    this.tempChunk = new Float32Array(128);

    // Fade on start/stop to prevent clicks
    this.currentGain = 1.0;
    this.fadeStep = 1.0 / (sampleRate * 0.003); // 3ms micro-ramp
  }

  feedPcm16(int16Array, preGainLinear, jitterSec) {
    const numSamples = int16Array.length;
    if (numSamples === 0) return;

    this.txEnded = false; // New packet arrived, transmission ongoing
    // Reset resampler state ONLY if stream was completely idle (>600ms) and ring is empty
    if (this.samplesSinceLastFeed > (this.sampleRate * 0.600) && this.ring.available === 0) {
      this.resampleBuf = null;
      this.resamplePos = 0.0;
      this.isRebuffering = false;
    }
    this.samplesSinceLastFeed = 0;

    // 1. Digital Pre-Gain & Soft Limiter
    const inSamples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      let s = (int16Array[i] / 32768.0) * preGainLinear;
      if (s > 0.90) {
        s = 0.90 + 0.10 * Math.tanh((s - 0.90) / 0.10);
      } else if (s < -0.90) {
        s = -0.90 + 0.10 * Math.tanh((s + 0.90) / 0.10);
      }
      inSamples[i] = s;
    }

    // 2. Resample from 8000 Hz to target DAC sampleRate using continuous 4-point Hermite interpolation
    let outSamples;
    if (this.sampleRate === 8000) {
      outSamples = inSamples;
    } else {
      const ratio = 8000.0 / this.sampleRate;
      if (!this.resampleBuf || this.resampleBuf.length < 4) {
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

    // 5. Start / resume playback with dynamic jitter cushion
    if (this.underrunSamples > 0) {
      // Packet arrived during short grace window -> smooth micro-fade-in and continue immediately
      this.underrunSamples = 0;
      this.fadeInRemaining = 48;
    }
    if (!this.isPlaying) {
      // One DMR/ASL packet is 60ms. On rebuffer resume, start as soon as 1 full chunk (60ms)
      // or 50% of jitterSec is ready so we don't stall for an extra 60-120ms.
      // On fresh transmission start, add half-chunk offset so wall-clock cushion matches jitterSec.
      const targetSec = this.isRebuffering
        ? Math.min(0.180, Math.max(0.055, jitterSec * 0.5))
        : Math.max(0.120, jitterSec);
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
        return;
      }
      // Grace period (up to 70ms) for late network/IPC packets before triggering rebuffer gate
      this.underrunSamples += frames;
      if (Math.abs(this.lastPlayedSample) > 0.0001) {
        let panL = (this.pan === "right" || this.pan === "R") ? 0.0 : 1.0;
        let panR = (this.pan === "left" || this.pan === "L") ? 0.0 : 1.0;
        let decay = this.lastPlayedSample;
        for (let i = 0; i < frames; i++) {
          decay *= 0.92;
          outL[i] += decay * panL;
          outR[i] += decay * panR;
        }
        this.lastPlayedSample = decay;
      }
      if (this.underrunSamples > Math.round(this.sampleRate * 0.070)) {
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
  }
}

class DMRAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.slots = new Map(); // key: "hotspotId_slot" -> SlotAudioState
    this.preGainDb = 0;
    this.preGainLinear = 1.0;
    this.jitterSec = 0.120; // 120ms default
    this.globalMuted = false;

    this.port.onmessage = this.handleMessage.bind(this);
  }

  getSlot(hid, slot) {
    const key = `${hid || "default"}_${slot || 1}`;
    let st = this.slots.get(key);
    if (!st) {
      st = new SlotAudioState(key, sampleRate);
      st.globalMuted = this.globalMuted;
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
        slotState.feedPcm16(int16, this.preGainLinear, this.jitterSec);
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
        for (const slot of [1, 2]) {
          const st = this.getSlot(hid, slot);
          st.channelMuted = Boolean(data.muted);
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
        const vol = Math.max(0.0, Math.min(1.0, parseFloat(data.volume) || 1.0));
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
        for (const st of this.slots.values()) {
          st.reset();
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
