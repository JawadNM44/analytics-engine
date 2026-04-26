"""
Crypto Analytics Dashboard — Streamlit on Cloud Run.

Reads exclusively from the public crypto-api (no BigQuery credentials
in this container). The API does the BQ scanning, this layer renders.

Design notes
────────────
- Stateless. Every Streamlit rerun fetches fresh JSON from the API.
- Per-call caching via @st.cache_data(ttl=10) bounds API traffic to
  at most one fetch per endpoint per 10 seconds, however many viewers.
- No symbols hard-coded in UI logic — they come from /stats so adding
  a fourth symbol upstream needs zero changes here.
- Plotly for charts (built into Streamlit, no extra dependency).
"""
from __future__ import annotations

import os
from datetime import datetime, timezone

import pandas as pd
import plotly.graph_objects as go
import requests
import streamlit as st

API_BASE = os.environ.get(
    "API_BASE_URL", "https://crypto-api-jiuqt3hfoq-uc.a.run.app"
).rstrip("/")
CACHE_TTL_SECONDS = int(os.environ.get("CACHE_TTL_SECONDS", 10))

st.set_page_config(
    page_title="Crypto Analytics — Live",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed",
)


# ── Data fetchers (cached) ───────────────────────────────────────────────────
@st.cache_data(ttl=CACHE_TTL_SECONDS, show_spinner=False)
def fetch(path: str) -> dict | None:
    """GET against the API with a tight timeout and graceful failure."""
    try:
        r = requests.get(f"{API_BASE}{path}", timeout=8)
        r.raise_for_status()
        return r.json()
    except requests.exceptions.RequestException as exc:
        st.error(f"API call to {path} failed: {exc}")
        return None


# ── Header ───────────────────────────────────────────────────────────────────
st.title("Crypto Analytics — Live")
st.caption(
    f"Source: Coinbase Exchange WebSocket → Pub/Sub → Cloud Function → BigQuery. "
    f"API: [{API_BASE}]({API_BASE}). Auto-refreshes every {CACHE_TTL_SECONDS}s."
)

# Health badge so the dashboard surfaces backend issues immediately.
health = fetch("/health")
if health and health.get("status") == "ok":
    st.success("Pipeline healthy", icon="✅")
else:
    st.warning("Pipeline degraded — check `/health` directly", icon="⚠️")

st.divider()

# ── KPI scorecards ──────────────────────────────────────────────────────────
stats = fetch("/stats")
if stats and stats.get("by_symbol"):
    st.subheader("Last 24 hours")
    cols = st.columns(len(stats["by_symbol"]))
    for col, sym in zip(cols, stats["by_symbol"]):
        # Pull a 1h delta for the metric arrow
        price_data = fetch(f"/price/{sym['product_id']}")
        delta = None
        if price_data and price_data.get("pct_change_1h") is not None:
            delta = f"{price_data['pct_change_1h'] * 100:+.3f}% (1h)"
        col.metric(
            label=sym["product_id"],
            value=f"${price_data['price']:,.2f}" if price_data else "n/a",
            delta=delta,
        )

    # Overall totals row
    total_trades = sum(s["trades"] for s in stats["by_symbol"])
    total_volume = sum(s["volume_usd"] for s in stats["by_symbol"])
    c1, c2 = st.columns(2)
    c1.metric("Total trades (24h)", f"{total_trades:,}")
    c2.metric("Total volume (24h)", f"${total_volume:,.0f}")
else:
    st.info("Waiting for /stats response. The producer may be paused.")

st.divider()

# ── Price chart ─────────────────────────────────────────────────────────────
st.subheader("Price — last 60 minutes")
symbols = (
    [s["product_id"] for s in stats["by_symbol"]]
    if (stats and stats.get("by_symbol"))
    else ["BTC-USD", "ETH-USD", "SOL-USD"]
)
selected = st.selectbox("Symbol", symbols, index=0, label_visibility="collapsed")

candles = fetch(f"/candles/{selected}?minutes=60")
if candles and candles.get("candles"):
    df = pd.DataFrame(candles["candles"])
    df["minute"] = pd.to_datetime(df["minute"])
    df = df.sort_values("minute")

    fig = go.Figure(
        data=[
            go.Candlestick(
                x=df["minute"],
                open=df["open"],
                high=df["high"],
                low=df["low"],
                close=df["close"],
                name=selected,
            )
        ]
    )
    fig.update_layout(
        height=380,
        margin=dict(l=10, r=10, t=10, b=10),
        xaxis_rangeslider_visible=False,
        yaxis_title="USD",
    )
    st.plotly_chart(fig, use_container_width=True)
else:
    st.info(f"No candles yet for {selected}.")

# Volume bar chart
if candles and candles.get("candles"):
    fig_vol = go.Figure(
        data=[
            go.Bar(
                x=df["minute"],
                y=df["volume_usd"],
                name="USD volume",
                marker=dict(color="#5b8def"),
            )
        ]
    )
    fig_vol.update_layout(
        height=180,
        margin=dict(l=10, r=10, t=10, b=10),
        yaxis_title="USD volume / min",
    )
    st.plotly_chart(fig_vol, use_container_width=True)

st.divider()

# ── Two columns: anomalies + whales ─────────────────────────────────────────
left, right = st.columns(2)

with left:
    st.subheader("Recent volume anomalies")
    st.caption("Rolling 60-min z-score, |z| > 3 (statistical baseline)")
    anomalies = fetch("/anomalies/recent?limit=20")
    if anomalies and anomalies.get("anomalies"):
        df_a = pd.DataFrame(anomalies["anomalies"])
        if "minute" in df_a:
            df_a["minute"] = pd.to_datetime(df_a["minute"])
        st.dataframe(df_a, use_container_width=True, hide_index=True, height=320)
    else:
        st.info("No anomalies in the recent window.")

with right:
    st.subheader("Whale trades — top 1% per symbol")
    whales = fetch("/whales/recent?limit=20")
    if whales and whales.get("whales"):
        df_w = pd.DataFrame(whales["whales"])
        if "trade_time" in df_w:
            df_w["trade_time"] = pd.to_datetime(df_w["trade_time"])
        st.dataframe(df_w, use_container_width=True, hide_index=True, height=320)
    else:
        st.info("No whale trades yet.")

st.divider()

# ── ML anomalies — separate section because the model needs ~24h to be useful
st.subheader("ML anomaly forecast (BigQuery ML — ARIMA_PLUS)")
st.caption(
    "Volume minutes outside the model's 95% confidence interval. "
    "Model retrains nightly via a scheduled query."
)
ml = fetch("/anomalies/ml?hours=6")
if ml and ml.get("anomalies"):
    df_ml = pd.DataFrame(ml["anomalies"])
    if "minute" in df_ml:
        df_ml["minute"] = pd.to_datetime(df_ml["minute"])
    st.dataframe(df_ml, use_container_width=True, hide_index=True, height=240)
else:
    st.info(
        "No ML anomalies in the last 6 hours — model is conservative and "
        "this is normal during quiet markets."
    )

# ── Footer ──────────────────────────────────────────────────────────────────
st.caption(
    f"Rendered at {datetime.now(timezone.utc).isoformat(timespec='seconds')}. "
    f"Source: github.com/JawadNM44/analytics-engine"
)
