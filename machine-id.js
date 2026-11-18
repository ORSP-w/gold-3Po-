import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { hostname, cpus, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';

function windowsMachineGuid() {
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    return match ? match[1] : '';
  } catch { return ''; }
}

function linuxMachineId() {
  try { return readFileSync('/etc/machine-id', 'utf8').trim(); } catch { return ''; }
}

// Stable, non-secret hardware fingerprint. Changes after an OS reinstall,
// which requires a re-issued key (documented in LICENSE-KEYS.md).
export function getMachineId() {
  const platform = process.platform;
  const guid = platform === 'win32' ? windowsMachineGuid() : platform === 'linux' ? linuxMachineId() : '';
  const parts = [guid || 'no-guid', hostname(), cpus()[0]?.model || 'cpu', String(totalmem()), platform];
  const hex = createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16).toUpperCase();
  return hex.match(/.{4}/g).join('-');
}

export function normalizeMachineId(value) {
  return String(value || '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}
