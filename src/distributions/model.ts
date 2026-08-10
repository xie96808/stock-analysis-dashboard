export type DistributionMode = 'volume' | 'chips' | 'hidden'

export function distributionVisibility(
  mode: DistributionMode,
  cleanMode: boolean,
  market: 'CN' | 'HK',
) {
  if (cleanMode || mode === 'hidden') return { volume: false, chips: false }
  return {
    volume: mode === 'volume',
    chips: mode === 'chips' && market === 'CN',
  }
}

export function resolveChipAsOfDate(
  tradingDates: string[],
  selectedDate: string | null,
  historicalCutoff: string | null,
) {
  const latest = tradingDates.at(-1)?.slice(0, 10) ?? ''
  const constraints = [selectedDate, historicalCutoff].filter((value): value is string => Boolean(value)).sort()
  const target = constraints[0] ?? latest
  return tradingDates
    .filter((date) => date.slice(0, 10) <= target)
    .at(-1)
    ?.slice(0, 10) ?? latest
}
