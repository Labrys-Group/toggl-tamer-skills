---
name: toggl-tamer
description: Use when the user says "toggl", "timesheet", "time tracking", "what did I do today/yesterday", or supplies a date for daily timeline reconstruction.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD]"
---

# Toggl Tamer

Reconstruct the user's work for a single day as a ticket-centric timeline suitable for time-tracking entry, by combining evidence from calendar, git history, pull requests, issue trackers, Notion, and Slack into a non-overlapping timeline. This SKILL.md is a router — detailed steps live in `references/`.

## Phases (read top-to-bottom)

| # | Phase | Reference |
|---|-------|-----------|
| 0 | Load or auto-discover config | `references/config-schema.md`, `references/auto-discovery.md` |
| 1 | **Identity preflight** (resolve git/Slack/Notion/Atlassian IDs — silent-failure prevention) | `references/identity-preflight.md` |
| 2 | Integration availability preflight | `references/integration-preflight.md` |
| 3 | Establish day window + gather signals (Notion daily-log first) | `references/signal-gathering.md` |
| 4 | Associate commits/PRs to tickets (incl. internal pseudo-project) | `references/ticket-association.md` |
| 5 | Build per-ticket timeline, merge, render (rounded to 15min) | `references/timeline-build.md` |
| 6 | Write to time tracker (after user accepts the rendered timeline) | `references/toggl-write.md` |

**The argument** is the target date: `/toggl-tamer [YYYY-MM-DD]`. If no date is supplied, default to **today** in the user's local timezone. Accept also `yesterday`, `today`, or a weekday name; resolve to an absolute date before proceeding.

## Output discipline (applies throughout)

The user wants the **final timeline**, not a play-by-play of how you built it. Keep all reasoning, scratch work, timezone arithmetic, per-block deliberation, rounding mechanics, and self-check output **internal** — do not print it.

**Do not emit any of these to the user:**
- Narration like "Now constructing the timeline." / "Let me lay out the rounded timeline" / "Re-converting UTC offsets..."
- UTC↔local conversion tables, per-PR/commit timestamp dumps, or "Wait — let me reconsider" passages
- Pre-rounding draft timelines followed by a rounded version (only print the final one)
- "Per-ticket blocks" / "Section 6 rounding" / "Self-check (6a)" headers showing your process
- Restating signals you already gathered before rendering the table
- "Total: X matches workday ✓" lines — keep self-check internal; only surface drift if it fails

**Do emit, in this order, and nothing else:**
1. A **single short status line** before signal gathering (e.g. `Gathering signals for 2026-05-06…`)
2. A **single short status line** if a Notion daily log was found (e.g. `Found daily log for 2026-05-06 — using as ground truth.`) or not (`No Notion daily log for 2026-05-06; reconstructing from signals.`)
3. The **final rendered output**: heading and the table only — no Evidence section, no Caveats block, nothing between or around them
4. The single trailing prompt: `Apply edits, accept as-is, or regenerate?`

Evidence is gathered and used internally to anchor each row, but **never printed**. If you catch yourself writing a sentence that explains how you arrived at a row, delete it — it stays in your head.

Caveats are also internal-only. If a hard blocker occurred (identity preflight failed, a required integration unavailable, no signals at all), surface it as a question or error *before* attempting to render the timeline — never as a footer on a rendered table.

## Clarifying-question style (applies throughout)

When you need information from the user — config gaps, identity disambiguation, ticket-creation approval, timeline edits, write confirmations — **ask one question at a time**. Never emit a wall of text containing multiple questions the user has to answer all at once.

Preferred forms, in order:
1. **A single `AskUserQuestion` widget** with a focused prompt and a small set of options (or free-text). One concept per call.
2. **A short numbered/multiple-choice prompt** in plain text when no widget tool is available — but still only one decision per turn.
3. Free-text prompt — last resort, and still scoped to one decision.

If you have several unresolved questions, queue them and ask sequentially, using the previous answer to inform the next. Do not batch them into a single message like "Also, please confirm: (a) … (b) … (c) …".

