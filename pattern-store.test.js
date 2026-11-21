import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePattern, similarity, findAnalogues, createPatternStore, observationFrom, patternFingerprint, MIN_CALIBRATION_SAMPLES } from './pattern-store.js';

const INTERVAL = 900000;
const baseBar = (over = {}) => ({ time: '2026-11-18T14:15:00.000Z', o: 2648.2, h: 2651.0, l: 2647.5, c: 2650.6, volume: 120, bid: 40, ask: 80, unknown: 0, delta: 40, deltaRatio: 0.33,
  imbalances: [{ side: 'buy', price: 2650.6, ratio: 4 }], stackedImbalances: [{ side: 'buy', prices: [2650.6, 2650.5, 2650.4] }],
  sweeps: [{ side: 'sell-side', level: 2647.8, reclaimed: true }], ...over });
const bars = (n = 30) => Array.from({ length: n }, (_, i) => baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
const signal = (index = 25, over = {}) => ({ id: 'SIG-25-long-2647.8', index, time: '2026-11-18T14:15:00.000Z', side: 'long', level: 2647.8, technicalScore: 0.72, evidence: ['Снятие ликвидности и возврат'], atr: 2.1, ...over });
const trade = (over = {}) => ({ side: 'long', signalIndex: 25, entryIndex: 26, exitIndex: 30, entryTime: '2026-11-18T14:30:00.000Z', exitTime: '2026-11-18T15:30:00.000Z', entry: 2649, exit: 2653, stop: 2646, target: 2657, quantity: 10, riskBudget: 200, grossPnl: 400, fees: 0, netPnl: 400, netR: 2, exitReason: 'target', technicalScore: 0.72, ...over });

test('observation is built from a signal and its closed trade, holding only market facts', () => {
  const observation = observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  assert.equal(observation.side, 'long');
  assert.equal(observation.session, 'newyork');
  assert.equal(observation.exitReason, 'target');
  assert.equal(observation.netR, 2);
  assert.equal(observation.intervalMs, INTERVAL);
  assert.ok(observation.fingerprint.length === 16);
  assert.ok(observation.bodyRatio > 0 && observation.bodyRatio <= 1);
  assert.equal(observation.sweepReclaimed, true);
  assert.equal(observation.stacked, true);
  assert.equal(observation.deltaAgree, true);
});

test('validation rejects unknown fields, bad sides, non-gold symbols and bad intervals', () => {
  assert.throws(() => validatePattern({ ...observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL), secretToken: 'x' }), /Unknown pattern field/);
  assert.throws(() => observationFrom(signal(25, { side: 'up' }), trade(), bars(), 'XAUUSD', INTERVAL), /side must be long or short/);
  assert.throws(() => observationFrom(signal(), trade(), bars(), 'EURUSD', INTERVAL), /gold/);
  assert.throws(() => validatePattern({ ...observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL), exitReason: 'hunch' }), /exitReason/);
  assert.throws(() => validatePattern({ ...observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL), entryIndex: 40, exitIndex: 30 }), /ordered/);
  assert.throws(() => observationFrom(signal(), trade(), bars(), 'XAUUSD', 30000), /intervalMs/);
});

