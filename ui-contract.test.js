import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
test('all static action buttons are wired or explicitly delegated',()=>{const buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]);for(const attrs of buttons){const hasId=/\bid=/.test(attrs),delegated=/\bdata-mode=/.test(attrs);assert.ok(hasId||delegated,'Unwired static button: '+attrs);}});
test('every direct control ID exists in markup and has an action handler',()=>{for(const id of ['resetView','layoutButton','zonesToggle','numbersToggle','footprintModes']){assert.ok(html.includes('id="'+id+'"'),'Missing '+id);assert.ok(app.includes("$('#"+id+"')"),'No handler/query for '+id);}});
test('inactive placeholder navigation and timeframe controls are absent',()=>{assert.doesNotMatch(html,/rail-button|id="timeframes"|id="notifications"|id="settings"/);assert.doesNotMatch(app,/\$\('#timeframes'\)/);});
test('chart and footprint targets exist before the module initializes',()=>{for(const id of ['priceChart','footprintGrid','zoneList','selectedBar','selectedDelta','bidVolume','askVolume','totalVolume','imbalance','toast'])assert.ok(html.includes('id="'+id+'"'),'Missing UI target '+id);});

test('liquidity zone rows are wired to selection and workspace reset clears selection',()=>{assert.ok(app.includes('selectedZone=selectedZone===n.dataset.zone?null:n.dataset.zone'));assert.ok(app.includes('renderZones();renderChart();'));assert.match(app,/selectedZone=null/);});

test('live feed status client uses same-origin health and SSE endpoints',async()=>{const client=await readFile(new URL('./market-client.js',import.meta.url),'utf8');assert.match(html,/id="apiStatus"/);assert.match(html,/id="mt5Status"/);assert.match(html,/id="comexStatus"/);assert.match(client,/fetch\('\/health'/);assert.match(client,/new EventSource\('\/v1\/stream'/);assert.match(client,/window\.setInterval\(refreshHealth,\s*5000\)/);});

test('research controls are wired to replay, backtest, risk and alert actions',async()=>{
 const client=await readFile(new URL('./research-client.js',import.meta.url),'utf8');
 for(const id of ['replayFrom','replayTo','replaySlider','replayPosition','backtestSummary','riskResult','signalMonitor'])assert.ok(html.includes('id="'+id+'"'),'Missing research target '+id);
 for(const id of ['loadReplay','playReplay','pauseReplay','liveView','replaySlider','runBacktest','calculateRisk','enableAlerts'])assert.ok(client.includes("$('"+id+"')?.addEventListener"),'Research control has no handler: '+id);
 assert.match(client,/\/v1\/market\/replay/);
 assert.match(client,/\/v1\/market\/backtest/);
 assert.match(client,/\/v1\/risk\/plan/);
 assert.match(client,/\/v1\/market\/signals/);
});


test('Vesper palette is applied consistently',()=>{
  for (const color of ['#101010','#161616','#1c1c1c','#ffc799','#99ffe4','#ff8080']) assert.ok(styles.includes(color),'Missing Vesper palette color '+color);
  assert.match(html,/theme-color" content="#101010"/);
});
