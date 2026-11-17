# GOLD-3Po — Market Lab

## Current implementation
- **Part 01 — Liquidity & Footprint Workspace:** responsive chart, liquidity overlays, footprint modes, synchronized bar inspector and working zone selection.
- **Part 02 — Market Data Engine:** authenticated HTTP ingestion API, normalized MT5 quote events, normalized COMEX trade contract, bounded event buffer, snapshot endpoint, SSE stream, feed health and sequence validation. MT5 Expert Advisor bridge included.

## Run
Requires Node.js 20 or newer. No npm dependencies.

```bash
cp .env.example .env
# Set MARKET_INGEST_TOKEN to a long random secret in your environment.
npm test
npm run check
npm start
``

The API and market workspace UI are served from the same origin at http://127.0.0.1:8787 by default. Open that URL after `npm start`; the browser subscribes to the SSE feed and displays API/MT5/COMEX health. The separate `npm run serve` command is only a static preview and does not include the live API. Configure MT5 WebRequest to allow the exact ingest URL shown in `adapters/mt5/README.md`. Set `HOST=0.0.0.0` only behind a firewall/reverse proxy with TLS.

## Part 02 endpoints
- `GET /health` — configured state, event count, per-feed age and stale/online status.
- `POST /v1/ingest/mt5/tick` — authenticated broker quote event.
- `POST /v1/ingest/comex/trade` — authenticated normalized exchange trade.
- `GET /v1/market/snapshot?symbol=XAUUSD&limit=100` — latest bounded event history.
- `GET /v1/stream` — server-sent market event stream.

Every ingest request requires `Authorization: Bearer <MARKET_INGEST_TOKEN>`. Duplicate and out-of-order sequence numbers are rejected. The API keeps at most 5,000 recent events in memory; this is not durable storage.

## Market-data semantics and limitations
MT5 delivers broker OTC quotes. Its tick/real-volume fields are broker-reported and must not be represented as centralized exchange volume. The COMEX endpoint accepts a licensed vendor's normalized GC trade events; it is **not** a live CME connection. A provider, credentials and exchange market-data entitlement are required before a production COMEX adapter can be implemented. Unknown aggressor side must remain `unknown`, not inferred from candle direction.

The browser UI still displays clearly marked deterministic demo fixtures until a later integration step connects it to this API. No trading, order routing or signal generation is implemented.

## Five-part plan
1. Workspace UI and interaction verification.
2. Market data transport and source adapters.
3. Footprint aggregation, imbalance and liquidity-zone calculations.
4. Historical event storage, replay and backtesting.
5. Calibrated probability models, risk controls, alerts and operations.

## Quality gates
Every part must pass existing tests plus new tests, JavaScript syntax checks, API contract tests and a manual/browser visual review before it is called complete. Controls that have no implemented action are removed rather than shown as decorative buttons.
