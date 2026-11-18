import { createServer } from 'node:http';
import { readFile, appendFile, mkdir } from 'node:fs/promises';
import { createHash, timingSafeEqual } from 'node:crypto';
import { runBacktest } from './backtest-engine.js';
import { generateSignals, attachWalkForwardCalibration } from './strategy-engine.js';
import { calculateRiskPlan } from './risk-engine.js';
import { pathToFileURL } from 'node:url';
import { dirname } from 'node:path';
import { buildMarketAnalysis } from './market-engine.js';

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_EVENTS = 1000000;
const STATIC_FILES = { '/': ['index.html', 'text/html; charset=utf-8'], '/index.html': ['index.html', 'text/html; charset=utf-8'], '/app.js': ['app.js', 'text/javascript; charset=utf-8'], '/market-data.js': ['market-data.js', 'text/javascript; charset=utf-8'], '/market-client.js': ['market-client.js', 'text/javascript; charset=utf-8'], '/research-client.js': ['research-client.js', 'text/javascript; charset=utf-8'], '/market-engine.js': ['market-engine.js', 'text/javascript; charset=utf-8'], '/styles.css': ['styles.css', 'text/css; charset=utf-8'] };
const json = (res, status, body) => { res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
const positive = n => Number.isFinite(n) && n > 0;
const validTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = ''; let bytes = 0; let tooLarge = false;
    req.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_BODY_BYTES) { tooLarge = true; return; } if (!tooLarge) body += chunk; });
    req.on('end', () => { if (tooLarge) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); return; } try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('Body must be valid JSON'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function tokenMatches(header, token) {
  if (!token || !header?.startsWith('Bearer ')) return false;
  const supplied = Buffer.from(header.slice(7)); const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
function eventFingerprint(event) {
  const fields = event.source === 'comex'
    ? [event.source,event.symbol,event.tradeId]
    : [event.source,event.symbol,event.timestamp,event.bid,event.ask,event.last,event.tickVolume,event.realVolume,event.flags,event.sequence];
  return createHash('sha256').update(fields.map(value => String(value ?? '')).join('|')).digest('hex');
}
function normalizeMt5(input) {
  if (input?.source !== 'mt5' || typeof input.symbol !== 'string' || !input.symbol.trim() || !validTimestamp(input.timestamp) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || !positive(input.bid) || !positive(input.ask) || input.ask < input.bid || !positive(input.last) || !Number.isFinite(input.tickVolume) || input.tickVolume < 0 || !Number.isFinite(input.realVolume) || input.realVolume < 0) throw Object.assign(new Error('Invalid MT5 tick. Required: source, symbol, ISO timestamp, positive sequence, bid, ask, last, tickVolume and realVolume.'), { status: 422 });
  return { type: 'quote', source: 'mt5', venue: 'broker_otc', symbol: input.symbol.trim().toUpperCase(), timestamp: new Date(input.timestamp).toISOString(), sequence: input.sequence, eventId: typeof input.eventId === 'string' && input.eventId.length <= 160 ? input.eventId : '', bid: input.bid, ask: input.ask, last: input.last, tickVolume: input.tickVolume, realVolume: input.realVolume, aggressorSide: ['buy','sell'].includes(input.aggressorSide) ? input.aggressorSide : (Number.isInteger(input.flags) && (input.flags & 32) ? 'buy' : Number.isInteger(input.flags) && (input.flags & 64) ? 'sell' : 'unknown'), flags: Number.isInteger(input.flags) ? input.flags : 0, volumeKind: 'broker_tick_or_reported_volume' };
}
function normalizeComex(input) {
  if (input?.source !== 'comex' || typeof input.symbol !== 'string' || !input.symbol.trim() || !validTimestamp(input.timestamp) || !Number.isSafeInteger(input.sequence) || input.sequence < 1 || typeof input.tradeId !== 'string' || !input.tradeId.trim() || !positive(input.price) || !positive(input.size) || !['buy','sell','unknown'].includes(input.aggressorSide)) throw Object.assign(new Error('Invalid COMEX trade. Required: source, symbol, ISO timestamp, positive sequence, tradeId, price, size and aggressorSide.'), { status: 422 });
  return { type: 'trade', source: 'comex', venue: 'comex_futures', symbol: input.symbol.trim().toUpperCase(), timestamp: new Date(input.timestamp).toISOString(), sequence: input.sequence, eventId: 'COMEX-' + input.tradeId.trim(), tradeId: input.tradeId.trim(), price: input.price, size: input.size, aggressorSide: input.aggressorSide, volumeKind: 'exchange_trade_size' };
}

export function createMarketServer({ token = process.env.MARKET_INGEST_TOKEN, now = () => Date.now(), staleAfterMs = 15000, storageFile = process.env.MARKET_DATA_FILE || './data/market-events.jsonl' } = {}) {
  const events = []; const lastSequence = new Map(); const feeds = new Map(); const clients = new Set(); const seenEventIds = new Set();
  const dataFile = storageFile;
  const storageReady = dataFile ? (async () => {
    try {
      const raw = await readFile(dataFile, 'utf8');
      for (const line of raw.split('\\n')) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          events.push(event);
          const eventId = event.eventId || eventFingerprint(event);
          seenEventIds.add(eventId);
          const key = event.source + ':' + event.symbol;
          if (!event.historical) lastSequence.set(key, Math.max(lastSequence.get(key) || 0, event.sequence || 0));
          const receivedAt = Date.parse(event.receivedAt) || Date.now();
          const existing = feeds.get(key);
          feeds.set(key, { source:event.source, symbol:event.symbol, lastSequence:!event.historical ? event.sequence : (existing?.lastSequence || 0), receivedAt, accepted:(existing?.accepted || 0)+1 });
        } catch {}
      }
      if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  })() : Promise.resolve();
  async function persistMany(storedEvents) { if (!dataFile || !storedEvents.length) return; await mkdir(dirname(dataFile), { recursive:true }); await appendFile(dataFile, storedEvents.map(event => JSON.stringify(event)).join('\n')+'\n'); }
  async function persist(stored) { return persistMany([stored]); }
  function health() {
    const at = now();
    return { status: 'ok', ingestConfigured: Boolean(token), durableStorage: Boolean(dataFile), eventCount: events.length, memoryLimit: MAX_EVENTS, connectedStreams: clients.size, feeds: [...feeds.values()].map(feed => ({ ...feed, ageMs: Math.max(0, at - feed.receivedAt), status: at - feed.receivedAt <= staleAfterMs ? 'online' : 'stale' })) };
  }
  const server = createServer(async (req, res) => {
    await storageReady;
    const url = new URL(req.url || '/', 'http://localhost');
    const asset = STATIC_FILES[url.pathname];
    if (req.method === 'GET' && asset) { try { const content = await readFile(new URL('./' + asset[0], import.meta.url)); res.writeHead(200, { 'content-type': asset[1], 'cache-control': 'no-cache' }); res.end(content); return; } catch { return json(res, 500, { error: 'asset_read_failed' }); } }
    if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, health());
    if (req.method === 'GET' && url.pathname === '/v1/market/snapshot') {
      const symbol = url.searchParams.get('symbol')?.toUpperCase(); const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
      const selected = events.filter(e => !symbol || e.symbol === symbol).slice(-limit);
      return json(res, 200, { count: selected.length, events: selected });
    }
    if (req.method === 'GET' && url.pathname === '/v1/market/analysis') {
      const symbol = (url.searchParams.get('symbol') || 'XAUUSD').toUpperCase();
      const intervalMs = Math.min(86400000, Math.max(60000, Number(url.searchParams.get('intervalMs') || 900000)));
      const priceStep = Math.min(100, Math.max(0.001, Number(url.searchParams.get('priceStep') || 0.1)));
      const selected = events.filter(e => e.symbol === symbol && e.source === 'mt5');
      return json(res, 200, { symbol, ...buildMarketAnalysis(selected, { intervalMs, priceStep }), feed: health().feeds.find(f => f.source === 'mt5' && f.symbol === symbol) || null });
    }
    if (req.method === 'GET' && url.pathname === '/v1/market/replay') {
      const symbol = (url.searchParams.get('symbol') || 'XAUUSD').toUpperCase();
      const intervalMs = Math.min(86400000, Math.max(60000, Number(url.searchParams.get('intervalMs') || 900000)));
      const priceStep = Math.min(100, Math.max(0.001, Number(url.searchParams.get('priceStep') || 0.1)));
      const from = url.searchParams.get('from'), to = url.searchParams.get('to');
      const fromMs = from ? Date.parse(from) : -Infinity, toMs = to ? Date.parse(to) : Infinity;
      if ((from && !Number.isFinite(fromMs)) || (to && !Number.isFinite(toMs)) || fromMs > toMs) return json(res, 400, { error: 'invalid_replay_range' });
      const selected = events.filter(e => e.source === 'mt5' && e.symbol === symbol && Date.parse(e.timestamp) >= fromMs && Date.parse(e.timestamp) <= toMs).sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
      return json(res, 200, { symbol, from: from || null, to: to || null, eventCount: selected.length, replayLimit: 20000, ...buildMarketAnalysis(selected, { intervalMs, priceStep, limit: 20000 }) });
    }
    if (req.method === 'GET' && url.pathname === '/v1/market/backtest') {
      const symbol = (url.searchParams.get('symbol') || 'XAUUSD').toUpperCase();
      const intervalMs = Math.min(86400000, Math.max(60000, Number(url.searchParams.get('intervalMs') || 900000)));
      const priceStep = Math.min(100, Math.max(0.001, Number(url.searchParams.get('priceStep') || 0.1)));
      const selected = events.filter(e => e.source === 'mt5' && e.symbol === symbol);
      const analysis = buildMarketAnalysis(selected, { intervalMs, priceStep, limit: 20000 });
      const options = {
        initialEquity: Number(url.searchParams.get('initialEquity') || 10000),
        riskPct: Number(url.searchParams.get('riskPct') || 0.5),
        maxRiskPct: Number(url.searchParams.get('maxRiskPct') || 1),
        stopAtr: Number(url.searchParams.get('stopAtr') || 1.5),
        targetR: Number(url.searchParams.get('targetR') || 2),
        maxBars: Number(url.searchParams.get('maxBars') || 20),
        pointValue: Number(url.searchParams.get('pointValue') || 1),
        feePerUnit: Number(url.searchParams.get('feePerUnit') || 0),
        slippage: Number(url.searchParams.get('slippage') || 0)
      };
      try { return json(res, 200, { symbol, bars: analysis.bars.length, ...runBacktest(analysis.bars, options) }); }
      catch (error) { return json(res, 422, { error: 'invalid_backtest', message: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/v1/market/signals') {
      const symbol = (url.searchParams.get('symbol') || 'XAUUSD').toUpperCase();
      const intervalMs = Math.min(86400000, Math.max(60000, Number(url.searchParams.get('intervalMs') || 900000)));
      const selected = events.filter(e => e.source === 'mt5' && e.symbol === symbol);
      const analysis = buildMarketAnalysis(selected, { intervalMs, priceStep: 0.1, limit: 20000 });
      const signals = generateSignals(analysis.bars);
      const simulation = runBacktest(analysis.bars);
      const calibrated = attachWalkForwardCalibration(signals, simulation.trades);
      return json(res, 200, { symbol, signals: calibrated.slice(-50), latest: calibrated.at(-1) || null, calibration: { method: 'chronological walk-forward historical win rate with Laplace prior', minimumSamples: 30, calibratedSignals: calibrated.filter(s=>s.probability!==null).length }, caveat: 'Technical scores are rule-based evidence weights, not probabilities. Probability is withheld until 30 prior same-direction trades have closed.' });
    }
    if (req.method === 'GET' && url.pathname === '/v1/risk/plan') {
      const params = Object.fromEntries(url.searchParams.entries());
      try { return json(res, 200, calculateRiskPlan(params)); }
      catch (error) { return json(res, 422, { error: 'invalid_risk_plan', message: error.message }); }
    }
    if (req.method === 'GET' && url.pathname === '/v1/stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
      res.write('event: ready\ndata: {"status":"connected"}\n\n'); clients.add(res);
      res.on('close', () => clients.delete(res)); return;
    }
    if (req.method === 'POST' && url.pathname === '/v1/ingest/mt5/live-batch') {
      if (!token) return json(res, 503, { error: 'ingest_not_configured' });
      if (!tokenMatches(req.headers.authorization, token)) return json(res, 401, { error: 'unauthorized' });
      try {
        const body = await readJson(req);
        if (body?.source !== 'mt5' || !Array.isArray(body.ticks) || body.ticks.length < 1 || body.ticks.length > 1000 || typeof body.symbol !== 'string') return json(res, 422, { error:'invalid_live_batch', message:'Expected 1..1000 MT5 ticks and a symbol.' });
        const key = 'mt5:' + body.symbol.trim().toUpperCase();
        let sequenceCursor = lastSequence.get(key) || 0;
        let duplicates = 0;
        const additions = [];
        for (const raw of body.ticks) {
          const event = normalizeMt5({ ...raw, source:'mt5', symbol:body.symbol });
          const eventId = event.eventId || eventFingerprint(event);
          if (seenEventIds.has(eventId)) { duplicates++; continue; }
          if (event.sequence <= sequenceCursor) return json(res, 409, { error:'sequence_not_increasing', lastAcceptedSequence:sequenceCursor });
          sequenceCursor = event.sequence;
          additions.push({ ...event, eventId, receivedAt:new Date(now()).toISOString() });
        }
        await persistMany(additions);
        for (const stored of additions) {
          seenEventIds.add(stored.eventId);
          events.push(stored);
          if (events.length > MAX_EVENTS) events.shift();
          const existing = feeds.get(key);
          feeds.set(key,{source:'mt5',symbol:stored.symbol,lastSequence:stored.sequence,receivedAt:Date.parse(stored.receivedAt),accepted:(existing?.accepted||0)+1});
          const packet = `event: market\\ndata: ${JSON.stringify(stored)}\\n\\n`;
          for (const client of clients) client.write(packet);
        }
        if (additions.length) lastSequence.set(key, sequenceCursor);
        return json(res, 202, { accepted:additions.length, duplicates, total:body.ticks.length, lastAcceptedSequence:lastSequence.get(key)||0 });
      } catch(error) { return json(res,error.status||422,{error:'invalid_live_batch',message:error.message}); }
    }
    if (req.method === 'POST' && url.pathname === '/v1/ingest/mt5/history') {
      if (!token) return json(res, 503, { error: 'ingest_not_configured' });
      if (!tokenMatches(req.headers.authorization, token)) return json(res, 401, { error: 'unauthorized' });
      try {
        const body = await readJson(req);
        if (body?.source !== 'mt5' || !Array.isArray(body.ticks) || body.ticks.length < 1 || body.ticks.length > 1000) return json(res, 422, { error: 'invalid_history_batch', message: 'Expected 1..1000 MT5 ticks.' });
        let accepted = 0; let duplicates = 0; let rejected = 0;
        for (const raw of body.ticks) {
          try {
            const event = normalizeMt5({ ...raw, source:'mt5', symbol:body.symbol || raw.symbol });
            const eventId = event.eventId || eventFingerprint(event);
            if (seenEventIds.has(eventId)) { duplicates++; continue; }
            const key = event.source + ':' + event.symbol;
            const receivedAt = now();
            const stored = { ...event, eventId, receivedAt:new Date(receivedAt).toISOString(), historical:true };
            await persist(stored);
            seenEventIds.add(eventId);
            events.push(stored);
            if(events.length>MAX_EVENTS) events.shift();
            const existing = feeds.get(key);
            feeds.set(key,{source:event.source,symbol:event.symbol,lastSequence:existing?.lastSequence||0,receivedAt,accepted:(existing?.accepted||0)+1});
            const packet = `event: market\\ndata: ${JSON.stringify(stored)}\\n\\n`;
            for (const client of clients) client.write(packet);
            accepted++;
          } catch { rejected++; }
        }
        return json(res,202,{accepted,duplicates,rejected,total:body.ticks.length});
      } catch(error) { return json(res,error.status||400,{error:'invalid_request',message:error.message}); }
    }
    const routes = { '/v1/ingest/mt5/tick': normalizeMt5, '/v1/ingest/comex/trade': normalizeComex };
    const normalize = routes[url.pathname];
    if (req.method !== 'POST' || !normalize) return json(res, 404, { error: 'not_found' });
    if (!token) return json(res, 503, { error: 'ingest_not_configured', message: 'Set MARKET_INGEST_TOKEN before accepting market events.' });
    if (!tokenMatches(req.headers.authorization, token)) return json(res, 401, { error: 'unauthorized' });
    try {
      const event = normalize(await readJson(req));
      const eventId = event.eventId || eventFingerprint(event);
      if (seenEventIds.has(eventId)) return json(res, 409, { error: 'duplicate_event', eventId });
      const key = event.source + ':' + event.symbol;
      const previous = lastSequence.get(key) || 0;
      if (event.sequence <= previous) return json(res, 409, { error: 'sequence_not_increasing', lastAcceptedSequence: previous });
      const receivedAt = now();
      const stored = { ...event, eventId, receivedAt: new Date(receivedAt).toISOString() };
      await persist(stored);
      seenEventIds.add(eventId);
      lastSequence.set(key, event.sequence);
      events.push(stored);
      if (events.length > MAX_EVENTS) events.shift();
      const existing = feeds.get(key);
      feeds.set(key, { source:event.source, symbol:event.symbol, lastSequence:event.sequence, receivedAt, accepted:(existing?.accepted||0)+1 });
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
