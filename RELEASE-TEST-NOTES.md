# GOLD-3Po v0.2.0 — test build

This is a source release for local evaluation. It is not a trading terminal installer and does not contain a compiled MT5 binary.

## Quick start — Windows

1. Install Node.js 22 LTS or newer.
2. Extract the ZIP into a normal writable folder (not Program Files).
3. Right-click `START-HERE-WINDOWS.ps1` and choose **Run with PowerShell**. If script execution is restricted, open PowerShell in this folder and run:
   `powershell -ExecutionPolicy Bypass -File .\START-HERE-WINDOWS.ps1`
4. Open `http://127.0.0.1:8787` in Chrome or Edge.
5. Leave the PowerShell window open while using the application. Press Ctrl+C to stop it.

The launcher creates `.env` automatically with a fresh random ingestion token. It does not require `npm install`; the app uses Node's built-in modules.

## Connect RoboForex MT5

1. Log into your RoboForex demo account in MetaTrader 5 and open the broker's XAUUSD chart.
2. In MT5 go to **Tools → Options → Expert Advisors** and allow WebRequest to `http://127.0.0.1:8787`.
3. Open `adapters/mt5/Gold3PoBridge.mq5` in MetaEditor and press F7 to compile.
4. Attach the EA to XAUUSD. In the EA Inputs, paste the same `MARKET_INGEST_TOKEN` value from the local `.env` file into `IngestToken`.
5. Confirm `/health` shows the MT5 feed and the chart transitions from demo fixture to broker history/live data.

The EA is data-only. It cannot place or manage orders. Keep it on a demo account for the initial test.

## What to check

- Chart and footprint update as new ticks arrive.
- API, MT5 and COMEX connection indicators reflect feed status.
- Replay loads a date range, plays, pauses, and returns to live view.
- Backtesting reports trades/metrics when qualifying historical setups exist.
- Risk plan blocks risk above 1% and reward/risk below 1.5:1.

An empty replay or zero backtest trades can be a valid result when there is not enough available broker history or no qualifying liquidity-sweep setup.

## Important limits

- The first screen can show clearly labelled demo fixtures until broker data arrives.
- RoboForex XAUUSD is OTC/CFD data. It is not centralized COMEX trade flow or exchange volume.
- Real COMEX flow requires a separately licensed provider adapter and entitlement; a live CME feed is not bundled.
- MetaEditor compilation and a real RoboForex feed have not been verified by CI. Confirm those in your own terminal.
- Do not use the test build as financial advice or for automated execution. It does not route orders.

See `README.md` and `adapters/mt5/README.md` for API and data semantics.
