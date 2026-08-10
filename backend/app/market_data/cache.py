import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class JsonCache:
    def __init__(self, root: Path):
        self.root = root

    def _path(self, key: str) -> Path:
        safe = "".join(character if character.isalnum() or character in "-_" else "_" for character in key)
        return self.root / f"{safe}.json"

    def get(self, key: str, max_age_seconds: int) -> dict[str, Any] | None:
        payload = self._read(key)
        if payload is None:
            return None
        saved_at, value = payload
        age = (datetime.now(UTC) - saved_at).total_seconds()
        return value if age <= max_age_seconds else None

    def get_any(self, key: str) -> dict[str, Any] | None:
        payload = self._read(key)
        return payload[1] if payload is not None else None

    def _read(self, key: str) -> tuple[datetime, dict[str, Any]] | None:
        path = self._path(key)
        if not path.exists():
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            saved_at = datetime.fromisoformat(payload["saved_at"])
            return saved_at, payload["value"]
        except (KeyError, ValueError, OSError, json.JSONDecodeError):
            return None

    def set(self, key: str, value: dict[str, Any]) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        target = self._path(key)
        temporary = target.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"saved_at": datetime.now(UTC).isoformat(), "value": value}, ensure_ascii=False),
            encoding="utf-8",
        )
        temporary.replace(target)
