# Daily Planner

A single-page planning tool hosted on GitHub Pages. One table, 15 rows, for the current day.

## How sharing works

The committed file `data/<YYYY-MM-DD>.json` is the source of truth. Whoever opens the
link sees whatever was last committed for today. While you type, edits are held as a
local draft in your browser until you publish them (commit + push).

## Files

- `index.html` — the page
- `styles.css` — styling
- `script.js` — builds the table, loads today's data, holds local drafts
- `data/` — one JSON file per day
