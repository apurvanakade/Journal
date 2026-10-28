import io
import json
import math
import os
import re
import sqlite3
import urllib.parse
import urllib.request
import zipfile
from datetime import date, datetime, timedelta, timezone

from flask import Flask, Response, abort, g, redirect, render_template, request, send_file, url_for
from markupsafe import Markup

DB_PATH = os.environ.get("JOURNAL_DB", "dev.db")
GTD_URL = os.environ.get("GTD_URL", "http://127.0.0.1:5005")
# Names are only learned from entries on or after this day (older ones taught too many title fragments).
NAMES_SINCE = os.environ.get("JOURNAL_NAMES_SINCE", "2026-10-26")

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    day TEXT PRIMARY KEY,          -- YYYY-MM-DD
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL       -- UTC ISO timestamp; doubles as the version for conflict checks
);
CREATE TABLE IF NOT EXISTS drawings (  -- optional scribble box under an entry; same versioning
    day TEXT PRIMARY KEY,
    body TEXT NOT NULL,            -- bare SVG <path d="M…L…">s, 700 units wide (see INK, ink_height)
    updated_at TEXT NOT NULL
);
"""
# The only drawing markup accepted: it's put back into the page with innerHTML.
INK = re.compile(r'(<path d="[ML0-9. ]+"></path>)*')
PATH = re.compile(r'<path d="([^"]*)"></path>')


def _points(d):
    """A path's pen points: M and L points, and the control point of each Q (see ink.js)."""
    return [seg[1:].split()[:2] for seg in re.findall(r"[MQL][^MQL]*", d)]


def _num(n):
    return f"{round(n, 1):g}"


def smooth(body):
    """Stored points to the curves ink.js draws: quadratic Béziers between midpoints."""
    def curve(m):
        pts = _points(m.group(1))
        if len(pts) < 3:
            return m.group(0)
        d = "M" + " ".join(pts[0])
        for a, b in zip(pts[1:-1], pts[2:]):
            d += "Q%s %s" % (" ".join(a), " ".join(_num((float(x) + float(y)) / 2) for x, y in zip(a, b)))
        return '<path d="%sL%s"></path>' % (d, " ".join(pts[-1]))
    return PATH.sub(curve, body)


def unsmooth(body):
    """smooth()'s inverse: curves back to the stored points."""
    return PATH.sub(lambda m: '<path d="M%s"></path>' % "L".join(" ".join(p) for p in _points(m.group(1))), body)


def init(path=DB_PATH):
    """Create the tables if needed and switch to WAL (both persist in the file); once per process."""
    db = sqlite3.connect(path)
    db.execute("PRAGMA journal_mode=WAL")
    db.executescript(SCHEMA)
    db.close()


def connect(path=DB_PATH):
    db = sqlite3.connect(path, timeout=5)
    # SQLite's own lower() and LIKE only fold ASCII; search uses Python's, like snippet().
    db.create_function("pylower", 1, str.lower, deterministic=True)
    return db


init()
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 8 * 1024 * 1024


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
    return [r[0] for r in db.execute("SELECT day FROM entries UNION SELECT day FROM drawings ORDER BY day")]


def fetch(db, table, day):
    row = db.execute(f"SELECT body, updated_at FROM {table} WHERE day = ?", (day,)).fetchone()
    return row if row else ("", "")


