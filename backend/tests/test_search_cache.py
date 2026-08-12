import asyncio
from pathlib import Path
from unittest.mock import AsyncMock

from backend.app.market_data.models import InstrumentSearchResult
from backend.app.market_data.service import MarketDataService


def test_search_service_reuses_short_lived_results(tmp_path: Path) -> None:
    provider = AsyncMock()
    provider.name = "test-search"
    provider.search_instruments.return_value = [InstrumentSearchResult(
        input="sh600988", symbol="600988", name="赤峰黄金", market="CN",
        exchange="SSE", provider_symbol="sh600988", asset_type="stock",
    )]
    service = MarketDataService(tmp_path, providers=[provider])

    first = asyncio.run(service.search_instruments("赤峰黄金", 5))
    second = asyncio.run(service.search_instruments("赤峰黄金", 1))

    assert first == second
    provider.search_instruments.assert_awaited_once_with("赤峰黄金", 10)
