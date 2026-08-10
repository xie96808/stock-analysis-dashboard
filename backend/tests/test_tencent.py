from backend.app.market_data.tencent import TencentProvider


def test_reads_positive_circulating_shares_from_quote_payload() -> None:
    quote = [""] * 73
    quote[72] = "6796827627"
    payload = {"qt": {"sz002602": quote}}
    assert TencentProvider._circulating_shares(payload, "sz002602") == 6_796_827_627


def test_ignores_missing_or_invalid_circulating_shares() -> None:
    assert TencentProvider._circulating_shares({}, "sz002602") is None
    quote = [""] * 73
    quote[72] = "0"
    assert TencentProvider._circulating_shares({"qt": {"sz002602": quote}}, "sz002602") is None
