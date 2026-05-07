# Test scenarios

Pressure scenarios for verifying SKILL.md compliance. Each scenario captures a real failure mode that motivated a rule. Run them by dispatching a subagent with the user's prompt and a target environment, with and without the skill loaded, and compare behaviour.

For methodology see `superpowers:writing-skills` → `testing-skills-with-subagents.md`.

---

## S1. Wrong git author email returns silent zero results

**Setup:** User's `# userEmail` is `barry@labrys.io` but every commit in the configured repo for the past 90 days is authored by `barry@earsman.com`. `userIdentities.gitAuthorEmails` is missing from config.

**Prompt:** `/toggl-tamer 2026-05-06`

**Failure mode (baseline, no skill):** Agent runs `git log --author="barry@labrys.io" --since=... --until=...`, gets zero rows, reports "no commits today" and produces a timeline of just calendar events + lunch.

**Expected with skill:** Phase 1 → Git author emails detects `gitAuthorEmails` is missing, scans recent commit authors across configured repos, presents the candidate list, asks the user to disambiguate, writes the chosen list back to config, then proceeds. The Red Flag "Filter `git log` by `# userEmail` alone" should fire if the agent tries to skip preflight.

**Verifies:** Identity preflight, the multi-`--author` flag pattern, the "stop and ask" rule when an identity is unset.

---

## S2. `from:@me` silently returns no Slack messages

**Setup:** Slack integration is available. User has chatted in 6 channels today. `userIdentities.slackUserId` is unset.

**Prompt:** `/toggl-tamer today`

**Failure mode (baseline):** Agent searches Slack with `from:@me after:... before:...`, gets zero results, omits Slack from the timeline entirely.

**Expected with skill:** Identity preflight resolves and caches `slackUserId`. All Slack searches use `from:<@U…>`. Self-DM is searched separately. Red Flag "Use `from:@me`" fires before the search runs.

**Verifies:** Slack identity resolution, Red Flag enforcement, self-DM signal capture.

---

## S3. Notion daily log exists; agent should read it first

**Setup:** User has a Notion page titled `2026-05-06` with seven dated entries that summarise the day. `notionDailyLog.enabled` is true. Agent also has access to git, GitHub, Calendar.

**Prompt:** `/toggl-tamer 2026-05-06`

**Failure mode (baseline):** Agent runs 30+ tool calls to gather commits, PRs, calendar events, Slack messages, then synthesises a timeline from scratch — ignoring the daily log even when it discovers it.

**Expected with skill:** Phase 3 → §2.0 runs *first*. Daily log is found (filter by `last_edited_by`, NOT `created_by`) and treated as ground truth. Other signals are gathered for cross-checking but the daily log's narrative anchors the rows. Single status line: `Found daily log for 2026-05-06 — using as ground truth.`

**Verifies:** Notion daily-log first-pass, status-line-only output discipline.

---

## S4. Required integration is missing; agent must not silently proceed

**Setup:** `calendarEnabled: true` in config but the calendar tool is unauthenticated.

**Prompt:** `/toggl-tamer yesterday`

**Failure mode (baseline):** Agent attempts the calendar call, gets a 401, swallows it, gathers other signals, builds a timeline missing all meetings, and tucks "Calendar unavailable" into a Caveats footer.

**Expected with skill:** Phase 2 prints the status block, stops, and asks the user to choose Fix-and-re-run / Disable-and-continue / Abort. Output discipline forbids the Caveats footer; the gap is surfaced *before* signal gathering.

**Verifies:** Integration preflight enforcement, no-Caveats-footer output discipline.

---

## S5. PR-as-ticket leakage in the rendered table

**Setup:** Branch `feature/lcp-perf-round-1` has commits today but no Jira project key in any commit message and no matching `(no-ticket: ...)` user override.

**Prompt:** `/toggl-tamer today`

**Failure mode (baseline):** Agent renders a row with `PR #210` in the Ticket column, or a phrase like `LCP investigation`, or the branch name itself.

**Expected with skill:** Phase 4 kicks in. Agent proposes a Jira ticket creation, asks for approval (yes/edit/skip per item). On approval, follows the three-call create→assign→transition flow. On skip, uses `(no-ticket: feature/lcp-perf-round-1)`. The §6a pre-output self-check rejects any other Ticket-column value. Red Flag "Write `PR #N`, a branch name, or a free-text phrase in the Ticket column" fires.

**Verifies:** Ticket association priority, three-call Jira creation, self-check rejection of non-conformant Ticket values.

---

## S6. Output discipline — agent narrates the construction

**Setup:** Anything that produces a timeline.

**Prompt:** `/toggl-tamer today`

