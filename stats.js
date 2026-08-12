// Stats — weekly time plot of tasks completed.
//
// Source: the persistent "plan-stats" map { "<YYYY-MM-DD>": completedCount },
// written by the planner whenever a day's completed set changes. We bucket those
// daily counts into work weeks (Mon-start) and plot one line.

const STATS_KEY = "plan-stats";
const INBOX_KEY = "plan-inbox";
const SVGNS = "http://www.w3.org/2000/svg";

// Palette (single series — the title names it, so no legend).
const C = {
  line: "#3a6ea5",
  grid: "#e7e7e2",
  axis: "#c9c9c2",
  ink: "#1c1c1a",
  muted: "#6b6b66",
  surface: "#ffffff",
};

// --- Date helpers ------------------------------------------------------------
function atMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function keyOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function dateFromKey(k) {
  return new Date(k + "T00:00:00");
}
function mondayOf(d) {
  const x = atMidnight(d);
  const g = (x.getDay() + 6) % 7; // 0 = Monday
  return addDays(x, -g);
}
function fmtWeek(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtDay(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// --- Build weekly buckets ----------------------------------------------------
function weeklySeries() {
  const stats = JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
  const dayKeys = Object.keys(stats).filter((k) => stats[k] > 0);
  if (dayKeys.length === 0) return [];

  const byWeek = {};
  dayKeys.forEach((k) => {
    const wk = keyOf(mondayOf(dateFromKey(k)));
    byWeek[wk] = (byWeek[wk] || 0) + stats[k];
  });

  // Fill every week from first to last so gaps read as zero.
  const weekKeys = Object.keys(byWeek).sort();
  let cur = dateFromKey(weekKeys[0]);
  const end = dateFromKey(weekKeys[weekKeys.length - 1]);
  const series = [];
  while (cur <= end) {
    const wk = keyOf(cur);
    series.push({ week: cur, count: byWeek[wk] || 0 });
    cur = addDays(cur, 7);
  }
  return series;
}

// --- Render ------------------------------------------------------------------
const chartEl = document.getElementById("chart");
const tableBody = document.querySelector("#statsTable tbody");

function render() {
  const series = weeklySeries();

  // Table fallback (always populated).
  tableBody.innerHTML = "";
  series.forEach((p) => {
    const tr = document.createElement("tr");
    const wk = document.createElement("td");
    wk.textContent = fmtWeek(p.week);
    const ct = document.createElement("td");
    ct.textContent = p.count;
    tr.appendChild(wk);
    tr.appendChild(ct);
    tableBody.appendChild(tr);
  });

  if (series.length === 0) {
    chartEl.innerHTML =
      '<p class="chart-empty">No completed tasks yet. Finish some tasks on the ' +
      "planner and they'll show up here by week.</p>";
    return;
  }

  drawChart(series);
}

function drawChart(series) {
  const W = 720;
  const H = 340;
  const M = { top: 24, right: 28, bottom: 44, left: 40 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  const maxCount = Math.max(1, ...series.map((p) => p.count));
  const yMax = niceCeil(maxCount);

  const n = series.length;
  const xFor = (i) => (n === 1 ? M.left + pw / 2 : M.left + (pw * i) / (n - 1));
  const yFor = (v) => M.top + ph - (ph * v) / yMax;

  chartEl.innerHTML = "";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Line chart of tasks completed per week");

  // Y gridlines + labels.
  const ticks = yTicks(yMax);
  ticks.forEach((t) => {
    const y = yFor(t);
    const line = el("line", {
      x1: M.left, y1: y, x2: W - M.right, y2: y,
      stroke: t === 0 ? C.axis : C.grid, "stroke-width": 1,
    });
    svg.appendChild(line);
    svg.appendChild(
      text(M.left - 8, y + 4, t, { fill: C.muted, "text-anchor": "end", "font-size": 12 })
    );
  });

  // X labels (thin out if crowded).
  const step = Math.ceil(n / 8);
  series.forEach((p, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    svg.appendChild(
      text(xFor(i), H - M.bottom + 20, fmtWeek(p.week), {
        fill: C.muted, "text-anchor": "middle", "font-size": 12,
      })
    );
  });

  // The line.
  const dPath = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.count)}`)
    .join(" ");
  svg.appendChild(
    el("path", { d: dPath, fill: "none", stroke: C.line, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round" })
  );

  // Markers.
  series.forEach((p, i) => {
    svg.appendChild(
      el("circle", { cx: xFor(i), cy: yFor(p.count), r: 4,
        fill: C.surface, stroke: C.line, "stroke-width": 2 })
    );
  });

  // --- Hover layer: crosshair + tooltip ---
  const crosshair = el("line", {
    y1: M.top, y2: M.top + ph, stroke: C.axis, "stroke-width": 1,
    "stroke-dasharray": "4 3", opacity: 0,
  });
  const focus = el("circle", { r: 5.5, fill: C.line, stroke: C.surface,
    "stroke-width": 2, opacity: 0 });
  svg.appendChild(crosshair);
  svg.appendChild(focus);

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.style.opacity = 0;
  chartEl.appendChild(tip);

  const hit = el("rect", { x: M.left, y: M.top, width: pw, height: ph,
    fill: "transparent" });
  svg.appendChild(hit);

  function move(evt) {
    const pt = svgPoint(svg, evt);
    let i = n === 1 ? 0 : Math.round(((pt.x - M.left) / pw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = series[i];
    const x = xFor(i);
    const y = yFor(p.count);

    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.setAttribute("opacity", 1);
    focus.setAttribute("cx", x);
    focus.setAttribute("cy", y);
    focus.setAttribute("opacity", 1);

    tip.style.opacity = 1;
    tip.innerHTML =
      `<strong>${p.count}</strong> completed<br><span>Week of ${fmtWeek(p.week)}</span>`;
    // Position tooltip relative to the chart container.
    const rect = chartEl.getBoundingClientRect();
    const px = (x / W) * rect.width;
    const py = (y / H) * rect.height;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
  }
  function leave() {
    crosshair.setAttribute("opacity", 0);
    focus.setAttribute("opacity", 0);
    tip.style.opacity = 0;
  }
  hit.addEventListener("mousemove", move);
  hit.addEventListener("mouseleave", leave);

  chartEl.appendChild(svg);
}

// --- Inbox size: one reading per day, plotted over time ----------------------
// Source: the "plan-inbox" map { "<YYYY-MM-DD>": inboxSize }, written to
// Firestore meta/inbox by the PlannerAudit generator (~5 PM daily) and hydrated
// into localStorage by store.js. Gaps aren't zero-filled — a missing day means
// "no reading taken", not "an empty inbox" — so we only plot recorded days.
function dailyInboxSeries() {
  const m = JSON.parse(localStorage.getItem(INBOX_KEY) || "{}");
  return Object.keys(m)
    .filter((k) => Number.isFinite(Number(m[k])))
    .sort()
    .map((k) => ({ day: dateFromKey(k), count: Number(m[k]) }));
}

const inboxChartEl = document.getElementById("inboxChart");
const inboxTableBody = document.querySelector("#inboxTable tbody");

function renderInbox() {
  const series = dailyInboxSeries();

  // Table fallback (always populated).
  inboxTableBody.innerHTML = "";
  series.forEach((p) => {
    const tr = document.createElement("tr");
    const d = document.createElement("td");
    d.textContent = fmtDay(p.day);
    const c = document.createElement("td");
    c.textContent = p.count;
    tr.appendChild(d);
    tr.appendChild(c);
    inboxTableBody.appendChild(tr);
  });

  if (series.length === 0) {
    inboxChartEl.innerHTML =
      '<p class="chart-empty">No inbox readings yet. The daily PlannerAudit task ' +
      "records your inbox size around 5 PM; check back after it runs.</p>";
    return;
  }

  drawInboxChart(series);
}

function drawInboxChart(series) {
  const W = 720;
  const H = 340;
  const M = { top: 24, right: 28, bottom: 44, left: 44 };
  const pw = W - M.left - M.right;
  const ph = H - M.top - M.bottom;

  const maxCount = Math.max(1, ...series.map((p) => p.count));
  const yMax = niceCeil(maxCount);

  const n = series.length;
  const xFor = (i) => (n === 1 ? M.left + pw / 2 : M.left + (pw * i) / (n - 1));
  const yFor = (v) => M.top + ph - (ph * v) / yMax;

  inboxChartEl.innerHTML = "";
  const svg = document.createElementNS(SVGNS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "chart-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Line chart of inbox size per day");

  // Y gridlines + labels.
  yTicks(yMax).forEach((t) => {
    const y = yFor(t);
    svg.appendChild(
      el("line", {
        x1: M.left, y1: y, x2: W - M.right, y2: y,
        stroke: t === 0 ? C.axis : C.grid, "stroke-width": 1,
      })
    );
    svg.appendChild(
      text(M.left - 8, y + 4, t, { fill: C.muted, "text-anchor": "end", "font-size": 12 })
    );
  });

  // X labels (thin out if crowded).
  const step = Math.ceil(n / 8);
  series.forEach((p, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    svg.appendChild(
      text(xFor(i), H - M.bottom + 20, fmtDay(p.day), {
        fill: C.muted, "text-anchor": "middle", "font-size": 12,
      })
    );
  });

  // The line.
  const dPath = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i)},${yFor(p.count)}`)
    .join(" ");
  svg.appendChild(
    el("path", { d: dPath, fill: "none", stroke: C.line, "stroke-width": 2,
      "stroke-linejoin": "round", "stroke-linecap": "round" })
  );

  // Markers.
  series.forEach((p, i) => {
    svg.appendChild(
      el("circle", { cx: xFor(i), cy: yFor(p.count), r: 4,
        fill: C.surface, stroke: C.line, "stroke-width": 2 })
    );
  });

  // Hover layer: crosshair + tooltip.
  const crosshair = el("line", {
    y1: M.top, y2: M.top + ph, stroke: C.axis, "stroke-width": 1,
    "stroke-dasharray": "4 3", opacity: 0,
  });
  const focus = el("circle", { r: 5.5, fill: C.line, stroke: C.surface,
    "stroke-width": 2, opacity: 0 });
  svg.appendChild(crosshair);
  svg.appendChild(focus);

  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.style.opacity = 0;
  inboxChartEl.appendChild(tip);

  const hit = el("rect", { x: M.left, y: M.top, width: pw, height: ph, fill: "transparent" });
  svg.appendChild(hit);

  function move(evt) {
    const pt = svgPoint(svg, evt);
    let i = n === 1 ? 0 : Math.round(((pt.x - M.left) / pw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const p = series[i];
    const x = xFor(i);
    const y = yFor(p.count);

    crosshair.setAttribute("x1", x);
    crosshair.setAttribute("x2", x);
    crosshair.setAttribute("opacity", 1);
    focus.setAttribute("cx", x);
    focus.setAttribute("cy", y);
    focus.setAttribute("opacity", 1);

    tip.style.opacity = 1;
    tip.innerHTML =
      `<strong>${p.count}</strong> in inbox<br><span>${fmtDay(p.day)}</span>`;
    const rect = inboxChartEl.getBoundingClientRect();
    tip.style.left = (x / W) * rect.width + "px";
    tip.style.top = (y / H) * rect.height + "px";
  }
  function leave() {
    crosshair.setAttribute("opacity", 0);
    focus.setAttribute("opacity", 0);
    tip.style.opacity = 0;
  }
  hit.addEventListener("mousemove", move);
  hit.addEventListener("mouseleave", leave);

  inboxChartEl.appendChild(svg);
}

// --- Small SVG utils ---------------------------------------------------------
function el(name, attrs) {
  const e = document.createElementNS(SVGNS, name);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}
function text(x, y, str, attrs) {
  const t = el("text", { x, y, ...attrs });
  t.textContent = str;
  return t;
}
function svgPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function niceCeil(v) {
  if (v <= 5) return 5;
  if (v <= 10) return 10;
  return Math.ceil(v / 5) * 5;
}
function yTicks(max) {
  const step = max / (max % 4 === 0 ? 4 : 5);
  const out = [];
  for (let t = 0; t <= max + 0.001; t += step) out.push(Math.round(t));
  return [...new Set(out)];
}

// Pull the latest shared counts from the cloud (if configured) before drawing,
// so viewers see the owner's stats — then render.
(async function boot() {
  const store = window.plannerStore;
  if (store && store.configured) {
    try {
      await store.init();
    } catch (e) {
      console.error("Stats: cloud load failed; showing local data.", e);
    }
  }
  render();
  renderInbox();
})();
