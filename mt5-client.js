import { tickSizeNote } from './mt5-status.js';
const $ = id => document.getElementById(id);
const bridge = window.goldMt5;
let symbol = 'XAUUSD';
export const marketSymbol = () => symbol;

const dialog = $('mt5Dialog');
const form = $('mt5Form');
const detail = $('mt5Detail');
let busy = false, indicatorNotice = '';

function render(status) {
  const connected = status.state === 'online';
  if (connected && status.symbol && status.symbol !== symbol) {
    symbol = status.symbol;
    if ($('marketSymbol')) $('marketSymbol').textContent = symbol;
    window.dispatchEvent(new CustomEvent('mt5-symbol-change'));
  }
  const tick = status.lastTick ? new Date(status.lastTick).toLocaleString() : '';
  const note = connected ? `${status.message} Зон передано в MT5: ${status.zoneCount ?? 0}. Для отображения на графике добавьте индикатор Gold3PoLevels.${tick ? ` Последний тик: ${tick}.` : ''}${tickSizeNote(status)}` : status.message;
  detail.textContent = indicatorNotice ? `${indicatorNotice} ${note}` : note;
  const pending = status.state === 'connecting' || status.state === 'reconnecting';
  const label = connected ? `MT5 · ${status.symbol}${status.feed === 'stale' ? ' · нет тиков' : ''}` : status.state === 'reconnecting' ? 'MT5 · переподключение…' : status.state === 'connecting' ? 'MT5 · подключение…' : 'Подключить MT5';
  $('mt5Open').textContent = label;
  $('mt5Open').dataset.state = status.state;
  $('mt5Connect').disabled = !bridge || busy || connected || pending;
  $('mt5Disconnect').disabled = !bridge || busy || (!connected && !pending);
  $('mt5InstallIndicator').disabled = !bridge || busy || !connected;
  if (form) form.querySelectorAll('input').forEach(input => { input.disabled = !bridge || busy || connected; });
  $('mt5Browse').disabled = !bridge || busy || connected;
}

const unavailable = { state: 'offline', message: 'Вход в MT5 доступен только в настольном приложении GOLD-3Po для Windows.' };
async function refresh() {
  if (!bridge) { render(unavailable); return; }
  if (!busy) render(await bridge.state());
}
function report(error) { if (detail) detail.textContent = error?.message || 'Не удалось выполнить операцию MT5.'; }

if (dialog) {
  $('mt5Open').addEventListener('click', () => { dialog.showModal(); void refresh().catch(report); });
  $('mt5Close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => { $('mt5Password').value = ''; });
  $('mt5Browse').addEventListener('click', async () => {
    try {
      const terminal = await bridge.chooseTerminal();
      if (terminal) $('mt5Terminal').value = terminal;
    } catch (error) { report(error); }
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!bridge || busy) return;
    const input = Object.fromEntries(new FormData(form));
    $('mt5Password').value = '';
    indicatorNotice = '';
    busy = true;
    render({ state: 'connecting', message: 'Подключение к терминалу MT5…' });
    try { const result = await bridge.connect(input); busy = false; render(result); }
    catch (error) { busy = false; try { await refresh(); } catch { /* preserve operation error */ } report(error); }
  });
  $('mt5Disconnect').addEventListener('click', async () => {
    indicatorNotice = '';
    try { render(await bridge.disconnect()); } catch (error) { report(error); }
  });
  $('mt5InstallIndicator').addEventListener('click', async () => {
    try {
      indicatorNotice = await bridge.installIndicator();
      await refresh();
    } catch (error) { report(error); }
  });
  void refresh().catch(report);
  if (bridge) window.setInterval(() => void refresh().catch(report), 2500);
}
