/**
 * AudioWorkletProcessor for ProxDMR
 * Downsamples microphone input from browser rate (e.g. 48000/44100 Hz)
 * to 8000 Hz 16-bit PCM mono, emitted in 60 ms chunks (480 samples = 960 bytes).
 * Includes smooth Noise Gate with hold-time (hangover) to prevent speech swallowing.
 */
class DMRMicProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetSampleRate = 8000;
    this.chunkSize = 480; // 480 samples at 8000 Hz = 60 ms (1 DMR Voice Burst)
    this.buffer = new Int16Array(this.chunkSize);
    this.bufferIndex = 0;
    this.phase = 0.0;
    this.lastInputSample = 0.0;
    this.isActive = true;

    // Noise Gate configuration
    this.gateEnabled = true;
    this.gateThresholdDb = -45;
    this.gateHoldBursts = 3;   // 3 bursts * 60 ms = 180 ms hangover time to preserve word endings
    this.gateHoldCounter = 0;
    this.isGateOpen = false;

    this.port.onmessage = (event) => {
      if (!event.data) return;
      if (event.data.command === "set_active") {
        this.isActive = Boolean(event.data.active);
        if (!this.isActive) {
          this.bufferIndex = 0;
          this.phase = 0.0;
          this.lastInputSample = 0.0;
          this.gateHoldCounter = 0;
          this.isGateOpen = false;
        }
      } else if (event.data.command === "set_tx_params") {
        if (event.data.gateEnabled !== undefined) {
          this.gateEnabled = Boolean(event.data.gateEnabled);
        }
        if (event.data.gateThresholdDb !== undefined) {
          this.gateThresholdDb = Number(event.data.gateThresholdDb);
        }
      }
    };
  }

  process(inputs, outputs, parameters) {
    if (outputs && outputs[0] && outputs[0][0]) {
      outputs[0][0].fill(0);
    }
    const input = inputs[0];
    if (!input || !input[0] || !this.isActive) {
      return true;
    }

    const channelData = input[0];
    const inputLen = channelData.length;
    const inputSampleRate = sampleRate; // Global in AudioWorkletGlobalScope
    const ratio = inputSampleRate / this.targetSampleRate;

    while (this.phase < inputLen) {
      const idx = Math.floor(this.phase);
      const frac = this.phase - idx;
      
      const s0 = idx >= 0 ? channelData[idx] : this.lastInputSample;
      const s1 = (idx + 1 < inputLen) ? channelData[idx + 1] : channelData[inputLen - 1];
      
      // Linear interpolation across quantum boundaries
      const sample = s0 + frac * (s1 - s0);

      // Float32 [-1.0, 1.0] -> Int16 [-32768, 32767] with soft clipping
      const clamped = Math.max(-1.0, Math.min(1.0, sample));
      const int16 = clamped < 0 ? clamped * 32768 : clamped * 32767;

      this.buffer[this.bufferIndex++] = Math.round(int16);

      if (this.bufferIndex >= this.chunkSize) {
        // Noise Gate processing with hold-time (hangover) & smooth closing ramp
        if (this.gateEnabled) {
          let sumSq = 0.0;
          for (let i = 0; i < this.chunkSize; i++) {
            const norm = this.buffer[i] / 32768.0;
            sumSq += norm * norm;
          }
          const rms = Math.sqrt(sumSq / this.chunkSize);
          const rmsDb = rms > 0.00001 ? 20.0 * Math.log10(rms) : -100.0;

          if (rmsDb >= this.gateThresholdDb) {
            this.gateHoldCounter = this.gateHoldBursts;
            this.isGateOpen = true;
          } else if (this.gateHoldCounter > 0) {
            this.gateHoldCounter--;
            this.isGateOpen = true; // Hangover: keep speech tail intact
          } else {
            if (this.isGateOpen) {
              // Smooth 5ms fade-out ramp (40 samples @ 8kHz) to eliminate closing click
              const rampLen = 40;
              for (let i = 0; i < rampLen; i++) {
                const w = 0.5 * (1.0 + Math.cos((Math.PI * i) / rampLen));
                this.buffer[i] = Math.round(this.buffer[i] * w);
              }
              for (let i = rampLen; i < this.chunkSize; i++) {
                this.buffer[i] = 0;
              }
              this.isGateOpen = false;
            } else {
              // Gate completely closed: digital silence
              this.buffer.fill(0);
            }
          }
        }

        // Transfer buffer copy to main thread
        const chunkToSend = new Int16Array(this.buffer);
        this.port.postMessage(chunkToSend.buffer, [chunkToSend.buffer]);
        this.bufferIndex = 0;
      }

      this.phase += ratio;
    }

    this.lastInputSample = channelData[inputLen - 1];
    this.phase -= inputLen;
    return true;
  }
}

registerProcessor("dmr-mic-processor", DMRMicProcessor);
