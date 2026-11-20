import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSourceLevels } from './zone-sources.js';
import { detectLiquidityZones } from './market-engine.js';

// Ten days of 15m candles starting Monday 2026-01-05, gold-like range around $2650.
function history(days = 10) {
  const start = Date.UTC(2026, 0, 5);
  const out = [];
  let price = 2650;
  for (let i = 0; i < days * 96; i++) {
    const time = new Date(start + i * 900000).toISOString();
    const open = price;
    price += Math.sin(i / 7) * 1.6 + Math.sin(i / 29) * 1.1;
    const close = price;
    const high = Math.max(open, close) + 0.6 + Math.sin(i / 3) * 0.4;
    const low = Math.min(open, close) - 0.6 - Math.cos(i / 4) * 0.4;
    out.push({ time, o: open, h: high, l: low, c: close, volume: 8 + (i % 7) });
  }
  return out;
}

test('completed days, sessions, weeks and higher timeframes all contribute levels', () => {
  const bars = history();
  const levels = collectSourceLevels(bars, { priceStep: 0.1 });
  const labels = levels.map(level => level.label);
  for (const expected of ['Prior day high', 'Prior day low', 'Asia high', 'London high', 'New York high', 'Weekly open', 'Prior week high']) {
    assert.ok(labels.includes(expected), 'missing source: ' + expected);
  }
  assert.ok(labels.some(label => /^H[14] swing (high|low)$/.test(label)), 'higher-timeframe swings must be derived from the same candles');
  assert.ok(labels.includes('Volume POC'));

  for (const level of levels) {
    assert.ok(Number.isFinite(level.price) && level.price > 0, 'every level is a real price');
    assert.ok(level.weight > 0 && level.weight <= 1);
    assert.ok(Number.isInteger(level.index) && level.index >= 0, 'levels point back at the candle that formed them');
  }
});

test('the prior day extremes match the actual previous session', () => {
  const bars = history();
  const levels = collectSourceLevels(bars, { priceStep: 0.1 });
  const days = new Map();
  for (const bar of bars) {
    const key = bar.time.slice(0, 10);
    if (!days.has(key)) days.set(key, []);
    days.get(key).push(bar);
  }
  const keys = [...days.keys()].sort();
  const previousDay = days.get(keys.at(-2));
  const expectedHigh = Math.max(...previousDay.map(bar => bar.h));
  const expectedLow = Math.min(...previousDay.map(bar => bar.l));
  assert.equal(levels.find(level => level.label === 'Prior day high').price, expectedHigh);
  assert.equal(levels.find(level => level.label === 'Prior day low').price, expectedLow);
});

test('the volume profile is ordered and inside the traded range', () => {
  const bars = history();
  const levels = collectSourceLevels(bars, { priceStep: 0.1 });
  const poc = levels.find(level => level.label === 'Volume POC').price;
  const vah = levels.find(level => level.label === 'Value area high').price;
  const val = levels.find(level => level.label === 'Value area low').price;
  assert.ok(val <= poc && poc <= vah, 'value area must bracket the point of control');
  const window = bars.slice(-96);
  assert.ok(poc >= Math.min(...window.map(bar => bar.l)) - 0.05);
  assert.ok(poc <= Math.max(...window.map(bar => bar.h)) + 0.05);
});

test('a series without timestamps falls back to the volume profile instead of inventing calendar levels', () => {
  const bars = history().map(({ time, ...rest }) => rest);
  const labels = collectSourceLevels(bars, { priceStep: 0.1 }).map(level => level.label);
  assert.ok(labels.includes('Volume POC'));
  assert.ok(!labels.includes('Prior day high'), 'no timestamps means no calendar claims');
  assert.ok(!labels.some(label => /^Asia/.test(label)));
});

test('zones report which independent sources agree with them', () => {
  const bars = history();
  const zones = detectLiquidityZones(bars, 0.1, { minZones: 3, maxZones: 7 });
  assert.ok(zones.length >= 3);
  assert.ok(zones.every(zone => Array.isArray(zone.sources)), 'every zone exposes its sources');
  assert.ok(zones.some(zone => zone.sources.length > 0), 'with ten days of history some zone must have corroborating sources');
  assert.ok(zones.every(zone => zone.sources.length <= 3), 'the label list stays readable');
  for (const zone of zones) assert.ok(zone.factors.confluence >= 0 && zone.factors.confluence <= 1);
});

test('invalid input is rejected', () => {
  assert.deepEqual(collectSourceLevels([]), []);
  assert.throws(() => collectSourceLevels(history(), { priceStep: 0 }), /Invalid source level/);
  assert.throws(() => collectSourceLevels('nope'), /Invalid source level/);
});
