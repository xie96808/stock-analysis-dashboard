from datetime import UTC, datetime
from pathlib import Path
from typing import Any
import time
from zoneinfo import ZoneInfo

import httpx

from .aggregate import aggregate_bars
from .base import MarketProvider, ProviderError
from .cache import JsonCache
from .models import Adjustment, BarPayload, BarsResponse, InstrumentPayload, InstrumentSearchResult, QuoteResponse, Timeframe
from .symbols import Instrument, normalize_symbol
from .tencent import TencentProvider
from .yahoo import YahooProvider


class MarketDataService:
    def __init__(
        self,
        cache_root: Path,
        provider: MarketProvider | None = None,
        providers: list[MarketProvider] | None = None,
    ):
        self.cache = JsonCache(cache_root)
        self.providers: list[MarketProvider] = providers or ([provider] if provider else [TencentProvider(), YahooProvider()])
        self.provider = self.providers[0]
        self._provider_health: dict[str, dict[str, Any]] = {
            item.name: {"name": item.name, "healthy": True, "failures": 0, "last_error": None, "last_success_at": None}
            for item in self.providers
        }
        self._search_cache: dict[str, tuple[float, list[InstrumentSearchResult]]] = {}

    @staticmethod
    def resolve(raw: str, name: str | None = None) -> InstrumentPayload:
        instrument = normalize_symbol(raw)
        return InstrumentPayload(
            symbol=instrument.symbol,
            key=instrument.key,
            market=instrument.market,
            exchange=instrument.exchange,
            provider_symbol=instrument.provider_symbol,
            currency=instrument.currency,
            name=name,
        )

    @staticmethod
    def _ttl(timeframe: Timeframe) -> int:
        return 120 if timeframe.endswith("m") else 14_400

    @staticmethod
    def _freshness_seconds(fetched_at: datetime) -> int:
        value = fetched_at if fetched_at.tzinfo else fetched_at.replace(tzinfo=UTC)
        return max(0, int((datetime.now(UTC) - value).total_seconds()))

    @staticmethod
    def _bar_freshness_seconds(bars: list[BarPayload], fallback: datetime) -> int:
        if not bars:
            return MarketDataService._freshness_seconds(fallback)
        value = bars[-1].time
        try:
            if " " in value:
                market_time = datetime.strptime(value, "%Y-%m-%d %H:%M").replace(tzinfo=ZoneInfo("Asia/Shanghai"))
            else:
                market_time = datetime.strptime(value, "%Y-%m-%d").replace(
                    hour=15, minute=0, tzinfo=ZoneInfo("Asia/Shanghai")
                )
            return max(0, int((datetime.now(UTC) - market_time.astimezone(UTC)).total_seconds()))
        except ValueError:
            return MarketDataService._freshness_seconds(fallback)

    @staticmethod
    def _quality_issues(bars: list[BarPayload]) -> list[str]:
        issues: list[str] = []
        times = [bar.time for bar in bars]
        if len(times) != len(set(times)):
            issues.append("行情包含重复时间点")
        if times != sorted(times):
            issues.append("行情时间顺序异常")
        for bar in bars:
            if min(bar.open, bar.high, bar.low, bar.close) <= 0:
                issues.append(f"{bar.time}包含非正价格")
                break
            if bar.high < max(bar.open, bar.close) or bar.low > min(bar.open, bar.close) or bar.high < bar.low:
                issues.append(f"{bar.time}的OHLC范围异常")
                break
        for previous, current in zip(bars, bars[1:]):
            if previous.close > 0 and abs(current.close / previous.close - 1) > 0.5:
                issues.append(f"{current.time}相邻收盘价变化超过50%，请核对复权或除权")
                break
        return issues

    def _record_provider_result(self, name: str, error: Exception | None) -> None:
        status = self._provider_health[name]
        if error is None:
            status.update({"healthy": True, "failures": 0, "last_error": None, "last_success_at": datetime.now(UTC).isoformat()})
            return
        failures = int(status["failures"]) + 1
        status.update({"healthy": False, "failures": failures, "last_error": str(error)[:240]})

    def provider_status(self) -> list[dict[str, Any]]:
        return [dict(self._provider_health[item.name], priority=index + 1) for index, item in enumerate(self.providers)]

    async def search_instruments(self, query: str, limit: int = 5) -> list[InstrumentSearchResult]:
        value = query.strip()
        if not value:
            return []
        normalized_limit = max(1, min(limit, 10))
        cache_key = value.casefold()
        cached = self._search_cache.get(cache_key)
        if cached and time.monotonic() - cached[0] < 600:
            return cached[1][:normalized_limit]
        for provider in self.providers:
            search = getattr(provider, "search_instruments", None)
            if not callable(search):
                continue
            try:
                results = await search(value, 10)
                if results:
                    self._search_cache[cache_key] = (time.monotonic(), results)
                    if len(self._search_cache) > 200:
                        oldest = min(self._search_cache, key=lambda key: self._search_cache[key][0])
                        self._search_cache.pop(oldest, None)
                    return results[:normalized_limit]
            except (ProviderError, httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                self._record_provider_result(provider.name, error)
        return []

    async def _fetch_bars(
        self,
        instrument: Instrument,
        timeframe: Timeframe,
        adjustment: Adjustment,
        limit: int,
    ) -> tuple[list[BarPayload], str | None, str, bool, list[str], list[str], Adjustment]:
        attempts: list[str] = []
        errors: list[str] = []
        for index, provider in enumerate(self.providers):
            attempts.append(provider.name)
            try:
                if timeframe in {"1w", "1M"}:
                    daily, name, _ = await provider.daily_bars(instrument, adjustment, min(2000, limit * 7))
                    bars = aggregate_bars(daily, timeframe)
                    applied_adjustment = adjustment
                elif timeframe == "1d":
                    bars, name, _ = await provider.daily_bars(instrument, adjustment, limit)
                    applied_adjustment = adjustment
                else:
                    bars, name, _ = await provider.minute_bars(instrument, timeframe, limit)
                    applied_adjustment = "none"
                if not bars:
                    raise ProviderError("provider returned no bars")
                self._record_provider_result(provider.name, None)
                issues = self._quality_issues(bars)
                if provider.name == "yahoo-chart":
                    issues.append("备用源不提供成交额与换手率")
                return bars, name, provider.name, index > 0, attempts, issues, applied_adjustment
            except (ProviderError, httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                self._record_provider_result(provider.name, error)
                errors.append(f"{provider.name}: {error}")
        raise ProviderError("; ".join(errors) or "All market-data providers failed")

    async def get_bars(
        self,
        raw_symbol: str,
        timeframe: Timeframe,
        adjustment: Adjustment,
        limit: int,
        refresh: bool = False,
        trading_date: str | None = None,
    ) -> BarsResponse:
        instrument: Instrument = normalize_symbol(raw_symbol)
        normalized_limit = max(1, min(limit, 2000))
        cache_key = f"v3-{instrument.provider_symbol}-{timeframe}-{adjustment}"
        cached_value = None if refresh else self.cache.get(cache_key, self._ttl(timeframe))
        if cached_value and cached_value.get("requested_limit", 0) >= normalized_limit:
            response = BarsResponse.model_validate(cached_value)
            response.cached = True
            response.freshness_seconds = self._bar_freshness_seconds(response.bars, response.fetched_at)
        else:
            stale_value = self.cache.get_any(cache_key)
            try:
                bars, name, source, fallback_used, provider_chain, quality_issues, applied_adjustment = await self._fetch_bars(
                    instrument, timeframe, adjustment, normalized_limit
                )
            except ProviderError:
                if stale_value is None:
                    raise
                response = BarsResponse.model_validate(stale_value)
                response.cached = True
                response.stale = True
                response.fallback_used = True
                response.freshness_seconds = self._bar_freshness_seconds(response.bars, response.fetched_at)
                response.provider_chain = [item.name for item in self.providers]
                response.quality_issues = list(dict.fromkeys([
                    *response.quality_issues,
                    "全部在线行情源暂不可用，当前使用过期本地缓存",
                ]))
                response.bars = response.bars[-normalized_limit:]
                response.requested_limit = normalized_limit
                if trading_date:
                    response.bars = [bar for bar in response.bars if bar.time.startswith(trading_date)]
                return response
            if stale_value:
                stale_response = BarsResponse.model_validate(stale_value)
                merged = {bar.time: bar for bar in stale_response.bars}
                merged.update({bar.time: bar for bar in bars})
                bars = [merged[key] for key in sorted(merged)][-2000:]
                quality_issues = list(dict.fromkeys([*quality_issues, *self._quality_issues(bars)]))
            response = BarsResponse(
                instrument=self.resolve(raw_symbol, name),
                timeframe=timeframe,
                adjustment=adjustment,
                adjustment_applied=applied_adjustment,
                source=source,
                fetched_at=datetime.now(UTC),
                cached=False,
                delayed=True,
                requested_limit=normalized_limit,
                provider_chain=provider_chain,
                fallback_used=fallback_used,
                stale=False,
                freshness_seconds=self._bar_freshness_seconds(bars, datetime.now(UTC)),
                quality_issues=list(dict.fromkeys(quality_issues)),
                bars=bars,
            )
            self.cache.set(cache_key, response.model_dump(mode="json"))

        response.bars = response.bars[-normalized_limit:]
        response.requested_limit = normalized_limit
        if trading_date:
            response.bars = [bar for bar in response.bars if bar.time.startswith(trading_date)]
        return response

    async def get_quote(self, raw_symbol: str) -> QuoteResponse:
        instrument = normalize_symbol(raw_symbol)
        errors: list[str] = []
        for index, provider in enumerate(self.providers):
            try:
                bars, name, node = await provider.daily_bars(instrument, "qfq", 2)
                quote = provider.quote_from_node(instrument, node, name)
                if quote is not None:
                    quote.fallback_used = index > 0
                    if index > 0 and "备用行情源" not in quote.quality_issues:
                        quote.quality_issues.append("主行情源不可用，报价来自备用行情源")
                    self._record_provider_result(provider.name, None)
                    return quote
                if not bars:
                    raise ProviderError(f"No quote data for {instrument.key}")
                last = bars[-1]
                previous = bars[-2].close if len(bars) > 1 else None
                self._record_provider_result(provider.name, None)
                return QuoteResponse(
                    instrument=self.resolve(raw_symbol, name),
                    last=last.close,
                    previous_close=previous,
                    open=last.open,
                    high=last.high,
                    low=last.low,
                    volume=last.volume,
                    timestamp=last.time,
                    source=provider.name,
                    delayed=True,
                    fallback_used=index > 0,
                    quality_issues=["主行情源不可用，报价来自备用行情源"] if index > 0 else [],
                )
            except (ProviderError, httpx.HTTPError, ValueError, KeyError, TypeError) as error:
                self._record_provider_result(provider.name, error)
                errors.append(f"{provider.name}: {error}")
        raise ProviderError("; ".join(errors) or f"No quote data for {instrument.key}")
