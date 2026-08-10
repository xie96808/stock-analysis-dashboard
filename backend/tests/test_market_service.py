import asyncio
from pathlib import Path
from typing import Any

from backend.app.market_data.models import Adjustment, BarPayload, Timeframe
from backend.app.market_data.base import ProviderError
from backend.app.market_data.service import MarketDataService
from backend.app.market_data.symbols import Instrument


class FakeProvider:
    name = "fake-provider"

    def __init__(self) -> None:
        self.calls = 0

    async def daily_bars(
        self, instrument: Instrument, adjustment: Adjustment, limit: int
    ) -> tuple[list[BarPayload], str, dict[str, Any]]:
        self.calls += 1
        return (
            [
                BarPayload(time="2026-08-06", open=10, high=12, low=9, close=11, volume=100),
                BarPayload(time="2026-08-07", open=11, high=13, low=10, close=12, volume=120),
            ],
            "测试标的",
            {},
        )

    async def minute_bars(
        self, instrument: Instrument, timeframe: Timeframe, limit: int
    ) -> tuple[list[BarPayload], str, dict[str, Any]]:
        self.calls += 1
        return (
            [BarPayload(time="2026-08-07 09:35", open=11, high=12, low=10, close=11.5, volume=20)],
            "测试标的",
            {},
        )

    def quote_from_node(self, instrument: Instrument, node: dict[str, Any], name: str | None):
        return None


class FailingProvider(FakeProvider):
    def __init__(self, name: str = "failing-provider") -> None:
        super().__init__()
        self.name = name

    async def daily_bars(self, instrument: Instrument, adjustment: Adjustment, limit: int):
        self.calls += 1
        raise ProviderError("simulated outage")

    async def minute_bars(self, instrument: Instrument, timeframe: Timeframe, limit: int):
        self.calls += 1
        raise ProviderError("simulated outage")


def test_service_caches_daily_bars(tmp_path: Path) -> None:
    provider = FakeProvider()
    service = MarketDataService(tmp_path, provider=provider)  # type: ignore[arg-type]
    first = asyncio.run(service.get_bars("001280", "1d", "qfq", 20))
    second = asyncio.run(service.get_bars("001280", "1d", "qfq", 20))
    assert first.cached is False
    assert second.cached is True
    assert provider.calls == 1
    assert second.instrument.name == "测试标的"
    assert second.bars[-1].close == 12


def test_cached_response_reports_the_current_requested_limit(tmp_path: Path) -> None:
    provider = FakeProvider()
    service = MarketDataService(tmp_path, provider=provider)  # type: ignore[arg-type]
    asyncio.run(service.get_bars("001280", "1d", "qfq", 20))

    result = asyncio.run(service.get_bars("001280", "1d", "qfq", 1))

    assert provider.calls == 1
    assert result.cached is True
    assert result.requested_limit == 1
    assert len(result.bars) == 1


def test_service_filters_intraday_date(tmp_path: Path) -> None:
    service = MarketDataService(tmp_path, provider=FakeProvider())  # type: ignore[arg-type]
    result = asyncio.run(service.get_bars("001280", "5m", "qfq", 20, trading_date="2026-08-07"))
    assert len(result.bars) == 1
    assert result.adjustment_applied == "none"


def test_refresh_merges_new_bars_into_local_history(tmp_path: Path) -> None:
    provider = FakeProvider()
    service = MarketDataService(tmp_path, provider=provider)  # type: ignore[arg-type]
    first = asyncio.run(service.get_bars("001280", "1d", "qfq", 20))

    async def updated_daily(
        instrument: Instrument, adjustment: Adjustment, limit: int
    ) -> tuple[list[BarPayload], str, dict[str, Any]]:
        return (
            [BarPayload(time="2026-08-10", open=12, high=14, low=11, close=13, volume=140)],
            "测试标的",
            {},
        )

    provider.daily_bars = updated_daily  # type: ignore[method-assign]
    refreshed = asyncio.run(service.get_bars("001280", "1d", "qfq", 20, refresh=True))
    assert [item.time for item in first.bars] == ["2026-08-06", "2026-08-07"]
    assert [item.time for item in refreshed.bars] == ["2026-08-06", "2026-08-07", "2026-08-10"]


def test_service_switches_to_secondary_provider_and_exposes_health(tmp_path: Path) -> None:
    primary = FailingProvider("primary")
    secondary = FakeProvider()
    secondary.name = "secondary"
    service = MarketDataService(tmp_path, providers=[primary, secondary])  # type: ignore[list-item]

    result = asyncio.run(service.get_bars("001280", "1d", "qfq", 20))

    assert result.source == "secondary"
    assert result.fallback_used is True
    assert result.provider_chain == ["primary", "secondary"]
    status = {item["name"]: item for item in service.provider_status()}
    assert status["primary"]["healthy"] is False
    assert status["secondary"]["healthy"] is True


def test_service_uses_expired_cache_only_after_all_providers_fail(tmp_path: Path) -> None:
    seed = MarketDataService(tmp_path, provider=FakeProvider())  # type: ignore[arg-type]
    asyncio.run(seed.get_bars("001280", "1d", "qfq", 20))
    service = MarketDataService(
        tmp_path,
        providers=[FailingProvider("primary"), FailingProvider("secondary")],  # type: ignore[list-item]
    )

    result = asyncio.run(service.get_bars("001280", "1d", "qfq", 20, refresh=True))

    assert result.stale is True
    assert result.cached is True
    assert result.fallback_used is True
    assert "过期本地缓存" in result.quality_issues[-1]


def test_service_flags_invalid_ohlc_without_silently_rewriting_it(tmp_path: Path) -> None:
    provider = FakeProvider()

    async def invalid_daily(instrument: Instrument, adjustment: Adjustment, limit: int):
        return [BarPayload(time="2026-08-10", open=10, high=9, low=8, close=11, volume=10)], "异常样例", {}

    provider.daily_bars = invalid_daily  # type: ignore[method-assign]
    result = asyncio.run(MarketDataService(tmp_path, provider=provider).get_bars("001280", "1d", "qfq", 20))  # type: ignore[arg-type]
    assert result.bars[0].high == 9
    assert any("OHLC" in issue for issue in result.quality_issues)
