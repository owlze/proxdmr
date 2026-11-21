FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    g++ \
    openssl \
    curl \
    ffmpeg \
    libasound2-dev \
    libcodec2-dev \
    libopus0 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir "torch>=2.15.0" --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir --only-binary=llama-cpp-python "llama-cpp-python==0.3.19" --extra-index-url https://abetlen.github.io/llama-cpp-python/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

COPY . .

# Build and install embedded mbelib-neo AMBE+2 vocoder (RX decoding & TX encoding)
RUN make -C src/c_vocoder clean && \
    make -C src/c_vocoder && \
    cp src/c_vocoder/libmbe_neo_bridge.so /usr/local/lib/ && \
    ldconfig

ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

EXPOSE 8266
EXPOSE 62031/udp

CMD ["python", "src/main.py"]
