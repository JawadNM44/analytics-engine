# Crypto Analytics Dashboard

Streamlit dashboard on Cloud Run. Reads from the public crypto-api — no BigQuery credentials required in this container.

## Local dev

```bash
cd dashboard-streamlit
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Defaults to the live API URL; override locally if pointing at a different deploy:
export API_BASE_URL=https://crypto-api-jiuqt3hfoq-uc.a.run.app

streamlit run main.py
# → http://localhost:8501
```

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `API_BASE_URL` | live API | Backend the dashboard reads from |
| `CACHE_TTL_SECONDS` | `10` | How long fetched JSON is cached per endpoint |
| `PORT` | `8080` | Set by Cloud Run |

## Why a separate dashboard service

- **Clean separation of concerns**: API speaks BigQuery, dashboard speaks API. Either can be replaced without touching the other.
- **No GCP credentials in the dashboard**: container needs nothing beyond outbound HTTPS. Reduces blast radius if the dashboard image ever leaks.
- **Cheaper**: every dashboard reload doesn't hit BigQuery; it hits the API which has its own short TTL plus BQ's own 24h result cache.

## Cost

Scale-to-zero, max-instances 5. At portfolio-demo traffic: **EUR 0/month**. Hard upper bound under abuse: ~EUR 5/day (5 instances × hours × low CPU).
