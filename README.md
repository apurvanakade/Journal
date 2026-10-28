# Journal

A minimalist journal: one Markdown entry per day. `/` opens today's entry; the calendar links to other days (dots mark days with entries; click the month name for a year view). Typing autosaves after 5 seconds of idle (or when you leave the editor or tab); clearing an entry deletes it.

- **Editor** styles Markdown in place (`**bold**`, `*italic*`, `# headings`, `` `code` ``, `[links](…)`, `[[YYYY-MM-DD]]`, `---` as a horizontal rule); like Obsidian's live preview, the `**`/`_`/`[](url)`/`---` markers are hidden until the cursor touches them. Each line is a paragraph, with a small gap after it (like LaTeX's `parskip`); consecutive list items stay tight. ⌘/Ctrl-click opens a link. Spelling is checked by the browser's spellchecker, skipping Markdown markers, links, URLs, `[[…]]` and code; the `abc` button by the date turns it off or on (remembered per browser).
- **Typing assists** (desktop browsers only; iPad, iPhone and Android keyboards already do this natively, so they're left alone): sentence starts are capitalized, `i`/`i'm` become `I`/`I'm`, and names you've capitalized mid-sentence on at least two days (counting entries from `JOURNAL_NAMES_SINCE`, default 2026-10-26, on) are capitalized when you finish the word. A faint completion of the word you're typing, from your own most-used words, appears after the cursor; Tab accepts it, Esc dismisses it, and anything else simply carries on. Nothing is changed in code or URLs. Backspace straight after a capitalized word puts it back as typed (and leaves that word alone for the rest of the visit); deleting an auto-capital and retyping it lowercase keeps it lowercase.
- **Drawing box**: the ✎ button by the date shows a box under the entry for occasional scribbles (it opens by itself on days that have one). It's ruled, and grows as you write, keeping a few empty lines below your lowest stroke. Draw with Apple Pencil or a mouse; fingers scroll the page instead of drawing, and a palm resting during a stroke leaves no marks. Strokes are drawn as smooth curves (older drawings too) but stored as plain points, simplified when you lift the pen, so a full page of handwriting is roughly 100–200 KB. The eraser removes whole strokes; undo and clear (undoable) are next to it. It autosaves 1 second after the last stroke, its own "load theirs" / "keep mine" choice covers conflicts, and a day with only a drawing still gets a calendar dot.
- **Conflicts**: saves carry the version they were based on; if another device saved first you choose "load theirs", "keep mine" (the other text is discarded), or "merge", which puts both into the editor with git-style `<<<<<<< mine` / `=======` / `>>>>>>> theirs` markers around the lines that differ for you to tidy up. Returning to a tab pulls in remote edits.
- **Theme**: follows the system light/dark setting; the ◐ button next to search overrides it (remembered per browser).
- **Search** (`/search?q=`, all words must match, case-insensitive including accented letters), **Export** (`/export.zip`, one `YYYY-MM-DD.md` per day plus `YYYY-MM-DD.svg` for drawings; the importer reads both back).
- **Timestamps:** in the editor, Alt+T (Option+T on Mac) inserts `**09:05 am.** `; Alt+Shift+T inserts a `## 09:05 am.` heading on its own line.
- **Keys** (outside the editor; Esc leaves it): ←/→ previous/next day, `t` today, `/` search. ⌘D (Mac) / Ctrl+D (Linux, Windows) goes to today from anywhere, including the editor.

⌘I (Mac) / Ctrl+I (Linux, Windows) (or the `+` by the date) opens a one-line box that posts a task to `GTD_URL` + `/capture` (default `http://127.0.0.1:5005`). This is optional — point it at any endpoint that accepts a `title` form field (e.g. your own task inbox), or leave it as-is with nothing listening there and the button will just fail with a 502.

Flask + SQLite (`entries(day, body, updated_at)`, `drawings(day, body, updated_at)`) — a single process, no external services or cloud platform required. Config: [deploy/journal.env.example](deploy/journal.env.example).

## Develop

```bash
uv run flask --app app run --debug        # uses ./dev.db
```

## Deploy

Runs anywhere Python runs. Copy [deploy/journal.env.example](deploy/journal.env.example), set `JOURNAL_DB` to a writable path and `TZ` to your timezone, then run the `CMD` under any process manager (systemd, supervisor, …) behind whatever reverse proxy you use for TLS. The author's own deploy is `git push home main` to a bare repo whose post-receive hook reruns gunicorn — one option among many, not required.

## Importing from Obsidian

Only files named `YYYY-MM-DD.md` (and `YYYY-MM-DD.svg` drawings from an export) are imported; empty daily templates and days already in the DB are skipped, so nothing is overwritten. Everything else is copied to the stash dir (`unmigrated/`, gitignored).

```bash
uv run python scripts/import_obsidian.py ../Obsidian/Journal dev.db unmigrated
```
