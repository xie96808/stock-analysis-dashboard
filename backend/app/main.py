from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

import httpx
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .market_data import MarketDataService
from .market_data.models import Adjustment, BarsResponse, InstrumentPayload, QuoteResponse, Timeframe
from .market_data.symbols import SymbolError
from .market_data.tencent import ProviderError
from .schemas import DemoInstrument, DemoSnapshotResponse, HealthResponse


market_data = MarketDataService(settings.data_dir / "cache" / "market")


@asynccontextmanager
async def lifespan(_: FastAPI):
    settings.data_dir.mkdir(parents=True, exist_ok=True)
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
    allow_methods=["GET"],
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
