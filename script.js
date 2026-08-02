// Daily Planner — Task / Notes / Complete? table, one table per WORKING day.
//
// Sharing model ("commit to GitHub"):
//   - The committed file  data/<YYYY-MM-DD>.json  is the SOURCE OF TRUTH.
//   - While you type, edits are held as a LOCAL DRAFT (localStorage).
//   - Publishing = writing that JSON into the repo and pushing (wired up next).
//
// Weekdays only (Mon–Fri):
//   - Navigation skips Saturday and Sunday entirely.
//   - Opening on a weekend snaps "Today" to the upcoming Monday.
//
// Windows (all counted in WORKING days):
//   - Move up to 10 working days back (two work-weeks) and 5 forward (one).
//   - The "Completed" list keeps the last 7 working days.
//   - Drafts older than the back window are purged on load.
//
// Completion:
//   - Checking Complete? strikes through the whole row (task stays visible) and
//     keeps the box checked. A done row does NOT carry over to the next day.
//   - Unchecking reactivates the row.
//
// Carry-over:
//   - A fresh working day auto-seeds with the UNFINISHED (non-blank, not-done)
//     tasks from the last day you used — Friday's leftovers roll into Monday.

const ROWS = 15;
const WORKDAYS_BACK = 10; // two work-weeks
const WORKDAYS_FWD = 5; // one work-week
const COMPLETED_WORKDAYS = 7; // last seven working days

// --- Date helpers (all in local time) ----------------------------------------
function atMidnight(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}
function isWeekend(d) {
  const g = d.getDay();
  return g === 0 || g === 6; // Sun / Sat
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
// On a weekend, the active working day is the upcoming Monday.
const today = isWeekend(realToday) ? nextWorkday(realToday) : realToday;
const minDate = addWorkdays(today, -WORKDAYS_BACK);
const maxDate = addWorkdays(today, WORKDAYS_FWD);
const completedMin = keyOf(addWorkdays(today, -COMPLETED_WORKDAYS));

let viewDate = today; // the day currently on screen

// --- Retention: drop drafts older than the back window -----------------------
function purgeOldDrafts() {
  const minKey = keyOf(minDate);
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (k && k.startsWith("plan-draft:")) {
      const day = k.slice("plan-draft:".length);
      if (day < minKey) localStorage.removeItem(k);
    }
  }
}

// --- DOM refs ----------------------------------------------------------------
const body = document.getElementById("planBody");
const prevBtn = document.getElementById("prevDay");
const nextBtn = document.getElementById("nextDay");
const titleEl = document.getElementById("dayTitle");
const dateEl = document.getElementById("dayDate");
const completedList = document.getElementById("completedList");

// --- Row model: array of 15 { task, notes, done } ----------------------------
function blankRow() {
  return { task: "", notes: "", done: false };
}
function normalizeRows(rowsIn) {
  const out = (Array.isArray(rowsIn) ? rowsIn : [])
    .slice(0, ROWS)
    .map((r) => ({
      task: (r && r.task) || "",
      notes: (r && r.notes) || "",
      done: !!(r && r.done),
    }));
  while (out.length < ROWS) out.push(blankRow());
  return out;
}
function nonBlank(r) {
  return r.task.trim() || r.notes.trim();
}
function hasContent(rowsIn) {
  return normalizeRows(rowsIn).some(nonBlank);
}

let rows = normalizeRows([]); // in-memory rows for the viewed day

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

// --- Committed-file cache (source of truth on the live site) -----------------
const committedCache = {};
async function getCommitted(date) {
  const k = keyOf(date);
  if (k in committedCache) return committedCache[k];
  let base = null;
  try {
    const res = await fetch(`data/${k}.json`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) base = data.rows;
    }
  } catch (_) {
    // No file, or running from file:// — ignore.
  }
  committedCache[k] = base;
  return base;
}
// Draft (local edits) overrides the committed file. May return null.
async function getDayData(date) {
  const draft = JSON.parse(localStorage.getItem(draftKeyOf(date)) || "null");
  if (draft) return draft;
  return getCommitted(date);
}

// --- Render the grid ---------------------------------------------------------
function render() {
  body.innerHTML = "";

  rows.forEach((row, i) => {
    const tr = document.createElement("tr");
    if (row.done) tr.className = "row-done";

    const taskTd = document.createElement("td");
    taskTd.appendChild(
      makeTextCell(row.task, `${i + 1}.`, row.done, (v) => {
        rows[i].task = v;
        saveDraft();
      })
    );

    const notesTd = document.createElement("td");
    notesTd.appendChild(
      makeTextCell(row.notes, "", row.done, (v) => {
        rows[i].notes = v;
        saveDraft();
      })
    );

    const doneTd = document.createElement("td");
    doneTd.className = "done-cell";
    const box = document.createElement("input");
    box.type = "checkbox";
    box.checked = row.done;
    box.setAttribute("aria-label", `Mark row ${i + 1} complete`);
    box.addEventListener("change", () => setDone(i, box.checked));
    doneTd.appendChild(box);

    tr.appendChild(taskTd);
    tr.appendChild(notesTd);
    tr.appendChild(doneTd);
    body.appendChild(tr);
  });

  document.querySelectorAll(".cell").forEach(autoGrow);
}

