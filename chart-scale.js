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


// Price-axis viewport helpers. anchorRatio is measured from the top of the plot (0) to its bottom (1).
export function priceViewport({ low, high, zoom = 1, offset = 0 } = {}) {
  if (!Number.isFinite(low) || !Number.isFinite(high) || high < low) throw new TypeError('price bounds must be finite and ordered');
  if (!Number.isFinite(zoom) || zoom < CHART_ZOOM.min || zoom > CHART_ZOOM.max) throw new TypeError('price zoom is outside the supported range');
  if (!Number.isFinite(offset)) throw new TypeError('price offset must be finite');
  const baseRange = Math.max(0.01, high - low + 2);
  const baseCenter = (low + high) / 2;
  const center = baseCenter + offset;
  const range = baseRange / zoom;
  return { min: center - range / 2, max: center + range / 2, range, center, baseCenter, baseRange };
}

export function zoomPriceViewport({ low, high, zoom = 1, nextZoom = zoom, offset = 0, anchorRatio = 0.5 } = {}) {
  if (!Number.isFinite(anchorRatio) || anchorRatio < 0 || anchorRatio > 1) throw new TypeError('anchorRatio must be between 0 and 1');
  const current = priceViewport({ low, high, zoom, offset });
  const anchorPrice = current.max - current.range * anchorRatio;
  const boundedZoom = Math.min(CHART_ZOOM.max, Math.max(CHART_ZOOM.min, nextZoom));
  const nextRange = current.baseRange / boundedZoom;
  const nextCenter = anchorPrice + (anchorRatio - 0.5) * nextRange;
  return { zoom: boundedZoom, offset: nextCenter - current.baseCenter };
}

export function panPriceViewport({ low, high, zoom = 1, offset = 0, deltaPixels = 0, plotHeight = 315 } = {}) {
  if (!Number.isFinite(deltaPixels) || !Number.isFinite(plotHeight) || plotHeight <= 0) throw new TypeError('pan distance and plot height must be finite');
  const viewport = priceViewport({ low, high, zoom, offset });
  // Dragging the price axis down moves the visible candles down, hence the negative offset.
  return offset - deltaPixels * viewport.range / plotHeight;
}
