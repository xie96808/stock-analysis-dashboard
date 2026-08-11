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


def test_search_parser_prioritizes_supported_code_prefixes() -> None:
    payload = 'v_hint="jj~005160~基金~jj~KJ^sh~516020~化工ETF~hg~ETF^sh~516010~游戏ETF~yx~ETF^sh~516080~创新药ETF易方达~cxy~ETF^sh~516090~新能源ETF~xny~ETF^sh~516000~大数据ETF~dsj~ETF^sh~516070~低碳ETF~dt~ETF"'
    results = TencentProvider._parse_search_payload(payload, "5160", 5)
    assert [item.symbol for item in results] == ["516020", "516010", "516080", "516090", "516000"]
    assert all(item.asset_type == "etf" for item in results)


def test_search_parser_supports_chinese_stock_names() -> None:
    payload = 'v_hint="sh~600988~\\u8d64\\u5cf0\\u9ec4\\u91d1~cfhj~GP-A^hk~06693~\\u8d64\\u5cf0\\u9ec4\\u91d1~cfhj~GP"'
    results = TencentProvider._parse_search_payload(payload, "赤峰黄金", 5)
    assert [(item.input, item.name) for item in results] == [
        ("sh600988", "赤峰黄金"),
        ("hk06693", "赤峰黄金"),
    ]
