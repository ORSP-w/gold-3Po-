const finite = Number.isFinite;

export function averageTrueRange(bars, index, period = 14) {
  if (!Array.isArray(bars) || !Number.isInteger(index) || index < 0 || index >= bars.length || !Number.isInteger(period) || period < 1) return null;
  const start = Math.max(0, index - period + 1);
  const ranges = [];
  for (let i = start; i <= index; i++) {
    const bar = bars[i];
    if (![bar.h, bar.l, bar.c].every(finite)) return null;
    const previousClose = i > 0 ? bars[i - 1].c : bar.c;
    ranges.push(Math.max(bar.h - bar.l, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose)));
  }
  return ranges.length ? ranges.reduce((sum, value) => sum + value, 0) / ranges.length : null;
}

export const DEFAULT_STRATEGY_CONDITIONS = {
  minScore: 0.55,
  atrPeriod: 14,
  requireRejection: false,
  requireCloseEdge: false,
  requireStacked: false,
  requireDeltaAgree: false,
  allowedSides: ['long', 'short'],
  sessionHoursUTC: null,
  minAtr: 0
};

export function validateStrategyConditions(input = {}) {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new TypeError('Strategy conditions must be an object');
  const allowed = Object.keys(DEFAULT_STRATEGY_CONDITIONS);
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new TypeError(`Unknown strategy condition: ${key}`);
  const c = { ...DEFAULT_STRATEGY_CONDITIONS, ...input };
  if (!finite(c.minScore) || c.minScore < 0 || c.minScore > 1) throw new TypeError('minScore must be between 0 and 1');
  if (!Number.isInteger(c.atrPeriod) || c.atrPeriod < 1 || c.atrPeriod > 200) throw new TypeError('atrPeriod must be an integer 1..200');
  for (const key of ['requireRejection', 'requireCloseEdge', 'requireStacked', 'requireDeltaAgree']) if (typeof c[key] !== 'boolean') throw new TypeError(`${key} must be boolean`);
  if (!Array.isArray(c.allowedSides) || !c.allowedSides.length || c.allowedSides.some(s => !['long', 'short'].includes(s))) throw new TypeError('allowedSides must be a non-empty subset of [long, short]');
  if (c.sessionHoursUTC !== null) {
    if (!Array.isArray(c.sessionHoursUTC) || c.sessionHoursUTC.length !== 2 || !c.sessionHoursUTC.every(h => Number.isInteger(h) && h >= 0 && h <= 24) || c.sessionHoursUTC[0] >= c.sessionHoursUTC[1]) throw new TypeError('sessionHoursUTC must be null or [startHour, endHour] with 0 <= start < end <= 24');
  }
  if (!finite(c.minAtr) || c.minAtr < 0) throw new TypeError('minAtr must be a non-negative number');
  return c;
}

export function generateSignals(bars, options = {}) {
  const { minScore, atrPeriod, requireRejection, requireCloseEdge, requireStacked, requireDeltaAgree, allowedSides, sessionHoursUTC, minAtr } = validateStrategyConditions(options);
  if (!Array.isArray(bars)) throw new TypeError('Invalid strategy input');
  const signals = [];
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (!Array.isArray(bar.sweeps) || !bar.sweeps.length) continue;
    if (sessionHoursUTC !== null) {
      const hour = new Date(bar.time).getUTCHours();
      if (hour < sessionHoursUTC[0] || hour >= sessionHoursUTC[1]) continue;
    }
    for (const sweep of bar.sweeps) {
      const side = sweep.side === 'sell-side' ? 'long' : sweep.side === 'buy-side' ? 'short' : null;
      if (!side || !allowedSides.includes(side)) continue;
      const range = Math.max(0, bar.h - bar.l);
      if (!range) continue;
      const bullish = bar.c > bar.o;
      const bearish = bar.c < bar.o;
      const closeLocation = (bar.c - bar.l) / range;
      const rejection = side === 'long' ? bullish : bearish;
      const closeEdge = (side === 'long' && closeLocation >= 0.65) || (side === 'short' && closeLocation <= 0.35);
      const stacked = (bar.stackedImbalances || []).some(item => item.side === (side === 'long' ? 'buy' : 'sell'));
      const directionalKnown = (bar.unknown || 0) === 0 && (bar.ask || 0) + (bar.bid || 0) > 0;
      const delta = bar.delta ?? ((bar.ask || 0) - (bar.bid || 0));
      const deltaAgrees = directionalKnown && ((side === 'long' && delta > 0) || (side === 'short' && delta < 0));
      if (requireRejection && !rejection) continue;
      if (requireCloseEdge && !closeEdge) continue;
      if (requireStacked && !stacked) continue;
      if (requireDeltaAgree && !deltaAgrees) continue;
      let score = 0.45;
      const evidence = ['Liquidity sweep and reclaim'];
      if (rejection) { score += 0.15; evidence.push('Rejection candle agrees with reversal'); }
      if (closeEdge) { score += 0.10; evidence.push('Close held near rejection edge'); }
      if (stacked) { score += 0.15; evidence.push('Stacked imbalance agrees'); }
      if (directionalKnown) {
        if (deltaAgrees) { score += 0.10; evidence.push('Aggressor delta agrees'); }
        else { score -= 0.05; evidence.push('Aggressor delta diverges'); }
      } else {
        evidence.push('Bid/Ask aggressor side unavailable');
      }
      const atr = averageTrueRange(bars, index, atrPeriod);
      if (atr !== null && atr > 0) score += 0.05;
      if (minAtr > 0 && (atr === null || atr < minAtr)) continue;
      score = Math.max(0, Math.min(0.95, score));
      if (score < minScore) continue;
      signals.push({
        id: `SIG-${index}-${side}-${sweep.level}`,
        index, time: bar.time, side, level: sweep.level,
        technicalScore: Number(score.toFixed(3)),
        probability: null,
        calibrationStatus: 'insufficient_out_of_sample_samples',
        evidence, atr
      });
    }
  }
  return signals;
}

export function attachWalkForwardCalibration(signals, closedTrades, { minSamples = 30, priorWins = 2, priorLosses = 2 } = {}) {
  if (!Array.isArray(signals) || !Array.isArray(closedTrades) || !Number.isInteger(minSamples) || minSamples < 1) throw new TypeError('Invalid calibration input');
  return signals.map(signal => {
    const prior = closedTrades.filter(trade => trade.exitIndex < signal.index && trade.side === signal.side);
    const wins = prior.filter(trade => trade.netR > 0).length;
    if (prior.length < minSamples) return { ...signal, probability: null, calibrationStatus: 'insufficient_out_of_sample_samples', calibrationSamples: prior.length };
    const probability = (wins + priorWins) / (prior.length + priorWins + priorLosses);
    return { ...signal, probability: Number(probability.toFixed(4)), calibrationStatus: 'walk_forward_historical_win_rate', calibrationSamples: prior.length };
  });
}
