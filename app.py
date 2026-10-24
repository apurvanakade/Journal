import os
import sqlite3
from datetime import date, datetime, timezone

from flask import Flask, abort, g, redirect, render_template, request, url_for

DB_PATH = os.environ.get("JOURNAL_DB", "dev.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    day TEXT PRIMARY KEY,          -- YYYY-MM-DD
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL       -- UTC ISO timestamp
);
"""

app = Flask(__name__)


def connect(path=DB_PATH):
    db = sqlite3.connect(path, timeout=5)
    db.execute("PRAGMA journal_mode=WAL")
    db.execute("PRAGMA busy_timeout=5000")
    db.executescript(SCHEMA)
    return db


def get_db():
    if "db" not in g:
        g.db = connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def parse_day(s):
    try:
        return date.fromisoformat(s)
    except ValueError:
        abort(404)


@app.get("/")
def today():
    return redirect(url_for("entry", day=date.today().isoformat()))


@app.get("/<day>")
def entry(day):
    d = parse_day(day)
    db = get_db()
    row = db.execute("SELECT body FROM entries WHERE day = ?", (d.isoformat(),)).fetchone()
    days = [r[0] for r in db.execute("SELECT day FROM entries ORDER BY day")]
    return render_template(
        "index.html",
        day=d,
        body=row[0] if row else "",
        days=days,
        today=date.today().isoformat(),
    )


@app.put("/api/entries/<day>")
def save(day):
    d = parse_day(day).isoformat()
    body = request.get_data(as_text=True)
    db = get_db()
    if body.strip():
        db.execute(
            "INSERT INTO entries (day, body, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(day) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
            (d, body, datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
    else:
        db.execute("DELETE FROM entries WHERE day = ?", (d,))
    db.commit()
    return "", 204
