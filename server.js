import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS = 5000;
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const positive = n => Number.isFinite(n) && n > 0;
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''; let bytes = 0;
    req.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BODY_BYTES) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; } body += chunk; });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('Body must be valid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function tokenMatches(header, token) {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)); const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function normalizeMt5(input) {
  if (input?.source !== 'mt5' || typeof input.symbol !== 'string' || !input.symbol.trim() || !validTimestamp(input.timestamp) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !positive(input.bid) || !positive(input.ask) || input.ask < input.bid || !positive(input.last) || !Number.isFinite(input.tickVolume) || input.tickVolume < 0 || !Number.isFinite(input.realVolume) || input.realVolume < 0) throw Object.assign(new Error('Invalid MT5 tick. Required: source, symbol, ISO timestamp, positive sequence, bid, ask, last, tickVolume and realVolume.'), { status: 422 });
  return { type: 'quote', source: 'mt5', venue: 'broker_otc', symbol: input.symbol.trim().toUpperCase(), timestamp: new Date(input.timestamp).toISOString(), sequence: input.sequence, bid: input.bid, ask: input.ask, last: input.last, tickVolume: input.tickVolume, realVolume: input.realVolume, volumeKind: 'broker_tick_or_reported_volume' };
}
function normalizeComex(input) {
  if (input?.source !== 'comex' || typeof input.symbol !== 'string' || !input.symbol.trim() || !validTimestamp(input.timestamp) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || typeof input.tradeId !== 'string' || !input.tradeId.trim() || !positive(input.price) || !positive(input.size) || !['buy','sell','unknown'].includes(input.aggressorSide)) throw Object.assign(new Error('Invalid COMEX trade. Required: source, symbol, ISO timestamp, positive sequence, tradeId, price, size and aggressorSide.'), { status: 422 });
  return { type: 'trade', source: 'comex', venue: 'comex_futures', symbol: input.symbol.trim().toUpperCase(), timestamp: new Date(input.timestamp).toISOString(), sequence: input.sequence, tradeId: input.tradeId.trim(), price: input.price, size: input.size, aggressorSide: input.aggressorSide, volumeKind: 'exchange_trade_size' };
}

export function createMarketServer({ token = process.env.MARKET_INGEST_TOKEN, now = () => Date.now(), staleAfterMs = 15000 } = {}) {
  const events = []; const lastSequence = new Map(); const feeds = new Map(); const clients = new Set();
  function health() {
    const at = now();
    return { status: 'ok', ingestConfigured: Boolean(token), eventCount: events.length, feeds: [...feeds.values()].map(feed => ({ ...feed, ageMs: Math.max(0, at - feed.receivedAt), status: at - feed.receivedAt <= staleAfterMs ? 'online' : 'stale' })) };
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, health());
    if (req.method === 'GET' && url.pathname === '/v1/market/snapshot') {
      const symbol = url.searchParams.get('symbol')?.toUpperCase(); const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      const selected = events.filter(e => !symbol || e.symbol === symbol).slice(-limit);
      return json(res, 200, { count: selected.length, events: selected });
    }
    if (req.method === 'GET' && url.pathname === '/v1/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('event: ready\ndata: {"status":"connected"}\n\n'); clients.add(res);
      res.on('close', () => clients.delete(res)); return;
    }
    const routes = { '/v1/ingest/mt5/tick': normalizeMt5, '/v1/ingest/comex/trade': normalizeComex };
    const normalize = routes[url.pathname];
    if (req.method !== 'POST' || !normalize) return json(res, 404, { error: 'not_found' });
    if (!token) return json(res, 503, { error: 'ingest_not_configured', message: 'Set MARKET_INGEST_TOKEN before accepting market events.' });
    if (!tokenMatches(req.headers.authorization, token)) return json(res, 401, { error: 'unauthorized' });
    try {
      const event = normalize(await readJson(req));
      const key = event.source + ':' + event.symbol; const previous = lastSequence.get(key) || 0;
      if (event.sequence <= previous) return json(res, 409, { error: 'sequence_not_increasing', lastAcceptedSequence: previous });
      lastSequence.set(key, event.sequence);
      const receivedAt = now(); const stored = { ...event, receivedAt: new Date(receivedAt).toISOString() };
      events.push(stored); if (events.length > MAX_EVENTS) events.shift();
      const existing = feeds.get(key); feeds.set(key, { source: event.source, symbol: event.symbol, lastSequence: event.sequence, receivedAt, accepted: (existing?.accepted || 0) + 1 });
      const packet = 'event: market\ndata: ' + JSON.stringify(stored) + '\n\n';
      for (const client of clients) client.write(packet);
      return json(res, 202, { accepted: true, event: stored });
    } catch (error) { return json(res, error.status || 400, { error: error.status === 422 ? 'invalid_event' : 'invalid_request', message: error.message }); }
  });
  return { server, health };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.MARKET_INGEST_TOKEN) { process.stderr.write('MARKET_INGEST_TOKEN is required. Copy .env.example and set a long random token.\n'); process.exit(1); }
  const { server } = createMarketServer(); const port = Number(process.env.PORT || 8787); const host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => process.stdout.write('GOLD-3Po Market Data API listening on http://' + host + ':' + port + '\n'));
  const stop = () => server.close(() => process.exit(0)); process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