function makeTextCell(value, placeholder, done, onInput) {
  const ta = document.createElement("textarea");
  ta.className = "cell";
  ta.rows = 1;
  ta.value = value;
  ta.placeholder = placeholder;
  ta.readOnly = done; // completed rows are read-only until unchecked
  ta.addEventListener("input", () => {
    autoGrow(ta);
    onInput(ta.value);
  });
  return ta;
}

// --- Complete: strike the row in place; keep it visible; no carry-over --------
function setDone(i, done) {
  rows[i].done = done;
  saveDraft();
  render();
  renderCompleted();
}

// --- Persistence -------------------------------------------------------------
function saveDraft() {
  localStorage.setItem(draftKeyOf(viewDate), JSON.stringify(rows));
}

// --- Completed list ("past 7 working days"), derived from each day's rows -----
async function renderCompleted() {
  const items = [];
  let d = today;
  while (keyOf(d) >= completedMin) {
    const dayRows =
      keyOf(d) === keyOf(viewDate) ? rows : normalizeRows(await getDayData(d));
    normalizeRows(dayRows).forEach((r) => {
      if (r.done && nonBlank(r)) {
        items.push({ task: r.task, notes: r.notes, day: keyOf(d) });
      }
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

    const undo = document.createElement("button");
    undo.className = "ci-undo";
    undo.type = "button";
    undo.textContent = "undo";
    undo.title = "Mark as not complete";
    undo.addEventListener("click", () => undoComplete(c));

    li.appendChild(main);
    li.appendChild(date);
    li.appendChild(undo);
    completedList.appendChild(li);
  });
}

// Undo = flip that row's done flag back to false on its own day.
async function undoComplete(entry) {
  if (entry.day === keyOf(viewDate)) {
    const i = rows.findIndex(
      (r) => r.task === entry.task && r.notes === entry.notes && r.done
    );
    if (i !== -1) {
      rows[i].done = false;
      saveDraft();
      render();
    }
  } else {
    const dayRows = normalizeRows(await getDayData(dateFromKey(entry.day)));
    const i = dayRows.findIndex(
      (r) => r.task === entry.task && r.notes === entry.notes && r.done
    );
    if (i !== -1) {
      dayRows[i].done = false;
      localStorage.setItem(
        draftKeyOf(dateFromKey(entry.day)),
        JSON.stringify(dayRows)
      );
    }
  }
  renderCompleted();
}

// --- Carry-over: unfinished leftovers from the last day you used -------------
async function carryOverRows() {
  let d = prevWorkday(today);
  const stopKey = keyOf(minDate);
  while (keyOf(d) >= stopKey) {
    const draft = JSON.parse(localStorage.getItem(draftKeyOf(d)) || "null");
    if (draft) {
      // Last day you worked — carry only unfinished (non-blank, not-done) rows.
      return normalizeRows(draft).filter((r) => nonBlank(r) && !r.done);
    }
    d = prevWorkday(d);
  }
  // No prior drafts — fall back to the previous working day's committed file.
  const prevData = await getCommitted(prevWorkday(today));
  return prevData
    ? normalizeRows(prevData).filter((r) => nonBlank(r) && !r.done)
    : null;
}

async function loadDay(date) {
  viewDate = atMidnight(date);
  updateHeader();

  let loaded = await getDayData(viewDate);

  // Carry-over applies only to the current working day, and only if it hasn't
  // been started yet (no draft saved for it).
  const started = localStorage.getItem(draftKeyOf(viewDate)) !== null;
  if (keyOf(viewDate) === keyOf(today) && !started && !hasContent(loaded)) {
    const carried = await carryOverRows();
    if (carried) {
      loaded = carried;
      localStorage.setItem(
        draftKeyOf(viewDate),
        JSON.stringify(normalizeRows(carried))
      );
    }
  }

  rows = normalizeRows(loaded);
  render();
  renderCompleted();
}

// --- Header + navigation state ----------------------------------------------
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

// Keyboard arrows navigate days — but only when not typing in a field.
document.addEventListener("keydown", (e) => {
  const typing = ["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName);
  if (typing) return;
  if (e.key === "ArrowLeft" && !prevBtn.disabled) loadDay(prevWorkday(viewDate));
  if (e.key === "ArrowRight" && !nextBtn.disabled) loadDay(nextWorkday(viewDate));
});

// --- Boot --------------------------------------------------------------------
purgeOldDrafts();
loadDay(today);
