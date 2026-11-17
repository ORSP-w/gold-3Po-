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

export function buildMarketAnalysis(events, { intervalMs = 15 * 60_000, priceStep = 0.1, limit = 10000 } = {}) {
  if (!Array.isArray(events) || !finite(intervalMs) || intervalMs <= 0 || !finite(priceStep) || priceStep <= 0) throw new TypeError('Invalid analysis input');
  const ticks = events.map(e => normalizeTick(e)).sort((a,b) => a.time-b.time).slice(-1000000);
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
  let cumulativeDelta = 0;
  const result = [...bars.values()].slice(-Math.max(1,limit)).map((bar, barIndex, allBars) => {
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
    cumulativeDelta += delta;
    const stacked = [];
    for (const side of ['buy','sell']) {
      let run=[];
      for (let j=0;j<levels.length;j++) {
        const level=levels[j], adjacent=side==='buy'?levels[j+1]:levels[j-1];
        const ratio=side==='buy'?level.ask/Math.max(1,adjacent?.bid||0):level.bid/Math.max(1,adjacent?.ask||0);
        const active=side==='buy'?level.ask>=3&&ratio>=3:level.bid>=3&&ratio>=3;
        if(active) run.push(level.price); else { if(run.length>=3) stacked.push({side,prices:run}); run=[]; }
      }
      if(run.length>=3) stacked.push({side,prices:run});
    }
    const prior=allBars.slice(Math.max(0,barIndex-20),barIndex);
    const priorHigh=prior.length?Math.max(...prior.map(x=>x.h)):null,priorLow=prior.length?Math.min(...prior.map(x=>x.l)):null;
    const sweeps=[];
    if(priorHigh!==null&&bar.h>priorHigh&&bar.c<priorHigh)sweeps.push({side:'buy-side',level:priorHigh,reclaimed:true});
    if(priorLow!==null&&bar.l<priorLow&&bar.c>priorLow)sweeps.push({side:'sell-side',level:priorLow,reclaimed:true});
    const range=Math.max(0,bar.h-bar.l),body=Math.abs(bar.c-bar.o),directionalKnown=bar.unknown===0&&total>0;
    const absorption=directionalKnown&&total>=3&&range>0&&body/range<=0.25&&Math.abs(delta)/total<=0.2;
    const exhaustion=directionalKnown&&total>=3&&Math.abs(delta)/total>=0.7&&range<=priceStep*5;
    return {time:bar.time,timeMs:bar.timeMs,o:bar.o,h:bar.h,l:bar.l,c:bar.c,tickCount:bar.tickCount,volume:total,bid:bar.bid,ask:bar.ask,unknown:bar.unknown,delta,cumulativeDelta,levels,imbalances,stackedImbalances:stacked,sweeps,absorption,exhaustion};
  });
  const zones = detectLiquidityZones(result, priceStep);
  return { bars:result, zones, tickCount:ticks.length, volumeKind:'tick_activity_for_unknown_side; broker_reported_volume_only_with_explicit_aggressor', sideClassification:'only_explicit_aggressor_flags; otherwise_unknown', generatedAt:new Date().toISOString() };
}

export function detectLiquidityZones(bars, priceStep = 0.1) {
  if (!Array.isArray(bars) || !finite(priceStep) || priceStep <= 0) throw new TypeError('Invalid liquidity input');
  if (bars.length < 5) return [];
  const pivots = [];
  for (let i=2;i<bars.length-2;i++) {
    const b=bars[i], prev=bars.slice(i-2,i), next=bars.slice(i+1,i+3);
    if (prev.every(x=>b.h>=x.h) && next.every(x=>b.h>=x.h)) pivots.push({side:'buy',price:b.h,index:i});
    if (prev.every(x=>b.l<=x.l) && next.every(x=>b.l<=x.l)) pivots.push({side:'sell',price:b.l,index:i});
  }
  const groups=[];
  for(const pivot of pivots.sort((a,b)=>a.price-b.price)){
    let group=groups.find(g=>g.side===pivot.side && Math.abs(g.price-pivot.price)<=priceStep*3);
    if(!group){group={side:pivot.side,prices:[],indices:[]};groups.push(group);}
    group.prices.push(pivot.price);group.indices.push(pivot.index);group.price=group.prices.reduce((a,b)=>a+b,0)/group.prices.length;
  }
  const last=bars.at(-1).c;
  return groups.filter(g=>g.indices.length>=2).map((g,i)=>{
    const low=Math.min(...g.prices)-priceStep,high=Math.max(...g.prices)+priceStep;
    const strength=Math.min(0.98,0.45+g.indices.length*0.12);
    const distance=g.price-last;
    return {id:'LQ-'+g.side+'-'+i,side:g.side,low,high,strength,label:g.side==='buy'?'Repeated swing highs':'Repeated swing lows',distance:(distance>0?'+':'')+distance.toFixed(2),state:Math.abs(distance)<=priceStep*5?'NEAR PRICE':'UNTESTED'};
  }).sort((a,b)=>b.strength-a.strength).slice(0,8);
}
