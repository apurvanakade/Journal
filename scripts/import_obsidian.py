"""Import Obsidian journal files named YYYY-MM-DD.md into the journal DB.

Files that are only the empty daily template (date heading, "Day of the week",
"## Journal") are skipped, as are days the DB already has (nothing is overwritten).
YYYY-MM-DD.svg drawings from /export.zip are imported too. Every other file
(non-matching names, images, ...) is copied into the stash directory, keeping
its relative path.

    uv run python scripts/import_obsidian.py ../Obsidian/Journal dev.db unmigrated
"""

import re
import shutil
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import INK, connect, init  # noqa: E402

NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})\.(md|svg)$")
TEMPLATE_LINE = re.compile(r"^(#+\s*\d{4}-\d{2}-\d{2}|Day of the week:.*|## Journal)\s*$")
SVG_BODY = re.compile(r"<svg[^>]*>(.*)</svg>", re.S)


def is_empty_template(text):
    return all(not line.strip() or TEMPLATE_LINE.match(line) for line in text.splitlines())


def drawing(text):
    """The bare <path>s of an exported drawing, or None if it isn't one."""
    m = SVG_BODY.search(text)
    return m.group(1) if m and INK.fullmatch(m.group(1)) else None


def main(src, db_path, stash):
    src, stash = Path(src), Path(stash)
    init(db_path)
    db = connect(db_path)
    imported = skipped = existing = stashed = 0
    for path in sorted(src.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        m = NAME.match(path.name)
        text = path.read_text(encoding="utf-8") if m else ""
        body = text if m and m.group(2) == "md" else drawing(text) if m else None
        if body is None:
            dest = stash / path.relative_to(src)
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, dest)
            stashed += 1
            continue
        if not body.strip() or m.group(2) == "md" and is_empty_template(body):
            skipped += 1
            continue
        table = "entries" if m.group(2) == "md" else "drawings"
        mtime = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
        cur = db.execute(
            f"INSERT INTO {table} (day, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(day) DO NOTHING",
            (date.fromisoformat(m.group(1)).isoformat(), body, mtime.isoformat(timespec="seconds")),
        )
        if cur.rowcount:
            imported += 1
        else:
            existing += 1
    db.commit()
    print(f"imported {imported}, skipped {skipped} empty and {existing} already in the DB, "
          f"stashed {stashed} files in {stash}")


if __name__ == "__main__":
    main(*sys.argv[1:4])
