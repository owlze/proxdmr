CXX ?= g++
CC ?= gcc
CXXFLAGS += -O3 -fPIC -Wall -I. -Iimbe_vocoder -Imbe -std=c++17
CFLAGS += -O3 -fPIC -Wall -I. -Iimbe_vocoder -Imbe
LDFLAGS += -shared -lm -lstdc++

SRCS_CPP = c_wrapper.cpp \
           imbe_vocoder/aux_sub.cc \
           imbe_vocoder/basicop2.cc \
           imbe_vocoder/ch_decode.cc \
           imbe_vocoder/ch_encode.cc \
           imbe_vocoder/dc_rmv.cc \
           imbe_vocoder/decode.cc \
           imbe_vocoder/dsp_sub.cc \
           imbe_vocoder/encode.cc \
           imbe_vocoder/imbe_vocoder.cc \
           imbe_vocoder/imbe_vocoder_impl.cc \
           imbe_vocoder/math_sub.cc \
           imbe_vocoder/pe_lpf.cc \
           imbe_vocoder/pitch_est.cc \
           imbe_vocoder/pitch_ref.cc \
           imbe_vocoder/qnt_sub.cc \
           imbe_vocoder/rand_gen.cc \
           imbe_vocoder/sa_decode.cc \
           imbe_vocoder/sa_encode.cc \
           imbe_vocoder/sa_enh.cc \
           imbe_vocoder/tbls.cc \
           imbe_vocoder/uv_synt.cc \
           imbe_vocoder/v_synt.cc \
           imbe_vocoder/v_uv_det.cc \
           mbe/mbevocoder.cpp

SRCS_C = mbe/ambe3600x2400.c \
         mbe/ambe3600x2450.c \
         mbe/ecc.c \
         mbe/mbelib.c

OBJS = $(SRCS_CPP:.cpp=.o)
OBJS := $(OBJS:.cc=.o)
OBJS += $(SRCS_C:.c=.o)

TARGET = libambe_vocoder.so

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CXX) $(OBJS) $(LDFLAGS) -o $@

%.o: %.cpp
	$(CXX) $(CXXFLAGS) -c $< -o $@

%.o: %.cc
	$(CXX) $(CXXFLAGS) -c $< -o $@

%.o: %.c
	$(CC) $(CFLAGS) -c $< -o $@

clean:
	rm -f $(OBJS) $(TARGET)

.PHONY: all clean
