#!/usr/bin/env node
// Vendor-side licence tool. NEVER ship tools/license-private.pem to customers
// and never commit it (it is gitignored). Customers only receive issued keys.
//
//   node tools/make-key.js init                 # once: create the vendor keypair
//   node tools/make-key.js issue --days 30 --machine AAAA-BBBB-CCCC-DDDD
//   node tools/make-key.js inspect --key GOLD1....
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { issueLicenseKey, verifyLicenseKey, LICENSE_PUBLIC_KEY_PEM, MIN_DAYS, MAX_DAYS } from '../license.js';
import { normalizeMachineId } from '../machine-id.js';

const PRIVATE_KEY_PATH = fileURLToPath(new URL('./license-private.pem', import.meta.url));

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { args[argv[i].slice(2)] = argv[i + 1]; i++; }
    else args._.push(argv[i]);
  }
  return args;
}

function loadPrivateKey() {
  if (!existsSync(PRIVATE_KEY_PATH)) {
    console.error('No vendor private key found. Run first:  node tools/make-key.js init');
    process.exit(1);
  }
  return readFileSync(PRIVATE_KEY_PATH, 'utf8');
}

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

if (command === 'init') {
  if (existsSync(PRIVATE_KEY_PATH)) {
    console.error('Refusing to overwrite the existing vendor private key at ' + PRIVATE_KEY_PATH);
    console.error('Overwriting it invalidates every previously issued licence key.');
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  writeFileSync(PRIVATE_KEY_PATH, privatePem, { mode: 0o600 });
  console.log('Vendor private key written to: ' + PRIVATE_KEY_PATH);
  console.log('BACK IT UP OFFLINE. It is gitignored and must never be shipped or committed.');
  console.log('\nEmbed this PUBLIC key into LICENSE_PUBLIC_KEY_PEM in license.js:\n');
  console.log(publicPem);
} else if (command === 'issue') {
  const days = Number(args.days);
  if (!Number.isInteger(days) || days < MIN_DAYS || days > MAX_DAYS) {
    console.error(`--days must be an integer between ${MIN_DAYS} and ${MAX_DAYS}`);
    process.exit(1);
  }
  const machine = normalizeMachineId(args.machine);
  if (!/^[0-9A-F]{16}$/.test(machine)) {
    console.error('--machine must be the customer machine ID shown in the app (16 hex chars, e.g. AAAA-BBBB-CCCC-DDDD)');
    process.exit(1);
  }
  const edition = typeof args.edition === 'string' && args.edition ? args.edition : 'pro';
  const keyId = randomBytes(6).toString('hex');
  const nowMs = Date.now();
  const key = issueLicenseKey({ privateKeyPem: loadPrivateKey(), machineId: machine, days, edition, nowMs, keyId });
  console.log('Licence key (send this whole string to the customer):');
  console.log(key);
  console.log('');
  console.log('Machine:   ' + machine.match(/.{4}/g).join('-'));
  console.log('Edition:   ' + edition);
  console.log('Days:      ' + days);
  console.log('Key ID:    ' + keyId);
  console.log('Issued:    ' + new Date(nowMs).toISOString());
  console.log('Expires:   ' + new Date(nowMs + days * 86400000).toISOString());
} else if (command === 'inspect') {
  if (typeof args.key !== 'string') { console.error('Usage: node tools/make-key.js inspect --key GOLD1....'); process.exit(1); }
  const parts = args.key.trim().split('.');
  if (parts.length !== 3) { console.error('Malformed key'); process.exit(1); }
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    console.log(JSON.stringify(payload, null, 2));
    const check = verifyLicenseKey(args.key, { publicKeyPem: LICENSE_PUBLIC_KEY_PEM, machineId: payload.machine, nowMs: Date.now() });
    console.log('Signature + machine + expiry check (on this machine): ' + (check.valid ? 'VALID' : 'INVALID (' + check.reason + ')'));
  } catch { console.error('Malformed key payload'); process.exit(1); }
} else {
  console.log('GOLD-3Po licence tool');
  console.log('  init                          create the vendor keypair (once)');
  console.log('  issue --days N --machine ID   issue a key for 1..9999 days, bound to one PC');
  console.log('  inspect --key GOLD1...        decode and check a key');
  process.exit(command ? 1 : 0);
}
