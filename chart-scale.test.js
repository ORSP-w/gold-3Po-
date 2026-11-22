import test from 'node:test';
import assert from 'node:assert/strict';
import { chartScale, minBarWidth, MIN_BAR_PX } from './chart-scale.js';

test('a laptop panel shows a moderate series at the laptop pitch', () => {
  const s = chartScale({ panelWidth: 1170, bars: 300 });
  assert.equal(s.pane, 1021);
  assert.equal(s.minBar, MIN_BAR_PX.laptop);
  assert.equal(s.width, 1021, 'the series fits, so the chart fills the panel');
  assert.ok(Math.abs(s.step - 3.4) < 0.01);
  assert.equal(s.svgWidth, 64 + 1021 + 85);
});

test('a 4K panel compresses six hundred bars into the panel instead of scrolling', () => {
  const s = chartScale({ panelWidth: 1996, bars: 600 });
  assert.equal(s.pane, 1847);
  assert.equal(s.minBar, MIN_BAR_PX.wide);
  assert.equal(s.width, 1847, 'no horizontal strip when the bars still fit at the wide pitch');
  assert.ok(s.step >= MIN_BAR_PX.wide, 'candles never get thinner than the panel minimum');
  assert.equal(s.svgWidth, 1996, 'the chart covers the whole panel');
});

test('a series too dense for the wide pitch scrolls at exactly the minimum pitch', () => {
  const s = chartScale({ panelWidth: 1996, bars: 2880 });
  assert.equal(s.width, 2880 * MIN_BAR_PX.wide);
  assert.equal(s.step, MIN_BAR_PX.wide);
  assert.ok(s.width > s.pane);
});

test('the pitch a bar may shrink to grows as the panel gets narrower', () => {
  assert.equal(minBarWidth(1847), MIN_BAR_PX.wide);
  assert.equal(minBarWidth(1600), MIN_BAR_PX.wide);
  assert.equal(minBarWidth(1599), MIN_BAR_PX.laptop);
  assert.equal(minBarWidth(900), MIN_BAR_PX.laptop);
  assert.equal(minBarWidth(899), MIN_BAR_PX.compact);
});

test('a phone chart keeps fat candles and a usable plot area', () => {
  const s = chartScale({ panelWidth: 330, bars: 60 });
  assert.equal(s.pane, 200, 'the plot area never collapses below 200px');
  assert.equal(s.minBar, MIN_BAR_PX.compact);
  assert.equal(s.step, MIN_BAR_PX.compact);
});

test('an empty series still fills the panel', () => {
  const s = chartScale({ panelWidth: 1996, bars: 0 });
  assert.equal(s.width, s.pane);
  assert.equal(s.step, s.pane);
});

test('zoom-in enlarges candle pitch and chart width', () => {
  const normal = chartScale({ panelWidth: 1996, bars: 2880 });
  const zoomed = chartScale({ panelWidth: 1996, bars: 2880, zoom: 2 });
  assert.equal(normal.step, 2);
  assert.equal(zoomed.step, 4);
  assert.equal(zoomed.width, normal.width * 2);
});

test('zoom-out compresses dense history but keeps the plot at least panel width', () => {
  const normal = chartScale({ panelWidth: 1996, bars: 2880 });
  const zoomedOut = chartScale({ panelWidth: 1996, bars: 2880, zoom: 0.5 });
  assert.ok(zoomedOut.step < normal.step);
  assert.ok(zoomedOut.width >= zoomedOut.pane);
  assert.ok(zoomedOut.width < normal.width);
});

test('zoom limits reject invalid values', () => {
  assert.throws(() => chartScale({ panelWidth: 1200, bars: 100, zoom: 0.1 }), /zoom/);
  assert.throws(() => chartScale({ panelWidth: 1200, bars: 100, zoom: 9 }), /zoom/);
  assert.throws(() => chartScale({ panelWidth: 1200, bars: 100, zoom: Number.NaN }), /zoom/);
});

test('invalid input is rejected', () => {
  assert.throws(() => chartScale({ panelWidth: 0, bars: 10 }), /panelWidth/);
  assert.throws(() => chartScale({ panelWidth: Number.NaN, bars: 10 }), /panelWidth/);
  assert.throws(() => chartScale({ panelWidth: 1200, bars: 1.5 }), /bars/);
  assert.throws(() => chartScale({ panelWidth: 1200, bars: -1 }), /bars/);
  assert.throws(() => minBarWidth(-10), /paneWidth/);
});
