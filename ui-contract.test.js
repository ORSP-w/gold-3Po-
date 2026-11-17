import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
test('all static action buttons are wired or explicitly delegated',()=>{const buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]);for(const attrs of buttons){const hasId=/\bid=/.test(attrs),delegated=/\bdata-mode=/.test(attrs);assert.ok(hasId||delegated,'Unwired static button: '+attrs);}});
test('every direct control ID exists in markup and has an action handler',()=>{for(const id of ['resetView','layoutButton','zonesToggle','numbersToggle','footprintModes']){assert.ok(html.includes('id="'+id+'"'),'Missing '+id);assert.ok(app.includes("$('#"+id+"')"),'No handler/query for '+id);}});
test('inactive placeholder navigation and timeframe controls are absent',()=>{assert.doesNotMatch(html,/rail-button|id="timeframes"|id="notifications"|id="settings"/);assert.doesNotMatch(app,/\$\('#timeframes'\)/);});
test('chart and footprint targets exist before the module initializes',()=>{for(const id of ['priceChart','footprintGrid','zoneList','selectedBar','selectedDelta','bidVolume','askVolume','totalVolume','imbalance','toast'])assert.ok(html.includes('id="'+id+'"'),'Missing UI target '+id);});
