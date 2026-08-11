import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

from pydantic import BaseModel, Field


class PaperTradeInput(BaseModel):
    symbol: str = Field(min_length=1, max_length=24)
    name: str = Field(min_length=1, max_length=100)
    market: Literal["CN", "HK"]
    side: Literal["buy", "sell"]
    price: float = Field(gt=0)
    quantity: int = Field(gt=0)
    fees: float | None = Field(default=None, ge=0)
    traded_at: str | None = None
    note: str = Field(default="", max_length=500)
    journal_record_id: str | None = None


class PaperPortfolioRepository:
    initial_cash = 100_000.0

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.database_path = data_dir / "dashboard.sqlite3"

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS paper_trades (
                    id TEXT PRIMARY KEY,
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    market TEXT NOT NULL,
                    side TEXT NOT NULL,
                    price REAL NOT NULL,
                    quantity INTEGER NOT NULL,
                    fees REAL NOT NULL,
                    traded_at TEXT NOT NULL,
                    note TEXT NOT NULL,
                    journal_record_id TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_paper_trades_time ON paper_trades(traded_at, id);
                """
            )

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    @staticmethod
    def _automatic_fees(payload: PaperTradeInput) -> float:
        gross = payload.price * payload.quantity
        commission = max(5.0, gross * 0.0003)
        stamp_tax = gross * 0.0005 if payload.market == "CN" and payload.side == "sell" else 0.0
        return round(commission + stamp_tax, 2)

    def _rows(self, connection: sqlite3.Connection | None = None) -> list[sqlite3.Row]:
        if connection is not None:
            return connection.execute("SELECT * FROM paper_trades ORDER BY traded_at, id").fetchall()
        with self.connect() as own:
            return own.execute("SELECT * FROM paper_trades ORDER BY traded_at, id").fetchall()

    def _calculate(self, rows: list[sqlite3.Row]) -> dict[str, Any]:
        cash = self.initial_cash
        realized_pnl = 0.0
        positions: dict[str, dict[str, Any]] = {}
        trades: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            gross = float(row["price"]) * int(row["quantity"])
            fees = float(row["fees"])
            position = positions.setdefault(row["symbol"], {
                "symbol": row["symbol"], "name": row["name"], "market": row["market"],
                "quantity": 0, "cost_value": 0.0,
            })
            trade_realized = None
            if row["side"] == "buy":
                debit = gross + fees
                if debit > cash + 1e-6:
                    raise ValueError("模拟账户可用资金不足")
                cash -= debit
                position["quantity"] += int(row["quantity"])
                position["cost_value"] += debit
            else:
                if int(row["quantity"]) > position["quantity"]:
                    raise ValueError(f"{row['symbol']}模拟持仓数量不足")
                average_cost = position["cost_value"] / position["quantity"]
                trade_realized = gross - fees - average_cost * int(row["quantity"])
                realized_pnl += trade_realized
                cash += gross - fees
                position["quantity"] -= int(row["quantity"])
                position["cost_value"] -= average_cost * int(row["quantity"])
            item["gross_amount"] = round(gross, 2)
            item["realized_pnl"] = round(trade_realized, 2) if trade_realized is not None else None
            item["cash_after"] = round(cash, 2)
            trades.append(item)

        active_positions = []
        for position in positions.values():
            if position["quantity"] <= 0:
                continue
            position["cost_value"] = round(position["cost_value"], 2)
            position["average_cost"] = round(position["cost_value"] / position["quantity"], 4)
            active_positions.append(position)
        return {
            "initial_cash": self.initial_cash,
            "cash": round(cash, 2),
            "position_cost": round(sum(item["cost_value"] for item in active_positions), 2),
            "realized_pnl": round(realized_pnl, 2),
            "positions": sorted(active_positions, key=lambda item: item["symbol"]),
            "trades": list(reversed(trades)),
        }

    def snapshot(self) -> dict[str, Any]:
        return self._calculate(self._rows())

    def create_trade(self, payload: PaperTradeInput) -> dict[str, Any]:
        fees = payload.fees if payload.fees is not None else self._automatic_fees(payload)
        traded_at = payload.traded_at or self._now()
        trade_id = str(uuid.uuid4())
        with self.connect() as connection:
            current = self._calculate(self._rows(connection))
            position = next((item for item in current["positions"] if item["symbol"] == payload.symbol), None)
            if payload.side == "buy" and payload.price * payload.quantity + fees > current["cash"] + 1e-6:
                raise ValueError("模拟账户可用资金不足")
            if payload.side == "sell" and (position is None or payload.quantity > position["quantity"]):
                raise ValueError(f"{payload.symbol}模拟持仓数量不足")
            connection.execute(
                """INSERT INTO paper_trades
                (id, symbol, name, market, side, price, quantity, fees, traded_at, note, journal_record_id)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (trade_id, payload.symbol, payload.name, payload.market, payload.side, payload.price,
                 payload.quantity, fees, traded_at, payload.note, payload.journal_record_id),
            )
        return self.snapshot()

    def delete_trade(self, trade_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM paper_trades WHERE id = ?", (trade_id,)).fetchone()
            if row is None:
                raise KeyError(trade_id)
            remaining = connection.execute("SELECT * FROM paper_trades WHERE id != ? ORDER BY traded_at, id", (trade_id,)).fetchall()
            self._calculate(remaining)
            connection.execute("DELETE FROM paper_trades WHERE id = ?", (trade_id,))
        return self.snapshot()
