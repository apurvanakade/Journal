import io
import os
import re
import sqlite3
import urllib.parse
import urllib.request
import zipfile
from difflib import SequenceMatcher
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
CREATE TABLE IF NOT EXISTS revisions (
    id INTEGER PRIMARY KEY,
    day TEXT NOT NULL,
    body TEXT NOT NULL,
    saved_at TEXT NOT NULL         -- when this text was last current (UTC ISO)
);
CREATE INDEX IF NOT EXISTS revisions_day ON revisions (day);
"""

# Snapshot the previous text only when it ends a writing session, not on every autosave.
SESSION_GAP = timedelta(minutes=10)
# ...and only if it differs from the newest snapshot by at least this many words, so typo fixes don't pile up.
MIN_CHANGED_WORDS = 10

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


def archive(db, day, body, saved_at):
    db.execute("INSERT INTO revisions (day, body, saved_at) VALUES (?, ?, ?)", (day, body, saved_at))


def word_ops(a, b):
    return [op for op in SequenceMatcher(None, a.split(), b.split(), autojunk=False).get_opcodes() if op[0] != "equal"]


def changed_words(a, b):
    return sum(max(i2 - i1, j2 - j1) for _, i1, i2, j1, j2 in word_ops(a, b))


def contained(a, b):
    """True if b keeps every word of a in order, i.e. b only added to a."""
    return all(op == "insert" for op, *_ in word_ops(a, b))


def needs_snapshot(db, day, old):
    """Called when `old` ends a session. First drop snapshots that `old` merely extended (nothing in
    them was lost), then snapshot `old` unless it's within a few words of the newest one left."""
    while (last := db.execute(
        "SELECT id, body FROM revisions WHERE day = ? ORDER BY saved_at DESC LIMIT 1", (day,)
    ).fetchone()) and contained(last[1], old):
        db.execute("DELETE FROM revisions WHERE id = ?", (last[0],))
    return not last or changed_words(last[1], old) >= MIN_CHANGED_WORDS


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


@app.template_filter("localtime")
def localtime(s):
    return datetime.fromisoformat(s).astimezone().strftime("%b %-d, %Y, %-I:%M %p")


@app.get("/")
def today():
    return redirect(url_for("entry", day=date.today().isoformat()))


@app.get("/<day>")
def entry(day):
    d = parse_day(day)
    db = get_db()
    row = db.execute("SELECT body, updated_at FROM entries WHERE day = ?", (d.isoformat(),)).fetchone()
    has_history = db.execute("SELECT 1 FROM revisions WHERE day = ? LIMIT 1", (d.isoformat(),)).fetchone()
    return render_template(
        "index.html",
        day=d,
        body=row[0] if row else "",
        version=row[1] if row else "",
        prev=(d - timedelta(days=1)).isoformat(),
        next=(d + timedelta(days=1)).isoformat(),
        has_history=bool(has_history),
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
        if base is not None and base != version:
            # Someone else saved first. Keep the rejected text so neither side is lost.
            if body.strip() and body != old:
                archive(db, d, body, now())
            db.commit()
            return {"body": old, "version": version}, 409
        if row and body != old and (
            "overwrite" in request.args
            or not body.strip()
            or len(body) < len(old) / 2
            or datetime.now(timezone.utc) - datetime.fromisoformat(version) > SESSION_GAP
            and needs_snapshot(db, d, old)
        ):
            archive(db, d, old, version)
        version = write(db, d, body)
        db.commit()
    except BaseException:
        db.rollback()
        raise
    return {"version": version}


@app.get("/<day>/history")
def history(day):
    d = parse_day(day)
    db = get_db()
    revs = db.execute(
        "SELECT id, body, saved_at FROM revisions WHERE day = ? ORDER BY saved_at DESC", (d.isoformat(),)
    ).fetchall()
    return render_template(
        "history.html", day=d, revs=revs, days=all_days(db), today=date.today().isoformat()
    )


@app.post("/<day>/history/<int:rid>")
def restore(day, rid):
    d = parse_day(day).isoformat()
    db = get_db()
    rev = db.execute("SELECT body FROM revisions WHERE id = ? AND day = ?", (rid, d)).fetchone() or abort(404)
    row = db.execute("SELECT body, updated_at FROM entries WHERE day = ?", (d,)).fetchone()
    if row and row[0] != rev[0]:
        archive(db, d, *row)
    write(db, d, rev[0])
    db.commit()
    return redirect(url_for("entry", day=d))


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
