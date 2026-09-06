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


def test_volume_multiplier_keeps_star_board_in_shares() -> None:
    assert TencentProvider._volume_multiplier(normalize_symbol("600519")) == 100
    assert TencentProvider._volume_multiplier(normalize_symbol("000333")) == 100
    assert TencentProvider._volume_multiplier(normalize_symbol("300719")) == 100
    assert TencentProvider._volume_multiplier(normalize_symbol("159180")) == 100
    assert TencentProvider._volume_multiplier(normalize_symbol("920344")) == 100
    assert TencentProvider._volume_multiplier(normalize_symbol("688450")) == 1
    assert TencentProvider._volume_multiplier(normalize_symbol("689009")) == 1
    assert TencentProvider._volume_multiplier(normalize_symbol("hk01888")) == 1


def _quote_fields(volume: str, high: str, low: str, circ: str, last: str = "1", prev: str = "1", open_: str = "1") -> list[str]:
    quote = [""] * 73
    quote[3] = last
    quote[4] = prev
    quote[5] = open_
    quote[6] = volume
    quote[30] = "2026-09-04 15:00:00"
    quote[33] = high
    quote[34] = low
    quote[72] = circ
    return quote


def test_daily_and_quote_volume_convert_lots_but_not_star_shares() -> None:
    payload = {
        "code": 0,
        "data": {
            "sz300719": {
                "day": [["2026-09-04", "12.5", "12.64", "12.9", "12.4", "47333"]],
                "qt": {"sz300719": _quote_fields("47333", "12.9", "12.4", "179620132", "12.64", "12.5", "12.5")},
            },
            "sh688450": {
                "day": [["2026-09-04", "32", "32.7", "34", "31", "1376490"]],
                "qt": {"sh688450": _quote_fields("1376490", "34", "31", "48930672", "32.7", "32", "32")},
            },
        },
    }

    class FakeResponse:
        def __init__(self, body):
            self._body = body

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return self._body

    class FakeClient:
        async def get(self, url: str, params: dict[str, str]) -> FakeResponse:
            symbol = params["param"].split(",")[0]
            return FakeResponse({"code": 0, "data": {symbol: payload["data"][symbol]}})

    provider = TencentProvider(client=FakeClient())  # type: ignore[arg-type]
    chi_next, _, chi_node = asyncio.run(provider.daily_bars(normalize_symbol("300719"), "none", 20))
    star, _, star_node = asyncio.run(provider.daily_bars(normalize_symbol("688450"), "none", 20))

    assert chi_next[0].volume == 4_733_300
    assert abs((chi_next[0].turnover_rate or 0) - 4_733_300 / 179_620_132) < 1e-12
    assert star[0].volume == 1_376_490
    assert abs((star[0].turnover_rate or 0) - 1_376_490 / 48_930_672) < 1e-12

    chi_quote = provider.quote_from_node(normalize_symbol("300719"), chi_node, "安达维尔")
    star_quote = provider.quote_from_node(normalize_symbol("688450"), star_node, "光格科技")
    assert chi_quote is not None and chi_quote.volume == 4_733_300
    assert star_quote is not None and star_quote.volume == 1_376_490


def test_cn_minute_bars_leave_amount_unset() -> None:
    payload = {
        "code": 0,
        "data": {"sz300719": {
            "m60": [
                ["202609041400", "12.76", "12.71", "12.88", "12.66", "11503.00", {}, "64.04"],
                ["202609041500", "12.71", "12.64", "12.74", "12.58", "9846.00", {}, "54.81"],
            ],
            "qt": {"sz300719": ["", "安达维尔"]},
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
    bars, name, _ = asyncio.run(provider.minute_bars(normalize_symbol("300719"), "60m", 20))
    assert name == "安达维尔"
    assert [bar.volume for bar in bars] == [1_150_300, 984_600]
    assert [bar.amount for bar in bars] == [None, None]


def test_star_minute_volume_is_not_multiplied() -> None:
    payload = {
        "code": 0,
        "data": {"sh688450": {
            "m60": [
                ["202609041500", "33.02", "32.70", "33.24", "32.59", "512125.00", {}, "104.66"],
            ],
            "qt": {"sh688450": ["", "光格科技"]},
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
    bars, _, _ = asyncio.run(provider.minute_bars(normalize_symbol("688450"), "60m", 20))
    assert bars[0].volume == 512_125
    assert bars[0].amount is None
