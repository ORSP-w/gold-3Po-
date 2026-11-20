import test from 'node:test';
import assert from 'node:assert/strict';
import { measureZoneReactions } from './zone-reaction.js';

const bar = (h, l, c) => ({ h, l, c });
const zone = { low: 99, high: 101, mid: 100 };

test('a level price bounces from is measured as respected', () => {
  const bars = [bar(98, 97, 98), bar(99.5, 98, 99.5), bar(101.5, 99.4, 100.5)];
  const out = measureZoneReactions(bars, zone, { atr: 1 });
  assert.equal(out.touches, 1);
  assert.equal(out.respected, 1);
  assert.equal(out.broken, 0);
  assert.equal(out.neutral, 0);
  assert.equal(out.rate, 0.75, 'one bounce out of one touch is smoothed, not a 100% claim');
  assert.equal(out.lastTouchIndex, 2, 'the touch ends at the last candle overlapping the zone');
});

test('a level price closes through is measured as broken', () => {
  const bars = [bar(98, 97, 98), bar(99.5, 98, 99.5), bar(102.5, 100, 102)];
  const out = measureZoneReactions(bars, zone, { atr: 1 });
  assert.equal(out.touches, 1);
  assert.equal(out.broken, 1);
  assert.equal(out.respected, 0);
  assert.equal(out.rate, 0.25);
});

test('consecutive candles inside the zone count as a single touch', () => {
  const bars = [bar(98, 97, 98), bar(99.6, 98.5, 99.4), bar(100.8, 99.3, 100.2), bar(101.6, 99.9, 100.4)];
  const out = measureZoneReactions(bars, zone, { atr: 1 });
  assert.equal(out.touches, 1, 'a run inside the zone is one touch, not one per candle');
  assert.equal(out.respected, 1);
});

test('an untouched level is scored neutral instead of pretending', () => {
  const out = measureZoneReactions([bar(90, 89, 89.5), bar(91, 90, 90.5)], zone, { atr: 1 });
  assert.equal(out.touches, 0);
  assert.equal(out.rate, 0.5);
  assert.equal(out.lastTouchIndex, null);
});

test('a reaction that arrives after the horizon is not credited', () => {
  const bars = [
    bar(96, 95, 96),
    bar(99.9, 98.6, 99.1),
    bar(98.9, 98.7, 98.8),
    bar(98.9, 98.7, 98.8),
    bar(98.4, 97.6, 97.8)
  ];
  const out = measureZoneReactions(bars, zone, { atr: 1, horizon: 2 });
  assert.equal(out.touches, 1);
  assert.equal(out.neutral, 1, 'the level was left alone inside the horizon');
  assert.equal(out.respected, 0);
  assert.equal(out.rate, 0.5);
});

test('resistance is measured in the opposite direction', () => {
  const bars = [bar(103, 102, 102.5), bar(101.4, 100.2, 100.6), bar(100.8, 98.2, 99.2)];
  const out = measureZoneReactions(bars, zone, { atr: 1 });
  assert.equal(out.respected, 1, 'rejection downwards from above counts as respected');
  assert.equal(out.rate, 0.75);
});

test('thresholds and inputs are validated', () => {
  const bars = [bar(98, 97, 98)];
  assert.throws(() => measureZoneReactions(bars, zone, { atr: 0 }), /positive ATR/);
  assert.throws(() => measureZoneReactions(bars, zone, { atr: 1, horizon: 0 }), /horizon/);
  assert.throws(() => measureZoneReactions(bars, { low: 5, high: 5 }, { atr: 1 }), /Invalid zone/);
  assert.throws(() => measureZoneReactions('nope', zone, { atr: 1 }), /Invalid zone/);
  assert.throws(() => measureZoneReactions(bars, zone, { atr: 1, reactionAtr: 0 }), /thresholds/);
});
