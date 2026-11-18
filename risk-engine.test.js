import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRiskPlan } from './risk-engine.js';

test('risk plan calculates size and approves a valid 2R setup',()=>{
 const plan=calculateRiskPlan({equity:10000,riskPct:.5,entry:2650,stop:2645,target:2660,pointValue:1});
 assert.equal(plan.allowed,true);
 assert.equal(plan.direction,'long');
 assert.equal(plan.riskAmount,50);
 assert.equal(plan.quantity,10);
 assert.equal(plan.riskReward,2);
});
test('risk guard blocks excess risk and poor reward-to-risk',()=>{
 const plan=calculateRiskPlan({equity:10000,riskPct:2,entry:2650,stop:2645,target:2652,pointValue:1,maxRiskPct:1,minRiskReward:1.5});
 assert.equal(plan.allowed,false);
 assert.equal(plan.checks.every(x=>x.passed),false);
});
test('risk planner rejects invalid geometry',()=>{
 assert.throws(()=>calculateRiskPlan({equity:10000,riskPct:1,entry:2650,stop:2640,target:2645,pointValue:1}),/positive finite/);
});
