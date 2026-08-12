// Daily Planner — one table per WORKING day, with per-day + rolling completed
// views and a weekly stats page.
//
// Sharing model ("commit to GitHub"):
//   - The committed file  data/<YYYY-MM-DD>.json  is the SOURCE OF TRUTH.
//   - While you type, edits are held as a LOCAL DRAFT (localStorage).
//   - Publishing = writing that JSON into the repo and pushing (wired up next).
//
// Day data shape:  { active: [ {task,notes} × 15 ], completed: [ {task,notes} ] }
//   - active   = the 15-row grid (unfinished tasks, compacted to the top).
//   - completed = tasks finished ON THAT DAY (shown struck through below).
//
// Completing a task moves it from active -> completed; the active list slides up
// so there are no gaps. Unchecking moves it back into the grid.
//
// Weekdays only (Mon–Fri); windows counted in working days:
//   - 10 working days back, 5 forward. Completed list keeps 7 working days.
//   - Carry-over: a fresh day seeds with the last day's unfinished tasks.

const ROWS = 15;
const WORKDAYS_BACK = 10;
const WORKDAYS_FWD = 5;
const COMPLETED_WORKDAYS = 7;
const STATS_KEY = "plan-stats"; // { "<YYYY-MM-DD>": completedCount } — persistent

// --- Date helpers (local time) ----------------------------------------------
function atMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function isWeekend(d) {
  const g = d.getDay();
  return g === 0 || g === 6;
}
function nextWorkday(d) {
  let x = addDays(d, 1);
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}
function prevWorkday(d) {
  let x = addDays(d, -1);
  while (isWeekend(x)) x = addDays(x, -1);
  return x;
}
function addWorkdays(d, n) {
  let x = atMidnight(d);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  while (remaining > 0) {
    x = addDays(x, step);
    if (!isWeekend(x)) remaining--;
  }
  return x;
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
function draftKeyOf(d) {
  return `plan-draft:${keyOf(d)}`;
}

const realToday = atMidnight(new Date());
const today = isWeekend(realToday) ? nextWorkday(realToday) : realToday;
const minDate = addWorkdays(today, -WORKDAYS_BACK);
const maxDate = addWorkdays(today, WORKDAYS_FWD);
const completedMin = keyOf(addWorkdays(today, -COMPLETED_WORKDAYS));

let viewDate = today;
let day = normalizeDay(null); // { active, completed } for the viewed day

// --- Retention: drop drafts older than the back window -----------------------
function purgeOldDrafts() {
  const minKey = keyOf(minDate);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("plan-draft:")) {
      const dayKey = k.slice("plan-draft:".length);
      if (dayKey < minKey) localStorage.removeItem(k);
    }
  }
}

// --- DOM refs ----------------------------------------------------------------
const body = document.getElementById("planBody");
const prevBtn = document.getElementById("prevDay");
const nextBtn = document.getElementById("nextDay");
const titleEl = document.getElementById("dayTitle");
const dateEl = document.getElementById("dayDate");
const clearBtn = document.getElementById("clearBtn");
const dayNotesField = document.getElementById("dayNotes");
const plannedDayField = document.getElementById("plannedDay");
const top3Body = document.getElementById("top3Body");
const top3ReviewBody = document.getElementById("top3ReviewBody");
const completedTodayHead = document.getElementById("completedTodayHead");
const completedTodayList = document.getElementById("completedTodayList");
const completedList = document.getElementById("completedList");
const authBox = document.getElementById("authBox");
const readonlyBanner = document.getElementById("readonlyBanner");
const tealAuditBody = document.getElementById("tealAuditBody");
const tealAuditMeta = document.getElementById("tealAuditMeta");
const claudeAuditBody = document.getElementById("claudeAuditBody");
const claudeAuditMeta = document.getElementById("claudeAuditMeta");

// Shared cloud store (defined in store.js). Fallback keeps the app working if
// opened as a bare file:// with no Firebase scripts.
const plannerStore = window.plannerStore || {
  configured: false,
  canEdit: () => true,
  init: async () => {},
  subscribe: () => {},
  writeDay: () => {},
  writeFuture: () => {},
  writeStats: () => {},
  getAudit: async () => null,
  onAuthChange: () => {},
  signIn: () => {},
  signOut: () => {},
  user: () => null,
};

// Whether the current visitor may edit. False = read-only viewer (e.g. your
// boss). Recomputed from sign-in state at boot and on every auth change.
let CAN_EDIT = true;

