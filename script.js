// Daily Planner — 15-row, 1-column table for the current day.
//
// Data model for the "commit to GitHub" sharing approach:
//   - The committed file  data/<YYYY-MM-DD>.json  is the SOURCE OF TRUTH.
//     Anyone who opens the link sees whatever was last committed for today.
//   - While you type, edits are held as a LOCAL DRAFT in this browser
//     (localStorage) so nothing is lost before you publish.
//   - Publishing = writing that JSON into the repo and pushing (wired up next).

const ROWS = 15;

// --- Date handling -----------------------------------------------------------
const today = new Date();
const dayKey = today.toISOString().slice(0, 10); // YYYY-MM-DD
const draftKey = `plan-draft:${dayKey}`;

const weekday = today.toLocaleDateString(undefined, { weekday: "long" });
const longDate = today.toLocaleDateString(undefined, {
  month: "long",
  day: "numeric",
  year: "numeric",
});

document.getElementById("dayTitle").textContent = weekday;
document.getElementById("dayDate").textContent = longDate;

const body = document.getElementById("planBody");

function autoGrow(el) {
  el.style.height = "auto";
  el.style.height = el.scrollHeight + "px";
}

function buildRows(values) {
  body.innerHTML = "";
  for (let i = 0; i < ROWS; i++) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    const cell = document.createElement("textarea");

    cell.className = "cell";
    cell.rows = 1;
    cell.placeholder = `${i + 1}.`;
    cell.value = values[i] || "";
    cell.dataset.index = i;

    cell.addEventListener("input", () => {
      autoGrow(cell);
      saveDraft();
    });

    td.appendChild(cell);
    tr.appendChild(td);
    body.appendChild(tr);
    autoGrow(cell);
  }
}

function currentValues() {
  return [...document.querySelectorAll(".cell")].map((c) => c.value);
}

function saveDraft() {
  localStorage.setItem(draftKey, JSON.stringify(currentValues()));
}

// --- Load: committed file first, then a newer local draft on top -------------
async function load() {
  let values = new Array(ROWS).fill("");

  // 1. Source of truth: today's committed data file (if it exists).
  try {
    const res = await fetch(`data/${dayKey}.json`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.rows)) values = data.rows.slice(0, ROWS);
    }
  } catch (_) {
    // No file yet, or running from file:// — fine, start empty.
  }

  // 2. Local draft (unpublished edits in this browser) wins if present.
  const draft = JSON.parse(localStorage.getItem(draftKey) || "null");
  if (Array.isArray(draft)) values = draft;

  buildRows(values);
}

load();
