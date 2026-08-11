from backend.app.backtest import BacktestRequest, run_backtest
from backend.app.backtest.strategies import target_positions
from backend.app.market_data.models import BarPayload


def bars(closes: list[float]) -> list[BarPayload]:
    return [
        BarPayload(
            time=f"2026-01-{index + 1:02d}", open=close, high=close * 1.02,
            low=close * 0.98, close=close, volume=10_000,
        )
        for index, close in enumerate(closes)
    ]


def request(**overrides) -> BacktestRequest:
    return BacktestRequest(
        symbol="SZSE:001280", strategy="ma_cross", parameters={"fast": 1, "slow": 2},
        initial_cash=10_000, commission_rate=0.0003, minimum_commission=5,
        stamp_tax_rate=0.0005, slippage_bps=0, lot_size=100, **overrides,
    )


def test_signal_is_executed_at_next_open_without_future_data() -> None:
    source = bars([10, 10, 12, 12, 8, 8])
    result = run_backtest(request(), source, "CN", "fixture", "2026-01-06T15:00:00+08:00")
    assert result.trades[0].side == "buy"
    assert result.trades[0].date == "2026-01-04"
    assert result.trades[0].quantity % 100 == 0
    assert result.trades[1].side == "sell"
    assert result.trades[1].date == "2026-01-06"
    assert result.metrics.trade_count == 2


def test_fees_are_deducted_and_equity_curve_is_reproducible() -> None:
    result = run_backtest(request(), bars([10, 10, 12, 12, 8, 8]), "CN", "fixture", "2026-01-06")
    buy, sell = result.trades
    assert buy.fees == 5
    assert sell.fees > 5
    assert result.metrics.ending_equity == result.equity_curve[-1].equity
    assert result.metrics.total_return < 0


def test_breakout_and_macd_templates_return_normalized_parameters() -> None:
    source = bars([10, 10.2, 10.4, 11, 12, 11.5, 13, 12])
    breakout, breakout_parameters = target_positions(source, "breakout", {"entry_lookback": 3, "exit_lookback": 2})
    macd, macd_parameters = target_positions(source, "macd", {"fast": 2, "slow": 4, "signal": 2})
    assert len(breakout) == len(source)
    assert len(macd) == len(source)
    assert breakout_parameters == {"entry_lookback": 3, "exit_lookback": 2}
    assert macd_parameters == {"fast": 2, "slow": 4, "signal": 2}


def test_a_share_limit_up_blocks_the_next_open_buy() -> None:
    source = bars([10, 10, 12, 13.2])
    result = run_backtest(request(), source, "CN", "fixture", "2026-01-04")
    assert not result.trades
    assert any("涨停" in warning for warning in result.warnings)
