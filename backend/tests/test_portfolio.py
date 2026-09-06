from pathlib import Path

import pytest

from backend.app.portfolio import PaperPortfolioRepository, PaperTradeInput


def trade(side: str, quantity: int = 100, price: float = 10) -> PaperTradeInput:
    return PaperTradeInput(symbol="001280", name="测试股票", market="CN", side=side, price=price, quantity=quantity)


def test_buy_and_sell_persist_cash_position_and_realized_pnl(tmp_path: Path) -> None:
    repository = PaperPortfolioRepository(tmp_path)
    repository.initialize()
    bought = repository.create_trade(trade("buy"))
    assert bought["cash"] == 98_995
    assert bought["positions"][0]["quantity"] == 100
    assert bought["positions"][0]["average_cost"] == 10.05

    sold = repository.create_trade(trade("sell", 50, 12))
    assert sold["positions"][0]["quantity"] == 50
    assert sold["realized_pnl"] == pytest.approx(92.2)
    assert len(PaperPortfolioRepository(tmp_path).snapshot()["trades"]) == 2


def test_rejects_overselling_and_insufficient_cash(tmp_path: Path) -> None:
    repository = PaperPortfolioRepository(tmp_path)
    repository.initialize()
    with pytest.raises(ValueError, match="持仓数量不足"):
        repository.create_trade(trade("sell"))
    with pytest.raises(ValueError, match="可用资金不足"):
        repository.create_trade(trade("buy", quantity=20_000, price=10))


def test_deleting_trade_preserves_a_valid_ledger(tmp_path: Path) -> None:
    repository = PaperPortfolioRepository(tmp_path)
    repository.initialize()
    repository.create_trade(trade("buy"))
    snapshot = repository.create_trade(trade("sell", 50, 12))
    sell_id = snapshot["trades"][0]["id"]
    result = repository.delete_trade(sell_id)
    assert result["positions"][0]["quantity"] == 100
    with pytest.raises(KeyError):
        repository.delete_trade(sell_id)


def test_backdated_sell_that_breaks_history_does_not_persist(tmp_path: Path) -> None:
    repository = PaperPortfolioRepository(tmp_path)
    repository.initialize()
    repository.create_trade(PaperTradeInput(
        symbol="001280", name="测试股票", market="CN", side="buy", price=10, quantity=100,
        traded_at="2026-09-04T10:00:00+00:00",
    ))
    with pytest.raises(ValueError, match="持仓数量不足"):
        repository.create_trade(PaperTradeInput(
            symbol="001280", name="测试股票", market="CN", side="sell", price=10, quantity=100,
            traded_at="2026-09-03T10:00:00+00:00",
        ))
    snapshot = repository.snapshot()
    assert len(snapshot["trades"]) == 1
    assert snapshot["positions"][0]["quantity"] == 100
    assert snapshot["cash"] == 98_995


def test_etf_sell_skips_stamp_tax_but_stock_sell_keeps_it(tmp_path: Path) -> None:
    repository = PaperPortfolioRepository(tmp_path)
    repository.initialize()
    repository.create_trade(PaperTradeInput(
        symbol="562310", name="成长ETF", market="CN", side="buy", price=1, quantity=10_000, fees=5,
    ))
    sold = repository.create_trade(PaperTradeInput(
        symbol="562310", name="成长ETF", market="CN", side="sell", price=1, quantity=10_000,
    ))
    # commission max(5, 10000*0.0003)=5; no stamp tax for ETF
    assert sold["trades"][0]["fees"] == 5
    assert sold["cash"] == 99_990

    stock_repo = PaperPortfolioRepository(tmp_path / "stock")
    stock_repo.initialize()
    stock_repo.create_trade(PaperTradeInput(
        symbol="001280", name="测试股票", market="CN", side="buy", price=1, quantity=10_000, fees=5,
    ))
    stock_sold = stock_repo.create_trade(PaperTradeInput(
        symbol="001280", name="测试股票", market="CN", side="sell", price=1, quantity=10_000,
    ))
    # commission 5 + stamp 5 = 10
    assert stock_sold["trades"][0]["fees"] == 10
