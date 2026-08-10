from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str
    phase: Literal["P7"] = "P7"
    version: str
    timestamp: datetime


class DemoInstrument(BaseModel):
    symbol: str = "001280"
    market: Literal["SZSE"] = "SZSE"
    name: str = "中国铀业"
    currency: Literal["CNY"] = "CNY"
    adjustment: Literal["qfq"] = "qfq"
    data_as_of: str = "2026-08-07"
    source: Literal["deterministic-fixture"] = "deterministic-fixture"
    supported_timeframes: list[str] = Field(
        default_factory=lambda: ["1m", "5m", "15m", "30m", "60m", "1d", "1w", "1M"]
    )


class DemoSnapshotResponse(BaseModel):
    instrument: DemoInstrument
    realtime: bool = False
    note: str = "Deterministic offline fallback; real A/H market data is exposed by the P2 market routes."
