/**
 * AudioPlayer for ProxDMR
 * Multi-Channel Web Audio Engine with:
 * - Independent audio channel per hotspot (isolated playback timelines, zero collisions)
 * - Classical Amateur Radio Software DSP AGC (RMS envelope, 6ms attack, 350ms hang time, 800ms decay)
 * - Per-hotspot Volume & Mute isolation
 * - Master Bus with Peak Limiter (DynamicsCompressorNode) & Global Mute
 */

class ClassicalDspAgc {
  constructor() {
    this.enabled = true;
    this.profile = "standard";
    this.depthDb = 18;
    this.gainRaw = 35;
    this.targetRms = 0.228;         // Calibrated from gainRaw=35 (3.5x -> ~ -12.8 dBFS)
    this.speechThreshold = 0.006;   // Active speech onset (~ -44.4 dBFS)
    this.noiseGate = 0.0038;        // Hysteresis release gate (~ -48.4 dBFS)
    this.minGainDb = -14;           // Max attenuation for loud stations
    this.maxGainDb = 18;            // Max boost for quiet stations
    this.boostRatio = 0.925;
    this.attenRatio = 0.85;
    this.hangTime = 0.35;           // 350ms pause freeze
    this.decayTime = 0.50;          // 500ms release to unity
    this.envelope = 0.0;
    this.initialized = false;
    this.lastSpeechTime = 0;
    this.streamTime = 0;
    this.isSpeechActive = false;
    this.currentGain = 1.0;
    this.lastAppliedGain = 1.0;
  }

  configure({ enabled, depthDb, gainRaw } = {}) {
    if (enabled !== undefined) this.enabled = Boolean(enabled);
    if (depthDb !== undefined) {
      const d = parseFloat(depthDb);
      if (!isNaN(d)) {
        this.depthDb = Math.max(6, Math.min(30, d));
        this.maxGainDb = this.depthDb;
        this.minGainDb = -Math.min(16, Math.round(this.depthDb * 0.8));
        this.boostRatio = Math.min(1.0, 0.55 + (this.depthDb / 48.0));
        this.attenRatio = 0.85;
      }
    }
    if (gainRaw !== undefined) {
      const g = parseFloat(gainRaw);
      if (!isNaN(g)) {
        this.gainRaw = Math.max(10, Math.min(120, g));
        const gainMult = this.gainRaw / 10.0;
        this.targetRms = Math.min(0.42, Math.max(0.08, 0.065 * gainMult));
      }
    }
  }

  setAgcParams({ minGainDb, maxGainDb, hangTime }) {
    if (typeof minGainDb === "number") {
      this.minGainDb = -Math.abs(Math.min(30, Math.max(0, minGainDb)));
      this.attenRatio = Math.min(1.0, 0.50 + (Math.abs(this.minGainDb) / 48.0));
    }
    if (typeof maxGainDb === "number") {
      this.maxGainDb = Math.abs(Math.min(30, Math.max(0, maxGainDb)));
      this.depthDb = this.maxGainDb;
      this.boostRatio = Math.min(1.0, 0.55 + (this.maxGainDb / 48.0));
    }
    if (typeof hangTime === "number") {
      this.hangTime = Math.max(0.1, Math.min(2.0, hangTime));
    }
  }

  setProfile(name) {
    this.profile = name || "standard";
    switch (this.profile) {
      case "soft":
        this.minGainDb = -8;
        this.maxGainDb = 8;
        this.boostRatio = 0.65;
        this.attenRatio = 0.65;
        this.hangTime = 0.30;
        break;
      case "deep":
        this.minGainDb = -18;
        this.maxGainDb = 18;
        this.boostRatio = 0.95;
        this.attenRatio = 0.95;
        this.hangTime = 0.40;
        break;
      case "max":
        this.minGainDb = -24;
        this.maxGainDb = 24;
        this.boostRatio = 1.00;
        this.attenRatio = 1.00;
        this.hangTime = 0.45;
        break;
      case "standard":
      default:
        this.profile = "standard";
        this.minGainDb = -12;
        this.maxGainDb = 12;
        this.boostRatio = 0.85;
        this.attenRatio = 0.85;
        this.hangTime = 0.35;
        break;
    }
  }

  processChunk(chunkRms, now, chunkDur = 0.06, chunkPeak = 0.0) {
    const gainMult = (this.gainRaw || 35) / 10.0;
    if (!this.enabled) {
      let manual = Math.min(4.0, Math.max(0.4, gainMult / 2.5));
      if (chunkPeak > 0.001 && (chunkPeak * manual) > 1.05) {
        manual = Math.max(0.4, Math.min(manual, 1.05 / chunkPeak));
      }
      this.currentGain = manual;
      return manual;
    }

    if (!this.isSpeechActive) {
      if (chunkRms >= this.speechThreshold) this.isSpeechActive = true;
    } else if (chunkRms < this.noiseGate) {
      this.isSpeechActive = false;
    }

    if (this.isSpeechActive) {
      this.lastSpeechTime = now;
      const isFastAttack = this.initialized && (chunkRms > this.envelope * 1.8);
      const attAlpha = Math.exp(-chunkDur / (isFastAttack ? 0.012 : 0.045));
      const decAlpha = Math.exp(-chunkDur / 0.500);
      if (!this.initialized) {
        this.envelope = Math.max(chunkRms, this.targetRms * 0.75);
        this.initialized = true;
      } else if (chunkRms > this.envelope) {
        this.envelope = attAlpha * this.envelope + (1.0 - attAlpha) * chunkRms;
      } else {
        this.envelope = decAlpha * this.envelope + (1.0 - decAlpha) * chunkRms;
      }

      const inDb = 20.0 * Math.log10(Math.max(0.001, this.envelope));
      const targetDb = 20.0 * Math.log10(this.targetRms);
      const diffDb = targetDb - inDb;
      let gainDb = (diffDb > 0)
        ? Math.min(this.maxGainDb, diffDb * this.boostRatio)
        : Math.max(this.minGainDb, diffDb * this.attenRatio);
      if (gainMult > 6.0) {
        gainDb += 20.0 * Math.log10(1.0 + (gainMult - 6.0) * 0.12);
      }
      let targetGain = Math.pow(10.0, gainDb / 20.0);
      if (chunkPeak > 0.001 && (chunkPeak * targetGain) > 0.96) {
        const minLin = Math.pow(10.0, this.minGainDb / 20.0);
        targetGain = Math.max(minLin, Math.min(targetGain, 0.96 / chunkPeak));
      }
      this.currentGain = targetGain;
      return targetGain;
    } else {
      const elapsed = (this.lastSpeechTime > 0) ? (now - this.lastSpeechTime) : 999.0;
      if (elapsed < this.hangTime) {
        return this.currentGain;
      }
      const alphaRelease = Math.exp(-chunkDur / Math.max(0.1, this.decayTime));
      this.currentGain = alphaRelease * this.currentGain + (1.0 - alphaRelease) * 1.0;
      this.envelope = alphaRelease * this.envelope + (1.0 - alphaRelease) * (this.targetRms * 0.75);
      return this.currentGain;
    }
  }

  processSamples(inSamples, sampleRate = 8000) {
    const n = inSamples.length;
    if (n === 0) return;
    let sumSq = 0.0;
    let peak = 0.0;
    for (let i = 0; i < n; i++) {
      const s = inSamples[i];
      sumSq += s * s;
      const a = s < 0.0 ? -s : s;
      if (a > peak) peak = a;
    }
    const chunkDur = Math.max(0.005, Math.min(0.200, n / sampleRate));
    this.streamTime += chunkDur;
    const chunkRms = Math.sqrt(sumSq / n);
    const targetGain = this.processChunk(chunkRms, this.streamTime, chunkDur, peak);
    const startGain = (this.lastAppliedGain > targetGain * 1.35)
      ? (targetGain * 1.35)
      : this.lastAppliedGain;
    const gainStep = (targetGain - startGain) / n;
    let currGain = startGain;
    for (let i = 0; i < n; i++) {
      currGain += gainStep;
      let s = inSamples[i] * currGain;
      if (s > 0.82) {
        s = 0.82 + 0.18 * Math.tanh((s - 0.82) / 0.18);
      } else if (s < -0.82) {
        s = -0.82 + 0.18 * Math.tanh((s + 0.82) / 0.18);
      }
      inSamples[i] = s;
    }
    this.lastAppliedGain = targetGain;
  }

  reset() {
    this.envelope = 0.0;
    this.initialized = false;
    this.currentGain = 1.0;
    this.lastAppliedGain = 1.0;
    this.lastSpeechTime = 0;
    this.streamTime = 0;
    this.isSpeechActive = false;
  }
}

if (typeof window !== "undefined") {
  window.ClassicalDspAgc = ClassicalDspAgc;
}

class HotspotAudioSlot {
  constructor(slot, audioCtx, channelGainNode, player = null) {
    this.slot = slot;
    this.audioCtx = audioCtx;
    this.player = player;
    this.nextStartTime = 0;
    this.sampleRate = 8000;
    this.isMuted = false;
    this._muteFadeOutUntilMs = 0;
    this._muteResetTimer = null;
    this.agc = new ClassicalDspAgc();
    if (player && typeof player.getRxAgcConfig === "function") {
      this.agc.configure(player.getRxAgcConfig());
    }

    // Resampler stream continuity state (preserves sample history across 60ms chunks)
    this.resampleBuf = null;
    this.resamplePos = 0.0;
    this.lastFeedSample = 0.0;
    this.lastFeedSlope = 0.0;
    this.chebyS1 = new Float32Array(4);
    this.chebyS2 = new Float32Array(4);
    
    // Audio Graph: [Source] -> slotMuteGainNode -> slotDuckGainNode -> slotPanNode (Stereo Panner) -> channelGainNode
    this.slotMuteGainNode = audioCtx.createGain();
    this.slotMuteGainNode.gain.value = 1.0;

    this.slotDuckGainNode = audioCtx.createGain();
    this.slotDuckGainNode.gain.value = 1.0;
    this.isDucked = false;
    
    this.panMode = "LR"; // "LR", "L", "R"
    this.useChannelMerger = false;
    this.panLeftGain = null;
    this.panRightGain = null;
    this.panMerger = null;
    this.slotPanNode = null;

    // True hardware-grade discrete 2-channel matrix commutation (channel 0 = L, channel 1 = R):
    // Eliminates StereoPannerNode equal-power attenuation (-3dB) and ensures 100% discrete separation on all devices
    if (audioCtx && typeof audioCtx.createChannelMerger === "function") {
      try {
        this.panLeftGain = audioCtx.createGain();
        this.panRightGain = audioCtx.createGain();
        try {
          this.panLeftGain.channelCount = 1;
          this.panLeftGain.channelCountMode = "explicit";
          this.panRightGain.channelCount = 1;
          this.panRightGain.channelCountMode = "explicit";
        } catch (_) {}
        this.panLeftGain.gain.value = 1.0;
        this.panRightGain.gain.value = 1.0;
        this.panMerger = audioCtx.createChannelMerger(2);
        this.panLeftGain.connect(this.panMerger, 0, 0);
        this.panRightGain.connect(this.panMerger, 0, 1);
        this.useChannelMerger = true;
      } catch (e) {
        console.warn("[AUDIO] ChannelMerger pan setup failed, fallback to StereoPanner:", e);
        this.useChannelMerger = false;
      }
    }

    if (!this.useChannelMerger && audioCtx && typeof audioCtx.createStereoPanner === "function") {
      try {
        this.slotPanNode = audioCtx.createStereoPanner();
        this.slotPanNode.pan.value = 0.0; // 0.0 = Center (L+R)
      } catch (e) {
        console.warn("[AUDIO] createStereoPanner failed:", e);
        this.slotPanNode = null;
      }
    }
    
    this.activeTtsHandles = new Set();

    try {
      this.slotMuteGainNode.connect(this.slotDuckGainNode);
      if (this.useChannelMerger && this.panMerger) {
        this.slotDuckGainNode.connect(this.panLeftGain);
        this.slotDuckGainNode.connect(this.panRightGain);
        this.panMerger.connect(channelGainNode);
      } else if (this.slotPanNode) {
        this.slotDuckGainNode.connect(this.slotPanNode);
        this.slotPanNode.connect(channelGainNode);
      } else {
        this.slotDuckGainNode.connect(channelGainNode);
      }
    } catch (e) {
      console.warn("[AUDIO] Failed to connect slot " + slot + " to channel:", e);
    }
  }

