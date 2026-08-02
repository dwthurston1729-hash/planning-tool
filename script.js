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
const completedTodayHead = document.getElementById("completedTodayHead");
const completedTodayList = document.getElementById("completedTodayList");
const completedList = document.getElementById("completedList");

// --- Day model ---------------------------------------------------------------
function newId() {
  return "r" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function blankRow() {
  return { task: "", notes: "" };
}
function cleanRow(r) {
  const out = { task: (r && r.task) || "", notes: (r && r.notes) || "" };
  if (r && r.id) out.id = r.id; // stable id lets reorders follow a task across days
  return out;
}
function nonBlank(r) {
  return r.task.trim() || r.notes.trim();
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
  if (!obj) return { active: padActive([]), completed: [], dayNotes: "" };

  // Legacy: bare array of rows with a `done` flag.
  if (Array.isArray(obj)) {
    return {
      active: padActive(obj.filter((r) => !r.done)),
      completed: obj.filter((r) => r.done).map(cleanRow),
      dayNotes: "",
    };
  }
  // Legacy: { rows: [...] } (with or without done flags).
  if (Array.isArray(obj.rows)) {
    return {
      active: padActive(obj.rows.filter((r) => !r.done)),
      completed: obj.rows.filter((r) => r.done).map(cleanRow),
      dayNotes: notes(obj),
    };
  }
  // Current shape.
  return {
    active: padActive(Array.isArray(obj.active) ? obj.active : []),
    completed: (Array.isArray(obj.completed) ? obj.completed : []).map(cleanRow),
    dayNotes: notes(obj),
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
    grip.addEventListener("mousedown", () => (tr.draggable = true));
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

    const doneTd = document.createElement("td");
    doneTd.className = "done-cell";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.setAttribute("aria-label", `Mark row ${i + 1} complete`);
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
  ta.addEventListener("input", () => {
    autoGrow(ta);
    onInput(ta.value);
  });
  return ta;
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
    ? "Completed today"
    : `Completed · ${viewDate.toLocaleDateString(undefined, {
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

  render();
  renderCompletedToday();
  renderRolling();
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

// --- Future tasks (a standalone 10-row backlog, not tied to any day) ---------
const FUTURE_ROWS = 10;
const FUTURE_KEY = "plan-future";
const futureBody = document.getElementById("futureBody");

function loadFuture() {
  const arr = JSON.parse(localStorage.getItem(FUTURE_KEY) || "[]");
  const out = (Array.isArray(arr) ? arr : []).slice(0, FUTURE_ROWS).map(cleanRow);
  while (out.length < FUTURE_ROWS) out.push(blankRow());
  return out;
}

function renderFuture() {
  const future = loadFuture();
  futureBody.innerHTML = "";

  future.forEach((row, i) => {
    const tr = document.createElement("tr");

    const taskTd = document.createElement("td");
    taskTd.appendChild(
      makeTextCell(row.task, `${i + 1}.`, (v) => {
        future[i].task = v;
        localStorage.setItem(FUTURE_KEY, JSON.stringify(future));
      })
    );

    const notesTd = document.createElement("td");
    notesTd.appendChild(
      makeTextCell(row.notes, "", (v) => {
        future[i].notes = v;
        localStorage.setItem(FUTURE_KEY, JSON.stringify(future));
      })
    );

    tr.appendChild(taskTd);
    tr.appendChild(notesTd);
    futureBody.appendChild(tr);
  });

  futureBody.querySelectorAll(".cell").forEach(autoGrow);
}

// --- Boot --------------------------------------------------------------------
purgeOldDrafts();
loadDay(today);
renderFuture();
