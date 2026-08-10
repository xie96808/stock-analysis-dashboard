from collections import OrderedDict
from datetime import date
from typing import Literal

from .models import BarPayload


def aggregate_bars(bars: list[BarPayload], timeframe: Literal["1w", "1M"]) -> list[BarPayload]:
    groups: OrderedDict[str, list[BarPayload]] = OrderedDict()
    for bar in bars:
        trading_day = date.fromisoformat(bar.time[:10])
        if timeframe == "1w":
            year, week, _ = trading_day.isocalendar()
            key = f"{year}-W{week:02d}"
        else:
            key = trading_day.strftime("%Y-%m")
        groups.setdefault(key, []).append(bar)

    aggregated: list[BarPayload] = []
    for group in groups.values():
        amount_values = [bar.amount for bar in group if bar.amount is not None]
        turnover_values = [min(bar.turnover_rate, 1) for bar in group if bar.turnover_rate is not None]
        effective_turnover = None
        if turnover_values:
            survival = 1.0
            for turnover in turnover_values:
                survival *= 1 - turnover
            effective_turnover = 1 - survival
        aggregated.append(
            BarPayload(
                time=group[-1].time[:10],
                open=group[0].open,
                high=max(bar.high for bar in group),
                low=min(bar.low for bar in group),
                close=group[-1].close,
                volume=sum(bar.volume for bar in group),
                amount=sum(amount_values) if amount_values else None,
                turnover_rate=effective_turnover,
            )
        )
    return aggregated


def aggregate_minute_bars(bars: list[BarPayload], minutes: int) -> list[BarPayload]:
    """Aggregate intraday bars without inventing rows for lunch breaks or market closure."""
    groups: OrderedDict[str, list[BarPayload]] = OrderedDict()
    for bar in bars:
        hour, minute = map(int, bar.time[11:16].split(":"))
        clock_minute = hour * 60 + minute
        if clock_minute < 12 * 60:
            session_offset = max(0, clock_minute - (9 * 60 + 30))
        else:
            session_offset = 150 + max(0, clock_minute - 13 * 60)
        key = f"{bar.time[:10]}-{session_offset // minutes}"
        groups.setdefault(key, []).append(bar)

    result: list[BarPayload] = []
    for group in groups.values():
        amounts = [bar.amount for bar in group if bar.amount is not None]
        result.append(
            BarPayload(
                time=group[-1].time,
                open=group[0].open,
                high=max(bar.high for bar in group),
                low=min(bar.low for bar in group),
                close=group[-1].close,
                volume=sum(bar.volume for bar in group),
                amount=sum(amounts) if amounts else None,
            )
        )
    return result
