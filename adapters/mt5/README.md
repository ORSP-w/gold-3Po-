# MT5 bridge setup

1. Start the GOLD-3Po API on the same machine as the MT5 terminal, or on a reachable private host.
2. Set `MARKET_INGEST_TOKEN` in the server environment and start the API.
3. In MT5, open **Tools → Options → Expert Advisors** and allow the exact URL `http://127.0.0.1:8787/v1/ingest/mt5/tick` (change host/port if configured differently).
4. Open `Gold3PoBridge.mq5` in MetaEditor, compile it, attach the Expert Advisor to the desired XAUUSD chart and enter the same token in its inputs.
5. Check `GET /health`; the MT5 feed should appear after the first accepted tick.

The bridge emits broker quotes. `tickVolume` and `realVolume` are the fields reported by that broker; neither is automatically equivalent to COMEX centralized traded volume. A sequence counter is seeded from UTC epoch time so a normal EA restart does not reset it behind the API's last accepted sequence.

If MT5 runs on another machine, do not expose the unauthenticated HTTP listener to the public internet. Put it behind TLS and network access controls first.
