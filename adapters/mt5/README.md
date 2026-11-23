# RoboForex MT5 bridge

Two integration paths exist:

- **App-side connection (recommended):** sign in from the GOLD-3Po window
  («Подключить MT5»). The bundled standalone connector (`mt5-runtime/gold3po-mt5/gold3po-mt5.exe`,
  built from `mt5_connector.py`) attaches to your broker terminal via the official
  MetaTrader5 Python API, streams gold ticks into the local API and publishes
  dynamic levels to `Common\Files\GOLD3PO\<SYMBOL>.csv`. The separate custom
  indicator **`Gold3PoLevels.mq5`** reads that file and draws the levels on the
  chart — no WebRequest, no DLL, no trading. See `docs/MT5-CONNECT.md`.
- **EA bridge (this document):** `Gold3PoBridge.mq5` uploads up to 90 days of
  broker tick history plus live quotes over HTTP and can also draw zones itself.
  Use it for deep historical backfill; it never reads or transmits the account password.

The Expert Advisor (EA) runs inside the user's logged-in MetaTrader 5 terminal. It never reads or transmits the trading account password. The terminal must be logged into the intended RoboForex server/account and have the target instrument (normally XAUUSD) selected.

## Install and configure

1. Install and start **GOLD-3Po Market Lab**. It runs the local API on `http://127.0.0.1:8787`.
2. In MT5, open **Tools → Options → Expert Advisors → Allow WebRequest for listed URL** and add `http://127.0.0.1:8787`.
3. Open the installed file `resources\adapters\mt5\Gold3PoBridge.mq5` in MetaEditor and compile with F7.
4. Copy the ingest token from the app: **⚙ Настройки → Отрисовка в MT5 → Мост MT5 → «Скопировать»**. The same value lives in `%APPDATA%\GOLD-3Po Market Lab\settings.json` (`marketIngestToken`) if you ever need it from disk; it is created once and does not change between launches.
5. Attach **one** EA instance to one XAUUSD chart and paste the copied value into `IngestToken`. Duplicate H1/H4/M15 instances on the same symbol will refuse to start.
6. Keep `AppConnectionFeedsLive=true` (default) when the desktop MT5 connection is active: the app owns the latest ~8 hours and live stream; the EA backfills older history and draws zones. Set it to `false` only when the EA must be the sole live quote source.
7. Check `http://127.0.0.1:8787/health` and the MT5 Experts tab for the preflight result.

## Data flow and recovery

- At startup the EA schedules up to 90 days (30 by default) of broker tick history using hourly `CopyTicksRange` windows. With the desktop feed enabled, backfill stops 8 hours before now so it does not duplicate the recent ticks already supplied by the app.
- The EA is single-instance per symbol (terminal-global lock); attach it once, not to H1/H4/M15 simultaneously. A second instance exits with an explicit Experts-tab message.
- Historical upload defaults to 200 ticks per batch with a 15-second request timeout. On WebRequest transport failure the batch is reduced (down to 50) and retried with backoff.
- By default `AppConnectionFeedsLive=true`: the desktop connector owns recent/live ticks; the EA owns deep historical backfill and optional zone drawing. Set it to `false` only when the EA alone should send live quotes.
- When standalone live delivery is enabled, ticks remain queued through HTTP errors and retry with backoff. The queue is capped at 20,000 ticks.
- The terminal must remain open and connected. MT5 WebRequest is synchronous; a slow API can delay the EA's event processing. The local API binds only to loopback.
- API events are appended to `%APPDATA%\GOLD-3Po Market Lab\market-events.jsonl` and reloaded after application restart.
- The calculation API builds 15-minute OHLC bars and price-level activity. The chart supports historical replay; the footprint follows the selected candle.

## Volume semantics

