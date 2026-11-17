# GOLD-3Po — Part 01: Liquidity & Footprint Workspace

Standalone, dependency-free UI prototype for a dedicated XAUUSD analysis window. Visual direction takes cues from Vesper's dark, atmospheric, high-contrast product presentation; it does not copy branding or assets.

## Run
```bash
npm test
npm run serve
```
Open http://localhost:4173.

## Part 01
- Price chart with buy-side and sell-side liquidity-zone overlays.
- Footprint matrix: Bid × Ask, Delta and Volume modes.
- Click/keyboard bar selection and synchronized inspector.
- Liquidity-zone list with relative intensity and metadata.
- Responsive desktop/tablet/mobile layout.
- Deterministic simulated fixtures; no broker/exchange connection.

## Five-part implementation plan
1. **Workspace UI (this branch):** dedicated chart, liquidity zones, footprint display, responsive controls and demo fixtures.
2. **Market data adapters:** typed event contract, MT5 XAUUSD adapter, COMEX GC adapter, timestamp normalization, feed health and reconnect handling.
3. **Market calculations:** volume-at-price aggregation, footprint delta/imbalance, liquidity-zone lifecycle, sweeps/reclaims and event provenance.
4. **Historical research:** event storage, deterministic replay, historical pattern memory, MAE/MFE and realistic backtesting.
5. **Probability and operations:** calibrated models, signal fusion, risk gate, alerts, monitoring and deployment.

## Data semantics
The current footprint is a UI fixture, not real exchange Bid/Ask volume. Zone bands are illustrative estimates, not confirmed stop orders. Part 02 must supply actual feed semantics and licensing before connecting live data.
