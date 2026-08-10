from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


Timeframe = Literal["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1M"]
Adjustment = Literal["none", "qfq", "hfq"]


class InstrumentPayload(BaseModel):
    symbol: str
    key: str
    market: Literal["CN", "HK"]
    exchange: Literal["SZSE", "SSE", "BSE", "HKEX"]
    provider_symbol: str
    currency: Literal["CNY", "HKD"]
    name: str | None = None


class BarPayload(BaseModel):
    time: str
    open: float
    high: float
    low: float
    close: float
    volume: float = Field(ge=0)
    amount: float | None = None
    # Decimal fraction of the circulating shares traded during this bar.
    # Example: 0.023 means 2.3%.  Daily A-share bars derive this from the
    # provider's circulating-share figure when a historical rate is absent.
    turnover_rate: float | None = Field(default=None, ge=0)


class BarsResponse(BaseModel):
    instrument: InstrumentPayload
    timeframe: Timeframe
    adjustment: Adjustment
    adjustment_applied: Adjustment
    source: str
    fetched_at: datetime
    cached: bool
    delayed: bool
    requested_limit: int = 0
    bars: list[BarPayload]


class QuoteResponse(BaseModel):
    instrument: InstrumentPayload
    last: float
    previous_close: float | None = None
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None
    timestamp: str | None = None
    source: str
    delayed: bool
