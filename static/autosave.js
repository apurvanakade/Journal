// Versioned autosave, shared by the editor and the drawing box. Saves `delay` ms after the last
// change, one request at a time (a save asked for mid-flight waits for it, so it's based on the new
// version, not a stale one); a 409 offers "load theirs" / "keep mine" (and "merge", if given:
// merge(theirs, base) applies a merge and returns whether it was clean).
// Pulls in edits made elsewhere when the tab comes back.
//   url: where it loads (GET) and saves; get(): the current value; set(body): show a body loaded
//   from the server; saved(value): after a successful save; conflict(): when a conflict is shown;
//   codec: parse(body) turns a server body into a value, same(a, b) compares values, and
//   request(saved, value) gives the { method, body } that saves value over saved.
// The default: the value is the text itself, sent whole.
const whole = { parse: body => body, same: (a, b) => a === b, request: (_, text) => ({ method: "PUT", body: text }) };

export function autosaver({ url, body, version, delay, status, label, get, set, saved: onSaved, conflict: onConflict, merge, codec = whole }) {
  const { parse, same, request } = codec;
  let saved = parse(body), timer = null, inflight = false, again = false, conflict = null, refreshing = false;
  // Values sent whose answer never came (a dropped connection, a suspended tab): the server may
  // have saved them anyway, and then its newer version is our own, not a conflict.
  let unsure = [];

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
    const value = get();
    if (same(value, saved)) return;
    inflight = true;
    status.textContent = "Saving…";
    const { method, body } = request(saved, value);
    // keepalive lets the save outlive the page, but browsers cap all pending keepalive bodies at
    // 64 KB in total; the text and drawing savers get half each.
    const keepalive = new Blob([body]).size < 32000;
    // A request that hangs (iPad Safari can stall one across a suspend) would block every later save.
    const signal = AbortSignal.timeout?.(20000);
    fetch(url, { method, body, keepalive, signal, headers: { "X-Base-Version": version } })
      .then(async r => {
        if (r.status === 409) return showConflict(await r.json());
        if (!r.ok) throw new Error(r.status);
        ({ version } = await r.json());
        saved = value;
        unsure = [];
        status.textContent = "Saved";
        onSaved?.(value);
      })
      .catch(() => { unsure.push(value); status.textContent = "Not saved — retrying"; timer = setTimeout(save, 3000); })
      .finally(() => { inflight = false; if (again) { again = false; save(); } });
  }

  function load(theirs) {
    conflict = null;
    saved = parse(theirs.body);
    version = theirs.version;
    clearTimeout(timer);
    set(theirs.body);
  }

  function showConflict(theirs) {
    const value = parse(theirs.body);
    if (unsure.some(v => same(v, value))) {  // our own lost save: adopt its version and carry on
      unsure = [];
      saved = value;
      version = theirs.version;
      return save();
    }
    conflict = theirs;
    clearTimeout(timer);
    onConflict?.();
    status.innerHTML = `${label} — <button>load theirs</button> · <button>keep mine</button>` +
      (merge ? " · <button>merge</button>" : "");
    const [theirsBtn, mineBtn, mergeBtn] = status.querySelectorAll("button");
    theirsBtn.onclick = () => { load(theirs); status.textContent = "Loaded theirs"; };
    // From here on the server's value is theirs, so the next save is based on (and diffed against) it.
    mineBtn.onclick = () => { conflict = null; version = theirs.version; saved = value; save(); };
    // `saved` is the body at the version this edit was based on: the merge's common base.
    if (mergeBtn) mergeBtn.onclick = () => {
      conflict = null;
      version = theirs.version;
      const base = saved;
      saved = value;
      status.textContent = merge(theirs.body, base) ? "Merged" : "Merged — fix the marked lines";
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
      if (same(get(), saved)) { load(j); status.textContent = "Updated from another device"; }
      else showConflict(j);
    }).catch(() => {}).finally(() => { refreshing = false; });
  }

  addEventListener("pagehide", save);
  addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (document.hidden) save(); else refresh(); });

  return { changed, save, get conflict() { return conflict; } };
}