// --- Day model ---------------------------------------------------------------
function newId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function blankRow() {
  return { task: "", notes: "", deadline: "" };
}
function cleanRow(r) {
  const out = {
    task: (r && r.task) || "",
    notes: (r && r.notes) || "",
    deadline: (r && r.deadline) || "",
  };
  if (r && r.id) out.id = r.id; // stable id lets reorders follow a task across days
  return out;
}
function nonBlank(r) {
  return r.task.trim() || r.notes.trim() || (r.deadline || "").trim();
}
function padActive(list) {
  const out = list.slice(0, ROWS).map(cleanRow);
  while (out.length < ROWS) out.push(blankRow());
  return out;
}

// Accepts the current shape, or migrates the old {rows:[{task,notes,done}]} /
// bare-array formats. Returns { active:[15], completed:[] }.
function normalizeDay(obj) {
  const notes = (o) => (o && typeof o.dayNotes === "string" ? o.dayNotes : "");
  const planned = (o) =>
    o && typeof o.plannedDay === "string" ? o.plannedDay : "";
  // Always exactly 3 free-text slots (planned top 3 + their review answers).
  const triple = (o, key) => {
    const arr = o && !Array.isArray(o) && Array.isArray(o[key]) ? o[key] : [];
    return [0, 1, 2].map((i) => (typeof arr[i] === "string" ? arr[i] : ""));
  };
  if (!obj)
    return {
      active: padActive([]),
      completed: [],
      dayNotes: "",
      plannedDay: "",
      top3: ["", "", ""],
      top3Review: ["", "", ""],
    };

  // Legacy: bare array of rows with a `done` flag.
  if (Array.isArray(obj)) {
    return {
      active: padActive(obj.filter((r) => !r.done)),
      completed: obj.filter((r) => r.done).map(cleanRow),
      dayNotes: "",
      plannedDay: "",
      top3: ["", "", ""],
      top3Review: ["", "", ""],
    };
  }
  // Legacy: { rows: [...] } (with or without done flags).
  if (Array.isArray(obj.rows)) {
    return {
      active: padActive(obj.rows.filter((r) => !r.done)),
      completed: obj.rows.filter((r) => r.done).map(cleanRow),
      dayNotes: notes(obj),
      plannedDay: planned(obj),
      top3: triple(obj, "top3"),
      top3Review: triple(obj, "top3Review"),
    };
  }
  // Current shape.
  return {
    active: padActive(Array.isArray(obj.active) ? obj.active : []),
    completed: (Array.isArray(obj.completed) ? obj.completed : []).map(cleanRow),
    dayNotes: notes(obj),
    plannedDay: planned(obj),
    top3: triple(obj, "top3"),
    top3Review: triple(obj, "top3Review"),
  };
}

// --- Stats log (persistent, survives retention) ------------------------------
function loadStats() {
  return JSON.parse(localStorage.getItem(STATS_KEY) || "{}");
}
function setStat(dayKey, count) {
  const s = loadStats();
  if (count > 0) s[dayKey] = count;
  else delete s[dayKey];
  localStorage.setItem(STATS_KEY, JSON.stringify(s));
}

// --- Persistence -------------------------------------------------------------
function saveDay() {
  localStorage.setItem(draftKeyOf(viewDate), JSON.stringify(day));
  setStat(keyOf(viewDate), day.completed.length);
  plannerStore.writeDay(keyOf(viewDate), day);
  plannerStore.writeStats(loadStats());
}

// --- Committed-file cache ----------------------------------------------------
const committedCache = {};
async function getCommitted(date) {
  const k = keyOf(date);
  if (k in committedCache) return committedCache[k];
  let base = null;
  try {
    const res = await fetch(`data/${k}.json`, { cache: "no-store" });
    if (res.ok) base = await res.json();
  } catch (_) {
    // No file / file:// — ignore.
  }
  committedCache[k] = base;
  return base;
}
async function getDay(date) {
  const draft = JSON.parse(localStorage.getItem(draftKeyOf(date)) || "null");
  if (draft) return normalizeDay(draft);
  return normalizeDay(await getCommitted(date));
}

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// A task keeps a stable id once it has content, so a reorder can follow it
// across days.
function ensureId(i) {
  if (nonBlank(day.active[i]) && !day.active[i].id) day.active[i].id = newId();
}

