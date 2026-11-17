// Ink: an optional scribble box under the entry. Pen or mouse draws; fingers scroll the page
// (palm rejection). perfect-freehand turns the pen's points (and Pencil pressure) into the outline
// of a variable-width stroke, stored as a filled SVG <path d="M x y l dx dy …Z"> (see svgPath), so
// the saved body is exactly the page's markup. Autosaved and conflict-checked like the text.
// The box is ruled, and grows (even mid-stroke) to keep SPARE empty lines below the lowest stroke.
// A pen / eraser pill floats in the margin beside the line last written on.
// Expects DAY, DAYS and INK, INK_VERSION from the page.
import { getStroke } from "./vendor/perfect-freehand.js";
import { renderCal } from "./calendar.js";
import { autosaver, hash } from "./autosave.js";
import { getText, inkWords } from "./editor.js";

const box = document.getElementById("ink");
const svg = box.querySelector(".ink-page > svg"), float = box.querySelector(".ink-float");
const W = 700, ROW = 36, MIN_ROWS = 11, SPARE = 6;  // the server's export (SVG, ink_height) uses the same
let H = MIN_ROWS * ROW, tool = "pen", stroke = null, at = ROW / 2;

// A path's outline as absolute [x0, y0, x1, y1, …], parsed once per element.
const parsed = new WeakMap();
function nums(p) {
  if (!parsed.has(p)) {
    const n = p.getAttribute("d").match(/-?[\d.]+/g).map(Number);
    for (let i = 2; i < n.length; i++) n[i] = Math.round((n[i] + n[i - 2]) * 10) / 10;
    parsed.set(p, n);
  }
  return parsed.get(p);
}
function size(rows) {
  if (rows * ROW !== H || !svg.hasAttribute("viewBox")) {  // an unchanged viewBox still re-lays out
    H = rows * ROW;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.style.setProperty("--rows", rows);
  }
  place(at);
}
function fit() {
  let low = 0;
  for (const p of svg.querySelectorAll("path")) nums(p).forEach((n, i) => { if (i % 2) low = Math.max(low, n); });
  size(Math.max(MIN_ROWS, Math.ceil(low / ROW) + SPARE));
  countWords();
}
// A rough handwritten word count: each stroke's bounding box goes on the ruled row holding its
// middle; within a row, strokes taken left to right join the current word while the gap to it is
// under GAP units (i-dots, t-bars and accents overlap their word, so they join it too).
const GAP = 8;  // matched hand counts of two real pages exactly (84 and 70 words)
function countWords() {
  const rows = new Map();
  for (const p of svg.querySelectorAll("path")) {
    const n = nums(p);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < n.length; i += 2) {
      x0 = Math.min(x0, n[i]); x1 = Math.max(x1, n[i]);
      y0 = Math.min(y0, n[i + 1]); y1 = Math.max(y1, n[i + 1]);
    }
    const r = Math.floor((y0 + y1) / 2 / ROW);
    if (!rows.has(r)) rows.set(r, []);
    rows.get(r).push([x0, x1]);
  }
  let words = 0;
  for (const boxes of rows.values()) {
    boxes.sort((a, b) => a[0] - b[0]);
    let right = -Infinity;
    for (const [x0, x1] of boxes) {
      if (x0 > right + GAP) words++;
      right = Math.max(right, x1);
    }
  }
  inkWords(words);
}
// Mid-stroke the box only grows, so the page doesn't jump under the pen.
const grow = y => { if (y > H - SPARE * ROW) size(Math.ceil(y / ROW) + SPARE); };
// The tool pill sits at the middle of the row holding y.
function place(y) {
  at = y;
  float.style.top = ((Math.floor(y / ROW) + 0.5) * ROW / H * 100) + "%";
}

document.getElementById("ink-btn").onclick = () => { box.hidden = !box.hidden; };

