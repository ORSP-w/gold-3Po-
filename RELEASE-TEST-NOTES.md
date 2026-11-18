# GOLD-3Po v0.3.0 — Electron Windows installer test

## Install and launch

1. Download `GOLD-3Po-Setup-*.exe` from the latest GitHub pre-release.
2. Run the setup wizard. This is a per-user install and does not require administrator rights.
3. Leave the launch option enabled or start **GOLD-3Po Market Lab** from the desktop shortcut or Start Menu.
4. The application opens in its own Electron window. It starts its local market API on `127.0.0.1:8787`.

The application bundles Electron and its Chromium runtime. A separate Node.js installation, browser window, PowerShell command or ZIP extraction is not required.

Settings are stored in `%APPDATA%\GOLD-3Po Market Lab\settings.json`. The local market archive is stored in `%APPDATA%\GOLD-3Po Market Lab\market-events.jsonl`. These files are outside the installation folder and are retained when the application is updated or uninstalled.

## Connect RoboForex MT5

1. Start **GOLD-3Po Market Lab** and keep it running.
2. In MT5, open **Tools → Options → Expert Advisors** and allow WebRequest to `http://127.0.0.1:8787`.
3. Open the installed EA source at `resources\adapters\mt5\Gold3PoBridge.mq5` in the GOLD-3Po installation directory using MetaEditor. Press F7 to compile.
4. Open `%APPDATA%\GOLD-3Po Market Lab\settings.json` in Notepad and copy the value of `marketIngestToken`.
5. Attach the EA to the RoboForex XAUUSD chart. In EA Inputs, paste the copied value into `IngestToken`.
6. Confirm `http://127.0.0.1:8787/health` reports the MT5 feed and the chart transitions from demo fixtures to broker history/live data.

The EA is data-only. It cannot place or manage orders. Keep it on a demo account for the initial test.

## What to check

- The main desktop window opens without an external browser.
- API, MT5 and COMEX connection indicators reflect feed status.
- Chart and footprint update as broker ticks arrive.
- Replay loads a date range, plays, pauses, and returns to live view.
- Backtesting reports trades and metrics when qualifying historical setups exist.
- Risk plan blocks risk above 1% and reward/risk below 1.5:1.
- After closing and reopening the app, imported market history remains available.

An empty replay or zero backtest trades can be a valid result when there is not enough available broker history or no qualifying liquidity-sweep setup.

## Important limits

- The first screen can show clearly labelled demo fixtures until broker data arrives.
- RoboForex XAUUSD is OTC/CFD data. It is not centralized COMEX trade flow or exchange volume.
- Real COMEX flow requires a separately licensed provider adapter and entitlement; a live CME feed is not bundled.
- MetaEditor compilation and a real RoboForex feed have not been verified by CI. Confirm those in your own terminal.
- The installer is not digitally code-signed, so Windows SmartScreen may show an unknown-publisher warning.
- Do not use this research build as financial advice or for automated execution. It does not route orders.
