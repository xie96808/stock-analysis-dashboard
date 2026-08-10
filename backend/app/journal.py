import base64
import hashlib
import json
import shutil
import sqlite3
import uuid
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal
from zoneinfo import ZoneInfo

from pydantic import BaseModel, Field


class JournalRevisionInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    thesis_markdown: str = Field(min_length=1)
    market_data_as_of: str
    chart_state: dict[str, Any] = Field(default_factory=dict)
    drawings: list[dict[str, Any]] = Field(default_factory=list)
    indicators: dict[str, Any] = Field(default_factory=dict)
    screenshot_data_url: str | None = None
    tags: list[str] = Field(default_factory=list)
    scenarios: list[dict[str, Any]] = Field(default_factory=list)
    invalidation: str | None = None
    targets: list[dict[str, Any]] = Field(default_factory=list)
    confidence: int | None = Field(default=None, ge=0, le=100)
    result_status: Literal["pending", "partial", "hit", "invalidated"] = "pending"
    review_markdown: str = ""


class JournalCreateInput(JournalRevisionInput):
    date_key: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    symbol: str
    name: str
    market: Literal["CN", "HK"]
    timeframe: str


class ImportProjectInput(BaseModel):
    path: str


class JournalRepository:
    schema_version = 1

    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self.database_path = data_dir / "dashboard.sqlite3"
        self.journal_dir = data_dir / "journal"
        self.export_dir = data_dir / "exports"
        self.backup_dir = data_dir / "backups"

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def initialize(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.journal_dir.mkdir(parents=True, exist_ok=True)
        self.export_dir.mkdir(parents=True, exist_ok=True)
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(
                """
                PRAGMA journal_mode = WAL;
                CREATE TABLE IF NOT EXISTS research_records (
                    id TEXT PRIMARY KEY,
                    date_key TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    name TEXT NOT NULL,
                    market TEXT NOT NULL,
                    timeframe TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_records_date ON research_records(date_key, deleted_at);
                CREATE INDEX IF NOT EXISTS idx_records_symbol ON research_records(symbol, deleted_at);
                CREATE TABLE IF NOT EXISTS research_revisions (
                    id TEXT PRIMARY KEY,
                    record_id TEXT NOT NULL REFERENCES research_records(id) ON DELETE CASCADE,
                    version INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    market_data_as_of TEXT NOT NULL,
                    title TEXT NOT NULL,
                    thesis_markdown TEXT NOT NULL,
                    chart_state_json TEXT NOT NULL,
                    drawings_json TEXT NOT NULL,
                    indicators_json TEXT NOT NULL,
                    tags_json TEXT NOT NULL,
                    scenarios_json TEXT NOT NULL,
                    invalidation TEXT,
                    targets_json TEXT NOT NULL,
                    confidence INTEGER,
                    result_status TEXT NOT NULL,
                    review_markdown TEXT NOT NULL,
                    screenshot_path TEXT,
                    UNIQUE(record_id, version)
                );
                """
            )
        self.ensure_daily_backup()

    @staticmethod
    def _now() -> str:
        return datetime.now(UTC).isoformat()

    def _save_screenshot(self, record_id: str, revision_id: str, data_url: str | None) -> str | None:
        if not data_url or not data_url.startswith("data:image/png;base64,"):
            return None
        payload = base64.b64decode(data_url.split(",", 1)[1], validate=True)
        target_dir = self.journal_dir / record_id / revision_id
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / "chart.png"
        target.write_bytes(payload)
        return str(target.relative_to(self.data_dir))

    def _insert_revision(
        self,
        connection: sqlite3.Connection,
        record_id: str,
        version: int,
        payload: JournalRevisionInput,
    ) -> str:
        revision_id = str(uuid.uuid4())
        screenshot_path = self._save_screenshot(record_id, revision_id, payload.screenshot_data_url)
        connection.execute(
            """INSERT INTO research_revisions (
                id, record_id, version, created_at, market_data_as_of, title, thesis_markdown,
                chart_state_json, drawings_json, indicators_json, tags_json, scenarios_json,
                invalidation, targets_json, confidence, result_status, review_markdown, screenshot_path
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                revision_id, record_id, version, self._now(), payload.market_data_as_of,
                payload.title, payload.thesis_markdown,
                json.dumps(payload.chart_state, ensure_ascii=False),
                json.dumps(payload.drawings, ensure_ascii=False),
                json.dumps(payload.indicators, ensure_ascii=False),
                json.dumps(payload.tags, ensure_ascii=False),
                json.dumps(payload.scenarios, ensure_ascii=False),
                payload.invalidation,
                json.dumps(payload.targets, ensure_ascii=False),
                payload.confidence, payload.result_status, payload.review_markdown, screenshot_path,
            ),
        )
        return revision_id

    def create(self, payload: JournalCreateInput) -> dict[str, Any]:
        record_id = str(uuid.uuid4())
        now = self._now()
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO research_records
                   (id, date_key, symbol, name, market, timeframe, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (record_id, payload.date_key, payload.symbol, payload.name, payload.market, payload.timeframe, now, now),
            )
            self._insert_revision(connection, record_id, 1, payload)
        return self.get(record_id)

    def append_revision(self, record_id: str, payload: JournalRevisionInput) -> dict[str, Any]:
        with self.connect() as connection:
            record = connection.execute("SELECT id FROM research_records WHERE id = ?", (record_id,)).fetchone()
            if record is None:
                raise KeyError(record_id)
            version = connection.execute(
                "SELECT COALESCE(MAX(version), 0) + 1 FROM research_revisions WHERE record_id = ?", (record_id,)
            ).fetchone()[0]
            self._insert_revision(connection, record_id, int(version), payload)
            connection.execute("UPDATE research_records SET updated_at = ? WHERE id = ?", (self._now(), record_id))
        return self.get(record_id)

    @staticmethod
    def _revision(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"], "record_id": row["record_id"], "version": row["version"],
            "created_at": row["created_at"], "market_data_as_of": row["market_data_as_of"],
            "title": row["title"], "thesis_markdown": row["thesis_markdown"],
            "chart_state": json.loads(row["chart_state_json"]), "drawings": json.loads(row["drawings_json"]),
            "indicators": json.loads(row["indicators_json"]), "tags": json.loads(row["tags_json"]),
            "scenarios": json.loads(row["scenarios_json"]), "invalidation": row["invalidation"],
            "targets": json.loads(row["targets_json"]), "confidence": row["confidence"],
            "result_status": row["result_status"], "review_markdown": row["review_markdown"],
            "screenshot_path": row["screenshot_path"],
        }

    def get(self, record_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            record = connection.execute("SELECT * FROM research_records WHERE id = ?", (record_id,)).fetchone()
            if record is None:
                raise KeyError(record_id)
            revision_rows = connection.execute(
                "SELECT * FROM research_revisions WHERE record_id = ? ORDER BY version DESC", (record_id,)
            ).fetchall()
        revisions = [self._revision(row) for row in revision_rows]
        return {**dict(record), "revisions": revisions, "current_revision": revisions[0] if revisions else None}

    def list(self, date_key: str | None, symbol: str | None, include_deleted: bool) -> list[dict[str, Any]]:
        clauses = ["1 = 1"]
        parameters: list[Any] = []
        if not include_deleted:
            clauses.append("r.deleted_at IS NULL")
        if date_key:
            clauses.append("r.date_key = ?")
            parameters.append(date_key)
        if symbol:
            clauses.append("r.symbol = ?")
            parameters.append(symbol)
        query = f"""
            SELECT r.*, v.id AS revision_id, v.version, v.title, v.thesis_markdown,
                   v.market_data_as_of, v.result_status, v.screenshot_path
            FROM research_records r
            JOIN research_revisions v ON v.record_id = r.id
            WHERE {' AND '.join(clauses)}
              AND v.version = (SELECT MAX(v2.version) FROM research_revisions v2 WHERE v2.record_id = r.id)
            ORDER BY r.date_key DESC, r.updated_at DESC
        """
        with self.connect() as connection:
            return [dict(row) for row in connection.execute(query, parameters).fetchall()]

    def recycle(self, record_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute("UPDATE research_records SET deleted_at = ? WHERE id = ?", (self._now(), record_id))
            if cursor.rowcount == 0:
                raise KeyError(record_id)

    def restore(self, record_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute("UPDATE research_records SET deleted_at = NULL WHERE id = ?", (record_id,))
            if cursor.rowcount == 0:
                raise KeyError(record_id)

    def permanently_delete(self, record_id: str) -> None:
        target = self.journal_dir / record_id
        with self.connect() as connection:
            cursor = connection.execute("DELETE FROM research_records WHERE id = ?", (record_id,))
            if cursor.rowcount == 0:
                raise KeyError(record_id)
        shutil.rmtree(target, ignore_errors=True)

    def export_record(self, record_id: str) -> Path:
        record = self.get(record_id)
        revision = record["current_revision"]
        target = self.export_dir / f"record-{record_id}-v{revision['version']}"
        target.mkdir(parents=True, exist_ok=True)
        frontmatter = {
            "schemaVersion": self.schema_version, "recordId": record_id, "date": record["date_key"],
            "symbol": record["symbol"], "market": record["market"], "timeframe": record["timeframe"],
            "version": revision["version"], "marketDataAsOf": revision["market_data_as_of"],
            "tags": revision["tags"], "status": revision["result_status"],
        }
        yaml_lines = ["---", *[f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in frontmatter.items()], "---", ""]
        (target / "record.md").write_text("\n".join(yaml_lines) + f"# {revision['title']}\n\n{revision['thesis_markdown']}\n", encoding="utf-8")
        (target / "drawings.json").write_text(json.dumps(revision["drawings"], ensure_ascii=False, indent=2), encoding="utf-8")
        (target / "chart-state.json").write_text(json.dumps(revision["chart_state"], ensure_ascii=False, indent=2), encoding="utf-8")
        (target / "indicators.json").write_text(json.dumps(revision["indicators"], ensure_ascii=False, indent=2), encoding="utf-8")
        if revision["screenshot_path"]:
            source = self.data_dir / revision["screenshot_path"]
            if source.exists():
                shutil.copy2(source, target / "chart.png")
        return target

    @staticmethod
    def _sha256(payload: bytes) -> str:
        return hashlib.sha256(payload).hexdigest()

    def export_project(self) -> Path:
        records = [self.get(item["id"]) for item in self.list(None, None, True)]
        records_payload = json.dumps(records, ensure_ascii=False, indent=2).encode()
        timestamp = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y%m%d-%H%M%S")
        target = self.export_dir / f"stock-dashboard-{timestamp}.zip"
        manifest = {
            "schemaVersion": self.schema_version,
            "exportedAt": self._now(),
            "recordCount": len(records),
            "checksums": {"records.json": self._sha256(records_payload)},
        }
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr("records.json", records_payload)
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=2))
            for file in self.journal_dir.rglob("*"):
                if file.is_file():
                    archive.write(file, Path("journal") / file.relative_to(self.journal_dir))
        return target

    def import_project(self, path: Path) -> dict[str, int]:
        imported_records = 0
        imported_revisions = 0
        with zipfile.ZipFile(path) as archive:
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("schemaVersion") != self.schema_version:
                raise ValueError("Unsupported journal export schema")
            records_payload = archive.read("records.json")
            if self._sha256(records_payload) != manifest["checksums"]["records.json"]:
                raise ValueError("Export checksum mismatch")
            records = json.loads(records_payload)
            with self.connect() as connection:
                for record in records:
                    cursor = connection.execute(
                        """INSERT OR IGNORE INTO research_records
                        (id,date_key,symbol,name,market,timeframe,created_at,updated_at,deleted_at)
                        VALUES (?,?,?,?,?,?,?,?,?)""",
                        tuple(record[key] for key in ("id", "date_key", "symbol", "name", "market", "timeframe", "created_at", "updated_at", "deleted_at")),
                    )
                    imported_records += cursor.rowcount
                    for revision in record["revisions"]:
                        cursor = connection.execute(
                            """INSERT OR IGNORE INTO research_revisions
                            (id,record_id,version,created_at,market_data_as_of,title,thesis_markdown,chart_state_json,drawings_json,
                             indicators_json,tags_json,scenarios_json,invalidation,targets_json,confidence,result_status,review_markdown,screenshot_path)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                            (
                                revision["id"], record["id"], revision["version"], revision["created_at"], revision["market_data_as_of"],
                                revision["title"], revision["thesis_markdown"], json.dumps(revision["chart_state"], ensure_ascii=False),
                                json.dumps(revision["drawings"], ensure_ascii=False), json.dumps(revision["indicators"], ensure_ascii=False),
                                json.dumps(revision["tags"], ensure_ascii=False), json.dumps(revision["scenarios"], ensure_ascii=False),
                                revision["invalidation"], json.dumps(revision["targets"], ensure_ascii=False), revision["confidence"],
                                revision["result_status"], revision["review_markdown"], revision["screenshot_path"],
                            ),
                        )
                        imported_revisions += cursor.rowcount
            for name in archive.namelist():
                if name.startswith("journal/") and not name.endswith("/"):
                    target = self.data_dir / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_bytes(archive.read(name))
        return {"records": imported_records, "revisions": imported_revisions}

    def ensure_daily_backup(self) -> Path:
        date_key = datetime.now(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d")
        target = self.backup_dir / f"dashboard-{date_key}.sqlite3"
        if not target.exists():
            with self.connect() as source, sqlite3.connect(target) as destination:
                source.backup(destination)
        backups = sorted(self.backup_dir.glob("dashboard-*.sqlite3"), reverse=True)
        for expired in backups[30:]:
            expired.unlink(missing_ok=True)
        return target
