"""Tongdaxin-compatible SMA / EMA / MACD. Must stay aligned with src/indicators/tdx.ts."""

from collections.abc import Sequence


def ema(values: Sequence[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def sma(values: Sequence[float], period: int) -> list[float | None]:
    result: list[float | None] = []
    for index in range(len(values)):
        if period < 1 or index + 1 < period:
            result.append(None)
        else:
            window = values[index + 1 - period : index + 1]
            result.append(sum(window) / period)
    return result


def macd(
    values: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> list[tuple[float, float, float]]:
    fast_ema = ema(values, fast)
    slow_ema = ema(values, slow)
    dif = [left - right for left, right in zip(fast_ema, slow_ema)]
    dea = ema(dif, signal)
    return [(left, right, (left - right) * 2) for left, right in zip(dif, dea)]
