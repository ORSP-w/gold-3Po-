import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { WORKER_LAYOUTS, workerPath } from './mt5-runtime.js';

const resources = path.join('/app', 'resources');
const nested = path.join(resources, 'mt5-runtime', 'gold3po-mt5', 'gold3po-mt5.exe');
const flat = path.join(resources, 'mt5-runtime', 'gold3po-mt5.exe');

test('the connector is found in the PyInstaller onedir folder the build actually creates', () => {
  assert.equal(workerPath(resources, candidate => candidate === nested), nested);
});

test('a onefile build is honoured too, so switching the packaging cannot break the window', () => {
  assert.equal(workerPath(resources, candidate => candidate === flat), flat);
});

test('a missing connector is reported at the place the build is expected to put it', () => {
  assert.equal(workerPath(resources, () => false), nested);
});

test('the layouts are relative paths inside the packaged resources', () => {
  for (const parts of WORKER_LAYOUTS) {
    assert.equal(parts[0], 'mt5-runtime');
    assert.ok(!path.isAbsolute(parts.join('/')));
  }
});
