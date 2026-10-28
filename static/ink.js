// Ink: an optional scribble box under the entry. Pen or mouse draws; fingers scroll the page
// (palm rejection). Stored as bare SVG <path>s, autosaved and conflict-checked like the text.
// The box is ruled, and grows to keep a few empty lines below the lowest stroke.
// Expects DAY, DAYS and INK, INK_VERSION from the page.
import { renderCal } from "./calendar.js";
import { autosaver } from "./autosave.js";
import { getText } from "./editor.js";

const box = document.getElementById("ink");
const svg = box.querySelector("svg");
const W = 700, ROW = 36, MIN_ROWS = 11;  // the server's export (SVG, ink_height) uses the same
let H = MIN_ROWS * ROW, tool = "pen", stroke = null, undos = [];
const snapshot = () => { if (undos.push(svg.innerHTML) > 100) undos.shift(); };

// A path's points as [x0, y0, x1, y1, …], parsed once per element.
const parsed = new WeakMap();
function nums(p) {
  if (!parsed.has(p)) parsed.set(p, p.getAttribute("d").match(/[\d.]+/g).map(Number));
  return parsed.get(p);
}
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

// Whole units: about a CSS pixel at full width, and a third smaller to store than tenths.
const clamp = (n, max) => Math.round(Math.min(max, Math.max(0, n)));
function pt(e) {
  const r = svg.getBoundingClientRect();
  return [clamp((e.clientX - r.left) * W / r.width, W), clamp((e.clientY - r.top) * H / r.height, H)];
}

// Distance from (x, y) to the segment a–b.
function dist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len)) : 0;
  return Math.hypot(ax + t * dx - x, ay + t * dy - y);
}
// The eraser removes whole strokes that pass within a few units of the pen.
function erase([x, y]) {
  for (const p of svg.querySelectorAll("path")) {
    const n = nums(p);
    for (let i = 2; i < n.length; i += 2)
      if (dist(x, y, n[i - 2], n[i - 1], n[i], n[i + 1]) < 10) { p.remove(); break; }
  }
}

// Ramer–Douglas–Peucker: drop points within half a unit of the line their neighbours make.
function simplify(pts) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts.at(-1);
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > far) { far = d; at = i; }
  }
  if (far <= 0.5) return [pts[0], pts.at(-1)];
  return [...simplify(pts.slice(0, at + 1)), ...simplify(pts.slice(at)).slice(1)];
}
const pathData = pts => "M" + pts.map(p => p.join(" ")).join("L");

svg.addEventListener("pointerdown", e => {
  if (e.pointerType === "touch" || e.button !== 0 || saver.conflict) return;
  e.preventDefault();
  svg.setPointerCapture(e.pointerId);
  snapshot();
  const p = pt(e);
  if (tool === "erase") { stroke = "erase"; return erase(p); }
  stroke = { el: document.createElementNS("http://www.w3.org/2000/svg", "path"), pts: [p] };
  stroke.d = `M${p[0]} ${p[1]}`;
  stroke.el.setAttribute("d", stroke.d + `L${p[0]} ${p[1]}`);  // a tap leaves a dot
  svg.append(stroke.el);
});
svg.addEventListener("pointermove", e => {
  if (!stroke) return;
  const all = e.getCoalescedEvents?.();
  for (const c of all?.length ? all : [e]) {
    const p = pt(c);
    if (stroke === "erase") { erase(p); continue; }
    const [lx, ly] = stroke.pts.at(-1);
    if (Math.hypot(p[0] - lx, p[1] - ly) < 1) continue;  // finer than we store
    stroke.pts.push(p);
    stroke.d += `L${p[0]} ${p[1]}`;
  }
  if (stroke !== "erase") stroke.el.setAttribute("d", stroke.d);
});
function end() {
  if (!stroke) return;
  if (stroke !== "erase") {
    const pts = simplify(stroke.pts);
    stroke.el.setAttribute("d", pathData(pts.length > 1 ? pts : [pts[0], pts[0]]));
  }
  stroke = null;
  if (svg.innerHTML === undos.at(-1)) undos.pop();  // an eraser pass that hit nothing
  else { fit(); saver.changed(); }
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

for (const b of box.querySelectorAll("[data-tool]")) b.onclick = () => {
  tool = b.dataset.tool;
  box.querySelectorAll("[data-tool]").forEach(x => x.classList.toggle("on", x === b));
  box.classList.toggle("erase", tool === "erase");
};
document.getElementById("ink-undo").onclick = () => {
  if (!undos.length || saver.conflict) return;
  svg.innerHTML = undos.pop();
  fit();
  saver.changed();
};
document.getElementById("ink-clear").onclick = () => {
  if (!svg.innerHTML || saver.conflict) return;
  snapshot();
  svg.innerHTML = "";
  fit();
  saver.changed();
};

// Saved a second after the last stroke, so little is left unsaved if the page goes away.
const saver = autosaver({
  url: "/api/drawings/" + DAY, body: INK, version: INK_VERSION, delay: 1000,
  status: document.getElementById("ink-status"), label: "Drawn on another device",
  get: () => svg.innerHTML,
  set: body => {
    svg.innerHTML = body;
    fit();
    undos = [];
    if (body) box.hidden = false;
  },
  saved: body => {
    if (body || getText().trim()) DAYS.add(DAY); else DAYS.delete(DAY);
    renderCal();
  },
  conflict: () => { box.hidden = false; },
});
