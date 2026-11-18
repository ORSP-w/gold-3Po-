# GOLD-3Po — Market Lab

GOLD-3Po is a read-only market-structure research workspace. It does not route, place, modify or close trades.

## Implemented parts

1. **Liquidity & Footprint workspace:** interactive OHLC chart, repeated swing-high/low liquidity zones, Bid × Ask / Delta / Volume footprint modes, bar inspector, selection and reset.
2. **Market data transport:** authenticated MT5 tick and history ingestion, sequenced live batches, COMEX normalized trade contract, SSE, health checks and append-only JSONL persistence.
3. **Market engine:** OHLC aggregation, price-level activity, Delta, Cumulative Delta, adjacent and stacked imbalance candidates, repeated liquidity pools, sweeps/reclaims, and conservative unknown-side handling.
4. **Historical research:** date-range replay, bar-by-bar playback, a rules-based backtester, ATR stops, R-multiple targets, conservative stop-first handling when stop and target are touched in the same candle.
5. **Decision support:** evidence-scored liquidity-sweep signals, walk-forward historical win-rate calibration, browser alerts, position sizing and risk guardrails.

## Run locally

Requires Node.js 22 LTS or newer. The application runtime has no npm dependencies.

```bash
cp .env.example .env
# Set MARKET_INGEST_TOKEN to a random secret of at least 24 characters.
npm test
npm run check
npm start
```

Open `http://127.0.0.1:8787`. The API and UI are served from the same origin. `npm run serve` starts a static preview only and does not provide the API.

## Windows test release

For a first local run, extract the test ZIP and launch `START-HERE-WINDOWS.ps1` with PowerShell. It creates a random local ingest token in `.env` and starts the application. Full setup, RoboForex MT5 connection and test checklist: `RELEASE-TEST-NOTES.md`.

The CI workflow packages `GOLD-3Po-v0.2.0-test.zip` only after unit tests, syntax checks and Chromium UI checks pass. It also creates a SHA-256 checksum and build manifest.

## API

All ingest endpoints require `Authorization: Bearer <MARKET_INGEST_TOKEN>`.

- `GET /health` — server, storage, feed freshness and active SSE clients.
- `POST /v1/ingest/mt5/tick` — single MT5 quote event.
- `POST /v1/ingest/mt5/live-batch` — ordered, idempotent live MT5 batch (used by the EA).
- `POST /v1/ingest/mt5/history` — historical MT5 batch; history event identity is separate from the live sequence.
- `POST /v1/ingest/comex/trade` — normalized exchange trade from a licensed data provider.
- `GET /v1/market/snapshot?symbol=XAUUSD&limit=100` — recent normalized events.
- `GET /v1/market/analysis?symbol=XAUUSD&source=mt5&intervalMs=900000` — footprint and liquidity analysis. `source` can be `mt5` or `comex`.
- `GET /v1/market/replay?symbol=XAUUSD&from=...&to=...` — historical bars for replay; supports `source=mt5|comex`.
- `GET /v1/market/backtest?symbol=XAUUSD&riskPct=0.5&pointValue=1` — historical simulation. Supports `source=mt5|comex`.
- `GET /v1/market/signals?symbol=XAUUSD` — latest evidence-scored setup and chronological calibration.
- `GET /v1/risk/plan?equity=10000&riskPct=0.5&entry=2650&stop=2645&target=2660&pointValue=1` — position size and risk checks.
- `GET /v1/stream` — server-sent event stream.

By default the API appends events to `./data/market-events.jsonl`, reloads that archive on restart, and retains the latest 1,000,000 events in memory for analysis. The JSONL archive is not automatically compacted. Plan disk retention and backup for a long-running production deployment.

## Interpretation and limits

**RoboForex XAUUSD:** this is broker OTC/CFD quote data. Its tick volume is not centralized exchange trade volume. The engine uses explicit MT5 aggressor flags only; otherwise ticks remain unclassified. Do not interpret the broker-derived footprint as a full exchange order-flow footprint.

**COMEX GC:** the ingestion and analysis contract works with normalized exchange trades, including actual trade size and provider-supplied aggressor side. This repository does not include a live CME/COMEX vendor connector. A licensed vendor, contract entitlement, credentials and provider-specific adapter must be selected before real exchange trades can be received. See `adapters/comex/README.md`.

**Backtesting:** signals are evaluated at candle close and entered at the next candle open. If one candle touches both stop and target, the simulator assumes the stop occurred first. P&L sizing uses the supplied `pointValue`; set it to the broker's actual instrument contract value. Defaults are research placeholders, not broker specifications. Fees and slippage can be supplied through API parameters.

**Signals and probabilities:** the technical score is an evidence-weighted heuristic, not a probability. The API withholds probability until at least 30 prior same-direction trades have closed. Thereafter it reports a walk-forward historical win rate with a Laplace prior; that statistic is not a guarantee or a forward-looking forecast. Validate out of sample before using it.

**Risk controls:** the planner blocks risk above the configured cap and reward/risk below the minimum. It calculates a plan only; there is no order execution or broker-side enforcement.

## Verification

`npm test` covers the market engine, replay/backtest/risk APIs, tick idempotency and UI contracts. `npm run check` checks JavaScript syntax. The GitHub Actions quality workflow additionally launches Chromium, checks UI controls and responsive overflow, and saves screenshots. MQL5 compilation and live RoboForex validation still require MetaEditor and an authenticated MT5 terminal.