  setDucking(ducked, duckLevel = 0.20, fadeTimeSec = 0.12) {
    this.isDucked = Boolean(ducked);
    this.duckLevel = Number(duckLevel);
    if (this.slotDuckGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      const target = this.isDucked ? Math.max(0.0, Math.min(1.0, Number(duckLevel))) : 1.0;
      try {
        const curVal = this.slotDuckGainNode.gain.value;
        this.slotDuckGainNode.gain.cancelScheduledValues(now);
        this.slotDuckGainNode.gain.setValueAtTime(curVal, now);
        this.slotDuckGainNode.gain.linearRampToValueAtTime(target, now + Math.max(0.02, fadeTimeSec || 0.12));
      } catch (_) {
        try { this.slotDuckGainNode.gain.value = target; } catch (_) {}
      }
    }
  }

  setPan(mode) {
    this.panMode = (mode === "L" || mode === "R") ? mode : "LR";
    const now = this.audioCtx ? this.audioCtx.currentTime : 0;
    const lVal = this.panMode === "R" ? 0.0 : 1.0;
    const rVal = this.panMode === "L" ? 0.0 : 1.0;

    if (this.panLeftGain && this.panRightGain && this.audioCtx) {
      try {
        const curL = this.panLeftGain.gain.value;
        this.panLeftGain.gain.cancelScheduledValues(now);
        this.panLeftGain.gain.setValueAtTime(curL, now);
        this.panLeftGain.gain.linearRampToValueAtTime(lVal, now + 0.015);
        this.panLeftGain.gain.value = lVal;
      } catch (_) {
        try { this.panLeftGain.gain.value = lVal; } catch (_) {}
      }
      try {
        const curR = this.panRightGain.gain.value;
        this.panRightGain.gain.cancelScheduledValues(now);
        this.panRightGain.gain.setValueAtTime(curR, now);
        this.panRightGain.gain.linearRampToValueAtTime(rVal, now + 0.015);
        this.panRightGain.gain.value = rVal;
      } catch (_) {
        try { this.panRightGain.gain.value = rVal; } catch (_) {}
      }
    }

    if (this.slotPanNode && this.audioCtx) {
      const targetVal = this.panMode === "L" ? -1.0 : (this.panMode === "R" ? 1.0 : 0.0);
      try {
        const curPan = this.slotPanNode.pan.value;
        this.slotPanNode.pan.cancelScheduledValues(now);
        this.slotPanNode.pan.setValueAtTime(curPan, now);
        this.slotPanNode.pan.linearRampToValueAtTime(targetVal, now + 0.015);
        this.slotPanNode.pan.value = targetVal;
      } catch (_) {
        try {
          this.slotPanNode.pan.value = targetVal;
        } catch (_) {}
      }
    }
  }

  setMuted(muted, opts = null) {
    const nextMuted = Boolean(muted);
    const immediate = Boolean(opts && opts.immediate);
    const changed = (this.isMuted !== nextMuted);
    this.isMuted = nextMuted;
    if (!changed && !immediate) return;

    const fadeSec = (!immediate && this.player && typeof this.player.getMuteFadeSec === "function")
      ? this.player.getMuteFadeSec()
      : 0.0;

    if (this._muteResetTimer) {
      clearTimeout(this._muteResetTimer);
      this._muteResetTimer = null;
    }

    if (this.slotMuteGainNode && this.audioCtx) {
      const target = this.isMuted ? 0.0 : 1.0;
      if (this.player && typeof this.player._rampGainParam === "function") {
        this.player._rampGainParam(this.slotMuteGainNode.gain, target, fadeSec, this.audioCtx);
      } else {
        const now = this.audioCtx.currentTime;
        this.slotMuteGainNode.gain.cancelScheduledValues(now);
        this.slotMuteGainNode.gain.setValueAtTime(target, now);
      }
    }
    if (this.activeTtsHandles && this.activeTtsHandles.size > 0 && this.audioCtx) {
      this.activeTtsHandles.forEach(h => {
        if (h && h.gainNode && !h.bypassSlotMute) {
          try {
            const nom = (typeof h.nominalGain === "number") ? h.nominalGain : 0.40;
            const ttsTarget = this.isMuted ? 0.0 : nom;
            if (this.player && typeof this.player._rampGainParam === "function") {
              this.player._rampGainParam(h.gainNode.gain, ttsTarget, fadeSec, this.audioCtx);
            } else {
              const now = this.audioCtx.currentTime;
              h.gainNode.gain.cancelScheduledValues(now);
              h.gainNode.gain.setValueAtTime(ttsTarget, now);
            }
          } catch (_) {}
        }
      });
    }
    if (this.isMuted) {
      if (immediate || fadeSec <= 0.01) {
        this._muteFadeOutUntilMs = 0;
        this.reset();
      } else {
        const tailMs = Math.ceil(fadeSec * 1000);
        this._muteFadeOutUntilMs = (typeof performance !== "undefined" ? performance.now() : Date.now()) + tailMs + 80;
        this._muteResetTimer = setTimeout(() => {
          this._muteResetTimer = null;
          if (this.isMuted) {
            this._muteFadeOutUntilMs = 0;
            this.reset();
          }
        }, tailMs + 60);
      }
    } else {
      this._muteFadeOutUntilMs = 0;
    }
  }

  isFeedAllowed() {
    if (!this.isMuted) return true;
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    return nowMs < (this._muteFadeOutUntilMs || 0);
  }

  feed(arrayBuffer) {
    if (!this.isFeedAllowed()) return;
    const now = this.audioCtx.currentTime;
    const int16Array = new Int16Array(arrayBuffer);
    const numSamples = int16Array.length;
    if (numSamples === 0) return;

    // Check if starting from silence or resuming after an idle gap (> 150ms)
    const isNewTransmission = (this.nextStartTime <= 0) || ((now - this.nextStartTime) > 0.150);
    if (isNewTransmission && this.agc) {
      this.agc.reset();
    }

    // 1. Normalized PCM input + Real-Time RX AGC & Soft-Knee Limiter
    const preGainDb = (this.player && typeof this.player.getPreGainDb === "function") ? this.player.getPreGainDb() : 0;
    const preGainLinear = Math.pow(10.0, preGainDb / 20.0);

    const inSamples = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
      inSamples[i] = (int16Array[i] / 32768.0) * preGainLinear;
    }
    if (this.agc) {
      if (this.player && typeof this.player.getRxAgcConfig === "function") {
        this.agc.configure(this.player.getRxAgcConfig());
      }
      this.agc.processSamples(inSamples, 8000);
    }

    // Boundary Trajectory Micro-Crossfade on incoming 60ms chunk boundary (index 0)
    // and internal 20ms AMBE frame boundaries (indices 160 and 320)
    if (isNewTransmission) {
      this.lastFeedSample = inSamples[0];
      this.lastFeedSlope = inSamples.length > 1 ? (inSamples[1] - inSamples[0]) : 0.0;
    }

    const checkBoundaries = [0, 160, 320];
    for (let b = 0; b < checkBoundaries.length; b++) {
      const idx = checkBoundaries[b];
      if (idx >= inSamples.length) continue;
      const prevS = (idx === 0) ? this.lastFeedSample : inSamples[idx - 1];
      const prevSlope = (idx === 0) ? this.lastFeedSlope : ((idx >= 2) ? (inSamples[idx - 1] - inSamples[idx - 2]) : 0.0);
      const curS = inSamples[idx];
      const jump = Math.abs(curS - prevS);
      if (jump > 0.035) { // ~1150 in 16-bit PCM scale (1150 / 32768)
        const fadeLen = Math.min(4, inSamples.length - idx);
        for (let k = 0; k < fadeLen; k++) {
          const w = 0.5 * (1.0 - Math.cos((Math.PI * (k + 1)) / (fadeLen + 1)));
          const ext = prevS + (k + 1) * prevSlope * 0.5;
          inSamples[idx + k] = ext * (1.0 - w) + inSamples[idx + k] * w;
        }
      }
    }
    if (inSamples.length >= 2) {
      this.lastFeedSample = inSamples[inSamples.length - 1];
      this.lastFeedSlope = inSamples[inSamples.length - 1] - inSamples[inSamples.length - 2];
    }

    // 2. Jitter Buffer cushion & transmission state tracking
    const jitterSec = (this.player && typeof this.player.getJitterBufferSec === "function")
      ? this.player.getJitterBufferSec()
      : 0.180; // Default 180 ms buffer cushion
    const startCushionSec = Math.min(0.320, Math.max(0.180, jitterSec));

    if (isNewTransmission) {
      // Clear resampler state to prevent stale audio history leaking from previous transmission
      this.resampleBuf = null;
      this.resamplePos = 0.0;
      this.chebyS1.fill(0);
      this.chebyS2.fill(0);
      this.nextStartTime = now + startCushionSec;
    } else if (this.nextStartTime < now) {
      // Ongoing transmission with a network stall (audio queue ran dry):
      // Restore healthy cushion (between 120ms and 260ms)
      this.nextStartTime = now + Math.min(0.260, Math.max(0.120, jitterSec * 0.5));
    } else if ((this.nextStartTime - now) > Math.max(0.800, jitterSec * 2.5)) {
      // Buffer drift / runaway protection: dynamic ceiling scaled to user's configured jitter buffer up to 2000ms!
      this.nextStartTime = now + startCushionSec;
    }

    // 3. Resample 8000 Hz stream to native audioCtx.sampleRate with 4-point Hermite continuity
    const targetRate = (this.audioCtx && this.audioCtx.sampleRate) ? this.audioCtx.sampleRate : 48000;
    let outSamples;
    let numOut;

    if (targetRate === 8000) {
      outSamples = inSamples;
      numOut = numSamples;
    } else if (targetRate === 48000) {
      numOut = numSamples * 6;
      outSamples = new Float32Array(numOut);
      for (let i = 0; i < numSamples; i++) {
        outSamples[i * 6] = inSamples[i] * 6.0;
      }
      // High-Fidelity 8th-order Linear-Passband Anti-Imaging Resampler (0-3400 Hz: +/-0.15 dB, >4400 Hz: <-70 dB)
      const b0 = [0.00179210, 1.0, 1.0, 1.0];
      const b1 = [0.00013708, -1.44747273, -1.66875045, -1.72030851];
      const b2 = [0.00179210, 1.0, 1.0, 1.0];
      const a1 = [-1.64783670, -1.69094764, -1.73401543, -1.76724683];
      const a2 = [0.69243186, 0.80556820, 0.91226991, 0.97631579];
      for (let s = 0; s < 4; s++) {
        let _s1 = this.chebyS1[s];
        let _s2 = this.chebyS2[s];
        const _b0 = b0[s], _b1 = b1[s], _b2 = b2[s];
        const _a1 = a1[s], _a2 = a2[s];
        for (let i = 0; i < numOut; i++) {
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
      const ratio = 8000.0 / targetRate;
      numOut = Math.round(numSamples * (targetRate / 8000.0));
      outSamples = new Float32Array(numOut);

      // Initialize continuous 4-point Hermite resampler
      if (!this.resampleBuf || this.resampleBuf.length < 3) {
        const s0 = inSamples[0];
        this.resampleBuf = new Float32Array([s0, s0, s0]);
        this.resamplePos = 1.0;
      }

      // Concatenate leftover history with new chunk
      const oldLen = this.resampleBuf.length;
      const combined = new Float32Array(oldLen + numSamples);
      combined.set(this.resampleBuf, 0);
      combined.set(inSamples, oldLen);

      const bufLen = combined.length;
      const maxPos = Math.max(1.0, bufLen - 2.001);
      let pos = this.resamplePos;
      numOut = Math.max(0, Math.ceil((maxPos - pos) / ratio));
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

    // 4. Create AudioBuffer at targetRate (EXACT match to AudioContext -> 0 browser resampling artifacts)
    const audioBuffer = this.audioCtx.createBuffer(1, numOut, targetRate);
    audioBuffer.getChannelData(0).set(outSamples);

    if (isNewTransmission) {
      // Smooth 2ms micro-fade-in to eliminate DAC turn-on pop/crack
      const fadeLen = Math.min(Math.round(targetRate * 0.002), numOut);
      const chData = audioBuffer.getChannelData(0);
      for (let i = 0; i < fadeLen; i++) {
        const ramp = 0.5 * (1.0 - Math.cos((Math.PI * i) / fadeLen));
        chData[i] *= ramp;
      }
    }

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.slotMuteGainNode);
    source.onended = () => { try { source.disconnect(); } catch(_) {} };
    source.start(this.nextStartTime);

    this.nextStartTime += audioBuffer.duration;
  }

  onTransmissionEnd() {
    this.resampleBuf = null;
    this.resamplePos = 0.0;
    this._lastFeedTime = 0;
    this.lastFeedSample = 0.0;
    this.lastFeedSlope = 0.0;
    if (this.agc) this.agc.reset();
    // Note: Do not hard-reset this.nextStartTime = 0 immediately!
    // Hardware audio buffer is still playing out the last 120-180ms of audio.
    // Leaving this.nextStartTime allows it to expire naturally without collision.
  }

  reset() {
    this.nextStartTime = 0;
    this.resampleBuf = null;
    this.resamplePos = 0.0;
    this._lastFeedTime = 0;
    this.lastFeedSample = 0.0;
    this.lastFeedSlope = 0.0;
    if (this.agc) this.agc.reset();
  }
}

class HotspotAudioChannel {
  constructor(hotspotId, audioCtx, destinationNode, player = null) {
    this.hotspotId = hotspotId;
    this.audioCtx = audioCtx;
    this.player = player;
    this.volume = 1.0;
    this.isMuted = false;
    this.isSingleAudioMuted = false;
    this._channelFadeOutUntilMs = 0;
    this._channelFadeInUntilMs = 0;

    this.channelGainNode = audioCtx.createGain();
    this.channelGainNode.gain.value = this.volume;
    try {
      this.channelGainNode.channelCount = 2;
      this.channelGainNode.channelCountMode = "explicit";
      this.channelGainNode.channelInterpretation = "speakers";
    } catch (_) {}

    if (destinationNode) {
      try {
        this.channelGainNode.connect(destinationNode);
      } catch (e) { }
    } else if (audioCtx && audioCtx.destination) {
      try {
        this.channelGainNode.connect(audioCtx.destination);
      } catch (e) { }
    }

    this.slots = {
      1: new HotspotAudioSlot(1, audioCtx, this.channelGainNode, player),
      2: new HotspotAudioSlot(2, audioCtx, this.channelGainNode, player)
    };
  }

