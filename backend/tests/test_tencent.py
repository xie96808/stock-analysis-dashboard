import asyncio

from backend.app.market_data.symbols import normalize_symbol
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


def test_hk_minute_parser_resets_cumulative_values_for_each_session() -> None:
    bars = TencentProvider._parse_hk_minute_sessions({
        "data": [
            {"date": "20260827", "data": [
                "0930 44.000 100 4400.000",
                "0931 45.000 160 7100.000",
            ]},
            {"date": "20260828", "data": [
                "0930 46.000 80 3680.000",
                "0931 45.500 130 5955.000",
            ]},
        ],
    })

    assert [bar.time for bar in bars] == [
        "2026-08-27 09:30", "2026-08-27 09:31",
        "2026-08-28 09:30", "2026-08-28 09:31",
    ]
    assert [bar.volume for bar in bars] == [100, 60, 80, 50]
    assert [bar.amount for bar in bars] == [4400, 2700, 3680, 2275]


def test_hk_minute_request_uses_multi_day_route_and_keeps_sessions() -> None:
    payload = {
        "code": 0,
        "data": {"hk01888": {"data": [
            {"date": "20260827", "data": [
                "0930 44.000 100 4400.000",
                "1300 45.000 160 7100.000",
            ]},
            {"date": "20260828", "data": [
                "0930 46.000 80 3680.000",
                "1300 45.500 130 5955.000",
            ]},
        ]}},
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return payload

    class FakeClient:
        url = ""
        params: dict[str, str] = {}

        async def get(self, url: str, params: dict[str, str]) -> FakeResponse:
            self.url = url
            self.params = params
            return FakeResponse()

    client = FakeClient()
    provider = TencentProvider(client=client)  # type: ignore[arg-type]
    bars, _, _ = asyncio.run(provider.minute_bars(normalize_symbol("hk01888"), "60m", 640))

    assert client.url == TencentProvider.multi_day_minute_url
    assert client.params == {"code": "hk01888"}
    assert [bar.time for bar in bars] == [
        "2026-08-27 09:30", "2026-08-27 13:00",
        "2026-08-28 09:30", "2026-08-28 13:00",
    ]

def test_daily_bars_do_not_silently_relabel_unadjusted_as_qfq() -> None:
    payload = {
        "code": 0,
        "data": {"sz001280": {
            "day": [["2026-08-28", "10", "11", "12", "9", "100"]],
            "qt": {"sz001280": ["", "测试标的"]},
        }},
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return payload

    class FakeClient:
        async def get(self, url: str, params: dict[str, str]) -> FakeResponse:
            return FakeResponse()

    provider = TencentProvider(client=FakeClient())  # type: ignore[arg-type]
    bars, name, node = asyncio.run(provider.daily_bars(normalize_symbol("001280"), "qfq", 20))
    assert name == "测试标的"
    assert bars[0].close == 11
    assert node["_bar_series"] == "day"


def test_daily_bars_use_the_requested_adjustment_series() -> None:
    payload = {
        "code": 0,
        "data": {"sz001280": {
            "day": [["2026-08-28", "10", "11", "12", "9", "100"]],
            "qfqday": [["2026-08-28", "5", "5.5", "6", "4.5", "100"]],
            "qt": {"sz001280": ["", "测试标的"]},
        }},
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return payload

    class FakeClient:
        async def get(self, url: str, params: dict[str, str]) -> FakeResponse:
            return FakeResponse()

    provider = TencentProvider(client=FakeClient())  # type: ignore[arg-type]
    bars, name, _ = asyncio.run(provider.daily_bars(normalize_symbol("001280"), "qfq", 20))
    assert name == "测试标的"
    assert bars[0].close == 5.5
    assert bars[0].open == 5.0


def test_daily_bars_hk_falls_back_to_unadjusted_when_qfqday_missing() -> None:
    payload = {
        "code": 0,
        "data": {"hk00311": {
            "day": [["2026-08-28", "10", "11", "12", "9", "100"]],
            "qt": {"hk00311": ["", "仁山智库"]},
        }},
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return payload

    class FakeClient:
        async def get(self, url: str, params: dict[str, str]) -> FakeResponse:
            return FakeResponse()

    provider = TencentProvider(client=FakeClient())  # type: ignore[arg-type]
    bars, name, node = asyncio.run(provider.daily_bars(normalize_symbol("hk00311"), "qfq", 20))
    assert name == "仁山智库"
    assert bars[0].close == 11
    assert node["_bar_series"] == "day"


def test_daily_bars_etf_falls_back_to_unadjusted_when_qfqday_missing() -> None:
    payload = {
        "code": 0,
        "data": {"sh513750": {
            "day": [["2026-08-28", "1.5", "1.55", "1.6", "1.4", "100"]],
            "qt": {"sh513750": ["", "港股通非银ETF广发"]},
        }},
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return payload

    class FakeClient:
        async def get(self, url: str, params: dict[str, str]) -> FakeResponse:
            return FakeResponse()

    provider = TencentProvider(client=FakeClient())  # type: ignore[arg-type]
    bars, name, node = asyncio.run(provider.daily_bars(normalize_symbol("513750"), "qfq", 20))
    assert name == "港股通非银ETF广发"
    assert bars[0].close == 1.55
    assert node["_bar_series"] == "day"
