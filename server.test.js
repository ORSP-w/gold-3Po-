import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketServer } from './server.js';

let server; let base;
test.beforeEach(async () => { const app = createMarketServer({ token: 'test-secret', staleAfterMs: 10000, storageFile: null }); server = app.server; await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); base = 'http://127.0.0.1:' + server.address().port; });
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

test('server refuses ingestion when no secret is configured',async()=>{const app=createMarketServer({token:'',storageFile:null});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{const url='http://127.0.0.1:'+app.server.address().port;const r=await fetch(url+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});assert.equal(r.status,503);assert.equal((await r.json()).error,'ingest_not_configured');}finally{await new Promise(resolve=>app.server.close(resolve));}});
test('feed health changes to stale after the configured threshold',async()=>{let clock=1000;const app=createMarketServer({token:'test-secret',now:()=>clock,staleAfterMs:500});await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));try{const url='http://127.0.0.1:'+app.server.address().port;await fetch(url+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:JSON.stringify(mt5())});clock=2000;const h=await (await fetch(url+'/health')).json();assert.equal(h.feeds[0].status,'stale');}finally{await new Promise(resolve=>app.server.close(resolve));}});

test('oversized request bodies return 413 and server remains usable',async()=>{const huge='x'.repeat(33*1024);const r=await fetch(base+'/v1/ingest/mt5/tick',{method:'POST',headers:auth,body:huge});assert.equal(r.status,413);const h=await fetch(base+'/health');assert.equal(h.status,200);});

test('same-origin server serves market lab UI and assets',async()=>{const page=await fetch(base+'/');assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);const markup=await page.text();assert.match(markup,/market-client\.js/);for(const asset of ['/app.js','/market-data.js','/market-client.js','/styles.css']){const r=await fetch(base+asset);assert.equal(r.status,200,asset);}});

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
