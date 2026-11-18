# RoboForex MT5 bridge

The Expert Advisor (EA) runs inside the user's logged-in MetaTrader 5 terminal. It never reads or transmits the trading account password. The terminal must be logged into the intended RoboForex server/account and have the target instrument (normally XAUUSD) selected.

## Install and configure

1. Install and start **GOLD-3Po Market Lab**. It runs the local API on `http://127.0.0.1:8787`.
2. In MT5, open **Tools → Options → Expert Advisors → Allow WebRequest for listed URL** and add `http://127.0.0.1:8787`.
3. Open the installed file `resources\adapters\mt5\Gold3PoBridge.mq5` in MetaEditor and compile with F7.
4. Open `%APPDATA%\GOLD-3Po Market Lab\settings.json` in Notepad and copy the `marketIngestToken` value.
5. Attach the EA to the broker's XAUUSD chart and paste the copied value into the EA input `IngestToken`.
6. Check `http://127.0.0.1:8787/health` for the MT5 feed and `http://127.0.0.1:8787/v1/market/analysis?symbol=XAUUSD&intervalMs=900000` for calculated bars.

## Data flow and recovery

- At startup the EA schedules up to 90 days (30 by default) of broker tick history using hourly `CopyTicksRange` windows. Backfill runs asynchronously from the MT5 timer, one batch of up to 1,000 ticks per cycle, so the terminal becomes responsive immediately and live events are sent first.
- Each historical tick has a deterministic event identity. The API stores historical events independently from the live sequence counter and de-duplicates repeated history uploads. Restarting the EA therefore does not cause historical sequence numbers to block live quotes.
- If a history request or upload fails, the EA retains the current batch and retries with exponential backoff; after repeated failures it waits `HistoryRetryMinutes` (15 by default). Live collection and delivery have priority over backfill.
- Live events are captured in `OnTick`, assigned atomically reserved per-symbol sequence numbers and buffered in memory. The timer flushes batches of up to 1,000 ticks to `/v1/ingest/mt5/live-batch`. Failed batches stay queued for retry. The buffer is capped at 20,000 ticks; a longer outage can overflow it and the EA logs that condition.
- The terminal must remain open and connected. MT5 WebRequest is synchronous; a slow API can delay the EA's event processing. The local API binds only to loopback.
- API events are appended to `%APPDATA%\GOLD-3Po Market Lab\market-events.jsonl` and reloaded after application restart.
- The calculation API builds 15-minute OHLC bars and price-level activity. The chart supports historical replay; the footprint follows the selected candle.

## Volume semantics

RoboForex XAUUSD is an OTC/CFD instrument, not centralized COMEX futures. The EA forwards MT5 tick fields and flags. Bid/Ask aggressor classification is used only when MT5 provides explicit BUY/SELL flags. Otherwise events remain in the `unknown` bucket and count as one tick of activity, not as broker-reported volume. No exchange volume is fabricated.

The 30-day history request means “up to the history available from the broker and terminal”. It cannot guarantee a complete month of ticks. Check the available event count, gaps and feed age before interpreting a chart as complete.

## Live liquidity-zone drawing (v2.10)

With `DrawZones=true` (default) the EA polls `GET /v1/chart/zones?symbol=XAUUSD` every `ZonesRefreshSeconds` (default 5) and redraws the detected liquidity zones on the chart:

- **Buy-side zones** (repeated swing highs above price): teal rectangles; **sell-side zones** (repeated swing lows): red rectangles. Colors are inputs (`BuyZoneColor`, `SellZoneColor`).
- Each rectangle spans `ZoneLookbackBars` (default 200) of history into the near future and carries a label `side LQ strength distance` plus a tooltip.
- A status line in the top-left corner shows zone counts and the last refresh time.
- Zones are rebuilt from the latest market analysis on every refresh, so they **follow the market**: new repeated levels appear, consumed levels disappear.
- All objects use the `G3P_` prefix and are removed when the EA is detached.
- If the licence is missing/expired (`402`), the EA clears the zones and shows a licence-required notice; tick ingestion continues regardless.

Zones are heuristic repeated-swing estimates, not confirmed order-book depth. A reaction at a zone is probable, not guaranteed.

## Operational boundary

- The EA must be compiled in MetaEditor. GitHub Actions cannot compile MQL5 source.
- The desktop application and MT5 terminal run on the same machine through localhost. For a shared central feed, deploy the API behind HTTPS and configure the EA URLs to that server.
- The EA only sends market data. It never submits, modifies or closes orders.
- The EA source has not been certified against a live RoboForex account in this repository workflow; verify MetaEditor compilation and a demo-account feed before relying on it.
