import math

from .models import BacktestMetrics, BacktestTrade, EquityPoint


def calculate_metrics(initial_cash: float, curve: list[EquityPoint], trades: list[BacktestTrade]) -> BacktestMetrics:
    ending = curve[-1].equity
    total_return = ending / initial_cash - 1
    sessions = max(1, len(curve) - 1)
    annualized = (ending / initial_cash) ** (252 / sessions) - 1 if ending > 0 else -1
    benchmark_return = curve[-1].benchmark / initial_cash - 1

    peak = curve[0].equity
    max_drawdown = 0.0
    returns: list[float] = []
    for previous, current in zip(curve, curve[1:]):
        peak = max(peak, current.equity)
        if peak > 0:
            max_drawdown = min(max_drawdown, current.equity / peak - 1)
        if previous.equity > 0:
            returns.append(current.equity / previous.equity - 1)
    if len(returns) > 1:
        mean = sum(returns) / len(returns)
        variance = sum((value - mean) ** 2 for value in returns) / (len(returns) - 1)
        sharpe = mean / math.sqrt(variance) * math.sqrt(252) if variance > 0 else 0.0
    else:
        sharpe = 0.0

    realized = [trade.realized_pnl for trade in trades if trade.side == "sell" and trade.realized_pnl is not None]
    wins = [value for value in realized if value > 0]
    losses = [value for value in realized if value < 0]
    profit_factor = sum(wins) / abs(sum(losses)) if losses else None
    return BacktestMetrics(
        total_return=total_return,
        annualized_return=annualized,
        benchmark_return=benchmark_return,
        max_drawdown=max_drawdown,
        sharpe_ratio=sharpe,
        trade_count=len(trades),
        win_rate=len(wins) / len(realized) if realized else 0,
        profit_factor=profit_factor,
        ending_equity=ending,
    )
