// Calendar (month view, or year view when the title is clicked) and page-level shortcuts.
// Expects DAY, SEL, TODAY, DAYS from the page.
const pad = n => String(n).padStart(2, "0");
let [y, m] = DAY.split("-").map(Number);
let yearView = false;

export function renderCal() {
  const grid = document.getElementById("grid");
  const title = document.getElementById("month");
  grid.innerHTML = "";
  grid.classList.toggle("months", yearView);
  if (yearView) {
    title.textContent = y;
    for (let i = 1; i <= 12; i++) {
      const key = `${y}-${pad(i)}`;
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = new Date(y, i - 1).toLocaleString("en-US", { month: "short" });
      if ([...DAYS].some(d => d.startsWith(key))) a.classList.add("has");
      if (TODAY.startsWith(key)) a.classList.add("today");
      if (SEL.startsWith(key)) a.classList.add("sel");
      a.onclick = e => { e.preventDefault(); m = i; yearView = false; renderCal(); };
      grid.append(a);
    }
    return;
  }
  title.textContent = new Date(y, m - 1).toLocaleString("en-US", { month: "long", year: "numeric" });
  grid.innerHTML = ["S", "M", "T", "W", "T", "F", "S"].map(d => `<div class="dow">${d}</div>`).join("");
  const first = new Date(y, m - 1, 1).getDay();
  const n = new Date(y, m, 0).getDate();
  for (let i = 0; i < first; i++) grid.append(document.createElement("div"));
  for (let d = 1; d <= n; d++) {
    const iso = `${y}-${pad(m)}-${pad(d)}`;
    const a = document.createElement("a");
    a.href = "/" + iso;
    a.textContent = d;
    if (DAYS.has(iso)) a.classList.add("has");
    if (iso === TODAY) a.classList.add("today");
    if (iso === SEL) a.classList.add("sel");
    grid.append(a);
  }
}
document.getElementById("prev").onclick = () => {
  if (yearView) y--; else if (--m < 1) { m = 12; y--; }
  renderCal();
};
document.getElementById("next").onclick = () => {
  if (yearView) y++; else if (++m > 12) { m = 1; y++; }
  renderCal();
};
document.getElementById("month").onclick = () => { yearView = !yearView; renderCal(); };
renderCal();

// Shortcuts when not typing: ←/→ previous/next day, t today, / search.
document.addEventListener("keydown", e => {
  if (e.target.closest("input, [contenteditable]") || e.metaKey || e.ctrlKey || e.altKey) return;
  const go = id => { const a = document.getElementById(id); if (a) location.href = a.href; };
  if (e.key === "ArrowLeft") go("prev-day");
  else if (e.key === "ArrowRight") go("next-day");
  else if (e.key === "t") location.href = "/";
  else if (e.key === "/") { e.preventDefault(); document.getElementById("q").focus(); }
});

// ⌘D (Mac) / Ctrl+D (Linux, Windows): today, even while typing
const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
document.addEventListener("keydown", e => {
  if ((isMac ? e.metaKey : e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "d") {
    e.preventDefault();
    location.href = "/";
  }
});
