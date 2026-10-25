import io
import os
import re
import sqlite3
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone

from flask import Flask, abort, g, redirect, render_template, request, send_file, url_for
from markupsafe import Markup, escape

DB_PATH = os.environ.get("JOURNAL_DB", "dev.db")
GTD_URL = os.environ.get("GTD_URL", "http://127.0.0.1:5005")

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    day TEXT PRIMARY KEY,          -- YYYY-MM-DD
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL       -- UTC ISO timestamp; doubles as the version for conflict checks
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


def now():
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def all_days(db):
    return [r[0] for r in db.execute("SELECT day FROM entries ORDER BY day")]


def write(db, day, body):
    """Upsert (or delete, if blank) and return the new version ("" when there's no entry)."""
    if not body.strip():
        db.execute("DELETE FROM entries WHERE day = ?", (day,))
        return ""
    version = now()
    db.execute(
        "INSERT INTO entries (day, body, updated_at) VALUES (?, ?, ?) "
        "ON CONFLICT(day) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at",
        (day, body, version),
    )
    return version


@app.get("/")
def today():
    return redirect(url_for("entry", day=date.today().isoformat()))


@app.get("/<day>")
def entry(day):
    d = parse_day(day)
    db = get_db()
    row = db.execute("SELECT body, updated_at FROM entries WHERE day = ?", (d.isoformat(),)).fetchone()
    return render_template(
        "index.html",
        day=d,
        body=row[0] if row else "",
        version=row[1] if row else "",
        prev=(d - timedelta(days=1)).isoformat(),
        next=(d + timedelta(days=1)).isoformat(),
        days=all_days(db),
        today=date.today().isoformat(),
    )


@app.get("/api/entries/<day>")
def load(day):
    d = parse_day(day).isoformat()
    row = get_db().execute("SELECT body, updated_at FROM entries WHERE day = ?", (d,)).fetchone()
    return {"body": row[0] if row else "", "version": row[1] if row else ""}


@app.put("/api/entries/<day>")
def save(day):
    d = parse_day(day).isoformat()
    body = request.get_data(as_text=True)
    base = request.headers.get("X-Base-Version")  # version the client last saw; absent = no check
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        row = db.execute("SELECT body, updated_at FROM entries WHERE day = ?", (d,)).fetchone()
        old, version = row if row else ("", "")
        if base is not None and base != version and body != old:
            db.rollback()
            return {"body": old, "version": version}, 409  # someone else saved first; the client asks
        if body != old:
            version = write(db, d, body)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return {"version": version}


def snippet(body, terms, width=90):
    lower = body.lower()
    i = min((lower.find(t) for t in terms if t in lower), default=0)
    start = max(0, i - width // 3)
    text = body[start : start + width].replace("\n", " ")
    text = ("…" if start else "") + text + ("…" if start + width < len(body) else "")
    pattern = re.compile("|".join(re.escape(t) for t in terms), re.IGNORECASE)
    return Markup(pattern.sub(lambda m: Markup("<mark>%s</mark>") % m.group(0), str(escape(text))))


@app.get("/search")
def search():
    q = request.args.get("q", "").strip()
    terms = [t.lower() for t in q.split()]
    db = get_db()
    results = []
    if terms:
        like = " AND ".join(["body LIKE ? ESCAPE '\\'"] * len(terms))
        args = ["%" + re.sub(r"([%_\\])", r"\\\1", t) + "%" for t in terms]
        rows = db.execute(f"SELECT day, body FROM entries WHERE {like} ORDER BY day DESC", args)
        results = [(date.fromisoformat(day), snippet(body, terms)) for day, body in rows]
    return render_template(
        "search.html", q=q, results=results, days=all_days(db), today=date.today().isoformat()
    )


@app.get("/export.zip")
def export():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for day, body in get_db().execute("SELECT day, body FROM entries ORDER BY day"):
            z.writestr(f"journal/{day}.md", body)
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=f"journal-{date.today().isoformat()}.zip")


@app.post("/api/inbox")
def inbox():
    title = request.get_data(as_text=True).strip()
    if not title:
        abort(400)
    data = urllib.parse.urlencode({"title": title}).encode()
    try:
        urllib.request.urlopen(GTD_URL + "/capture", data, timeout=5)
    except OSError:
        abort(502)
    return "", 204
