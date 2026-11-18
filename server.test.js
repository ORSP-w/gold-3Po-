import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createMarketServer } from './server.js';
import { createLicenseManager, issueLicenseKey } from './license.js';

function testLicense(now = () => Date.now()) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const machineId = 'AAAA-BBBB-CCCC-DDDD';
  const key = issueLicenseKey({ privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), machineId, days: 30, nowMs: now() });
  return createLicenseManager({ publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }), machineId, now, licenseFile: null, stateFile: null, initialKey: key });
}

let server; let base;
test.beforeEach(async () => { const app = createMarketServer({ token: 'test-secret', staleAfterMs: 10000, storageFile: null, license: testLicense() }); server = app.server; await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port; });
test.afterEach(async () => { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
const auth = { authorization: 'Bearer test-secret', 'content-type': 'application/json' };
const mt5 = (sequence=1) => ({ source:'mt5',symbol:'XAUUSD',timestamp:'2026-11-17T15:00:00.000Z',sequence,bid:2648.2,ask:2648.4,last:2648.3,tickVolume:1,realVolume:0 });
const comex = (sequence=1) => ({ source:'comex',symbol:'GCZ6',timestamp:'2026-11-17T15:00:00.000Z',sequence,tradeId:'trade-'+sequence,price:2650.1,size:2,aggressorSide:'buy' });
test('health endpoint reports configured but initially empty feeds',async()=>{const r=await fetch(base+'/health');const b=await r.json();assert.equal(r.status,200);assert.equal(b.status,'ok');assert.equal(b.ingestConfigured,true);assert.equal(b.eventCount,0);});
test('MT5 tick is authenticated, normalized and visible in snapshot',async()=>{const r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});const b=await r.json();assert.equal(r.status,202);assert.equal(b.event.venue,'broker_otc');assert.equal(b.event.volumeKind,'broker_tick_or_reported_volume');const s=await fetch(base+'/v1/market/snapshot?symbol=XAUUSD');const snap=await s.json();assert.equal(snap.count,1);assert.equal(snap.events[0].last,2648.3);});
test('COMEX trade preserves trade size and aggressor side',async()=>{const r=await fetch(base+'/v1/ingest/comex/trade',{method:'POST',headers:auth,body:JSON.stringify(comex())});const b=await r.json();assert.equal(r.status,202);assert.equal(b.event.venue,'comex_futures');assert.equal(b.event.size,2);assert.equal(b.event.aggressorSide,'buy');});
test('ingest rejects missing or incorrect bearer token',async()=>{for(const headers of [{'content-type':'application/json'},{...auth,authorization:'Bearer wrong'}]){const r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers,body:JSON.stringify(mt5())});assert.equal(r.status,401);}});
test('invalid market event is rejected without mutating sequence state',async()=>{const bad={...mt5(),ask:2640,bid:2650};let r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(bad)});assert.equal(r.status,422);r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});assert.equal(r.status,202);});
test('duplicate and out-of-order sequences are rejected',async()=>{let r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5(5))});assert.equal(r.status,202);r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5(5))});assert.equal(r.status,409);r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5(4))});assert.equal(r.status,409);});
test('snapshot filters by symbol and bounded event limit',async()=>{for(const event of [mt5(1),mt5(2),comex(1)]){const path=event.source==='mt5'?'/v1/ingest/mt5/tick':'/v1/ingest/comex/trade';await fetch(base+path,{method:'POST',headers:auth,body:JSON.stringify(event)});}const r=await fetch(base+'/v1/market/snapshot?symbol=XAUUSD&limit=1');const b=await r.json();assert.equal(b.count,1);assert.equal(b.events[0].sequence,2);});

test('SSE stream remains subscribed and receives normalized market events',async()=>{const response=await fetch(base+'/v1/stream');assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);const reader=response.body.getReader();const first=await reader.read();assert.match(new TextDecoder().decode(first.value),/event: ready/);await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});const next=await reader.read();assert.match(new TextDecoder().decode(next.value),/event: market/);await reader.cancel();});

test('server refuses ingestion when no secret is configured',async()=>{const app=createMarketServer({token:'',storageFile:null,license:testLicense()});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{const url='http://127.0.0.1:'+app.server.address().port;const r=await fetch(url+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});assert.equal(r.status,503);assert.equal((await r.json()).error,'ingest_not_configured');}finally{await new Promise(resolve=>app.server.close(resolve));}});
test('feed health changes to stale after the configured threshold',async()=>{let clock=1000;const app=createMarketServer({token:'test-secret',now:()=>clock,staleAfterMs:500,license:testLicense(()=>clock)});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{const url='http://127.0.0.1:'+app.server.address().port;await fetch(url+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});clock=2000;const h=await (await fetch(url+'/health')).json();assert.equal(h.feeds[0].status,'stale');}finally{await new Promise(resolve=>app.server.close(resolve));}});

test('oversized request bodies return 413 and server remains usable',async()=>{const huge='x'.repeat(1025*1024);const r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:huge});assert.equal(r.status,413);const h=await fetch(base+'/health');assert.equal(h.status,200);});

test('same-origin server serves market lab UI and assets',async()=>{const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);const markup=await page.text();assert.match(markup,/market-client\.js/);for(const asset of ['/app.js','/market-data.js','/market-client.js','/market-engine.js','/styles.css']){const r=await fetch(base+asset);assert.equal(r.status,200,asset);}});

