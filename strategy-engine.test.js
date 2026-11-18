import test from 'node:test';
import assert from 'node:assert/strict';
import { averageTrueRange, generateSignals, attachWalkForwardCalibration } from './strategy-engine.js';

const bars = Array.from({length:40},(_,i)=>({
  time:new Date(Date.UTC(2026,0,1,0,i*15)).toISOString(),o:100+i*.02,h:100.5+i*.02,l:99.5+i*.02,c:100.1+i*.02,
  bid:20,ask:20,unknown:0,delta:0,sweeps:[],stackedImbalances:[]
}));
bars[20]={...bars[20],o:100.2,h:100.6,l:99.4,c:100.55, sweeps:[{side:'sell-side',level:99.5,reclaimed:true}],stackedImbalances:[{side:'buy',prices:[100,100.1,100.2]}],ask:30,bid:10,unknown:0,delta:20};

test('ATR is computed only from bars available at the requested index',()=>{
  assert.ok(averageTrueRange(bars,20,14)>0);
  assert.equal(averageTrueRange(bars,100,14),null);
});
test('liquidity sweep creates a scored long signal with explicit evidence',()=>{
  const signals=generateSignals(bars);
  assert.equal(signals.length,1);
  assert.equal(signals[0].side,'long');
  assert.ok(signals[0].technicalScore>=0.55);
  assert.ok(signals[0].evidence.includes('Liquidity sweep and reclaim'));
  assert.equal(signals[0].probability,null);
});
test('walk-forward calibration uses only trades closed before each signal',()=>{
  const signal={id:'s',index:50,side:'long'};
  const trades=Array.from({length:31},(_,i)=>({exitIndex:i+1,side:'long',netR:i<20?1:-1}));
  const calibrated=attachWalkForwardCalibration([signal],trades)[0];
  assert.equal(calibrated.calibrationSamples,31);
  assert.equal(calibrated.calibrationStatus,'walk_forward_historical_win_rate');
  assert.ok(calibrated.probability>0.5&&calibrated.probability<1);
  const early=attachWalkForwardCalibration([{...signal,index:10}],trades)[0];
  assert.equal(early.probability,null);
});