// --- Render the active grid --------------------------------------------------
let dragIndex = null;

function render() {
  body.innerHTML = "";

  day.active.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.dataset.index = i;

    // Drag handle (only cell that starts a drag, so typing isn't disrupted).
    const gripTd = document.createElement("td");
    gripTd.className = "grip-cell";
    const grip = document.createElement("span");
    grip.className = "grip";
    grip.textContent = "⠿";
    grip.title = "Drag to reorder";
    if (CAN_EDIT) {
      grip.addEventListener("mousedown", () => (tr.draggable = true));
    } else {
      grip.style.visibility = "hidden";
    }
    gripTd.appendChild(grip);

    const taskTd = document.createElement("td");
    taskTd.appendChild(
      makeTextCell(row.task, `${i + 1}.`, (v) => {
        day.active[i].task = v;
        ensureId(i);
        saveDay();
      })
    );

    const notesTd = document.createElement("td");
    notesTd.appendChild(
      makeTextCell(row.notes, "", (v) => {
        day.active[i].notes = v;
        ensureId(i);
        saveDay();
      })
    );

    const deadlineTd = document.createElement("td");
    deadlineTd.appendChild(
      makeDeadlineCell(row.deadline || "", (v) => {
        day.active[i].deadline = v;
        ensureId(i);
        saveDay();
        render(); // re-render so the just-set deadline becomes read-only
      })
    );

    const doneTd = document.createElement("td");
    doneTd.className = "done-cell";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("aria-label", `Mark row ${i + 1} complete`);
    box.disabled = !CAN_EDIT;
    box.addEventListener("change", () => completeRow(i));
    doneTd.appendChild(box);

    // Drag-and-drop reordering.
    tr.addEventListener("dragstart", (e) => {
      dragIndex = i;
      tr.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      try {
        e.dataTransfer.setData("text/plain", String(i));
      } catch (_) {}
    });
    tr.addEventListener("dragend", () => {
      tr.draggable = false;
      tr.classList.remove("dragging");
      body.querySelectorAll(".drop-target").forEach((x) =>
        x.classList.remove("drop-target")
      );
      dragIndex = null;
    });
    tr.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      tr.classList.add("drop-target");
    });
    tr.addEventListener("dragleave", () => tr.classList.remove("drop-target"));
    tr.addEventListener("drop", (e) => {
      e.preventDefault();
      tr.classList.remove("drop-target");
      if (dragIndex !== null && dragIndex !== i) reorderActive(dragIndex, i);
    });

    tr.appendChild(gripTd);
    tr.appendChild(taskTd);
    tr.appendChild(notesTd);
    tr.appendChild(deadlineTd);
    tr.appendChild(doneTd);
    body.appendChild(tr);
  });

  document.querySelectorAll(".cell").forEach(autoGrow);
}

// Move a row, compact tasks to the top, then propagate the new order forward.
function reorderActive(from, to) {
  const arr = day.active.slice();
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  const nb = arr.filter(nonBlank);
  nb.forEach((r) => {
    if (!r.id) r.id = newId();
  });
  day.active = padActive(nb);
  saveDay();
  render();
  propagateOrder(viewDate);
}

// Apply this day's task order (by id) to every later working day that has data.
function propagateOrder(fromDate) {
  const orderIds = day.active.filter(nonBlank).map((r) => r.id).filter(Boolean);
  if (!orderIds.length) return;
  let d = nextWorkday(fromDate);
  while (keyOf(d) <= keyOf(maxDate)) {
    const raw = localStorage.getItem(draftKeyOf(d));
    if (raw) {
      const obj = normalizeDay(JSON.parse(raw));
      obj.active = reorderByIds(obj.active, orderIds);
      localStorage.setItem(draftKeyOf(d), JSON.stringify(obj));
      plannerStore.writeDay(keyOf(d), obj);
    }
    d = nextWorkday(d);
  }
}

// Reorder `active` so ids follow `orderIds`; tasks not in the list trail after,
// keeping their existing relative order.
function reorderByIds(active, orderIds) {
  const rest = active.filter(nonBlank);
  const inOrder = [];
  orderIds.forEach((id) => {
    const idx = rest.findIndex((r) => r.id === id);
    if (idx !== -1) inOrder.push(rest.splice(idx, 1)[0]);
  });
  return padActive(inOrder.concat(rest));
}

