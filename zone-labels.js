// Russian captions for zone labels and states.
// One source of truth for the workspace UI and the MT5 snapshot: the chart in MT5 must say the
// same thing as the panel, otherwise the same zone reads differently in two places.

export const ZONE_STATES_RU = Object.freeze({
  UNTESTED: 'НЕ ПРОВЕРЕНА',
  SWEPT: 'ПРОБИТА',
  TESTED: 'ПРОВЕРЕНА',
  FLIPPED: 'СМЕНА РОЛИ',
  'AT PRICE': 'У ЦЕНЫ',
  'NEAR PRICE': 'РЯДОМ'
});

export const ZONE_LABELS_RU = Object.freeze({
  'Role-flip level (highs + lows)': 'Смена роли (максимумы и минимумы)',
  'Repeated swing highs': 'Повторный максимум',
  'Repeated swing lows': 'Повторный минимум',
  'Swing high': 'Максимум свинга',
  'Swing low': 'Минимум свинга',
  'Range high': 'Максимум диапазона',
  'Range low': 'Минимум диапазона',
  'Volume node': 'Узел объёма',
  'Round number': 'Круглый уровень',
  'Prior day high': 'Максимум прошлого дня',
  'Prior day low': 'Минимум прошлого дня',
  'Two days ago high': 'Максимум позавчерашнего дня',
  'Two days ago low': 'Минимум позавчерашнего дня',
  'Asia high': 'Максимум азиатской сессии',
  'Asia low': 'Минимум азиатской сессии',
  'London high': 'Максимум лондонской сессии',
  'London low': 'Минимум лондонской сессии',
  'New York high': 'Максимум нью-йоркской сессии',
  'New York low': 'Минимум нью-йоркской сессии',
  'Weekly open': 'Открытие недели',
  'Prior week high': 'Максимум прошлой недели',
  'Prior week low': 'Минимум прошлой недели',
  'H4 swing high': 'Свинг H4 · максимум',
  'H4 swing low': 'Свинг H4 · минимум',
  'H1 swing high': 'Свинг H1 · максимум',
  'H1 swing low': 'Свинг H1 · минимум',
  'Volume POC': 'Узел объёма (POC)',
  'Value area high': 'Верх зоны стоимости',
  'Value area low': 'Низ зоны стоимости'
});

const ROLE_FLIP = ' · role flip';

export function zoneStateRu(state) {
  return ZONE_STATES_RU[String(state ?? '').toUpperCase()] || 'НАЙДЕНА';
}

export function zoneLabelRu(label) {
  const text = String(label ?? '').trim();
  if (!text) return 'Уровень';
  const flipped = text.endsWith(ROLE_FLIP);
  const base = flipped ? text.slice(0, -ROLE_FLIP.length) : text;
  const translated = ZONE_LABELS_RU[base]
    || base.replace(/^(\d+)-bar high$/, 'Максимум $1 свечей').replace(/^(\d+)-bar low$/, 'Минимум $1 свечей');
  return flipped ? translated + ' · смена роли' : translated;
}
