from typing import Any, Protocol

from .models import Adjustment, BarPayload, QuoteResponse, Timeframe
from .symbols import Instrument


class ProviderError(RuntimeError):
    pass


class MarketProvider(Protocol):
    name: str

    async def daily_bars(
        self, instrument: Instrument, adjustment: Adjustment, limit: int
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]: ...

    async def minute_bars(
        self, instrument: Instrument, timeframe: Timeframe, limit: int
    ) -> tuple[list[BarPayload], str | None, dict[str, Any]]: ...

    def quote_from_node(
        self, instrument: Instrument, node: dict[str, Any], name: str | None
    ) -> QuoteResponse | None: ...

    async def close(self) -> None: ...
