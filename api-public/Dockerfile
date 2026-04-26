# Slim Python base — small image, fast cold start on Cloud Run.
FROM python:3.12-slim

# Cloud Run expects the container to listen on $PORT (default 8080).
ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Single uvicorn worker is enough — Cloud Run scales horizontally with
# instances, not threads. More workers per container just wastes RAM.
CMD exec uvicorn main:app --host 0.0.0.0 --port ${PORT} --workers 1
