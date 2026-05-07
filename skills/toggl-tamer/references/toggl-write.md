# Writing to the time tracker

Run this section only when `togglEnabled: true` AND the user accepted the timeline. If `togglEnabled: false`, print "Time-tracker write disabled — preview only." and stop.

The skill calls this "Toggl" by convention, but any time-tracking backend that supports the operations described below (list/create/delete entries, list projects) is acceptable. Use whichever tool is available in the session — MCP, CLI, or REST API — and substitute the equivalent operation wherever the steps name a specific call.

## 7a. Check for existing entries on the target day

Before writing anything, list time entries for the target day. If the response is non-empty, **stop and prompt** the user with the existing entries listed (description, project, start, duration). Offer four options:

1. **Replace** — delete every existing entry for that day, then write the new timeline. Confirm the deletion list one more time before deleting.
2. **Keep and append** — leave existing entries alone, write the new ones alongside. Warn that this will likely produce overlapping entries; show the overlap count.
3. **Keep, skip overlapping** — for each new row whose `[start, end)` interval overlaps any existing entry, skip it. Write only the non-overlapping rows. Report which rows were skipped.
4. **Abort** — write nothing; exit cleanly.

If the response is empty, proceed directly to 7b without prompting.

## 7b. Map timeline rows to time-tracker entries

Iterate the **rounded** timeline. For each row:

- Skip rows whose `Ticket` value is in `togglWrite.skipMeta` (default: `(lunch)`, `[unaccounted]`).
- Resolve the tracker project name:
  - For rows tied to a configured project → that project's `togglProjectName`.
  - For `(internal)` rows → `internalProject.togglProjectName`.
  - For `(calendar)`, `(notion: ...)`, `(no-ticket: ...)`, `(carryover: ...)` → use the project of the most relevant signal in the row's evidence; if none can be determined, fall back to `internalProject.togglProjectName`. If that's also unset, prompt the user once for a project name to use as the catch-all and cache it as `togglWrite.fallbackProjectName` in config.
- Build the `description`: `<TicketKey> — <Summary>` for ticket rows; `<Summary>` alone for `(calendar)`/`(internal)`/`(notion: ...)` rows. Trim to ≤ 200 chars. **If ≥ 2 PRs back the same ticket-row, append the PR list in parentheses** (e.g. `LW2-228 — Strip /us prefix in middleware (PRs #216–#220)`) so the user can audit the row against the PR set later.
- Compute `start` as an ISO 8601 timestamp **with the configured timezone offset** (not UTC, not naive). Example: `2026-05-06T09:00:00+10:00` for Brisbane.
- Compute `duration_minutes` from `End - Start` of the rounded row. If the result is < 1 minute, drop the row and note it.
- If `togglWrite.tagWithTicket` is true and the ticket value is a real tracker key (matches `^[A-Z]+-\d+$` or `^#\d+$`), pass it as a tag.
- **Resolve the row's billable flag** from the cached project metadata (see integration-preflight.md "Probe Toggl projects' billable flag"). If the resolved project is billable, pass `billable: true` on the create call. Workspaces that forbid non-billable entries on billable projects return a 400 (`"workspace does not allow non-billable entries in billable projects"`) — discovering this mid-batch and silently retrying is forbidden (see Hard rules below).

## 7c. Confirm the write batch

Print the proposed write as a compact table — one row per planned entry — and ask: "Write these N entries to the time tracker? (yes / edit / abort)". Show the total minutes about to be written and the count, so the user can sanity-check against the day's accounted total. Do not proceed without explicit `yes`.

## 7d. Execute the writes

Create one time entry per row, **sequentially** (not in parallel — most trackers rate-limit and an out-of-order failure is hard to reason about mid-batch). For each call, capture the returned entry ID. If a call fails:

1. Stop the batch immediately. Do not continue writing further entries.
2. Print which rows succeeded (with their entry IDs) and which row failed (with the error message verbatim).
3. Ask the user whether to **roll back** (delete the successful entries), **leave as-is** (partial write), or **retry from the failed row**.

### NO SILENT RETRY — even if you "know" the fix

A 400 from the time tracker is a STOP signal, full stop. The instinct to fix-and-retry mid-batch ("the only valid value is `billable: true`, so I'll just retry with that") is forbidden. **Even when the corrective action is obvious and would succeed, you must halt and surface the failure to the user.** Reasons:

- The user has not authorised that specific change. Auto-correcting hides it from them.
- "Obvious" corrections aren't always correct — a 400 saying "non-billable forbidden on billable project" might really mean the project was misclassified, the user wants this row routed elsewhere, or this row shouldn't exist at all.
- A class of error that's *predictable* (billable-only projects, project-name mismatches, missing tags) belongs in preflight, not in mid-batch retry. If you're tempted to silently fix it at write time, the real fix is to add a preflight check that catches it before any write happens. Add the rule to integration-preflight.md and stop the batch this time.

Common rationalisations for silent retry — all forbidden:

| Rationalisation | Why it's still forbidden |
|---|---|
| "The 400 message tells me exactly what to flip — `billable: true`. The retry is deterministic." | Not your call. The user accepted a batch with `billable: false`. Surface the mismatch. |
| "Auto mode says minimise interruptions." | Auto mode is for routine decisions. A failed write is not routine. |
| "Halting will lose user time; the retry is faster." | Speed is not the optimisation target. The user has time-tracking entries on the line; getting them right matters more than getting them now. |
| "I'll halt next time but this one's clearly safe." | Every silent retry felt clearly safe to whoever made it. Halt and surface. Always. |

## 7e. Confirm and link

After a successful batch, print a summary: count of entries written, total minutes, and (if known) a link to the user's tracker day view. Suggest the user double-check the tracker UI before closing the loop.

## Hard rules for the write phase

- **Never write without an accepted timeline.** If the user is still iterating in the rendered output, do not proceed.
- **Never silently overwrite existing entries.** If 7a finds entries on the target day and the user doesn't pick "Replace", existing entries are off-limits.
- **Always include a timezone in `start`.** Most trackers reject naive timestamps. Use `workdayDefaults.timezone` to construct the offset.
- **Sequential writes only.** Parallel time-entry writes are not safe for partial-failure reasoning.
- **Surface the project-name mismatch loudly.** If a row's resolved tracker project doesn't exist at write time (it was deleted/renamed since preflight), abort the batch — don't write the entry projectless.
- **Never silently retry a failed write with adjusted parameters.** §7d requires stopping the batch and prompting the user (rollback / leave / retry) on any failure. Quietly flipping `billable`, swapping a project, or changing the timestamp to make the call succeed is a violation, even if the new parameters work. The user must be told what failed and choose the resolution. (If a class of error is *known* and *predictable* — e.g. billable-only projects when the flag is missing — fix it in preflight, not at write time.)
