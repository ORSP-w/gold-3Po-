import path from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';

export function snapshotPath(commonDataPath, symbol) {
  if (!path.isAbsolute(commonDataPath) || !/^(?:XAUUSD|GOLD)[A-Z0-9._#+-]{0,20}$/i.test(symbol) || symbol.includes('..')) {
    throw new Error('Invalid MT5 common folder or gold symbol.');
  }
  return path.join(commonDataPath, 'Files', 'GOLD3PO', `${symbol}.csv`);
}

export function encodeSnapshot(symbol, zones, now = Date.now()) {
  const rows = zones.filter(z => /^[A-Za-z0-9._-]{1,40}$/.test(z.id) && ['buy', 'sell'].includes(z.side)
    && [z.low, z.high, z.strength].every(Number.isFinite) && z.low > 0 && z.high > z.low && z.strength >= 0 && z.strength <= 1)
    .slice(0, 8).map(z => [z.id, `${z.side}-side`, z.low, z.high, z.strength, (String(z.state ?? '').toUpperCase().replace(/[^A-Z _-]/g, '').trim().slice(0, 32)) || 'UNTESTED'].join(','));
  return [`G3P1,${Math.floor(now / 1000)},${symbol},${rows.length}`, ...rows, 'END', ''].join('\r\n');
}

export async function publishSnapshot(commonDataPath, symbol, zones) {
  const target = snapshotPath(commonDataPath, symbol);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, encodeSnapshot(symbol, zones), { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    const { unlink } = await import('node:fs/promises');
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
