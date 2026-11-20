#!/usr/bin/env node
// Vendor-side licence generator. Opens one window in the default browser.
// Keep tools/license-private.pem offline: whoever holds it can issue keys.
//
//   npm run license-ui          # open the generator (127.0.0.1 only)
//   NO_OPEN=1 npm run license-ui
import { createServer } from 'node:http';
import { randomBytes, createPublicKey, generateKeyPairSync } from 'node:crypto';
import { readFileSync, writeFileSync, appendFileSync, existsSync, openSync, readSync, fstatSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { issueLicenseKey, verifyLicenseKey, LICENSE_PUBLIC_KEY_PEM, MIN_DAYS, MAX_DAYS } from '../license.js';
import { normalizeMachineId } from '../machine-id.js';

const MODULE_DIR = new URL('.', import.meta.url);
const PAGE_PATH = fileURLToPath(new URL('./license-generator.html', MODULE_DIR));
const DEFAULT_PRIVATE_KEY_PATH = fileURLToPath(new URL('./license-private.pem', MODULE_DIR));
const DEFAULT_LOG_PATH = fileURLToPath(new URL('./license-issued.jsonl', MODULE_DIR));
const EDITIONS = ['pro', 'trial', 'vip'];
const MAX_BODY = 16384;

export function normalizeMachineInput(value) {
  const compact = String(value ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (compact.length !== 16) return { ok: false, error: 'ID компьютера — это 16 шестнадцатеричных символов, например A1B2-C3D4-E5F6-7890.' };
  const machine = normalizeMachineId(compact);
  if (!/^[0-9A-F]{16}$/.test(machine)) return { ok: false, error: 'ID компьютера распознан не полностью. Скопируйте его из окна активации.' };
  return { ok: true, machine, pretty: machine.match(/.{4}/g).join('-') };
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) { reject(Object.assign(new Error('Слишком большой запрос.'), { status: 413 })); request.destroy(); }
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('Ожидался JSON.'), { status: 400 })); }
    });
    request.on('error', reject);
  });
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

function tailJsonl(path, limit) {
  if (!existsSync(path)) return [];
  const handle = openSync(path, 'r');
  try {
    const size = fstatSync(handle).size;
    const length = Math.min(size, limit * 900);
    const buffer = Buffer.alloc(length);
    readSync(handle, buffer, 0, length, Math.max(0, size - length));
    return buffer.toString('utf8').split('\n').filter(Boolean).slice(-limit).reverse().map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);
  } finally {
    closeSync(handle);
  }
}

export function publicPemFor(privateKeyPem) {
  try { return createPublicKey(privateKeyPem).export({ type: 'spki', format: 'pem' }).trim(); } catch { return null; }
}