function makeTextCell(value, placeholder, onInput) {
  const ta = document.createElement("textarea");
  ta.className = "cell";
  ta.rows = 1;
  ta.value = value;
  ta.placeholder = placeholder;
  ta.readOnly = !CAN_EDIT;
  ta.addEventListener("input", () => {
    autoGrow(ta);
    onInput(ta.value);
  });
  return ta;
}

// Deadline cell: a date you can set exactly once. While empty it's an editable
// date picker; once a date is chosen (and saved) it renders as locked, read-only
// text so it can't be changed afterward.
function makeDeadlineCell(value, onSet) {
  if (value) {
    const span = document.createElement("span");
    span.className = "deadline-locked";
    // Past due: strictly before the real calendar date (today is not "passed").
    if (value < keyOf(realToday)) {
      span.classList.add("deadline-past");
      span.title = "Deadline has passed";
    } else {
      span.title = "Deadline is locked once set";
    }
    span.textContent = value;
    return span;
  }
  const input = document.createElement("input");
  input.type = "date";
  input.className = "cell deadline-input";
  input.disabled = !CAN_EDIT;
  input.addEventListener("change", () => {
    if (input.value) onSet(input.value);
  });
  return input;
}

// --- Complete: move active -> completed; grid compacts up --------------------
function completeRow(i) {
  const row = day.active[i];
  if (!nonBlank(row)) {
    // Nothing to complete on a blank line — just re-render to reset the box.
    render();
    return;
  }
  day.completed.push(cleanRow(row));
  day.active.splice(i, 1);
  day.active.push(blankRow()); // keep 15 rows; remaining tasks slid up
  saveDay();
  render();
  renderCompletedToday();
  renderRolling();
}

// Move a completed item back into the active grid (first blank slot).
function restoreToActive(dayObj, completedIndex) {
  const item = dayObj.completed.splice(completedIndex, 1)[0];
  if (!item) return;
  const slot = dayObj.active.findIndex((r) => !nonBlank(r));
  if (slot === -1) dayObj.active.pop(); // grid full — drop last blank/overflow
  const at = slot === -1 ? dayObj.active.length : slot;
  dayObj.active.splice(at, 0, cleanRow(item));
  dayObj.active = padActive(dayObj.active);
}

// --- Completed TODAY (the viewed day) ---------------------------------------
function renderCompletedToday() {
  const isToday = keyOf(viewDate) === keyOf(today);
  completedTodayHead.textContent = isToday
    ? "Higher Priority Tasks Completed Today"
    : `Higher Priority Tasks Completed · ${viewDate.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}`;

  completedTodayList.innerHTML = "";

  if (day.completed.length === 0) {
    const li = document.createElement("li");
    li.className = "completed-empty";
    li.textContent = "Nothing completed on this day yet.";
    completedTodayList.appendChild(li);
    return;
  }

  day.completed.forEach((c, i) => {
    const li = document.createElement("li");
    li.className = "completed-item";

    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = true;
    box.className = "ci-box";
    box.disabled = !CAN_EDIT;
    box.setAttribute("aria-label", "Mark as not complete");
    box.addEventListener("change", () => {
      restoreToActive(day, i);
      saveDay();
      render();
      renderCompletedToday();
      renderRolling();
    });

    const main = document.createElement("span");
    main.className = "ci-main";
    main.textContent = c.task || "(no task text)";
    if (c.notes && c.notes.trim()) {
      const notes = document.createElement("span");
      notes.className = "ci-notes";
      notes.textContent = " — " + c.notes;
      main.appendChild(notes);
    }

    li.appendChild(box);
    li.appendChild(main);
    completedTodayList.appendChild(li);
  });
}

// --- Completed ROLLING (past 7 working days) --------------------------------
async function renderRolling() {
  const items = [];
  let d = today;
  while (keyOf(d) >= completedMin) {
    const dayObj = keyOf(d) === keyOf(viewDate) ? day : await getDay(d);
    dayObj.completed.forEach((c) => {
      if (nonBlank(c)) items.push({ ...c, day: keyOf(d) });
    });
    d = prevWorkday(d);
  }

  completedList.innerHTML = "";

  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "completed-empty";
    li.textContent = "Nothing completed in the past work-week yet.";
    completedList.appendChild(li);
    return;
  }

  items.forEach((c) => {
    const li = document.createElement("li");
    li.className = "completed-item";

    const main = document.createElement("span");
    main.className = "ci-main";
    main.textContent = c.task || "(no task text)";
    if (c.notes && c.notes.trim()) {
      const notes = document.createElement("span");
      notes.className = "ci-notes";
      notes.textContent = " — " + c.notes;
      main.appendChild(notes);
    }

    const date = document.createElement("span");
    date.className = "ci-date";
    date.textContent = dateFromKey(c.day).toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
    });

    li.appendChild(main);
    li.appendChild(date);
    completedList.appendChild(li);
  });
}

