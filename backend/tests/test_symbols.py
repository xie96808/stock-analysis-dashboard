import pytest

from backend.app.market_data.symbols import SymbolError, normalize_symbol


@pytest.mark.parametrize(
    ("raw", "key", "provider"),
    [
        ("001280", "SZSE:001280", "sz001280"),
        ("600000.SH", "SSE:600000", "sh600000"),
        ("sz000001", "SZSE:000001", "sz000001"),
        ("00700.HK", "HKEX:00700", "hk00700"),
        ("700", "HKEX:00700", "hk00700"),
        ("bj430047", "BSE:430047", "bj430047"),
    ],
)
def test_normalize_symbol(raw: str, key: str, provider: str) -> None:
    result = normalize_symbol(raw)
    assert result.key == key
    assert result.provider_symbol == provider


def test_rejects_unknown_symbol() -> None:
    with pytest.raises(SymbolError):
        normalize_symbol("not-a-stock")
