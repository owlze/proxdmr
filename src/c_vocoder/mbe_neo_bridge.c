/**
 * mbe_neo_bridge.c - Native C wrapper exporting mbelib-neo AMBE+2 decoding functions
 * for ProxDMR server-side audio RX pipeline.
 */

#include <mbelib-neo/mbelib.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#define EXPORT __declspec(dllexport)
#else
#define EXPORT __attribute__((visibility("default")))
#endif

void mbe_set_tuning(int spectral_enh, float high_band_gain, float unvoiced_gain);

typedef struct {
    mbe_parms cur_mp;
    mbe_parms prev_mp;
    mbe_parms prev_mp_enhanced;
    int spectral_enh;
    float high_band_gain;
    float unvoiced_gain;
    int codec_mode; /* 0=none, 1=ambe, 2=imbe, 3=ambe2400_dstar */
} MbeNeoContext;

typedef struct {
    int c0_errors;
    int protected_errors;
    int total_errors;
    unsigned int flags;
    float w0;
    int L;
    int K;
    int voiced_bands;
    int repeat;
} MbeNeoFrameMeta;

EXPORT void* mbe_neo_create(void) {
    MbeNeoContext* ctx = (MbeNeoContext*)calloc(1, sizeof(MbeNeoContext));
    if (ctx) {
        mbe_initMbeParms(&ctx->cur_mp, &ctx->prev_mp, &ctx->prev_mp_enhanced);
        ctx->spectral_enh = 1;
        ctx->high_band_gain = 1.05925373f; /* +0.5 dB */
        ctx->unvoiced_gain = 0.84139514f;  /* -1.5 dB */
        ctx->codec_mode = 0;
    }
    return ctx;
}

EXPORT void mbe_neo_set_tuning(void* ctx, int spectral_enh, float high_band_gain, float unvoiced_gain) {
    if (!ctx) return;
    MbeNeoContext* c = (MbeNeoContext*)ctx;
    c->spectral_enh = spectral_enh ? 1 : 0;
    c->high_band_gain = (high_band_gain > 0.0f) ? high_band_gain : 1.05925373f;
    c->unvoiced_gain = (unvoiced_gain > 0.0f) ? unvoiced_gain : 0.84139514f;
}

EXPORT void mbe_neo_destroy(void* ctx) {
    if (ctx) {
        free(ctx);
    }
}

EXPORT void mbe_neo_reset(void* ctx) {
    if (ctx) {
        MbeNeoContext* c = (MbeNeoContext*)ctx;
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced);
        c->codec_mode = 0;
    }
}

/* ETSI TS 102 361-1 DMR AMBE+2 interleaving tables */
static const uint8_t rW[36] = {
    0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1,
    0, 1, 0, 1, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2
};
static const uint8_t rX[36] = {
    23, 10, 22, 9, 21, 8, 20, 7, 19, 6, 18, 5, 17, 4, 16, 3, 15, 2,
    14, 1, 13, 0, 12, 10, 11, 9, 10, 8, 9, 7, 8, 6, 7, 5, 6, 4
};
static const uint8_t rY[36] = {
    0, 2, 0, 2, 0, 2, 0, 2, 0, 3, 0, 3, 1, 3, 1, 3, 1, 3,
    1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3, 1, 3
};
static const uint8_t rZ[36] = {
    5, 3, 4, 2, 3, 1, 2, 0, 1, 13, 0, 12, 22, 11, 21, 10, 20, 9,
    19, 8, 18, 7, 17, 6, 16, 5, 15, 4, 14, 3, 13, 2, 12, 1, 11, 0
};

static void deinterleave_72_bytes(const uint8_t bytes9[9], char ambe_fr[4][24]) {
    memset(ambe_fr, 0, 4 * 24);
    char bits72[72];
    for (int byte_i = 0; byte_i < 9; byte_i++) {
        uint8_t b = bytes9[byte_i];
        for (int bit_i = 0; bit_i < 8; bit_i++) {
            bits72[byte_i * 8 + bit_i] = (b >> (7 - bit_i)) & 1;
        }
    }
    for (int i = 0; i < 36; i++) {
        char bit1 = bits72[2 * i] ? 1 : 0;
        char bit0 = bits72[2 * i + 1] ? 1 : 0;
        ambe_fr[rW[i]][rX[i]] = bit1;
        ambe_fr[rY[i]][rZ[i]] = bit0;
    }
}