The only exceptions are **review-and-approve batches** that are inherently a single decision over many items — e.g. "approve / edit / skip" on a list of proposed new tickets, or "yes / edit / abort" on the Toggl write batch. Those are one decision presented over a structured list, not multiple independent questions.

## Common Pitfalls (concept-level — easy to forget mid-task)

These are mistakes about *how the world works*. Each one has a single authoritative home in `references/`; they're listed here only so they're discoverable from this top-level file.

- **Commit time ≠ work time.** Commits are end-of-work signals. Use file mtimes / Slack / state changes to find the start. *(timeline-build.md)*
- **Notion edits are end-of-work signals**, just like commits. Anchor a block's `start` to other evidence; subtract a 15-min lead-in if Notion is the only signal. *(timeline-build.md)*
- **Jira state changes after commits are not start signals.** Many users move tickets to "In Progress" only when they go to commit. *(timeline-build.md)*
- **Calendar events are evidence-weighted, not unconditionally fixed.** Recurring slots get accepted and never happen. Probe uncorroborated > 30min events with a yes/no before anchoring. *(signal-gathering.md §2a, timeline-build.md §5)*
- **Don't fill every gap.** No evidence → `[unaccounted]`, not extended neighbouring blocks. *(timeline-build.md §5)*
- **Continuation blocks are assumptions, not evidence.** Always label them `kind: "carryover"` so the user can see the difference between observed work and inferred handoff. *(timeline-build.md §4a)*
- **Timezones** — most signal sources return UTC by default; normalise to `workdayDefaults.timezone` before comparing or rendering. *(signal-gathering.md)*
- **File mtimes are unreliable on macOS.** Spotlight, format-on-open, and `git checkout` rewrite them wholesale. *(signal-gathering.md §2g)*
- **Internal/non-project time has a home.** Use the `(internal)` pseudo-project for meetings, ticket triage, code review on others' PRs. Without it, real time is dropped. *(ticket-association.md §3a)*
- **Discover Jira projects from commit messages, not just JQL.** Users who don't move tickets in Jira are invisible to assignee/reporter/comment queries. *(auto-discovery.md)*
- **Discover Toggl projects from signals every run, not just first config.** A free-text mention of a Toggl project name (Slack, calendar, Notion) is a signal that the user touched that project — surface it for confirmation before routing the row to a fallback. *(auto-discovery.md → "Discovering project names from signals")*
- **Scan ALL local repos for commits, not just configured project repos.** Users commit to side repos, tooling, MCP servers, scratch projects — work in those repos is silently invisible if you only scan `projects[].repos[]`. Auto-discover `~/projects`, `~/code`, `~/dev`, `~/src` every run; treat findings as discovery candidates. *(signal-gathering.md §2b)*
- **Toggl projects can be billable-only.** Cache each project's `billable` flag in preflight; pass `billable: true` at write time when the resolved project is billable. Discovering this mid-batch via a 400 response is forbidden. *(integration-preflight.md, toggl-write.md §7b)*

## Red Flags — STOP and re-check

Pre-action stop signals. Each maps to a hard rule in a reference file. If you catch yourself about to do any of these, stop:

