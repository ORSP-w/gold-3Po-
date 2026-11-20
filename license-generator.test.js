import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { createLicenseGenerator, normalizeMachineInput } from './tools/license-generator.js';
import { verifyLicenseKey, LICENSE_PUBLIC_KEY_PEM } from './license.js';

const MACHINE = 'A1B2C3D4E5F67890';
const MACHINE_PRETTY = 'A1B2-C3D4-E5F6-7890';

async function withGenerator(run) {
  const dir = await mkdtemp(join(tmpdir(), 'g3po-license-'));
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privateKeyPath = join(dir, 'license-private.pem');
  const issuedLogPath = join(dir, 'issued.jsonl');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
  const generator = createLicenseGenerator({ privateKeyPath, issuedLogPath, publicKeyPem, token: 'test-token' });
  await new Promise(resolve => generator.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + generator.server.address().port;
  const call = async (path, { method = 'GET', body, token = 'test-token' } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { ...(token ? { 'x-license-token': token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    const text = await response.text();
    let data = text;
    try { data = JSON.parse(text); } catch { /* html or csv */ }
    return { status: response.status, data, text };
  };
  try {
    await run({ call, base, generator, issuedLogPath, publicKeyPem, dir });
  } finally {
    await new Promise(resolve => generator.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

test('machine IDs accept dashes, spaces and lower case, and reject the wrong length', () => {
  assert.deepEqual(normalizeMachineInput(MACHINE_PRETTY), { ok: true, machine: MACHINE, pretty: MACHINE_PRETTY });
  assert.equal(normalizeMachineInput('a1b2 c3d4 e5f6 7890').machine, MACHINE);
  assert.equal(normalizeMachineInput(MACHINE).pretty, MACHINE_PRETTY);
  assert.equal(normalizeMachineInput('A1B2-C3D4').ok, false);
  assert.match(normalizeMachineInput('A1B2-C3D4').error, /16/);
  assert.equal(normalizeMachineInput('ZZZZ-C3D4-E5F6-7890').ok, false);
});

test('the one-window page is served locally and API calls need the window token', async () => {
  await withGenerator(async ({ call, base }) => {
    const page = await fetch(base + '/');
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Генератор лицензий GOLD-3Po/);
    assert.match(html, /const TOKEN = 'test-token'/);
    assert.doesNotMatch(html, /__TOKEN__/);

    assert.equal((await call('/api/state', { token: null })).status, 401);
    assert.equal((await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 30 }, token: 'wrong' })).status, 401);
    const state = await call('/api/state');
    assert.equal(state.status, 200);
    assert.equal(state.data.hasPrivateKey, true);
    assert.deepEqual(state.data.presets, [7, 30, 90, 180, 365]);
    assert.deepEqual(state.data.editions, ['pro', 'trial', 'vip']);
  });
});

test('a generated key verifies for that machine and is written to the journal', async () => {
  await withGenerator(async ({ call, issuedLogPath, publicKeyPem }) => {
    const issued = await call('/api/issue', { method: 'POST', body: { machineId: MACHINE_PRETTY, days: 90, edition: 'pro', note: 'Иван' } });
    assert.equal(issued.status, 200);
    const record = issued.data.record;
    assert.match(record.key, /^GOLD1\./);
    assert.equal(record.machinePretty, MACHINE_PRETTY);
    assert.equal(record.days, 90);
    assert.equal(record.note, 'Иван');

    const check = verifyLicenseKey(record.key, { publicKeyPem, machineId: MACHINE, nowMs: Date.now() });
    assert.equal(check.valid, true);
    assert.equal(check.payload.edition, 'pro');

    const wrongMachine = verifyLicenseKey(record.key, { publicKeyPem, machineId: '0000000000000001', nowMs: Date.now() });
    assert.equal(wrongMachine.valid, false);
    assert.equal(wrongMachine.reason, 'wrong_machine');

    // Keys must only be trusted by the vendor public key embedded in the shipped app.
    assert.equal(verifyLicenseKey(record.key, { publicKeyPem: LICENSE_PUBLIC_KEY_PEM, machineId: MACHINE, nowMs: Date.now() }).valid, false);

    const journal = (await readFile(issuedLogPath, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.equal(journal.length, 1);
    assert.equal(journal[0].key, record.key);
    assert.equal(journal[0].machineId, MACHINE);

    const state = await call('/api/state');
    assert.equal(state.data.issued.length, 1);
    assert.equal(state.data.issued[0].keyId, record.keyId);
  });
});

test('bad machine IDs, terms and editions are refused with a readable reason', async () => {
  await withGenerator(async ({ call }) => {
    const short = await call('/api/issue', { method: 'POST', body: { machineId: 'A1B2', days: 30 } });
    assert.equal(short.status, 422);
    assert.match(short.data.error, /16/);
    assert.equal((await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 0 } })).status, 422);
    assert.equal((await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 10000 } })).status, 422);
    assert.equal((await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 30, edition: 'hacker' } })).status, 422);
  });
});

