# COMEX trade adapter contract

This folder documents the normalized input contract for a licensed COMEX GC futures trade feed. It is **not** a live CME/COMEX connector: no vendor, credentials, entitlement, or exchange connection was supplied, so none is fabricated here.

A provider-specific adapter must:
1. Obtain exchange-authorized GC trade events from the selected vendor.
2. Preserve the vendor's event timestamp, contract month, unique trade ID, sequence number, price, trade size and aggressor side.
3. Convert vendor units without rounding away fractional size.
4. POST one normalized JSON event to `POST /v1/ingest/comex/trade` with `Authorization: Bearer <MARKET_INGEST_TOKEN>`.

Example:
```json
{
  "source": "comex",
  "symbol": "GCZ6",
  "timestamp": "2026-11-17T15:00:00.000Z",
  "sequence": 10001,
  "tradeId": "provider-unique-trade-id",
  "price": 2650.1,
  "size": 2,
  "aggressorSide": "buy"
}
```

Allowed `aggressorSide`: `buy`, `sell`, or `unknown`. If the provider does not expose aggressor side, send `unknown`; never infer it from candle direction. The server rejects duplicate or out-of-order sequence numbers per source and symbol.

The MT5 adapter reports broker quotes and broker-reported volume. It must not be merged with COMEX trade volume as if both represented the same market.
