export function futureProjectionBarCount(chartWidth: number) {
  if (!Number.isFinite(chartWidth)) return 48
  return Math.max(48, Math.min(270, Math.round(chartWidth * 0.22)))
}