def write(db, table, day, body):
    """Upsert (or delete, if blank) and return the new version ("" when there's no entry)."""
    if not body.strip():
        db.execute(f"DELETE FROM {table} WHERE day = ?", (day,))
        return ""
    version = now()
    db.execute(
        f"INSERT INTO {table} (day, body, updated_at) VALUES (?, ?, ?) "
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
    body, version = fetch(db, "entries", d.isoformat())
    ink, ink_version = fetch(db, "drawings", d.isoformat())
    return render_template(
        "index.html",
        day=d,
        body=body,
        version=version,
        ink=ink,
        ink_version=ink_version,
        prev=(d - timedelta(days=1)).isoformat(),
        next=(d + timedelta(days=1)).isoformat(),
        days=all_days(db),
        today=date.today().isoformat(),
    )


@app.get("/api/<any(entries, drawings):table>/<day>")
def load(table, day):
    body, version = fetch(get_db(), table, parse_day(day).isoformat())
    return {"body": body, "version": version}


@app.put("/api/<any(entries, drawings):table>/<day>")
def save(table, day):
    d = parse_day(day).isoformat()
    body = request.get_data(as_text=True)
    if table == "drawings" and not INK.fullmatch(body):
        abort(400)
    base = request.headers.get("X-Base-Version")  # version the client last saw; absent = no check
    db = get_db()
    db.execute("BEGIN IMMEDIATE")
    try:
        old, version = fetch(db, table, d)
        if base is not None and base != version and body != old:
            db.rollback()
            return {"body": old, "version": version}, 409  # someone else saved first; the client asks
        if body != old:
            version = write(db, table, d, body)
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
    # Split on the terms before escaping (so a term can't match inside an entity); odd parts are hits.
    parts = re.split("(" + "|".join(re.escape(t) for t in terms) + ")", text, flags=re.IGNORECASE)
    return Markup("").join(Markup("<mark>%s</mark>") % p if n % 2 else p for n, p in enumerate(parts))


@app.get("/search")
def search():
    q = request.args.get("q", "").strip()
    terms = [t.lower() for t in q.split()]
    db = get_db()
    results = []
    if terms:
        where = " AND ".join(["instr(pylower(body), ?)"] * len(terms))
        rows = db.execute(f"SELECT day, body FROM entries WHERE {where} ORDER BY day DESC", terms)
        results = [(date.fromisoformat(day), snippet(body, terms)) for day, body in rows]
    return render_template(
        "search.html", q=q, results=results, days=all_days(db), today=date.today().isoformat()
    )


# Typing assists (desktop): a vocabulary for word completion, and the words you always capitalize
# mid-sentence (names, places) on at least two days, learned from the entries (names only from
# NAMES_SINCE on). Cached, as JSON, until any entry changes; the browser revalidates by ETag.
LINE_PREFIX = re.compile(r"^(#{1,6} |\s*(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?|>+ ?)")
NOISE = re.compile(r"`[^`]*`|\S*://\S*|\]\([^)]*\)|\[\[[^\]]*\]\]")
TOKEN = re.compile(r"[^\W\d_]+(?:['’][^\W\d_]+)*")
_words = (None, None)


def vocabulary(db):
    counts, lower, caps, caps_days = {}, {}, {}, {}
    fence = False
    for day, body in db.execute("SELECT day, body FROM entries"):
        for line in body.split("\n"):
            if re.match(r"\s*(```|~~~)", line):
                fence = not fence
            if fence or line.lstrip().startswith(("```", "~~~")):
                continue
            # Headings and table rows are Title Case, not evidence of a name.
            titled = re.match(r"\s*(#|\|)", line) or re.search(r"\S {3,}\S", line)
            line = NOISE.sub(" ", LINE_PREFIX.sub("", line))
            end = None
            for m in TOKEN.finditer(line):
                start = end is None or re.search(r"[.!?]", line[end : m.start()])
                end = m.end()
                w = re.sub(r"['’]s$", "", m.group())
                low = w.lower()
                if len(low) < 2 or low == "i" or low.startswith(("i'", "i’")):
                    continue
                counts[low] = counts.get(low, 0) + 1
                if w == low:
                    lower[low] = lower.get(low, 0) + 1
                elif day >= NAMES_SINCE and not start and not titled and w[0].isupper():
                    caps.setdefault(low, {})
                    caps[low][w] = caps[low].get(w, 0) + 1
                    caps_days.setdefault(low, set()).add(day)
        fence = False
    proper = {}
    for low, forms in caps.items():
        n = sum(forms.values())
        if len(caps_days[low]) >= 2 and lower.get(low, 0) * 10 < n:
            proper[low] = max(forms, key=forms.get)
    words = sorted((w for w, n in counts.items() if n >= 2 and len(w) >= 5), key=lambda w: -counts[w])
    return {"words": words[:20000], "proper": proper}


@app.get("/api/words")
def words():
    global _words
    db = get_db()
    key = db.execute("SELECT count(*), max(updated_at) FROM entries").fetchone()
    if _words[0] != key:
        _words = (key, json.dumps(vocabulary(db), ensure_ascii=False))
    resp = Response(_words[1], mimetype="application/json")
    resp.set_etag(f"{key[0]}-{key[1]}-{NAMES_SINCE}")
    resp.cache_control.no_cache = True
    return resp.make_conditional(request)


SVG = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 700 %d" fill="none" stroke="#2b2a28" '
       'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">%s</svg>\n')


def ink_height(body):
    """The box height ink.js's fit() gives a drawing: 36-unit rows, 4 spare below the lowest stroke."""
    low = max((float(y) for y in re.findall(r"[ML][\d.]+ ([\d.]+)", body)), default=0)
    return max(11, math.ceil(low / 36) + 4) * 36


@app.get("/export.zip")
def export():
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for day, body in get_db().execute("SELECT day, body FROM entries ORDER BY day"):
            z.writestr(f"journal/{day}.md", body)
        for day, body in get_db().execute("SELECT day, body FROM drawings ORDER BY day"):
            z.writestr(f"journal/{day}.svg", SVG % (ink_height(body), smooth(body)))
    buf.seek(0)
    return send_file(buf, mimetype="application/zip", as_attachment=True,
                     download_name=f"journal-{date.today().isoformat()}.zip")


@app.post("/api/inbox")
def inbox():
    # A custom header can't be sent cross-site without a CORS preflight, which we never grant,
    # so other sites can't post here (PUTs are preflighted anyway).
    if "X-Requested-With" not in request.headers:
        abort(403)
    title = request.get_data(as_text=True).strip()
    if not title:
        abort(400)
    data = urllib.parse.urlencode({"title": title}).encode()
    try:
        with urllib.request.urlopen(GTD_URL + "/capture", data, timeout=5):
            pass
    except OSError:
        abort(502)
    return "", 204
