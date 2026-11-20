const $ = id => document.getElementById(id);
const statusNode = $('setupStatus');
let library = null;

function say(message) { if (statusNode) statusNode.textContent = message; }

function fillFields(definition) {
  const s = definition.strategy, b = definition.backtest;
  if ($('condMinScore')) $('condMinScore').value = String(s.minScore);
  if ($('condAtrPeriod')) $('condAtrPeriod').value = String(s.atrPeriod);
  if ($('condRejection')) $('condRejection').checked = Boolean(s.requireRejection);
  if ($('condCloseEdge')) $('condCloseEdge').checked = Boolean(s.requireCloseEdge);
  if ($('condStacked')) $('condStacked').checked = Boolean(s.requireStacked);
  if ($('condDelta')) $('condDelta').checked = Boolean(s.requireDeltaAgree);
  if ($('condSides')) $('condSides').value = s.allowedSides.length === 2 ? 'both' : s.allowedSides[0];
  if ($('condSessionFrom')) $('condSessionFrom').value = s.sessionHoursUTC ? String(s.sessionHoursUTC[0]) : '';
  if ($('condSessionTo')) $('condSessionTo').value = s.sessionHoursUTC ? String(s.sessionHoursUTC[1]) : '';
  if ($('condMinAtr')) $('condMinAtr').value = String(s.minAtr);
  if ($('condStopAtr')) $('condStopAtr').value = String(b.stopAtr);
  if ($('condTargetR')) $('condTargetR').value = String(b.targetR);
  if ($('condMaxBars')) $('condMaxBars').value = String(b.maxBars);
  if ($('condRiskPct')) $('condRiskPct').value = String(b.riskPct);
  if ($('condPointValue')) $('condPointValue').value = String(b.pointValue);
}

function collectDefinition() {
  const num = (id, fallback) => { const v = Number($(id)?.value); return Number.isFinite(v) ? v : fallback; };
  const sides = $('condSides')?.value || 'both';
  const from = $('condSessionFrom')?.value, to = $('condSessionTo')?.value;
  const session = (from !== '' && to !== '' && from !== undefined && to !== undefined) ? [Number(from), Number(to)] : null;
  return {
    strategy: {
      minScore: num('condMinScore', 0.55),
      atrPeriod: Math.round(num('condAtrPeriod', 14)),
      requireRejection: Boolean($('condRejection')?.checked),
      requireCloseEdge: Boolean($('condCloseEdge')?.checked),
      requireStacked: Boolean($('condStacked')?.checked),
      requireDeltaAgree: Boolean($('condDelta')?.checked),
      allowedSides: sides === 'both' ? ['long', 'short'] : [sides],
      sessionHoursUTC: session,
      minAtr: num('condMinAtr', 0)
    },
    backtest: {
      stopAtr: num('condStopAtr', 1.5),
      targetR: num('condTargetR', 2),
      maxBars: Math.round(num('condMaxBars', 20)),
      riskPct: num('condRiskPct', 0.5),
      pointValue: num('condPointValue', 1)
    }
  };
}

function renderLibrary() {
  const select = $('setupSelect');
  if (!select || !library) return;
  const previous = select.value;
  select.innerHTML = '';
  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Условия по умолчанию (сетап не применён)';
  select.appendChild(none);
  for (const setup of library.setups) {
    for (const version of setup.versions) {
      const option = document.createElement('option');
      option.value = setup.id + '|' + version.version;
      option.textContent = setup.name + ' · v' + version.version + ' · ' + version.fingerprint.slice(0, 8);
      select.appendChild(option);
    }
  }
  if (library.activeId) select.value = library.activeId + '|' + library.activeVersion;
  else if ([...select.options].some(o => o.value === previous)) select.value = previous;
  fillFields(library.activeDefinition);
  const active = library.setups.find(s => s.id === library.activeId);
  say(active ? 'Активен: ' + active.name + ' · v' + library.activeVersion + '. Сохранённые версии неизменяемы; повторное сохранение добавит новую версию.' : 'Активны условия по умолчанию. Сохраните свои условия как именованный сетап.');
}

async function loadLibrary() {
  try {
    const response = await fetch('/v1/setups', { cache: 'no-store' });
    if (response.status === 402) { say('Требуется лицензия — активируйте ключ, чтобы работать с сетапами.'); return; }
    if (!response.ok) throw new Error('HTTP ' + response.status);
    library = await response.json();
    renderLibrary();
  } catch (error) { say('Библиотека сетапов недоступна: ' + error.message); }
}

async function postJson(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.message || data.error || 'HTTP ' + response.status);
  return data;
}

function announceChange() { window.dispatchEvent(new CustomEvent('setups-changed')); }

$('saveSetup')?.addEventListener('click', async () => {
  const name = ($('setupName')?.value || '').trim();
  if (!name) { say('Сначала введите название сетапа.'); return; }
  try {
    const result = await postJson('/v1/setups', { name, definition: collectDefinition() });
    await loadLibrary();
    say(result.deduplicated ? 'Такие условия уже сохранены как ' + name + ' v' + result.version + '.' : 'Сохранено: ' + name + ' v' + result.version + ' (' + result.fingerprint.slice(0, 8) + '). Нажмите «Применить», чтобы использовать.');
    announceChange();
  } catch (error) { say('Не удалось сохранить: ' + error.message); }
});

$('applySetup')?.addEventListener('click', async () => {
  const value = $('setupSelect')?.value;
  if (!value) { say('Выберите сохранённую версию сетапа, чтобы применить.'); return; }
  const [id, version] = value.split('|');
  try {
    await postJson('/v1/setups/apply', { id, version: Number(version) });
    await loadLibrary();
    say('Применено. Сигналы, бэктест и риск теперь используют эти условия.');
    announceChange();
  } catch (error) { say('Не удалось применить: ' + error.message); }
});

$('exportSetup')?.addEventListener('click', async () => {
  const value = $('setupSelect')?.value;
  if (!value) { say('Выберите версию сетапа для экспорта.'); return; }
  const [id, version] = value.split('|');
  try {
    const response = await fetch('/v1/setups/export?id=' + encodeURIComponent(id) + '&version=' + version, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'gold3po-setup-' + data.name.replace(/[^\w.-]+/g, '-') + '-v' + data.version + '.json';
    link.click();
    URL.revokeObjectURL(link.href);
    say('Экспортировано: ' + data.name + ' v' + data.version + ' в JSON.');
  } catch (error) { say('Не удалось экспортировать: ' + error.message); }
});

$('importSetup')?.addEventListener('click', () => $('importSetupFile')?.click());

$('importSetupFile')?.addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    const definition = parsed.definition || parsed;
    const name = parsed.name || file.name.replace(/\.json$/i, '');
    const result = await postJson('/v1/setups/import', { name, definition });
    await loadLibrary();
    say('Импортировано как новый сетап (v' + result.version + '). Примените его вручную, когда будете готовы.');
    announceChange();
  } catch (error) { say('Импорт отклонён: ' + error.message); }
  event.target.value = '';
});

loadLibrary();
