import test from 'node:test';
import assert from 'node:assert/strict';
import { runBacktest } from './backtest-engine.js';

function fixture(){
 const bars=Array.from({length:45},(_,i)=>({time:new Date(Date.UTC(2026,0,1,0,i*15)).toISOString(),o:100,h:100.6,l:99.4,c:100.1,bid:10,ask:10,unknown:0,delta:0,sweeps:[],stackedImbalances:[]}));
 bars[20]={...bars[20],o:100.1,h:100.5,l:99.0,c:100.4,sweeps:[{side:'sell-side',level:99.5,reclaimed:true}]};
 bars[21]={...bars[21],o:100.4,h:101.3,l:100.2,c:101.1};
 return bars;
}
test('backtest enters after signal close and returns trades with conservative metrics',()=>{
 const result=runBacktest(fixture(),{targetR:1,stopAtr:1,initialEquity:10000,riskPct:.5});
 assert.ok(result.trades.length>=1);
 const trade=result.trades[0];
 assert.equal(trade.entryIndex,trade.signalIndex+1);
 assert.ok(trade.exitIndex>=trade.entryIndex);
 assert.ok(Number.isFinite(result.summary.finalEquity));
 assert.ok(Number.isFinite(result.summary.maxDrawdownPct));
 assert.ok(result.limitations.some(item=>item.includes('stop and target')));
});
test('backtest rejects risk settings above configured cap',()=>{
 assert.throws(()=>runBacktest(fixture(),{riskPct:2,maxRiskPct:1}),/Invalid backtest configuration/);
});
