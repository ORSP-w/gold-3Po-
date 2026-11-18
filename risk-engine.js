export function calculateRiskPlan(input = {}) {
  const equity = Number(input.equity), riskPct = Number(input.riskPct),
    entry = Number(input.entry), stop = Number(input.stop), target = Number(input.target),
    pointValue = Number(input.pointValue), maxRiskPct = Number(input.maxRiskPct ?? 1),
    minRiskReward = Number(input.minRiskReward ?? 1.5);
  const values = [equity, riskPct, entry, stop, target, pointValue, maxRiskPct, minRiskReward];
  if (values.some(value => !Number.isFinite(value)) || equity <= 0 || riskPct <= 0 ||
      pointValue <= 0 || maxRiskPct <= 0 || minRiskReward <= 0 || entry <= 0 || stop <= 0 || target <= 0) {
    throw new TypeError('Equity, risk, prices and point value must be positive finite numbers');
  }
  const direction = target > entry && stop < entry ? 'long' : target < entry && stop > entry ? 'short' : null;
  const stopDistance = Math.abs(entry - stop), targetDistance = Math.abs(target - entry);
  const riskReward = stopDistance > 0 ? targetDistance / stopDistance : 0;
  const riskAmount = equity * riskPct / 100;
  const quantity = stopDistance > 0 ? riskAmount / (stopDistance * pointValue) : 0;
  const checks = [
    { id: 'risk-cap', passed: riskPct <= maxRiskPct, message: `Risk ${riskPct}% must not exceed cap ${maxRiskPct}%` },
    { id: 'direction', passed: Boolean(direction), message: 'Stop and target must be on opposite sides of entry in a consistent direction' },
    { id: 'reward-risk', passed: riskReward >= minRiskReward, message: `Reward/risk must be at least ${minRiskReward}:1` },
    { id: 'size', passed: quantity > 0 && Number.isFinite(quantity), message: 'Position size must be positive' }
  ];
  return {
    allowed: checks.every(check => check.passed),
    direction, equity, riskAmount, quantity,
    stopDistance, targetDistance, riskReward,
    plannedLoss: riskAmount,
    plannedGain: quantity * targetDistance * pointValue,
    checks
  };
}
