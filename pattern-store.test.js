import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validatePattern, similarity, findAnalogues, createPatternStore, observationFrom, patternFingerprint, MIN_CALIBRATION_SAMPLES } from './pattern-store.js';

const baseBar = (over = {}) => ({ time: '2026-11-18T14:15:00.000Z', o: 2648.2, h: 2651.0, l: 2647.5, c: 2650.6, volume: 120, bid: 40, ask: 80, unknown: 0, delta: 40, deltaRatio: 0.33,
  imbalances: [{ side: 'buy', price: 2650.6, ratio: 4 }], stackedImbalances: [{ side: 'buy', prices: [2650.6, 2650.5, 2650.4] }],
  sweeps: [{ side: 'sell-side', level: 2647.8, reclaimed: true }], ...over });
const bars = (n = 30) => Array.from({ length: n }, (_, i) => baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
const signal = (index = 25, over = {}) => ({ id: 'SIG-25-long-2647.8', index, time: '2026-11-18T14:15:00.000Z', side: 'long', level: 2647.8, technicalScore: 0.72, evidence: ['Снятие ликвидности и возврат'], atr: 2.1, ...over });
const trade = (over = {}) => ({ side: 'long', signalIndex: 25, entryIndex: 26, exitIndex: 30, entryTime: '2026-11-18T14:30:00.000Z', exitTime: '2026-11-18T15:30:00.000Z', entry: 2649, exit: 2653, stop: 2646, target: 2657, quantity: 10, riskBudget: 200, grossPnl: 400, fees: 0, netPnl: 400, netR: 2, exitReason: 'target', technicalScore: 0.72, ...over });

test('observation is built from a signal and its closed trade, holding only market facts', () => {
  const observation = observationFrom(signal(), trade(), bars(), 'XAUUSD');
  assert.equal(observation.side, 'long');
  assert.equal(observation.session, 'newyork');
  assert.equal(observation.exitReason, 'target');
  assert.equal(observation.netR, 2);
  assert.ok(observation.fingerprint.length === 16);
  assert.ok(observation.bodyRatio > 0 && observation.bodyRatio <= 1);
  assert.equal(observation.sweepReclaimed, true);
  assert.equal(observation.stacked, true);
  assert.equal(observation.deltaAgree, true);
});

test('validation rejects unknown fields, bad sides and non-gold symbols', () => {
  assert.throws(() => validatePattern({ ...observationFrom(signal(), trade(), bars(), 'XAUUSD'), secretToken: 'x' }), /Unknown pattern field/);
  assert.throws(() => observationFrom(signal(25, { side: 'up' }), trade(), bars(), 'XAUUSD'), /side must be long or short/);
  assert.throws(() => observationFrom(signal(), trade(), bars(), 'EURUSD'), /gold/);
  assert.throws(() => validatePattern({ ...observationFrom(signal(), trade(), bars(), 'XAUUSD'), exitReason: 'hunch' }), /exitReason/);
  assert.throws(() => validatePattern({ ...observationFrom(signal(), trade(), bars(), 'XAUUSD'), entryIndex: 40, exitIndex: 30 }), /ordered/);
});

test('identical signals produce identical fingerprints; a different session does not', () => {
  const a = observationFrom(signal(), trade(), bars(), 'XAUUSD');
  const b = observationFrom(signal(), trade(), bars(), 'XAUUSD');
  assert.equal(a.fingerprint, b.fingerprint);
  const asiaBar = baseBar({ time: '2026-11-18T03:15:00.000Z' });
  const asiaBars = Array.from({ length: 30 }, (_, i) => i === 1 ? asiaBar : baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
  const asiaSignal = signal(1, { time: asiaBar.time });
  const asia = observationFrom(asiaSignal, trade({ entryIndex: 2, exitIndex: 5, signalIndex: 1 }), asiaBars, 'XAUUSD');
  assert.notEqual(a.fingerprint, asia.fingerprint);
  assert.equal(asia.session, 'asia');
});

test('similarity ranks a near-identical pattern above a different session', () => {
  const a = observationFrom(signal(), trade(), bars(), 'XAUUSD');
  const sameShape = observationFrom(signal(20, { time: '2026-11-17T14:15:00.000Z', id: 'SIG-20' }), trade({ signalIndex: 20, entryIndex: 21, exitIndex: 24 }), bars(), 'XAUUSD');
  const asiaBar = baseBar({ time: '2026-11-17T03:15:00.000Z' });
  const asiaBars = Array.from({ length: 30 }, (_, i) => i === 10 ? asiaBar : baseBar({ time: new Date(Date.parse('2026-11-18T13:00:00Z') + i * 900000).toISOString(), volume: 100 + (i % 7) * 10 }));
  const asia = observationFrom(signal(10, { time: asiaBar.time, id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), asiaBars, 'XAUUSD');
  assert.ok(similarity(a, sameShape) > similarity(a, asia));
  assert.ok(similarity(a, sameShape) >= 0.9);
  assert.ok(similarity(a, asia) < similarity(a, sameShape));
});

test('findAnalogues never judges the present with the future and reports thin memory honestly', () => {
  const reference = observationFrom(signal(29), trade({ signalIndex: 29, entryIndex: 30, exitIndex: 33 }), bars(34), 'XAUUSD');
  const past = [observationFrom(signal(25), trade(), bars(), 'XAUUSD')];
  const future = observationFrom(signal(2), trade({ signalIndex: 2, entryIndex: 3, exitIndex: 5 }), bars(), 'XAUUSD');
  // a pattern with a later signalIndex than the reference must be excluded even if listed
  const ahead = observationFrom(signal(28, { id: 'SIG-28' }), trade({ signalIndex: 28, entryIndex: 29, exitIndex: 32 }), bars(34), 'XAUUSD');
  const result = findAnalogues(reference, [...past, future, ahead]);
  assert.ok(result.count >= 1);
  for (const analogue of result.analogues) assert.ok(analogue.signalIndex < reference.signalIndex, 'no analogue may come from the future');
  assert.equal(result.winRate, null, 'win rate is never invented below the calibration minimum');
  assert.equal(result.calibrated, false);
  assert.equal(result.minimumSamples, MIN_CALIBRATION_SAMPLES);
});

test('win rate appears only at the calibration minimum and counts outcomes exactly', () => {
  const reference = observationFrom(signal(100), trade({ signalIndex: 100, entryIndex: 101, exitIndex: 104 }), bars(110), 'XAUUSD');
  const make = (index, netR) => observationFrom(signal(index, { id: 'SIG-' + index }), trade({ signalIndex: index, entryIndex: index + 1, exitIndex: index + 4, netR, netPnl: netR * 200, exitReason: netR > 0 ? 'target' : 'stop' }), bars(110), 'XAUUSD');
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

test('store records once, deduplicates by fingerprint and entry, and persists atomically', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const file = join(dir, 'patterns.json');
  const store = createPatternStore({ file, now: () => Date.parse('2026-11-19T10:00:00Z') });
  const first = await store.record(signal(), trade(), bars(), 'XAUUSD');
  assert.equal(first.recorded, true);
  assert.equal(first.deduplicated, false);
  const again = await store.record(signal(), trade(), bars(), 'XAUUSD');
  assert.equal(again.recorded, false);
  assert.equal(again.deduplicated, true);
  const stored = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(stored.observations.length, 1);
  assert.equal(stored.observations[0].id, first.observation.id);
  // reload from disk keeps the memory
  const reopened = createPatternStore({ file });
  const list = await reopened.list();
  assert.equal(list.count, 1);
  assert.equal(list.observations[0].fingerprint, first.observation.fingerprint);
});

test('store survives a hand-broken file by starting from an empty memory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const file = join(dir, 'patterns.json');
  await writeFile(file, '{not json', 'utf8');
  const store = createPatternStore({ file });
  const list = await store.list();
  assert.equal(list.count, 0);
});

test('analogues for a live signal build the reference without inventing an outcome', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-patterns-'));
  const store = createPatternStore({ file: join(dir, 'patterns.json') });
  const empty = await store.analoguesForSignal(signal(), bars(), 'XAUUSD');
  assert.equal(empty.count, 0);
  assert.equal(empty.winRate, null);
  assert.equal(empty.memory, 0);
  assert.equal(empty.reference.side, 'long');
  await store.record(signal(10, { id: 'SIG-10' }), trade({ signalIndex: 10, entryIndex: 11, exitIndex: 14 }), bars(), 'XAUUSD');
  const one = await store.analoguesForSignal(signal(25), bars(), 'XAUUSD');
  assert.equal(one.memory, 1);
  assert.ok(one.count >= 0);
  assert.equal(one.winRate, null, 'a single analogue is not a win rate');
});

test('threshold option tightens what counts as an analogue', () => {
  const a = observationFrom(signal(), trade(), bars(), 'XAUUSD');
  const loose = observationFrom(signal(15, { id: 'SIG-15' }), trade({ signalIndex: 15, entryIndex: 16, exitIndex: 19, exitReason: 'stop', netR: -1 }), bars(), 'XAUUSD');
  const atDefault = findAnalogues(a, [loose]);
  const atStrict = findAnalogues(a, [loose], { threshold: 1 });
  assert.ok(atStrict.count <= atDefault.count);
});
