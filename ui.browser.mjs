import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { chromium } from 'playwright';

const token = 'browser-test-token-which-is-long-enough';
const isolatedDataFile = '/tmp/gold-3po-browser-' + process.pid + '.jsonl';
const isolatedSetupsFile = '/tmp/gold-3po-browser-setups-' + process.pid + '.json';
const isolatedSettingsFile = '/tmp/gold-3po-browser-settings-' + process.pid + '.json';
// Use an ephemeral port: a real installed GOLD-3Po may already own 8787.
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: '0', MARKET_INGEST_TOKEN: token, MARKET_DATA_FILE: isolatedDataFile, SETUPS_FILE: isolatedSetupsFile, SETTINGS_FILE: isolatedSettingsFile, LICENSE_REQUIRED: '0' }, stdio: ['ignore', 'pipe', 'ignore'] });
let base = '';
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    const chunk = server.stdout.read();
    if (chunk) {
      const match = chunk.toString().match(/listening on http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) base = 'http://127.0.0.1:' + match[1];
    }
    if (base) {
      try { const r = await fetch(base + '/health'); if (r.ok) ready = true; } catch {}
    }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'market server did not start');
  browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });

  // Без фида брокера рабочая область показывает пустое состояние, а не демонстрационные свечи.
  await page.waitForSelector('#chartEmpty:not([hidden])', { timeout: 5000 });
  assert.equal(await page.locator('.candle').count(), 0, 'никаких демо-свечей до прихода данных брокера');
  assert.equal(await page.locator('.zone-row').count(), 0, 'никаких демо-зон до прихода данных брокера');
  assert.match(await page.locator('#zoneList').innerText(), /Зон пока нет/);
  assert.match(await page.locator('#chartStatus').innerText(), /ПОДКЛЮЧИТЕ MT5/);

  const reset = await page.locator('#resetView').boundingBox();
  const workspace = await page.locator('#layoutButton').boundingBox();
  assert.ok(Math.abs(reset.y - workspace.y) < 1, 'top action buttons must align vertically');
  assert.equal(reset.height, workspace.height, 'top action buttons must have equal height');

  const historyTicks = Array.from({length:30},(_,i)=>{const at=new Date(Date.now()-(30-i)*86400000);at.setUTCHours(10,0,0,0);return {timestamp:at.toISOString(),sequence:i+1,bid:2640+i*.1,ask:2640.2+i*.1,last:2640.1+i*.1,tickVolume:1,realVolume:0,flags:0};});
  const historyResponse=await fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks:historyTicks})});
  assert.equal(historyResponse.status,202,'30-day broker history fixture should be accepted');
  const now = new Date().toISOString();
  const mt5 = { source:'mt5', symbol:'XAUUSD', timestamp:now, sequence:Date.now(), bid:2648.2, ask:2648.4, last:2648.3, tickVolume:1, realVolume:0 };
  const comex = { source:'comex', symbol:'GCZ6', timestamp:now, sequence:Date.now(), tradeId:'browser-check-'+Date.now(), price:2650.1, size:2, aggressorSide:'buy' };
  for (const [path, event] of [['/v1/ingest/mt5/tick',mt5],['/v1/ingest/comex/trade',comex]]) {
    const response = await fetch(base + path, { method:'POST', headers:{ authorization:'Bearer '+token, 'content-type':'application/json' }, body:JSON.stringify(event) });
    assert.equal(response.status,202, 'feed event should be accepted');
  }
  await page.waitForFunction(() => document.querySelector('#mt5Status')?.textContent.startsWith('ОНЛАЙН'), null, { timeout:5000 });
  await page.waitForFunction(() => document.querySelector('#comexStatus')?.textContent.startsWith('ОНЛАЙН'), null, { timeout:5000 });
  await page.waitForFunction(() => document.querySelector('#chartStatus')?.textContent.startsWith('ОНЛАЙН'), null, { timeout:5000 });
  assert.ok(await page.locator('.candle').count() >= 30, 'live chart should render the ingested 30-day broker history');
  assert.equal(await page.locator('#chartEmpty').isHidden(), true, 'empty state must disappear once broker data arrives');
  assert.ok(await page.locator('.zone-row').count() > 0, 'liquidity zones should appear once broker history arrives');
  const zoneText = await page.locator('#zoneList').innerText();
  assert.ok(/[А-Яа-яЁё]/.test(zoneText), 'zone rows must be captioned in Russian, not engine tokens');
  assert.ok(!/Swing high|Prior day|Value area|UNTESTED|TESTED|SWEPT/.test(zoneText), 'no English label or state may reach the panel');

  await page.locator('.zone-row').first().click();
  assert.equal(await page.locator('.zone-row.selected').count(), 1, 'zone click should select one zone');
  assert.equal(await page.locator('.selected-zone').count(), 1, 'selected zone should highlight on chart');
  await page.locator('#zonesToggle').click();
  assert.equal(await page.locator('rect.zone-buy, rect.zone-sell').count(), 0, 'zone toggle should hide overlays');
  await page.locator('#zonesToggle').click();

  await page.locator('#footprintModes [data-mode="delta"]').click();
  assert.ok(await page.locator('.delta-positive, .delta-negative').count() > 0, 'Delta mode should render delta cells');
  await page.locator('#footprintModes [data-mode="volume"]').click();
  assert.ok(await page.locator('.volume-cell').count() > 0, 'Volume mode should render volume cells');
  await page.locator('#footprintModes [data-mode="bidask"]').click();
  await page.locator('#numbersToggle').click();
  assert.ok(await page.locator('.foot-cell').first().innerText().then(v => v.trim()).then(v => v === ''), 'number toggle should hide cell values');
  await page.locator('#numbersToggle').click();

  // Footprint math: POC, value area, session profile, delta row and the markers are on screen.
  assert.ok(await page.locator('.foot-poc').count() > 0, 'every drawn bar must mark its point of control');
  assert.ok(await page.locator('.foot-cell.foot-va').count() > 0, 'the value area must be shaded');
  assert.ok(await page.locator('.foot-profile:not(.empty)').count() > 0, 'the session profile column must carry volume');
  assert.equal(await page.locator('.foot-profile b').count() > 0, true, 'the profile labels VAH / VAL / POC');
  assert.equal(await page.locator('.foot-delta').count(), await page.locator('.bar-head').count(), 'one delta cell per bar');
  assert.equal(await page.locator('.foot-cell.foot-forming').count() > 0, true, 'the forming bar is marked');
  assert.ok(!/Swing high|Prior day|Value area/.test(await page.locator('#footprintGrid').innerText()), 'no engine token leaks into the footprint');

  // Real time: a streamed tick lands in the forming bar between refetches, without a reload.
  // The price is outside the fixture range, so a new price row proves the tick was applied.
  const formingVolume = () => page.evaluate(() => [...document.querySelectorAll('.foot-cell.foot-forming')]
    .reduce((sum, cell) => sum + cell.innerText.split(/\s+/).reduce((n, part) => n + (Number(part) || 0), 0), 0));
  const beforeTick = await formingVolume();
  // Same 15m bucket as the last streamed tick above, so no new candle is created.
  const liveTick = { source: 'mt5', symbol: 'XAUUSD', timestamp: new Date().toISOString(), sequence: Date.now(), bid: 2649.1, ask: 2649.3, last: 2649.2, tickVolume: 9, realVolume: 0, flags: 32 };
  const liveResponse = await fetch(base + '/v1/ingest/mt5/tick', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(liveTick) });
  assert.equal(liveResponse.status, 202, 'a live tick must be accepted');
  await page.waitForFunction(before => [...document.querySelectorAll('.foot-cell.foot-forming')]
    .reduce((sum, cell) => sum + cell.innerText.split(/\s+/).reduce((n, part) => n + (Number(part) || 0), 0), 0) > before, beforeTick, { timeout: 5000 });
  assert.ok(await formingVolume() >= beforeTick + 9, 'the forming bar must absorb the tick volume immediately');
  assert.ok(await page.locator('.foot-cell.foot-forming').count() > 0, 'the forming column survives the tick');

  const firstCell = page.locator('.foot-cell').first();
  const firstIndex = Number(await firstCell.getAttribute('data-index'));
  await firstCell.click();
  assert.match(await page.locator('#selectedBar').innerText(), new RegExp('#'+String(firstIndex+1).padStart(3,'0')));
  await page.locator('.candle[data-index="2"]').click();
  assert.match(await page.locator('#selectedBar').innerText(), /#003/);

  const totalBars = Number((await page.locator('#barCount').innerText()).replace(/[^\d]/g, ''));
  await page.locator('#resetView').click();
  assert.match(await page.locator('#selectedBar').innerText(), new RegExp('#'+String(totalBars).padStart(3,'0')), 'reset should select the newest candle');
  assert.equal(await page.locator('.zone-row.selected').count(), 0, 'reset should clear zone selection');

  await page.locator('#layoutButton').click();
  assert.ok(await page.locator('#workspace').evaluate(el => el.classList.contains('focus-chart')));
  await page.locator('#layoutButton').click();
  assert.ok(!(await page.locator('#workspace').evaluate(el => el.classList.contains('focus-chart'))));

  await page.locator('#loadReplay').click();
  await page.waitForFunction(() => document.querySelector('#replaySlider') && !document.querySelector('#replaySlider').disabled, null, { timeout:5000 });
  assert.ok(await page.locator('.candle').count() >= 30, 'replay must load the selected historical range');
  await page.locator('#replaySlider').evaluate(el=>{el.value='1';el.dispatchEvent(new Event('input',{bubbles:true}));});
  assert.match(await page.locator('#selectedBar').innerText(), /#002/, 'replay slider must move the selected candle and footprint');
  await page.locator('#playReplay').click();
  await page.waitForTimeout(250);
  await page.locator('#pauseReplay').click();
  await page.locator('#liveView').click();
  await page.waitForFunction(() => document.querySelector('#chartStatus')?.textContent.startsWith('ОНЛАЙН'), null, { timeout:5000 });
  await page.locator('#runBacktest').click();
  await page.waitForFunction(() => document.querySelector('#backtestSummary')?.textContent.includes('сделок'), null, { timeout:5000 });
  await page.locator('#calculateRisk').click();
  await page.waitForFunction(() => document.querySelector('#riskResult')?.textContent.includes('ПЛАН ПРОХОДИТ ПРОВЕРКУ'), null, { timeout:5000 });
  assert.match(await page.locator('#riskChecks').innerText(), /ОК/);

  // Vespera-style setup library: save, apply and verify the active conditions propagate.
  await page.locator('#setupName').fill('Browser strict');
  await page.locator('#condStacked').check();
  await page.locator('#saveSetup').click();
  await page.waitForFunction(() => document.querySelector('#setupStatus')?.textContent.includes('Сохранено: Browser strict'), null, { timeout:5000 });
  await page.locator('#setupSelect').selectOption({ index: 1 });
  await page.locator('#applySetup').click();
  await page.waitForFunction(() => document.querySelector('#setupStatus')?.textContent.includes('Применено'), null, { timeout:5000 });
  const setupsState = await (await fetch(base + '/v1/setups')).json();
  assert.ok(setupsState.activeId, 'a setup must be active after Apply');
  assert.equal(setupsState.activeDefinition.strategy.requireStacked, true, 'applied conditions must persist server-side');
  assert.match(await page.locator('#licenseStatus').innerText(), /НЕ ТРЕБУЕТСЯ/, 'licence row must reflect the CI dev mode');

  // MT5 connection dialog exists and degrades safely outside Electron (no bridge).
  await page.locator('#mt5Open').click();
  await page.waitForSelector('#mt5Dialog[open]');
  assert.ok(await page.locator('#mt5Terminal').count() === 1, 'terminal path field must exist');
  assert.ok(await page.locator('#mt5Password').getAttribute('type') === 'password', 'password field must be masked');
  assert.ok(await page.locator('#mt5Connect').isDisabled(), 'connect must be disabled without the desktop bridge');
  assert.match(await page.locator('#mt5Detail').innerText(), /настольном приложении/, 'browser mode must explain the desktop-only login');
  await page.locator('#mt5Close').click();

  // Settings sheet: zone finder + MT5 drawing style are saved server-side and reach the zones endpoint.
  await page.locator('#openSettings').click();
  await page.waitForSelector('#settingsDialog[open]');
  await page.locator('#setMaxZones').evaluate(el=>{el.value='4';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#setReactionBars').evaluate(el=>{el.value='10';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.locator('#setSrcVolume').click();
  await page.locator('#settingsTabs button[data-tab="mt5"]').click();
  await page.locator('#setLineStyle button[data-value="dash"]').click();
  await page.locator('#setSellColor').evaluate(el=>{el.value='#00ff00';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForFunction(() => document.querySelector('#settingsStatus')?.textContent === 'Сохранено', null, { timeout:5000 });
  assert.ok(await page.locator('#setLineWidth').isDisabled(), 'dashed lines lock the width to 1 (MT5 limitation)');
  await page.locator('#settingsDone').click();
  const savedSettings = await (await fetch(base + '/v1/settings')).json();
  assert.equal(savedSettings.zones.maxZones, 4);
  assert.equal(savedSettings.zones.reactionBars, 10, 'the reaction window comes from the sheet');
  assert.equal(savedSettings.zones.useVolume, false, 'a switched-off source must reach the store');
  assert.equal(savedSettings.zones.useSessions, true, 'untouched sources keep their default');
  assert.equal(savedSettings.mt5.lineStyle, 'dash');
  assert.equal(savedSettings.mt5.lineWidth, 1);
  assert.equal(savedSettings.mt5.sellColor, '#00FF00');
  const zonesForMt5 = await (await fetch(base + '/v1/chart/zones?symbol=XAUUSD')).json();
  assert.ok(zonesForMt5.zones.length <= 4, 'zone count setting must limit the MT5 payload');
  assert.ok(!zonesForMt5.zones.some(z => /^(Volume|Value area)/.test(z.label) || (z.sources||[]).some(s => /^(Volume|Value area)/.test(s))), 'the volume profile is off, so no volume level may be drawn');
  assert.equal(zonesForMt5.style.lineStyle, 'dash', 'MT5 payload must carry the drawing style');
  await page.locator('#railNav .rail-item[data-go="settings"]').click();
  await page.waitForSelector('#settingsDialog[open]');
  await page.locator('#settingsReset').click();
  await page.waitForFunction(() => document.querySelector('#settingsStatus')?.textContent === 'Настройки сброшены', null, { timeout:5000 });
  assert.equal((await (await fetch(base + '/v1/settings')).json()).mt5.sellColor, '#FF0000', 'reset restores red lines');
  assert.equal((await (await fetch(base + '/v1/settings')).json()).zones.useVolume, true, 'reset turns the volume source back on');
  await page.locator('#settingsClose').click();

  await mkdir('artifacts', { recursive:true });
  await page.screenshot({ path:'artifacts/market-lab-desktop.png', fullPage:true });
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(250);
  const mobile = await page.evaluate(() => ({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, chart:document.querySelector('.price-panel')?.getBoundingClientRect().width, footprint:document.querySelector('.footprint-wrap')?.getBoundingClientRect().width }));
  assert.ok(mobile.scrollWidth <= mobile.width, 'mobile page must not overflow horizontally');
  assert.ok(mobile.chart > 0 && mobile.footprint > 0, 'chart and footprint must remain visible on mobile');
  await page.screenshot({ path:'artifacts/market-lab-mobile.png', fullPage:true });
  await page.locator('#openSettings').click();
  await page.waitForSelector('#settingsDialog[open]');
  await page.locator('#settingsTabs button[data-tab="zones"]').click();
  assert.ok(await page.locator('#settingsTabs button[data-tab="zones"]').evaluate(el => el.classList.contains('on')), 'the active tab must be the zone pane');
  assert.ok(!(await page.locator('#settingsTabs button[data-tab="mt5"]').evaluate(el => el.classList.contains('on'))), 'only one tab is active');
  const sheet = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#settingsDialog .settings-pane[data-pane="zones"] .row')];
    return {
      overflow: document.documentElement.scrollWidth - innerWidth,
      rows: rows.length,
      visible: rows.filter(row => row.getBoundingClientRect().height > 0).length,
      toggles: document.querySelectorAll('#settingsDialog .settings-pane[data-pane="zones"] .toggle').length,
      right: Math.max(...rows.map(row => row.getBoundingClientRect().right)),
      sliders: [...document.querySelectorAll('#settingsDialog .settings-pane[data-pane="zones"] input[type="range"]')].filter(el => el.getBoundingClientRect().width > 0).length
    };
  });
  assert.ok(sheet.overflow <= 0, 'the settings sheet must not overflow a phone width');
  assert.ok(sheet.right > 0 && sheet.right <= 390, 'every source row must fit inside the phone viewport');
  assert.equal(sheet.visible, sheet.rows, 'the zone pane is the one on screen');
  assert.equal(sheet.toggles, 5, 'all five level sources are switchable');
  assert.ok(sheet.sliders >= 7, 'every numeric zone option has a slider');
  await page.screenshot({ path:'artifacts/settings-mobile.png' });
  await page.locator('#settingsClose').click();
  await page.waitForTimeout(150);
  // Плотная история: на 4K панель должна вмещать серию, а не растягивать её в ленту.
  const denseTicks = Array.from({ length: 600 }, (_, i) => {
    const at = new Date(Date.now() - (600 - i) * 15 * 60000);
    const px = 2650 + Math.sin(i / 9) * 4 + i * 0.02;
    return { timestamp: at.toISOString(), sequence: 100000 + i, bid: +px.toFixed(2), ask: +(px + 0.2).toFixed(2), last: +(px + 0.1).toFixed(2), tickVolume: 1, realVolume: 0, flags: 0 };
  });
  const denseResponse = await fetch(base + '/v1/ingest/mt5/history', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ source: 'mt5', symbol: 'XAUUSD', ticks: denseTicks }) });
  assert.equal(denseResponse.status, 202, 'dense history fixture should be accepted');
  await page.setViewportSize({ width: 3840, height: 2160 });
  await page.waitForFunction(() => document.querySelectorAll('.candle').length >= 600, null, { timeout: 8000 });
  await page.waitForTimeout(400);
  const wide = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - innerWidth,
    wrap: document.querySelector('.price-chart-wrap')?.clientWidth || 0,
    chart: document.querySelector('#priceChart')?.getBoundingClientRect().width || 0,
    content: document.querySelector('.main-content')?.getBoundingClientRect().width || 0,
    bars: document.querySelectorAll('.candle').length
  }));
  assert.ok(wide.overflow <= 0, '4K must not overflow horizontally');
  assert.ok(wide.content > 2000, '4K workspace must use the extra width instead of a 1680px strip');
  assert.ok(wide.chart >= wide.wrap * 0.85, 'chart must fill the panel on wide screens');
  assert.ok(wide.chart <= wide.wrap * 1.05, 'dense history must be compressed into the 4K panel instead of a multi-screen scroll strip');
  assert.ok(wide.chart / wide.bars >= 2, 'bars never get thinner than the 4K pitch');
  await page.screenshot({ path:'artifacts/market-lab-4k.png', fullPage:true });
  assert.deepEqual(pageErrors, [], 'browser must not emit uncaught JavaScript errors');
  process.stdout.write('Browser checks passed: empty state, chart, footprint (POC, value area, profile, delta row, live tick), zones, replay, backtest, risk planner, setup library, settings, live MT5/COMEX status and mobile overflow.\n');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
  await rm(isolatedDataFile,{force:true});
  await rm(isolatedSetupsFile,{force:true});
  await rm(isolatedSettingsFile,{force:true});
}
