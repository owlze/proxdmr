FROM python:3.11-alpine
WORKDIR /app
COPY watchdog.py /app/watchdog.py
VOLUME ["/data"]
CMD ["python", "-u", "/app/watchdog.py"]