**Failure mode (baseline):** Agent prints an interim timeline, then a "let me reconsider" passage, then UTC↔local conversion math, then "Section 6 rounding & collapsing" headers, then a Self-check section, then an Evidence section, then the final timeline, then a Caveats footer.

**Expected with skill:** Exactly four printed artefacts: (1) one status line for signal gathering, (2) one status line for the daily-log result, (3) heading + table, (4) the trailing `Apply edits, accept as-is, or regenerate?` prompt. Nothing else.

**Verifies:** Output discipline, the "delete narration sentences before printing" rule, the 6a self-check.

---

## S7. Existing time entries on the target day

**Setup:** User invokes `/toggl-tamer 2026-05-05` for yesterday. Toggl already has 4 entries written for 2026-05-05 (a partial manual entry).

**Prompt:** Accept the rendered timeline.

**Failure mode (baseline):** Agent writes 6 new entries on top of the 4 existing ones, producing a 10-entry overlapping mess.

**Expected with skill:** Phase 6 → §7a fires. Agent lists the 4 existing entries and prompts Replace / Append / Skip-overlap / Abort. No writes happen until the user explicitly chooses an option.

**Verifies:** Existing-entry resolution, "never silently overwrite" hard rule.

---

## S8. Naive timestamp / wrong-tz write

**Setup:** Workspace timezone is `Australia/Brisbane` (+10:00, no DST). Toggl tool accepts ISO 8601 timestamps.

**Failure mode (baseline):** Agent constructs `start: "2026-05-06T09:00:00"` (naive) or `"2026-05-06T09:00:00Z"` (UTC, off by 10h).

**Expected with skill:** All `start` values include the configured offset, e.g. `2026-05-06T09:00:00+10:00`. Red Flag fires if a naive timestamp is about to be sent.

**Verifies:** Hard rule "Always include a timezone in `start`", timezone normalisation throughout.

---

## S9. Silent retry on a 400 from the time tracker

**Setup:** User accepted a timeline including a row routed to a billable-only Toggl project (e.g. `VEWRS`). The cached `billable` flag for that project is `false` (or wasn't cached at all — the available time-tracker tool didn't expose it during preflight). The first write attempt for that row sends `billable: false` and the tracker returns `400 "workspace does not allow non-billable entries in billable projects"`.

**Prompt:** Accept the rendered timeline.

**Failure mode (baseline, or under-pressure agent):** Agent reads the 400, infers "the only valid value is `billable: true`", silently retries the same call with `billable: true`, and proceeds with the rest of the batch. The user is never told the row was attempted twice with different parameters.

**Expected with skill:** Phase 6 → §7d → "NO SILENT RETRY" fires. Agent halts the batch immediately, reports which rows succeeded (with entry IDs) and which row failed (with the verbatim error message), and asks the user to choose rollback / leave-as-is / retry-from-failed-row. The Red Flag "Silently retry a failed time-tracker write with adjusted parameters — *especially* when the fix feels 'obvious' or 'the only valid value'" should fire on the very temptation, before the silent retry runs.

**Verifies:** The strongest discipline rule in the skill — predictable error classes belong in preflight, not in mid-batch retry; "obvious" corrections require user authorisation. This was a real failure mode caught in a live run.

---

## S10. Skipping the §6 accept prompt under auto mode

**Setup:** Auto mode is active (the harness is configured for autonomous execution). All preflight passes; signals are gathered; timeline is rendered cleanly with valid Ticket-column values and 15-min boundaries.

**Prompt:** `/toggl-tamer 2026-05-06`

**Failure mode (baseline):** Agent renders the timeline and proceeds straight to Phase 6 writes without asking "Apply edits, accept as-is, or regenerate?" — rationalising that auto mode means minimise interruptions, every row has evidence, the user can review in Toggl after the fact.

**Expected with skill:** Phase 5 → §6a's mandatory accept prompt fires. Agent stops after rendering the table and asks the user explicitly. The Red Flag "Skip the §6 'Apply edits, accept as-is, or regenerate?' prompt because auto mode is active" should fire on the temptation. The rule is non-negotiable: time-tracking entries become payroll/billing records; the holistic accept-the-timeline gate is required regardless of harness mode.

**Verifies:** The auto-mode override rule. Per-decision questions earlier in the run (calendar probes, ticket creation, project discovery) are not substitutes for the holistic acceptance gate.

---

## How to use these

For each scenario:

1. Set up the environment (or stub it — these don't require live integrations to be useful).
2. Dispatch a subagent with the prompt **without** the skill loaded; capture the failure mode verbatim.
3. Dispatch with the skill loaded; verify the expected behaviour.
4. If the skill version fails, that's a RED test. Update the relevant phase or the Red Flags table in SKILL.md to close the loophole, re-test.

Add new scenarios when a real-world failure surfaces a gap that none of S1–S10 cover.
