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