| If you're about to... | Stop because... | Where the rule lives |
|---|---|---|
| Filter `git log` by `# userEmail` alone | Wrong email = silent zero results = confidently-wrong "you did nothing" | `identity-preflight.md` |
| Use `from:@me` in any Slack search | Silently returns nothing in many workspaces | `identity-preflight.md` |
| Call `currentUser()` JQL when `atlassianAccountId` is unset and required | JQL silently fails on some sites | `identity-preflight.md` |
| Skip the Notion daily log when `notionDailyLog.enabled` is true | The user already wrote down the day; rebuilding from 30 signals is worse and slower | `signal-gathering.md §2.0` |
| Proceed with a missing required integration without explicit user approval | Silent partial-signal runs produced confidently-wrong timelines | `integration-preflight.md` |
| Write `PR #N`, a branch name, or a free-text phrase in the `Ticket` column | Output is ticket-centric. Use the tracker key, `(no-ticket: <branch>)`, or a meta label | `ticket-association.md` |
| Create a Jira issue with assignee+status in one call | Tooling silently drops them. Use create → assign → transition (3 calls) | `ticket-association.md` |
| Insert a carryover block automatically without asking | Carryover is an assumption, not evidence. Ask once. | `timeline-build.md §4a` |
| Print interim/draft timelines, "let me reconsider" passages, conversion math, Self-check headers, an Evidence section, or a Caveats section | Output discipline above; the user wants exactly heading + table + trailing prompt | `timeline-build.md §6` (and Output discipline above) |
| Skip the §6 "Apply edits, accept as-is, or regenerate?" prompt because auto mode is active | The accept-the-timeline prompt is mandatory in every run, including auto mode. Time-tracking entries become payroll/billing records — the user must explicitly accept the rendered table before any write. Auto mode minimises interruptions for routine decisions; it does NOT skip the holistic acceptance gate. | `timeline-build.md §6a` |
| Silently default `internalProject.togglProjectName` to whichever Toggl project name "looks internal" during auto-discovery | Different workspaces have different catch-all conventions ("Internal Process", "Admin & Housekeeping", "Internal / Ops"). Silently picking one will misclassify hours that are hard to find later. List candidates and ask. | `auto-discovery.md` Gap order step 5 |
| Write a time entry while existing entries already exist for the day | Run the existing-entry resolution prompt (Replace / Append / Skip-overlap / Abort) first | `toggl-write.md §7a` |
| Write a time entry with a naive `start` (no timezone offset) or non-positive duration | Most trackers reject these | `toggl-write.md` |
| Use a "start a running timer now" operation to back-fill a past day | That kind of operation only starts a timer at the current moment and cannot record past work | `integration-preflight.md`, `toggl-write.md` |
| Anchor a work block on an accepted but uncorroborated calendar event > 30min | Recurring slots get accepted by default and never happen. A "fixed" anchor for a meeting that didn't happen distorts the entire day. Probe with one yes/no first. | `signal-gathering.md §2a`, `timeline-build.md §5` |
| Silently retry a failed time-tracker write with adjusted parameters (flipped `billable`, swapped project, changed timestamp) — *especially* when the fix feels "obvious" or "the only valid value" | §7d requires stopping the batch and prompting the user. Quietly mutating the call to make it succeed is a violation, even when the new parameters work — the user must be told what failed. **The instinct that the correction is deterministic and safe is exactly the rationalisation the rule was designed to forbid.** Predictable error classes belong in preflight, not in mid-batch retry. | `toggl-write.md §7d` "NO SILENT RETRY" |
| Route a row to the internal/ops fallback when a free-text signal in the day mentions a known Toggl project name | The user touched a real project that isn't in `projects[]`. Surface it once for confirmation; don't silently misroute billable client time to the catch-all. | `auto-discovery.md` → "Discovering project names from signals" |
| Limit `git log` scanning to repos listed in `projects[].repos[]` only | Users commit to side repos / tooling / MCPs that aren't in `projects[]`. That work becomes silently invisible — misrouted to `(internal)` or omitted. Auto-discover `~/projects` etc. every run. | `signal-gathering.md §2b` |
| Route a non-configured repo's commits to `(internal)` | `(internal)` is for non-code time only. Code with no clear project home → propose a ticket (§3) or use `(no-ticket: <branch>)`. Don't conflate. | `signal-gathering.md §2b`, `ticket-association.md §3a` |

## When the day looks empty

- Config file missing → run interactive setup (auto-discovery.md), do not guess.
- Auto-discovery returned nothing (no GitHub, no Atlassian, no local repos) → fall back to manual entry and tell the user *why*.
- No commits, no PRs, no calendar events → ask the user if it was a working day before fabricating a timeline. Do not stretch evidence to fill the gap.
- Total accounted time differs from `endTime - startTime - lunch` by more than 90 minutes → flag it; do not stretch evidence to fill.
- Any *single* signal source returned zero hits today while others have signal → likely an unconfigured author email or Slack ID. Stop and ask before printing.
