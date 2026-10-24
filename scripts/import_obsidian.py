"""Import Obsidian journal files named YYYY-MM-DD.md into the journal DB.

Files that are only the empty daily template (date heading, "Day of the week",
"## Journal") are skipped. Every other file (non-matching names, images, ...)
is copied into the stash directory, keeping its relative path.

    uv run python scripts/import_obsidian.py ../Obsidian/Journal dev.db unmigrated
"""

import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import connect  # noqa: E402

NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})\.md$")
TEMPLATE_LINE = re.compile(r"^(#+\s*\d{4}-\d{2}-\d{2}|Day of the week:.*|## Journal)\s*$")


def is_empty_template(text):
    return all(not line.strip() or TEMPLATE_LINE.match(line) for line in text.splitlines())


def main(src, db_path, stash):
    src, stash = Path(src), Path(stash)
    db = connect(db_path)
    imported = skipped = stashed = 0
    for path in sorted(src.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        m = NAME.match(path.name)
        if m:
            day = date.fromisoformat(m.group(1)).isoformat()
            text = path.read_text(encoding="utf-8")
            if is_empty_template(text):
                skipped += 1
                continue
            mtime = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            db.execute(
                "INSERT OR REPLACE INTO entries (day, body, updated_at) VALUES (?, ?, ?)",
                (day, text, mtime.isoformat(timespec="seconds")),
            )
            imported += 1
        else:
            dest = stash / path.relative_to(src)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            stashed += 1
    db.commit()
    print(f"imported {imported}, skipped {skipped} empty templates, stashed {stashed} files in {stash}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
