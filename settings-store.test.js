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

test('invalid settings are rejected', () => {
  assert.throws(() => validateSettings({ mt5: { lineWidth: 9 } }), /lineWidth/);
  assert.throws(() => validateSettings({ mt5: { lineStyle: 'wavy' } }), /lineStyle/);
  assert.throws(() => validateSettings({ mt5: { fill: 'yes' } }), /fill/);
  assert.throws(() => validateSettings({ ui: { theme: 'neon' } }), /theme/);
  assert.throws(() => validateSettings({ zones: { clusterAtr: 0 } }), /clusterAtr/);
});
