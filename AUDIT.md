# Daily audits — TEAL + Claude Code

The planner no longer renders daily audit tables. This document describes the
legacy local collector and the owner-only data it still writes:

- **Sherlocks · Worked On** — the distinct SLGs worked that day, taken from the
  SLG references on that day's TEAL holds and enriched with the record's title,
  customer, status, and time tracked. Each SLG number links straight into
  Sherlock. Falls back to the bare SLG numbers if the enriched list is absent.
- **TEAL · Time Tracked** — the categorized holds TEAL writes to your **TEAL**
  Outlook calendar that day (subject, category, SLG/DLG/QAN reference, minutes).
- **Claude Code · Session Activity** — what you worked on in Claude Code that
  day, one row per session (title, project, start–end, active time, messages).

The Sherlocks list is enriched from the local SLG Tracker title cache
(`slg-titles.js`, path in `config.json` → `slgTitlesPath`). Because titles and
customer names are customer-identifying, they only ever live in the
owner-read-only `audit/<date>` doc — never in this public repo.

They change per day because they're generated from that day's real activity.

## Why it's split from the web app

The planner is a **public** GitHub Pages site, but TEAL holds and Claude Code
session titles routinely contain **customer-identifying** data (customer names,
SLG/DLG/QAN numbers). So:

- The audit data lives in a separate Firestore collection, `audit/<YYYY-MM-DD>`,
  that is **owner-read-only** (see `firestore.rules`). Viewers and
  not-signed-in users get nothing. Nothing sensitive is ever committed to this
  public repo.
- A **local generator** (not in this repo — it lives at
  `%LOCALAPPDATA%\PlannerAudit` on David's machine, off OneDrive/git) reads the
  local TEAL calendar + Claude Code transcripts and writes the `audit/<date>`
  docs. It authenticates with a Google **service account** (a key file kept only
  on that machine), whose writes bypass the client rules.

```
TEAL Outlook calendar ─┐
                       ├─► Run-Audit.ps1 ─► audit/<date> (Firestore)
Claude Code .jsonl  ───┘   (daily task)      owner-read-only
```

## One-time setup (two manual steps only you can do)

1. **Publish the rules.** Firebase console → your project → Build → Firestore
   Database → **Rules** → paste the contents of `firestore.rules` → **Publish**.
   (This also tightens task/stats reads to only what viewers need.)

2. **Create the service-account key.** Firebase console → **Project settings**
   → **Service accounts** → **Generate new private key**. Save the downloaded
   JSON as:

   ```
   C:\Users\dthursto\AppData\Local\PlannerAudit\service-account.json
   ```

   Keep this file on your machine only — never commit it anywhere.

That's it. The daily task continues filling the owner-only collection.

## How refresh works

A Windows Scheduled Task named **PlannerAudit** runs
`%LOCALAPPDATA%\PlannerAudit\Run-Audit.ps1` **daily at 5:30 PM and at logon**.
Each run backfills the last 14 days (idempotent), so missing audit history from
a day the machine was off self-heals on the next run.

- Run it now:  `powershell -File "%LOCALAPPDATA%\PlannerAudit\Run-Audit.ps1"`
- Collect without uploading:  add `-NoUpload`
- Custom window:  `-Start 2026-08-01 -End 2026-08-11`
- Logs:  `%LOCALAPPDATA%\PlannerAudit\logs\`
- Change the time / disable:  Task Scheduler → **PlannerAudit**
