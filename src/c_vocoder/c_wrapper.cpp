#include "mbe/mbevocoder.h"
#include "mbe/mbelib.h"
#include <cstdint>
#include <cstring>
#include <cmath>

struct DsdfmeDecoderContext {
    mbe_parms cur_mp;
    mbe_parms prev_mp;
    mbe_parms prev_mp_enh;
    int uvquality;
    int spectral_enh;
    int float_mode;
    int max_repeats;
    float repeat_decay;   // Repeat decay factor (0.50 - 1.00, default 0.75)
    int fec_tolerance;    // 0: Strict (Hi-Fi), 1: Balanced (Normal), 2: Aggressive (DX)
    float audio_gain;     // Digital vocoder gain multiplier (1.0 - 15.0, default 7.0)
    int repeat_count;

    DsdfmeDecoderContext()
        : uvquality(3), spectral_enh(1), float_mode(1), max_repeats(3),
          repeat_decay(0.75f), fec_tolerance(1), audio_gain(7.0f), repeat_count(0) {
        reset();
    }

    void reset() {
        mbe_initMbeParms(&cur_mp, &prev_mp, &prev_mp_enh);
        repeat_count = 0;
    }
};

extern "C" {

// --- DSD-FME Vocoder Decoder C API ---

void* dsdfme_decoder_create() {
    try {
        return new DsdfmeDecoderContext();
    } catch (...) {
        return nullptr;
    }
}

void dsdfme_decoder_destroy(void* ctx) {
    if (ctx) {
        delete static_cast<DsdfmeDecoderContext*>(ctx);
    }
}

void dsdfme_decoder_reset(void* ctx) {
    if (ctx) {
        static_cast<DsdfmeDecoderContext*>(ctx)->reset();
    }
}

void dsdfme_decoder_set_params(void* ctx, int uvquality, int spectral_enh, int float_mode, int max_repeats,
                               float repeat_decay, int fec_tolerance, float audio_gain) {
    if (!ctx) return;
    auto* c = static_cast<DsdfmeDecoderContext*>(ctx);
    c->uvquality = (uvquality >= 1 && uvquality <= 8) ? uvquality : 3;
    c->spectral_enh = spectral_enh ? 1 : 0;
    c->float_mode = float_mode ? 1 : 0;
    c->max_repeats = (max_repeats >= 0 && max_repeats <= 10) ? max_repeats : 3;
    c->repeat_decay = (repeat_decay >= 0.50f && repeat_decay <= 1.00f) ? repeat_decay : 0.75f;
    c->fec_tolerance = (fec_tolerance >= 0 && fec_tolerance <= 2) ? fec_tolerance : 1;
    c->audio_gain = (audio_gain >= 1.0f && audio_gain <= 8.0f) ? audio_gain : 7.0f;
}

// Soft limiter float to 16-bit PCM conversion (DSD-FME style)
static inline void float_to_short_softclip(const float* in, int16_t* out, int len, float gain = 7.0f) {
    for (int i = 0; i < len; i++) {
        float sample = in[i] * gain;
        // Soft clipping with smooth tanh knee above 29000 (leaves 3767 headroom to prevent hard flat-tops)
        if (sample > 29000.0f) {
            float over = sample - 29000.0f;
            sample = 29000.0f + 3700.0f * tanhf(over / 2500.0f);
        } else if (sample < -29000.0f) {
            float over = sample + 29000.0f;
            sample = -29000.0f + 3700.0f * tanhf(over / 2500.0f);
        }
        if (sample > 32767.0f) sample = 32767.0f;
        if (sample < -32768.0f) sample = -32768.0f;
        out[i] = static_cast<int16_t>(sample);
    }
}

// Decodes a 49-bit AMBE frame (unpacked as 49 char bytes 0/1) into 160 samples (16-bit PCM @ 8000 Hz)
int dsdfme_decoder_decode_49bit(void* ctx, const char* ambe_49bit, int16_t* pcm_160) {
    if (!ctx || !ambe_49bit || !pcm_160) return -1;
    auto* c = static_cast<DsdfmeDecoderContext*>(ctx);

    int decode_res = mbe_decodeAmbe2450Parms(const_cast<char*>(ambe_49bit), &c->cur_mp, &c->prev_mp);

    // In Strict mode (fec_tolerance == 0), if parameter anomalies detected, declare frame erasure
    if (c->fec_tolerance == 0 && decode_res == 0) {
        if (c->cur_mp.L <= 0 || c->cur_mp.L > 45 || c->cur_mp.w0 <= 0.0f) {
            decode_res = 1;
        }
    }

    if (decode_res != 0) {
        // Bad frame / erasure handling
        if (c->repeat_count < c->max_repeats) {
            mbe_useLastMbeParms(&c->cur_mp, &c->prev_mp);
            c->repeat_count++;

            // Apply smooth repeat decay to harmonic amplitudes (eliminates robotic tone hang)
            float decay = powf(c->repeat_decay, static_cast<float>(c->repeat_count));
            for (int l = 1; l <= c->cur_mp.L && l < 57; l++) {
                c->cur_mp.Ml[l] *= decay;
            }
        } else {
            mbe_synthesizeSilence(pcm_160);
            return decode_res;
        }
    } else {
        c->repeat_count = 0;
    }

    if (c->spectral_enh) {
        mbe_spectralAmpEnhance(&c->cur_mp);
    }

    float eff_gain = (c->audio_gain >= 1.0f && c->audio_gain <= 15.0f) ? c->audio_gain : 7.0f;

    if (c->float_mode) {
        float float_buf[160];
        mbe_synthesizeSpeechf(float_buf, &c->cur_mp, &c->prev_mp, c->uvquality);
        float_to_short_softclip(float_buf, pcm_160, 160, eff_gain);
    } else {
        mbe_synthesizeSpeech(pcm_160, &c->cur_mp, &c->prev_mp, c->uvquality);
        // In integer mode, scale by gain ratio relative to default 7.0
        if (fabsf(eff_gain - 7.0f) > 0.1f) {
            float scale = eff_gain / 7.0f;
            for (int i = 0; i < 160; i++) {
                float s = static_cast<float>(pcm_160[i]) * scale;
                if (s > 32767.0f) s = 32767.0f;
                if (s < -32768.0f) s = -32768.0f;
                pcm_160[i] = static_cast<int16_t>(s);
            }
        }
    }

    mbe_moveMbeParms(&c->cur_mp, &c->prev_mp);
    return 0;
}

// --- AMBE Vocoder Encoder C API (Preserved for TX transmission) ---

void* ambe_encoder_create() {
    try {
        return new MBEVocoder();
    } catch (...) {
        return nullptr;
    }
}

void ambe_encoder_destroy(void* enc) {
    if (enc) {
        delete static_cast<MBEVocoder*>(enc);
    }
}

// Encodes 160 samples (20 ms @ 8000 Hz, 16-bit PCM) into 9 bytes (72 bits) AMBE+2
int ambe_encode_frame(void* enc, const int16_t* pcm_160, uint8_t* ambe_9bytes) {
    if (!enc || !pcm_160 || !ambe_9bytes) return -1;
    try {
        static_cast<MBEVocoder*>(enc)->encode_2450x1150(const_cast<int16_t*>(pcm_160), ambe_9bytes);
        return 0;
    } catch (...) {
        return -2;
    }
}

// Encodes 49 bits unvoiced/voiced without FEC (7 bytes)
int ambe_encode_raw49(void* enc, const int16_t* pcm_160, uint8_t* ambe_7bytes) {
    if (!enc || !pcm_160 || !ambe_7bytes) return -1;
    try {
        static_cast<MBEVocoder*>(enc)->encode_2450(const_cast<int16_t*>(pcm_160), ambe_7bytes);
        return 0;
    } catch (...) {
        return -2;
    }
}

// Decodes 9 bytes (72 bits) AMBE+2 into 160 samples (20 ms @ 8000 Hz, 16-bit PCM)
int ambe_decode_frame(void* enc, const uint8_t* ambe_9bytes, int16_t* pcm_160) {
    if (!enc || !pcm_160 || !ambe_9bytes) return -1;
    try {
        static_cast<MBEVocoder*>(enc)->decode_2450x1150(pcm_160, const_cast<uint8_t*>(ambe_9bytes));
        return 0;
    } catch (...) {
        return -2;
    }
}

}
