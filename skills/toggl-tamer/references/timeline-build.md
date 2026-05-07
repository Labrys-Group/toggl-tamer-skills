# Building, merging, and rendering the timeline

Covers per-ticket block construction, de-overlapping, the carryover prompt, rounding, and the final output shape and self-check.

## 4. Build a per-ticket timeline

For each ticket touched today, produce a `{start, end, ticket, summary, evidence[]}` block:

- **end** = timestamp of the last commit / PR / Notion edit activity for that ticket on this day. If the only signal is a Jira state change, use that timestamp.
- **start** = inferred earliest moment the user was working on this ticket today. Use the **earliest** of:
  - Earliest commit timestamp on that ticket today
  - Earliest file mtime among files changed in those commits (only if ≥ `dayStart` and the mtime sanity check passed — see signal-gathering.md §2g)
  - Earliest Slack message that day mentioning the ticket key, the branch, or related keywords
  - Earliest Notion page edit on that ticket (Notion edits are end-of-work signals; subtract a 15-minute lead-in for the start signal)
  - Jira state change timestamp (e.g. moving to In Progress) — but only if it's *before* the earliest commit; state changes that happen *after* commits are not start signals.
  - If none of the above bound the start, default to **15 minutes before the first commit**.

- **evidence[]** = list of `(kind, timestamp, ref)` tuples that justify the block. Used internally only — never printed.

Cap any single block at a sensible length — if `start` would be more than 3 hours before `end` with no intermediate evidence, shorten it to `end - 90min`.

## 4a. Carryover prompt (one-line, not a heuristic)

If there is a gap between `workdayDefaults.startTime` and the day's earliest evidence-backed block, **and** `previousDayLastTicket` is set, *do not* automatically insert a carryover block. Instead, surface a one-line prompt with the timeline:

> You last touched LW2-221 yesterday at 16:34. Continue from there to fill the 09:00–10:12 gap?

If the user confirms, insert a single block over the gap with `ticket = previousDayLastTicket.ticket` and the evidence entry `{kind: "carryover", timestamp: previousDayLastTicket.lastSignalAt}`. If they decline or ignore the prompt, leave the gap as `[unaccounted]`.

## 5. Combine and de-overlap

Merge all per-ticket blocks plus calendar events into a single ordered timeline:

1. **Calendar events are anchors only after classification** (see signal-gathering.md §2a). Strong (corroborated, or short non-blocking) events behave as fixed: truncate any work block that overlaps to end at the event start, and resume after the event ends. **Weak (uncorroborated, > 30min) events must be probed via a single yes/no prompt before being treated as anchors** — if the user says it didn't happen, drop the event and let surrounding work blocks expand into the slot. Never anchor on an event the user couldn't confirm and that has no other evidence.
2. **Resolve work-block overlaps** by truncating the earlier block's `end` to the later block's `start` (the user can only do one thing at a time). When choosing which block "owns" the contested time, prefer the block with the most evidence in that window.
3. **Insert lunch** as a single fixed block of `lunchMinutes` near `lunchAroundTime`, snapping to a gap if one exists within ±60min of that time. If no gap exists, displace the lowest-evidence work block to make room.
4. **Bound the day** by `startTime` and `endTime`. Pull in the earliest block's start to no earlier than `startTime` and push the latest block's end to no later than `endTime` unless evidence (e.g. a commit at 19:00) clearly contradicts it — in that case keep the evidence and note the override internally.
5. **Fill gaps** > 30 minutes between work blocks with an `[unaccounted]` marker so the user can fill them in manually rather than silently extending neighbouring blocks.

## 6. Output

Render the timeline as a markdown table — **heading and table only, nothing else**. No Evidence section. No Caveats section. No narration. See SKILL.md "Output discipline".

The `Ticket` column must contain **only** one of: a tracker key (`ACME-123`, `#45`), `(no-ticket: <branch>)`, `(calendar)`, `(lunch)`, `(internal)`, `(notion: <title>)`, `(carryover: <ticket>)`, or `[unaccounted]`. PR numbers, branch names, and ad-hoc labels like "LCP investigation" are **not** valid values for this column — they belong in the Summary.

Evidence (timestamps, commit SHAs, PR URLs, mtime tuples) is gathered and used internally to anchor each row's `start`/`end`/`ticket`/`summary`. It is **not printed**. The user audits via the Toggl UI after the write phase, not via an evidence dump.

### Rounding and collapsing (avoid false precision)

