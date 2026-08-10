from ..market_data.models import BarPayload
from .metrics import calculate_metrics
from .models import BacktestRequest, BacktestResult, BacktestTrade, EquityPoint
from .strategies import target_positions


def _commission(amount: float, request: BacktestRequest) -> float:
    return max(request.minimum_commission, amount * request.commission_rate)


def _can_execute(bar: BarPayload, previous: BarPayload, side: str, market: str) -> bool:
    if bar.volume <= 0:
        return False
    if market != "CN":
        return True
    limit = 0.10
    if side == "buy" and bar.open >= previous.close * (1 + limit) - 1e-8:
        return False
    if side == "sell" and bar.open <= previous.close * (1 - limit) + 1e-8:
        return False
    return True


def run_backtest(
    request: BacktestRequest,
    bars: list[BarPayload],
    market: str,
    data_source: str,
    data_fetched_at: str,
) -> BacktestResult:
    selected = [
        bar for bar in sorted(bars, key=lambda item: item.time)
        if (request.start_date is None or bar.time[:10] >= request.start_date)
        and (request.end_date is None or bar.time[:10] <= request.end_date)
    ]
    if len(selected) < 3:
        raise ValueError("Backtest requires at least three daily bars")
    targets, normalized_parameters = target_positions(selected, request.strategy, request.parameters)
    lot_size = request.lot_size or (100 if market == "CN" else 1)
    cash = request.initial_cash
    position = 0
    entry_total = 0.0
    trades: list[BacktestTrade] = []
    curve: list[EquityPoint] = []
    warnings: list[str] = []
    benchmark_shares = request.initial_cash / selected[0].close

    for index, bar in enumerate(selected):
        if index > 0:
            desired = targets[index - 1]
            previous = selected[index - 1]
            if desired and position == 0:
                if _can_execute(bar, previous, "buy", market):
                    price = bar.open * (1 + request.slippage_bps / 10_000)
                    quantity = int(cash / (price * (1 + request.commission_rate)) / lot_size) * lot_size
                    while quantity > 0:
                        gross = price * quantity
                        fees = _commission(gross, request)
                        if gross + fees <= cash:
                            break
                        quantity -= lot_size
                    if quantity > 0:
                        gross = price * quantity
                        fees = _commission(gross, request)
                        cash -= gross + fees
                        position = quantity
                        entry_total = gross + fees
                        trades.append(BacktestTrade(
                            date=bar.time[:10], side="buy", price=price, quantity=quantity,
                            gross_amount=gross, fees=fees, cash_after=cash, position_after=position,
                            reason=f"{request.strategy}前一交易日收盘信号",
                        ))
                else:
                    warnings.append(f"{bar.time[:10]}买入信号因停牌或涨停未成交")
            elif not desired and position > 0:
                if _can_execute(bar, previous, "sell", market):
                    price = bar.open * (1 - request.slippage_bps / 10_000)
                    gross = price * position
                    fees = _commission(gross, request) + gross * request.stamp_tax_rate
                    realized = gross - fees - entry_total
                    cash += gross - fees
                    trades.append(BacktestTrade(
                        date=bar.time[:10], side="sell", price=price, quantity=position,
                        gross_amount=gross, fees=fees, cash_after=cash, position_after=0,
                        reason=f"{request.strategy}前一交易日收盘信号", realized_pnl=realized,
                    ))
                    position = 0
                    entry_total = 0.0
                else:
                    warnings.append(f"{bar.time[:10]}卖出信号因停牌或跌停未成交")

        equity = cash + position * bar.close
        curve.append(EquityPoint(
            date=bar.time[:10], equity=equity, cash=cash, position=position,
            close=bar.close, benchmark=benchmark_shares * bar.close,
        ))

    metrics = calculate_metrics(request.initial_cash, curve, trades)
    return BacktestResult(
        symbol=request.symbol,
        market="CN" if market == "CN" else "HK",
        strategy=request.strategy,
        parameters=normalized_parameters,
        start_date=selected[0].time[:10],
        end_date=selected[-1].time[:10],
        execution_model="收盘生成信号，下一交易日开盘成交；A股T+1、整手、停牌与10%涨跌停约束",
        data_source=data_source,
        data_fetched_at=data_fetched_at,
        metrics=metrics,
        equity_curve=curve,
        trades=trades,
        warnings=list(dict.fromkeys(warnings)),
    )
