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

- **[app.py](app.py)** is the whole backend. Schema lives in the `SCHEMA` string and is applied (`CREATE IF NOT EXISTS`) on every `connect()`; there are no migrations. Tables: `entries(day PK, body, updated_at)` and `revisions(day, body, saved_at)`. A blank body deletes the entry.
- **Optimistic concurrency:** `entries.updated_at` doubles as the version. The client sends `X-Base-Version` on `PUT /api/entries/<day>`; a mismatch returns 409 with the server's text, and the rejected text is archived into `revisions` so nothing is lost. The save runs inside `BEGIN IMMEDIATE`.
- **Revision snapshots** are taken only at session boundaries, not every autosave: when the previous save is older than `SESSION_GAP` (10 min) *and* the old text differs from the newest revision by at least `MIN_CHANGED_WORDS` (10, word-level `difflib`; comparing against the newest snapshot rather than the previous one means small edits accumulate until they cross the threshold), when the body shrinks by more than half or is cleared, or with `?overwrite`. At each session boundary `needs_snapshot` first deletes newest revisions whose words all survive, in order, in the text ending the session (append-only sessions) or that are under `MIN_CHANGED_WORDS` words, and never snapshots text that short; this is decided at the *end* of the session that extended them, never mid-session, so a later deletion in that session can't lose them. Restoring from `/<day>/history` archives the current text first.
- **Templates:** [templates/base.html](templates/base.html) holds the sidebar (search, calendar, export) and injects `DAY`, `SEL`, `TODAY`, `DAYS` as JS globals; every page view must pass `days=all_days(db)` and `today=...` for it. Pages extend it via `{% block main %}` / `{% block scripts %}`.
- **Frontend** ([static/](static/)): `calendar.js` renders the sidebar calendar from `DAYS`. `editor.js` is a `contenteditable` editor that re-renders Markdown highlighting on every keystroke — the rendered HTML's `textContent` must equal the raw text exactly (markup only wraps, never adds/removes characters), because caret positions are tracked as plain-text offsets. Each non-empty line is wrapped in a full-width inline-block (`.p`, with a bottom margin for parskip-style gaps, or `.li` for tight list items); the `\n` separators stay outside those wrappers. Non-prose spans (markers, links, code) carry `spellcheck="false"` so the browser's native spellcheck skips them; the `abc` toggle sets `ed.spellcheck` (stored in `localStorage.spellcheck`) and forces a re-render so the browser redraws its underlines. Since re-rendering wipes native undo, the editor keeps its own undo history. It also handles autosave (5 s idle debounce, flushed on editor blur, `pagehide` and tab hide), conflict UI, and refreshing on tab focus.
- **Theme:** colors are CSS variables in `style.css`. The ◐ button next to search sets `data-theme` on `<html>` and stores it in `localStorage`, overriding `prefers-color-scheme` (dark values are duplicated under the media query and `[data-theme="dark"]`); a tiny script in `<head>` applies it before first paint. Same scheme as GTD.
- **Search** is `LIKE`-based (all terms must match, wildcards escaped); `/export.zip` dumps every entry as `journal/<day>.md`.
- **GTD capture:** `POST /api/inbox` forwards a one-line title to `GTD_URL` + `/capture` (⌘I / Ctrl+I or the `+` button on the entry page).
- `unmigrated/` (gitignored) holds Obsidian files the importer couldn't map to a `YYYY-MM-DD.md` day.

## Keeping docs current

Whenever a change adds, removes, or alters a feature, route, keyboard shortcut, env var, schema, or command, update [README.md](README.md) (user-facing behaviour) and this file (architecture and invariants) in the same change. Check that both still match the code before you finish.
