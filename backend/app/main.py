from contextlib import asynccontextmanager
from datetime import datetime
from zoneinfo import ZoneInfo

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .schemas import DemoInstrument, DemoSnapshotResponse, HealthResponse


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
