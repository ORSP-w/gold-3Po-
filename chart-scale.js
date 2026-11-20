// Bar pitch the price chart may shrink to before the series becomes a horizontal strip.
// The panel decides it: a phone chart keeps fat candles, a 4K panel can carry far more history.
export const MIN_BAR_PX = Object.freeze({ compact: 5, laptop: 3, wide: 2 });

export const CHART_AXIS = Object.freeze({ left: 64, right: 85 });

export function minBarWidth(paneWidth) {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) throw new TypeError('paneWidth must be a positive number');
  if (paneWidth >= 1600) return MIN_BAR_PX.wide;
  if (paneWidth >= 900) return MIN_BAR_PX.laptop;
  return MIN_BAR_PX.compact;
}

// Fits the whole series into the visible plot area when the bars can stay readable at that pitch,
// and only grows past the panel when the series is too dense for the panel's minimum pitch.
export function chartScale({ panelWidth, bars, left = CHART_AXIS.left, right = CHART_AXIS.right } = {}) {
  if (!Number.isFinite(panelWidth) || panelWidth <= 0) throw new TypeError('panelWidth must be a positive number');
  if (!Number.isInteger(bars) || bars < 0) throw new TypeError('bars must be a non-negative integer');
  const pane = Math.max(200, Math.round(panelWidth) - left - right);
  const minBar = minBarWidth(pane);
  const width = bars === 0 ? pane : Math.max(pane, Math.round(bars * minBar));
  return { pane, minBar, width, svgWidth: left + width + right, step: width / Math.max(1, bars) };
}
