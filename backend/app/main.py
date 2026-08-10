from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
import zipfile
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .config import settings
from .market_data import MarketDataService
from .market_data.models import Adjustment, BarsResponse, InstrumentPayload, QuoteResponse, Timeframe
from .market_data.symbols import SymbolError
from .market_data.tencent import ProviderError
from .schemas import DemoInstrument, DemoSnapshotResponse, HealthResponse
from .journal import ImportProjectInput, JournalCreateInput, JournalRepository, JournalRevisionInput


market_data = MarketDataService(settings.data_dir / "cache" / "market")
journal = JournalRepository(settings.data_dir)


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    journal.initialize()
    yield


app = FastAPI(
    title=settings.app_name,
    version=settings.version,
    description="Local API boundary for the A/H stock analysis dashboard.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:4173", "http://localhost:4173"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", response_model=HealthResponse, tags=["system"])
async def health() -> HealthResponse:
    return HealthResponse(
        service=settings.app_name,
        version=settings.version,
        timestamp=datetime.now(ZoneInfo("Asia/Shanghai")),
    )


@app.get("/api/demo/snapshot/001280", response_model=DemoSnapshotResponse, tags=["demo"])
async def demo_snapshot() -> DemoSnapshotResponse:
    return DemoSnapshotResponse(instrument=DemoInstrument())


@app.get("/api/instruments/resolve", response_model=InstrumentPayload, tags=["market-data"])
async def resolve_instrument(input: str = Query(min_length=1, max_length=24)) -> InstrumentPayload:
    try:
        return market_data.resolve(input)
    except SymbolError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/market/bars/{symbol}", response_model=BarsResponse, tags=["market-data"])
async def market_bars(
    symbol: str,
    timeframe: Timeframe = "1d",
    adjustment: Adjustment = "qfq",
    limit: int = Query(default=640, ge=1, le=2000),
    refresh: bool = False,
    trading_date: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
) -> BarsResponse:
    try:
        return await market_data.get_bars(symbol, timeframe, adjustment, limit, refresh, trading_date)
    except SymbolError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (ProviderError, httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/market/quote/{symbol}", response_model=QuoteResponse, tags=["market-data"])
async def market_quote(symbol: str) -> QuoteResponse:
    try:
        return await market_data.get_quote(symbol)
    except SymbolError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except (ProviderError, httpx.HTTPError, ValueError) as error:
        raise HTTPException(status_code=502, detail=str(error)) from error


@app.get("/api/journal/records", tags=["journal"])
async def list_journal_records(
    date_key: str | None = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    symbol: str | None = None,
    include_deleted: bool = False,
) -> list[dict]:
    return journal.list(date_key, symbol, include_deleted)


@app.post("/api/journal/records", tags=["journal"])
async def create_journal_record(payload: JournalCreateInput) -> dict:
    return journal.create(payload)


@app.get("/api/journal/records/{record_id}", tags=["journal"])
async def get_journal_record(record_id: str) -> dict:
    try:
        return journal.get(record_id)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Journal record not found") from error


@app.post("/api/journal/records/{record_id}/revisions", tags=["journal"])
async def append_journal_revision(record_id: str, payload: JournalRevisionInput) -> dict:
    try:
        return journal.append_revision(record_id, payload)
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Journal record not found") from error


@app.delete("/api/journal/records/{record_id}", tags=["journal"])
async def recycle_journal_record(record_id: str) -> dict[str, bool]:
    try:
        journal.recycle(record_id)
        return {"recycled": True}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Journal record not found") from error


@app.post("/api/journal/records/{record_id}/restore", tags=["journal"])
async def restore_journal_record(record_id: str) -> dict[str, bool]:
    try:
        journal.restore(record_id)
        return {"restored": True}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Journal record not found") from error


@app.delete("/api/journal/records/{record_id}/permanent", tags=["journal"])
async def permanently_delete_journal_record(record_id: str, confirm: bool = False) -> dict[str, bool]:
    if not confirm:
        raise HTTPException(status_code=409, detail="Permanent deletion requires confirm=true")
    try:
        journal.permanently_delete(record_id)
        return {"deleted": True}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Journal record not found") from error


@app.post("/api/journal/records/{record_id}/export", tags=["journal"])
async def export_journal_record(record_id: str) -> dict[str, str]:
    try:
        path = journal.export_record(record_id)
        return {"path": str(path), "record_markdown": str(path / "record.md")}
    except KeyError as error:
        raise HTTPException(status_code=404, detail="Journal record not found") from error


@app.post("/api/journal/export-project", tags=["journal"])
async def export_journal_project() -> dict[str, str]:
    return {"path": str(journal.export_project())}


@app.post("/api/journal/import-project", tags=["journal"])
async def import_journal_project(payload: ImportProjectInput) -> dict[str, int]:
    try:
        return journal.import_project(Path(payload.path).expanduser().resolve())
    except (OSError, ValueError, zipfile.BadZipFile, KeyError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.get("/api/journal/artifact", tags=["journal"])
async def journal_artifact(path: str) -> FileResponse:
    target = (settings.data_dir / path).resolve()
    if settings.data_dir.resolve() not in target.parents or not target.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")
    return FileResponse(target)
