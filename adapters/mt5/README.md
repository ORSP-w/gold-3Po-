# RoboForex MT5 bridge

The Expert Advisor (EA) runs inside the user's logged-in MetaTrader 5 terminal. It never reads or transmits the trading account password. The terminal must be logged into the intended RoboForex server/account and have the target instrument (normally XAUUSD) selected.

## Installation

1. Start the GOLD-3Po API with a unique random `MARKET_INGEST_TOKEN` of at least 24 characters.
2. Run `npm start` and confirm `GET /health` responds.
3. In MT5, open **Tools → Options → Expert Advisors → Allow WebRequest for listed URL** and add the API origin, for example `http://127.0.0.1:8787`. For a remote server, use its HTTPS origin.
4. Open `Gold3PoBridge.mq5` in MetaEditor and compile with F7. Attach the EA to the broker's XAUUSD chart.
5. Enter the same `IngestToken` in the EA inputs. Keep `HistoryDays=30`; set it lower if the broker terminal cannot supply the full history.
6. Check `/health` for the MT5 feed and `/v1/market/analysis?symbol=XAUUSD&intervalMs=900000` for calculated bars.

## Data flow and recovery

- At startup the EA schedules up to 90 days (30 by default) of broker tick history using hourly `CopyTicksRange` windows. Backfill runs asynchronously from the MT5 timer, one batch of up to 1,000 ticks per cycle, so the terminal becomes responsive immediately and live events are sent first.
- Each historical tick has a deterministic event identity. The API stores historical events independently from the live sequence counter and de-duplicates repeated history uploads. Restarting the EA therefore does not cause historical sequence numbers to block live quotes.
- If a history request or upload fails, the EA retains the current batch and retries with exponential backoff; after repeated failures it waits `HistoryRetryMinutes` (15 by default). Live collection and delivery have priority over backfill.
- Live events are captured in `OnTick`, assigned atomically reserved per-symbol sequence numbers and buffered in memory. The timer flushes batches of up to 1,000 ticks to `/v1/ingest/mt5/live-batch`. Failed batches stay queued for retry. The buffer is capped at 20,000 ticks; a longer outage can overflow it and the EA logs that condition.
- The terminal must remain open and connected. MT5 WebRequest is synchronous; a slow API can delay the EA's event processing. Use a nearby API host and TLS for remote connections.
- API events are appended to `./data/market-events.jsonl` by default and reloaded after API restart. Set `MARKET_DATA_FILE` to change the path.
- The calculation API builds 15-minute OHLC bars and price-level activity. The chart supports historical replay; the footprint follows the selected candle.

## Volume semantics

RoboForex XAUUSD is an OTC/CFD instrument, not centralized COMEX futures. The EA forwards MT5 tick fields and flags. Bid/Ask aggressor classification is used only when MT5 provides explicit BUY/SELL flags. Otherwise events remain in the `unknown` bucket and count as one tick of activity, not as broker-reported volume. No exchange volume is fabricated.

The 30-day history request means “up to the history available from the broker and terminal”. It cannot guarantee a complete month of ticks. Check the available event count, gaps and feed age before interpreting a chart as complete.

## Operational boundary

- The EA must be compiled in MetaEditor. GitHub Actions cannot compile MQL5 source.
- The API and MT5 terminal may run on the same machine using localhost. For a shared central feed, deploy one API behind HTTPS and configure both EA URLs to that server.
- The EA only sends market data. It never submits, modifies or closes orders.
- The EA source has not been certified against a live RoboForex account in this repository workflow; verify MetaEditor compilation and a demo-account feed before relying on it.
