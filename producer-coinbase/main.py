"""
Coinbase WebSocket → GCP Pub/Sub bridge.

Subscribes to the public Coinbase Exchange WebSocket "matches" channel for
configured products (e.g. BTC-USD, ETH-USD, SOL-USD) and republishes every
trade to a Pub/Sub topic for downstream processing.

Designed to run forever on Cloud Run (or any container host):
  • Auto-reconnect with exponential backoff on disconnect / network errors.
  • Graceful shutdown on SIGTERM (Cloud Run sends this on revision rollover).
  • Heartbeat logging — prints throughput every HEARTBEAT_SECONDS.
  • Pub/Sub batching for cost / throughput.
  • --dry-run mode to verify the WebSocket feed without publishing anything.

Public Coinbase docs: https://docs.cdp.coinbase.com/exchange/docs/websocket-overview
The "matches" channel is public — no auth, no API key required.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import signal
import time
from datetime import datetime, timezone

import websockets
from aiohttp import web
from google.cloud import pubsub_v1

# ── Config ────────────────────────────────────────────────────────────────────
COINBASE_WS_URL = os.environ.get(
    "COINBASE_WS_URL", "wss://ws-feed.exchange.coinbase.com"
)
PRODUCT_IDS = os.environ.get("PRODUCT_IDS", "BTC-USD,ETH-USD,SOL-USD").split(",")

PROJECT_ID = os.environ.get("GCP_PROJECT_ID", "")
TOPIC_ID = os.environ.get("PUBSUB_TOPIC", "crypto-trades")

# Pub/Sub batching — small batches because the feed is bursty but low-volume
# per-message; max_latency keeps end-to-end latency down.
BATCH_MAX_MESSAGES = int(os.environ.get("BATCH_MAX_MESSAGES", 100))
BATCH_MAX_LATENCY = float(os.environ.get("BATCH_MAX_LATENCY", 0.25))  # seconds

HEARTBEAT_SECONDS = int(os.environ.get("HEARTBEAT_SECONDS", 30))

# Cloud Run healthcheck: must bind to $PORT (default 8080) for the container
# to be considered healthy.
HTTP_PORT = int(os.environ.get("PORT", 8080))

# Reconnect: exponential backoff capped at 60s
RECONNECT_INITIAL = 1.0
RECONNECT_MAX = 60.0

# Liveness state — flipped to True after first successful WS connection,
# used by /health for Cloud Run / k8s probes.
_alive = {"ws_connected": False, "last_trade_ts": 0.0}

# ── Logging ───────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("coinbase-producer")

# ── Shutdown signalling ───────────────────────────────────────────────────────
_shutdown = asyncio.Event()


def _install_signal_handlers(loop: asyncio.AbstractEventLoop) -> None:
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _shutdown.set)
        except NotImplementedError:
            # Windows / restricted environments — fall back to default handlers
            pass


# ── Pub/Sub publisher ─────────────────────────────────────────────────────────
def make_publisher() -> pubsub_v1.PublisherClient:
    batch_settings = pubsub_v1.types.BatchSettings(
        max_messages=BATCH_MAX_MESSAGES,
        max_latency=BATCH_MAX_LATENCY,
    )
    return pubsub_v1.PublisherClient(batch_settings=batch_settings)


# ── Trade transform ───────────────────────────────────────────────────────────
def transform_match(msg: dict) -> dict | None:
    """
    Convert a Coinbase 'match' event into our canonical crypto_trades schema.

    Coinbase 'match' message (excerpt):
      {
        "type": "match",
        "trade_id": 12345,
        "product_id": "BTC-USD",
        "side": "buy" | "sell",
        "size": "0.00123",
        "price": "67000.00",
        "time": "2026-04-25T12:00:00.000000Z"
      }

    Returns None for messages we want to skip (subscriptions, heartbeats, etc).
    """
    if msg.get("type") not in ("match", "last_match"):
        return None

    try:
        size = float(msg["size"])
        price = float(msg["price"])
    except (KeyError, ValueError, TypeError):
        return None

    return {
        # Coinbase trade_id is unique per product, so we namespace it.
        "trade_id": f"{msg['product_id']}:{msg['trade_id']}",
        "product_id": msg["product_id"],
        "side": msg["side"],
        "size": size,
        "price": price,
        "volume_usd": round(size * price, 8),
        "trade_time": msg["time"],
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


# ── WebSocket consumer loop ───────────────────────────────────────────────────
async def consume_once(
    publisher: pubsub_v1.PublisherClient | None,
    topic_path: str | None,
    dry_run: bool,
    counters: dict,
) -> None:
    """One connection lifecycle: subscribe, then read until closed/error."""
    log.info("Connecting to %s", COINBASE_WS_URL)
    async with websockets.connect(
        COINBASE_WS_URL,
        ping_interval=20,
        ping_timeout=20,
        close_timeout=5,
        max_size=2**20,
    ) as ws:
        subscribe = {
            "type": "subscribe",
            "product_ids": PRODUCT_IDS,
            "channels": ["matches"],
        }
        await ws.send(json.dumps(subscribe))
        log.info("Subscribed to matches for %s", ",".join(PRODUCT_IDS))
        _alive["ws_connected"] = True

        async for raw in ws:
            if _shutdown.is_set():
                log.info("Shutdown signalled — closing WebSocket")
                await ws.close()
                return

            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                counters["decode_errors"] += 1
                continue

            trade = transform_match(msg)
            if trade is None:
                continue

            counters["trades"] += 1
            counters["volume_usd"] += trade["volume_usd"]
            _alive["last_trade_ts"] = time.time()

            if dry_run:
                log.info(
                    "TRADE %s %s %.8f @ %.2f = $%.2f",
                    trade["product_id"],
                    trade["side"],
                    trade["size"],
                    trade["price"],
                    trade["volume_usd"],
                )
                continue

            assert publisher is not None and topic_path is not None
            data = json.dumps(trade).encode("utf-8")
            # Ordering key per product enables ordered delivery and natural
            # deduplication downstream.
            future = publisher.publish(
                topic_path,
                data,
                product_id=trade["product_id"],
                side=trade["side"],
            )
            # Fire-and-forget; we don't await each future — the publisher
            # batches under the hood. We attach a callback only to count errors.
            future.add_done_callback(_make_publish_callback(counters))


def _make_publish_callback(counters: dict):
    def _cb(future):
        if future.exception():
            counters["publish_errors"] += 1
            log.error("Publish failed: %s", future.exception())
        else:
            counters["published"] += 1

    return _cb


# ── Heartbeat ─────────────────────────────────────────────────────────────────
async def heartbeat(counters: dict) -> None:
    last = dict(counters)
    last_t = time.perf_counter()
    while not _shutdown.is_set():
        await asyncio.sleep(HEARTBEAT_SECONDS)
        now_t = time.perf_counter()
        dt = now_t - last_t

        d_trades = counters["trades"] - last["trades"]
        d_pub = counters["published"] - last["published"]
        d_vol = counters["volume_usd"] - last["volume_usd"]

        log.info(
            "[heartbeat] trades=%d (+%d) published=%d (+%d) errors=%d "
            "vol_usd=$%.2f (+$%.2f) rate=%.1f trades/s",
            counters["trades"],
            d_trades,
            counters["published"],
            d_pub,
            counters["publish_errors"],
            counters["volume_usd"],
            d_vol,
            d_trades / dt if dt else 0.0,
        )
        last = dict(counters)
        last_t = now_t


# ── Reconnect loop ────────────────────────────────────────────────────────────
async def run_forever(dry_run: bool) -> None:
    publisher: pubsub_v1.PublisherClient | None = None
    topic_path: str | None = None

    if not dry_run:
        if not PROJECT_ID:
            raise RuntimeError(
                "GCP_PROJECT_ID env var is required when not in --dry-run mode"
            )
        publisher = make_publisher()
        topic_path = publisher.topic_path(PROJECT_ID, TOPIC_ID)
        log.info("Publishing to %s", topic_path)
    else:
        log.info("DRY RUN — trades will be logged, not published")

    counters = {
        "trades": 0,
        "published": 0,
        "publish_errors": 0,
        "decode_errors": 0,
        "volume_usd": 0.0,
    }

    hb_task = asyncio.create_task(heartbeat(counters))
    backoff = RECONNECT_INITIAL

    try:
        while not _shutdown.is_set():
            try:
                await consume_once(publisher, topic_path, dry_run, counters)
                # Clean close — reset backoff
                backoff = RECONNECT_INITIAL
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001 — we want to retry on anything
                _alive["ws_connected"] = False
                log.warning(
                    "WebSocket loop error: %s — reconnecting in %.1fs",
                    exc,
                    backoff,
                )
                try:
                    await asyncio.wait_for(_shutdown.wait(), timeout=backoff)
                except asyncio.TimeoutError:
                    pass
                backoff = min(backoff * 2, RECONNECT_MAX)
    finally:
        hb_task.cancel()
        try:
            await hb_task
        except asyncio.CancelledError:
            pass

        if publisher is not None:
            log.info("Flushing publisher…")
            # Stop accepts no new messages; wait for in-flight to drain.
            publisher.stop()

        log.info(
            "Final: trades=%d published=%d publish_errors=%d "
            "decode_errors=%d volume_usd=$%.2f",
            counters["trades"],
            counters["published"],
            counters["publish_errors"],
            counters["decode_errors"],
            counters["volume_usd"],
        )


# ── HTTP healthcheck server (required for Cloud Run) ─────────────────────────
async def _health(_request: web.Request) -> web.Response:
    """
    Returns 200 only when the WebSocket is connected AND we've seen a trade
    in the last 60 seconds (catches silent half-open connections).
    """
    now = time.time()
    fresh = (now - _alive["last_trade_ts"]) < 60
    healthy = _alive["ws_connected"] and (
        fresh or _alive["last_trade_ts"] == 0  # allow startup grace
    )
    body = {
        "status": "ok" if healthy else "degraded",
        "ws_connected": _alive["ws_connected"],
        "seconds_since_last_trade": (
            round(now - _alive["last_trade_ts"], 2)
            if _alive["last_trade_ts"]
            else None
        ),
    }
    return web.json_response(body, status=200 if healthy else 503)


async def _root(_request: web.Request) -> web.Response:
    return web.Response(text="coinbase-producer ok\n")


async def _start_http_server() -> web.AppRunner:
    app = web.Application()
    app.router.add_get("/", _root)
    app.router.add_get("/health", _health)
    runner = web.AppRunner(app, access_log=None)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", HTTP_PORT)
    await site.start()
    log.info("HTTP healthcheck listening on :%d", HTTP_PORT)
    return runner


async def _serve(dry_run: bool) -> None:
    runner = await _start_http_server()
    try:
        await run_forever(dry_run=dry_run)
    finally:
        await runner.cleanup()


# ── Entry point ───────────────────────────────────────────────────────────────
def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print trades to stdout instead of publishing to Pub/Sub.",
    )
    parser.add_argument(
        "--no-http",
        action="store_true",
        help="Skip the HTTP healthcheck server (use for local CLI runs).",
    )
    args = parser.parse_args()

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    _install_signal_handlers(loop)

    try:
        if args.no_http:
            loop.run_until_complete(run_forever(dry_run=args.dry_run))
        else:
            loop.run_until_complete(_serve(dry_run=args.dry_run))
    finally:
        loop.close()


if __name__ == "__main__":
    main()