test('MT5 history batches are authenticated and aggregated into candles and footprint levels',async()=>{
 const ticks=[1,2].map(sequence=>({timestamp:'2026-11-17T15:0'+sequence+':00.000Z',sequence,bid:2648,ask:2648.2,last:2648.1,tickVolume:10,realVolume:0,flags:0}));
 const r=await fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:auth,body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks})});
 const body=await r.json();assert.equal(r.status,202);assert.equal(body.accepted,2);
 const a=await fetch(base+'/v1/market/analysis?symbol=XAUUSD&intervalMs=900000');const data=await a.json();
 assert.equal(a.status,200);assert.equal(data.bars.length,1);assert.equal(data.bars[0].tickCount,2);assert.equal(data.bars[0].unknown,2);assert.equal(data.bars[0].ask,0);assert.equal(data.bars[0].levels.length,1);
});
test('MT5 history endpoint rejects oversized batches and missing authentication',async()=>{
 const body=JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks:[mt5()]});
 const noAuth=await fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(noAuth.status,401);
 const tooMany=Array.from({length:1001},(_,i)=>({...mt5(i+1)}));
 const large=await fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:auth,body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks:tooMany})});assert.equal(large.status,422);
});

test('re-importing MT5 history is idempotent even when the rolling history sequence changes',async()=>{
 const ticks=[1,2].map(sequence=>({timestamp:'2026-11-17T15:0'+sequence+':00.000Z',sequence,eventId:'XAUUSD-history-'+sequence,bid:2648,ask:2648.2,last:2648.1,tickVolume:10,realVolume:0,flags:0}));
 const send=items=>fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:auth,body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks:items})});
 const first=await (await send(ticks)).json();assert.equal(first.accepted,2);assert.equal(first.duplicates,0);
 const shifted=ticks.map(tick=>({...tick,sequence:tick.sequence+1000}));
 const second=await (await send(shifted)).json();assert.equal(second.accepted,0);assert.equal(second.duplicates,2);
 const live=mt5(1);live.timestamp='2026-11-17T16:00:00.000Z';
 const liveResponse=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(live)});
 assert.equal(liveResponse.status,202,'historical batch sequences must not block the independent live sequence');
});
test('replay returns chronologically aggregated historical bars for a requested range',async()=>{
 const ticks=[1,2,3].map(sequence=>({timestamp:'2026-11-17T15:0'+sequence+':00.000Z',sequence,bid:2648,ask:2648.2,last:2648.1,tickVolume:1,realVolume:0,flags:0}));
 await fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:auth,body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks})});
 const response=await fetch(base+'/v1/market/replay?symbol=XAUUSD&from=2026-11-17T15:00:00.000Z&to=2026-11-17T16:00:00.000Z');
 const data=await response.json();assert.equal(response.status,200);assert.equal(data.eventCount,3);assert.equal(data.bars.length,1);assert.equal(data.bars[0].tickCount,3);
});
test('backtest and signal monitor endpoints return explicit empty-history states',async()=>{
 const [backtest,signals]=await Promise.all([
  fetch(base+'/v1/market/backtest?symbol=XAUUSD'),
  fetch(base+'/v1/market/signals?symbol=XAUUSD')
 ]);
 const bt=await backtest.json(),sig=await signals.json();
 assert.equal(backtest.status,200);assert.equal(bt.summary.trades,0);assert.equal(bt.summary.winRate,null);
 assert.equal(signals.status,200);assert.equal(sig.latest,null);assert.equal(sig.calibration.minimumSamples,30);
});
test('risk endpoint enforces sizing and reward-risk guardrails',async()=>{
 const ok=await (await fetch(base+'/v1/risk/plan?equity=10000&riskPct=0.5&entry=2650&stop=2645&target=2660&pointValue=1')).json();
 const blocked=await (await fetch(base+'/v1/risk/plan?equity=10000&riskPct=2&entry=2650&stop=2645&target=2652&pointValue=1')).json();
 assert.equal(ok.allowed,true);assert.equal(ok.quantity,10);assert.equal(blocked.allowed,false);
});

test('live MT5 batch preserves sequence order and safely retries an already ingested payload',async()=>{
 const ticks=[1,2].map(sequence=>({timestamp:'2026-11-17T17:0'+sequence+':00.000Z',sequence:100+sequence,eventId:'LIVE-'+(100+sequence),bid:2648,ask:2648.2,last:2648.1,tickVolume:1,realVolume:0,flags:0}));
 const send=()=>fetch(base+'/v1/ingest/mt5/live-batch',{method:'POST',headers:auth,body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks})});
 const first=await (await send()).json();assert.equal(first.accepted,2);assert.equal(first.duplicates,0);assert.equal(first.lastAcceptedSequence,102);
 const retry=await (await send()).json();assert.equal(retry.accepted,0);assert.equal(retry.duplicates,2);
});
test('COMEX events can be analysed as actual exchange trades, not broker quotes',async()=>{
 const event={source:'comex',symbol:'GCZ6',timestamp:'2026-11-17T18:00:00.000Z',sequence:1,tradeId:'gc-trade-1',price:2650.1,size:3,aggressorSide:'buy'};
 const ingest=await fetch(base+'/v1/ingest/comex/trade',{method:'POST',headers:auth,body:JSON.stringify(event)});
 assert.equal(ingest.status,202);
 const response=await fetch(base+'/v1/market/analysis?source=comex&symbol=GCZ6&intervalMs=900000');
 const analysis=await response.json();assert.equal(response.status,200);assert.equal(analysis.source,'comex');assert.equal(analysis.bars[0].volume,3);assert.equal(analysis.volumeKind,'exchange_trade_size');
});