static void fill_meta(MbeNeoContext* c, const mbe_process_result* res, MbeNeoFrameMeta* meta_out) {
    if (!meta_out || !c || !res) return;
    meta_out->c0_errors = res->c0_errors;
    meta_out->protected_errors = res->protected_errors;
    meta_out->total_errors = res->total_errors;
    meta_out->flags = res->flags;
    meta_out->w0 = c->cur_mp.w0;
    meta_out->L = c->cur_mp.L;
    meta_out->K = c->cur_mp.K;
    int num_voiced = 0;
    for (int l = 1; l <= c->cur_mp.L && l <= 56; l++) {
        if (c->cur_mp.Vl[l] == 0) {
            num_voiced++;
        }
    }
    meta_out->voiced_bands = num_voiced;
    meta_out->repeat = (res->flags & MBE_PROCESS_FLAG_REPEAT) ? 1 : 0;
}

EXPORT int mbe_neo_decode_72(void* ctx, const uint8_t* raw72, int16_t* pcm160, MbeNeoFrameMeta* meta_out) {
    if (!ctx || !raw72 || !pcm160) return -1;
    MbeNeoContext* c = (MbeNeoContext*)ctx;
    if (c->codec_mode == 2) {
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced);
    }
    c->codec_mode = 1;

    mbe_set_tuning(c->spectral_enh, c->high_band_gain, c->unvoiced_gain);

    char ambe_fr[4][24];
    deinterleave_72_bytes(raw72, ambe_fr);

    char ambe_d[49];
    mbe_process_result res;
    mbe_initProcessResult(&res);

    int status = mbe_processAmbe3600x2450Frame(
        pcm160, &res, ambe_fr, ambe_d,
        &c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced
    );

    fill_meta(c, &res, meta_out);
    return status;
}

EXPORT int mbe_neo_decode_49(void* ctx, const char* ambe_d49, int16_t* pcm160, MbeNeoFrameMeta* meta_out) {
    if (!ctx || !ambe_d49 || !pcm160) return -1;
    MbeNeoContext* c = (MbeNeoContext*)ctx;
    if (c->codec_mode == 2) {
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced);
    }
    c->codec_mode = 1;

    mbe_set_tuning(c->spectral_enh, c->high_band_gain, c->unvoiced_gain);

    mbe_process_result res;
    mbe_initProcessResult(&res);

    int status = mbe_processAmbe2450Data(
        pcm160, &res, ambe_d49,
        &c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced
    );

    fill_meta(c, &res, meta_out);
    return status;
}

/* TIA-102.BABA / YSF Full-Rate IMBE (dt=3 VW) 144-bit interleaving table */
static const uint8_t IMBE_INTERLEAVE[144] = {
    0,  7, 12, 19, 24, 31, 36, 43, 48, 55, 60, 67, 72, 79, 84, 91,  96, 103, 108, 115, 120, 127, 132, 139,
    1,  6, 13, 18, 25, 30, 37, 42, 49, 54, 61, 66, 73, 78, 85, 90,  97, 102, 109, 114, 121, 126, 133, 138,
    2,  9, 14, 21, 26, 33, 38, 45, 50, 57, 62, 69, 74, 81, 86, 93,  98, 105, 110, 117, 122, 129, 134, 141,
    3,  8, 15, 20, 27, 32, 39, 44, 51, 56, 63, 68, 75, 80, 87, 92,  99, 104, 111, 116, 123, 128, 135, 140,
    4, 11, 16, 23, 28, 35, 40, 47, 52, 59, 64, 71, 76, 83, 88, 95, 100, 107, 112, 119, 124, 131, 136, 143,
    5, 10, 17, 22, 29, 34, 41, 46, 53, 58, 65, 70, 77, 82, 89, 94, 101, 106, 113, 118, 125, 130, 137, 142
};

