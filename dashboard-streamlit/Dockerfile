FROM python:3.12-slim

ENV PORT=8080 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    STREAMLIT_SERVER_HEADLESS=true \
    STREAMLIT_SERVER_ENABLE_CORS=false \
    STREAMLIT_SERVER_ENABLE_XSRF_PROTECTION=false \
    STREAMLIT_BROWSER_GATHER_USAGE_STATS=false

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY . .

# Cloud Run sets $PORT; Streamlit defaults to 8501. Bind explicitly.
CMD exec streamlit run main.py \
    --server.port=${PORT} \
    --server.address=0.0.0.0 \
    --server.headless=true