test('inspect decodes a key and flags a tampered one', async () => {
  await withGenerator(async ({ call }) => {
    const { data } = await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 14 } });
    const key = data.record.key;
    const good = await call('/api/inspect', { method: 'POST', body: { key } });
    assert.equal(good.status, 200);
    assert.equal(good.data.valid, true);
    assert.equal(good.data.payload.machine, MACHINE);

    const parts = key.split('.');
    const signature = parts[2];
    // Flip a byte in the middle of the signature: the last base64 char can carry only padding bits.
    const tampered = [parts[0], parts[1], signature.slice(0, 5) + (signature[5] === 'A' ? 'B' : 'A') + signature.slice(6)].join('.');
    const bad = await call('/api/inspect', { method: 'POST', body: { key: tampered } });
    assert.equal(bad.data.valid, false);
    assert.equal(bad.data.reason, 'bad_signature');
    assert.equal((await call('/api/inspect', { method: 'POST', body: { key: 'not-a-key' } })).status, 422);
  });
});

test('the journal exports as CSV for accounting', async () => {
  await withGenerator(async ({ call }) => {
    await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 30, note: 'Иван' } });
    const csv = await call('/api/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.text, /^issued_at,machine_id,edition,days,key_id,expires_at,note,key/);
    assert.match(csv.text, /A1B2-C3D4-E5F6-7890/);
    assert.match(csv.text, /Иван/);
  });
});

test('the generator refuses to issue when the private key does not match the app public key', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'g3po-mismatch-'));
  const { privateKey } = generateKeyPairSync('ed25519');
  const otherPair = generateKeyPairSync('ed25519');
  const privateKeyPath = join(dir, 'license-private.pem');
  writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }));
  const generator = createLicenseGenerator({
    privateKeyPath,
    issuedLogPath: join(dir, 'issued.jsonl'),
    publicKeyPem: otherPair.publicKey.export({ type: 'spki', format: 'pem' }),
    token: 'test-token'
  });
  await new Promise(resolve => generator.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + generator.server.address().port;
  const call = async (path, { method = 'GET', body } = {}) => {
    const response = await fetch(base + path, { method, headers: { 'x-license-token': 'test-token', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  try {
    const state = await call('/api/state');
    assert.equal(state.data.matchesApp, false);
    assert.notEqual(state.data.derivedFingerprint, state.data.publicKeyFingerprint);
    const attempt = await call('/api/issue', { method: 'POST', body: { machineId: MACHINE, days: 30 } });
    assert.equal(attempt.status, 409);
    assert.match(attempt.data.error, /не соответствует публичному ключу/);
  } finally {
    await new Promise(resolve => generator.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test('the generator refuses requests that do not come from this machine', async () => {
  await withGenerator(async ({ generator }) => {
    const port = generator.server.address().port;
    const status = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/api/state', headers: { host: 'evil.example', 'x-license-token': 'test-token' } }, response => {
        response.resume();
        resolve(response.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 421);
  });
});
