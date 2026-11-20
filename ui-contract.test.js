import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('./app.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('./styles.css', import.meta.url), 'utf8');
test('all static action buttons are wired or explicitly delegated',()=>{const buttons=[...html.matchAll(/<button\b([^>]*)>/g)].map(m=>m[1]);for(const attrs of buttons){const hasId=/\bid=/.test(attrs),delegated=/\bdata-(mode|go|tab|value|color)=/.test(attrs);assert.ok(hasId||delegated,'Unwired static button: '+attrs);}});
test('every direct control ID exists in markup and has an action handler',()=>{for(const id of ['resetView','layoutButton','zonesToggle','numbersToggle','footprintModes']){assert.ok(html.includes('id="'+id+'"'),'Missing '+id);assert.ok(app.includes("$('#"+id+"')"),'No handler/query for '+id);}});
test('inactive placeholder navigation and timeframe controls are absent',()=>{assert.doesNotMatch(html,/rail-button|id="timeframes"|id="notifications"|id="settings"/);assert.doesNotMatch(app,/\$\('#timeframes'\)/);});
test('chart and footprint targets exist before the module initializes',()=>{for(const id of ['priceChart','footprintGrid','zoneList','selectedBar','selectedDelta','bidVolume','askVolume','totalVolume','unknownVolume','imbalance','toast'])assert.ok(html.includes('id="'+id+'"'),'Missing UI target '+id);});

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

test('licence gate and setup library controls are wired',async()=>{
  const licenseClient=await readFile(new URL('./license-client.js',import.meta.url),'utf8');
  const setupsClient=await readFile(new URL('./setups-client.js',import.meta.url),'utf8');
  for(const id of ['licenseGate','licenseMachineId','licenseKeyInput','activateLicense','copyMachineId','licenseStatus'])assert.ok(html.includes('id="'+id+'"'),'Missing licence target '+id);
  for(const id of ['activateLicense','copyMachineId'])assert.ok(licenseClient.includes("$('#"+id+"')?.addEventListener")||licenseClient.includes("document.querySelector('#"+id+"')?.addEventListener"),'Licence control has no handler: '+id);
  assert.match(licenseClient,/\/v1\/license\/status/);
  assert.match(licenseClient,/\/v1\/license\/activate/);
  for(const id of ['setupSelect','setupName','saveSetup','applySetup','exportSetup','importSetup','importSetupFile','setupStatus','condMinScore','condRejection','condStacked'])assert.ok(html.includes('id="'+id+'"'),'Missing setup target '+id);
  for(const id of ['saveSetup','applySetup','exportSetup','importSetup','importSetupFile'])assert.ok(setupsClient.includes("$('"+id+"')?.addEventListener"),'Setup control has no handler: '+id);
  assert.match(setupsClient,/\/v1\/setups/);
  assert.match(html,/setups-client\.js/);
});

test('MT5 connection dialog, tray-safe bridge and indicator installer are wired',async()=>{
  const mt5Client=await readFile(new URL('./mt5-client.js',import.meta.url),'utf8');
  const preload=await readFile(new URL('./electron/preload.cjs',import.meta.url),'utf8');
  const main=await readFile(new URL('./electron/main.js',import.meta.url),'utf8');
  for(const id of ['mt5Open','mt5Dialog','mt5Close','mt5Form','mt5Terminal','mt5Browse','mt5Connect','mt5Disconnect','mt5InstallIndicator','mt5Detail','mt5Password','marketSymbol'])assert.ok(html.includes('id="'+id+'"'),'Missing MT5 target '+id);
  for(const id of ['mt5Open','mt5Close','mt5Browse','mt5Disconnect','mt5InstallIndicator'])assert.ok(mt5Client.includes("$('"+id+"').addEventListener"),'MT5 control has no handler: '+id);
  assert.match(mt5Client,/mt5Form.*addEventListener\('submit'|form\.addEventListener\('submit'/s);
  assert.match(mt5Client,/type="password"|mt5Password/);
  for(const channel of ['mt5:state','mt5:choose-terminal','mt5:connect','mt5:disconnect','mt5:install-indicator']){
    assert.ok(preload.includes(channel),'Preload missing '+channel);
  }
  assert.match(main,/ipcMain\.handle\(`mt5:\$\{name\}`/);
  for(const name of ['state','choose-terminal','connect','disconnect','install-indicator'])assert.ok(main.includes("handle('"+name+"'"),'Main missing handler '+name);
  assert.match(main,/sandbox: true/);
  assert.match(main,/preload:/);
  assert.match(main,/new URL\(frame\.url\)\.origin !== localOrigin/);
  assert.match(html,/mt5-client\.js/);
});

test('settings sheet controls exist and are handled by settings-client',async()=>{
  const client=await readFile(new URL('./settings-client.js', import.meta.url),'utf8');
  for(const id of ['settingsDialog','openSettings','settingsClose','settingsDone','settingsReset','settingsTabs','settingsStatus','setMinZones','setMaxZones','setTimeframe','setPivotWidth','setClusterAtr','setZoneWidthAtr','setMaxDistanceAtr','setAtrPeriod','setBuyColor','setSellColor','setLineStyle','setLineWidth','setFill','setLabels','setStrength','setTheme','stylePreview','railNav','bridgeBlock','bridgeToken','bridgeCopy']){
    assert.ok(html.includes('id="'+id+'"'),'missing #'+id);
    assert.ok(client.includes("'"+id+"'"),'settings-client does not handle #'+id);
  }
  for(const go of [...html.matchAll(/data-go="([^"]+)"/g)].map(m=>m[1]))assert.ok(client.includes("'"+go+"'")||client.includes(go+':'),'rail target not handled: '+go);
  assert.match(client,/closest\('button\[data-tab\]'\)/);assert.match(client,/closest\('button\[data-value\]'\)/);
  assert.ok(html.indexOf('settings-client.js')<html.indexOf('market-client.js'),'settings must load before the market client reads the timeframe');
});

test('the EA bridge port and token are shown by the app, not only in settings.json',async()=>{
  const main=await readFile(new URL('./electron/main.js', import.meta.url),'utf8');
  const preload=await readFile(new URL('./electron/preload.cjs', import.meta.url),'utf8');
  const client=await readFile(new URL('./settings-client.js', import.meta.url),'utf8');
  assert.ok(html.includes('id="bridgeBlock"')&&html.includes('id="bridgeToken"')&&html.includes('id="bridgeCopy"'),'the MT5 pane must expose the bridge token');
  assert.match(html,/id="bridgeBlock"[^>]*hidden/,'the bridge block starts hidden until the desktop API answers');
  assert.match(preload,/bridge:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('mt5:bridge'\)/,'preload must expose mt5:bridge');
  assert.match(main,/handle\('bridge',\s*\(\)\s*=>\s*\(\{[^}]*ingestToken:\s*marketIngestToken/,'main must answer with the live port and token');
  assert.match(client,/window\.goldMt5\?\.bridge/);
  assert.match(client,/if \(!api\) \{ block\.hidden = true/,'a browser without the desktop bridge must hide the block instead of showing an empty secret');
});
