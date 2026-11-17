// Versioned autosave, shared by the editor and the drawing box. Saves `delay` ms after the last
// change, one request at a time (a save asked for mid-flight waits for it, so it's based on the new
// version, not a stale one); a 409 offers "load theirs" / "keep mine" (and "merge", if given:
// merge(theirs, base) applies a merge and returns whether it was clean).
// Pulls in edits made elsewhere when the tab comes back.
// Until the server has acknowledged a value, it is also backed up in localStorage (see backup()), so
// a refresh, a closed or killed tab, or saves failing for days can't lose it; restore(), called once
// the page has shown the server's body, puts it back and saves it through the same versioned path.
//   url: where it loads (GET) and saves; get(): the current value; set(body): show a body (from the
//   server, or a restored backup); saved(value): after a successful save; conflict(): when a
//   conflict is shown;
//   codec: parse(body) turns a server body into a value, format(value) back into a body, same(a, b)
//   compares values, request(saved, value) gives the { method, body, type } that saves value over
//   saved (type, if given, is its Content-Type), pack(saved, value) a JSON-able backup of value
//   (it may be relative to saved), and unpack(packed, onto) the value back, given the server's
//   current value (saved itself, unless another device or a lost save has moved it on since).
// The default: the value is the text itself, sent and backed up whole.
const whole = {
  parse: body => body, format: text => text, same: (a, b) => a === b,
  request: (_, text) => ({ method: "PUT", body: text }), pack: (_, text) => text, unpack: text => text,
};

// cyrb53: a 53-bit string hash, to recognize a value sent earlier (maybe by a previous page load)
// without keeping a copy of it.
export function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
const fingerprint = v => hash(typeof v === "string" ? v : JSON.stringify(v));

// A backup is written this long after the last change (and at once on a send, a failure, or the
// tab being hidden or closed).
const BACKUP_DELAY = 1000;

export function autosaver({ url, body, version, delay, status, label, get, set, saved: onSaved, conflict: onConflict, merge, codec = whole }) {
  const { parse, format, same, request, pack, unpack } = codec;
  let saved = parse(body), timer = null, inflight = false, again = false, conflict = null, refreshing = false;
  // Values sent whose answer never came (a dropped connection, a suspended tab), as fingerprints: the
  // server may have saved them anyway, and then its newer version is our own, not a conflict.
  // `pending` is the one in flight.
  let unsure = [], pending = null;
  const KEY = "draft:" + url;
  // note: "Restored unsaved changes", shown until the restored value's first save answers.
  let backupTimer = null, backupFailed = false, note = null;

  function changed() {
    clearTimeout(backupTimer);
    backupTimer = setTimeout(backup, BACKUP_DELAY);
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
    pending = fingerprint(value);
    status.textContent = note ? `${note} — saving…` : "Saving…";
    backup();
    const { method, body, type } = request(saved, value);
    // keepalive lets the save outlive the page, but browsers cap all pending keepalive bodies at
    // 64 KB in total; the text and drawing savers get half each.
    const keepalive = new Blob([body]).size < 32000;
    // A request that hangs (iPad Safari can stall one across a suspend) would block every later save.
    const signal = AbortSignal.timeout?.(20000);
    const headers = { "X-Base-Version": version, ...(type && { "Content-Type": type }) };
    fetch(url, { method, body, keepalive, signal, headers })
      .then(async r => {
        if (r.status === 409) { pending = null; return showConflict(await r.json()); }
        if (!r.ok) throw new Error(r.status);
        ({ version } = await r.json());
        saved = value;
        unsure = [];
        pending = null;
        backup();  // drops the backup, unless there were more changes meanwhile
        status.textContent = "Saved";
        note = null;
        onSaved?.(value);
      })
      .catch(e => {
        note = null;
        if (pending !== null) unsure.push(pending);
        pending = null;
        backup();
        // A status code means the server refused the save, not that the connection dropped: say so.
        const why = /^\d+$/.test(e.message) ? ` (error ${e.message})` : "";
        status.textContent = `Not saved${why}${backupFailed ? ", not backed up" : ""} — retrying`;
        timer = setTimeout(save, 3000);
      })
      .finally(() => { inflight = false; if (again) { again = false; save(); } });
  }

  // Keep localStorage's copy in step: the current value, with what it's based on (the version and,
  // for a merge, the body at that version), and what was sent without an answer; none once the
  // server has the value. A failure (private mode, quota) leaves saving alone and is only reported.
  function backup() {
    clearTimeout(backupTimer);
    const value = get();
    if (same(value, saved)) return forget();
    const sent = pending === null ? unsure : [...unsure, pending];
    try {
      localStorage.setItem(KEY, JSON.stringify({ version, value: pack(saved, value), ...(merge && { base: saved }), sent }));
      backupFailed = false;
    } catch (e) {
      backupFailed = true;
      if (!conflict && !inflight) status.textContent = "Not backed up on this device";
    }
  }
  function forget() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  // On page load: put back a backup the server doesn't have. Still based on the server's version,
  // it's a plain save; otherwise it goes through showConflict (where a lost save of our own is
  // recognized by its fingerprint and adopted), never overwriting another device's edit unasked.
  function restore() {
    let r = null;
    try { r = JSON.parse(localStorage.getItem(KEY)); } catch (e) {}
    if (!r || typeof r !== "object" || !("value" in r)) return;
    let mine;
    try { mine = unpack(r.value, saved); } catch (e) { return; }  // unreadable: left for inspection
    if (same(mine, saved)) return forget();  // the server has it already
    unsure = Array.isArray(r.sent) ? r.sent : [];
    set(format(mine));
    note = "Restored unsaved changes";
    if (r.version === version) return save();
    // Until it's settled, mine stays based on the backup's version (and so does its backup, so a
    // reload asks again rather than saving over theirs).
    const theirs = { body, version };
    version = r.version;
    if (merge && typeof r.base === "string") saved = parse(r.base);  // the merge's common base
    showConflict(theirs, `${note} · ${label}`);
  }

  function load(theirs) {
    conflict = null;
    note = null;
    saved = parse(theirs.body);
    version = theirs.version;
    clearTimeout(timer);
    set(theirs.body);
    backup();
  }

  function showConflict(theirs, text = label) {
    const value = parse(theirs.body);
    if (unsure.includes(fingerprint(value))) {  // our own lost save: adopt its version and carry on
      unsure = [];
      saved = value;
      version = theirs.version;
      return save();
    }
    conflict = theirs;
    note = null;  // the conflict's own status (text) says it was restored
    clearTimeout(timer);
    backup();
    onConflict?.();
    status.innerHTML = `${text} — <button>load theirs</button> · <button>keep mine</button>` +
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
      backup();
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

  // Leaving: send what's unsaved, and back it up in case the send doesn't make it (one already in
  // flight makes this one wait, and the page may be gone by then).
  function flush() { save(); backup(); }
  addEventListener("pagehide", flush);
  addEventListener("pageshow", e => { if (e.persisted) refresh(); });
  addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); else refresh(); });

  return { changed, save, restore, get conflict() { return conflict; } };
}
