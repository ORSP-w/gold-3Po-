import { createHash, randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname } from 'node:path';

// Pattern memory: every closed setup the strategy produced, remembered as a fingerprint
// so the same bar can be recalled and compared against later ones. A pattern observation
// holds only market facts — no tokens, keys, personal data or execution state — and is
// append-only once written: history is never rewritten to flatter a later result.

const finite = Number.isFinite;
const sides = ['long', 'short'];

export const MIN_CALIBRATION_SAMPLES = 30;
// The workspace's default timeframe: 15 minutes. Records persisted before intervalMs became part
// of the schema are migrated to this on load — an upgrade keeps the accumulated memory.
export const DEFAULT_INTERVAL_MS = 900000;

export function patternFingerprint(pattern) {
  const canonical = JSON.stringify([
    pattern.symbol, pattern.side, pattern.session,
    pattern.sweepReclaimed, pattern.rejection, pattern.closeEdge, pattern.stacked, pattern.deltaAgree,
    Number(pattern.bodyRatio).toFixed(3), Number(pattern.closeLocation).toFixed(3),
    Math.sign(pattern.delta), Number(pattern.volumeRatio).toFixed(2),
    Number(pattern.imbalanceCount), Number(pattern.stackCount)
  ]);
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

export function validatePattern(input) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('Pattern must be an object');
  // A pattern carrying its own fingerprint (round-tripped from the store or observationFrom) is
  // accepted and re-fingerprinted: the hash is always recomputed from the market facts, never trusted.
  const { fingerprint: providedFingerprint, ...rest } = input;
  if (providedFingerprint !== undefined && typeof providedFingerprint !== 'string') throw new TypeError('Pattern fingerprint must be a string when present');
  input = rest;
  for (const key of Object.keys(input)) {
    if (!['symbol','side','signalTime','signalIndex','session','barTime','intervalMs','atr','sweepLevel','entryIndex','exitIndex','exitTime','exitReason','netR','bodyRatio','closeLocation','volumeRatio','delta','deltaRatio','imbalanceCount','stackCount','sweepReclaimed','rejection','closeEdge','stacked','deltaAgree','pocShift'].includes(key)) throw new TypeError(`Unknown pattern field: ${key}`);
  }
  const p = { ...input };
  p.symbol = String(p.symbol || '').toUpperCase();
  if (!/^(?:XAUUSD|GOLD)[A-Z0-9._#+-]{0,20}$/.test(p.symbol) && !/^GC[A-Z0-9]*$/.test(p.symbol)) throw new TypeError('Pattern symbol must be gold (XAUUSD or GC futures)');
  if (!sides.includes(p.side)) throw new TypeError('Pattern side must be long or short');
  // The timeframe the pattern was observed at: a 5m shape is not an analogue of a 15m setup.
  p.intervalMs = Number(p.intervalMs);
  if (!Number.isInteger(p.intervalMs) || p.intervalMs < 60000 || p.intervalMs > 86400000) throw new TypeError('Pattern intervalMs must be an integer between 60000 and 86400000');
  const time = Date.parse(p.signalTime);
  if (!finite(time)) throw new TypeError('Pattern signalTime must be an ISO timestamp');
  p.signalTime = new Date(time).toISOString();
  for (const key of ['signalIndex', 'entryIndex', 'exitIndex']) {
    p[key] = Number(p[key]);
    if (!Number.isInteger(p[key]) || p[key] < 0 || p[key] > 100000) throw new TypeError(`Pattern ${key} must be an integer 0..100000`);
  }
  if (p.signalIndex > p.entryIndex || p.entryIndex > p.exitIndex) throw new TypeError('Pattern indices must be ordered signal <= entry <= exit');
  // When the outcome became known. Absolute, so out-of-sample checks survive window shifts.
  if (p.exitTime !== undefined && p.exitTime !== null && !finite(Date.parse(p.exitTime))) throw new TypeError('Pattern exitTime must be an ISO timestamp when present');
  p.exitTime = p.exitTime ? new Date(Date.parse(p.exitTime)).toISOString() : null;
  for (const key of ['atr', 'sweepLevel', 'netR', 'bodyRatio', 'closeLocation', 'volumeRatio', 'delta', 'deltaRatio', 'pocShift']) {
    p[key] = Number(p[key]);
    if (!finite(p[key])) throw new TypeError(`Pattern ${key} must be a number`);
  }
  if (p.pocShift === undefined) p.pocShift = 0;
  if (!(['target','stop','time'].includes(p.exitReason))) throw new TypeError('Pattern exitReason must be target, stop or time');
  for (const key of ['imbalanceCount', 'stackCount']) {
    p[key] = Number(p[key]);
    if (!Number.isInteger(p[key]) || p[key] < 0 || p[key] > 1000) throw new TypeError(`Pattern ${key} must be an integer 0..1000`);
  }
  for (const key of ['sweepReclaimed', 'rejection', 'closeEdge', 'stacked', 'deltaAgree']) {
    if (typeof p[key] !== 'boolean') throw new TypeError(`Pattern ${key} must be boolean`);
  }
  // Session bucket keeps the fingerprint comparable across days: Asia / London / New York.
  p.session = p.session === undefined ? sessionOf(time) : String(p.session);
  if (!['asia','london','newyork','offhours'].includes(p.session)) throw new TypeError('Pattern session must be asia, london, newyork or offhours');
  if (p.barTime !== undefined && !finite(Date.parse(p.barTime))) throw new TypeError('Pattern barTime must be an ISO timestamp when present');
  if (p.barTime === undefined) p.barTime = p.signalTime;
  p.fingerprint = patternFingerprint(p);
  return p;
}

// Similarity: how much two patterns agree on the facts the strategy itself weighs.
// Each axis is 0 or 1; the total is a share in 0..1. Booleans compare exactly, continuous
// axes compare within a tolerance (a 0.61 and 0.63 body are the same shape for this purpose).
export function similarity(a, b) {
  const close = (x, y, tol) => Math.abs(x - y) <= tol ? 1 : 0;
  const sameSign = (x, y) => (Math.sign(x) === Math.sign(y) ? 1 : 0);
  const axes = [
    a.side === b.side ? 1 : 0,
    a.session === b.session ? 1 : 0,
    a.sweepReclaimed === b.sweepReclaimed ? 1 : 0,
    a.rejection === b.rejection ? 1 : 0,
    a.closeEdge === b.closeEdge ? 1 : 0,
    a.stacked === b.stacked ? 1 : 0,
    a.deltaAgree === b.deltaAgree ? 1 : 0,
    close(a.bodyRatio, b.bodyRatio, 0.15),
    close(a.closeLocation, b.closeLocation, 0.15),
    close(a.volumeRatio, b.volumeRatio, 0.5),
    sameSign(a.delta, b.delta),
    close(a.imbalanceCount, b.imbalanceCount, 1.5),
    close(a.stackCount, b.stackCount, 1)
  ];
  return axes.reduce((sum, v) => sum + v, 0) / axes.length;
}

// Find the closed patterns most like the reference. Analogues are scoped to the same market
// (symbol) and the same timeframe (intervalMs) — a GC-futures or 5-minute shape is not an
// analogue of an XAUUSD 15m setup — and only the past may judge the present, gated on
// absolute signal time so a short fresh history cannot misread accumulated memory.
// Fewer than minSamples analogues never yields a win rate.
export function findAnalogues(reference, observations, { minSamples = MIN_CALIBRATION_SAMPLES, threshold = 0.8, limit = 50 } = {}) {
  if (!Number.isInteger(minSamples) || minSamples < 1) throw new TypeError('minSamples must be a positive integer');
  if (!finite(threshold) || threshold < 0.5 || threshold > 1) throw new TypeError('threshold must be between 0.5 and 1');
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new TypeError('limit must be an integer 1..500');
  const referenceTime = Date.parse(reference.signalTime);
  const ranked = [];
  for (const observation of observations) {
    if (observation.symbol !== reference.symbol) continue;      // the same market only
    if (observation.intervalMs !== reference.intervalMs) continue; // the same timeframe only
    if (Date.parse(observation.signalTime) >= referenceTime) continue; // the past only
    const score = similarity(reference, observation);
    if (score < threshold) continue;
    ranked.push({ score: Number(score.toFixed(4)), pattern: observation });
  }
  ranked.sort((x, y) => y.score - x.score || Date.parse(x.pattern.signalTime) - Date.parse(y.pattern.signalTime));
  const analogues = ranked.slice(0, limit);
  const wins = analogues.filter(a => a.pattern.netR > 0).length;
  const losses = analogues.filter(a => a.pattern.netR < 0).length;
  const referenceTs = referenceTime;
  const outOfSample = analogues.filter(a => a.pattern.exitTime ? Date.parse(a.pattern.exitTime) <= referenceTs : Date.parse(a.pattern.signalTime) <= referenceTs).length;
  const expectancy = analogues.length ? analogues.reduce((sum, a) => sum + a.pattern.netR, 0) / analogues.length : null;
  return {
    count: analogues.length,
    analogues: analogues.map(a => ({ score: a.score, ...publicPattern(a.pattern) })),
    winRate: analogues.length >= minSamples ? Number((wins / analogues.length).toFixed(4)) : null,
    calibrated: analogues.length >= minSamples,
    minimumSamples: minSamples,
    wins, losses, outOfSample,
    expectancyR: expectancy === null ? null : Number(expectancy.toFixed(3))
  };
}

function publicPattern(p) {
  return { id: p.id, fingerprint: p.fingerprint, symbol: p.symbol, intervalMs: p.intervalMs, side: p.side, session: p.session, signalTime: p.signalTime, signalIndex: p.signalIndex, entryIndex: p.entryIndex, exitIndex: p.exitIndex, exitTime: p.exitTime, exitReason: p.exitReason, netR: p.netR, technicalScore: p.technicalScore };
}

// Trading-session bucket from the signal's UTC hour, matching the zone engine's session split.
function sessionOf(timeMs) {
  const hour = new Date(timeMs).getUTCHours();
  if (hour >= 0 && hour < 7) return 'asia';
  if (hour >= 7 && hour < 12) return 'london';
  if (hour >= 12 && hour < 21) return 'newyork';
  return 'offhours';
}

// One feature extractor for both the stored observation and the live reference, so the two
// cannot drift apart and silently skew similarity scores. Only the outcome differs: a stored
// pattern carries the simulated trade's result, a live reference zeroes it.
function featuresFromBar(signal, bars, symbol, intervalMs) {
  const bar = bars[signal.index];
  if (!bar) throw new TypeError('Signal bar not found in bars');
  const range = Math.max(1e-9, bar.h - bar.l);
  const volume = Number(bar.volume) || 0;
  const prior = bars.slice(Math.max(0, signal.index - 20), signal.index);
  const medianVolume = prior.length ? median(prior.map(b => Number(b.volume) || 0)) : volume;
  const directionalKnown = (bar.unknown || 0) === 0 && volume > 0;
  const delta = bar.delta ?? ((bar.ask || 0) - (bar.bid || 0));
  return {
    symbol, intervalMs, side: signal.side,
    signalTime: bar.time, signalIndex: signal.index, barTime: bar.time,
    session: sessionOf(Date.parse(bar.time)),
    atr: signal.atr ?? 0, sweepLevel: signal.level,
    bodyRatio: Math.abs(bar.c - bar.o) / range, closeLocation: (bar.c - bar.l) / range,
    volumeRatio: medianVolume > 0 ? volume / medianVolume : 1,
    delta, deltaRatio: bar.deltaRatio ?? 0, pocShift: 0,
    imbalanceCount: (bar.imbalances || []).length, stackCount: (bar.stackedImbalances || []).length,
    sweepReclaimed: Boolean((bar.sweeps || []).some(s => s.reclaimed)),
    rejection: (signal.side === 'long' ? bar.c > bar.o : bar.c < bar.o),
    closeEdge: (signal.side === 'long' ? (bar.c - bar.l) / range >= 0.65 : (bar.c - bar.l) / range <= 0.35),
    stacked: (bar.stackedImbalances || []).some(item => item.side === (signal.side === 'long' ? 'buy' : 'sell')),
    deltaAgree: directionalKnown && ((signal.side === 'long' && delta > 0) || (signal.side === 'short' && delta < 0))
  };
}

// Build the observation the memory keeps, from a signal the strategy produced and the
// trade the backtest engine closed for it. Market facts only, as they were at the signal.
export function observationFrom(signal, trade, bars, symbol, intervalMs) {
  if (!signal || !trade || !Array.isArray(bars)) throw new TypeError('Invalid observation input');
  return validatePattern({
    ...featuresFromBar(signal, bars, symbol, intervalMs),
    entryIndex: trade.entryIndex, exitIndex: trade.exitIndex, exitTime: trade.exitTime ?? null, exitReason: trade.exitReason, netR: trade.netR
  });
}

const median = values => { const v = values.filter(finite).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : 0; };

export function createPatternStore({ file = './data/patterns.json', now = () => Date.now() } = {}) {
  let observations = [];
  let loaded = false;
  let poisoned = false; // a corrupt memory file: readable list, but never overwritten this run

  async function load() {
    if (loaded) return;
    loaded = true;
    if (!file) return;
    let stored = null;
    try { stored = JSON.parse(await readFile(file, 'utf8')); } catch (error) {
      if (error?.code === 'ENOENT') return; // a fresh install: no memory file yet, nothing lost
      // A whole-file parse failure is never silent and never destroys history: log it, and mark
      // the memory unwritable so the next persist() cannot overwrite a possibly-recoverable file.
      process.stderr.write(`[pattern-store] cannot read the pattern memory at ${file}: ${error.message}; starting empty, the file will not be overwritten this run\n`);
      poisoned = true;
      return;
    }
    if (!Array.isArray(stored?.observations)) return;
    // Validate per observation: one malformed or semantically invalid record is skipped (and
    // logged, so a corrupt file is distinguishable from a fresh install), never a reason to
    // silently drop the whole accumulated memory — which would break the append-only contract.
    // Records written before intervalMs existed (an earlier version of the store) default their
    // timeframe to the 15-minute interval the workspace has always used, so an upgrade keeps
    // the accumulated memory instead of failing validation record by record.
    observations = [];
    for (const raw of stored.observations) {
      try {
        // The persisted envelope (id, recordedAt, technicalScore, the stored fingerprint) is
        // stripped before validation: the pattern itself is re-validated and re-fingerprinted.
        const { id, recordedAt, technicalScore, fingerprint, ...pattern } = raw;
        if (pattern.intervalMs === undefined) pattern.intervalMs = DEFAULT_INTERVAL_MS;
        const clean = validatePattern(pattern);
        observations.push({ ...clean, id: typeof id === 'string' && id.length <= 40 ? id : clean.fingerprint, recordedAt: recordedAt || null, technicalScore: Number(technicalScore) || null });
      } catch (error) {
        process.stderr.write(`[pattern-store] skipping an invalid stored observation: ${error.message}\n`);
      }
    }
  }

  async function persist() {
    if (!file) return;
    if (poisoned) return; // never overwrite a file this process could not read
    await mkdir(dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    await writeFile(tmp, JSON.stringify({ observations }, null, 2), 'utf8');
    await rename(tmp, file);
  }

  // Identity is window-independent: fingerprint + signalTime + intervalMs. Array indices shift
  // as the analysis window slides, so they must never key the "remembered once" guarantee.
  const sameSetup = (a, b) => a.fingerprint === b.fingerprint && a.signalTime === b.signalTime && a.intervalMs === b.intervalMs;

  // Append-only: the same setup is remembered once. The caller passes batched=true when many
  // records follow in one call, so the file is rewritten once per batch, not once per record.
  async function record(signal, trade, bars, symbol, intervalMs, { batched = false } = {}) {
    await load();
    const observation = { ...observationFrom(signal, trade, bars, symbol, intervalMs), technicalScore: Number(signal.technicalScore) || null, recordedAt: new Date(now()).toISOString() };
    const existing = observations.find(o => sameSetup(o, observation));
    if (existing) return { recorded: false, deduplicated: true, observation: publicPattern(existing) };
    observation.id = 'PTN-' + randomBytes(5).toString('hex');
    observations.push(observation);
    if (!batched) await persist();
    return { recorded: true, deduplicated: false, observation: publicPattern(observation) };
  }

  // One persist for the whole batch: recording a large closed history must not rewrite the
  // memory file hundreds of times inside a single signals call.
  async function recordMany(signals, trades, bars, symbol, intervalMs, { maxRecords = 500 } = {}) {
    await load();
    const results = [];
    let recorded = 0;
    for (const trade of trades) {
      if (recorded >= maxRecords) break; // a cap: one call can never flood the memory
      const signal = signals.find(s => s.index === trade.signalIndex);
      if (!signal) continue;
      const result = await record(signal, trade, bars, symbol, intervalMs, { batched: true });
      if (result.recorded) recorded += 1;
      results.push(result);
    }
    if (recorded > 0) await persist();
    return results;
  }

  // The reference pattern built from the live signal the page is looking at.
  async function analoguesForSignal(signal, bars, symbol, intervalMs, options = {}) {
    await load();
    // A live signal has no closed outcome yet: build the reference from the bar alone.
    const reference = referenceFromSignal(signal, bars, symbol, intervalMs);
    const result = findAnalogues(reference, observations, options);
    return { reference: publicPattern({ ...reference, id: 'REF' }), ...result, memory: observations.length };
  }

  async function list() { await load(); return { count: observations.length, observations: observations.map(publicPattern) }; }

  return { record, recordMany, analoguesForSignal, list };
}

// A reference for a signal that has not closed yet: outcome fields are zeroed, which
// keeps the fingerprint comparable on every axis the similarity actually reads.
function referenceFromSignal(signal, bars, symbol, intervalMs) {
  return validatePattern({
    ...featuresFromBar(signal, bars, symbol, intervalMs),
    entryIndex: signal.index, exitIndex: signal.index, exitTime: null, exitReason: 'time', netR: 0
  });
}
