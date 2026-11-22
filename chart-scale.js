// Responsive base pitch plus explicit trader-controlled zoom.
// Dense history becomes horizontally scrollable; zoom-out fits more bars into the panel.
export const MIN_BAR_PX = Object.freeze({ compact: 5, laptop: 3, wide: 2 });
export const CHART_AXIS = Object.freeze({ left: 64, right: 85 });
export const CHART_ZOOM = Object.freeze({ min: 0.25, max: 8 });

export function minBarWidth(paneWidth) {
  if (!Number.isFinite(paneWidth) || paneWidth <= 0) throw new TypeError('paneWidth must be a positive number');
  if (paneWidth >= 1600) return MIN_BAR_PX.wide;
  if (paneWidth >= 900) return MIN_BAR_PX.laptop;
  return MIN_BAR_PX.compact;
}

export function chartScale({ panelWidth, bars, left = CHART_AXIS.left, right = CHART_AXIS.right, zoom = 1 } = {}) {
  if (!Number.isFinite(panelWidth) || panelWidth <= 0) throw new TypeError('panelWidth must be a positive number');
  if (!Number.isInteger(bars) || bars < 0) throw new TypeError('bars must be a non-negative integer');
  if (!Number.isFinite(zoom) || zoom < CHART_ZOOM.min || zoom > CHART_ZOOM.max) {
    throw new TypeError(`zoom must be between ${CHART_ZOOM.min} and ${CHART_ZOOM.max}`);
  }
  const pane = Math.max(200, Math.round(panelWidth) - left - right);
  const minBar = minBarWidth(pane);
  if (bars === 0) return { pane, minBar, width: pane, svgWidth: left + pane + right, step: pane, zoom };
  const fitStep = pane / bars;
  const baseStep = Math.max(minBar, fitStep);
  const desiredStep = Math.max(0.5, baseStep * zoom);
  const width = Math.max(pane, Math.round(bars * desiredStep));
  const step = width / bars;
  return { pane, minBar, width, svgWidth: left + width + right, step, zoom };
}
