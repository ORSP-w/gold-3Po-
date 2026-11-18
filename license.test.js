import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { issueLicenseKey, verifyLicenseKey, createLicenseManager, KEY_PREFIX } from './license.js';
import { createMarketServer } from './server.js';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
const MACHINE = 'AAAA-BBBB-CCCC-DDDD';
const T0 = Date.parse('2026-11-18T12:00:00.000Z');
const issue = (overrides = {}) => issueLicenseKey({ privateKeyPem, machineId: MACHINE, days: 30, nowMs: T0, ...overrides });
const verify = (key, overrides = {}) => verifyLicenseKey(key, { publicKeyPem, machineId: MACHINE, nowMs: T0 + 1000, ...overrides });

test('issued key verifies and carries edition, machine and expiry metadata', () => {
  const key = issue();
  assert.ok(key.startsWith(KEY_PREFIX + '.'));
  const result = verify(key);
  assert.equal(result.valid, true);
  assert.equal(result.payload.machine, MACHINE.replace(/-/g, ''));
  assert.equal(result.payload.days, 30);
  assert.equal(result.payload.expiresAt, T0 + 30 * 86400000);
});

test('day bounds 1 and 9999 are accepted; 0, 10000 and fractions are rejected', () => {
  for (const days of [1, 9999]) assert.equal(verify(issue({ days })).valid, true);
  for (const days of [0, 10000, -5, 1.5]) assert.throws(() => issue({ days }), /days must be an integer/);
});

test('key bound to another machine is rejected', () => {
  const result = verify(issue(), { machineId: '1111-2222-3333-4444' });
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'wrong_machine');
});

test('tampered payload breaks the signature', () => {
  const key = issue();
  const [prefix, payload, signature] = key.split('.');
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  decoded.days = 9999;
  decoded.expiresAt = decoded.issuedAt + 9999 * 86400000;
  const forged = prefix + '.' + Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url') + '.' + signature;
  const result = verify(forged);
  assert.equal(result.valid, false);
  assert.equal(result.reason, 'bad_signature');
});

test('key signed by a foreign keypair is rejected', () => {
  const foreign = generateKeyPairSync('ed25519');
  const key = issueLicenseKey({ privateKeyPem: foreign.privateKey.export({ type: 'pkcs8', format: 'pem' }), machineId: MACHINE, days: 30, nowMs: T0 });
  assert.equal(verify(key).reason, 'bad_signature');
});

test('expired and not-yet-valid keys are rejected', () => {
  const key = issue({ days: 1 });
  assert.equal(verify(key, { nowMs: T0 + 2 * 86400000 }).reason, 'expired');
  assert.equal(verify(key, { nowMs: T0 - 3600000 }).reason, 'not_yet_valid');
});

test('malformed keys are rejected without throwing', () => {
  for (const key of ['', 'garbage', 'GOLD1.abc', 'GOLD1.!!!.###', 'GOLD2.a.b']) {
    assert.equal(verify(key).valid, false);
  }
});

test('manager without a licence reports missing_license and stays invalid', async () => {
  const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile: null, stateFile: null, now: () => T0 });
  const status = await manager.status();
  assert.equal(status.valid, false);
  assert.equal(status.reason, 'missing_license');
  assert.equal(status.machineId, MACHINE);
});

test('manager activates a valid key, persists it and reloads it from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-license-'));
  try {
    const licenseFile = join(dir, 'license.json');
    const stateFile = join(dir, 'license-state.json');
    const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile, stateFile, now: () => T0 + 1000 });
    const bad = await manager.activate('GOLD1.bogus.bogus');
    assert.equal(bad.valid, false);
    const good = await manager.activate(issue());
    assert.equal(good.valid, true);
    assert.equal(good.daysLeft, 30);
    const stored = JSON.parse(await readFile(licenseFile, 'utf8'));
    assert.ok(stored.key.startsWith(KEY_PREFIX + '.'));
    const reloaded = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile, stateFile, now: () => T0 + 2000 });
    assert.equal((await reloaded.status()).valid, true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manager detects system clock rollback via persisted watermark', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gold3po-license-'));
  try {
    const stateFile = join(dir, 'state.json');
    let clock = T0 + 10 * 86400000;
    const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile: null, stateFile, initialKey: issue({ days: 60 }), now: () => clock });
    assert.equal((await manager.status()).valid, true);
    clock = T0 + 9 * 86400000; // roll back one day
    const status = await manager.status();
    assert.equal(status.valid, false);
    assert.equal(status.reason, 'clock_rollback');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('manager detects clock rollback against the external market feed time', async () => {
  const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile: null, stateFile: null, initialKey: issue({ days: 60 }), now: () => T0 });
  const feedTime = T0 + 3600000; // broker time one hour ahead of the rolled-back system clock
  const status = await manager.status(feedTime);
  assert.equal(status.valid, false);
  assert.equal(status.reason, 'clock_rollback');
});

test('required=false disables the gate for development', async () => {
  const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile: null, stateFile: null, required: false, now: () => T0 });
  const status = await manager.status();
  assert.equal(status.valid, true);
  assert.equal(status.required, false);
});

test('server gates analysis behind a licence but keeps ingest and health open', async () => {
  let clock = T0;
  const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile: null, stateFile: null, now: () => clock });
  const app = createMarketServer({ token: 'test-secret', storageFile: null, license: manager, now: () => clock });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const auth = { authorization: 'Bearer test-secret', 'content-type': 'application/json' };
  try {
    const gated = await fetch(base + '/v1/market/analysis?symbol=XAUUSD');
    assert.equal(gated.status, 402);
    assert.equal((await gated.json()).error, 'license_required');
    assert.equal((await fetch(base + '/health')).status, 200);
    const tick = { source: 'mt5', symbol: 'XAUUSD', timestamp: new Date(T0).toISOString(), sequence: 1, bid: 2648.2, ask: 2648.4, last: 2648.3, tickVolume: 1, realVolume: 0 };
    const ingest = await fetch(base + '/v1/ingest/mt5/tick', { method: 'POST', headers: auth, body: JSON.stringify(tick) });
    assert.equal(ingest.status, 202);
    const status = await (await fetch(base + '/v1/license/status')).json();
    assert.equal(status.valid, false);
    assert.equal(status.machineId, MACHINE);
    const activated = await fetch(base + '/v1/license/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: issue() }) });
    assert.equal(activated.status, 200);
    assert.equal((await activated.json()).valid, true);
    const open = await fetch(base + '/v1/market/analysis?symbol=XAUUSD');
    assert.equal(open.status, 200);
    const stream = await fetch(base + '/v1/stream');
    assert.equal(stream.status, 200);
    await stream.body.cancel();
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});

test('server rejects activation of a foreign-machine key and rate-limits attempts', async () => {
  const manager = createLicenseManager({ publicKeyPem, machineId: MACHINE, licenseFile: null, stateFile: null, now: () => T0 });
  const app = createMarketServer({ token: 'test-secret', storageFile: null, license: manager, now: () => T0 });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  try {
    const foreign = await fetch(base + '/v1/license/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: issue({ machineId: '1111-2222-3333-4444' }) }) });
    assert.equal(foreign.status, 422);
    assert.equal((await foreign.json()).reason, 'wrong_machine');
    let last;
    for (let i = 0; i < 12; i++) last = await fetch(base + '/v1/license/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'GOLD1.x.y' }) });
    assert.equal(last.status, 429);
  } finally { await new Promise(resolve => app.server.close(resolve)); }
});
