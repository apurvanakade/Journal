# Journal

A minimalist journal: one plain-text entry per day. `/` opens today's entry; the calendar links to other days (dots mark days with entries). Typing autosaves; clearing an entry deletes it.

⌘I (Mac) / Ctrl+I (Linux, Windows) (or the `+` by the date) opens a one-line box that adds a task to the GTD inbox. The server posts it to GTD's `/capture` at `GTD_URL` (default `http://127.0.0.1:5005`, i.e. GTD on the same VM, or `GTD dev` locally).

Flask + SQLite (`entries(day, body, updated_at)`), hosted on `home` (see `GCP-home-server/NEW-APP.md`) at `https://home.<tailnet>.ts.net:8443`, local port 5006. Config: [deploy/journal.env.example](deploy/journal.env.example).

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
