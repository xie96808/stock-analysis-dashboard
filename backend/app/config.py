from dataclasses import dataclass
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    app_name: str = "Stock Analysis Dashboard API"
    version: str = "1.0.0"
    phase: str = "P7"
    host: str = "127.0.0.1"
    port: int = 8000
    data_dir: Path = PROJECT_ROOT / "data"


settings = Settings()
