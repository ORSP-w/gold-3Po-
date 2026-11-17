# RoboForex MT5 bridge

The bridge connects through the user's logged-in MetaTrader 5 terminal. It does not collect or transmit the trading account password. The terminal must already be logged in to the intended RoboForex server/account and have the XAUUSD symbol available.

## Setup

1. Start the GOLD-3Po API and set a long random `MARKET_INGEST_TOKEN`.
2. Copy `.env.example` to `.env`, set the token, then run `npm start`.
3. In MT5, open **Tools → Options → Expert Advisors** and allow the API URL for both the live and history endpoints (the same host is sufficient).
4. Compile `Gold3PoBridge.mq5` in MetaEditor and attach it to the RoboForex XAUUSD chart.
5. Enter the same ingest token in the EA inputs. Set `HistoryDays=30` (default).
6. Check `GET /health` for the MT5 feed and `GET /v1/market/analysis?symbol=XAUUSD&intervalMs=900000` for aggregated bars.

## Data flow

- On initialization, the EA requests the available broker tick history for up to 30 days using hourly `CopyTicksRange` windows and uploads batches of up to 100 ticks.
- The EA then sends live broker quotes on a timer. MT5 terminal must remain open and connected.
- Server events are appended to `./data/market-events.jsonl` by default and reloaded after an API restart. Set `MARKET_DATA_FILE` to change the file path.
- The analysis API aggregates the same tick stream into 15-minute OHLC candles and price-level footprint buckets (default price step 0.1). The chart can scroll through the loaded history; the Footprint panel shows the latest 24 bars.
- The engine calculates cumulative delta, adjacent and stacked imbalance candidates, repeated swing-high/low liquidity pools, and price sweeps/reclaims. Absorption and exhaustion are emitted only when aggressor-side volume is known; they are not inferred from unclassified OTC quotes.
- The API retains the latest 1,000,000 events in memory for analysis; the append-only JSONL file is the durable raw archive.

## Volume and footprint semantics

RoboForex XAUUSD is an OTC/CFD instrument, not centralized COMEX futures. The bridge forwards the broker's `tickVolume`, `realVolume`, and MT5 tick flags. Bid/Ask aggressor volume is populated only when MT5 supplies explicit BUY/SELL tick flags. If the broker does not supply those flags, activity is kept in the `unknown` bucket; the engine does not invent bid/ask volume or present quote updates as exchange trades. For unknown-side quote ticks, the engine counts one tick of activity rather than repeatedly adding a broker's last-known volume field.

The 30-day request means "up to the history available from the broker/terminal". It cannot guarantee the broker has a complete month of tick history. Check returned `tickCount`, gaps, and feed age before treating the chart as complete.

## Operational notes

- The EA must be compiled in MetaEditor; compilation cannot be performed by GitHub CI.
- MT5 WebRequest requires the API origin to be explicitly allowlisted.
- The default `127.0.0.1` configuration is for MT5 and API running on the same machine. For one shared feed for all users, deploy one API instance on a server, put it behind HTTPS, and set both EA URLs to that server's HTTPS endpoints. Restrict ingestion with firewall/network rules and the bearer token; never expose an unencrypted ingestion endpoint publicly.
- This bridge sends market data only; it does not place, modify, or close trades.
