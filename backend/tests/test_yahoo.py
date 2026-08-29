from backend.app.market_data.symbols import normalize_symbol
from backend.app.market_data.yahoo import YahooProvider


def sample_node() -> dict:
    return {
        "meta": {
            "dataGranularity": "1d",
            "exchangeTimezoneName": "Asia/Shanghai",
            "longName": "备用源样例",
        },
        "timestamp": [1_786_066_200, 1_786_325_400],
        "indicators": {
            "quote": [{
                "open": [10.0, 11.0], "high": [12.0, 13.0], "low": [9.0, 10.0],
                "close": [11.0, 12.0], "volume": [100, 120],
            }],
            "adjclose": [{"adjclose": [5.5, 12.0]}],
        },
    }


def test_yahoo_symbol_mapping_covers_a_and_h_markets() -> None:
    assert YahooProvider._symbol(normalize_symbol("001280")) == "001280.SZ"
    assert YahooProvider._symbol(normalize_symbol("600000")) == "600000.SS"
    assert YahooProvider._symbol(normalize_symbol("00700.HK")) == "0700.HK"
    assert YahooProvider._symbol(normalize_symbol("920000")) == "920000.BJ"


def test_yahoo_parser_applies_qfq_and_hfq_factors() -> None:
    qfq = YahooProvider._bars(sample_node(), "qfq", 10)
    hfq = YahooProvider._bars(sample_node(), "hfq", 10)
    assert qfq[0].close == 5.5
    assert qfq[1].close == 12.0
    assert hfq[0].close == 11.0
    assert hfq[1].close == 24.0
    assert qfq[0].amount is None