  onTransmissionEnd(slot = null) {
    if (slot) {
      const s = parseInt(slot, 10);
      if (this.slots[s]) this.slots[s].onTransmissionEnd();
    } else {
      this.slots[1].onTransmissionEnd();
      this.slots[2].onTransmissionEnd();
    }
  }

  setSlotMute(slot, muted, opts = null) {
    const s = parseInt(slot, 10);
    const slotObj = this.slots[s];
    if (slotObj) {
      slotObj.setMuted(muted, opts);
    }
  }

  isSlotMuted(slot) {
    const s = parseInt(slot, 10);
    const slotObj = this.slots[s];
    return slotObj ? slotObj.isMuted : false;
  }

  setSlotPan(slot, mode) {
    const s = parseInt(slot, 10);
    const slotObj = this.slots[s];
    if (slotObj) {
      slotObj.setPan(mode);
    }
  }

  getSlotPan(slot) {
    const s = parseInt(slot, 10);
    const slotObj = this.slots[s];
    return slotObj ? slotObj.panMode : "LR";
  }

  setSlotDucking(slot, ducked, duckLevel = 0.20, fadeTimeSec = 0.12) {
    const s = parseInt(slot, 10) || 1;
    const slotObj = this.slots[s];
    if (slotObj) {
      slotObj.setDucking(ducked, duckLevel, fadeTimeSec);
    }
    if (this.player && this.player.useWorklet && this.player.workletNode) {
      try {
        const lvl = !isNaN(parseFloat(duckLevel)) ? Math.max(0.0, Math.min(1.0, parseFloat(duckLevel))) : 0.20;
        const hid = String(this.hotspotId || "default");
        this.player.workletNode.port.postMessage({
          type: "set_slot_ducking",
          hotspotId: hid,
          slot: s,
          ducked: Boolean(ducked),
          duckLevel: lvl
        });
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = hasRealDefault ? (hid === "default") : (hid === "default" || hid === primaryId);
        if (isPrimary) {
          const altId = (hid === "default") ? primaryId : "default";
          if (altId !== hid) {
            this.player.workletNode.port.postMessage({
              type: "set_slot_ducking",
              hotspotId: altId,
              slot: s,
              ducked: Boolean(ducked),
              duckLevel: lvl
            });
          }
        }
      } catch (_) {}
    }
  }

  setAllDucking(ducked, duckLevel = 1.0, fadeTimeSec = 0.25) {
    this.setSlotDucking(1, ducked, duckLevel, fadeTimeSec);
    this.setSlotDucking(2, ducked, duckLevel, fadeTimeSec);
  }

  isEffectivelyMuted() {
    return Boolean(this.isMuted || this.isSingleAudioMuted);
  }

  isFeedAllowed() {
    if (!this.isEffectivelyMuted()) return true;
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    return nowMs < (this._channelFadeOutUntilMs || 0);
  }

  feed(arrayBuffer, slot = 1) {
    if (!this.isFeedAllowed()) return;
    const s = parseInt(slot, 10) || 1;
    const slotObj = this.slots[s];
    if (slotObj && slotObj.isFeedAllowed()) {
      slotObj.feed(arrayBuffer);
    }
  }

  reset() {
    this.slots[1].reset();
    this.slots[2].reset();
  }

  _applyChannelMuteGain(immediate = false) {
    const effMuted = this.isEffectivelyMuted();
    const fadeSec = (!immediate && this.player && typeof this.player.getMuteFadeSec === "function")
      ? this.player.getMuteFadeSec()
      : 0.0;
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if (effMuted) {
      this._channelFadeInUntilMs = 0;
      this._channelFadeOutUntilMs = (immediate || fadeSec <= 0.01) ? 0 : (nowMs + Math.ceil(fadeSec * 1000) + 80);
    } else {
      this._channelFadeOutUntilMs = 0;
      this._channelFadeInUntilMs = (immediate || fadeSec <= 0.01) ? 0 : (nowMs + Math.ceil(fadeSec * 1000));
    }
    if (this.channelGainNode && this.audioCtx) {
      const target = effMuted ? 0.0 : this.volume;
      if (this.player && typeof this.player._rampGainParam === "function") {
        this.player._rampGainParam(this.channelGainNode.gain, target, fadeSec, this.audioCtx);
      } else {
        const now = this.audioCtx.currentTime;
        this.channelGainNode.gain.cancelScheduledValues(now);
        this.channelGainNode.gain.setTargetAtTime(target, now, 0.015);
      }
    }
  }

  setMuted(muted, opts = null) {
    const nextMuted = Boolean(muted);
    const immediate = Boolean(opts && opts.immediate);
    const prevEff = this.isEffectivelyMuted();
    this.isMuted = nextMuted;
    const nextEff = this.isEffectivelyMuted();
    if (prevEff === nextEff && !immediate) return;
    this._applyChannelMuteGain(immediate);
  }

  setSingleAudioMuted(muted, opts = null) {
    const nextMuted = Boolean(muted);
    const immediate = Boolean(opts && opts.immediate);
    const prevEff = this.isEffectivelyMuted();
    this.isSingleAudioMuted = nextMuted;
    const nextEff = this.isEffectivelyMuted();
    if (prevEff === nextEff && !immediate) return;
    this._applyChannelMuteGain(immediate);
  }

  setVolume(vol) {
    const parsed = typeof vol === "number" ? vol : parseFloat(vol);
    const raw = isNaN(parsed) ? 1.2 : parsed;
    // Only divide by 100 if raw is a whole percentage > 25 (e.g. 50%, 80%, 100%)
    const normalized = raw > 25.0 ? (raw / 100.0) : raw;
    this.volume = Math.max(0.0, Math.min(25.0, normalized));
    if (!this.isEffectivelyMuted() && this.audioCtx && this.channelGainNode) {
      const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const remFadeSec = Math.max(0, ((this._channelFadeInUntilMs || 0) - nowMs) / 1000.0);
      if (remFadeSec > 0.02 && this.player && typeof this.player._rampGainParam === "function") {
        this.player._rampGainParam(this.channelGainNode.gain, this.volume, remFadeSec, this.audioCtx);
      } else {
        const now = this.audioCtx.currentTime;
        this.channelGainNode.gain.cancelScheduledValues(now);
        this.channelGainNode.gain.setTargetAtTime(this.volume, now, 0.015);
      }
    }
  }


}

const MASTER_GAIN_9DB_ATTENUATION = 1.0; // Unity 0 dB master bus (no artificial -9 dB pad)
if (typeof window !== "undefined") {
  window.MASTER_GAIN_9DB_ATTENUATION = MASTER_GAIN_9DB_ATTENUATION;
}

class DMRAudioPlayer {
  constructor() {
    this.audioCtx = null;
    this.rxInputBus = null;
    this.recordingsInputBus = null;
    this.eqLowNode = null;
    this.eqMidNode = null;
    this.eqHighNode = null;
    this.deemphasisNode = null;
    this.eq10Filters = [];
    this.eq10Gains = [-1.0, -1.5, -0.5, 0.0, 1.0, 2.0, 2.5, 2.0, 1.0, -1.5];
    this.eq10Enabled = true;
    this.limiterEnabled = true;
    this.agcEnabled = true;
    this.agcDepthDb = 18;
    this.agcGainRaw = 35;
    this.activeProfileNet = "dmr";
    this.dspProfiles = {
      dmr: {
        eq10Enabled: true,
        eq10Gains: [-1.0, -1.5, -0.5, 0.0, 1.0, 2.0, 2.5, 2.0, 1.0, -1.5],
        limiterEnabled: true,
        agcEnabled: true,
        agcDepthDb: 18,
        agcGainRaw: 35
      },
      allstar: {
        eq10Enabled: false,
        eq10Gains: [0.0, 0.0, 0.0, 0.0, 0.5, 1.5, 2.0, 1.5, 0.5, -1.0],
        limiterEnabled: true,
        agcEnabled: true,
        agcDepthDb: 16,
        agcGainRaw: 25
      }
    };

    // Load persisted profiles for both networks from localStorage
    this.loadDspProfilesFromStorage();

    this.preGainNode = null;
    this.masterLimiter = null;
    this.masterGainNode = null;
    this.eq10Filters = [];
    this._graphJustBuilt = false;
    this.channels = new Map(); // hotspotId -> HotspotAudioChannel
    this.sampleRate = 8000;
    this.globalMuted = false;
    this.pttMuted = false;
    this.soloMuted = false;
    this.muteFadeEnabled = true;
    this.muteFadeDuration = 0.3;
    this._masterMutedState = false;
    this._masterFadeOutUntilMs = 0;
    this._masterFadeInUntilMs = 0;
    this._masterPostMuteTimer = null;
    this._soloFadeOutUntilMs = 0;
    this._soloPostMuteTimer = null;
    this._channelFadeOutUntilMs = new Map();
    this._singleFadeOutUntilMs = new Map();
    this._singleAudioMutedMap = new Map();
    this.workletNode = null;
    this.useWorklet = false;
    this.workletInitPromise = null;
    // Master bus runs at unity 0 dB (channel GainNodes/worklet control slider attenuation)
    this.masterVolume = 1.0;
    if (typeof window !== "undefined") {
      window.audioPlayer = this;
      window.dmrAudioPlayer = this;
    }
    // RX Audio DSP parameters (persisted in localStorage)
    this.preGainDb = 0;
    this.eqLow = 0;
    this.eqMid = 0;
    this.eqHigh = 0;
    this.deemphasis = false;
    this.jitterBufferMs = 180;
    this.rxBoostDb = 50;

    try {
      if (typeof localStorage !== "undefined") {
        const uid = (typeof window !== "undefined" && window.currentUserId) || null;
        const savedFadeEn = (uid ? localStorage.getItem(`proxdmr_u${uid}_mute_fade_enabled`) : null) ?? localStorage.getItem("proxdmr_mute_fade_enabled");
        if (savedFadeEn !== null) {
          this.muteFadeEnabled = (savedFadeEn !== "false");
        }
        const savedFadeDur = (uid ? localStorage.getItem(`proxdmr_u${uid}_mute_fade_duration`) : null) ?? localStorage.getItem("proxdmr_mute_fade_duration");
        if (savedFadeDur !== null) {
          const parsedF = parseFloat(String(savedFadeDur).replace(",", "."));
          if (!isNaN(parsedF)) {
            this.muteFadeDuration = Math.round(Math.max(0.1, Math.min(2.0, parsedF)) * 10) / 10;
          }
        }
        const savedBoost = localStorage.getItem("proxdmr_rx_boost_pct");
        if (savedBoost !== null) {
          const parsedB = parseInt(savedBoost, 10);
          if (!isNaN(parsedB) && parsedB >= 1 && parsedB <= 100) {
            this.rxBoostDb = parsedB;
          }
        }
        // Clear legacy hidden pre-gain key so it never clips incoming RX/Parrot audio
        localStorage.removeItem("proxdmr_pre_gain_db");
        this.preGainDb = 0;
        const sLow = localStorage.getItem("proxdmr_eq_low");
        if (sLow !== null) this.eqLow = Math.max(-12, Math.min(12, Math.round(parseFloat(sLow) || 0)));
        const sMid = localStorage.getItem("proxdmr_eq_mid");
        if (sMid !== null) this.eqMid = Math.max(-12, Math.min(12, Math.round(parseFloat(sMid) || 0)));
        const sHigh = localStorage.getItem("proxdmr_eq_high");
        if (sHigh !== null) this.eqHigh = Math.max(-12, Math.min(12, Math.round(parseFloat(sHigh) || 0)));
        this.deemphasis = localStorage.getItem("proxdmr_deemphasis") === "true";
        const savedJitter = localStorage.getItem("proxdmr_jitter_buffer_ms");
        if (savedJitter !== null) {
          const parsed = parseInt(savedJitter, 10);
          if (!isNaN(parsed) && parsed >= 40 && parsed <= 2000) {
            this.jitterBufferMs = parsed;
          }
        }
      }
    } catch (_) {}
  }

