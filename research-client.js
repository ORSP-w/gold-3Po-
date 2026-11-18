const $ = id => document.getElementById(id);
const status = $('researchStatus');
let replayBars = [];
let replayTimer = null;
let latestSignalId = '';
let notificationsEnabled = false;
let signalTimer = null;

const number = (id, fallback) => {
  const value = Number($(id)?.value);
  return Number.isFinite(value) ? value : fallback;
};
const localInput = date => {
  const shifted = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return shifted.toISOString().slice(0,16);
};
const money = value => Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const notify = message => {
  if (status) status.textContent = message;
};

function stopReplay() {
  if (replayTimer !== null) window.clearInterval(replayTimer);
  replayTimer = null;
  if ($('playReplay')) $('playReplay').disabled = replayBars.length === 0;
  if ($('pauseReplay')) $('pauseReplay').disabled = true;
}
async function exitReplay() {
  stopReplay();
  replayBars = [];
  $('playReplay').disabled = true;
  $('replaySlider').disabled = true;
  $('liveView').disabled = true;
  $('replayPosition').textContent = 'Live market view';
  window.dispatchEvent(new CustomEvent('exit-replay'));
  try {
    const response = await fetch('/v1/market/analysis?symbol=XAUUSD&intervalMs=900000&priceStep=0.1',{cache:'no-store'});
    const data = await response.json();
    if (response.ok && data.bars?.length) window.dispatchEvent(new CustomEvent('market-analysis',{detail:data}));
    notify('Returned to current broker feed.');
  } catch(error) { notify('Could not refresh live data: '+error.message); }
}
function selectReplay(index) {
  if (!replayBars.length) return;
  const safe = Math.max(0,Math.min(replayBars.length-1,Number(index)||0));
  $('replaySlider').value = String(safe);
  $('replayPosition').textContent = `${safe+1} / ${replayBars.length} · ${new Date(replayBars[safe].time).toLocaleString()}`;
  window.dispatchEvent(new CustomEvent('market-replay-step',{detail:{index:safe}}));
}
async function loadReplay() {
  replayBars = [];
  stopReplay();
  $('replaySlider').disabled = true;
  $('liveView').disabled = true;
  notify('Loading historical ticks and building replay bars…');
  const from = $('replayFrom').value, to = $('replayTo').value;
  const query = new URLSearchParams({symbol:'XAUUSD',intervalMs:'900000',priceStep:'0.1'});
  if (from) query.set('from',new Date(from).toISOString());
  if (to) query.set('to',new Date(to).toISOString());
  try {
    const response = await fetch('/v1/market/replay?'+query.toString(),{cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'Replay request failed');
    replayBars = data.bars || [];
    if (!replayBars.length) {
      $('replaySlider').disabled = true;
      $('playReplay').disabled = true;
      $('pauseReplay').disabled = true;
      $('replayPosition').textContent = 'No bars in selected range';
      notify(`No broker ticks found. Events: ${data.eventCount || 0}`);
      return;
    }
    $('replaySlider').min='0';
    $('replaySlider').max=String(replayBars.length-1);
    $('replaySlider').step='1';
    $('replaySlider').disabled=false;
    $('playReplay').disabled=false;
    $('pauseReplay').disabled=true;
    $('liveView').disabled=false;
    window.dispatchEvent(new CustomEvent('market-replay',{detail:data}));
    selectReplay(0);
    notify(`Replay ready: ${replayBars.length} bars from ${data.eventCount} ticks`);
  } catch(error) { notify('Replay error: '+error.message); }
}
function playReplay() {
  if (!replayBars.length || replayTimer !== null) return;
  const speed = Math.max(0.25,Number($('replaySpeed').value)||1);
  $('playReplay').disabled=true;
  $('pauseReplay').disabled=false;
  replayTimer = window.setInterval(()=>{
    const next = Number($('replaySlider').value)+1;
    if (next >= replayBars.length) { stopReplay(); return; }
    selectReplay(next);
  },Math.max(60,500/speed));
}
async function runBacktest() {
  notify('Running historical simulation…');
  const query = new URLSearchParams({
    symbol:'XAUUSD',intervalMs:'900000',initialEquity:String(number('backtestEquity',10000)),
    riskPct:String(number('backtestRisk',0.5)),maxRiskPct:'1',stopAtr:'1.5',targetR:'2',
    maxBars:'20',pointValue:String(number('backtestPointValue',1))
  });
  try {
    const response = await fetch('/v1/market/backtest?'+query.toString(),{cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'Backtest failed');
    const s = data.summary;
    $('backtestSummary').textContent = `${s.trades} trades · ${s.wins}W / ${s.losses}L · ${s.winRate===null?'—':(s.winRate*100).toFixed(1)+'%'} win rate · ${s.netPnl>=0?'+':''}${money(s.netPnl)} P&L · ${s.maxDrawdownPct.toFixed(2)}% max drawdown`;
    $('backtestDetails').textContent = s.trades
      ? `Final equity ${money(s.finalEquity)} · Profit factor ${s.profitFactor===null?'∞':s.profitFactor.toFixed(2)} · Expectancy ${s.expectancyR.toFixed(3)}R · ${data.bars} bars`
      : `No qualifying setups in ${data.bars} available bars. Minimum warm-up and valid liquidity sweeps are required.`;
    $('backtestCaveat').textContent = data.limitations.join(' ');
    const rows = (data.trades||[]).slice(-8).reverse().map(t=>`${t.side.toUpperCase()} · ${new Date(t.entryTime).toLocaleString()} → ${new Date(t.exitTime).toLocaleString()} · ${t.exitReason} · ${t.netR.toFixed(2)}R`);
    $('backtestTrades').textContent = rows.length ? rows.join(' | ') : 'No closed trades yet.';
    notify('Backtest finished. Historical results are not a forecast.');
  } catch(error) { notify('Backtest error: '+error.message); }
}
async function calculateRisk() {
  notify('Calculating position size and risk limits…');
  const query = new URLSearchParams({
    equity:String(number('riskEquity',10000)),riskPct:String(number('riskPercent',0.5)),
    entry:String(number('riskEntry',2650)),stop:String(number('riskStop',2645)),
    target:String(number('riskTarget',2660)),pointValue:String(number('riskPointValue',1)),
    maxRiskPct:'1',minRiskReward:'1.5'
  });
  try {
    const response = await fetch('/v1/risk/plan?'+query.toString(),{cache:'no-store'});
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'Risk calculation failed');
    $('riskResult').textContent = `${data.allowed?'PLAN PASSES GUARDRAILS':'PLAN BLOCKED'} · ${data.direction||'INVALID DIRECTION'} · size ${data.quantity.toFixed(4)} units · planned loss ${money(data.plannedLoss)} · target gain ${money(data.plannedGain)} · R:R ${data.riskReward.toFixed(2)}:1`;
    $('riskChecks').textContent = data.checks.map(item=>(item.passed?'PASS':'BLOCK')+' — '+item.message).join(' · ');
    notify(data.allowed?'Risk plan passed configured limits.':'Risk plan blocked by guardrails.');
  } catch(error) { notify('Risk calculation error: '+error.message); }
}
async function refreshSignals() {
  try {
    const response = await fetch('/v1/market/signals?symbol=XAUUSD&intervalMs=900000',{cache:'no-store'});
    if (!response.ok) return;
    const data = await response.json();
    const signal = data.latest;
    if (!signal) {
      $('signalMonitor').textContent = 'No qualifying liquidity sweep signal in the current history.';
      $('signalCalibration').textContent = data.caveat || '';
      return;
    }
    const probability = signal.probability === null ? 'Not calibrated' : (signal.probability*100).toFixed(1)+'% historical win rate';
    $('signalMonitor').textContent = `${signal.side.toUpperCase()} · technical score ${(signal.technicalScore*100).toFixed(0)}/100 · ${probability} · ${new Date(signal.time).toLocaleString()}`;
    $('signalCalibration').textContent = signal.evidence.join(' · ')+' | '+signal.calibrationStatus+' ('+(signal.calibrationSamples||0)+' prior trades)';
    if (notificationsEnabled && signal.id !== latestSignalId && signal.technicalScore >= 0.70 && 'Notification' in window) {
      new Notification('GOLD-3Po · '+signal.side.toUpperCase(),{body:`Liquidity sweep setup. Technical score ${(signal.technicalScore*100).toFixed(0)}/100. This is not a trade instruction.`});
    }
    latestSignalId = signal.id;
  } catch {}
}
$('loadReplay')?.addEventListener('click',loadReplay);
$('playReplay')?.addEventListener('click',playReplay);
$('pauseReplay')?.addEventListener('click',stopReplay);
$('liveView')?.addEventListener('click',exitReplay);
$('replaySlider')?.addEventListener('input',event=>{stopReplay();selectReplay(event.target.value);});
$('runBacktest')?.addEventListener('click',runBacktest);
$('calculateRisk')?.addEventListener('click',calculateRisk);
$('enableAlerts')?.addEventListener('click',async()=>{
  if (!('Notification' in window)) { notify('Browser notifications are not supported. Signals remain visible in this panel.'); return; }
  const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  notificationsEnabled = permission === 'granted';
  $('enableAlerts').textContent = notificationsEnabled ? 'Alerts enabled' : 'Enable alerts';
  notify(notificationsEnabled ? 'Signal notifications enabled in this browser.' : 'Notification permission was not granted.');
});
const end = new Date(), start = new Date(end.getTime()-30*86400000);
if ($('replayFrom')) $('replayFrom').value = localInput(start);
if ($('replayTo')) $('replayTo').value = localInput(end);
window.addEventListener('market-analysis',()=>{
  if (signalTimer !== null) window.clearTimeout(signalTimer);
  signalTimer = window.setTimeout(()=>{signalTimer=null;refreshSignals();},1800);
});
refreshSignals();
