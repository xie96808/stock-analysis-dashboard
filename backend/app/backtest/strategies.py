from collections.abc import Sequence

from ..market_data.models import BarPayload
from .models import StrategyType


def _positive_int(parameters: dict[str, int | float], key: str, fallback: int, maximum: int = 500) -> int:
    value = parameters.get(key, fallback)
    return max(1, min(maximum, int(value)))


def _moving_average(values: Sequence[float], period: int, index: int) -> float | None:
    if index + 1 < period:
        return None
    window = values[index - period + 1:index + 1]
    return sum(window) / period


def _ema(values: Sequence[float], period: int) -> list[float]:
    if not values:
        return []
    alpha = 2 / (period + 1)
    result = [values[0]]
    for value in values[1:]:
        result.append(alpha * value + (1 - alpha) * result[-1])
    return result


def target_positions(
    bars: list[BarPayload], strategy: StrategyType, parameters: dict[str, int | float]
) -> tuple[list[int], dict[str, int | float]]:
    closes = [bar.close for bar in bars]
    targets = [0] * len(bars)
    normalized: dict[str, int | float]

    if strategy == "ma_cross":
        fast = _positive_int(parameters, "fast", 5)
        slow = _positive_int(parameters, "slow", 20)
        if fast >= slow:
            raise ValueError("MA fast period must be smaller than slow period")
        normalized = {"fast": fast, "slow": slow}
        for index in range(len(bars)):
            fast_value = _moving_average(closes, fast, index)
            slow_value = _moving_average(closes, slow, index)
            targets[index] = int(fast_value is not None and slow_value is not None and fast_value > slow_value)
        return targets, normalized

    if strategy == "breakout":
        entry = _positive_int(parameters, "entry_lookback", 20)
        exit_ = _positive_int(parameters, "exit_lookback", 10)
        normalized = {"entry_lookback": entry, "exit_lookback": exit_}
        state = 0
        for index, bar in enumerate(bars):
            if index >= entry and bar.close > max(item.high for item in bars[index - entry:index]):
                state = 1
            elif state and index >= exit_ and bar.close < min(item.low for item in bars[index - exit_:index]):
                state = 0
            targets[index] = state
        return targets, normalized

    fast = _positive_int(parameters, "fast", 12)
    slow = _positive_int(parameters, "slow", 26)
    signal = _positive_int(parameters, "signal", 9)
    if fast >= slow:
        raise ValueError("MACD fast period must be smaller than slow period")
    normalized = {"fast": fast, "slow": slow, "signal": signal}
    fast_ema = _ema(closes, fast)
    slow_ema = _ema(closes, slow)
    dif = [fast_value - slow_value for fast_value, slow_value in zip(fast_ema, slow_ema)]
    dea = _ema(dif, signal)
    for index in range(len(bars)):
        targets[index] = int(index >= slow and dif[index] > dea[index])
    return targets, normalized
