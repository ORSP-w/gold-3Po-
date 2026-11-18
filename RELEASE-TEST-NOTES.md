# GOLD-3Po v0.2.0 — Windows installer test

## Install and run

1. Download `GOLD-3Po-Setup-*.exe` from the latest **Pre-release** in the repository's GitHub Releases page.
2. Double-click the installer and complete the Russian-language setup wizard. The default location is `%LOCALAPPDATA%\Programs\GOLD-3Po`. No administrator rights are required.
3. Leave **Запустить GOLD-3Po** checked at the end of setup. The application starts in the background and opens `http://127.0.0.1:8787` in your browser.
4. Later, start it from the desktop shortcut or Start Menu. Use **Stop GOLD-3Po** in the Start Menu to stop the local server.

Node.js 22 x64 is bundled inside the installer. You do not need to install Node.js, open PowerShell, unpack a ZIP, or run npm commands.

The installer creates a random `MARKET_INGEST_TOKEN` in `%LOCALAPPDATA%\Programs\GOLD-3Po\.env` on first launch. Market events are stored in `%LOCALAPPDATA%\Programs\GOLD-3Po\data\market-events.jsonl`. Updating the app preserves `.env` and the data archive. Uninstalling stops the server; the generated `.env` and `data` folder are retained.

If the app does not open, check whether another program is already using local port `8787`. Startup details are written to the install folder's `logs` directory.

## Connect RoboForex MT5

1. Log into your RoboForex **demo** account in MetaTrader 5 and open the broker's XAUUSD chart.
2. In MT5 go to **Tools → Options → Expert Advisors** and allow WebRequest to `http://127.0.0.1:8787`.
3. Open `%LOCALAPPDATA%\Programs\GOLD-3Po\adapters\mt5\Gold3PoBridge.mq5` in MetaEditor and press F7 to compile.
4. Open `%LOCALAPPDATA%\Programs\GOLD-3Po\.env` in Notepad and copy the value after `MARKET_INGEST_TOKEN=`.
5. Attach the EA to XAUUSD. In the EA Inputs, paste that value into `IngestToken`.
6. Confirm `http://127.0.0.1:8787/health` shows the MT5 feed and that the chart transitions from demo fixture to broker history/live data.

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
- The installer currently is not digitally code-signed, so Windows SmartScreen may show an unknown-publisher warning.
- Do not use the test build as financial advice or for automated execution. It does not route orders.

See `README.md` and `adapters/mt5/README.md` for API and data semantics.
