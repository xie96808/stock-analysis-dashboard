export function isCompleteMarketSymbol(value: string) {
  const normalized = value.replace(/\s+/g, '').toLowerCase()
  return (
    /^\d{5,6}$/.test(normalized)
    || /^(?:sh|sz|bj|hk)[:.]?\d{1,6}$/.test(normalized)
    || /^\d{1,6}\.(?:sh|sz|bj|hk)$/.test(normalized)
  )
}
