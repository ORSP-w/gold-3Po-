import path from 'node:path';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { zoneLabelRu, zoneStateRu } from '../zone-labels.js';

export function snapshotPath(commonDataPath, symbol) {
  if (!path.isAbsolute(commonDataPath) || !/^(?:XAUUSD|GOLD)[A-Z0-9._#+-]{0,20}$/i.test(symbol) || symbol.includes('..')) {
    throw new Error('Invalid MT5 common folder or gold symbol.');
  }
  return path.join(commonDataPath, 'Files', 'GOLD3PO', `${symbol}.csv`);
}

export const DEFAULT_STYLE = Object.freeze({ buyColor: '#FF0000', sellColor: '#FF0000', lineStyle: 'solid', lineWidth: 2, fill: false, showLabels: true, showStrength: true });
const LINE_STYLES = ['solid', 'dash', 'dot', 'dashdot', 'dashdotdot'];

// Settings come from the local service; anything unexpected falls back to the default red solid line.
export function normalizeStyle(style = {}) {
  const s = { ...DEFAULT_STYLE, ...(style && typeof style === 'object' ? style : {}) };
  const hex = (v, d) => /^#[0-9A-Fa-f]{6}$/.test(String(v)) ? String(v).toUpperCase() : d;
  const lineStyle = LINE_STYLES.includes(s.lineStyle) ? s.lineStyle : 'solid';
  const width = Number.isInteger(s.lineWidth) && s.lineWidth >= 1 && s.lineWidth <= 5 ? s.lineWidth : DEFAULT_STYLE.lineWidth;
  return {
    buyColor: hex(s.buyColor, DEFAULT_STYLE.buyColor), sellColor: hex(s.sellColor, DEFAULT_STYLE.sellColor),
    lineStyle, lineWidth: lineStyle === 'solid' ? width : 1,
    fill: s.fill === true, showLabels: s.showLabels !== false, showStrength: s.showStrength !== false
  };
}

const labelText = value => String(value ?? '')
  .replace(/[·•]/g, '-')
  .replace(/[,"|\\]/g, ' ')                 // the snapshot is comma-separated; bars split the tooltip
  .replace(/[\u0000-\u001F\u007F]/g, ' ')   // the indicator rejects control characters
  .replace(/\s+/g, ' ').trim().slice(0, 48) || 'Zone';

// The MT5 chart must read like the panel, so labels and states are localized before the
// snapshot is written (zone-labels.js is shared with the workspace UI).
export function encodeSnapshot(symbol, zones, now = Date.now(), style = DEFAULT_STYLE) {
  const st = normalizeStyle(style);
  const rows = zones.filter(z => /^[A-Za-z0-9._-]{1,40}$/.test(z.id) && ['buy', 'sell'].includes(z.side)
    && [z.low, z.high, z.strength].every(Number.isFinite) && z.low > 0 && z.high > z.low && z.strength >= 0 && z.strength <= 1)
    .slice(0, 20).map(z => [z.id, `${z.side}-side`, z.low, z.high, z.strength, labelText(zoneStateRu(z.state)), labelText(zoneLabelRu(z.label))].join(','));
  const styleLine = ['STYLE', st.buyColor, st.sellColor, st.lineStyle.toUpperCase(), st.lineWidth, st.fill ? 1 : 0, st.showLabels ? 1 : 0, st.showStrength ? 1 : 0].join(',');
  return [`G3P2,${Math.floor(now / 1000)},${symbol},${rows.length}`, styleLine, ...rows, 'END', ''].join('\r\n');
}

export async function publishSnapshot(commonDataPath, symbol, zones, style = DEFAULT_STYLE) {
  const target = snapshotPath(commonDataPath, symbol);
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomBytes(5).toString('hex')}.tmp`;
  try {
    await writeFile(temporary, encodeSnapshot(symbol, zones, Date.now(), style), { flag: 'wx' });
    await rename(temporary, target);
  } catch (error) {
    const { unlink } = await import('node:fs/promises');
    await unlink(temporary).catch(() => {});
    throw error;
  }
}