RoboForex XAUUSD is an OTC/CFD instrument, not centralized COMEX futures. The EA forwards MT5 tick fields and flags. Bid/Ask aggressor classification is used only when MT5 provides explicit BUY/SELL flags. Otherwise events remain in the `unknown` bucket and count as one tick of activity, not as broker-reported volume. No exchange volume is fabricated.

The 30-day history request means “up to the history available from the broker and terminal”. It cannot guarantee a complete month of ticks. Check the available event count, gaps and feed age before interpreting a chart as complete.

## Live liquidity-zone drawing (v2.20)

With `DrawZones=true` (default) the EA polls `GET /v1/chart/zones?symbol=XAUUSD` every `ZonesRefreshSeconds` (default 5) and redraws the detected liquidity zones on the chart:

- Zones above price (buy-side) and below price (sell-side) are drawn as rectangles in the colours, line style, width and fill chosen in the app (**Settings → Отрисовка в MT5**; default red solid lines). Set `UseAppStyle=false` to use the EA inputs (`BuyZoneColor`, `SellZoneColor`, `ZoneLineStyle`, `ZoneLineWidth`) instead.
- Each rectangle spans `ZoneLookbackBars` (default 200) of history into the near future and carries a label `side LQ strength distance` plus a tooltip.
- A status line in the top-left corner shows zone counts and the last refresh time.
- The MT5 zones route returns only flat drawing fields (`id`, `side`, bounds, strength, label, distance and state). Full reaction/source/factor detail remains in the desktop analysis API; the flat shape avoids the EA's lightweight parser stopping at nested JSON.
- Zones are rebuilt from the latest market analysis on every refresh, so they **follow the market**: new repeated levels appear, consumed levels disappear.
- All objects use the `G3P_` prefix and are removed when the EA is detached.
- If the licence is missing/expired (`402`), the EA clears the zones and shows a licence-required notice; tick ingestion continues regardless.

Zones are built from several independent sources (swings, the previous day's high/low, session extremes, the previous week, H1/H4 swings, the volume profile and round numbers) and scored by measured past reactions plus how many sources agree. They are not confirmed order-book depth, and a reaction at a zone is probable, not guaranteed.

## Operational boundary

- The EA must be compiled in MetaEditor. GitHub Actions cannot compile MQL5 source.
- The desktop application and MT5 terminal run on the same machine through localhost. For a shared central feed, deploy the API behind HTTPS and configure the EA URLs to that server.
- The EA only sends market data. It never submits, modifies or closes orders.
- The EA source has not been certified against a live RoboForex account in this repository workflow; verify MetaEditor compilation and a demo-account feed before relying on it.


## Confirm that liquidity zones are visible on the MT5 chart

For the **recommended app-side connection**:

1. Start GOLD-3Po Market Lab and connect the intended XAUUSD account in the app.
2. Click **«Установить индикатор зон»** in the MT5 connection dialog. The app copies `Gold3PoLevels.mq5` into the terminal's `MQL5/Indicators` folder and compiles it when MetaEditor is available.
3. In MT5, open **Navigator → Indicators**, refresh the list, and attach **Gold3PoLevels** to the same XAUUSD chart.
4. The indicator reads the app's atomic snapshot from `Common\Files\GOLD3PO\<SYMBOL>.csv` and draws both zone boundaries, optional subtle fill, labels and strength. No WebRequest permission is needed for this indicator path.
5. The top-left chart status should show `Gold3Po <symbol>: N zones`. If it says snapshot missing/stale/unreadable, check the Common Files path and that the desktop connection is still online.

For the **EA bridge path**, attach `Gold3PoBridge.mq5` and allow `http://127.0.0.1:8787` in MT5 WebRequest settings. Keep `DrawZones=true`. The EA's top-left `GOLD-3Po zones: N` status reports how many zone rectangles were created.

Fresh installs now use distinct cyan buy-side and red sell-side zones with a light fill, matching the desktop chart. Existing saved MT5 colours/fill preferences are preserved; change them in **Settings → Отрисовка в MT5**, or reset settings to use the new defaults.
