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
    this.targetRms = 0.16;          // Nominal comfortable speech level (~ -16 dBFS)
    this.speechThreshold = 0.016;   // Active speech threshold (~ -36 dBFS)
    this.noiseGate = 0.012;         // Hysteresis release gate (~ -38 dBFS)
    this.minGainDb = -12;           // Max attenuation for loud stations (-12 dB)
    this.maxGainDb = 12;            // Max boost for quiet stations (+12 dB)
    this.boostRatio = 0.85;         // Compression pull-up curve factor (0.0 - 1.0)
    this.attenRatio = 0.85;         // Compression push-down curve factor (0.0 - 1.0)
    this.hangTime = 0.35;           // 350ms hang time (freezes gain during natural pauses)
    this.decayTime = 0.60;          // 600ms smooth return to 0 dB after hang
    this.envelope = 0.16;           // Running speech envelope
    this.lastSpeechTime = 0;        // Timestamp of last active speech
    this.isSpeechActive = false;    // Hysteresis speech activity state
    this.currentGain = 1.0;         // Current linear multiplier
  }

  setAgcParams({ minGainDb, maxGainDb, hangTime }) {
    if (typeof minGainDb === "number") {
      this.minGainDb = -Math.abs(Math.min(30, Math.max(0, minGainDb)));
      this.attenRatio = Math.min(1.0, 0.50 + (Math.abs(this.minGainDb) / 48.0));
    }
    if (typeof maxGainDb === "number") {
      this.maxGainDb = Math.abs(Math.min(30, Math.max(0, maxGainDb)));
      this.boostRatio = Math.min(1.0, 0.50 + (this.maxGainDb / 48.0));
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

  processChunk(chunkRms, now) {
    if (!this.enabled) {
      this.currentGain = 1.0;
      return 1.0;
    }

    // Speech detection with Schmitt trigger hysteresis
    if (!this.isSpeechActive) {
      if (chunkRms >= this.speechThreshold) {
        this.isSpeechActive = true;
      }
    } else {
      if (chunkRms < this.noiseGate) {
        this.isSpeechActive = false;
      }
    }

    if (this.isSpeechActive) {
      this.lastSpeechTime = now;

      // Fast attack (15ms) to catch transients without overshoot, smooth decay (600ms) for syllabic tracking
      if (chunkRms > this.envelope) {
        const alphaAtt = Math.exp(-0.06 / 0.015);
        this.envelope = alphaAtt * this.envelope + (1.0 - alphaAtt) * chunkRms;
      } else {
        const alphaDec = Math.exp(-0.06 / 0.600);
        this.envelope = alphaDec * this.envelope + (1.0 - alphaDec) * chunkRms;
      }

      // Compute logarithmic dynamic range compression
      const safeEnv = Math.max(0.005, this.envelope);
      const inDb = 20.0 * Math.log10(safeEnv);
      const targetDb = -16.0; // ~0.1585 RMS
      const diffDb = targetDb - inDb;

      let gainDb = 0.0;
      if (diffDb > 0) {
        // Boost quiet speech
        gainDb = Math.min(this.maxGainDb, diffDb * this.boostRatio);
      } else {
        // Attenuate loud speech
        gainDb = Math.max(this.minGainDb, diffDb * this.attenRatio);
      }

      this.currentGain = Math.pow(10.0, gainDb / 20.0);
      return this.currentGain;
    } else {
      // Pause or background noise
      const elapsedSinceSpeech = (this.lastSpeechTime > 0) ? (now - this.lastSpeechTime) : 999.0;

      if (elapsedSinceSpeech < this.hangTime) {
        // Hang time: freeze current gain during natural pauses between words
        return this.currentGain;
      } else {
        // Speech paused or ended: smoothly decay gain back towards neutral 1.0 (0 dB)
        // NEVER boost background noise!
        const decayElapsed = elapsedSinceSpeech - this.hangTime;
        const alphaRelease = Math.exp(-decayElapsed / this.decayTime);
        this.currentGain = alphaRelease * this.currentGain + (1.0 - alphaRelease) * 1.0;
        this.envelope = alphaRelease * this.envelope + (1.0 - alphaRelease) * this.targetRms;
        return this.currentGain;
      }
    }
  }

  reset() {
    this.envelope = this.targetRms;
    this.currentGain = 1.0;
    this.lastSpeechTime = 0;
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

    // Resampler stream continuity state (preserves sample history across 60ms chunks)
    this.resampleBuf = null;
    this.resamplePos = 0.0;
    
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

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    if (this.slotMuteGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      const target = this.isMuted ? 0.0 : 1.0;
      this.slotMuteGainNode.gain.cancelScheduledValues(now);
      this.slotMuteGainNode.gain.setValueAtTime(target, now);
    }
    if (this.activeTtsHandles && this.activeTtsHandles.size > 0 && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      const ttsTarget = this.isMuted ? 0.0 : 0.70;
      this.activeTtsHandles.forEach(h => {
        if (h && h.gainNode && !h.bypassSlotMute) {
          try {
            h.gainNode.gain.cancelScheduledValues(now);
            h.gainNode.gain.setValueAtTime(ttsTarget, now);
          } catch (_) {}
        }
      });
    }
    if (this.isMuted) {
      this.reset();
    }
  }

  feed(arrayBuffer) {
    if (this.isMuted) return;
    const now = this.audioCtx.currentTime;
    const int16Array = new Int16Array(arrayBuffer);
    const numSamples = int16Array.length;
    if (numSamples === 0) return;

    // Discard identical consecutive chunks arriving within < 35ms on this slot (duplicate feed shield)
    const nowMs = Date.now();
    if (this._lastFeedTime && (nowMs - this._lastFeedTime) < 35 && this._lastFeedLen === numSamples) {
      if (this._lastFirstSample === int16Array[0] && this._lastMidSample === int16Array[Math.floor(numSamples / 2)]) {
        return;
      }
    }
    this._lastFeedTime = nowMs;
    this._lastFeedLen = numSamples;
    this._lastFirstSample = int16Array[0];
    this._lastMidSample = int16Array[Math.floor(numSamples / 2)];

    // 1. Digital input Pre-Gain (-20 dB to +12 dB) & soft limiter
    const preGainDb = (this.player && typeof this.player.getPreGainDb === "function") ? this.player.getPreGainDb() : 0;
    const preGainLinear = Math.pow(10.0, preGainDb / 20.0);

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

    // 2. Jitter Buffer cushion & transmission state tracking
    const jitterSec = (this.player && typeof this.player.getJitterBufferSec === "function")
      ? this.player.getJitterBufferSec()
      : 0.120; // Default 120 ms buffer cushion

    // Check if starting from silence or resuming after an idle gap (> 150ms)
    const isNewTransmission = (this.nextStartTime <= 0) || ((now - this.nextStartTime) > 0.150);

    if (isNewTransmission) {
      // Clear resampler state to prevent stale audio history leaking from previous transmission
      this.resampleBuf = null;
      this.resamplePos = 0.0;
      this.nextStartTime = now + jitterSec;
    } else if (this.nextStartTime < now) {
      // Ongoing transmission with a network stall (audio queue ran dry):
      // Restore a small 40ms safety cushion so subsequent packets don't continuously underrun!
      this.nextStartTime = now + Math.min(jitterSec, 0.040);
    } else if ((this.nextStartTime - now) > 0.300) {
      // Buffer drift / runaway protection: audio queue accumulated > 300ms of future audio
      // (caused by duplicate chunks or burst delivery). Resync to avoid slow-motion / delayed playback!
      this.nextStartTime = now + jitterSec;
    }

    // 3. Resample 8000 Hz stream to native audioCtx.sampleRate with 4-point Hermite continuity
    const targetRate = (this.audioCtx && this.audioCtx.sampleRate) ? this.audioCtx.sampleRate : 48000;
    let outSamples;
    let numOut;

    if (targetRate === 8000) {
      outSamples = inSamples;
      numOut = numSamples;
    } else {
      const ratio = 8000.0 / targetRate;
      numOut = Math.round(numSamples * (targetRate / 8000.0));
      outSamples = new Float32Array(numOut);

      // Initialize resample history on start of transmission with initial sample (prevents 2-sample delay transient)
      if (!this.resampleBuf || this.resampleBuf.length < 4) {
        const s0 = inSamples[0];
        this.resampleBuf = new Float32Array([s0, s0, s0, s0]);
        this.resamplePos = 2.0;
      }

      // Concatenate leftover history with new chunk
      const oldLen = this.resampleBuf.length;
      const combined = new Float32Array(oldLen + numSamples);
      combined.set(this.resampleBuf, 0);
      combined.set(inSamples, oldLen);

      const bufLen = combined.length;
      let pos = this.resamplePos;

      for (let j = 0; j < numOut; j++) {
        const k = Math.floor(pos);
        const t = pos - k;
        const p0 = k >= 1 ? combined[k - 1] : combined[0];
        const p1 = k < bufLen ? combined[k] : combined[bufLen - 1];
        const p2 = (k + 1) < bufLen ? combined[k + 1] : combined[bufLen - 1];
        const p3 = (k + 2) < bufLen ? combined[k + 2] : combined[bufLen - 1];

        const c0 = p1;
        const c1 = 0.5 * (p2 - p0);
        const c2 = p0 - 2.5 * p1 + 2.0 * p2 - 0.5 * p3;
        const c3 = 0.5 * (p3 - p0) + 1.5 * (p1 - p2);

        outSamples[j] = ((c3 * t + c2) * t + c1) * t + c0;
        pos += ratio;
      }

      // Retain leftover samples (at least 2 lookahead points) for next chunk continuity
      const drop = Math.floor(pos) - 2;
      if (drop > 0 && drop < combined.length) {
        this.resampleBuf = combined.slice(drop);
        this.resamplePos = pos - drop;
      } else {
        this.resampleBuf = combined;
        this.resamplePos = pos;
      }
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
    // Note: Do not hard-reset this.nextStartTime = 0 immediately!
    // Hardware audio buffer is still playing out the last 120-180ms of audio.
    // Leaving this.nextStartTime allows it to expire naturally without collision.
  }

  reset() {
    this.nextStartTime = 0;
    this.resampleBuf = null;
    this.resamplePos = 0.0;
    this._lastFeedTime = 0;
  }
}

class HotspotAudioChannel {
  constructor(hotspotId, audioCtx, destinationNode, player = null) {
    this.hotspotId = hotspotId;
    this.audioCtx = audioCtx;
    this.player = player;
    this.volume = 1.0;
    this.isMuted = false;

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

  setSlotMute(slot, muted) {
    const s = parseInt(slot, 10);
    const slotObj = this.slots[s];
    if (slotObj) {
      slotObj.setMuted(muted);
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
    const s = parseInt(slot, 10);
    const slotObj = this.slots[s];
    if (slotObj) {
      slotObj.setDucking(ducked, duckLevel, fadeTimeSec);
    }
  }

  setAllDucking(ducked, duckLevel = 1.0, fadeTimeSec = 0.25) {
    if (this.slots[1]) this.slots[1].setDucking(ducked, duckLevel, fadeTimeSec);
    if (this.slots[2]) this.slots[2].setDucking(ducked, duckLevel, fadeTimeSec);
  }

  feed(arrayBuffer, slot = 1) {
    if (this.isMuted) return;
    const s = parseInt(slot, 10) || 1;
    const slotObj = this.slots[s];
    if (slotObj && !slotObj.isMuted) {
      slotObj.feed(arrayBuffer);
    }
  }

  reset() {
    this.slots[1].reset();
    this.slots[2].reset();
  }

  setMuted(muted) {
    this.isMuted = Boolean(muted);
    const now = this.audioCtx ? this.audioCtx.currentTime : 0;
    if (this.channelGainNode) {
      const target = this.isMuted ? 0.0 : this.volume;
      this.channelGainNode.gain.setTargetAtTime(target, now, 0.015);
    }
  }

  setVolume(vol) {
    const parsed = typeof vol === "number" ? vol : parseFloat(vol);
    const raw = isNaN(parsed) ? 1.2 : parsed;
    // If raw is given as percentage (> 2.5, e.g. 100 or 120), normalize to 0.0 - 2.5 factor.
    // If already normalized (e.g. 1.0 or 1.2 or 0.0), use directly.
    const normalized = raw > 2.5 ? (raw / 100.0) : raw;
    this.volume = Math.max(0.0, Math.min(2.5, normalized));
    if (!this.isMuted && this.audioCtx && this.channelGainNode) {
      const now = this.audioCtx.currentTime;
      this.channelGainNode.gain.cancelScheduledValues(now);
      this.channelGainNode.gain.setValueAtTime(this.volume, now);
    }
  }


}

const MASTER_GAIN_9DB_ATTENUATION = Math.pow(10, -9.0 / 20.0); // 0.354813 (-9 dB)
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
    this.preGainNode = null;
    this.masterLimiter = null;
    this.masterGainNode = null;
    this.channels = new Map(); // hotspotId -> HotspotAudioChannel
    this.sampleRate = 8000;
    this.globalMuted = false;
    this.pttMuted = false;
    this.soloMuted = false;
    // Overall coefficient attenuated by -9 dB relative to baseline of 1.20
    this.masterVolume = 1.2 * MASTER_GAIN_9DB_ATTENUATION; // ~0.42578 (-9 dB)
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
    this.jitterBufferMs = 120;

    try {
      if (typeof localStorage !== "undefined") {
        const savedPre = localStorage.getItem("proxdmr_pre_gain_db");
        if (savedPre !== null) this.preGainDb = Math.max(-20, Math.min(12, Math.round(parseFloat(savedPre) || 0)));
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
          if (!isNaN(parsed) && parsed >= 40 && parsed <= 500) {
            this.jitterBufferMs = parsed;
          }
        }
      }
    } catch (_) {}
  }

  initSync(existingAudioContext = null) {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtxClass) return;
      this.audioCtx = existingAudioContext || new AudioCtxClass();
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

        // 1. Equalizer & De-emphasis: Handled server-side in Python (ServerAudioEqualizer)
        // Eliminates mobile Web Audio biquad filter crackling and buffer underruns.
        this.eqLowNode = null;
        this.eqMidNode = null;
        this.eqHighNode = null;
        this.deemphasisNode = null;

        // 2. Pre-Gain Node (unity gain in WebAudio graph; digital Pre-Gain is applied to incoming samples in HotspotAudioSlot)
        this.preGainNode = this.audioCtx.createGain();
        this.preGainNode.gain.value = 1.0;
        try {
          this.preGainNode.channelCount = 2;
          this.preGainNode.channelCountMode = "explicit";
          this.preGainNode.channelInterpretation = "speakers";
        } catch (_) {}

        this.masterLimiter = this.audioCtx.createDynamicsCompressor();
        this.masterLimiter.threshold.value = -1.0; // dBFS (true peak ceiling)
        this.masterLimiter.knee.value = 1.0;       // dB (tight knee: 100% linear pass-through below -1.5 dBFS)
        this.masterLimiter.ratio.value = 20.0;     // Fast peak limiting ceiling
        this.masterLimiter.attack.value = 0.002;   // 2ms fast attack
        this.masterLimiter.release.value = 0.080;  // 80ms fast recovery
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
        // Live RX: rxInputBus -> preGainNode -> masterLimiter -> masterGainNode -> destination
        // Log Player: recordingsInputBus -> masterLimiter -> masterGainNode -> destination
        this.rxInputBus.connect(this.preGainNode);
        this.preGainNode.connect(this.masterLimiter);
        this.recordingsInputBus.connect(this.masterLimiter);
        this.masterLimiter.connect(this.masterGainNode);
        this.masterGainNode.connect(this.audioCtx.destination);
      } catch (e) {
        console.warn("[AUDIO] Master graph init error:", e);
      }
    }
  }

  async init(existingAudioContext = null) {
    this.initSync(existingAudioContext);
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
      // Synchronize initial mute state for both slots from getHotspotMute / localStorage
      if (typeof window !== "undefined" && typeof window.getHotspotMute === "function") {
        ch.setSlotMute(1, window.getHotspotMute(hid, 1));
        ch.setSlotMute(2, window.getHotspotMute(hid, 2));
      } else if (typeof localStorage !== "undefined") {
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = (hid === "default" || hid === primaryId);
        const m1 = localStorage.getItem(`proxdmr_mute_${hid}_ts1`) === "true" || (isPrimary && localStorage.getItem("proxdmr_mute_default_ts1") === "true");
        const m2 = localStorage.getItem(`proxdmr_mute_${hid}_ts2`) === "true" || (isPrimary && localStorage.getItem("proxdmr_mute_default_ts2") === "true");
        ch.setSlotMute(1, m1);
        ch.setSlotMute(2, m2);
      }
      // Synchronize initial volume from getHotspotVolume / localStorage
      if (typeof window !== "undefined" && typeof window.getHotspotVolume === "function") {
        ch.setVolume(window.getHotspotVolume(hid) / 100.0);
      } else if (typeof localStorage !== "undefined") {
        const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = (hid === "default" || hid === primaryId);
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
        const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
        const isPrimary = (hid === "default" || hid === primaryId);
        p1 = localStorage.getItem(`proxdmr_pan_${hid}_ts1`) || (isPrimary ? localStorage.getItem("proxdmr_pan_default_ts1") : null) || "LR";
        p2 = localStorage.getItem(`proxdmr_pan_${hid}_ts2`) || (isPrimary ? localStorage.getItem("proxdmr_pan_default_ts2") : null) || "LR";
      }
      ch.setSlotPan(1, p1);
      ch.setSlotPan(2, p2);
      this.channels.set(hid, ch);
      if (typeof window !== "undefined" && window.ttsAudioQueueManager && typeof window.ttsAudioQueueManager.syncIdleDucking === "function") {
        try { window.ttsAudioQueueManager.syncIdleDucking(0.05); } catch (_) {}
      }
    }
    return ch;
  }

  feed(arrayBuffer, hotspotId = "default", slot = 1) {
    this.ensureInitialized();
    if (!this.audioCtx) return;
    if (this.audioCtx.state === "suspended") {
      this.audioCtx.resume().catch(() => {});
    }
    if (this.globalMuted || this.pttMuted || this.soloMuted) return;
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const ch = this.getOrCreateChannel(hid);
    if (ch.isMuted || ch.isSlotMuted(slot)) return;
    ch.feed(arrayBuffer, slot);
  }

  setSlotMute(hotspotId, slot, muted) {
    const s = parseInt(slot, 10) || 1;
    const isMuted = Boolean(muted);
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const ch = this.getOrCreateChannel(hid);
    if (ch) ch.setSlotMute(s, isMuted);

    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isPrimary = (hid === "default" || hid === primaryId);

    this.channels.forEach((channel, key) => {
      const sKey = String(key);
      if (sKey === hid) {
        channel.setSlotMute(s, isMuted);
      } else if (isPrimary && (sKey === "default" || sKey === primaryId)) {
        channel.setSlotMute(s, isMuted);
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
      const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
      if (hid === "default" && primaryId !== "default") {
        ch = this.channels.get(primaryId);
      } else if (hid === primaryId && primaryId !== "default") {
        ch = this.channels.get("default");
      }
    }
    return ch ? ch.isSlotMuted(slot) : false;
  }

  setSlotPan(hotspotId, slot, mode) {
    const s = parseInt(slot, 10) || 1;
    const safeMode = (mode === "L" || mode === "R") ? mode : "LR";
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const ch = this.getOrCreateChannel(hid);
    if (ch) ch.setSlotPan(s, safeMode);

    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isPrimary = (hid === "default" || hid === primaryId);

    this.channels.forEach((channel, key) => {
      const sKey = String(key);
      if (sKey === hid) {
        channel.setSlotPan(s, safeMode);
      } else if (isPrimary && (sKey === "default" || sKey === primaryId)) {
        channel.setSlotPan(s, safeMode);
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
      const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
      if (hid === "default" && primaryId !== "default") {
        ch = this.channels.get(primaryId);
      } else if (hid === primaryId && primaryId !== "default") {
        ch = this.channels.get("default");
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

    // Dedicated gain node for this TTS playback instance
    const ttsGain = this.audioCtx.createGain();

    // Check mute states
    const isTest = Boolean(options && (options.isTest || options.bypassMute));
    const bypassSlotMute = isTest || Boolean(options && options.bypassSlotMute);
    const isSlotMuted = bypassSlotMute ? false : ((slotObj && slotObj.isMuted) || ch.isSlotMuted(s));
    const isChannelMuted = isTest
      ? false
      : (bypassSlotMute
          ? Boolean(this.globalMuted || this.pttMuted)
          : Boolean(ch.isMuted || this.globalMuted || this.pttMuted || this.soloMuted));
    
    // Balanced gain factor:
    // DMR baseline audio passes through masterLimiter with -14 dB attenuator.
    // TTS WAV is normalized to 0 dBFS. A gain factor of 0.70 gives crisp, clear voice
    // that balances with DMR audio volume without clipping.
    ttsGain.gain.value = (isSlotMuted || isChannelMuted) ? 0.0 : 0.70;

    source.connect(ttsGain);

    // If this is an independent test, bypass slot and hotspot channel nodes completely
    // and route directly to master rxInputBus so HS/slot mute cannot silence it!
    if (isTest) {
      if (this.rxInputBus) {
        ttsGain.connect(this.rxInputBus);
      } else {
        ttsGain.connect(this.audioCtx.destination);
      }
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

  setSlotDucking(hotspotId, slot, ducked, duckLevel = 0.20, fadeTimeSec = 0.12) {
    const s = parseInt(slot, 10) || 1;
    const hid = (hotspotId !== undefined && hotspotId !== null && hotspotId !== "") ? String(hotspotId) : "default";
    const ch = this.getOrCreateChannel(hid);
    if (ch) ch.setSlotDucking(s, ducked, duckLevel, fadeTimeSec);

    const currentHotspots = (typeof window !== "undefined" && window.currentHotspots) || [];
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isPrimary = (hid === "default" || hid === primaryId);

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
    const primaryId = (currentHotspots[0] && String(currentHotspots[0].id)) || "default";
    const isTargetPrimary = (tHid === "default" || tHid === primaryId);

    this.channels.forEach((channel, key) => {
      const sKey = String(key);
      const isChannelPrimary = (sKey === "default" || sKey === primaryId);
      const isSameHotspot = (sKey === tHid) || (isTargetPrimary && isChannelPrimary);

      [1, 2].forEach(slot => {
        if (isSameHotspot && slot === tSlot) {
          return; // Skip target speech slot
        }
        channel.setSlotDucking(slot, ducked, duckLevel, fadeTimeSec);
      });
    });
  }

  restoreAllDucking(fadeTimeSec = 0.25) {
    this.channels.forEach(channel => {
      channel.setAllDucking(false, 1.0, fadeTimeSec);
    });
  }

  setHotspotMute(hotspotId, muted) {
    const ch = this.getOrCreateChannel(hotspotId);
    ch.setMuted(muted);
  }

  isHotspotMuted(hotspotId) {
    const hid = String(hotspotId || "default");
    const ch = this.channels.get(hid);
    return ch ? ch.isMuted : false;
  }

  _updateMasterGain() {
    const isMuted = this.globalMuted || this.pttMuted;
    if (this.audioCtx && this.masterGainNode) {
      const now = this.audioCtx.currentTime;
      const target = isMuted ? 0.0 : this.masterVolume;
      this.masterGainNode.gain.cancelScheduledValues(now);
      this.masterGainNode.gain.setTargetAtTime(target, now, 0.015);
    }
  }

  setPttMuted(muted) {
    this.pttMuted = Boolean(muted);
    this._updateMasterGain();
    if (this.pttMuted) {
      this.channels.forEach(ch => ch.reset());
    }
  }

  isPttMuted() {
    return this.pttMuted;
  }

  setSoloMuted(muted) {
    this.soloMuted = Boolean(muted);
    if (this.audioCtx && this.rxInputBus) {
      const now = this.audioCtx.currentTime;
      const targetRx = this.soloMuted ? 0.0 : 1.0;
      this.rxInputBus.gain.cancelScheduledValues(now);
      this.rxInputBus.gain.setTargetAtTime(targetRx, now, 0.015);
    }
    if (this.soloMuted) {
      this.channels.forEach(ch => ch.reset());
    }
  }

  isSoloMuted() {
    return this.soloMuted;
  }

  setGlobalMute(muted) {
    this.globalMuted = Boolean(muted);
    this._updateMasterGain();
  }

  isGlobalMuted() {
    return this.globalMuted;
  }

  setHotspotVolume(hotspotId, volume) {
    const ch = this.getOrCreateChannel(hotspotId);
    ch.setVolume(volume);
  }

  setVolume(volume) {
    // Master volume setter for compatibility (-9 dB relative to input)
    const parsed = typeof volume === "number" ? volume : parseFloat(volume);
    const raw = isNaN(parsed) ? 1.2 : parsed;
    const normalized = raw > 2.5 ? (raw / 100.0) : raw;
    this.masterVolume = Math.max(0.0, Math.min(2.5, normalized * MASTER_GAIN_9DB_ATTENUATION));
    this._updateMasterGain();
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
    const ch = this.channels.get(cid);
    if (ch) {
      ch.onTransmissionEnd(slot);
    }
  }

  setPreGainDb(db) {
    const val = Math.max(-20, Math.min(12, Math.round(parseFloat(db) || 0)));
    this.preGainDb = val;
    // Input Pre-Gain is applied directly to incoming PCM samples in HotspotAudioSlot before AGC
    if (this.preGainNode && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.preGainNode.gain.cancelScheduledValues(now);
      this.preGainNode.gain.setValueAtTime(1.0, now);
    }
    try {
      localStorage.setItem("proxdmr_pre_gain_db", val);
    } catch (_) {}
  }

  getPreGainDb() {
    return this.preGainDb !== undefined ? this.preGainDb : 0;
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
    const val = Math.max(40, Math.min(500, parseInt(ms, 10) || 120));
    this.jitterBufferMs = val;
    try {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("proxdmr_jitter_buffer_ms", String(val));
      }
    } catch (_) {}
  }

  getJitterBufferMs() {
    return this.jitterBufferMs || 120;
  }

  getJitterBufferSec() {
    return (this.jitterBufferMs || 120) / 1000.0;
  }



  resetHotspot(hotspotId) {
    const ch = this.channels.get(String(hotspotId || "default"));
    if (ch) ch.reset();
  }

  reset() {
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