const clamp = (n, max) => Math.min(max, Math.max(0, n));
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
// The eraser removes whole strokes whose outline passes within a few units of the pen.
function erase([x, y]) {
  for (const p of svg.querySelectorAll("path")) {
    const n = nums(p);
    for (let i = 2; i < n.length; i += 2)
      if (dist(x, y, n[i - 2], n[i - 1], n[i], n[i + 1]) < 10) { p.remove(); break; }
  }
}

// Ramer–Douglas–Peucker: drop outline points within a tenth of a unit of the line their neighbours
// make, which more than halves the saved size with no visible change.
function simplify(pts) {
  if (pts.length <= 2) return pts;
  const [ax, ay] = pts[0], [bx, by] = pts.at(-1);
  let far = 0, at = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = dist(pts[i][0], pts[i][1], ax, ay, bx, by);
    if (d > far) { far = d; at = i; }
  }
  if (far <= 0.1) return [pts[0], pts.at(-1)];
  return [...simplify(pts.slice(0, at + 1)), ...simplify(pts.slice(at)).slice(1)];
}
// perfect-freehand's thresholds are in pixels (it skips the last 3 of a stroke, for one), too coarse
// for handwriting a few units tall, so it works at SCALE× and the outline is scaled back.
const SCALE = 4;
const FREEHAND = { size: 2.3 * SCALE, thinning: 0.5, smoothing: 0.5, streamline: 0.4 };
// Compact path data: an absolute start, then relative steps in tenths (whole tenths, so no rounding
// drift), without leading zeros or spaces before minus signs: "M25.3 60.2l-.9-2.9-1.3-2.8…Z".
function svgPath(pts) {
  const t = pts.map(p => p.map(n => Math.round(n * 10)));
  const num = n => (n < 0 ? "-" : "") + String(Math.abs(n) / 10).replace(/^0\./, ".");
  let d = "";
  for (let i = 1; i < t.length; i++) {
    const dx = t[i][0] - t[i - 1][0], dy = t[i][1] - t[i - 1][1];
    if (!dx && !dy) continue;
    for (const s of [num(dx), num(dy)]) d += (d && s[0] !== "-" ? " " : "") + s;
  }
  return `M${t[0][0] / 10} ${t[0][1] / 10}` + (d && "l" + d) + "Z";
}
function outline({ pts, pen }, last) {
  const out = getStroke(pts.map(([x, y, p]) => [x * SCALE, y * SCALE, p]),
    { ...FREEHAND, simulatePressure: !pen, last }).map(([x, y]) => [x / SCALE, y / SCALE]);
  return svgPath(last ? simplify(out) : out);
}

svg.innerHTML = INK;
fit();
box.hidden = !INK;
{ const last = svg.querySelector("path:last-of-type"); if (last) place(nums(last).at(-1)); }

const status = document.getElementById("ink-status");
svg.addEventListener("pointerdown", e => {
  // Button 5 is a pen's eraser end (or eraser button), where the hardware has one.
  if (e.pointerType === "touch" || ![0, 5].includes(e.button)) return;
  e.preventDefault();
  // Drawing waits until a conflict is settled; show where, since the status may be off screen.
  if (saver.conflict) {
    status.scrollIntoView({ behavior: "smooth", block: "center" });
    status.classList.remove("flash"); void status.offsetWidth; status.classList.add("flash");
    return;
  }
  if (stroke) end();  // a stroke whose end never arrived
  svg.setPointerCapture(e.pointerId);
  const p = pt(e), id = e.pointerId;
  if (tool === "erase" || e.button === 5) { stroke = { id, erase: true, y: p[1] }; return erase(p); }
  // Mice report a flat 0.5, so their pressure is simulated from speed instead.
  const pen = e.pointerType === "pen";
  stroke = { id, el: document.createElementNS("http://www.w3.org/2000/svg", "path"), pts: [[...p, e.pressure]], pen };
  stroke.el.setAttribute("d", outline(stroke, false));  // a tap leaves a dot
  svg.append(stroke.el);
});
svg.addEventListener("pointermove", e => {
  if (stroke?.id !== e.pointerId) return;
  const all = e.getCoalescedEvents?.();
  for (const c of all?.length ? all : [e]) {
    const p = pt(c);
    if (stroke.erase) { stroke.y = p[1]; erase(p); continue; }
    stroke.pts.push([...p, c.pressure]);
    grow(p[1]);
  }
  if (!stroke.erase) stroke.el.setAttribute("d", outline(stroke, false));
});
function end(e) {
  if (!stroke || e && e.pointerId !== stroke.id) return;
  if (!stroke.erase) {
    stroke.el.setAttribute("d", outline(stroke, true));
    place(stroke.pts.at(-1)[1]);
  } else place(stroke.y);
  stroke = null;
  fit();
  saver.changed();  // an eraser pass that hit nothing changes nothing, and the save is skipped
}
svg.addEventListener("pointerup", end);
svg.addEventListener("pointercancel", end);
// Capture can be lost without a pointerup (WebKit does, at times); left open, the stroke would
// swallow finger scrolling below.
svg.addEventListener("lostpointercapture", end);
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