Toggl entries shorter than ~15 minutes are noise. Showing `09m`/`12m` blocks creates an impression of timeline accuracy that the underlying signals don't support.

Apply these transforms to the rendered timeline (keep precise timestamps internally for the write phase):

1. **Round Start and End to the nearest 15 minutes** in the table — `15:47–15:56` becomes `15:45–16:00`. Compute `Duration` from the rounded values.
2. **Collapse adjacent same-ticket rows** separated only by sub-15-min cleanup blocks. Example: a `LW2-222` block 15:47–15:56 followed immediately by a `LW2-223` block 15:56–16:22 → emit as one row if the user confirms (or, if you can tell from internal evidence, fold the shorter one into the longer one with a merged summary).
3. **Drop sub-5-minute fragments** entirely after rounding — they round to a 0-minute row and add only noise.
4. After rounding, recompute durations and re-check that the day still adds up to within 30 min of `endTime - startTime - lunch`. If rounding pushes total drift past that threshold, ask the user about it before printing rather than printing a Caveats block.

### Example output (the COMPLETE output — heading, table, trailing prompt; nothing else)

```
# Toggl Tamer — 2026-05-06

| Start | End   | Duration | Ticket     | Summary                                              |
|-------|-------|----------|------------|------------------------------------------------------|
| 09:00 | 10:15 | 1h 15m   | ACME-204   | Implemented login form validation                    |
| 10:15 | 11:00 | 0h 45m   | (calendar) | Sprint planning                                      |
| 11:00 | 12:30 | 1h 30m   | ACME-211   | Fixed race condition in payment webhook              |
| 12:30 | 13:30 | 1h 00m   | (lunch)    | —                                                    |
| 13:30 | 15:00 | 1h 30m   | INT-17     | Drafted internal tools dashboard                     |
| 15:00 | 17:30 | 2h 30m   | ACME-204   | Reviewed feedback and merged login work              |

Apply edits, accept as-is, or regenerate?
```

## 6a. Pre-output self-check

Before printing, scan the rendered table and verify:

- [ ] Every `Ticket` column value matches one of the allowed forms above. If you see `PR #...`, a branch name, a phrase like "LCP investigation", or any free-text label, you have a bug — go back to ticket-association and create the missing ticket(s) (or mark them `(no-ticket: <branch>)` if the user declined).
- [ ] No two adjacent rows reference the same ticket without an intervening calendar/lunch/different-ticket row — merge them.
- [ ] Each non-meta row is internally backed by at least one signal (commit, PR, calendar, Notion, Slack, or carryover confirmation). Don't print this evidence — just verify it exists for every row.
- [ ] Start/End values are at 15-minute boundaries (rounding applied). No `09m` / `12m` durations remain visible.
- [ ] Identity preflight ran and `gitAuthorEmails` / `slackUserId` are present in config — not silently using `# userEmail` and `from:@me`.
- [ ] If any *signal source* returned zero hits today, **stop and ask the user before printing** rather than printing a Caveats footer.
- [ ] The output contains exactly: heading, table, trailing prompt. **No Evidence section, no Caveats section, no narrative paragraphs.** If any of those are present, delete them before printing.

If any check fails, fix the timeline and re-run the check. Do not output a timeline that fails this check.

After printing the timeline, **ask the user**: "Apply edits, accept as-is, or regenerate?" Loop on edits/regenerate until the user accepts. Once accepted, proceed to the write phase.

**This prompt is mandatory in every run, including auto mode.** The skill writes to a system the user audits manually (Toggl entries become payroll/billing records). Auto mode means *proceed-when-uncertain on routine decisions*; it does NOT mean *skip the user's review of the rendered timeline before mutating their time-tracker*. A run that writes to Toggl without surfacing the rendered table for explicit acceptance is a violation, even if every individual row was correct.

Common rationalisations for skipping the accept prompt — all forbidden:

| Rationalisation | Why it's still forbidden |
|---|---|
| "Auto mode says minimise interruptions." | Time-tracking entries are not routine. The user accepts each day's timeline as a single decision. |
| "The user will see the entries in Toggl after I write them." | Reviewing-after-the-fact in a separate UI is much more effort than reviewing-before-write in this conversation. |
| "Every row has evidence; the timeline is correct." | Correctness of *rows* is not the same as correctness of *the day*. The user might want a row dropped, merged, or relabelled. |
| "I asked clarifying questions earlier in the run." | Per-decision questions are not the same as the holistic accept-the-timeline review. Both are required. |
