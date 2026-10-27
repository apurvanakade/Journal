# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Minimalist one-entry-per-day journal: Flask + SQLite, no build step, no JS framework, no test suite.

## Commands

```bash
uv run flask --app app run --debug        # dev server, uses ./dev.db (override with JOURNAL_DB)
uv run python scripts/import_obsidian.py ../Obsidian/Journal dev.db unmigrated   # Obsidian import
git push home main                        # deploy
```

Production runs under gunicorn on the `home` server (port 5006, single worker + threads); config in [deploy/journal.env.example](deploy/journal.env.example). `TZ` matters: "today" and displayed times use server-local time, while stored timestamps are UTC.

## Architecture

- **[app.py](app.py)** is the whole backend. Schema lives in the `SCHEMA` string and is applied (`CREATE IF NOT EXISTS`) on every `connect()`; there are no migrations. Two tables with the same shape: `entries(day PK, body, updated_at)` and `drawings` (body = bare SVG `<path>`s). A blank body deletes the row; `all_days()` unions both, so drawing-only days get a calendar dot.
- **Optimistic concurrency:** `entries.updated_at` doubles as the version. The client sends `X-Base-Version` on `PUT /api/<entries|drawings>/<day>`; a mismatch returns 409 with the server's text (unless the bodies are identical, e.g. a duplicate save, which just succeeds) and the client asks the user to load theirs, keep mine, or merge (`merge()` in `editor.js` wraps the differing middle lines, after trimming shared leading/trailing lines, in git-style markers; no common base, so it's not a 3-way merge). The save runs inside `BEGIN IMMEDIATE`.
- **Ink** ([static/ink.js](static/ink.js), wrapped in a block so its names don't collide with `editor.js`): an `<svg>` under the editor, 700 units wide, ruled in 36-unit rows by a CSS background (`--rows`); `fit()` sets the viewBox height to 4 rows below the lowest stroke (min 11), mirrored by `ink_height()` in `app.py` for export. Pen/mouse pointer events append `<path d="M…L…">`s; touch pointers are ignored (palm rejection). `touchstart`/`touchmove` are cancelled for Pencil touches or during a stroke, else iPad Safari turns strokes into scrolls, drags or text selections; other finger touches scroll (`touch-action: pan-y`). Alt+E toggles pen/eraser (matched on `e.code`). The `svg.innerHTML` *is* the saved body, and is put back with `innerHTML`, so `PUT /api/drawings/<day>` rejects anything not matching `INK` in `app.py`. Same versioned save/409/refresh logic as the editor (2 s debounce, own status span, load theirs / keep mine, no merge). Undo is a stack of `innerHTML` snapshots. Export wraps bodies in the `SVG` template (keep `W`/`ROW`/`MIN_ROWS` in sync with `ink_height()`).
- **Templates:** [templates/base.html](templates/base.html) holds the sidebar (search, calendar, export) and injects `DAY`, `SEL`, `TODAY`, `DAYS` as JS globals; every page view must pass `days=all_days(db)` and `today=...` for it. Pages extend it via `{% block main %}` / `{% block scripts %}`.
- **Frontend** ([static/](static/)): `calendar.js` renders the sidebar calendar from `DAYS`. `editor.js` is a `contenteditable` editor that re-renders Markdown highlighting on every keystroke — the rendered HTML's `textContent` must equal the raw text exactly (markup only wraps, never adds/removes characters), because caret positions are tracked as plain-text offsets. Each non-empty line is wrapped in a full-width inline-block (`.p`, with a bottom margin for parskip-style gaps, or `.li` for tight list items); the `\n` separators stay outside those wrappers. Non-prose spans (markers, links, code) carry `spellcheck="false"` so the browser's native spellcheck skips them; the `abc` toggle sets `ed.spellcheck` (stored in `localStorage.spellcheck`) and forces a re-render so the browser redraws its underlines. Since re-rendering wipes native undo, the editor keeps its own undo history. It also handles autosave (5 s idle debounce, flushed on editor blur, `pagehide` and tab hide), conflict UI, and refreshing on tab focus.
- **Typing assists** (in `editor.js`, off on iOS/iPadOS/Android, whose keyboards do it natively; detected by UA, or Mac platform + touch points for iPadOS): `assistType()` runs in `beforeinput` and capitalizes sentence starts / `i` / learned names by inserting via `insert(s, back)` itself; `revert()` undoes the last fix on an immediate Backspace. Completion is a `position: fixed` `.ghost` span appended to `<body>` (never inside `#ed`, so `textContent` stays exact), placed at the caret rect; Tab accepts. `GET /api/words` (`vocabulary()` in `app.py`, cached on `count(*), max(updated_at)`) returns `words` (lowercase, ≥5 letters, seen ≥2×, by frequency) and `proper` (lowercase → form, capitalized mid-sentence on ≥2 days since `NAMES_SINCE` and rarely lowercase; headings and table-ish lines don't count).
- **Timestamps:** Alt/Option+T inserts `**HH:MM am.** `, Alt+Shift+T a `## HH:MM am.` heading line (keydown in `editor.js`, matched on `e.code` because Option+T types `†` on Mac; ⌘/Ctrl+T would be Chrome's new tab).
- **Theme:** colors are CSS variables in `style.css`. The ◐ button next to search sets `data-theme` on `<html>` and stores it in `localStorage`, overriding `prefers-color-scheme` (dark values are duplicated under the media query and `[data-theme="dark"]`); a tiny script in `<head>` applies it before first paint. Same scheme as GTD.
- **Search** is `LIKE`-based (all terms must match, wildcards escaped); `/export.zip` dumps every entry as `journal/<day>.md`.
- **GTD capture:** `POST /api/inbox` forwards a one-line title to `GTD_URL` + `/capture` (⌘I / Ctrl+I or the `+` button on the entry page).
- `unmigrated/` (gitignored) holds Obsidian files the importer couldn't map to a `YYYY-MM-DD.md` day.

## Keeping docs current

Whenever a change adds, removes, or alters a feature, route, keyboard shortcut, env var, schema, or command, update [README.md](README.md) (user-facing behaviour) and this file (architecture and invariants) in the same change. Check that both still match the code before you finish.
