import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const port = 8787;
const base = 'http://127.0.0.1:' + port;
const token = 'browser-test-token-which-is-long-enough';
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), MARKET_INGEST_TOKEN: token }, stdio: 'ignore' });
let browser;
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base + '/health'); if (r.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  assert.ok(ready, 'market server did not start');
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.foot-cell');
  assert.equal(await page.locator('.candle').count(), 12, '12 price bars should render');
  assert.equal(await page.locator('.foot-cell').count(), 180, '15 price levels × 12 bars should render');
  assert.equal(await page.locator('.zone-row').count(), 4, 'four liquidity zones should render');

  const reset = await page.locator('#resetView').boundingBox();
  const workspace = await page.locator('#layoutButton').boundingBox();
  assert.ok(Math.abs(reset.y - workspace.y) < 1, 'top action buttons must align vertically');
  assert.equal(reset.height, workspace.height, 'top action buttons must have equal height');

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

  await page.locator('.foot-cell[data-index="3"]').first().click();
  assert.match(await page.locator('#selectedBar').innerText(), /#04/);
  await page.locator('.candle[data-index="2"]').click();
  assert.match(await page.locator('#selectedBar').innerText(), /#03/);
  await page.locator('#resetView').click();
  assert.match(await page.locator('#selectedBar').innerText(), /#12/);
  assert.equal(await page.locator('.zone-row.selected').count(), 0, 'reset should clear zone selection');

  await page.locator('#layoutButton').click();
  assert.ok(await page.locator('#workspace').evaluate(el => el.classList.contains('focus-chart')));
  await page.locator('#layoutButton').click();
  assert.ok(!(await page.locator('#workspace').evaluate(el => el.classList.contains('focus-chart'))));

  const historyTicks = Array.from({length:30},(_,i)=>{const at=new Date(Date.now()-(29-i)*86400000);at.setUTCHours(10,0,0,0);return {timestamp:at.toISOString(),sequence:i+1,bid:2640+i*.1,ask:2640.2+i*.1,last:2640.1+i*.1,tickVolume:1,realVolume:0,flags:0};});
  const historyResponse=await fetch(base+'/v1/ingest/mt5/history',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({source:'mt5',symbol:'XAUUSD',ticks:historyTicks})});
  assert.equal(historyResponse.status,202,'30-day broker history fixture should be accepted');
  const now = new Date().toISOString();
  const mt5 = { source:'mt5', symbol:'XAUUSD', timestamp:now, sequence:Date.now(), bid:2648.2, ask:2648.4, last:2648.3, tickVolume:1, realVolume:0 };
  const comex = { source:'comex', symbol:'GCZ6', timestamp:now, sequence:Date.now(), tradeId:'browser-check-'+Date.now(), price:2650.1, size:2, aggressorSide:'buy' };
  for (const [path, event] of [['/v1/ingest/mt5/tick',mt5],['/v1/ingest/comex/trade',comex]]) {
    const response = await fetch(base + path, { method:'POST', headers:{ authorization:'Bearer '+token, 'content-type':'application/json' }, body:JSON.stringify(event) });
    assert.equal(response.status,202, 'feed event should be accepted');
  }
  await page.waitForFunction(() => document.querySelector('#mt5Status')?.textContent.startsWith('LIVE'), null, { timeout:5000 });
  await page.waitForFunction(() => document.querySelector('#comexStatus')?.textContent.startsWith('LIVE'), null, { timeout:5000 });
  await page.waitForFunction(() => document.querySelector('#chartStatus')?.textContent.startsWith('LIVE'), null, { timeout:5000 });
  assert.ok(await page.locator('.candle').count() >= 30, 'live chart should render the ingested 30-day history, not remain at 12 fixture candles');

  await mkdir('artifacts', { recursive:true });
  await page.screenshot({ path:'artifacts/market-lab-desktop.png', fullPage:true });
  await page.setViewportSize({ width:390, height:844 });
  await page.waitForTimeout(250);
  const mobile = await page.evaluate(() => ({ width:innerWidth, scrollWidth:document.documentElement.scrollWidth, chart:document.querySelector('.price-panel')?.getBoundingClientRect().width, footprint:document.querySelector('.footprint-wrap')?.getBoundingClientRect().width }));
  assert.ok(mobile.scrollWidth <= mobile.width, 'mobile page must not overflow horizontally');
  assert.ok(mobile.chart > 0 && mobile.footprint > 0, 'chart and footprint must remain visible on mobile');
  await page.screenshot({ path:'artifacts/market-lab-mobile.png', fullPage:true });
  assert.deepEqual(pageErrors, [], 'browser must not emit uncaught JavaScript errors');
  process.stdout.write('Browser checks passed: chart, footprint, zone selection, toggles, inspector, reset, layout, live MT5/COMEX status and mobile overflow.\n');
} finally {
  if (browser) await browser.close();
  server.kill('SIGTERM');
}
