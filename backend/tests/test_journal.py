import base64
import hashlib
import json
import zipfile
from pathlib import Path

import pytest

from backend.app.journal import JournalCreateInput, JournalRepository, JournalRevisionInput


def create_payload(title: str = "初始判断") -> JournalCreateInput:
    return JournalCreateInput(
        date_key="2026-08-10",
        symbol="SZSE:001280",
        name="中国铀业",
        market="CN",
        timeframe="日K",
        title=title,
        thesis_markdown="**等待确认**",
        market_data_as_of="2026-08-07",
        chart_state={"logPrice": True},
        drawings=[{"id": "line-1"}],
        indicators={"macd": [12, 26, 9]},
        screenshot_data_url="data:image/png;base64," + base64.b64encode(b"PNG").decode(),
    )


def test_revisions_are_append_only_and_old_version_is_preserved(tmp_path: Path) -> None:
    repository = JournalRepository(tmp_path)
    repository.initialize()
    created = repository.create(create_payload())
    record_id = created["id"]
    repository.append_revision(
        record_id,
        JournalRevisionInput(
            title="修订判断",
            thesis_markdown="第二版",
            market_data_as_of="2026-08-10",
            chart_state={"logPrice": False},
        ),
    )
    detail = repository.get(record_id)
    assert [revision["version"] for revision in detail["revisions"]] == [2, 1]
    assert detail["revisions"][1]["title"] == "初始判断"
    assert detail["current_revision"]["title"] == "修订判断"


def test_recycle_restore_and_markdown_export(tmp_path: Path) -> None:
    repository = JournalRepository(tmp_path)
    repository.initialize()
    record_id = repository.create(create_payload())["id"]
    repository.recycle(record_id)
    assert repository.list("2026-08-10", None, False) == []
    assert len(repository.list("2026-08-10", None, True)) == 1
    repository.restore(record_id)
    export_dir = repository.export_record(record_id)
    markdown = (export_dir / "record.md").read_text(encoding="utf-8")
    assert "schemaVersion" in markdown
    assert "**等待确认**" in markdown
    assert (export_dir / "drawings.json").exists()
    assert (export_dir / "chart.png").read_bytes() == b"PNG"


def test_project_export_checksum_and_restore(tmp_path: Path) -> None:
    source = JournalRepository(tmp_path / "source")
    source.initialize()
    source.create(create_payload())
    archive = source.export_project()

    target = JournalRepository(tmp_path / "target")
    target.initialize()
    result = target.import_project(archive)
    assert result["records"] == 1
    assert result["revisions"] == 1
    assert target.list("2026-08-10", None, False)[0]["title"] == "初始判断"


def test_project_import_rejects_path_traversal_before_writing(tmp_path: Path) -> None:
    target = JournalRepository(tmp_path / "target")
    target.initialize()
    archive_path = tmp_path / "malicious.zip"
    records_payload = b"[]"
    manifest = {
        "schemaVersion": target.schema_version,
        "checksums": {"records.json": hashlib.sha256(records_payload).hexdigest()},
    }
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("records.json", records_payload)
        archive.writestr("manifest.json", json.dumps(manifest))
        archive.writestr("journal/../../escape.txt", b"unexpected")

    with pytest.raises(ValueError, match="Unsafe path"):
        target.import_project(archive_path)

    assert not (tmp_path / "escape.txt").exists()

def test_project_import_rejects_journal_file_checksum_mismatch(tmp_path: Path) -> None:
    source = JournalRepository(tmp_path / "source")
    source.initialize()
    source.create(create_payload())
    original = source.export_project()
    tampered = tmp_path / "tampered.zip"
    with zipfile.ZipFile(original) as src, zipfile.ZipFile(tampered, "w") as dst:
        replaced = False
        for info in src.infolist():
            payload = b"tampered-screenshot" if info.filename.endswith("chart.png") else src.read(info)
            replaced = replaced or info.filename.endswith("chart.png")
            dst.writestr(info.filename, payload)
        assert replaced

    target = JournalRepository(tmp_path / "target")
    target.initialize()
    with pytest.raises(ValueError, match="checksum"):
        target.import_project(tampered)
