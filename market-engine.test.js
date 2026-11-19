import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketAnalysis, normalizeTick, detectLiquidityZones } from './market-engine.js';

const tick=(timestamp,last,aggressorSide='unknown',sequence=1)=>({timestamp,bid:last-0.1,ask:last+0.1,last,tickVolume:99,realVolume:5,aggressorSide,sequence,source:'mt5',symbol:'XAUUSD'});
test('normalizer does not mistake repeated OTC quote volume for executed volume',()=>{
  const t=normalizeTick(tick('2026-11-17T10:01:00.000Z',2650));
  assert.equal(t.volume,1);
  assert.equal(t.direction,'unknown');
});
test('explicit aggressor trades aggregate into one candle and price ladder',()=>{
  const out=buildMarketAnalysis([
    tick('2026-11-17T10:01:00.000Z',2650,'buy'),
    tick('2026-11-17T10:02:00.000Z',2650,'buy'),
    tick('2026-11-17T10:03:00.000Z',2649.9,'sell')
  ]);
  assert.equal(out.bars.length,1);
  assert.equal(out.bars[0].tickCount,3);
  assert.equal(out.bars[0].ask,10);
  assert.equal(out.bars[0].bid,5);
  assert.equal(out.bars[0].delta,5);
  assert.equal(out.bars[0].levels.length,2);
});
test('unclassified OTC ticks remain unknown rather than fabricated bid/ask volume',()=>{
  const out=buildMarketAnalysis([tick('2026-11-17T10:01:00.000Z',2650),tick('2026-11-17T10:02:00.000Z',2650.2)]);
  assert.equal(out.bars[0].bid,0);
  assert.equal(out.bars[0].ask,0);
  assert.equal(out.bars[0].unknown,2);
  assert.equal(out.sideClassification,'only_explicit_mt5_tick_flags; otherwise_unknown');
});
test('timeframe aggregation separates bars and orders ticks chronologically',()=>{
  const out=buildMarketAnalysis([
    tick('2026-11-17T10:16:00.000Z',2651),
    tick('2026-11-17T10:01:00.000Z',2649)
  ],{intervalMs:15*60_000});
  assert.equal(out.bars.length,2);
  assert.equal(out.bars[0].o,2649);
  assert.equal(out.bars[1].c,2651);
});
test('analysis validates its inputs',()=>assert.throws(()=>buildMarketAnalysis([], {priceStep:0}),/Invalid analysis input/));

test('analysis calculates cumulative delta and leaves absorption unavailable without aggressor data',()=>{
 const out=buildMarketAnalysis([
  tick('2026-11-17T10:01:00.000Z',2650,'buy'),
  tick('2026-11-17T10:02:00.000Z',2650,'sell'),
  tick('2026-11-17T10:03:00.000Z',2650,'buy')
 ]);
 assert.equal(out.bars[0].cumulativeDelta,5);
 assert.equal(out.bars[0].absorption,false);
 assert.ok(Array.isArray(out.bars[0].stackedImbalances));
 assert.ok(Array.isArray(out.bars[0].sweeps));
});

test('liquidity detector groups repeated swing highs into buy-side pools',()=>{
 const highs=[9,10,12,10,9,10,12.1,10,9,10],bars=highs.map((h,i)=>({h,l:h-2,o:h-1,c:h-1}));
 const zones=detectLiquidityZones(bars,0.1);
 assert.ok(zones.some(z=>z.side==='buy'));
 assert.ok(zones.some(z=>z.side==='buy'&&z.high>12&&z.low<12.1));
 assert.ok(zones.every(z=>/^LQ-(buy|sell)-\d+\.\d{2}$/.test(z.id)),'zone ids must be price-stable');
});

test('liquidity detector ignores flat bars and the forming candle',()=>{
 const flat=Array.from({length:8},()=>({h:100,l:100,o:100,c:100}));
 assert.deepEqual(detectLiquidityZones(flat,0.1),[]);
 // A swing high confirmed only by the newest (forming) bar must not create a zone yet.
 const highs=[9,10,12,10,9,10,12.1,10,9],bars=highs.map(h=>({h,l:h-2,o:h-1,c:h-1}));
 const zones=detectLiquidityZones(bars,0.1);
 assert.ok(!zones.some(z=>z.high>12.05),'forming bar must not confirm the 12.1 pivot');
});

test('liquidity detector drops zones broken by a close through the far edge',()=>{
 const mk=h=>({h,l:h-2,o:h-1,c:h-1});
 const base=[9,10,12,10,9,10,12.1,10,9,10].map(mk);
 assert.ok(detectLiquidityZones(base,0.1).some(z=>z.side==='buy'));
 const broken=[...base,{h:13,l:11,o:11.5,c:12.8},{h:13.2,l:12.5,o:12.8,c:13}];
 assert.ok(!detectLiquidityZones(broken,0.1).some(z=>z.side==='buy'&&z.high<12.5),'close above the zone must consume it');
});

test('maxZones caps the number of displayed zones',()=>{
 const highs=[9,10,12,10,9,10,12.1,10,9,10,14,12,11,12,14.1,12,11,12];
 const bars=highs.map(h=>({h,l:h-2,o:h-1,c:h-1}));
 const all=detectLiquidityZones(bars,0.1,20);
 const capped=detectLiquidityZones(bars,0.1,1);
 assert.ok(all.length>=2,'fixture should produce several zones');
 assert.equal(capped.length,1);
 assert.equal(capped[0].id,all[0].id,'cap must keep the strongest zone');
 assert.deepEqual(detectLiquidityZones(bars,0.1,99),detectLiquidityZones(bars,0.1,8),'invalid cap falls back to 8');
});

test('licensed COMEX trades contribute reported exchange size and aggressor side',()=>{
 const out=buildMarketAnalysis([
  {type:'trade',source:'comex',symbol:'GCZ6',timestamp:'2026-11-17T10:01:00.000Z',price:2650,size:4,aggressorSide:'buy'},
  {type:'trade',source:'comex',symbol:'GCZ6',timestamp:'2026-11-17T10:02:00.000Z',price:2650,size:2,aggressorSide:'sell'}
 ]);
 assert.equal(out.bars[0].ask,4);
 assert.equal(out.bars[0].bid,2);
 assert.equal(out.bars[0].volume,6);
 assert.equal(out.volumeKind,'exchange_trade_size');
 assert.equal(out.sideClassification,'licensed_vendor_aggressor_side; unknown_when_unavailable');
});
