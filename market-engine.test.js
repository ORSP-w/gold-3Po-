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
  assert.equal(out.sideClassification,'only_explicit_aggressor_flags; otherwise_unknown');
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
 const highs=[9,10,12,10,9,10,12.1,10,9],bars=highs.map((h,i)=>({h,l:h-2,o:h-1,c:h-1}));
 const zones=detectLiquidityZones(bars,0.1);
 assert.ok(zones.some(z=>z.side==='buy'));
 assert.ok(zones.some(z=>z.side==='buy'&&z.high>12&&z.low<12.1));
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
});
