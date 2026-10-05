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
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Build and install embedded DSD-FME AMBE+2 vocoder (RX decoding & TX encoding)
RUN make -C src/c_vocoder clean && \
    make -C src/c_vocoder && \
    cp src/c_vocoder/libambe_vocoder.so /usr/local/lib/ && \
    ldconfig

ENV PYTHONPATH=/app/src
ENV PYTHONUNBUFFERED=1

EXPOSE 8266
EXPOSE 62031/udp

CMD ["python", "src/main.py"]
