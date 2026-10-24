# Journal

A minimalist journal: one Markdown entry per day. `/` opens today's entry; the calendar links to other days (dots mark days with entries; click the month name for a year view). Typing autosaves after 5 seconds of idle (or when you leave the editor or tab); clearing an entry deletes it.

- **Editor** styles Markdown in place (`**bold**`, `*italic*`, `# headings`, `` `code` ``, `[links](…)`, `[[YYYY-MM-DD]]`); like Obsidian's live preview, the `**`/`_`/`[](url)` markers are hidden until the cursor touches them. Each line is a paragraph, with a small gap after it (like LaTeX's `parskip`); consecutive list items stay tight. ⌘/Ctrl-click opens a link. Spelling is checked by the browser's spellchecker, skipping Markdown markers, links, URLs, `[[…]]` and code; the `abc` button by the date turns it off or on (remembered per browser).
- **Conflicts**: saves carry the version they were based on; if another device saved first you choose "load theirs" or "keep mine". Returning to a tab pulls in remote edits.
- **History**: the previous text is snapshotted roughly once per writing session (10-minute gap) — skipped when it differs from the newest snapshot by fewer than 10 words or is itself under 10 words, and earlier snapshots are dropped once a later session has only added to them, so typo fixes and continued writing don't clutter history — and always on big deletions, on clearing, and on conflicts. Restore from `/<day>/history`.
- **Theme**: follows the system light/dark setting; the ◐ button next to search overrides it (remembered per browser).
- **Search** (`/search?q=`, all words must match), **Export** (`/export.zip`, one `YYYY-MM-DD.md` per day — the importer reads it back).
- **Keys** (outside the editor; Esc leaves it): ←/→ previous/next day, `t` today, `/` search. ⌘D (Mac) / Ctrl+D (Linux, Windows) goes to today from anywhere, including the editor.

⌘I (Mac) / Ctrl+I (Linux, Windows) (or the `+` by the date) opens a one-line box that adds a task to the GTD inbox. The server posts it to GTD's `/capture` at `GTD_URL` (default `http://127.0.0.1:5005`, i.e. GTD on the same VM, or `GTD dev` locally).

Flask + SQLite (`entries(day, body, updated_at)`, `revisions(day, body, saved_at)`), hosted on `home` (see `GCP-home-server/NEW-APP.md`) at `https://home.<tailnet>.ts.net:8443`, local port 5006. Config: [deploy/journal.env.example](deploy/journal.env.example).

## Develop

```bash
uv run flask --app app run --debug        # uses ./dev.db
```

## Deploy

```bash
git push home main
```

## Importing from Obsidian

Only files named `YYYY-MM-DD.md` are imported; empty daily templates are skipped. Everything else is copied to the stash dir (`unmigrated/`, gitignored).

```bash
uv run python scripts/import_obsidian.py ../Obsidian/Journal dev.db unmigrated
```
