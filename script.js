// Daily Planner — one table per working day.
//
// Sharing model ("commit to GitHub"):
//   - The committed file  data/<YYYY-MM-DD>.json  is the SOURCE OF TRUTH.
//   - While you type, edits are held as a LOCAL DRAFT (localStorage).
//   - Publishing = writing that JSON into the repo and pushing (wired up next).
//
// Day data shape:  { active: [ {task,notes} × 15 ], completed: [ {task,notes} ] }
//   - active   = the 15-row grid (unfinished tasks, compacted to the top).
//   - completed = tasks finished on that day.
//
// Completing a task moves it from active -> completed; the active list slides up
// so there are no gaps.
//
// Weekdays only (Mon–Fri); windows counted in working days:
//   - 10 working days back, 5 forward.
//   - Carry-over: a fresh day seeds with the last day's unfinished tasks.

const ROWS = 15;
const WORKDAYS_BACK = 10;
const WORKDAYS_FWD = 5;
const AGENDA_KEY = "plan-agenda"; // [ {event,date} × 10 ] — standing TL agenda
const AGENDA_ROWS = 10;
const SHERLOCK_KEY = "plan-sherlocks"; // [ {sherlock,notes,date} × 10 ] — standing list
const SHERLOCK_ROWS = 10;

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
function draftKeyOf(d) {
  return `plan-draft:${keyOf(d)}`;
}

const realToday = atMidnight(new Date());
const today = isWeekend(realToday) ? nextWorkday(realToday) : realToday;
const minDate = addWorkdays(today, -WORKDAYS_BACK);
const maxDate = addWorkdays(today, WORKDAYS_FWD);
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
const agendaBody = document.getElementById("agendaBody");
const sherlockBody = document.getElementById("sherlockBody");
const authBox = document.getElementById("authBox");
const readonlyBanner = document.getElementById("readonlyBanner");

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
  writeAgenda: () => {},
  writeSherlocks: () => {},
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
  if (!obj)
    return {
      active: padActive([]),
      completed: [],
      dayNotes: "",
      plannedDay: "",
    };

  // Legacy: bare array of rows with a `done` flag.
  if (Array.isArray(obj)) {
    return {
      active: padActive(obj.filter((r) => !r.done)),
      completed: obj.filter((r) => r.done).map(cleanRow),
      dayNotes: "",
      plannedDay: "",
    };
  }
  // Legacy: { rows: [...] } (with or without done flags).
  if (Array.isArray(obj.rows)) {
    return {
      active: padActive(obj.rows.filter((r) => !r.done)),
      completed: obj.rows.filter((r) => r.done).map(cleanRow),
      dayNotes: notes(obj),
      plannedDay: planned(obj),
    };
  }
  // Current shape.
  return {
    active: padActive(Array.isArray(obj.active) ? obj.active : []),
    completed: (Array.isArray(obj.completed) ? obj.completed : []).map(cleanRow),
    dayNotes: notes(obj),
    plannedDay: planned(obj),
  };
}

// --- Persistence -------------------------------------------------------------
function saveDay() {
  localStorage.setItem(draftKeyOf(viewDate), JSON.stringify(day));
  plannerStore.writeDay(keyOf(viewDate), day);
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
}

// --- TL meeting agenda (standing list, 10 event/date rows) -------------------
// Unlike the day sections this is NOT per-day: it's a single running list you
// build up between meetings, shown identically on every day and stored in
// Firestore meta/tlagenda (owner-write, public-read). Hydrated into localStorage
// by store.js; viewers get live updates via the store subscription.
let agenda = padAgenda([]);

function padAgenda(list) {
  const out = (Array.isArray(list) ? list : [])
    .slice(0, AGENDA_ROWS)
    .map((r) => ({ event: (r && r.event) || "", date: (r && r.date) || "" }));
  while (out.length < AGENDA_ROWS) out.push({ event: "", date: "" });
  return out;
}

function loadAgenda() {
  return padAgenda(JSON.parse(localStorage.getItem(AGENDA_KEY) || "null"));
}

function saveAgenda() {
  localStorage.setItem(AGENDA_KEY, JSON.stringify(agenda));
  plannerStore.writeAgenda(agenda);
}

function renderAgenda() {
  agendaBody.innerHTML = "";
  agenda.forEach((row, i) => {
    const tr = document.createElement("tr");

    const eventTd = document.createElement("td");
    eventTd.appendChild(
      makeTextCell(row.event, "", (v) => {
        agenda[i].event = v;
        saveAgenda();
      })
    );

    const dateTd = document.createElement("td");
    dateTd.appendChild(
      makeTextCell(row.date, "", (v) => {
        agenda[i].date = v;
        saveAgenda();
      })
    );

    tr.appendChild(eventTd);
    tr.appendChild(dateTd);
    agendaBody.appendChild(tr);
  });
  agendaBody.querySelectorAll(".cell").forEach(autoGrow);
}

function reloadAgenda() {
  agenda = loadAgenda();
  renderAgenda();
}

// --- Sherlocks (standing list, sherlock/notes/date rows) ---------------------
// Like the TL agenda this is NOT per-day: a single running list shown on every
// day and stored in Firestore meta/sherlocks (owner-write, public-read).
let sherlocks = padSherlocks([]);

function padSherlocks(list) {
  const out = (Array.isArray(list) ? list : [])
    .slice(0, SHERLOCK_ROWS)
    .map((r) => ({
      sherlock: (r && r.sherlock) || "",
      notes: (r && r.notes) || "",
      date: (r && r.date) || "",
    }));
  while (out.length < SHERLOCK_ROWS)
    out.push({ sherlock: "", notes: "", date: "" });
  return out;
}

function loadSherlocks() {
  return padSherlocks(JSON.parse(localStorage.getItem(SHERLOCK_KEY) || "null"));
}

function saveSherlocks() {
  localStorage.setItem(SHERLOCK_KEY, JSON.stringify(sherlocks));
  plannerStore.writeSherlocks(sherlocks);
}

function renderSherlocks() {
  sherlockBody.innerHTML = "";
  sherlocks.forEach((row, i) => {
    const tr = document.createElement("tr");

    const sherlockTd = document.createElement("td");
    sherlockTd.appendChild(
      makeTextCell(row.sherlock, "", (v) => {
        sherlocks[i].sherlock = v;
        saveSherlocks();
      })
    );

    const notesTd = document.createElement("td");
    notesTd.appendChild(
      makeTextCell(row.notes, "", (v) => {
        sherlocks[i].notes = v;
        saveSherlocks();
      })
    );

    const dateTd = document.createElement("td");
    dateTd.appendChild(
      makeTextCell(row.date, "", (v) => {
        sherlocks[i].date = v;
        saveSherlocks();
      })
    );

    tr.appendChild(sherlockTd);
    tr.appendChild(notesTd);
    tr.appendChild(dateTd);
    sherlockBody.appendChild(tr);
  });
  sherlockBody.querySelectorAll(".cell").forEach(autoGrow);
}

function reloadSherlocks() {
  sherlocks = loadSherlocks();
  renderSherlocks();
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
  reloadAgenda();
  reloadSherlocks();
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
  reloadAgenda();
  reloadSherlocks();
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