// --- Planned Top 3 + their review (per-day, 3 free-text rows each) -----------
// The top-3 table is free text. The review table mirrors each planned task as
// read-only context ("did THIS get done?") above a free-text answer field.
function makeMiniRow(bodyEl, i, value, placeholder, onInput, contextText) {
  const tr = document.createElement("tr");

  const numTd = document.createElement("td");
  numTd.className = "mini-num";
  numTd.textContent = i + 1 + ".";

  const cellTd = document.createElement("td");
  if (contextText !== undefined) {
    const task = document.createElement("div");
    task.className = "mini-task";
    const t = (contextText || "").trim();
    task.textContent = t || "(no planned task)";
    if (!t) task.classList.add("mini-task-empty");
    cellTd.appendChild(task);
  }

  const ta = document.createElement("textarea");
  ta.className = "mini-input";
  ta.rows = 1;
  ta.value = value || "";
  ta.placeholder = placeholder;
  ta.readOnly = !CAN_EDIT;
  ta.addEventListener("input", () => {
    autoGrow(ta);
    onInput(ta.value);
  });
  cellTd.appendChild(ta);

  tr.appendChild(numTd);
  tr.appendChild(cellTd);
  bodyEl.appendChild(tr);
  autoGrow(ta);
}

function renderTop3() {
  top3Body.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    makeMiniRow(top3Body, i, day.top3[i], "Top task…", (v) => {
      day.top3[i] = v;
      saveDay();
      renderTop3Review(); // keep the mirrored task text in sync
    });
  }
}

function renderTop3Review() {
  top3ReviewBody.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    makeMiniRow(
      top3ReviewBody,
      i,
      day.top3Review[i],
      "Done? If not, why?",
      (v) => {
        day.top3Review[i] = v;
        saveDay();
      },
      day.top3[i]
    );
  }
}

// --- Daily audits: TEAL time-tracking + Claude Code activity -----------------
// Read-only tables fed by the `audit/<day>` Firestore docs (written locally by
// the PlannerAudit generator). Owner-gated: viewers / not-signed-in get null
// and see a friendly empty state. A per-load token guards against a slow fetch
// for an old day landing after you've navigated away.
let auditLoadToken = 0;

function fmtMins(m) {
  m = Math.max(0, Math.round(Number(m) || 0));
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
}

function auditMessage(container, meta, text) {
  meta.textContent = "";
  container.innerHTML = "";
  const p = document.createElement("p");
  p.className = "audit-empty";
  p.textContent = text;
  container.appendChild(p);
}

