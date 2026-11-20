import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSettingsStore, validateSettings, DEFAULT_SETTINGS } from './settings-store.js';

test('defaults draw red solid zone lines and look for 3..7 zones', () => {
  const s = validateSettings({});
  assert.equal(s.mt5.buyColor, '#FF0000');
  assert.equal(s.mt5.sellColor, '#FF0000');
  assert.equal(s.mt5.lineStyle, 'solid');
  assert.equal(s.zones.minZones, 3);
  assert.equal(s.zones.maxZones, 7);
  assert.deepEqual(s, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)));
});

test('settings persist across restarts and a broken file falls back to defaults', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g3p-settings-'));
  try {
    const file = join(dir, 'settings.json');
    await createSettingsStore({ file }).update({ mt5: { buyColor: '#ff8800', showLabels: false }, zones: { pivotWidth: 3 } });
    const again = await createSettingsStore({ file }).get();
    assert.equal(again.mt5.buyColor, '#FF8800');
    assert.equal(again.mt5.showLabels, false);
    assert.equal(again.zones.pivotWidth, 3);
    assert.equal(JSON.parse(await readFile(file, 'utf8')).zones.pivotWidth, 3);
    await writeFile(file, '{not json');
    assert.equal((await createSettingsStore({ file }).get()).mt5.buyColor, '#FF0000');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('zone sources and measurement windows persist, so the switches reach the engine', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g3p-settings-'));
  try {
    const file = join(dir, 'settings.json');
    await createSettingsStore({ file }).update({
      zones: { atrPeriod: 21, reactionBars: 10, useVolume: false, useSessions: false, useWeek: false }
    });
    const saved = (await createSettingsStore({ file }).get()).zones;
    assert.equal(saved.atrPeriod, 21);
    assert.equal(saved.reactionBars, 10);
    assert.equal(saved.useVolume, false);
    assert.equal(saved.useSessions, false);
    assert.equal(saved.useWeek, false);
    assert.equal(saved.usePriorDay, true, 'untouched sources keep their default');
    assert.equal(saved.useHigherTf, true);
    const onDisk = JSON.parse(await readFile(file, 'utf8')).zones;
    assert.equal(onDisk.useVolume, false, 'the switch is written to disk, not only returned');
    assert.equal(onDisk.reactionBars, 10);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('invalid settings are rejected', () => {
  assert.throws(() => validateSettings({ mt5: { lineWidth: 9 } }), /lineWidth/);
  assert.throws(() => validateSettings({ mt5: { lineStyle: 'wavy' } }), /lineStyle/);
  assert.throws(() => validateSettings({ mt5: { fill: 'yes' } }), /fill/);
  assert.throws(() => validateSettings({ ui: { theme: 'neon' } }), /theme/);
  assert.throws(() => validateSettings({ zones: { clusterAtr: 0 } }), /clusterAtr/);
  assert.throws(() => validateSettings({ zones: { atrPeriod: 1 } }), /atrPeriod/);
  assert.throws(() => validateSettings({ zones: { reactionBars: 0 } }), /reactionBars/);
  assert.throws(() => validateSettings({ zones: { useVolume: 'да' } }), /useVolume/);
});