export function createLicenseGenerator({ privateKeyPath = process.env.LICENSE_PRIVATE_KEY_PATH || DEFAULT_PRIVATE_KEY_PATH, issuedLogPath = process.env.LICENSE_ISSUED_LOG || DEFAULT_LOG_PATH, token = randomBytes(16).toString('hex'), publicKeyPem = LICENSE_PUBLIC_KEY_PEM } = {}) {
  const vendorKey = () => {
    if (!existsSync(privateKeyPath)) return { present: false, pem: null, derived: null, matchesApp: false };
    const pem = readFileSync(privateKeyPath, 'utf8');
    const derived = publicPemFor(pem);
    return { present: true, pem, derived, matchesApp: Boolean(derived) && derived === publicKeyPem.trim() };
  };
  const fingerprint = pem => (pem || '').split('\n').filter(line => line && !line.startsWith('-----')).join('').slice(-16);
  const state = () => {
    const key = vendorKey();
    return {
      hasPrivateKey: key.present,
      matchesApp: key.matchesApp,
      privateKeyPath,
      publicKeyFingerprint: fingerprint(publicKeyPem),
      derivedFingerprint: fingerprint(key.derived),
      derivedPublicKey: key.derived,
      minDays: MIN_DAYS,
      maxDays: MAX_DAYS,
      editions: EDITIONS,
      presets: [7, 30, 90, 180, 365]
    };
  };

  function issue({ machineId, days, edition, note }) {
    const machine = normalizeMachineInput(machineId);
    if (!machine.ok) throw Object.assign(new Error(machine.error), { status: 422 });
    const totalDays = Number(days);
    if (!Number.isInteger(totalDays) || totalDays < MIN_DAYS || totalDays > MAX_DAYS) {
      throw Object.assign(new Error(`Срок должен быть целым числом от ${MIN_DAYS} до ${MAX_DAYS} дней.`), { status: 422 });
    }
    const product = typeof edition === 'string' && edition.trim() ? edition.trim() : 'pro';
    if (!EDITIONS.includes(product)) throw Object.assign(new Error('Неизвестный тип лицензии.'), { status: 422 });
    const key = vendorKey();
    if (!key.present) throw Object.assign(new Error('Приватный ключ не найден: ' + privateKeyPath), { status: 409 });
    if (!key.matchesApp) {
      throw Object.assign(new Error('Приватный ключ не соответствует публичному ключу в приложении: выданный ключ не активируется у клиента. Сверьте пару ключей.'), { status: 409 });
    }
    const keyId = randomBytes(6).toString('hex');
    const nowMs = Date.now();
    const licence = issueLicenseKey({ privateKeyPem: key.pem, machineId: machine.machine, days: totalDays, edition: product, nowMs, keyId });
    const check = verifyLicenseKey(licence, { publicKeyPem: key.derived, machineId: machine.machine, nowMs });
    if (!check.valid) throw Object.assign(new Error('Выпущенный ключ не прошёл проверку: ' + check.reason), { status: 500 });
    const record = {
      at: new Date(nowMs).toISOString(),
      machineId: machine.machine,
      machinePretty: machine.pretty,
      edition: product,
      days: totalDays,
      keyId,
      expiresAt: new Date(nowMs + totalDays * 86400000).toISOString(),
      note: String(note ?? '').slice(0, 120),
      key: licence
    };
    appendFileSync(issuedLogPath, JSON.stringify(record) + '\n', { mode: 0o600 });
    return record;
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const host = String(request.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { sendJson(response, 421, { error: 'Генератор доступен только с этого компьютера.' }); return; }
    try {
      if (request.method === 'GET' && url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
        const page = readFileSync(PAGE_PATH, 'utf8').replaceAll('__TOKEN__', token);
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(page);
        return;
      }
      if (request.headers['x-license-token'] !== token) { sendJson(response, 401, { error: 'Нет доступа к генератору. Откройте страницу из запущенного окна.' }); return; }
      if (request.method === 'GET' && url.pathname === '/api/state') { sendJson(response, 200, { ...state(), issued: tailJsonl(issuedLogPath, 25) }); return; }
      if (request.method === 'POST' && url.pathname === '/api/issue') { sendJson(response, 200, { ok: true, record: issue(await readJson(request)) }); return; }
      if (request.method === 'POST' && url.pathname === '/api/inspect') {
        const { key } = await readJson(request);
        const parts = String(key ?? '').trim().split('.');
        if (parts.length !== 3) { sendJson(response, 422, { error: 'Это не похоже на ключ GOLD1.…' }); return; }
        let payload;
        try { payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')); } catch { sendJson(response, 422, { error: 'Не удалось прочитать данные ключа.' }); return; }
        const check = verifyLicenseKey(String(key).trim(), { publicKeyPem, machineId: payload.machine, nowMs: Date.now() });
        sendJson(response, 200, { payload, valid: check.valid, reason: check.reason ?? null });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/api/init-keypair') {
        if (existsSync(privateKeyPath)) { sendJson(response, 409, { error: 'Приватный ключ уже существует. Перезапись отозвала бы все выданные ключи.' }); return; }
        const { publicKey, privateKey } = generateKeyPairSync('ed25519');
        writeFileSync(privateKeyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
        sendJson(response, 200, { ok: true, publicKey: publicKey.export({ type: 'spki', format: 'pem' }), note: 'Вставьте этот публичный ключ в LICENSE_PUBLIC_KEY_PEM в license.js и пересоберите приложение.' });
        return;
      }
      if (request.method === 'GET' && url.pathname === '/api/export.csv') {
        const rows = tailJsonl(issuedLogPath, 100000).reverse();
        const csv = ['issued_at,machine_id,edition,days,key_id,expires_at,note,key']
          .concat(rows.map(r => [r.at, r.machinePretty, r.edition, r.days, r.keyId, r.expiresAt, r.note, r.key].map(v => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')))
          .join('\n');
        response.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="gold3po-licences.csv"' });
        response.end(csv);
        return;
      }
      sendJson(response, 404, { error: 'Неизвестный запрос.' });
    } catch (error) {
      sendJson(response, error.status || 500, { error: error.message || 'Внутренняя ошибка генератора.' });
    }
  });

  return { server, token, state, issue, privateKeyPath, issuedLogPath };
}

function openBrowser(address) {
  const command = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', address]] : process.platform === 'darwin' ? ['open', [address]] : ['xdg-open', [address]];
  try { spawn(command[0], command[1], { stdio: 'ignore', detached: true }).unref(); } catch { /* headless: the URL is printed below */ }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const port = Number(process.env.PORT || 8899);
  const generator = createLicenseGenerator();
  generator.server.listen(port, '127.0.0.1', () => {
    const address = 'http://127.0.0.1:' + generator.server.address().port;
    const status = generator.state();
    process.stdout.write('GOLD-3Po генератор лицензий: ' + address + '\n');
    process.stdout.write('Приватный ключ: ' + (status.hasPrivateKey ? status.privateKeyPath : 'НЕ НАЙДЕН — создайте пару в окне генератора') + '\n');
    process.stdout.write('Журнал выдачи: ' + generator.issuedLogPath + '\n');
    process.stdout.write('Окно генератора только для вас: не отправляйте эту ссылку клиентам.\n');
    if (process.env.NO_OPEN !== '1') openBrowser(address);
  });
}
