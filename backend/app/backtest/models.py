from typing import Literal

from pydantic import BaseModel, Field, model_validator


StrategyType = Literal["ma_cross", "breakout", "macd"]


class BacktestRequest(BaseModel):
    symbol: str
    start_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    strategy: StrategyType = "ma_cross"
    parameters: dict[str, int | float] = Field(default_factory=dict)
    initial_cash: float = Field(default=100_000, gt=0, le=1_000_000_000)
    commission_rate: float = Field(default=0.0003, ge=0, le=0.02)
    minimum_commission: float = Field(default=5, ge=0, le=1_000)
    stamp_tax_rate: float = Field(default=0.0005, ge=0, le=0.02)
    slippage_bps: float = Field(default=2, ge=0, le=500)
    lot_size: int | None = Field(default=None, ge=1, le=100_000)

    @model_validator(mode="after")
    def valid_dates(self):
        if self.start_date and self.end_date and self.start_date > self.end_date:
            raise ValueError("start_date must not be after end_date")
        return self


class BacktestTrade(BaseModel):
    date: str
    side: Literal["buy", "sell"]
    price: float
    quantity: int
    gross_amount: float
    fees: float
    cash_after: float
    position_after: int
    reason: str
    realized_pnl: float | None = None


class EquityPoint(BaseModel):
    date: str
    equity: float
    cash: float
    position: int
    close: float
    benchmark: float


class BacktestMetrics(BaseModel):
    total_return: float
    annualized_return: float
    benchmark_return: float
    max_drawdown: float
    sharpe_ratio: float
    trade_count: int
    win_rate: float
    profit_factor: float | None
    ending_equity: float


class BacktestResult(BaseModel):
    symbol: str
    market: Literal["CN", "HK"]
    strategy: StrategyType
    parameters: dict[str, int | float]
    start_date: str
    end_date: str
    execution_model: str
    data_source: str
    data_fetched_at: str
    metrics: BacktestMetrics
    equity_curve: list[EquityPoint]
    trades: list[BacktestTrade]
    warnings: list[str] = Field(default_factory=list)
