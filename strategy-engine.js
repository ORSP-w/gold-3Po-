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

export function generateSignals(bars, { minScore = 0.55, atrPeriod = 14 } = {}) {
  if (!Array.isArray(bars) || !finite(minScore) || minScore < 0 || minScore > 1) throw new TypeError('Invalid strategy input');
  const signals = [];
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (!Array.isArray(bar.sweeps) || !bar.sweeps.length) continue;
    for (const sweep of bar.sweeps) {
      const side = sweep.side === 'sell-side' ? 'long' : sweep.side === 'buy-side' ? 'short' : null;
      if (!side) continue;
      const range = Math.max(0, bar.h - bar.l);
      if (!range) continue;
      const bullish = bar.c > bar.o;
      const bearish = bar.c < bar.o;
      const closeLocation = (bar.c - bar.l) / range;
      const rejection = side === 'long' ? bullish : bearish;
      let score = 0.45;
      const evidence = ['Liquidity sweep and reclaim'];
      if (rejection) { score += 0.15; evidence.push('Rejection candle agrees with reversal'); }
      if ((side === 'long' && closeLocation >= 0.65) || (side === 'short' && closeLocation <= 0.35)) {
        score += 0.10; evidence.push('Close held near rejection edge');
      }
      const stacked = (bar.stackedImbalances || []).some(item => item.side === (side === 'long' ? 'buy' : 'sell'));
      if (stacked) { score += 0.15; evidence.push('Stacked imbalance agrees'); }
      const directionalKnown = (bar.unknown || 0) === 0 && (bar.ask || 0) + (bar.bid || 0) > 0;
      if (directionalKnown) {
        const delta = bar.delta ?? ((bar.ask || 0) - (bar.bid || 0));
        if ((side === 'long' && delta > 0) || (side === 'short' && delta < 0)) {
          score += 0.10; evidence.push('Aggressor delta agrees');
        } else {
          score -= 0.05; evidence.push('Aggressor delta diverges');
        }
      } else {
        evidence.push('Bid/Ask aggressor side unavailable');
      }
      const atr = averageTrueRange(bars, index, atrPeriod);
      if (atr !== null && atr > 0) score += 0.05;
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
