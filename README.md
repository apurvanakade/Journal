# Journal

A minimalist journal: one plain-text entry per day. `/` opens today's entry; the calendar links to other days (dots mark days with entries). Typing autosaves; clearing an entry deletes it.

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