test('identical signals produce identical fingerprints; a different session does not', () => {
  const a = observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  const b = observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  assert.equal(a.fingerprint, b.fingerprint);
  const asiaBar = baseBar({ time: '2026-11-18T03:15:00.000Z' });
  const asiaBars = Array.from({ length: 30 }, (_, i) => i === 1 ? asiaBar : baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
  const asia = observationFrom(signal(1, { time: asiaBar.time }), trade({ entryIndex: 2, exitIndex: 5, signalIndex: 1 }), asiaBars, 'XAUUSD', INTERVAL);
  assert.notEqual(a.fingerprint, asia.fingerprint);
  assert.equal(asia.session, 'asia');
});

test('patternFingerprint is stable across a round-trip through validatePattern', () => {
  const observation = observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  const roundTripped = validatePattern(observation);
  assert.equal(roundTripped.fingerprint, observation.fingerprint);
  assert.equal(patternFingerprint(roundTripped), roundTripped.fingerprint);
});

test('similarity ranks a near-identical pattern above a different session', () => {
  const a = observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  const sameShape = observationFrom(signal(20, { time: '2026-11-17T14:15:00.000Z', id: 'SIG-20' }), trade({ signalIndex: 20, entryIndex: 21, exitIndex: 24 }), bars(), 'XAUUSD', INTERVAL);
  const asiaBar = baseBar({ time: '2026-11-17T03:15:00.000Z' });
  const asiaBars = Array.from({ length: 30 }, (_, i) => i === 10 ? asiaBar : baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
  const asia = observationFrom(signal(10, { time: asiaBar.time, id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), asiaBars, 'XAUUSD', INTERVAL);
  assert.ok(similarity(a, sameShape) > similarity(a, asia));
  assert.ok(similarity(a, sameShape) >= 0.9);
  assert.ok(similarity(a, asia) < similarity(a, sameShape));
});

test('analogues never cross markets or timeframes', () => {
  const reference = observationFrom(signal(100), trade({ signalIndex: 100, entryIndex: 101, exitIndex: 104 }), bars(110), 'XAUUSD', INTERVAL);
  const sameMarket = observationFrom(signal(10, { id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(110), 'XAUUSD', INTERVAL);
  const futures = observationFrom(signal(10, { id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(110), 'GCZ6', INTERVAL);
  const otherTf = observationFrom(signal(10, { id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(110), 'XAUUSD', 300000);
  const result = findAnalogues(reference, [sameMarket, futures, otherTf]);
  assert.equal(result.count, 1, 'only the same symbol and interval may rank as an analogue');
  assert.equal(result.analogues[0].symbol, 'XAUUSD');
  assert.equal(result.analogues[0].intervalMs, INTERVAL);
});

test('the walk-forward gate uses absolute time, not array indices', () => {
  // A stored setup days older in wall-clock time is the past however the arrays shift.
  const stored = observationFrom(signal(10), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(110), 'XAUUSD', INTERVAL);
  const laterTime = new Date(Date.parse(stored.signalTime) + 5 * 86400000).toISOString();
  const laterBars = bars(110).map((b, i) => i === 90 ? baseBar({ time: laterTime }) : b);
  const reference = observationFrom(signal(90), trade({ signalIndex: 90, entryIndex: 91, exitIndex: 94 }), laterBars, 'XAUUSD', INTERVAL);
  assert.ok(Date.parse(reference.signalTime) > Date.parse(stored.signalTime));
  assert.equal(findAnalogues(reference, [stored]).count, 1, 'a genuinely earlier setup in time is the past regardless of indices');
  // The mirror: a stored observation whose signalTime is AFTER the reference must be excluded
  // even when its array index is smaller (a short fresh history must not read newer memory as past).
  const futureBars = bars(30).map((b, i) => i === 5 ? baseBar({ time: laterTime }) : b);
  const futureStored = observationFrom(signal(5), trade({ signalIndex: 5, entryIndex: 6, exitIndex: 9 }), futureBars, 'XAUUSD', INTERVAL);
  const earlyReference = observationFrom(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  assert.ok(Date.parse(futureStored.signalTime) > Date.parse(earlyReference.signalTime), 'fixture: the stored pattern is genuinely later in time');
  assert.equal(findAnalogues(earlyReference, [futureStored]).count, 0, 'a setup whose signal time is later than the reference is the future and must be excluded');
});

test('findAnalogues never judges the present with the future and reports thin memory honestly', () => {
  const reference = observationFrom(signal(29), trade({ signalIndex: 29, entryIndex: 30, exitIndex: 33 }), bars(34), 'XAUUSD', INTERVAL);
  const past = [observationFrom(signal(25), trade(), bars(), 'XAUUSD', INTERVAL)];
  const future = observationFrom(signal(2), trade({ signalIndex: 2, entryIndex: 3, exitIndex: 5 }), bars(), 'XAUUSD', INTERVAL);
  const ahead = observationFrom(signal(28, { id: 'SIG-28' }), trade({ signalIndex: 28, entryIndex: 29, exitIndex: 32 }), bars(34), 'XAUUSD', INTERVAL);
  const result = findAnalogues(reference, [...past, future, ahead]);
  assert.ok(result.count >= 1);
  for (const analogue of result.analogues) assert.ok(Date.parse(analogue.signalTime) < Date.parse(reference.signalTime), 'no analogue may come from the future');
  assert.equal(result.winRate, null, 'win rate is never invented below the calibration minimum');
  assert.equal(result.calibrated, false);
  assert.equal(result.minimumSamples, MIN_CALIBRATION_SAMPLES);
});

test('win rate appears only at the calibration minimum and counts outcomes exactly', () => {
  const reference = observationFrom(signal(100), trade({ signalIndex: 100, entryIndex: 101, exitIndex: 104 }), bars(110), 'XAUUSD', INTERVAL);
  const make = (index, netR) => observationFrom(signal(index, { id: 'SIG-' + index }), trade({ signalIndex: index, entryIndex: index + 1, exitIndex: index + 4, netR, netPnl: netR * 200, exitReason: netR > 0 ? 'target' : 'stop' }), bars(110), 'XAUUSD', INTERVAL);
  const observations = [];
  for (let i = 5; i < 5 + MIN_CALIBRATION_SAMPLES; i++) observations.push(make(i, i % 2 ? 2 : -1));
  const thin = findAnalogues(reference, observations.slice(0, MIN_CALIBRATION_SAMPLES - 1));
  assert.equal(thin.winRate, null);
  const full = findAnalogues(reference, observations);
  assert.equal(full.count, MIN_CALIBRATION_SAMPLES);
  assert.equal(full.winRate, Number((full.wins / full.count).toFixed(4)));
  assert.equal(full.calibrated, true);
  assert.ok(Number.isFinite(full.expectancyR));
});

test('store records once, deduplicates by a window-independent identity, and persists atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const file = join(dir, 'patterns.json');
  const store = createPatternStore({ file, now: () => Date.parse('2026-11-19T10:00:00Z') });
  const first = await store.record(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  assert.equal(first.recorded, true);
  assert.equal(first.deduplicated, false);
  const again = await store.record(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  assert.equal(again.recorded, false);
  assert.equal(again.deduplicated, true);
  // The same historical setup with a DIFFERENT entryIndex (as the sliding window shifts it)
  // is still the same setup: dedup keys on fingerprint + signalTime + intervalMs.
  const shifted = await store.record(signal(), trade({ entryIndex: 27, exitIndex: 31 }), bars(35), 'XAUUSD', INTERVAL);
  assert.equal(shifted.recorded, false, 'a window-shifted entryIndex must not re-append the same setup');
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.observations.length, 1);
  assert.equal(stored.observations[0].id, first.observation.id);
  const reopened = createPatternStore({ file });
  const list = await reopened.list();
  assert.equal(list.count, 1);
  assert.equal(list.observations[0].fingerprint, first.observation.fingerprint);
});

test('recordMany persists once for the whole batch and not at all when nothing is new', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const file = join(dir, 'patterns.json');
  const store = createPatternStore({ file });
  const signals = [signal(10, { id: 'S10' }), signal(15, { id: 'S15' }), signal(20, { id: 'S20' })];
  const trades = [trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), trade({ signalIndex: 15, entryIndex: 16, exitIndex: 19 }), trade({ signalIndex: 20, entryIndex: 21, exitIndex: 24 })];
  await store.recordMany(signals, trades, bars(30), 'XAUUSD', INTERVAL);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.observations.length, 3, 'the whole batch lands in one file');
  // Re-running the same batch records nothing and must not rewrite the file at all.
  const before = await stat(file);
  await new Promise(r => setTimeout(r, 30));
  await store.recordMany(signals, trades, bars(30), 'XAUUSD', INTERVAL);
  const after = await stat(file);
  assert.equal(after.mtimeMs, before.mtimeMs, 'a fully deduplicated batch must not rewrite the file');
});

test('recordMany caps how many records one call can add', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const store = createPatternStore({ file: join(dir, 'patterns.json') });
  const signals = [], trades = [];
  for (let i = 0; i < 600; i++) { signals.push(signal(i, { id: 'S' + i })); trades.push(trade({ signalIndex: i, entryIndex: i + 1, exitIndex: i + 4 })); }
  const results = await store.recordMany(signals, trades, bars(700), 'XAUUSD', INTERVAL);
  const recorded = results.filter(r => r.recorded).length;
  assert.ok(recorded <= 500, 'the cap holds: recorded ' + recorded);
});

test('store survives a hand-broken file by starting from an empty memory, never overwriting it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const file = join(dir, 'patterns.json');
  await writeFile(file, '{not json', 'utf8');
  const store = createPatternStore({ file });
  const list = await store.list();
  assert.equal(list.count, 0, 'a corrupt file starts an empty memory');
  // Recording a new setup must not overwrite the corrupt file: persist is refused while poisoned.
  await store.record(signal(10, { id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(), 'XAUUSD', INTERVAL);
  const raw = await readFile(file, 'utf8');
  assert.equal(raw, '{not json', 'the corrupt file is left untouched for recovery');
});

test('records persisted before intervalMs existed migrate to the default timeframe on load', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const seedFile = join(dir, 'seed.json'), file = join(dir, 'patterns.json');
  const seedStore = createPatternStore({ file: seedFile });
  const good = await seedStore.record(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  // a record exactly as the previous version wrote it: no intervalMs anywhere
  const legacy = JSON.parse(await readFile(seedFile, 'utf8')).observations[0];
  delete legacy.intervalMs;
  await writeFile(file, JSON.stringify({ observations: [legacy] }), 'utf8');
  const store = createPatternStore({ file });
  const list = await store.list();
  assert.equal(list.count, 1, 'a legacy record is kept, not skipped as invalid');
  assert.equal(list.observations[0].intervalMs, 900000, 'the legacy record is migrated to the default 15m timeframe');
  assert.equal(list.observations[0].fingerprint, good.observation.fingerprint);
});

test('one invalid stored observation is skipped, not the whole memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const seedFile = join(dir, 'seed.json'), file = join(dir, 'patterns.json');
  const seedStore = createPatternStore({ file: seedFile });
  const good = await seedStore.record(signal(), trade(), bars(), 'XAUUSD', INTERVAL);
  const goodRecord = JSON.parse(await readFile(seedFile, 'utf8')).observations[0];
  // one valid record plus one malformed plus one semantically invalid, in the real memory file
  await writeFile(file, JSON.stringify({ observations: [
    goodRecord,
    { broken: true },
    { ...goodRecord, exitReason: 'hunch', signalTime: '2026-11-16T14:15:00.000Z' }
  ] }), 'utf8');
  const store = createPatternStore({ file });
  const list = await store.list();
  assert.equal(list.count, 1, 'the valid record survives; only the bad ones are skipped');
  assert.equal(list.observations[0].fingerprint, good.observation.fingerprint);
});

test('analogues for a live signal build the reference without inventing an outcome', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const store = createPatternStore({ file: join(dir, 'patterns.json') });
  const empty = await store.analoguesForSignal(signal(), bars(), 'XAUUSD', INTERVAL);
  assert.equal(empty.count, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.memory, 0);
  assert.equal(empty.reference.side, 'long');
  await store.record(signal(10, { id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(), 'XAUUSD', INTERVAL);
  const one = await store.analoguesForSignal(signal(25), bars(), 'XAUUSD', INTERVAL);
  assert.equal(one.memory, 1);
  assert.ok(one.count >= 0);
  assert.equal(one.winRate, null, 'a single analogue is not a win rate');
});

test('a strict threshold actually drops a non-identical analogue', () => {
  const reference = observationFrom(signal(25), trade(), bars(), 'XAUUSD', INTERVAL);
  // nearMiss differs only in outcome fields, which are not similarity axes: it stays identical
  // in shape, so even threshold 1 keeps it. That is the boundary the threshold must respect.
  const nearMiss = observationFrom(signal(15, { id: 'SIG-15' }), trade({ signalIndex: 15, entryIndex: 16, exitIndex: 19, exitReason: 'stop', netR: -1 }), bars(), 'XAUUSD', INTERVAL);
  const asiaBar = baseBar({ time: '2026-11-17T03:15:00.000Z' });
  const asiaBars = Array.from({ length: 30 }, (_, i) => i === 15 ? asiaBar : baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
  const different = observationFrom(signal(15, { time: asiaBar.time, id: 'SIG-15' }), trade({ signalIndex: 15, entryIndex: 16, exitIndex: 19 }), asiaBars, 'XAUUSD', INTERVAL);
  assert.ok(similarity(reference, nearMiss) === 1, 'fixture: the outcome-only difference is not a similarity axis');
  assert.ok(similarity(reference, different) < 1, 'fixture: a different session scores below 1');
  const atDefault = findAnalogues(reference, [nearMiss, different]);
  const atStrict = findAnalogues(reference, [nearMiss, different], { threshold: 1 });
  assert.equal(atDefault.count, 2, 'the loose threshold admits both');
  assert.equal(atStrict.count, 1, 'threshold 1 keeps the shape-identical analogue');
  assert.equal(atStrict.analogues[0].session, 'newyork', 'the dropped one is the different-session pattern');
});
