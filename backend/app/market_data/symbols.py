import re
from dataclasses import dataclass
from typing import Literal


Market = Literal["CN", "HK"]
Exchange = Literal["SZSE", "SSE", "BSE", "HKEX"]


@dataclass(frozen=True)
class Instrument:
    symbol: str
    market: Market
    exchange: Exchange
    provider_symbol: str
    currency: Literal["CNY", "HKD"]

    @property
    def key(self) -> str:
        return f"{self.exchange}:{self.symbol}"


class SymbolError(ValueError):
    pass


def _cn_instrument(code: str, prefix: str | None = None) -> Instrument:
    if len(code) != 6 or not code.isdigit():
        raise SymbolError("A-share codes must contain six digits")

    inferred = prefix
    if inferred is None:
        # 92xxxx is Beijing Stock Exchange. Check it before the SSE "9" prefix
        # (900xxx B-shares), otherwise 北交所 codes are silently sent to Shanghai.
        if code.startswith(("4", "8")) or code.startswith("92"):
            inferred = "bj"
        elif code.startswith(("5", "6", "9")):
            inferred = "sh"
        else:
            inferred = "sz"

    exchange_map: dict[str, Exchange] = {"sh": "SSE", "sz": "SZSE", "bj": "BSE"}
    if inferred not in exchange_map:
        raise SymbolError(f"Unsupported mainland exchange: {inferred}")
    return Instrument(
        symbol=code,
        market="CN",
        exchange=exchange_map[inferred],
        provider_symbol=f"{inferred}{code}",
        currency="CNY",
    )


def _hk_instrument(code: str) -> Instrument:
    if not code.isdigit() or not 1 <= len(code) <= 5:
        raise SymbolError("Hong Kong stock codes must contain one to five digits")
    normalized = code.zfill(5)
    return Instrument(
        symbol=normalized,
        market="HK",
        exchange="HKEX",
        provider_symbol=f"hk{normalized}",
        currency="HKD",
    )


def normalize_symbol(raw: str) -> Instrument:
    value = re.sub(r"\s+", "", raw).lower()
    if not value:
        raise SymbolError("A stock code is required")

    suffix = re.fullmatch(r"(\d{1,6})\.(sh|sz|bj|hk)", value)
    if suffix:
        code, exchange = suffix.groups()
        return _hk_instrument(code) if exchange == "hk" else _cn_instrument(code, exchange)

    prefix = re.fullmatch(r"(sh|sz|bj|hk)[:.]?(\d{1,6})", value)
    if prefix:
        exchange, code = prefix.groups()
        return _hk_instrument(code) if exchange == "hk" else _cn_instrument(code, exchange)

    if value.isdigit():
        return _cn_instrument(value) if len(value) == 6 else _hk_instrument(value)

    raise SymbolError(f"Unsupported stock code: {raw}")
