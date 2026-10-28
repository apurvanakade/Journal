// Versioned autosave, shared by the editor and the drawing box. Saves `delay` ms after the last
// change, one request at a time (a save asked for mid-flight waits for it, so it's based on the new
// version, not a stale one); a 409 offers "load theirs" / "keep mine" (and "merge", if given).
// Pulls in edits made elsewhere when the tab comes back.
//   url: GET/PUT endpoint; get(): current body; set(body): show a body loaded from the server;
//   saved(body): after a successful save; conflict(): when a conflict is shown.
export function autosaver({ url, body, version, delay, status, label, get, set, saved: onSaved, conflict: onConflict, merge }) {
  let saved = body, timer = null, inflight = false, again = false, conflict = null, refreshing = false;

  function changed() {
    if (conflict) return;
    status.textContent = "";
    clearTimeout(timer);
    timer = setTimeout(save, delay);
  }

  function save() {
    clearTimeout(timer);
    if (conflict) return;
    if (inflight) { again = true; return; }
    const text = get();
    if (text === saved) return;
    inflight = true;
    status.textContent = "Saving…";
    // keepalive lets the save outlive the page, but browsers cap all pending keepalive bodies at
    // 64 KB in total; the text and drawing savers get half each.
    const keepalive = new Blob([text]).size < 32000;
    fetch(url, { method: "PUT", body: text, keepalive, headers: { "X-Base-Version": version } })
      .then(async r => {
        if (r.status === 409) return showConflict(await r.json());
        if (!r.ok) throw new Error(r.status);
        ({ version } = await r.json());
        saved = text;
        status.textContent = "Saved";
        onSaved?.(text);
      })
      .catch(() => { status.textContent = "Not saved — retrying"; timer = setTimeout(save, 3000); })
      .finally(() => { inflight = false; if (again) { again = false; save(); } });
  }

  function load(theirs) {
    conflict = null;
    saved = theirs.body;
    version = theirs.version;
    clearTimeout(timer);
    set(theirs.body);
  }

  function showConflict(theirs) {
    conflict = theirs;
    clearTimeout(timer);
    onConflict?.();
    status.innerHTML = `${label} — <button>load theirs</button> · <button>keep mine</button>` +
      (merge ? " · <button>merge</button>" : "");
    const [theirsBtn, mineBtn, mergeBtn] = status.querySelectorAll("button");
    theirsBtn.onclick = () => { load(theirs); status.textContent = "Loaded theirs"; };
    mineBtn.onclick = () => { conflict = null; version = theirs.version; save(); };
    if (mergeBtn) mergeBtn.onclick = () => {
      conflict = null;
      version = theirs.version;
      merge(theirs.body);
      status.textContent = "Merged — fix the marked lines";
    };
  }

  // Focus and visibilitychange both fire on coming back; one request is enough. A save that starts
  // or finishes while it's out makes its answer stale, so it's dropped.
  function refresh() {
    if (conflict || inflight || refreshing || document.hidden) return;
    refreshing = true;
    const v = version;
    fetch(url).then(r => r.json()).then(j => {
      if (conflict || inflight || version !== v || j.version === v) return;
      if (get() === saved) { load(j); status.textContent = "Updated from another device"; }
      else showConflict(j);
    }).catch(() => {}).finally(() => { refreshing = false; });
  }

  addEventListener("pagehide", save);
  addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); else refresh(); });

  return { changed, save, get conflict() { return conflict; } };
}
