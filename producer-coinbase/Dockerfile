# ── Coinbase WebSocket → Pub/Sub bridge ──────────────────────────────────────
# Long-running container for Cloud Run (min-instances=1, max-instances=1).
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY main.py .

# No HTTP port — this is a worker, not a web service.
# Cloud Run will accept this when deployed with --no-cpu-throttling and
# min-instances >= 1 (so the loop keeps running between requests).
CMD ["python", "-u", "main.py"]