  getMuteFadeSec() {
    if (!this.muteFadeEnabled) return 0.005;
    const d = parseFloat(this.muteFadeDuration);
    return !isNaN(d) ? Math.max(0.1, Math.min(2.0, d)) : 0.3;
  }

  setMuteFadeConfig(enabled, durationSec) {
    if (enabled !== undefined && enabled !== null) {
      this.muteFadeEnabled = Boolean(enabled);
    }
    if (durationSec !== undefined && durationSec !== null) {
      const parsed = parseFloat(String(durationSec).replace(",", "."));
      if (!isNaN(parsed)) {
        this.muteFadeDuration = Math.round(Math.max(0.1, Math.min(2.0, parsed)) * 10) / 10;
      }
    }
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_mute_fade",
          enabled: this.muteFadeEnabled,
          durationSec: this.muteFadeDuration
        });
      } catch (_) {}
    }
  }

  _rampGainParam(gainParam, target, fadeSec, ctx = null) {
    if (!gainParam) return;
    const actx = ctx || this.audioCtx;
    const safeTarget = Math.max(0.0, Number(target) || 0.0);
    if (!actx) {
      try { gainParam.value = safeTarget; } catch (_) {}
      return;
    }
    const now = actx.currentTime;
    try {
      const curVal = Number.isFinite(gainParam.value) ? gainParam.value : safeTarget;
      gainParam.cancelScheduledValues(now);
      if (!fadeSec || fadeSec <= 0.001) {
        gainParam.setValueAtTime(safeTarget, now);
      } else {
        gainParam.setValueAtTime(curVal, now);
        gainParam.linearRampToValueAtTime(safeTarget, now + fadeSec);
      }
    } catch (_) {
      try { gainParam.value = safeTarget; } catch (__) {}
    }
  }

  _fadeHtmlAudioVolume(audioEl, targetVol, fadeSec) {
    if (!audioEl) return;
    const target = Math.max(0.0, Math.min(1.0, Number(targetVol) || 0.0));
    if (audioEl._muteFadeRafId) {
      try { cancelAnimationFrame(audioEl._muteFadeRafId); } catch (_) {}
      audioEl._muteFadeRafId = null;
    }
    const durMs = Math.round((Number(fadeSec) || 0) * 1000);
    if (durMs <= 16 || typeof requestAnimationFrame !== "function") {
      try { audioEl.volume = target; } catch (_) {}
      return;
    }
    const startVol = Math.max(0.0, Math.min(1.0, Number(audioEl.volume) || 0.0));
    if (Math.abs(startVol - target) < 0.001) {
      try { audioEl.volume = target; } catch (_) {}
      return;
    }
    const startTs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    const step = (ts) => {
      const nowTs = (typeof ts === "number" ? ts : (typeof performance !== "undefined" ? performance.now() : Date.now()));
      const p = Math.max(0.0, Math.min(1.0, (nowTs - startTs) / durMs));
      const nextVal = startVol + (target - startVol) * p;
      try { audioEl.volume = Math.max(0.0, Math.min(1.0, nextVal)); } catch (_) {}
      if (p < 1.0) {
        audioEl._muteFadeRafId = requestAnimationFrame(step);
      } else {
        audioEl._muteFadeRafId = null;
      }
    };
    audioEl._muteFadeRafId = requestAnimationFrame(step);
  }

  initSync(existingAudioContext = null) {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      try {
        this.audioCtx = existingAudioContext || new AudioCtxClass({ latencyHint: "playback" });
      } catch (_) {
        this.audioCtx = existingAudioContext || new AudioCtxClass();
      }
    }
    if (!this.masterLimiter && this.audioCtx) {
      try {
        if (this.audioCtx.destination) {
          try {
            const maxCh = this.audioCtx.destination.maxChannelCount || 2;
            this.audioCtx.destination.channelCount = Math.min(2, maxCh);
            this.audioCtx.destination.channelCountMode = "explicit";
            this.audioCtx.destination.channelInterpretation = "speakers";
          } catch (_) {}
        }

        // 0. RX Common Input Bus (for live DMR reception across all hotspots)
        this.rxInputBus = this.audioCtx.createGain();
        this.rxInputBus.gain.value = this.soloMuted ? 0.0 : 1.0;
        try {
          this.rxInputBus.channelCount = 2;
          this.rxInputBus.channelCountMode = "explicit";
          this.rxInputBus.channelInterpretation = "speakers";
        } catch (_) {}

        // 0b. Dedicated Recordings / Log Player Input Bus (routes directly to limiter + master gain)
        this.recordingsInputBus = this.audioCtx.createGain();
        this.recordingsInputBus.gain.value = 1.0;
        try {
          this.recordingsInputBus.channelCount = 2;
          this.recordingsInputBus.channelCountMode = "explicit";
          this.recordingsInputBus.channelInterpretation = "speakers";
        } catch (_) {}

        // 1. 10-Band Biquad Equalizer Cascade (Web Audio API)
        const EQ10_SPECS = [
          { freq: 110,  type: "peaking",   q: 1.2 },
          { freq: 200,  type: "peaking",   q: 1.4 },
          { freq: 330,  type: "peaking",   q: 2.2 },
          { freq: 460,  type: "peaking",   q: 2.2 },
          { freq: 750,  type: "peaking",   q: 1.4 },
          { freq: 1350, type: "peaking",   q: 2.2 },
          { freq: 2150, type: "peaking",   q: 2.5 },
          { freq: 2750, type: "peaking",   q: 2.5 },
          { freq: 3400, type: "peaking",   q: 1.8 },
          { freq: 5000, type: "highshelf", q: 1.0 },
        ];
        this.eq10Filters = EQ10_SPECS.map((spec, idx) => {
          const filter = this.audioCtx.createBiquadFilter();
          filter.type = spec.type;
          filter.frequency.value = spec.freq;
          filter.Q.value = spec.q;
          const g = (this.eq10Gains && this.eq10Gains[idx] !== undefined) ? this.eq10Gains[idx] : 0.0;
          filter.gain.value = this.eq10Enabled ? g : 0.0;
          return filter;
        });

        // 2. Pre-Gain Node (unity gain in WebAudio graph; digital Pre-Gain is applied to incoming samples in HotspotAudioSlot)
        this.preGainNode = this.audioCtx.createGain();
        this.preGainNode.gain.value = 1.0;
        try {
          this.preGainNode.channelCount = 2;
          this.preGainNode.channelCountMode = "explicit";
          this.preGainNode.channelInterpretation = "speakers";
        } catch (_) {}

        this.masterLimiter = this.audioCtx.createDynamicsCompressor();
        this.masterLimiter.threshold.value = this.limiterEnabled ? -1.0 : 0.0; // dBFS
        this.masterLimiter.knee.value = 6.0;       // Smooth soft knee (dB)
        this.masterLimiter.ratio.value = this.limiterEnabled ? 16.0 : 1.0;     // 1.0 = linear bypass
        this.masterLimiter.attack.value = 0.002;   // 2ms fast attack
        this.masterLimiter.release.value = 0.100;  // 100ms smooth recovery
        try {
          this.masterLimiter.channelCount = 2;
          this.masterLimiter.channelCountMode = "explicit";
          this.masterLimiter.channelInterpretation = "speakers";
        } catch (_) {}

        // 4. Master Gain Node (Global Mute and Master Volume)
        this.masterGainNode = this.audioCtx.createGain();
        const isMuted = this.globalMuted || this.pttMuted;
        this.masterGainNode.gain.value = isMuted ? 0.0 : this.masterVolume;
        try {
          this.masterGainNode.channelCount = 2;
          this.masterGainNode.channelCountMode = "explicit";
          this.masterGainNode.channelInterpretation = "speakers";
        } catch (_) {}

        // Connect graph:
        // Live RX: rxInputBus -> eq10Filters[0..9] -> preGainNode -> masterLimiter -> masterGainNode -> destination
        // Log Player: recordingsInputBus -> masterLimiter -> masterGainNode -> destination
        let prevNode = this.rxInputBus;
        for (let i = 0; i < this.eq10Filters.length; i++) {
          prevNode.connect(this.eq10Filters[i]);
          prevNode = this.eq10Filters[i];
        }
        prevNode.connect(this.preGainNode);
        this.preGainNode.connect(this.masterLimiter);
        this.recordingsInputBus.connect(this.masterLimiter);
        this.masterLimiter.connect(this.masterGainNode);
        this.masterGainNode.connect(this.audioCtx.destination);

        // Force-apply EQ gains directly from loaded profile (do NOT use syncActiveAudioRxPreset
        // which reads DOM sliders — DOM may not be ready or may have stale default values).
        // this.eq10Gains and this.eq10Enabled are already correctly loaded from localStorage
        // by loadDspProfilesFromStorage() called in the constructor.
        for (let _i = 0; _i < this.eq10Filters.length; _i++) {
          const _g = (this.eq10Gains && this.eq10Gains[_i] !== undefined) ? this.eq10Gains[_i] : 0.0;
          this.eq10Filters[_i].gain.value = this.eq10Enabled ? _g : 0.0;
        }
        this._applyEq10AutoGainPad();
        // Also force-apply limiter state from loaded profile
        if (this.masterLimiter) {
          this.masterLimiter.threshold.value = this.limiterEnabled ? -1.0 : 0.0;
          this.masterLimiter.ratio.value = this.limiterEnabled ? 16.0 : 1.0;
        }
        // Mark that graph was freshly built — ensureNetworkProfile must re-apply on first call
        this._graphJustBuilt = true;
      } catch (e) {
        console.warn("[AUDIO] Master graph init error:", e);
      }
    }
    if (!this.useWorklet && !this.workletInitPromise && this.audioCtx && this.audioCtx.audioWorklet) {
      this.initWorklet();
    }
  }

  async initWorklet() {
    if (this.workletInitPromise) return this.workletInitPromise;
    if (!this.audioCtx || !this.audioCtx.audioWorklet) {
      console.log("[AUDIO] AudioWorklet not supported, using classic AudioBuffer pipeline");
      return false;
    }
    this.workletInitPromise = (async () => {
      try {
        await this.audioCtx.audioWorklet.addModule(`/static/js/worklets/dmr-audio-processor.js?v=2.9.803`);
        this.workletNode = new AudioWorkletNode(this.audioCtx, "dmr-audio-processor", {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2]
        });

        // Route real-time worklet output through rxInputBus (limiter + master gain)
        if (this.rxInputBus) {
          this.workletNode.connect(this.rxInputBus);
        } else if (this.masterLimiter) {
          this.workletNode.connect(this.masterLimiter);
        } else {
          this.workletNode.connect(this.audioCtx.destination);
        }

        this.useWorklet = true;
        console.log("[AUDIO] Dedicated AudioWorklet real-time pipeline initialized successfully");

        // Sync initial player state to worklet
        this._syncWorkletState();

        this.workletNode.onprocessorerror = (err) => {
          console.error("[AUDIO] AudioWorklet processor error:", err);
          this.useWorklet = false;
        };
        return true;
      } catch (err) {
        console.warn("[AUDIO] AudioWorklet init failed, falling back to classic WebAudio:", err);
        this.useWorklet = false;
        return false;
      }
    })();
    return this.workletInitPromise;
  }

  _syncWorkletState() {
    if (!this.useWorklet || !this.workletNode) return;
    try {
      this.workletNode.port.postMessage({
        type: "set_mute_fade",
        enabled: this.muteFadeEnabled,
        durationSec: this.muteFadeDuration
      });
      this.workletNode.port.postMessage({
        type: "set_pre_gain",
        db: this.preGainDb
      });
      this.workletNode.port.postMessage({
        type: "set_agc_config",
        enabled: this.agcEnabled,
        depthDb: this.agcDepthDb,
        gainRaw: this.agcGainRaw
      });
      this.workletNode.port.postMessage({
        type: "set_jitter_buffer",
        ms: this.jitterBufferMs
      });
      this.workletNode.port.postMessage({
        type: "set_global_mute",
        muted: Boolean(this.globalMuted || this.pttMuted || this.soloMuted),
        immediate: true
      });
      this.channels.forEach((channel, hid) => {
        const singleMuted = this._isSingleAudioMutedFor(hid);
        channel.setSingleAudioMuted(singleMuted, { immediate: true });
        this._singleAudioMutedMap.set(hid, singleMuted);
        this.workletNode.port.postMessage({
          type: "set_channel_volume",
          hotspotId: hid,
          volume: channel.volume
        });
        this.workletNode.port.postMessage({
          type: "set_channel_mute",
          hotspotId: hid,
          muted: channel.isMuted,
          immediate: true
        });
        this.workletNode.port.postMessage({
          type: "set_single_audio_mute",
          hotspotId: hid,
          muted: singleMuted,
          immediate: true
        });
        for (const slot of [1, 2]) {
          const slotObj = channel.slots && channel.slots[slot];
          if (slotObj) {
            this.workletNode.port.postMessage({
              type: "set_slot_mute",
              hotspotId: hid,
              slot: slot,
              muted: slotObj.isMuted,
              immediate: true
            });
            const pan = slotObj.panMode || "LR";
            this.workletNode.port.postMessage({
              type: "set_slot_pan",
              hotspotId: hid,
              slot: slot,
              pan: pan === "L" ? "left" : (pan === "R" ? "right" : "center")
            });
          }
        }
      });
      if (typeof window !== "undefined" && window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncIdleDucking === "function") {
        try {
          window.ttsAudioQueueManager.syncIdleDucking(0.05);
        } catch (_) {}
      }
    } catch (_) {}
  }

  async init(existingAudioContext = null) {
    this.initSync(existingAudioContext);
    await this.initWorklet();
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      try {
        await this.audioCtx.resume();
      } catch (e) {
        console.warn("[AUDIO] Failed to resume AudioContext:", e);
      }
    }
  }

  ensureInitialized() {
    this.initSync();
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
  }

  getOrCreateChannel(hotspotId) {
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    let ch = this.channels.get(hid);
    if (!ch) {
      this.ensureInitialized();
      const dest = this.rxInputBus || this.masterLimiter || (this.audioCtx ? this.audioCtx.destination : null);
      ch = new HotspotAudioChannel(hid, this.audioCtx, dest, this);
      // Synchronize initial hotspot-level mute & single-hotspot-audio mute immediately
      const initHsMuted = (typeof window !== "undefined" && typeof window.isHotspotAudioMuted === "function")
        ? Boolean(window.isHotspotAudioMuted(hid))
        : false;
      ch.setMuted(initHsMuted, { immediate: true });
      const initSingleMuted = this._isSingleAudioMutedFor(hid);
      ch.setSingleAudioMuted(initSingleMuted, { immediate: true });
      this._singleAudioMutedMap.set(hid, initSingleMuted);

      // Synchronize initial mute state for both slots from getHotspotMute / localStorage
      if (typeof window !== "undefined" && typeof window.getHotspotMute === "function") {
        ch.setSlotMute(1, window.getHotspotMute(hid, 1), { immediate: true });
        ch.setSlotMute(2, window.getHotspotMute(hid, 2), { immediate: true });
      } else if (typeof localStorage !== "undefined") {
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = hasRealDefault ? (hid === "default") : (hid === "default" || hid === primaryId);
        const m1 = localStorage.getItem(`proxdmr_mute_${hid}_ts1`) === "true" || (isPrimary && localStorage.getItem("proxdmr_mute_default_ts1") === "true");
        const m2 = localStorage.getItem(`proxdmr_mute_${hid}_ts2`) === "true" || (isPrimary && localStorage.getItem("proxdmr_mute_default_ts2") === "true");
        ch.setSlotMute(1, m1, { immediate: true });
        ch.setSlotMute(2, m2, { immediate: true });
      }
      // Synchronize initial volume from getHotspotVolume / localStorage
      if (typeof window !== "undefined" && typeof window.getHotspotVolume === "function") {
        ch.setVolume(window.getHotspotVolume(hid) / 100.0);
      } else if (typeof localStorage !== "undefined") {
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = hasRealDefault ? (hid === "default") : (hid === "default" || hid === primaryId);
        const v = localStorage.getItem(`proxdmr_vol_${hid}`) || (isPrimary ? (localStorage.getItem("proxdmr_vol_default") || localStorage.getItem("proxdmr_volume")) : null);
        if (v !== null) {
          const p = parseInt(v, 10);
          if (!isNaN(p)) ch.setVolume(p / 100.0);
        }
      }
      // Synchronize initial pan state for both slots from getHotspotPan / localStorage
      let p1 = "LR";
      let p2 = "LR";
      if (typeof window !== "undefined" && typeof window.getHotspotPan === "function") {
        p1 = window.getHotspotPan(hid, 1);
        p2 = window.getHotspotPan(hid, 2);
      } else if (typeof localStorage !== "undefined") {
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = hasRealDefault ? (hid === "default") : (hid === "default" || hid === primaryId);
        p1 = localStorage.getItem(`proxdmr_pan_${hid}_ts1`) || (isPrimary ? localStorage.getItem("proxdmr_pan_default_ts1") : null) || "LR";
        p2 = localStorage.getItem(`proxdmr_pan_${hid}_ts2`) || (isPrimary ? localStorage.getItem("proxdmr_pan_default_ts2") : null) || "LR";
      }
      ch.setSlotPan(1, p1);
      ch.setSlotPan(2, p2);
      this.channels.set(hid, ch);
      if (this.useWorklet && this.workletNode) {
        try {
          this.workletNode.port.postMessage({
            type: "set_channel_volume",
            hotspotId: hid,
            volume: ch.volume
          });
          this.workletNode.port.postMessage({
            type: "set_channel_mute",
            hotspotId: hid,
            muted: ch.isMuted,
            immediate: true
          });
          this.workletNode.port.postMessage({
            type: "set_single_audio_mute",
            hotspotId: hid,
            muted: initSingleMuted,
            immediate: true
          });
          this.workletNode.port.postMessage({
            type: "set_slot_mute",
            hotspotId: hid,
            slot: 1,
            muted: ch.isSlotMuted(1),
            immediate: true
          });
          this.workletNode.port.postMessage({
            type: "set_slot_mute",
            hotspotId: hid,
            slot: 2,
            muted: ch.isSlotMuted(2),
            immediate: true
          });
          this.workletNode.port.postMessage({
            type: "set_slot_pan",
            hotspotId: hid,
            slot: 1,
            pan: p1 === "L" ? "left" : (p1 === "R" ? "right" : "center")
          });
          this.workletNode.port.postMessage({
            type: "set_slot_pan",
            hotspotId: hid,
            slot: 2,
            pan: p2 === "L" ? "left" : (p2 === "R" ? "right" : "center")
          });
        } catch (_) {}
      }
      if (typeof window !== "undefined" && window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncIdleDucking === "function") {
        try { window.ttsAudioQueueManager.syncIdleDucking(0.05); } catch (_) {}
      }
    }
    return ch;
  }

  loadDspProfilesFromStorage() {
    try {
      if (typeof localStorage === "undefined") return;

      // DMR Profile
      const curDmrPres = localStorage.getItem("proxdmr_audio_rx_active_preset") || "1";
      const rawDmr = localStorage.getItem(`proxdmr_audio_rx_preset_${curDmrPres}`);
      if (rawDmr) {
        const d = JSON.parse(rawDmr);
        if (d) {
          if (d.eq10Enable !== undefined) this.dspProfiles.dmr.eq10Enabled = Boolean(d.eq10Enable);
          if (Array.isArray(d.eq10Gains) && d.eq10Gains.length === 10) {
            this.dspProfiles.dmr.eq10Gains = d.eq10Gains.map(v => Number(v) / 10.0);
          }
          if (d.limiterEnable !== undefined) this.dspProfiles.dmr.limiterEnabled = Boolean(d.limiterEnable);
          if (d.agcEnable !== undefined) this.dspProfiles.dmr.agcEnabled = Boolean(d.agcEnable);
          if (d.agcDepth !== undefined) {
            const ad = parseInt(d.agcDepth, 10);
            if (!isNaN(ad)) this.dspProfiles.dmr.agcDepthDb = Math.max(6, Math.min(30, ad));
          }
          if (d.agcGain !== undefined) {
            const ag = parseInt(d.agcGain, 10);
            if (!isNaN(ag)) this.dspProfiles.dmr.agcGainRaw = Math.max(10, Math.min(120, ag));
          }
        }
      } else if (localStorage.getItem("proxdmr_agc") !== null) {
        this.dspProfiles.dmr.agcEnabled = localStorage.getItem("proxdmr_agc") !== "false";
      }

      // AllStar Profile
      const curAslPres = localStorage.getItem("proxdmr_asl_audio_rx_active_preset") || "1";
      const rawAsl = localStorage.getItem(`proxdmr_asl_audio_rx_preset_${curAslPres}`);
      if (rawAsl) {
        const a = JSON.parse(rawAsl);
        if (a) {
          if (a.eq10Enable !== undefined) this.dspProfiles.allstar.eq10Enabled = Boolean(a.eq10Enable);
          if (Array.isArray(a.eq10Gains) && a.eq10Gains.length === 10) {
            this.dspProfiles.allstar.eq10Gains = a.eq10Gains.map(v => Number(v) / 10.0);
          }
          if (a.limiterEnable !== undefined) this.dspProfiles.allstar.limiterEnabled = Boolean(a.limiterEnable);
          if (a.agcEnable !== undefined) this.dspProfiles.allstar.agcEnabled = Boolean(a.agcEnable);
          if (a.agcDepth !== undefined) {
            const ad = parseInt(a.agcDepth, 10);
            if (!isNaN(ad)) this.dspProfiles.allstar.agcDepthDb = Math.max(6, Math.min(30, ad));
          }
          if (a.agcGain !== undefined) {
            const ag = parseInt(a.agcGain, 10);
            if (!isNaN(ag)) this.dspProfiles.allstar.agcGainRaw = Math.max(10, Math.min(120, ag));
          }
        }
      }

      // Initial active profile
      const storedNet = localStorage.getItem("proxdmr_audio_rx_net") || "dmr";
      this.activeProfileNet = (storedNet === "allstar") ? "allstar" : "dmr";
      const p = this.dspProfiles[this.activeProfileNet];
      if (p) {
        this.eq10Enabled = p.eq10Enabled;
        this.eq10Gains = p.eq10Gains.slice();
        this.limiterEnabled = p.limiterEnabled;
        this.agcEnabled = p.agcEnabled !== false;
        this.agcDepthDb = p.agcDepthDb || 18;
        this.agcGainRaw = p.agcGainRaw || 35;
      }
      if (typeof this._syncAgcToEngine === "function") {
        this._syncAgcToEngine();
      }
    } catch (_) {}
  }

  ensureNetworkProfile(targetNet, force = false) {
    const net = (targetNet === "allstar") ? "allstar" : "dmr";
    // Skip if same network AND graph was not just rebuilt.
    // _graphJustBuilt is set to true in initSync() after graph construction;
    // it is cleared here after first successful profile application.
    if (!force && this.activeProfileNet === net && !this._graphJustBuilt) return;
    this._graphJustBuilt = false;
    this.activeProfileNet = net;
    const p = this.dspProfiles[net];
    if (!p) return;

    this.eq10Enabled = p.eq10Enabled;
    this.eq10Gains = p.eq10Gains.slice();
    this.limiterEnabled = p.limiterEnabled;
    this.agcEnabled = p.agcEnabled !== false;
    this.agcDepthDb = p.agcDepthDb || (net === "allstar" ? 16 : 18);
    this.agcGainRaw = p.agcGainRaw || (net === "allstar" ? 25 : 35);

    // Apply directly to WebAudio biquad filters, limiter and real-time RX AGC
    for (let i = 0; i < this.eq10Filters.length; i++) {
      if (this.eq10Filters[i]) {
        const g = (this.eq10Gains[i] !== undefined) ? this.eq10Gains[i] : 0.0;
        this.eq10Filters[i].gain.value = this.eq10Enabled ? g : 0.0;
      }
    }
    this._applyEq10AutoGainPad();
    if (this.masterLimiter) {
      if (this.limiterEnabled) {
        this.masterLimiter.threshold.value = -1.0;
        this.masterLimiter.ratio.value = 16.0;
      } else {
        this.masterLimiter.threshold.value = 0.0;
        this.masterLimiter.ratio.value = 1.0;
      }
    }
    this._syncAgcToEngine();
  }

  ensureProfileForHotspot(hotspotId) {
    let netType = "dmr";
    if (typeof window !== "undefined") {
      if (typeof window.getHotspotNetworkType === "function") {
        netType = window.getHotspotNetworkType(hotspotId) || "dmr";
      } else if (Array.isArray(window.currentHotspots)) {
        const hs = window.currentHotspots.find(h => String(h.id) === String(hotspotId));
        if (hs && hs.network_type) netType = hs.network_type;
      }
    }
    this.ensureNetworkProfile(netType === "allstar" ? "allstar" : "dmr");
  }

  feed(arrayBuffer, hotspotId = "default", slot = 1) {
    this.ensureInitialized();
    if (!this.audioCtx) return;
    this.ensureProfileForHotspot(hotspotId);
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    if ((this.globalMuted || this.pttMuted) && nowMs >= (this._masterFadeOutUntilMs || 0)) return;
    if (this.soloMuted && nowMs >= (this._soloFadeOutUntilMs || 0)) return;

    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const s = parseInt(slot, 10) || 1;

    // Check hotspot channel mute (allow feeding during smooth fade-out tail)
    if (this.isHotspotMuted(hid) && nowMs >= (this._channelFadeOutUntilMs.get(hid) || 0)) return;

    // Check single hotspot audio mode (allow feeding during smooth fade-out tail)
    if (this._isSingleAudioMutedFor(hid)) {
      if (nowMs >= (this._singleFadeOutUntilMs.get(hid) || 0)) {
        return;
      }
    }

    if (this.useWorklet && this.workletNode) {
      try {
        // Ensure channel and its slot mute/volume state are initialized and synced to the worklet
        this.getOrCreateChannel(hid);
        // Zero-copy transfer of raw PCM buffer to dedicated real-time audio thread
        // (muted slots stay warm in the worklet ring buffer at gain=0.0 for smooth mute/unmute & TS switching)
        this.workletNode.port.postMessage(
          { type: "feed", hotspotId: hid, slot: s, buffer: arrayBuffer },
          [arrayBuffer]
        );
        return;
      } catch (err) {
        console.warn("[AUDIO] Worklet postMessage feed error:", err);
      }
    }

    const ch = this.getOrCreateChannel(hid);
    if (!ch.isFeedAllowed()) return;
    const slotObj = ch.slots && ch.slots[s];
    if (!slotObj || !slotObj.isFeedAllowed()) return;
    ch.feed(arrayBuffer, s);
  }

  setSlotMute(hotspotId, slot, muted) {
    const s = parseInt(slot, 10) || 1;
    const isMuted = Boolean(muted);
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";

    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_slot_mute",
          hotspotId: hid,
          slot: s,
          muted: isMuted
        });
      } catch (_) {}
    }

    const ch = this.getOrCreateChannel(hid);
    if (ch) ch.setSlotMute(s, isMuted);

    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isPrimary = hasRealDefault ? false : (hid === "default" || hid === primaryId);

    this.channels.forEach((channel, key) => {
      const sKey = String(key);
      if (sKey === hid) {
        channel.setSlotMute(s, isMuted);
      } else if (isPrimary && (sKey === "default" || sKey === primaryId)) {
        channel.setSlotMute(s, isMuted);
        if (this.useWorklet && this.workletNode) {
          try {
            this.workletNode.port.postMessage({
              type: "set_slot_mute",
              hotspotId: sKey,
              slot: s,
              muted: isMuted
            });
          } catch (_) {}
        }
      }
    });
  }

  updateSlotMute(hotspotId, slot, muted) {
    this.setSlotMute(hotspotId, slot, muted);
  }

  isSlotMuted(hotspotId, slot) {
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    let ch = this.channels.get(hid);
    if (!ch) {
      const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
      const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
      const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
      if (!hasRealDefault) {
        if (hid === "default" && primaryId !== "default") {
          ch = this.channels.get(primaryId);
        } else if (hid === primaryId && primaryId !== "default") {
          ch = this.channels.get("default");
        }
      }
    }
    return ch ? ch.isSlotMuted(slot) : false;
  }

  setSlotPan(hotspotId, slot, mode) {
    const s = parseInt(slot, 10) || 1;
    const safeMode = (mode === "L" || mode === "R") ? mode : "LR";
    const panStr = safeMode === "L" ? "left" : (safeMode === "R" ? "right" : "center");
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";

    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_slot_pan",
          hotspotId: hid,
          slot: s,
          pan: panStr
        });
      } catch (_) {}
    }

    const ch = this.getOrCreateChannel(hid);
    if (ch) ch.setSlotPan(s, safeMode);

    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isPrimary = hasRealDefault ? false : (hid === "default" || hid === primaryId);

    this.channels.forEach((channel, key) => {
      const sKey = String(key);
      if (sKey === hid) {
        channel.setSlotPan(s, safeMode);
      } else if (isPrimary && (sKey === "default" || sKey === primaryId)) {
        channel.setSlotPan(s, safeMode);
        if (this.useWorklet && this.workletNode) {
          try {
            this.workletNode.port.postMessage({
              type: "set_slot_pan",
              hotspotId: sKey,
              slot: s,
              pan: panStr
            });
          } catch (_) {}
        }
      }
    });
  }

  updateSlotPan(hotspotId, slot, mode) {
    this.setSlotPan(hotspotId, slot, mode);
  }

  getSlotPan(hotspotId, slot) {
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    let ch = this.channels.get(hid);
    if (!ch) {
      const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
      const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
      const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
      if (!hasRealDefault) {
        if (hid === "default" && primaryId !== "default") {
          ch = this.channels.get(primaryId);
        } else if (hid === primaryId && primaryId !== "default") {
          ch = this.channels.get("default");
        }
      }
    }
    return ch ? ch.getSlotPan(slot) : "LR";
  }

  async playTtsAudio(hotspotId, slot, arrayBuffer, speed = 1.0, onEnded = null, options = {}) {
    this.ensureInitialized();
    if (!this.audioCtx) {
      throw new Error("No AudioContext available");
    }
    if (this.audioCtx.state === "suspended") {
      try { await this.audioCtx.resume(); } catch (_) {}
    }

    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const s = parseInt(slot, 10) || 1;
    const ch = this.getOrCreateChannel(hid);
    const slotObj = (ch && ch.slots) ? ch.slots[s] : null;

    // Decode WAV array buffer (make a safe copy because decodeAudioData may detach the ArrayBuffer)
    const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer.slice(0));

    const source = this.audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.playbackRate.value = Math.max(0.5, Math.min(2.5, parseFloat(speed) || 1.0));
    if (options && typeof options.detuneCents === "number" && options.detuneCents !== 0 && source.detune) {
      try {
        source.detune.value = Math.max(-200, Math.min(200, options.detuneCents));
      } catch (_) {}
    }

    // Dedicated gain node for this TTS playback instance
    const ttsGain = this.audioCtx.createGain();

    // Check mute states
    const useDirectBus = Boolean(options && (options.isTest || options.bypassMute || options.useRecordingsBus));
    const isTest = useDirectBus;
    const bypassSlotMute = isTest || Boolean(options && options.bypassSlotMute);
    const isSlotMuted = bypassSlotMute ? false : ((slotObj && slotObj.isMuted) || ch.isSlotMuted(s));
    const isChannelMuted = isTest
      ? false
      : (bypassSlotMute
          ? Boolean(this.globalMuted || this.pttMuted)
          : Boolean(ch.isMuted || this.globalMuted || this.pttMuted || this.soloMuted));
    
    // Balanced gain factor with 0 dB unity master bus:
    // TTS WAV is normalized near 0 dBFS while RX AGC targets ~ -13..-10 dBFS RMS;
    // 0.40 balances voice announcements cleanly with DMR reception without loudness jump.
    ttsGain.gain.value = (isSlotMuted || isChannelMuted) ? 0.0 : 0.40;

    source.connect(ttsGain);

    // If this is an independent test or history read (useDirectBus), route directly to recordingsInputBus
    // which bypasses rxInputBus and hotspot slot mutes completely!
    if (useDirectBus) {
      ttsGain.connect(this.recordingsInputBus || this.masterLimiter || this.audioCtx.destination);
    } else if (slotObj && slotObj.useChannelMerger && slotObj.panLeftGain && slotObj.panRightGain) {
      ttsGain.connect(slotObj.panLeftGain);
      ttsGain.connect(slotObj.panRightGain);
    } else if (slotObj && slotObj.slotPanNode) {
      ttsGain.connect(slotObj.slotPanNode);
    } else if (slotObj && slotObj.panLeftGain && slotObj.panRightGain) {
      ttsGain.connect(slotObj.panLeftGain);
      ttsGain.connect(slotObj.panRightGain);
    } else if (ch && ch.channelGainNode) {
      ttsGain.connect(ch.channelGainNode);
    } else if (this.rxInputBus) {
      ttsGain.connect(this.rxInputBus);
    } else {
      ttsGain.connect(this.audioCtx.destination);
    }

    let finished = false;
    const handle = {
      source,
      gainNode: ttsGain,
      nominalGain: 0.40,
      _lastSyncedMuted: Boolean(isSlotMuted || isChannelMuted),
      hotspotId: hid,
      slot: s,
      bypassSlotMute,
      audioCtx: this.audioCtx,
      stop: () => {
        try { source.stop(); } catch (_) {}
        finish();
      }
    };

    if (slotObj && slotObj.activeTtsHandles && !bypassSlotMute) {
      slotObj.activeTtsHandles.add(handle);
    }

    const finish = () => {
      if (finished) return;
      finished = true;
      if (slotObj && slotObj.activeTtsHandles) {
        slotObj.activeTtsHandles.delete(handle);
      }
      try { source.disconnect(); } catch (_) {}
      try { ttsGain.disconnect(); } catch (_) {}
      if (typeof onEnded === "function") {
        onEnded();
      }
    };

    source.onended = finish;
    source.start(0);

    return handle;
  }

  getAllHotspotIds() {
    const ids = new Set();
    ids.add("default");
    const hsList = (typeof window !== "undefined" && window.currentHotspots) || [];
    if (Array.isArray(hsList)) {
      hsList.forEach(hs => {
        if (hs && hs.id) ids.add(String(hs.id));
      });
    }
    if (typeof document !== "undefined") {
      document.querySelectorAll(".radio-container[data-hotspot-id]").forEach(el => {
        if (el.dataset.hotspotId) ids.add(String(el.dataset.hotspotId));
      });
    }
    if (this.channels) {
      this.channels.forEach((_, k) => ids.add(String(k)));
    }
    return Array.from(ids);
  }

  setSlotDucking(hotspotId, slot, ducked, duckLevel = 0.20, fadeTimeSec = 0.12) {
    const s = parseInt(slot, 10) || 1;
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const parsedLevel = parseFloat(duckLevel);
    const safeDuckLevel = !isNaN(parsedLevel) ? Math.max(0.0, Math.min(1.0, parsedLevel)) : 0.20;

    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isPrimary = hasRealDefault ? false : (hid === "default" || hid === primaryId);

    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_slot_ducking",
          hotspotId: hid,
          slot: s,
          ducked: Boolean(ducked),
          duckLevel: safeDuckLevel
        });
        if (isPrimary) {
          const altId = (hid === "default") ? primaryId : "default";
          if (altId !== hid) {
            this.workletNode.port.postMessage({
              type: "set_slot_ducking",
              hotspotId: altId,
              slot: s,
              ducked: Boolean(ducked),
              duckLevel: safeDuckLevel
            });
          }
        }
      } catch (_) {}
    }

    const ch = this.channels.get(hid);
    if (ch) ch.setSlotDucking(s, ducked, duckLevel, fadeTimeSec);

    this.channels.forEach((channel, key) => {
      const sKey = String(key);
      if (sKey === hid) {
        channel.setSlotDucking(s, ducked, duckLevel, fadeTimeSec);
      } else if (isPrimary && (sKey === "default" || sKey === primaryId)) {
        channel.setSlotDucking(s, ducked, duckLevel, fadeTimeSec);
      }
    });
  }

  setOtherChannelsDucking(targetHotspotId, targetSlot, ducked, duckLevel = 0.0, fadeTimeSec = 0.12) {
    const tHid = (targetHotspotId !== undefined && targetHotspotId !== null && targetHotspotId !== "") ? String(targetHotspotId) : "default";
    const tSlot = parseInt(targetSlot, 10) || 1;
    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isTargetPrimary = !hasRealDefault && (tHid === "default" || tHid === primaryId);
    const parsedLevel = parseFloat(duckLevel);
    const safeDuckLevel = !isNaN(parsedLevel) ? Math.max(0.0, Math.min(1.0, parsedLevel)) : 0.0;

    const allHids = this.getAllHotspotIds();
    allHids.forEach(hid => {
      const isChannelPrimary = !hasRealDefault && (hid === "default" || hid === primaryId);
      const isSameHotspot = (hid === tHid) || (isTargetPrimary && isChannelPrimary);

      [1, 2].forEach(slot => {
        if (isSameHotspot && slot === tSlot) {
          return; // Skip target speech slot
        }
        if (this.useWorklet && this.workletNode) {
          try {
            this.workletNode.port.postMessage({
              type: "set_slot_ducking",
              hotspotId: hid,
              slot: slot,
              ducked: Boolean(ducked),
              duckLevel: safeDuckLevel
            });
          } catch (_) {}
        }
        const ch = this.channels.get(hid);
        if (ch) ch.setSlotDucking(slot, ducked, duckLevel, fadeTimeSec);
      });
    });
  }

  restoreAllDucking(fadeTimeSec = 0.25) {
    const allHids = this.getAllHotspotIds();
    allHids.forEach(hid => {
      [1, 2].forEach(slot => {
        if (this.useWorklet && this.workletNode) {
          try {
            this.workletNode.port.postMessage({
              type: "set_slot_ducking",
              hotspotId: hid,
              slot: slot,
              ducked: false,
              duckLevel: 1.0
            });
          } catch (_) {}
        }
        const ch = this.channels.get(hid);
        if (ch) ch.setSlotDucking(slot, false, 1.0, fadeTimeSec);
      });
    });
  }

  _isSingleAudioMutedFor(hotspotId, activeHidOverride = null) {
    if (typeof window === "undefined" || typeof window.isSingleHotspotAudioEnabled !== "function" || !window.isSingleHotspotAudioEnabled()) {
      return false;
    }
    const hid = String(hotspotId || "default");
    const currentHotspots = window.currentHotspots || [];
    const hasRealDefault = Array.isArray(currentHotspots) && currentHotspots.some(h => h && String(h.id) === "default");
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const activeHid = String(activeHidOverride || window.activeHotspotId || primaryId || "default");
    if (hid === activeHid) return false;
    if (!hasRealDefault) {
      const hidIsPrimary = (hid === "default" || hid === primaryId);
      const activeIsPrimary = (activeHid === "default" || activeHid === primaryId);
      if (hidIsPrimary && activeIsPrimary) return false;
    }
    return true;
  }

  syncSingleHotspotAudioMute(activeHidOverride = null) {
    const allHids = this.getAllHotspotIds();
    const fadeSec = this.getMuteFadeSec();
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
    allHids.forEach(hid => {
      const shouldMute = this._isSingleAudioMutedFor(hid, activeHidOverride);
      const prevMuted = this._singleAudioMutedMap.has(hid) ? this._singleAudioMutedMap.get(hid) : false;
      this._singleAudioMutedMap.set(hid, shouldMute);
      if (shouldMute && !prevMuted) {
        this._singleFadeOutUntilMs.set(hid, nowMs + Math.ceil(fadeSec * 1000) + 80);
      } else if (!shouldMute) {
        this._singleFadeOutUntilMs.delete(hid);
      }
      if (this.useWorklet && this.workletNode) {
        try {
          this.workletNode.port.postMessage({
            type: "set_single_audio_mute",
            hotspotId: hid,
            muted: shouldMute
          });
        } catch (_) {}
      }
      const ch = this.channels.get(hid);
      if (ch) ch.setSingleAudioMuted(shouldMute);
    });
  }

  setHotspotMute(hotspotId, muted) {
    const hid = String(hotspotId || "default");
    const isMuted = Boolean(muted);
    const ch = this.getOrCreateChannel(hotspotId);
    const prevMuted = Boolean(ch && ch.isMuted);
    if (isMuted && !prevMuted) {
      const fadeSec = this.getMuteFadeSec();
      const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
      this._channelFadeOutUntilMs.set(hid, nowMs + Math.ceil(fadeSec * 1000) + 80);
    } else if (!isMuted) {
      this._channelFadeOutUntilMs.delete(hid);
    }
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_channel_mute",
          hotspotId: hid,
          muted: isMuted
        });
      } catch (_) {}
    }
    if (ch) ch.setMuted(isMuted);
  }

  isHotspotMuted(hotspotId) {
    const hid = String(hotspotId || "default");
    const ch = this.channels.get(hid);
    return ch ? ch.isMuted : false;
  }

  _updateMasterGain(isMuteToggle = false, resetAfterFade = false) {
    const isMuted = Boolean(this.globalMuted || this.pttMuted);
    const prevMuted = Boolean(this._masterMutedState);
    const muteChanged = (isMuted !== prevMuted);
    this._masterMutedState = isMuted;

    if (isMuteToggle || muteChanged) {
      const fadeSec = this.getMuteFadeSec();
      const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());

      if (this._masterPostMuteTimer) {
        clearTimeout(this._masterPostMuteTimer);
        this._masterPostMuteTimer = null;
      }

      if (isMuted) {
        this._masterFadeInUntilMs = 0;
        const tailMs = Math.ceil(fadeSec * 1000);
        this._masterFadeOutUntilMs = (fadeSec <= 0.01) ? 0 : (nowMs + tailMs + 80);

        if (this.audioCtx && this.masterGainNode) {
          this._rampGainParam(this.masterGainNode.gain, 0.0, fadeSec, this.audioCtx);
        }

        const finalizeMasterMute = () => {
          this._masterPostMuteTimer = null;
          if (!(this.globalMuted || this.pttMuted)) return;
          this._masterFadeOutUntilMs = 0;
          if (this.useWorklet && this.workletNode) {
            try {
              this.workletNode.port.postMessage({
                type: "set_global_mute",
                muted: true,
                immediate: true
              });
              if (resetAfterFade || this.pttMuted) {
                this.workletNode.port.postMessage({ type: "reset" });
              }
            } catch (_) {}
          }
          if (resetAfterFade || this.pttMuted) {
            this.channels.forEach(ch => ch.reset());
          }
        };

        if (fadeSec <= 0.01) {
          finalizeMasterMute();
        } else {
          this._masterPostMuteTimer = setTimeout(finalizeMasterMute, tailMs + 60);
        }
      } else {
        this._masterFadeOutUntilMs = 0;
        this._masterFadeInUntilMs = (fadeSec <= 0.01) ? 0 : (nowMs + Math.ceil(fadeSec * 1000));

        if (!this.soloMuted && this.useWorklet && this.workletNode) {
          try {
            this.workletNode.port.postMessage({
              type: "set_global_mute",
              muted: false,
              immediate: true
            });
          } catch (_) {}
        }
        if (this.audioCtx && this.masterGainNode) {
          this._rampGainParam(this.masterGainNode.gain, this.masterVolume, fadeSec, this.audioCtx);
        }
      }
      return;
    }

    // Normal master volume slider adjustment (not a mute transition)
    if (!isMuted && this.audioCtx && this.masterGainNode) {
      const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());
      const remFadeSec = Math.max(0, ((this._masterFadeInUntilMs || 0) - nowMs) / 1000.0);
      if (remFadeSec > 0.02) {
        this._rampGainParam(this.masterGainNode.gain, this.masterVolume, remFadeSec, this.audioCtx);
      } else {
        const now = this.audioCtx.currentTime;
        this.masterGainNode.gain.cancelScheduledValues(now);
        this.masterGainNode.gain.setTargetAtTime(this.masterVolume, now, 0.015);
      }
    }
  }

  setPttMuted(muted) {
    const nextMuted = Boolean(muted);
    if (this.pttMuted === nextMuted) return;
    this.pttMuted = nextMuted;
    this._updateMasterGain(true, nextMuted);
  }

  isPttMuted() {
    return this.pttMuted;
  }

  setSoloMuted(muted) {
    const nextMuted = Boolean(muted);
    if (this.soloMuted === nextMuted) return;
    this.soloMuted = nextMuted;
    const fadeSec = this.getMuteFadeSec();
    const nowMs = (typeof performance !== "undefined" ? performance.now() : Date.now());

    if (this._soloPostMuteTimer) {
      clearTimeout(this._soloPostMuteTimer);
      this._soloPostMuteTimer = null;
    }

    if (this.soloMuted) {
      const tailMs = Math.ceil(fadeSec * 1000);
      this._soloFadeOutUntilMs = (fadeSec <= 0.01) ? 0 : (nowMs + tailMs + 80);
      if (this.audioCtx && this.rxInputBus) {
        this._rampGainParam(this.rxInputBus.gain, 0.0, fadeSec, this.audioCtx);
      }

      const finalizeSoloMute = () => {
        this._soloPostMuteTimer = null;
        if (!this.soloMuted) return;
        this._soloFadeOutUntilMs = 0;
        if (this.useWorklet && this.workletNode) {
          try {
            this.workletNode.port.postMessage({
              type: "set_global_mute",
              muted: true,
              immediate: true
            });
            this.workletNode.port.postMessage({ type: "reset" });
          } catch (_) {}
        }
        this.channels.forEach(ch => ch.reset());
      };

      if (fadeSec <= 0.01) {
        finalizeSoloMute();
      } else {
        this._soloPostMuteTimer = setTimeout(finalizeSoloMute, tailMs + 60);
      }
    } else {
      this._soloFadeOutUntilMs = 0;
      if (!(this.globalMuted || this.pttMuted) && this.useWorklet && this.workletNode) {
        try {
          this.workletNode.port.postMessage({
            type: "set_global_mute",
            muted: false,
            immediate: true
          });
        } catch (_) {}
      }
      if (this.audioCtx && this.rxInputBus) {
        this._rampGainParam(this.rxInputBus.gain, 1.0, fadeSec, this.audioCtx);
      }
    }
  }

  isSoloMuted() {
    return this.soloMuted;
  }

  setGlobalMute(muted) {
    const nextMuted = Boolean(muted);
    if (this.globalMuted === nextMuted) return;
    this.globalMuted = nextMuted;
    this._updateMasterGain(true, false);
  }

  isGlobalMuted() {
    return this.globalMuted;
  }

  setRxBoostDb(pctVal) {
    const num = parseInt(pctVal, 10);
    this.rxBoostDb = (!isNaN(num)) ? Math.max(1, Math.min(100, num)) : 50;
    this.channels.forEach((ch, hid) => {
      if (typeof window !== "undefined" && typeof window.isHotspotAudioBoosted === "function" && window.isHotspotAudioBoosted(hid)) {
        const vol = (typeof window.getHotspotVolume === "function") ? window.getHotspotVolume(hid) : 80;
        this.setHotspotVolume(hid, vol / 100.0);
      }
    });
  }

  getRxBoostDb() {
    return this.rxBoostDb || 50;
  }

  setHotspotVolume(hotspotId, volume) {
    const hid = String(hotspotId || "default");
    const parsed = typeof volume === "number" ? volume : parseFloat(volume);
    const raw = isNaN(parsed) ? 1.0 : parsed;
    const norm = raw > 2.5 ? (raw / 100.0) : raw;

    const isBoosted = (typeof window !== "undefined" && typeof window.isHotspotAudioBoosted === "function")
      ? window.isHotspotAudioBoosted(hid)
      : (typeof localStorage !== "undefined" && localStorage.getItem(`proxdmr_boost_${hid}`) === "true");

    const pct = Math.max(1, Math.min(100, Number(this.rxBoostDb) || 50));
    const boostMult = isBoosted ? (1.0 + 9.0 * (pct / 100.0)) : 1.0;
    const effectiveVol = norm * boostMult;

    const ch = this.getOrCreateChannel(hotspotId);
    ch.setVolume(effectiveVol);

    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_channel_volume",
          hotspotId: hid,
          volume: effectiveVol
        });
      } catch (_) {}
    }
  }

  setVolume(volume) {
    // Master volume setter (unity 0 dB reference; no artificial -9 dB pad)
    const parsed = typeof volume === "number" ? volume : parseFloat(volume);
    const raw = isNaN(parsed) ? 1.0 : parsed;
    const normalized = raw > 2.5 ? (raw / 100.0) : raw;
    this.masterVolume = Math.max(0.0, Math.min(2.5, normalized));
    this._updateMasterGain(false, false);
  }

  attachRecordingsAudio(audioElement) {
    if (!audioElement) return null;
    this.ensureInitialized();
    if (!this.audioCtx || !this.recordingsInputBus) return null;
    if (audioElement._webaudioAttachedNode) {
      return audioElement._webaudioAttachedNode;
    }
    try {
      const sourceNode = this.audioCtx.createMediaElementSource(audioElement);
      const gainNode = this.audioCtx.createGain();
      gainNode.gain.value = 1.0;
      sourceNode.connect(gainNode);
      gainNode.connect(this.recordingsInputBus);
      audioElement._webaudioAttachedNode = { sourceNode, gainNode };
      return audioElement._webaudioAttachedNode;
    } catch (err) {
      console.warn("[AUDIO] attachRecordingsAudio error:", err);
      return null;
    }
  }

  onTransmissionEnd(hotspotId, slot = null) {
    const cid = hotspotId || "default";
    if (this.useWorklet && this.workletNode) {
      try {
        if (slot !== null && slot !== undefined) {
          this.workletNode.port.postMessage({
            type: "tx_ended",
            hotspotId: cid,
            slot: parseInt(slot, 10) || 1
          });
        } else {
          this.workletNode.port.postMessage({ type: "tx_ended", hotspotId: cid, slot: 1 });
          this.workletNode.port.postMessage({ type: "tx_ended", hotspotId: cid, slot: 2 });
        }
      } catch (_) {}
    }
    const ch = this.channels.get(cid);
    if (ch) {
      ch.onTransmissionEnd(slot);
    }
  }

  _computeEq10AutoPadLinear() {
    if (!this.eq10Enabled || !Array.isArray(this.eq10Gains)) return 1.0;
    const fs = (this.audioCtx && this.audioCtx.sampleRate) ? this.audioCtx.sampleRate : 48000.0;
    const specs = [
      { freq: 110,  type: "peaking",   q: 1.2 },
      { freq: 200,  type: "peaking",   q: 1.4 },
      { freq: 330,  type: "peaking",   q: 2.2 },
      { freq: 460,  type: "peaking",   q: 2.2 },
      { freq: 750,  type: "peaking",   q: 1.4 },
      { freq: 1350, type: "peaking",   q: 2.2 },
      { freq: 2150, type: "peaking",   q: 2.5 },
      { freq: 2750, type: "peaking",   q: 2.5 },
      { freq: 3400, type: "peaking",   q: 1.8 },
      { freq: 5000, type: "highshelf", q: 1.0 }
    ];
    const coeffs = [];
    for (let i = 0; i < specs.length; i++) {
      const g = Number(this.eq10Gains[i]) || 0.0;
      if (Math.abs(g) < 0.05) continue;
      const sp = specs[i];
      const A = Math.pow(10.0, g / 40.0);
      const w0 = (2.0 * Math.PI * sp.freq) / fs;
      const cosw0 = Math.cos(w0);
      const sinw0 = Math.sin(w0);
      let b0, b1, b2, a0, a1, a2;
      if (sp.type === "peaking") {
        const alpha = sinw0 / (2.0 * sp.q);
        b0 = 1.0 + alpha * A;
        b1 = -2.0 * cosw0;
        b2 = 1.0 - alpha * A;
        a0 = 1.0 + alpha / A;
        a1 = -2.0 * cosw0;
        a2 = 1.0 - alpha / A;
      } else {
        const alpha = (sinw0 / 2.0) * Math.SQRT2;
        const beta = 2.0 * Math.sqrt(A) * alpha;
        b0 = A * ((A + 1.0) + (A - 1.0) * cosw0 + beta);
        b1 = -2.0 * A * ((A - 1.0) + (A + 1.0) * cosw0);
        b2 = A * ((A + 1.0) + (A - 1.0) * cosw0 - beta);
        a0 = (A + 1.0) - (A - 1.0) * cosw0 + beta;
        a1 = 2.0 * ((A - 1.0) - (A + 1.0) * cosw0);
        a2 = (A + 1.0) - (A - 1.0) * cosw0 - beta;
      }
      const invA0 = 1.0 / a0;
      coeffs.push([b0 * invA0, b1 * invA0, b2 * invA0, a1 * invA0, a2 * invA0]);
    }
    if (coeffs.length === 0) return 1.0;

    const testFreqs = [
      80, 110, 150, 200, 260, 330, 390, 460, 580, 750,
      950, 1150, 1350, 1600, 1850, 2150, 2450, 2750, 3050, 3400, 3800
    ];
    let maxDb = 0.0;
    for (let fIdx = 0; fIdx < testFreqs.length; fIdx++) {
      const w = (2.0 * Math.PI * testFreqs[fIdx]) / fs;
      const cw1 = Math.cos(w);
      const sw1 = Math.sin(w);
      const cw2 = Math.cos(2.0 * w);
      const sw2 = Math.sin(2.0 * w);
      let magSqProd = 1.0;
      for (let cIdx = 0; cIdx < coeffs.length; cIdx++) {
        const c = coeffs[cIdx];
        const nr = c[0] + c[1] * cw1 + c[2] * cw2;
        const ni = -(c[1] * sw1 + c[2] * sw2);
        const dr = 1.0 + c[3] * cw1 + c[4] * cw2;
        const di = -(c[3] * sw1 + c[4] * sw2);
        magSqProd *= (nr * nr + ni * ni) / Math.max(1e-12, dr * dr + di * di);
      }
      const db = 10.0 * Math.log10(Math.max(1e-12, magSqProd));
      if (db > maxDb) maxDb = db;
    }

    // Headroom pad starting above +3.0 dB at 0.65x slope, capped at -11.0 dB
    // (or -13.0 dB when limiter is off) so extreme all-band EQ boosts shape tone without +15 dB volume jumps.
    const rawExcessDb = Math.max(0.0, maxDb - 3.0) * 0.65;
    const maxPadDb = this.limiterEnabled ? 11.0 : 13.0;
    const padDb = Math.min(maxPadDb, rawExcessDb);
    return Math.pow(10.0, -padDb / 20.0);
  }

  _applyEq10AutoGainPad() {
    if (!this.preGainNode || !this.audioCtx) return;
    const padLinear = this._computeEq10AutoPadLinear();
    const now = this.audioCtx.currentTime;
    try {
      this.preGainNode.gain.cancelScheduledValues(now);
      this.preGainNode.gain.setTargetAtTime(padLinear, now, 0.015);
    } catch (_) {
      try { this.preGainNode.gain.value = padLinear; } catch (__) {}
    }
  }

  setPreGainDb(db) {
    this.preGainDb = 0;
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: "set_pre_gain", db: 0 });
      } catch (_) {}
    }
    this._applyEq10AutoGainPad();
    try {
      localStorage.removeItem("proxdmr_pre_gain_db");
    } catch (_) {}
  }

  getPreGainDb() {
    return 0;
  }

  setEqualizer(low, mid, high) {
    this.eqLow = Math.max(-12, Math.min(12, Math.round(parseFloat(low) || 0)));
    this.eqMid = Math.max(-12, Math.min(12, Math.round(parseFloat(mid) || 0)));
    this.eqHigh = Math.max(-12, Math.min(12, Math.round(parseFloat(high) || 0)));
    try {
      localStorage.setItem("proxdmr_eq_low", this.eqLow);
      localStorage.setItem("proxdmr_eq_mid", this.eqMid);
      localStorage.setItem("proxdmr_eq_high", this.eqHigh);
    } catch (_) {}
  }

  getEqualizer() {
    return {
      low: this.eqLow !== undefined ? this.eqLow : 0,
      mid: this.eqMid !== undefined ? this.eqMid : 0,
      high: this.eqHigh !== undefined ? this.eqHigh : 0,
      deemphasis: Boolean(this.deemphasis)
    };
  }

  setEq10Gains(gainsArray) {
    if (Array.isArray(gainsArray)) {
      this.eq10Gains = gainsArray.slice();
      for (let i = 0; i < this.eq10Filters.length; i++) {
        if (this.eq10Filters[i]) {
          const g = (this.eq10Gains[i] !== undefined) ? this.eq10Gains[i] : 0.0;
          this.eq10Filters[i].gain.value = this.eq10Enabled ? g : 0.0;
        }
      }
      this._applyEq10AutoGainPad();
    }
  }

  getEq10Gains() {
    return this.eq10Gains ? this.eq10Gains.slice() : [-1.0, -1.5, -0.5, 0.0, 1.0, 2.0, 2.5, 2.0, 1.0, -1.5];
  }

  setEq10Enabled(enabled) {
    this.eq10Enabled = Boolean(enabled);
    this.setEq10Gains(this.eq10Gains);
  }

  getEq10Enabled() {
    return Boolean(this.eq10Enabled);
  }

  setLimiterEnabled(enabled) {
    this.limiterEnabled = Boolean(enabled);
    if (this.masterLimiter) {
      if (this.limiterEnabled) {
        this.masterLimiter.threshold.value = -1.0;
        this.masterLimiter.ratio.value = 16.0;
      } else {
        this.masterLimiter.threshold.value = 0.0;
        this.masterLimiter.ratio.value = 1.0;
      }
    }
    this._applyEq10AutoGainPad();
  }

  _syncAgcToEngine() {
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({
          type: "set_agc_config",
          enabled: this.agcEnabled,
          depthDb: this.agcDepthDb,
          gainRaw: this.agcGainRaw
        });
      } catch (_) {}
    }
    if (this.channels) {
      const cfg = this.getRxAgcConfig();
      this.channels.forEach(ch => {
        if (ch && ch.slots) {
          for (const s of [1, 2]) {
            if (ch.slots[s] && ch.slots[s].agc) {
              ch.slots[s].agc.configure(cfg);
            }
          }
        }
      });
    }
  }

  setRxAgcConfig({ enabled, depthDb, gainRaw } = {}, targetNet = null) {
    const net = targetNet ? (targetNet === "allstar" ? "allstar" : "dmr") : (this.activeProfileNet || "dmr");
    const prof = this.dspProfiles && this.dspProfiles[net];
    if (prof) {
      if (enabled !== undefined) prof.agcEnabled = Boolean(enabled);
      if (depthDb !== undefined) {
        const d = parseFloat(depthDb);
        if (!isNaN(d)) prof.agcDepthDb = Math.max(6, Math.min(30, d));
      }
      if (gainRaw !== undefined) {
        const g = parseFloat(gainRaw);
        if (!isNaN(g)) prof.agcGainRaw = Math.max(10, Math.min(120, g));
      }
    }
    if (!this.activeProfileNet || this.activeProfileNet === net) {
      if (enabled !== undefined) this.agcEnabled = Boolean(enabled);
      if (depthDb !== undefined) {
        const d = parseFloat(depthDb);
        if (!isNaN(d)) this.agcDepthDb = Math.max(6, Math.min(30, d));
      }
      if (gainRaw !== undefined) {
        const g = parseFloat(gainRaw);
        if (!isNaN(g)) this.agcGainRaw = Math.max(10, Math.min(120, g));
      }
      this._syncAgcToEngine();
    }
  }

  getRxAgcConfig() {
    return {
      enabled: this.agcEnabled !== false,
      depthDb: this.agcDepthDb || 18,
      gainRaw: this.agcGainRaw || 35
    };
  }

  getLimiterEnabled() {
    return Boolean(this.limiterEnabled);
  }

  setDeemphasis(enabled) {
    this.deemphasis = Boolean(enabled);
    try {
      localStorage.setItem("proxdmr_deemphasis", this.deemphasis ? "true" : "false");
    } catch (_) {}
  }

  getDeemphasis() {
    return Boolean(this.deemphasis);
  }

  setJitterBufferMs(ms) {
    const val = Math.max(40, Math.min(2000, parseInt(ms, 10) || 120));
    this.jitterBufferMs = val;
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: "set_jitter_buffer", ms: val });
      } catch (_) {}
    }
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("proxdmr_jitter_buffer_ms", String(val));
      }
    } catch (_) {}
  }

  getJitterBufferMs() {
    return this.jitterBufferMs || 180;
  }

  getJitterBufferSec() {
    return (this.jitterBufferMs || 180) / 1000.0;
  }



  resetHotspot(hotspotId) {
    const cid = String(hotspotId || "default");
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: "reset", hotspotId: cid, slot: 1 });
        this.workletNode.port.postMessage({ type: "reset", hotspotId: cid, slot: 2 });
      } catch (_) {}
    }
    const ch = this.channels.get(cid);
    if (ch) ch.reset();
  }

  reset() {
    if (this.useWorklet && this.workletNode) {
      try {
        this.workletNode.port.postMessage({ type: "reset" });
      } catch (_) {}
    }
    this.channels.forEach(ch => ch.reset());
  }

  playTestTone() {
    this.ensureInitialized();
    if (!this.audioCtx) return;

    try {
      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.type = "sine";
      osc.frequency.setValueAtTime(880, now);
      osc.frequency.setValueAtTime(1175, now + 0.08);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

      osc.connect(gain);
      gain.connect(this.masterLimiter || this.audioCtx.destination);

      osc.start(now);
      osc.stop(now + 0.2);
      osc.onended = () => { try { osc.disconnect(); gain.disconnect(); } catch(_) {} };
    } catch (e) {
      console.warn("[AUDIO] Failed to play test tone:", e);
    }
  }
}

window.DMRAudioPlayer = DMRAudioPlayer;
window.ClassicalDspAgc = ClassicalDspAgc;