// The drawing as the list of its strokes' path data (the stroke under way isn't drawn yet). A save
// sends only what changed since the last one: the indices of saved strokes since erased, and the
// strokes drawn since, which are always appended at the end. Resending the whole page (hundreds of
// KB) after every pause in the writing froze the iPad.
// The local backup of unsaved strokes (a page can be several MB, too much for localStorage) is the
// same change, with the erased strokes by hash rather than index, so it can be replayed onto
// whatever the server has by then: erased strokes are removed if still there, and drawn ones are
// appended unless already there (a save that got through without its answer).
// Restored strokes go back in with innerHTML, so like the server it only takes ones matching STROKE.
const STROKE = /^M[-0-9. ]+(l[-0-9. ]+)?Z$/;
function diff(saved, now) {
  const remove = [];
  let j = 0;
  saved.forEach((d, i) => { if (d === now[j]) j++; else remove.push(i); });
  return { remove, add: now.slice(j) };
}
const strokes = {
  parse: body => Array.from(body.matchAll(/ d="([^"]*)"/g), m => m[1]),
  format: value => value.map(d => `<path d="${d}"></path>`).join(""),
  same: (a, b) => a.length === b.length && a.every((d, i) => d === b[i]),
  // A string body goes out as text/plain unless typed, and the server's get_json() refuses that.
  request: (saved, now) => ({ method: "PATCH", body: JSON.stringify(diff(saved, now)), type: "application/json" }),
  pack(saved, now) {
    const { remove, add } = diff(saved, now);
    return { erased: remove.map(i => hash(saved[i])), add };
  },
  unpack({ erased, add }, onto) {
    const gone = new Map();
    for (const h of erased) gone.set(h, (gone.get(h) ?? 0) + 1);
    const kept = !gone.size ? onto : onto.filter(d => {
      const h = hash(d), n = gone.get(h);
      if (n) gone.set(h, n - 1);
      return !n;
    });
    const have = new Set(kept);
    return kept.concat(add.filter(d => typeof d === "string" && STROKE.test(d) && !have.has(d)));
  },
};
// Saved 5 seconds after the last stroke, or when the tab is hidden or closed.
const saver = autosaver({
  url: "/api/drawings/" + DAY, body: INK, version: INK_VERSION, delay: 5000, codec: strokes,
  status: document.getElementById("ink-status"), label: "Drawn on another device",
  get: () => Array.from(svg.children).filter(p => p !== stroke?.el).map(p => p.getAttribute("d")),
  set: body => {
    svg.innerHTML = body;
    fit();
    if (body) box.hidden = false;
  },
  saved: value => {
    if (value.length || getText().trim()) DAYS.add(DAY); else DAYS.delete(DAY);
    renderCal();
  },
  conflict: () => { box.hidden = false; },
});
saver.restore();