static void deinterleave_imbe_144_bytes(const uint8_t bytes18[18], char imbe_fr[8][23]) {
    static const int row_lens[8] = {23, 23, 23, 23, 15, 15, 15, 7};
    char flat[144];
    memset(imbe_fr, 0, 8 * 23);
    for (int i = 0; i < 144; i++) {
        uint8_t n = IMBE_INTERLEAVE[i];
        flat[i] = (char)((bytes18[n >> 3] >> (7 - (n & 7))) & 1u);
    }
    int pos = 0;
    for (int r = 0; r < 8; r++) {
        int len = row_lens[r];
        for (int k = 0; k < len; k++) {
            imbe_fr[r][len - 1 - k] = flat[pos++];
        }
    }
}

EXPORT int mbe_neo_decode_imbe_144(void* ctx, const uint8_t* raw18, int16_t* pcm160, MbeNeoFrameMeta* meta_out) {
    if (!ctx || !raw18 || !pcm160) return -1;
    MbeNeoContext* c = (MbeNeoContext*)ctx;
    if (c->codec_mode == 1) {
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced);
    }
    c->codec_mode = 2;

    mbe_set_tuning(c->spectral_enh, c->high_band_gain, c->unvoiced_gain);

    char imbe_fr[8][23];
    deinterleave_imbe_144_bytes(raw18, imbe_fr);

    char imbe_d[88];
    mbe_process_result res;
    mbe_initProcessResult(&res);

    int status = mbe_processImbe7200x4400Frame(
        pcm160, &res, imbe_fr, imbe_d,
        &c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced
    );

    fill_meta(c, &res, meta_out);
    return status;
}

EXPORT int mbe_neo_decode_dstar_72(void* ctx, const uint8_t* raw72, int16_t* pcm160, MbeNeoFrameMeta* meta_out) {
    if (!ctx || !raw72 || !pcm160) return -1;
    MbeNeoContext* c = (MbeNeoContext*)ctx;
    if (c->codec_mode != 3) {
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced);
    }
    c->codec_mode = 3;

    mbe_set_tuning(c->spectral_enh, c->high_band_gain, c->unvoiced_gain);

    char ambe_fr[4][24];
    mbe_decodeDStarDVData(raw72, ambe_fr);

    char ambe_d[49];
    mbe_process_result res;
    mbe_initProcessResult(&res);

    int status = mbe_processAmbe3600x2400Frame(
        pcm160, &res, ambe_fr, ambe_d,
        &c->cur_mp, &c->prev_mp, &c->prev_mp_enhanced
    );

    fill_meta(c, &res, meta_out);
    return status;
}

/* =========================================================================
 * TX AMBE+2 ENCODER (mbelib-neo)
 * ========================================================================= */

typedef struct {
    mbe_ambe2450_encoder* enc;
    mbe_parms cur_mp;
    mbe_parms prev_mp;
} MbeNeoEncoderContext;

EXPORT void* mbe_neo_encoder_create(void) {
    MbeNeoEncoderContext* ctx = (MbeNeoEncoderContext*)calloc(1, sizeof(MbeNeoEncoderContext));
    if (ctx) {
        ctx->enc = mbe_ambe2450EncoderAlloc();
        if (!ctx->enc) {
            free(ctx);
            return NULL;
        }
        mbe_initMbeParms(&ctx->cur_mp, &ctx->prev_mp, NULL);
    }
    return ctx;
}

EXPORT void mbe_neo_encoder_destroy(void* ctx) {
    if (ctx) {
        MbeNeoEncoderContext* c = (MbeNeoEncoderContext*)ctx;
        if (c->enc) {
            mbe_ambe2450EncoderFree(c->enc);
            c->enc = NULL;
        }
        free(c);
    }
}

EXPORT void mbe_neo_encoder_reset(void* ctx) {
    if (ctx) {
        MbeNeoEncoderContext* c = (MbeNeoEncoderContext*)ctx;
        if (c->enc) {
            mbe_ambe2450EncoderReset(c->enc);
        }
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, NULL);
    }
}

static void interleave_72_bytes(const char ambe_fr[4][24], uint8_t bytes9[9]) {
    char bits72[72];
    for (int i = 0; i < 36; i++) {
        bits72[2 * i] = ambe_fr[rW[i]][rX[i]] ? 1 : 0;
        bits72[2 * i + 1] = ambe_fr[rY[i]][rZ[i]] ? 1 : 0;
    }
    memset(bytes9, 0, 9);
    for (int byte_i = 0; byte_i < 9; byte_i++) {
        uint8_t b = 0;
        for (int bit_i = 0; bit_i < 8; bit_i++) {
            b = (b << 1) | (bits72[byte_i * 8 + bit_i] & 1);
        }
        bytes9[byte_i] = b;
    }
}

