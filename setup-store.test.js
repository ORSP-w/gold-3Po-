import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetupStore, validateDefinition, definitionFingerprint, DEFAULT_DEFINITION } from './setup-store.js';
import { generateSignals, validateStrategyConditions } from './strategy-engine.js';
import { runBacktest } from './backtest-engine.js';

const sampleDefinition = {
  strategy: { minScore: 0.6, requireRejection: true, allowedSides: ['long'], sessionHoursUTC: [7, 16] },
  backtest: { stopAtr: 2, targetR: 3, riskPct: 0.4 },
  risk: { minRiskReward: 2 }
};

test('definition validation rejects unknown fields and out-of-range values', () => {
  assert.throws(() => validateDefinition({ strategy: { unknownKnob: 1 } }), /Unknown strategy condition/);
  assert.throws(() => validateDefinition({ backtest: { turbo: true } }), /Unknown backtest condition/);
  assert.throws(() => validateDefinition({ wallet: '0xabc' }), /Unknown setup section/);
  assert.throws(() => validateDefinition({ strategy: { minScore: 1.5 } }), /minScore/);
  assert.throws(() => validateDefinition({ backtest: { riskPct: 0.9, maxRiskPct: 0.5 } }), /must not exceed/);
  assert.throws(() => validateDefinition({ strategy: { sessionHoursUTC: [16, 7] } }), /sessionHoursUTC/);
  assert.throws(() => validateDefinition({ strategy: { allowedSides: [] } }), /allowedSides/);
  assert.throws(() => validateDefinition({ strategy: { maxZones: 0 } }), /maxZones/);
  assert.throws(() => validateDefinition({ strategy: { maxZones: 21 } }), /maxZones/);
  assert.equal(validateDefinition({ strategy: { maxZones: 12 } }).strategy.maxZones, 12);
  const ok = validateDefinition(sampleDefinition);
  assert.equal(ok.strategy.minScore, 0.6);
  assert.equal(ok.backtest.stopAtr, 2);
  assert.equal(ok.backtest.targetR, 3);
  assert.equal(ok.risk.minRiskReward, 2);
  assert.equal(ok.risk.maxRiskPct, 1);
});

test('fingerprint is stable for identical definitions and differs for changed ones', () => {
  const a = definitionFingerprint(validateDefinition(sampleDefinition));
  const b = definitionFingerprint(validateDefinition(JSON.parse(JSON.stringify(sampleDefinition))));
  const c = definitionFingerprint(validateDefinition({ ...sampleDefinition, backtest: { ...sampleDefinition.backtest, targetR: 4 } }));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test('setup library saves append-only immutable versions and deduplicates identical conditions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-setups-'));
  try {
    const store = createSetupStore({ file: join(dir, 'setups.json') });
    const first = await store.save('London strict', sampleDefinition);
    assert.equal(first.version, 1);
    assert.equal(first.deduplicated, false);
    const again = await store.save('London strict', sampleDefinition);
    assert.equal(again.deduplicated, true);
    assert.equal(again.version, 1);
    const changed = await store.save('London strict', { ...sampleDefinition, backtest: { ...sampleDefinition.backtest, targetR: 4 } });
    assert.equal(changed.version, 2);
    const list = await store.list();
    assert.equal(list.setups.length, 1);
    assert.equal(list.setups[0].versions.length, 2);
    const exported = await store.exportDefinition(first.setupId, 1);
    assert.equal(exported.definition.backtest.targetR, 3);
    const reloaded = createSetupStore({ file: join(dir, 'setups.json') });
    assert.equal((await reloaded.list()).setups[0].versions.length, 2);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('apply selects a version and activeDefinition follows it; import creates a new identity', async () => {
  const store = createSetupStore({ file: null });
  assert.deepEqual(await store.activeDefinition(), DEFAULT_DEFINITION);
  const saved = await store.save('A', sampleDefinition);
  await store.save('A', { ...sampleDefinition, backtest: { ...sampleDefinition.backtest, targetR: 5 } });
  await store.apply(saved.setupId, 1);
  assert.equal((await store.activeDefinition()).backtest.targetR, 3);
  await store.apply(saved.setupId);
  assert.equal((await store.activeDefinition()).backtest.targetR, 5);
  const imported = await store.importSetup('A copy', (await store.exportDefinition(saved.setupId, 1)).definition);
  assert.notEqual(imported.setupId, saved.setupId);
  await assert.rejects(() => store.apply('missing-id'), /not found/);
});

const sweepBar = (index, side, extra = {}) => ({
  time: new Date(Date.UTC(2026, 10, 18, 10, index * 15)).toISOString(),
  o: 2650, h: 2655, l: 2645, c: side === 'long' ? 2654 : 2646,
  bid: 10, ask: 20, unknown: 0, delta: 10,
  sweeps: [{ side: side === 'long' ? 'sell-side' : 'buy-side', level: 2648, reclaimed: true }],
  stackedImbalances: [], ...extra
});

test('custom conditions filter signals by side, session, requirements and minAtr', () => {
  const bars = Array.from({ length: 20 }, (_, i) => ({ time: new Date(Date.UTC(2026, 10, 18, 3, i * 15)).toISOString(), o: 2650, h: 2652, l: 2648, c: 2650, bid: 5, ask: 5, unknown: 0, delta: 0, sweeps: [], stackedImbalances: [] }));
  bars.push(sweepBar(0, 'long'));
  bars.push(sweepBar(1, 'short'));
  const base = generateSignals(bars);
  assert.equal(base.length, 2);
  const longOnly = generateSignals(bars, { allowedSides: ['long'] });
  assert.equal(longOnly.length, 1);
  assert.equal(longOnly[0].side, 'long');
  const stackedRequired = generateSignals(bars, { requireStacked: true });
  assert.equal(stackedRequired.length, 0);
  const withStacked = generateSignals(bars.map(b => ({ ...b, stackedImbalances: [{ side: 'buy', prices: [2648, 2647, 2646] }, { side: 'sell', prices: [2652, 2653, 2654] }] })), { requireStacked: true });
  assert.equal(withStacked.length, 2);
  const sessionFiltered = generateSignals(bars, { sessionHoursUTC: [12, 20] });
  assert.equal(sessionFiltered.length, 0);
  const atrFiltered = generateSignals(bars, { minAtr: 100 });
  assert.equal(atrFiltered.length, 0);
  assert.throws(() => generateSignals(bars, { bogus: 1 }), /Unknown strategy condition/);
});

test('backtest honours strategyConditions end to end', () => {
  const bars = Array.from({ length: 40 }, (_, i) => ({ time: new Date(Date.UTC(2026, 10, 18, 10, i * 15)).toISOString(), o: 2650, h: 2652, l: 2648, c: 2650, bid: 5, ask: 5, unknown: 0, delta: 0, sweeps: [], stackedImbalances: [] }));
  bars[20] = sweepBar(0, 'long');
  const unrestricted = runBacktest(bars);
  const restricted = runBacktest(bars, { strategyConditions: validateStrategyConditions({ requireStacked: true }) });
  assert.ok(unrestricted.summary.trades >= 1);
  assert.equal(restricted.summary.trades, 0);
});
