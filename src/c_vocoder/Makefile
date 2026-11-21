CC ?= gcc
CFLAGS ?= -O3 -fPIC -Wall

all: libmbe_neo_bridge.so

mbelib-neo/build/libmbe-neo.a:
	cmake -B mbelib-neo/build -S mbelib-neo -DCMAKE_BUILD_TYPE=Release -DMBELIB_ENABLE_NATIVE=OFF -DMBELIB_BUILD_TESTS=OFF -DMBELIB_BUILD_EXAMPLES=OFF
	cmake --build mbelib-neo/build --target mbe-static -j$(shell nproc 2>/dev/null || echo 2)

libmbe_neo_bridge.so: mbe_neo_bridge.c mbelib-neo/build/libmbe-neo.a
	$(CC) $(CFLAGS) -shared -Imbelib-neo/include -Imbelib-neo/build/include mbe_neo_bridge.c mbelib-neo/build/libmbe-neo.a -lm -o $@

clean:
	rm -f libmbe_neo_bridge.so libambe_vocoder.so
	rm -rf mbelib-neo/build

.PHONY: all clean