EXPORT int mbe_neo_encode_72(void* ctx, const int16_t* pcm160, uint8_t* raw72) {
    if (!ctx || !pcm160 || !raw72) return -1;
    MbeNeoEncoderContext* c = (MbeNeoEncoderContext*)ctx;
    if (!c->enc) return -1;

    char ambe_d[49];
    int status = mbe_encodeAmbe2450ParmsShort(c->enc, pcm160, ambe_d, &c->cur_mp, &c->prev_mp);
    if (status < 0) return status;

    char ambe_fr[4][24];
    status = mbe_encodeAmbe3600x2450Frame(ambe_d, ambe_fr);
    if (status < 0) return status;

    interleave_72_bytes(ambe_fr, raw72);
    mbe_moveMbeParms(&c->cur_mp, &c->prev_mp);
    return 0;
}

EXPORT int mbe_neo_encode_49(void* ctx, const int16_t* pcm160, uint8_t* ambe49) {
    if (!ctx || !pcm160 || !ambe49) return -1;
    MbeNeoEncoderContext* c = (MbeNeoEncoderContext*)ctx;
    if (!c->enc) return -1;

    char ambe_d[49];
    int status = mbe_encodeAmbe2450ParmsShort(c->enc, pcm160, ambe_d, &c->cur_mp, &c->prev_mp);
    if (status < 0) return status;

    for (int i = 0; i < 49; i++) {
        ambe49[i] = (uint8_t)(ambe_d[i] & 1);
    }
    mbe_moveMbeParms(&c->cur_mp, &c->prev_mp);
    return 0;
}

/* =========================================================================
 * TX D-STAR AMBE 3600x2400 ENCODER (mbelib-neo)
 * ========================================================================= */

typedef struct {
    mbe_ambe2400_encoder* enc;
    mbe_parms cur_mp;
    mbe_parms prev_mp;
} MbeNeoDStarEncoderContext;

EXPORT void* mbe_neo_dstar_encoder_create(void) {
    MbeNeoDStarEncoderContext* ctx = (MbeNeoDStarEncoderContext*)calloc(1, sizeof(MbeNeoDStarEncoderContext));
    if (ctx) {
        ctx->enc = mbe_ambe2400EncoderAlloc();
        if (!ctx->enc) {
            free(ctx);
            return NULL;
        }
        mbe_initMbeParms(&ctx->cur_mp, &ctx->prev_mp, NULL);
    }
    return ctx;
}

EXPORT void mbe_neo_dstar_encoder_destroy(void* ctx) {
    if (ctx) {
        MbeNeoDStarEncoderContext* c = (MbeNeoDStarEncoderContext*)ctx;
        if (c->enc) {
            mbe_ambe2400EncoderFree(c->enc);
            c->enc = NULL;
        }
        free(c);
    }
}

EXPORT void mbe_neo_dstar_encoder_reset(void* ctx) {
    if (ctx) {
        MbeNeoDStarEncoderContext* c = (MbeNeoDStarEncoderContext*)ctx;
        if (c->enc) {
            mbe_ambe2400EncoderReset(c->enc);
        }
        mbe_initMbeParms(&c->cur_mp, &c->prev_mp, NULL);
    }
}

EXPORT int mbe_neo_encode_dstar_72(void* ctx, const int16_t* pcm160, uint8_t* raw72) {
    if (!ctx || !pcm160 || !raw72) return -1;
    MbeNeoDStarEncoderContext* c = (MbeNeoDStarEncoderContext*)ctx;
    if (!c->enc) return -1;

    char ambe_d[49];
    int status = mbe_encodeAmbe2400ParmsShort(c->enc, pcm160, ambe_d, &c->cur_mp, &c->prev_mp);
    if (status < 0) return status;

    char ambe_fr[4][24];
    status = mbe_encodeAmbe3600x2400Frame(ambe_d, ambe_fr);
    if (status < 0) return status;

    status = mbe_encodeDStarDVData(ambe_fr, raw72);
    if (status < 0) return status;

    mbe_moveMbeParms(&c->cur_mp, &c->prev_mp);
    return 0;
}
