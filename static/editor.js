// Editor: the entry is plain Markdown text, re-rendered with styling as you type.
// Expects DAY, DAYS, renderCal (calendar.js) and BODY, VERSION from the page.

// --- Markdown highlighting. Output text must equal the input exactly; we only wrap it. ---
const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
// Non-prose (markers, URLs, links, code) is excluded from the browser's spellcheck.
const NS = ' spellcheck="false"';
// Markers; `hide` ones are only shown while the caret touches their .fmt element (see reveal()).
const mk = (s, hide) => `<span class="md${hide ? " hide" : ""}"${NS}>${esc(s)}</span>`;
const link = (href, text) =>
  /^(https?:|mailto:|\/)/i.test(href)
    ? `<a href="${esc(href).replace(/"/g, "&quot;")}"${NS}>${esc(text)}</a>`
    : esc(text);

const INLINE = new RegExp([
  /(`+)(.+?)\1/,                                    // 1,2 code
  /\[\[([^\]\n]+)\]\]/,                             // 3 [[2024-01-31]] wiki link
  /\[([^\]\n]+)\]\(([^()\s]+)\)/,                   // 4,5 [text](url)
  /(https?:\/\/[^\s<>]*[^\s<>.,;:!?'")\]])/,         // 6 bare url
  /(?<!\w)(\*\*|__)(?=\S)(.+?)(?<=\S)\7(?!\w)/,      // 7,8 bold
  /(?<!\w)(\*|_)(?=\S)(.+?)(?<=\S)\9(?!\w)/,         // 9,10 italic
  /~~(?=\S)(.+?)(?<=\S)~~/,                         // 11 strikethrough
].map(r => r.source).join("|"), "g");

function inline(s) {
  let out = "", i = 0;
  for (const m of s.matchAll(INLINE)) {
    out += esc(s.slice(i, m.index));
    i = m.index + m[0].length;
    if (m[1]) out += `<code class="fmt"${NS}>${mk(m[1], 1)}${esc(m[2])}${mk(m[1], 1)}</code>`;
    else if (m[3]) {
      const day = m[3].match(/^\d{4}-\d{2}-\d{2}/);
      out += `<span class="fmt"${NS}>${mk("[[", 1)}${day ? link("/" + day[0], m[3]) : esc(m[3])}${mk("]]", 1)}</span>`;
    }
    else if (m[4]) out += `<span class="fmt">${mk("[", 1)}${link(m[5], m[4])}${mk(`](${m[5]})`, 1)}</span>`;
    else if (m[6]) out += link(m[6], m[6]);
    else if (m[7]) out += `<b class="fmt">${mk(m[7], 1)}${inline(m[8])}${mk(m[7], 1)}</b>`;
    else if (m[9]) out += `<i class="fmt">${mk(m[9], 1)}${inline(m[10])}${mk(m[9], 1)}</i>`;
    else out += `<s class="fmt">${mk("~~", 1)}${inline(m[11])}${mk("~~", 1)}</s>`;
  }
  return out + esc(s.slice(i));
}

const ITEM = /^(\s*(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?)(.*)/;

function lineHtml(line) {
  let m;
  if ((m = line.match(/^(#{1,6} )(.*)/))) return `<span class="fmt h h${m[1].length - 1}">${mk(m[1], 1)}${inline(m[2])}</span>`;
  if (/^ {0,3}([-*_])( ?\1){2,}\s*$/.test(line)) return mk(line);
  if ((m = line.match(ITEM))) return mk(m[1]) + inline(m[2]);
  if ((m = line.match(/^(>+ ?)(.*)/))) return `<span class="quote">${mk(m[1])}${inline(m[2])}</span>`;
  return inline(line);
}

// Each non-empty line outside code is a paragraph (.p) with a gap below it, parskip-style;
// list items stay tight (.li) except the last of a run. The "\n"s stay outside the wrappers.
function markdown(text) {
  let fence = false;
  const lines = text.split("\n");
  return lines.map((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return `<span class="md code-line"${NS}>${esc(line)}</span>`; }
    if (fence) return `<span class="code-line"${NS}>${esc(line)}</span>`;
    if (!line) return "";
    const tight = ITEM.test(line) && i + 1 < lines.length && ITEM.test(lines[i + 1]);
    return `<span class="${tight ? "li" : "p"}">${lineHtml(line)}</span>`;
  }).join("\n");
}

// --- Text and caret as plain-text offsets ---
const ed = document.getElementById("ed");
const getText = () => ed.textContent;

function offsetOf(node, off) {
  const r = document.createRange();
  r.selectNodeContents(ed);
  r.setEnd(node, off);
  return r.toString().length;
}
function getSel() {
  const s = getSelection();
  if (!s.rangeCount || !ed.contains(s.anchorNode)) return null;
  const r = s.getRangeAt(0);
  return [offsetOf(r.startContainer, r.startOffset), offsetOf(r.endContainer, r.endOffset)];
}
function pointAt(n) {
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT);
  for (let node; (node = w.nextNode()); n -= node.length) if (n <= node.length) return [node, n];
  return [ed, 0];
}
function setSel([a, b]) {
  const r = document.createRange();
  r.setStart(...pointAt(a));
  r.setEnd(...pointAt(b));
  getSelection().removeAllRanges();
  getSelection().addRange(r);
}

// Trailing <br> keeps a final empty line visible; it isn't part of textContent.
function paint(text, sel) {
  const html = markdown(text) + "<br>";
  ed.classList.toggle("empty", !text);
  // Plain typing usually leaves the DOM already correct (ignoring reveal()'s class).
  if (ed.innerHTML.replace(/ md-on"/g, '"') === html) return;
  ed.innerHTML = html;
  if (sel) setSel(sel);
  reveal();
}

// Show hidden markers of formatting the caret/selection touches, like Obsidian's live preview.
// Hidden text still counts in textContent and caret offsets, so nothing else changes.
function reveal() {
  const sel = getSel();
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n; (n = w.nextNode()); ) {
    if (n.nodeType === Node.TEXT_NODE) pos += n.length;
    else if (n.classList.contains("fmt"))
      n.classList.toggle("md-on", !!sel && pos <= sel[1] && pos + n.textContent.length >= sel[0]);
  }
}
document.addEventListener("selectionchange", reveal);

// --- Undo history (re-rendering clears the browser's own) ---
const hist = [{ text: BODY, sel: [BODY.length, BODY.length] }];
let hi = 0, lastEdit = 0, groupStart = 0;
function record(text, sel) {
  if (text === hist[hi].text) return;
  hist.length = hi + 1;
  const now = Date.now();
  // Merge keystrokes into one undo step until a pause or ~2s of continuous typing.
  if (hi > 0 && now - lastEdit < 1000 && now - groupStart < 2000) hist[hi] = { text, sel };
  else { hist.push({ text, sel }); hi++; groupStart = now; }
  if (hist.length > 500) { hist.shift(); hi--; }
  lastEdit = now;
}
function step(d) {
  if (!hist[hi + d]) return;
  hi += d;
  lastEdit = 0;
  paint(hist[hi].text, hist[hi].sel);
  changed(hist[hi].text);
}

function edited() {
  const text = getText(), sel = getSel();
  paint(text, sel);
  record(text, sel);
  changed(text);
}
function insert(s) {
  const t = getText(), [a, b] = getSel() ?? [t.length, t.length];
  const text = t.slice(0, a) + s + t.slice(b);
  paint(text, [a + s.length, a + s.length]);
  record(text, [a + s.length, a + s.length]);
  changed(text);
}

let composing = false;
ed.addEventListener("compositionstart", () => { composing = true; });
ed.addEventListener("compositionend", () => { composing = false; edited(); });
ed.addEventListener("input", () => { if (!composing) edited(); });
ed.addEventListener("beforeinput", e => {
  const t = e.inputType;
  if (t === "historyUndo" || t === "historyRedo") { e.preventDefault(); step(t === "historyUndo" ? -1 : 1); }
  else if (t === "insertParagraph" || t === "insertLineBreak") { e.preventDefault(); insert("\n"); }
});
ed.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
  else if (e.ctrlKey && k === "y") { e.preventDefault(); step(1); }
  else if (e.key === "Escape") ed.blur();
});

// Links: ⌘/Ctrl-click to open (a plain tap on touch screens); a plain click just places the caret.
const touch = matchMedia("(pointer: coarse)");
ed.addEventListener("click", e => {
  const a = e.target.closest("a");
  if (!a || !(e.metaKey || e.ctrlKey || touch.matches)) return;
  e.preventDefault();
  if (a.getAttribute("href").startsWith("/")) location.href = a.href;
  else window.open(a.href, "_blank", "noopener");
});
const mod = e => document.body.classList.toggle("mod", e.metaKey || e.ctrlKey);
addEventListener("keydown", mod);
addEventListener("keyup", mod);
addEventListener("blur", () => document.body.classList.remove("mod"));

// --- Word count, autosave, conflicts ---
const status = document.getElementById("status");
const wordsEl = document.getElementById("words");
let saved = BODY, version = VERSION, timer = null, inflight = false, again = false, conflict = null;

function changed(text) {
  const n = text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  wordsEl.textContent = n ? `${n} word${n === 1 ? "" : "s"}` : "";
  if (conflict) return;
  status.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(save, 5000);
}

function save(keepalive = false, overwrite = false) {
  clearTimeout(timer);
  const text = getText();
  if (conflict || text === saved) return;
  if (inflight && !keepalive) { again = true; return; }
  inflight = true;
  status.textContent = "Saving…";
  fetch("/api/entries/" + DAY + (overwrite ? "?overwrite" : ""), {
    method: "PUT", body: text, keepalive, headers: { "X-Base-Version": version },
  })
    .then(async r => {
      if (r.status === 409) return showConflict(await r.json());
      if (!r.ok) throw new Error(r.status);
      ({ version } = await r.json());
      saved = text;
      status.textContent = "Saved";
      if (text.trim()) DAYS.add(DAY); else DAYS.delete(DAY);
      renderCal();
    })
    .catch(() => { status.textContent = "Not saved — retrying"; timer = setTimeout(save, 3000); })
    .finally(() => { inflight = false; if (again) { again = false; save(); } });
}

function load({ body, version: v }) {
  conflict = null;
  saved = body;
  version = v;
  paint(body, document.activeElement === ed ? [body.length, body.length] : null);
  record(body, [body.length, body.length]);
  changed(body);
  clearTimeout(timer);
}

function showConflict(theirs) {
  conflict = theirs;
  clearTimeout(timer);
  status.innerHTML = "Edited on another device — <button id=theirs>load theirs</button> · <button id=mine>keep mine</button>";
  document.getElementById("theirs").onclick = () => {
    load(theirs);
    status.textContent = "Loaded (yours is in History)";
  };
  document.getElementById("mine").onclick = () => {
    conflict = null;
    version = theirs.version;
    save(false, true);
  };
}

// Pick up edits made elsewhere when coming back to this tab.
function refresh() {
  if (conflict || inflight || document.hidden) return;
  fetch("/api/entries/" + DAY).then(r => r.json()).then(j => {
    if (j.version === version) return;
    if (getText() === saved) { load(j); status.textContent = "Updated from another device"; }
    else showConflict(j);
  }).catch(() => {});
}

ed.addEventListener("blur", () => save());
addEventListener("pagehide", () => save(true));
addEventListener("pageshow", e => { if (e.persisted) refresh(); });
addEventListener("focus", refresh);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(true); else refresh(); });

// Spellcheck toggle (remembered per browser). Re-rendering makes the browser drop or redo its underlines.
const spellBtn = document.getElementById("spell-btn");
function setSpell(on) {
  ed.spellcheck = on;
  spellBtn.classList.toggle("off", !on);
  spellBtn.setAttribute("aria-pressed", on);
}
spellBtn.onclick = () => {
  const on = !ed.spellcheck;
  try { localStorage.spellcheck = on ? "on" : "off"; } catch (e) {}
  setSpell(on);
  const text = getText(), sel = getSel();
  ed.innerHTML = "";
  paint(text, sel);
  ed.focus();
};

// GTD inbox capture: ⌘I (Mac) / Ctrl+I (Linux, Windows) or the + button
const dlg = document.getElementById("inbox");
const inp = dlg.querySelector("input");
function openInbox() { inp.value = ""; dlg.showModal(); }
const btn = document.getElementById("inbox-btn");
btn.title += /Mac|iPhone|iPad/.test(navigator.platform) ? " (⌘I)" : " (Ctrl+I)";
btn.onclick = openInbox;
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") { e.preventDefault(); openInbox(); }
});
dlg.querySelector("form").addEventListener("submit", () => {
  const title = inp.value.trim();
  if (!title) return;
  status.textContent = "Adding to inbox…";
  fetch("/api/inbox", { method: "POST", body: title })
    .then(r => { if (!r.ok) throw new Error(r.status); status.textContent = "Added to inbox"; })
    .catch(() => { status.textContent = "Inbox add failed"; inp.value = title; dlg.showModal(); });
});
dlg.addEventListener("close", () => ed.focus());

let spellOn = true;
try { spellOn = localStorage.spellcheck !== "off"; } catch (e) {}
setSpell(spellOn);
paint(BODY);
changed(BODY);
clearTimeout(timer);
ed.focus();
setSel([BODY.length, BODY.length]);
