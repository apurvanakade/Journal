// Editor: the entry is plain Markdown text, re-rendered with styling as you type.
// Expects DAY, DAYS and BODY, VERSION from the page.
import { renderCal } from "./calendar.js";
import { autosaver } from "./autosave.js";

// --- Markdown highlighting. Output text must equal the input exactly; we only wrap it. ---
// Escaped the way the browser serializes text (&nbsp; included), so paint() can compare innerHTML.
const esc = s => s.replace(/[&<>\u00a0]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\u00a0": "&nbsp;" })[c]);
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
  // Rule: a full-width line; the marker text stays in place (transparent) so the caret can land on it.
  if (/^ {0,3}([-*_])( ?\1){2,}\s*$/.test(line)) return `<span class="fmt hr">${mk(line)}</span>`;
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
export const getText = () => ed.textContent;

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
function reveal(sel = getSel()) {
  const w = document.createTreeWalker(ed, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let pos = 0;
  for (let n; (n = w.nextNode()); ) {
    if (n.nodeType === Node.TEXT_NODE) pos += n.length;
    else if (n.classList.contains("fmt"))
      n.classList.toggle("md-on", !!sel && pos <= sel[1] && pos + n.textContent.length >= sel[0]);
  }
}

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
// Replace the whole text (a load from the server, or a merge) as its own undo step.
function replace(text) {
  const end = [text.length, text.length];
  paint(text, document.activeElement === ed ? end : null);
  lastEdit = 0;
  record(text, end);
  count(text);
}

function edited() {
  const text = getText(), sel = getSel();
  paint(text, sel);
  record(text, sel);
  changed(text);
}
function apply(text, caret) {
  paint(text, [caret, caret]);
  record(text, [caret, caret]);
  changed(text);
}
// Insert s at the selection, also replacing the `back` characters before it.
function insert(s, back = 0) {
  const t = getText(), [a, b] = getSel() ?? [t.length, t.length];
  apply(t.slice(0, a - back) + s + t.slice(b), a - back + s.length);
}

// --- Typing assists: sentence capitals, "i" → "I", names you capitalize, word completion (Tab). ---
// Touch keyboards (iOS and iPadOS, even with a hardware keyboard, and Android) already do all of
// this natively, so there we stay out of the way.
const assist = !(/iPhone|iPad|iPod|Android/.test(navigator.userAgent) ||
  (/Mac/.test(navigator.platform) && navigator.maxTouchPoints > 1));
let vocab = [], proper = {};   // /api/words: lowercase words by frequency; lowercase → "Name"
if (assist) fetch("/api/words").then(r => r.json()).then(d => { vocab = d.words; proper = d.proper; }).catch(() => {});
const declined = new Set();    // words whose fix you reverted; left alone for the rest of the visit
let fix = null, noCapAt = -1;  // last fix (Backspace right after reverts it); where you deleted a capital

// Code blocks, inline code and URLs are left alone.
function plain(before) {
  const line = before.slice(before.lastIndexOf("\n") + 1);
  return (before.match(/^\s*(```|~~~)/gm) || []).length % 2 === 0 &&
    (line.match(/`/g) || []).length % 2 === 0 && !/(:\/\/|www\.)\S*$/.test(line);
}
function sentenceStart(before) {
  const line = before.slice(before.lastIndexOf("\n") + 1).replace(/^(#{1,6} |\s*(?:[-*+]|\d+[.)]) (?:\[[ xX]\] )?|>+ ?)/, "");
  return /^["'“‘(*_]*$/.test(line) ||
    /(?<!\b(?:e\.g|i\.e|vs|cf|etc|[ap]\.m)|\.\.)[.!?]["'”’)\]*_]*\s+["'“‘(*_]*$/.test(line);
}

// Called for each typed character; returns true if it inserted c itself.
function assistType(c) {
  const last = fix;
  fix = null;
  if (!assist || composing || !c) return false;
  const t = getText(), sel = getSel();
  if (!sel || sel[0] !== sel[1]) return false;
  const a = sel[0], before = t.slice(0, a);
  if (!plain(before)) return false;
  if (/^\p{Ll}$/u.test(c)) {
    if (a === noCapAt) { noCapAt = -1; return false; }  // you deleted the capital: keep it lowercase
    if (!sentenceStart(before) || /[\p{L}\p{N}]/u.test(t[a] || "")) return false;
    insert(c.toUpperCase());
    fix = { cap: true, at: a, caret: a + 1 };
    return true;
  }
  if (!/^[\s.,;:!?)\]"'”’]$/.test(c)) return false;
  const m = before.match(/(?:^|[\s(\["“‘*_~>])([\p{L}'’]+)$/u);
  const w = m?.[1];
  if (!w || w !== w.toLowerCase() || declined.has(w)) return false;
  let to = null;
  if (/^i(['’](m|ll|ve|d))?$/.test(w)) to = "I" + w.slice(1);
  else if (!/['’]/.test(c)) {
    const [, base, s] = w.match(/^(.*?)((?:['’]s)?)$/);
    if (proper[base]) to = proper[base] + s;
  }
  if (!to) return false;
  insert(to + c, w.length);
  fix = { at: a - w.length, from: w, to, caret: a + 1 };
  return true;
}
// Backspace straight after a fix: a capitalized word goes back to how you typed it;
// a capitalized sentence start is deleted as usual, and retyping it lowercase sticks.
function revert(last) {
  const sel = getSel();
  if (!last || !sel || sel[0] !== sel[1] || sel[0] !== last.caret) return false;
  if (last.cap) { noCapAt = last.at; return false; }
  const t = getText();
  declined.add(last.from);
  apply(t.slice(0, last.at) + last.from + t.slice(last.at + last.to.length), last.caret);
  return true;
}

// Completion: the most frequent known word starting with the 3+ letters before the caret,
// shown faintly after it. Tab accepts; anything else ignores it.
const ghost = document.createElement("span");
ghost.className = "ghost";
ghost.hidden = true;
document.body.append(ghost);
let hint = "", hintAt = -1;
function unhint() { hint = ""; hintAt = -1; ghost.hidden = true; }
function suggest() {
  unhint();
  const sel = getSel();
  if (!assist || !vocab.length || composing || !sel || sel[0] !== sel[1]) return;
  const t = getText(), a = sel[0], before = t.slice(0, a);
  if (/[\p{L}\p{N}]/u.test(t[a] || "") || !plain(before)) return;
  const p = before.match(/(?:^|[^\p{L}\p{N}'’])(\p{L}{3,})$/u)?.[1];
  if (!p) return;
  const lp = p.toLowerCase(), w = vocab.find(w => w.length >= p.length + 2 && w.startsWith(lp));
  if (!w) return;
  const [node, off] = pointAt(a), r = document.createRange();
  r.setStart(node, off);
  const rect = r.getClientRects()[0] ?? r.getBoundingClientRect();
  if (!rect.height) return;
  const cs = getComputedStyle(node.nodeType === Node.TEXT_NODE ? node.parentElement : node);
  Object.assign(ghost.style, {
    left: rect.left + "px", top: rect.top + "px", lineHeight: rect.height + "px",
    fontFamily: cs.fontFamily, fontSize: cs.fontSize, fontWeight: cs.fontWeight, fontStyle: cs.fontStyle,
  });
  hint = (proper[w] ?? w).slice(p.length);
  hintAt = a;
  ghost.textContent = hint;
  ghost.hidden = false;
}
document.addEventListener("selectionchange", () => {
  const sel = getSel();
  reveal(sel);
  if (hint && sel?.[0] !== hintAt) unhint();
  if (fix && sel?.[0] !== fix.caret) fix = null;
});
ed.addEventListener("blur", unhint);
addEventListener("scroll", unhint, true);
addEventListener("resize", unhint);

let composing = false;
ed.addEventListener("compositionstart", () => { composing = true; unhint(); });
ed.addEventListener("compositionend", () => { composing = false; edited(); });
ed.addEventListener("input", e => {
  if (composing) return;
  edited();
  if (e.inputType === "insertText") suggest();
});
ed.addEventListener("beforeinput", e => {
  const t = e.inputType, last = fix;
  if (t !== "insertText") fix = null;
  if (t === "historyUndo" || t === "historyRedo") { e.preventDefault(); step(t === "historyUndo" ? -1 : 1); }
  else if (t === "insertParagraph" || t === "insertLineBreak") { e.preventDefault(); if (!assistType("\n")) insert("\n"); fix = null; }
  else if (t === "deleteContentBackward") { if (revert(last)) e.preventDefault(); }
  else if (t === "insertText" && assistType(e.data)) { e.preventDefault(); suggest(); }
});
ed.addEventListener("keydown", e => {
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === "z") { e.preventDefault(); step(e.shiftKey ? 1 : -1); }
  else if (e.ctrlKey && k === "y") { e.preventDefault(); step(1); }
  else if (e.key === "Tab" && hint && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
    e.preventDefault();
    const s = hint;
    unhint();
    insert(s);
  }
  else if (e.key === "Escape") { if (hint) unhint(); else ed.blur(); }
  // Alt/Option+T: "**09:05 am.** "; with Shift, a "## 09:05 am." heading on its own line.
  // By code, not key, since Option+T types "†" on a Mac.
  else if (e.altKey && !e.metaKey && !e.ctrlKey && e.code === "KeyT") {
    e.preventDefault();
    unhint();
    const d = new Date(), h = d.getHours();
    const now = `${String(h % 12 || 12).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")} ${h < 12 ? "am" : "pm"}.`;
    if (!e.shiftKey) return insert(`**${now}** `);
    const t = getText(), a = (getSel() ?? [t.length])[0];
    insert(`${a && t[a - 1] !== "\n" ? "\n" : ""}## ${now}\n`);
  }
});

// Links: ⌘/Ctrl-click to open (a plain tap on touch screens); a plain click just places the caret.
const touch = matchMedia("(pointer: coarse)");
ed.addEventListener("click", e => {
  const a = e.target.closest("a");
  if (!a || !(e.metaKey || e.ctrlKey || touch.matches)) return;
  e.preventDefault();
  if (a.origin === location.origin) location.href = a.href;
  else window.open(a.href, "_blank", "noopener");
});
const mod = e => document.body.classList.toggle("mod", e.metaKey || e.ctrlKey);
addEventListener("keydown", mod);
addEventListener("keyup", mod);
addEventListener("blur", () => document.body.classList.remove("mod"));

// --- Word count, autosave, conflicts ---
const status = document.getElementById("status");
const wordsEl = document.getElementById("words");
const saver = autosaver({
  url: "/api/entries/" + DAY, body: BODY, version: VERSION, delay: 5000,
  status, label: "Edited on another device",
  get: getText, set: replace,
  saved: text => {
    if (text.trim()) DAYS.add(DAY); else if (!document.querySelector("#ink path")) DAYS.delete(DAY);
    renderCal();
  },
  merge: theirs => {
    replace(merge(getText(), theirs));
    saver.changed();
  },
});

function count(text) {
  const n = text.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  wordsEl.textContent = n ? `${n} word${n === 1 ? "" : "s"}` : "";
}
function changed(text) {
  count(text);
  saver.changed();
}

// Git-style conflict markers around the lines that differ (shared leading/trailing lines kept once).
function merge(mine, theirs) {
  const a = mine.split("\n"), b = theirs.split("\n");
  let p = 0, s = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p++;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
  return [
    ...a.slice(0, p),
    "<<<<<<< mine", ...a.slice(p, a.length - s),
    "=======", ...b.slice(p, b.length - s),
    ">>>>>>> theirs", ...a.slice(a.length - s),
  ].join("\n");
}

ed.addEventListener("blur", saver.save);

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
  fetch("/api/inbox", { method: "POST", body: title, headers: { "X-Requested-With": "fetch" } })
    .then(r => { if (!r.ok) throw new Error(r.status); status.textContent = "Added to inbox"; })
    .catch(() => { status.textContent = "Inbox add failed"; inp.value = title; dlg.showModal(); });
});
dlg.addEventListener("close", () => ed.focus());

let spellOn = true;
try { spellOn = localStorage.spellcheck !== "off"; } catch (e) {}
setSpell(spellOn);
paint(BODY);
count(BODY);
ed.focus();
setSel([BODY.length, BODY.length]);
