const api = document.querySelector('#apiStatus');
const mt5 = document.querySelector('#mt5Status');
const comex = document.querySelector('#comexStatus');
const labels = { mt5, comex };
let source;
function paint(node, label, state) {
  if (!node) return;
  node.textContent = label;
  node.className = state === 'online' ? 'ok' : state === 'error' ? 'error' : 'warning';
}
function ageLabel(ms) {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return 'NOW';
  if (ms < 60000) return Math.floor(ms / 1000) + 's AGO';
  return Math.floor(ms / 60000) + 'm AGO';
}
async function refreshHealth() {
  try {
    const response = await fetch('/health', { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const health = await response.json();
    paint(api, health.ingestConfigured ? 'API ONLINE' : 'TOKEN MISSING', health.ingestConfigured ? 'online' : 'warning');
    for (const sourceName of ['mt5', 'comex']) {
      const feed = health.feeds.find(item => item.source === sourceName);
      if (!feed) paint(labels[sourceName], 'WAITING', 'warning');
      else paint(labels[sourceName], feed.status.toUpperCase() + ' · ' + ageLabel(feed.ageMs), feed.status);
    }
  } catch {
    paint(api, 'API OFFLINE', 'error');
    paint(mt5, 'UNAVAILABLE', 'error');
    paint(comex, 'UNAVAILABLE', 'error');
  }
}
function connectStream() {
  if (!('EventSource' in window)) { paint(api, 'SSE UNSUPPORTED', 'error'); return; }
  source = new EventSource('/v1/stream');
  source.onopen = () => refreshHealth();
  source.onerror = () => paint(api, 'RECONNECTING', 'warning');
  source.addEventListener('market', event => {
    try {
      const message = JSON.parse(event.data);
      const target = labels[message.source];
      if (target) paint(target, 'LIVE · ' + ageLabel(Date.now() - Date.parse(message.receivedAt)), 'online');
    } catch { /* Ignore malformed stream frames; health polling remains authoritative. */ }
  });
}
refreshHealth();
connectStream();
window.setInterval(refreshHealth, 5000);
