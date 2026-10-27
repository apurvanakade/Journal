// Ink: an optional scribble box under the entry. Pen or mouse draws; fingers scroll the page
// (palm rejection). Stored as bare SVG <path>s, autosaved and conflict-checked like the text.
// The box is ruled, and grows to keep a few empty lines below the lowest stroke.
// Expects DAY, DAYS, renderCal, getText (editor.js) and INK, INK_VERSION from the page.
{
const box = document.getElementById("ink");
const svg = box.querySelector("svg");
const note = document.getElementById("ink-status");
const W = 700, ROW = 36, MIN_ROWS = 11;  // the server's export (SVG, ink_height) uses the same
let H = MIN_ROWS * ROW, saved = INK, version = INK_VERSION, timer = null, busy = false, conflict = null;
let tool = "pen", stroke = null, undos = [];

const nums = p => p.getAttribute("d").match(/[\d.]+/g).map(Number);
function fit() {
  let low = 0;
  for (const p of svg.querySelectorAll("path")) nums(p).forEach((n, i) => { if (i % 2) low = Math.max(low, n); });
  const rows = Math.max(MIN_ROWS, Math.ceil(low / ROW) + 4);
  H = rows * ROW;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.setProperty("--rows", rows);
}

svg.innerHTML = INK;
fit();
box.hidden = !INK;
document.getElementById("ink-btn").onclick = () => { box.hidden = !box.hidden; };

const clamp = (n, max) => Math.round(Math.min(max, Math.max(0, n)) * 10) / 10;
function pt(e) {
  const r = svg.getBoundingClientRect();
  return [clamp((e.clientX - r.left) * W / r.width, W), clamp((e.clientY - r.top) * H / r.height, H)];
}

// The eraser removes whole strokes that pass within a few units of the pen.
function near(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y) < 10;
}
function erase([x, y]) {
  for (const p of svg.querySelectorAll("path")) {
    const n = nums(p);
    for (let i = 2; i < n.length; i += 2)
      if (near(x, y, n[i - 2], n[i - 1], n[i], n[i + 1])) { p.remove(); break; }
  }
}

svg.addEventListener("pointerdown", e => {
  if (e.pointerType === "touch" || conflict) return;
  e.preventDefault();
  svg.setPointerCapture(e.pointerId);
  undos.push(svg.innerHTML);
  const [x, y] = pt(e);
  if (tool === "erase") { stroke = "erase"; return erase([x, y]); }
  stroke = document.createElementNS("http://www.w3.org/2000/svg", "path");
  stroke.setAttribute("d", `M${x} ${y}L${x} ${y}`);  // a tap leaves a dot
  svg.append(stroke);
});
svg.addEventListener("pointermove", e => {
  if (!stroke) return;
  const all = e.getCoalescedEvents?.();
  for (const c of all?.length ? all : [e]) {
    const [x, y] = pt(c);
    if (stroke === "erase") erase([x, y]);
    else stroke.setAttribute("d", stroke.getAttribute("d") + `L${x} ${y}`);
  }
});
function end() {
  if (!stroke) return;
  stroke = null;
  if (svg.innerHTML === undos.at(-1)) undos.pop();  // an eraser pass that hit nothing
  else { fit(); changed(); }
}
svg.addEventListener("pointerup", end);
svg.addEventListener("pointercancel", end);
// iPadOS still sends touch events for the Pencil; unless they're cancelled, Safari may take a stroke
// over as a scroll, drag-and-drop or text selection and cancel the pointer mid-line. Finger touches
// are left alone so they scroll the page, unless a stroke is under way (a resting palm).
const pen = e => stroke || [...e.touches].some(t => t.touchType === "stylus");
for (const t of ["touchstart", "touchmove"])
  svg.addEventListener(t, e => { if (pen(e)) e.preventDefault(); }, { passive: false });
svg.addEventListener("dragstart", e => e.preventDefault());
document.addEventListener("selectstart", e => { if (stroke) e.preventDefault(); });

function setTool(t) {
  tool = t;
  box.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x.dataset.tool === t));
  box.classList.toggle("erase", t === "erase");
}
for (const b of box.querySelectorAll("[data-tool]")) b.onclick = () => setTool(b.dataset.tool);
// Alt/Option+E swaps pen and eraser (by code, since Option+E is a dead key on a Mac).
document.addEventListener("keydown", e => {
  if (!e.altKey || e.metaKey || e.ctrlKey || e.code !== "KeyE" || box.hidden) return;
  e.preventDefault();
  setTool(tool === "pen" ? "erase" : "pen");
});
document.getElementById("ink-undo").onclick = () => {
  if (!undos.length || conflict) return;
  svg.innerHTML = undos.pop();
  fit();
  changed();
};
document.getElementById("ink-clear").onclick = () => {
  if (!svg.innerHTML || conflict) return;
  undos.push(svg.innerHTML);
  svg.innerHTML = "";
  fit();
  changed();
};

function changed() {
  note.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(save, 2000);
}

function save(keepalive = false) {
  clearTimeout(timer);
  const body = svg.innerHTML;
  if (conflict || busy || body === saved) return;
  busy = true;
  note.textContent = "Saving…";
  fetch("/api/drawings/" + DAY, {
    method: "PUT", body, keepalive, headers: { "X-Base-Version": version },
  })
    .then(async r => {
      if (r.status === 409) return showConflict(await r.json());
      if (!r.ok) throw new Error(r.status);
      ({ version } = await r.json());
      saved = body;
      note.textContent = "Saved";
      if (body || getText().trim()) DAYS.add(DAY); else DAYS.delete(DAY);
      renderCal();
    })
    .catch(() => { note.textContent = "Not saved — retrying"; timer = setTimeout(save, 3000); })
    .finally(() => { busy = false; if (!conflict && svg.innerHTML !== saved) changed(); });
}

function load(theirs) {
  conflict = null;
  svg.innerHTML = saved = theirs.body;
  fit();
  version = theirs.version;
  undos = [];
  if (saved) box.hidden = false;
}

function showConflict(theirs) {
  conflict = theirs;
  clearTimeout(timer);
  box.hidden = false;
  note.innerHTML = "Drawn on another device — <button id=ink-theirs>load theirs</button> · <button id=ink-mine>keep mine</button>";
  document.getElementById("ink-theirs").onclick = () => { load(theirs); note.textContent = "Loaded theirs"; };
  document.getElementById("ink-mine").onclick = () => { conflict = null; version = theirs.version; save(); };
}

function refresh() {
  if (conflict || busy || document.hidden) return;
  fetch("/api/drawings/" + DAY).then(r => r.json()).then(j => {
    if (j.version === version) return;
    if (svg.innerHTML === saved) { load(j); note.textContent = "Updated from another device"; }
    else showConflict(j);
  }).catch(() => {});
}

addEventListener("pagehide", () => save(true));
addEventListener("pageshow", e => { if (e.persisted) refresh(); });
addEventListener("focus", refresh);
document.addEventListener("visibilitychange", () => { if (document.hidden) save(true); else refresh(); });
}
