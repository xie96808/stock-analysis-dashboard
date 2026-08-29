from backend.app.market_data.aggregate import aggregate_bars, aggregate_minute_bars
from backend.app.market_data.models import BarPayload
import pytest


def bar(day: str, open_: float, high: float, low: float, close: float, volume: float) -> BarPayload:
    return BarPayload(time=day, open=open_, high=high, low=low, close=close, volume=volume)


def test_weekly_aggregation_uses_real_trading_bars() -> None:
    result = aggregate_bars(
        [
            bar("2026-08-03", 10, 12, 9, 11, 100),
            bar("2026-08-04", 11, 13, 10, 12, 200),
            bar("2026-08-10", 12, 14, 11, 13, 300),
        ],
        "1w",
    )
    assert len(result) == 2
    assert result[0].open == 10
    assert result[0].close == 12
    assert result[0].high == 13
    assert result[0].low == 9
    assert result[0].volume == 300
    assert result[0].time == "2026-08-04"


def test_monthly_aggregation() -> None:
    result = aggregate_bars(
        [
            bar("2026-07-31", 9, 11, 8, 10, 80),
            bar("2026-08-03", 10, 13, 9, 12, 100),
            bar("2026-08-31", 12, 15, 11, 14, 120),
        ],
        "1M",
    )
    assert [item.time for item in result] == ["2026-07-31", "2026-08-31"]
    assert result[-1].volume == 220


def test_aggregation_combines_turnover_as_surviving_chips() -> None:
    result = aggregate_bars(
        [
            BarPayload(time="2026-08-03", open=10, high=11, low=9, close=10.5, volume=100, turnover_rate=0.1),
            BarPayload(time="2026-08-04", open=10.5, high=12, low=10, close=11.5, volume=200, turnover_rate=0.2),
        ],
        "1w",
    )
    # Ten percent replaced and then twenty percent replaced leaves 72% of the
    # opening chips, so the effective period turnover is 28%.
    assert result[0].turnover_rate == pytest.approx(0.28)


def test_weekly_aggregation_handles_suspension_and_holiday_without_phantom_bars() -> None:
    result = aggregate_bars(
        [
            bar("2026-09-28", 10, 11, 9, 10.5, 100),
            bar("2026-09-30", 10.5, 12, 10, 11.8, 180),
            # 国庆休市期间没有输入bar；聚合器不得补出空行情。
            bar("2026-10-09", 11.8, 13, 11.5, 12.6, 220),
        ],
        "1w",
    )
    assert len(result) == 2
    assert [item.time for item in result] == ["2026-09-30", "2026-10-09"]
    assert result[0].volume == 280


def test_half_day_session_is_aggregated_from_available_bars_only() -> None:
    result = aggregate_bars(
        [
            bar("2026-02-16", 20, 21, 19.5, 20.5, 50),
            bar("2026-02-17", 20.5, 22, 20, 21.5, 35),
        ],
        "1w",
    )
    assert result[0].open == 20
    assert result[0].close == 21.5
    assert result[0].volume == 85


def test_minute_aggregation_resets_across_lunch_break() -> None:
    source = [
        BarPayload(time="2026-08-07 11:28", open=10, high=10.1, low=9.9, close=10, volume=12),
        BarPayload(time="2026-08-07 11:29", open=10, high=10.2, low=10, close=10.1, volume=13),
        BarPayload(time="2026-08-07 13:00", open=10.2, high=10.3, low=10.1, close=10.2, volume=14),
        BarPayload(time="2026-08-07 13:01", open=10.2, high=10.4, low=10.2, close=10.3, volume=15),
    ]
    result = aggregate_minute_bars(source, 5)
    assert len(result) == 2
    assert result[0].time.endswith("11:29")
    assert result[1].time.endswith("13:01")
    assert result[1].volume == 29


def test_sixty_minute_aggregation_never_combines_morning_and_afternoon() -> None:
    source = [
        BarPayload(time="2026-08-28 11:30", open=45, high=46, low=44.8, close=45.5, volume=100),
        BarPayload(time="2026-08-28 12:00", open=45.5, high=45.8, low=45.2, close=45.4, volume=120),
        BarPayload(time="2026-08-28 13:00", open=45.1, high=45.2, low=44.9, close=45, volume=140),
        BarPayload(time="2026-08-28 13:29", open=45, high=45.4, low=44.9, close=45.3, volume=160),
    ]

    result = aggregate_minute_bars(source, 60)

    assert len(result) == 2
    assert result[0].time.endswith("12:00")
    assert result[0].volume == 220
    assert result[1].time.endswith("13:29")
    assert result[1].volume == 300
