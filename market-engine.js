const finite = n => Number.isFinite(n);
const floorTime = (ms, interval) => Math.floor(ms / interval) * interval;

export function normalizeTick(input) {
  const time = Date.parse(input.timestamp);
  if (!Number.isFinite(time) || !finite(input.bid) || !finite(input.ask) || input.bid <= 0 || input.ask < input.bid) throw new TypeError('Invalid tick timestamp or quote');
  const last = finite(input.last) && input.last > 0 ? input.last : (input.bid + input.ask) / 2;
  const direction = ['buy','sell','unknown'].includes(input.aggressorSide) ? input.aggressorSide : 'unknown';
  const volume = direction !== 'unknown' ? (finite(input.realVolume) && input.realVolume > 0 ? input.realVolume : finite(input.tickVolume) && input.tickVolume > 0 ? input.tickVolume : 1) : 1;
  return { timestamp: new Date(time).toISOString(), time, bid: input.bid, ask: input.ask, last, volume, direction, source: input.source || 'mt5', symbol: String(input.symbol || 'XAUUSD').toUpperCase() };
}

export function buildMarketAnalysis(events, { intervalMs = 15 * 60_000, priceStep = 0.1, limit = 2000 } = {}) {
  if (!Array.isArray(events) || !finite(intervalMs) || intervalMs <= 0 || !finite(priceStep) || priceStep <= 0) throw new TypeError('Invalid analysis input');
  const ticks = events.map(e => normalizeTick(e)).sort((a,b) => a.time-b.time).slice(-200000);
  const bars = new Map();
  for (const t of ticks) {
    const start = floorTime(t.time, intervalMs);
    let bar = bars.get(start);
    if (!bar) { bar = { time: new Date(start).toISOString(), timeMs: start, o:t.last, h:t.last, l:t.last, c:t.last, tickCount:0, volume:0, bid:0, ask:0, unknown:0, levels:new Map() }; bars.set(start,bar); }
    bar.h = Math.max(bar.h,t.last); bar.l = Math.min(bar.l,t.last); bar.c=t.last; bar.tickCount++; bar.volume += t.volume;
    const levelPrice = Math.round(t.last / priceStep) * priceStep;
    const key = levelPrice.toFixed(8);
    let level = bar.levels.get(key);
    if (!level) { level={price:levelPrice,bid:0,ask:0,unknown:0}; bar.levels.set(key,level); }
    if (t.direction === 'buy') { level.ask += t.volume; bar.ask += t.volume; }
    else if (t.direction === 'sell') { level.bid += t.volume; bar.bid += t.volume; }
    else { level.unknown += t.volume; bar.unknown += t.volume; }
  }
  const result = [...bars.values()].slice(-Math.max(1,limit)).map(bar => {
    const levels=[...bar.levels.values()].sort((a,b)=>b.price-a.price);
    const total=bar.bid+bar.ask+bar.unknown;
    const delta=bar.ask-bar.bid;
    const imbalances=[];
    for(let i=0;i<levels.length-1;i++){
      const a=levels[i], b=levels[i+1];
      const askRatio=a.ask/Math.max(1,b.bid), bidRatio=b.bid/Math.max(1,a.ask);
      if(a.ask>=3 && askRatio>=3) imbalances.push({side:'buy',price:a.price,ratio:Number(askRatio.toFixed(2))});
      if(b.bid>=3 && bidRatio>=3) imbalances.push({side:'sell',price:b.price,ratio:Number(bidRatio.toFixed(2))});
    }
    return { time:bar.time,timeMs:bar.timeMs,o:bar.o,h:bar.h,l:bar.l,c:bar.c,tickCount:bar.tickCount,volume:total,bid:bar.bid,ask:bar.ask,unknown:bar.unknown,delta,levels,imbalances };
  });
  return { bars:result, tickCount:ticks.length, volumeKind:'broker_tick_volume_or_reported_volume', sideClassification:'only_explicit_aggressor_flags; otherwise_unknown', generatedAt:new Date().toISOString() };
}