function buildTable(headers, rows) {
  const table = document.createElement("table");
  table.className = "audit-table";
  const thead = document.createElement("thead");
  const htr = document.createElement("tr");
  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h.label;
    if (h.cls) th.className = h.cls;
    htr.appendChild(th);
  });
  thead.appendChild(htr);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  rows.forEach((cells) => {
    const tr = document.createElement("tr");
    cells.forEach((c, i) => {
      const td = document.createElement("td");
      td.textContent = c == null || c === "" ? "—" : c;
      if (headers[i] && headers[i].cls) td.className = headers[i].cls;
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  return table;
}

function renderTeal(audit) {
  const teal = audit && audit.teal;
  const items = (teal && Array.isArray(teal.items) ? teal.items : []).slice();
  if (!items.length) {
    auditMessage(tealAuditBody, tealAuditMeta, "No TEAL time tracked on this day.");
    return;
  }
  items.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const total = teal.totalMinutes != null
    ? teal.totalMinutes
    : items.reduce((s, it) => s + (Number(it.minutes) || 0), 0);
  tealAuditMeta.textContent = `${items.length} block${items.length === 1 ? "" : "s"} · ${fmtMins(total)} tracked`;
  tealAuditBody.innerHTML = "";
  const headers = [
    { label: "Time", cls: "col-when" },
    { label: "Activity" },
    { label: "Category", cls: "col-cat" },
    { label: "Ref", cls: "col-ref" },
    { label: "Duration", cls: "col-dur" },
  ];
  const rows = items.map((it) => {
    const when = it.start && it.end ? `${it.start}–${it.end}` : it.start || "";
    const ref = it.slg || it.dlg || it.prj || it.qan || it.customer || "";
    return [when, it.subject || "", it.category || "", ref, fmtMins(it.minutes)];
  });
  tealAuditBody.appendChild(buildTable(headers, rows));
}

function renderClaude(audit) {
  const cc = audit && audit.claude;
  const sessions = (cc && Array.isArray(cc.sessions) ? cc.sessions : []).slice();
  if (!sessions.length) {
    auditMessage(claudeAuditBody, claudeAuditMeta, "No Claude Code activity on this day.");
    return;
  }
  sessions.sort((a, b) => String(a.start || "").localeCompare(String(b.start || "")));
  const total = cc.totalActiveMinutes != null
    ? cc.totalActiveMinutes
    : sessions.reduce((s, x) => s + (Number(x.activeMinutes) || 0), 0);
  claudeAuditMeta.textContent = `${sessions.length} session${sessions.length === 1 ? "" : "s"} · ${fmtMins(total)} active`;
  claudeAuditBody.innerHTML = "";
  const headers = [
    { label: "Time", cls: "col-when" },
    { label: "What I worked on" },
    { label: "Project", cls: "col-proj" },
    { label: "Msgs", cls: "col-msgs" },
    { label: "Active", cls: "col-dur" },
  ];
  const rows = sessions.map((s) => {
    const when = s.start && s.end ? `${s.start}–${s.end}` : s.start || "";
    return [when, s.title || "(untitled session)", s.project || "", s.messages != null ? String(s.messages) : "", fmtMins(s.activeMinutes)];
  });
  claudeAuditBody.appendChild(buildTable(headers, rows));
}

async function renderAudits() {
  const token = ++auditLoadToken;
  const key = keyOf(viewDate);

  // Not signed in as owner: audit reads are denied by rules. Say so rather than
  // implying there was no activity.
  if (plannerStore.configured && !CAN_EDIT) {
    const msg = "Sign in as the owner to view your audit for this day.";
    auditMessage(tealAuditBody, tealAuditMeta, msg);
    auditMessage(claudeAuditBody, claudeAuditMeta, msg);
    return;
  }

  auditMessage(tealAuditBody, tealAuditMeta, "Loading…");
  auditMessage(claudeAuditBody, claudeAuditMeta, "Loading…");

  let audit = null;
  try {
    audit = await plannerStore.getAudit(key);
  } catch (_) {
    audit = null;
  }
  if (token !== auditLoadToken) return; // navigated away; drop stale result

  renderTeal(audit);
  renderClaude(audit);
}

// --- Clear the day's active tasks (NOT a completion) -------------------------
clearBtn.addEventListener("click", () => {
  const anything = day.active.some(nonBlank);
  if (!anything) return;
  const ok = confirm(
    "Clear all tasks on this day and start over?\n\n" +
      "This erases the current tasks (it does NOT mark them complete) and can't be undone."
  );
  if (!ok) return;
  day.active = padActive([]);
  saveDay();
  render();
});

// --- Day notes (free text; per-day, never carried over) ----------------------
dayNotesField.addEventListener("input", () => {
  day.dayNotes = dayNotesField.value;
  saveDay();
});
plannedDayField.addEventListener("input", () => {
  day.plannedDay = plannedDayField.value;
  saveDay();
});

// --- Carry-over --------------------------------------------------------------
// Walk back from `refDate` (exclusive) to the first day that has unfinished
// tasks, and return them. Used to seed today and any un-started future day.
async function carryOverActive(refDate) {
  let d = prevWorkday(refDate);
  const stopKey = keyOf(minDate);
  while (keyOf(d) >= stopKey) {
    const draft = JSON.parse(localStorage.getItem(draftKeyOf(d)) || "null");
    if (draft) return normalizeDay(draft).active.filter(nonBlank);
    d = prevWorkday(d);
  }
  const prevCommitted = await getCommitted(prevWorkday(refDate));
  return prevCommitted ? normalizeDay(prevCommitted).active.filter(nonBlank) : [];
}

// --- Load a day --------------------------------------------------------------
async function loadDay(date) {
  viewDate = atMidnight(date);
  updateHeader();

  const started = localStorage.getItem(draftKeyOf(viewDate)) !== null;
  day = await getDay(viewDate);

  // Carry-over: today and any future working day, only if never started and
  // still empty. Unfinished tasks roll forward until they're completed. We
  // persist the seed for today; future days are seeded for display only, so
  // they always reflect the latest unfinished tasks until you edit them.
  const isTodayOrFuture = keyOf(viewDate) >= keyOf(today);
  if (isTodayOrFuture && !started && !day.active.some(nonBlank)) {
    const carried = await carryOverActive(viewDate);
    if (carried.length) {
      day.active = padActive(carried);
      if (keyOf(viewDate) === keyOf(today)) saveDay();
    }
  }

  dayNotesField.value = day.dayNotes || "";
  plannedDayField.value = day.plannedDay || "";

  render();
  renderTop3();
  renderTop3Review();
  renderCompletedToday();
  renderRolling();
  renderAudits();
}

// --- Header + navigation -----------------------------------------------------
function updateHeader() {
  const weekday = viewDate.toLocaleDateString(undefined, { weekday: "long" });
  const longDate = viewDate.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const isToday = keyOf(viewDate) === keyOf(today);
  titleEl.textContent = isToday ? "Today" : weekday;
  dateEl.textContent = isToday ? longDate : `${weekday.slice(0, 3)} · ${longDate}`;

  prevBtn.disabled = keyOf(viewDate) <= keyOf(minDate);
  nextBtn.disabled = keyOf(viewDate) >= keyOf(maxDate);
}

prevBtn.addEventListener("click", () => {
  if (!prevBtn.disabled) loadDay(prevWorkday(viewDate));
});
nextBtn.addEventListener("click", () => {
  if (!nextBtn.disabled) loadDay(nextWorkday(viewDate));
});

document.addEventListener("keydown", (e) => {
  const typing = ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName);
  if (typing) return;
  if (e.key === "ArrowLeft" && !prevBtn.disabled) loadDay(prevWorkday(viewDate));
  if (e.key === "ArrowRight" && !nextBtn.disabled) loadDay(nextWorkday(viewDate));
});

// --- Read-only mode + sign-in UI --------------------------------------------
// Apply CAN_EDIT to the static controls. The dynamic cells/checkboxes read
// CAN_EDIT as they're built, so a re-render picks up the current mode.
function applyEditMode() {
  clearBtn.style.display = CAN_EDIT ? "" : "none";
  dayNotesField.readOnly = !CAN_EDIT;
  plannedDayField.readOnly = !CAN_EDIT;
  readonlyBanner.hidden = !plannerStore.configured || CAN_EDIT;
}

function updateAuthUI() {
  if (!plannerStore.configured) {
    authBox.hidden = true; // local-only mode: no sign-in needed
    return;
  }
  authBox.hidden = false;
  authBox.innerHTML = "";
  const user = plannerStore.user();

  if (user) {
    const label = document.createElement("span");
    // The UID is shown so you can copy it into firebase-config.js during setup.
    label.innerHTML =
      (CAN_EDIT ? "✎ Editing · " : "Viewing · ") +
      "<code>" + user.uid + "</code>";
    const out = document.createElement("button");
    out.className = "authbtn";
    out.textContent = "Sign out";
    out.addEventListener("click", () => plannerStore.signOut());
    authBox.appendChild(label);
    authBox.appendChild(out);
  } else {
    const btn = document.createElement("button");
    btn.className = "authbtn";
    btn.textContent = "Sign in";
    btn.addEventListener("click", () => plannerStore.signIn());
    authBox.appendChild(btn);
  }
}

function refreshView() {
  loadDay(viewDate);
}

// --- Boot --------------------------------------------------------------------
async function boot() {
  try {
    await plannerStore.init();
  } catch (e) {
    console.error("Store init failed; continuing in local mode.", e);
  }
  CAN_EDIT = plannerStore.canEdit();

  purgeOldDrafts();
  loadDay(today);
  applyEditMode();
  updateAuthUI();

  // Viewers (not the owner) get live updates pushed from the owner's edits.
  plannerStore.subscribe(refreshView);

  // Re-evaluate edit rights whenever sign-in state changes.
  plannerStore.onAuthChange(() => {
    CAN_EDIT = plannerStore.canEdit();
    applyEditMode();
    updateAuthUI();
    refreshView();
    plannerStore.subscribe(refreshView);
  });
}

boot();
