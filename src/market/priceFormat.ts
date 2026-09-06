/** Display / order price fraction digits by market and instrument. */
export function priceFractionDigits(symbol: string, market: 'CN' | 'HK'): number {
  if (market === 'HK') return 3
  // CN ETF / fund codes commonly tick at 0.001
  if (/^(15|16|18|50|51|56|58)/.test(symbol)) return 3
  return 2
}

export function formatPrice(value: number, symbol: string, market: 'CN' | 'HK'): string {
  return value.toFixed(priceFractionDigits(symbol, market))
}
