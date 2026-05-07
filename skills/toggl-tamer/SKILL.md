---
name: toggl-tamer
description: Use when the user says "toggl", "timesheet", "time tracking", "what did I do today/yesterday", or supplies a date for daily timeline reconstruction.
disable-model-invocation: true
argument-hint: "[YYYY-MM-DD]"
---

# Toggl Tamer

Reconstruct the user's work for a single day as a ticket-centric timeline suitable for time-tracking entry, by combining evidence from calendar, git history, pull requests, issue trackers, Notion, and Slack into a non-overlapping timeline. Then write the accepted timeline to the time tracker.

**The argument** is the target date: `/toggl-tamer [YYYY-MM-DD]`. If no date is supplied, default to **today** in the user's local timezone. Accept also `yesterday`, `today`, or a weekday name; resolve to an absolute date before proceeding.

## Phases (read top-to-bottom)

| # | Phase | What it does |
|---|-------|--------------|
| 0 | Load or auto-discover config | Build/read `projects[]`, identities, integration flags |
| 1 | Identity preflight | Resolve git/Slack/Notion/Atlassian IDs — silent-failure prevention |
| 2 | Integration availability preflight | Probe gh/Jira/Calendar/Slack/Notion/Toggl/git; cache Toggl `billable` flags |
| 3 | Establish day window + gather signals | Notion daily-log first; calendar; commits across all local repos; PRs; issues; Slack; Notion edits; mtimes; previous-day's last ticket; project-name discovery |
| 4 | Associate commits/PRs to tickets | Priority match; orphan-group ticket creation (3-call Jira flow); internal/ops pseudo-project |
| 5 | Build per-ticket timeline, merge, render | Per-ticket blocks; carryover prompt; de-overlap; lunch; rounding; output discipline; self-check |
| 6 | Write to time tracker | Existing-entry resolution; project + billable resolution; sequential writes; NO silent retries |

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

## Red Flags — STOP and re-check

Pre-action stop signals. Each maps to a hard rule below. If you catch yourself about to do any of these, stop:

| If you're about to... | Stop because... |
|---|---|
| Filter `git log` by `# userEmail` alone | Wrong email = silent zero results = confidently-wrong "you did nothing". See Phase 1 → Git author emails. |
| Use `from:@me` in any Slack search | Silently returns nothing in many workspaces. See Phase 1 → Slack user ID. |
| Call `currentUser()` JQL when `atlassianAccountId` is unset and required | JQL silently fails on some sites. See Phase 1 → Atlassian account ID. |
| Skip the Notion daily log when `notionDailyLog.enabled` is true | The user already wrote down the day; rebuilding from 30 signals is worse and slower. See Phase 3 → 2.0. |
| Proceed with a missing required integration without explicit user approval | Silent partial-signal runs produced confidently-wrong timelines. See Phase 2. |
| Write `PR #N`, a branch name, or a free-text phrase in the `Ticket` column | Output is ticket-centric. Use the tracker key, `(no-ticket: <branch>)`, or a meta label. See Phase 4. |
| Create a Jira issue with assignee+status in one call | Tooling silently drops them. Use create → assign → transition (3 calls). See Phase 4 → Jira creation flow. |
| Insert a carryover block automatically without asking | Carryover is an assumption, not evidence. Ask once. See Phase 5 → 4a. |
| Print interim/draft timelines, "let me reconsider" passages, conversion math, Self-check headers, an Evidence section, or a Caveats section | Output discipline above; the user wants exactly heading + table + trailing prompt. |
| Skip the §6 "Apply edits, accept as-is, or regenerate?" prompt because auto mode is active | The accept-the-timeline prompt is mandatory in every run. Auto mode does NOT skip the acceptance gate. See Phase 5 → 6a. |
| Silently default `internalProject.togglProjectName` to whichever Toggl project name "looks internal" during auto-discovery | Different workspaces have different catch-all conventions. List candidates and ask. See Phase 0 → Gap order step 5. |
| Write a time entry while existing entries already exist for the day | Run the existing-entry resolution prompt first. See Phase 6 → 7a. |
| Write a time entry with a naive `start` (no timezone offset) or non-positive duration | Most trackers reject these. See Phase 6 → 7b + Hard rules. |
| Use a "start a running timer now" operation to back-fill a past day | That kind of operation only starts a timer at the current moment. See Phase 2 hard requirements. |
| Anchor a work block on an accepted but uncorroborated calendar event > 30min | Recurring slots get accepted by default and never happen. Probe with one yes/no first. See Phase 3 → 2a. |
| Silently retry a failed time-tracker write with adjusted parameters (flipped `billable`, swapped project, changed timestamp) — *especially* when the fix feels "obvious" or "the only valid value" | §7d requires stopping and prompting. The instinct that the correction is deterministic and safe is exactly the rationalisation the rule was designed to forbid. See Phase 6 → 7d → NO SILENT RETRY. |
| Route a row to the internal/ops fallback when a free-text signal in the day mentions a known Toggl project name | The user touched a real project that isn't in `projects[]`. Surface it once. See Phase 3 → 2i. |
| Limit `git log` scanning to repos listed in `projects[].repos[]` only | Users commit to side repos that aren't in `projects[]`. Auto-discover `~/projects` etc. every run. See Phase 3 → 2b. |
| Route a non-configured repo's commits to `(internal)` | `(internal)` is for non-code time only. See Phase 4 → 3a. |

---

## Phase 0 — Load or auto-discover config

Configuration lives at `~/.claude/skills/toggl-tamer/config.json`. A starter template is at `skills/toggl-tamer/config.example.json` — copy it to the target path and edit. **Never commit a populated `config.json` to a shared repo; it contains identity data.**

### Schema

```json
{
  "projects": [
    {
      "name": "Acme Web",
      "tracker": "jira",
      "jiraProjectKey": "ACME",
      "atlassianSiteUrl": "https://labrys.atlassian.net",
      "repos": ["/Users/barryearsman/projects/acme-web"],
      "githubRepoSlug": "labrys/acme-web",
      "togglProjectName": "Acme Web"
    },
    {
      "name": "Internal Tools",
      "tracker": "github",
      "repos": ["/Users/barryearsman/projects/internal-tools"],
      "githubRepoSlug": "labrys/internal-tools",
      "togglProjectName": "Internal Tools"
    }
  ],
  "workdayDefaults": {
    "startTime": "09:00",
    "endTime": "17:30",
    "lunchMinutes": 60,
    "lunchAroundTime": "12:30",
    "timezone": "Australia/Brisbane"
  },
  "userIdentities": {
    "primaryEmail": "barry@labrys.io",
    "gitAuthorEmails": ["barry@earsman.com", "barry@labrys.io"],
    "atlassianAccountId": "712020:...",
    "notionUserId": "...",
    "slackUserId": "U07V1KQMVLH"
  },
  "notionDailyLog": {
    "enabled": true,
    "titlePattern": "^\\d{4}-\\d{2}-\\d{2}$",
    "parentPageId": null
  },
  "internalProject": {
    "name": "Internal / Ops",
    "label": "(internal)",
    "togglProjectName": "Internal / Ops"
  },
  "slackEnabled": true,
  "calendarEnabled": true,
  "notionEnabled": true,
  "togglEnabled": true,
  "togglWrite": {
    "skipMeta": ["(lunch)", "[unaccounted]"],
    "tagWithTicket": true
  },
  "additionalRepos": [],
  "excludeRepos": []
}
```

### Critical identity fields (silent-failure risks)

- **`userIdentities.gitAuthorEmails`** — list of every email that has authored commits in any configured repo. The user's `# userEmail` from CLAUDE.md is often *not* the git author email (e.g. `barry@labrys.io` vs `barry@earsman.com`). Filtering `git log` by the wrong identity returns zero results and the skill confidently reports "no commits today".
- **`userIdentities.slackUserId`** — Slack's `from:@me` modifier silently returns zero results in many workspaces. You **must** use `from:<@U…>` form with the resolved user ID.
- **`notionDailyLog`** — if enabled, the skill reads the most recent daily-log page first as ground truth before stitching together other signals.
- **`internalProject`** — pseudo-project for non-project work (meetings without a project ticket, process discussions, ticket triage, code review on others' PRs, tooling). Without this, internal time gets dropped from the timeline.

If the config file is missing, **derive a draft project list automatically** from evidence before asking the user. Do not invent projects — only include items backed by the probes below.

### 0a. Auto-discover projects (first-run setup)

Run these probes in parallel:

**GitHub (via `gh`):**
```bash
# Repos the user has pushed to in the last 90 days
gh api graphql -f query='
  query { viewer {
    contributionsCollection {
      commitContributionsByRepository(maxRepositories: 50) {
        repository { nameWithOwner url defaultBranchRef { name } }
        contributions { totalCount }
      }
    }
  }}' --jq '.data.viewer.contributionsCollection.commitContributionsByRepository[] | {repo: .repository.nameWithOwner, commits: .contributions.totalCount}'

# PRs the user authored in the last 90 days (catches repos missed above)
gh search prs --author=@me --created=">$(date -v-90d +%F)" --json repository --jq '[.[].repository.nameWithOwner] | unique'
```

**Jira / Atlassian (whichever tool is available — MCP, `jira` CLI, REST):**
- List accessible site URLs.
- For each site, list visible projects and keep projects where the user has activity in the last 90 days, found via JQL:
  `assignee = currentUser() OR reporter = currentUser() OR comment ~ currentUser() AND updated >= -90d`. Group by `project.key`, keep projects with ≥ 1 hit.

**Local repos:**
- Scan `~/projects` (and `~/code`, `~/dev`, `~/src` if present) one level deep for directories containing `.git`. Use `git -C <dir> remote get-url origin` to map each local path to a GitHub repo slug.
- For each repo, harvest Jira project keys directly from commit history — this is a **first-class discovery signal**, not just a pairing signal:
  ```bash
  git -C <repo> log --since=-90d --pretty='%s %D' | grep -oE '[A-Z]{2,}-[0-9]+' | awk -F- '{print $1}' | sort | uniq -c | sort -rn
  ```
  Any project key appearing ≥ 3 times in the last 90 days of commits/branches is a candidate Jira project — propose it even if there's **no Jira activity for the user** on that project. Users who never move tickets in Jira but commit constantly are otherwise invisible to JQL-based discovery.

### 0b. Build the draft

Combine the discoveries:
- Each GitHub repo with recent activity becomes a candidate project. Pair it with the most frequent Jira project key from the commit-message harvest in 0a — even if that Jira project had no JQL hits for the user.
- Jira projects with activity but no matching GitHub repo become tracker-only candidates (`tracker: "jira"`, no `repos`).
- Jira project keys that appeared **only** via the commit-message harvest are still candidates — list them with a note `(discovered via commit messages)` so the user can confirm they're real and supply the site URL.
- Local repos that match a GitHub candidate get their path attached as `repos[]`. A local repo with no GitHub match is still listed (with `githubRepoSlug: null`) so the user can decide.

Name each candidate after the GitHub repo or the Jira project name when there's no repo. Sort by recent activity volume, descending.

### 0c. Confirm with the user

Present the draft as a numbered list, e.g.:

```
I found these candidate projects from the last 90 days:

  1. labrys/acme-web         (jira: ACME, 47 commits, 12 PRs, local: ~/projects/acme-web)
  2. labrys/internal-tools   (github issues, 8 PRs, local: ~/projects/internal-tools)
  3. PLAT (Jira only)        (3 issues touched, no matching repo)

Reply with: keep numbers (e.g. "1,2"), edit details, or "all" to keep everything.
Add anything missing? Anything to drop?
```

Iterate until the user confirms. Then ask only for the **gaps** that auto-discovery couldn't fill — **one question at a time** per the clarifying-question style. Do not concatenate the gap list into a single multi-part prompt; resolve each before moving on.

**Gap order:**
1. For confirmed Jira projects without a known site URL → ask for the Atlassian site URL (one project per question if there are several).
2. For confirmed projects without a local repo path → ask for the path (or skip).
3. Whether to use Slack, Google Calendar, and Notion signals — ask per source, defaulting to yes if a working tool is available for that source.
4. Workday defaults — present the suggested defaults (09:00 / 17:30 / 60min lunch / 12:30 lunch midpoint) as a single accept-or-edit decision, not four separate questions.
5. **Catch-all Toggl project for `internalProject.togglProjectName`** — list candidate Toggl projects whose name matches `/^(internal|admin|ops|housekeeping)/i`, and ask the user which one to use as the destination for `(internal)` rows. **Do NOT silently default to one of them, even in auto mode.** Different workspaces use different conventions ("Internal Process", "Admin & Housekeeping", "Internal / Ops") and silently picking one will misclassify hours that are then hard to find later. If no candidate matches the pattern, prompt for free-text. Persist the chosen value in the new config.

Write the config and confirm before proceeding. On subsequent runs, read it without prompting unless the user passes `--reconfigure`.

If auto-discovery returns **nothing** (no GitHub access, no Atlassian access, no local repos), fall back to fully manual entry — but tell the user *why* you're falling back.

---

## Phase 1 — Identity preflight (silent-failure prevention)

The `# userEmail` from CLAUDE.md is **only one identity**. Before any signal gathering, resolve and cache every identity that filters can use. Any of these resolving to the wrong value causes silent zero-result queries that look like "the user did no work today" — the highest blast-radius failure mode for this skill.

For each identity below: if it is missing or empty in `config.json` under `userIdentities`, **resolve it now and write it back** before continuing.

### Git author emails (`gitAuthorEmails: string[]`)

The user's git author email is often *different* from their work email — e.g. a personal address used for commits while `# userEmail` is the work address. `git log --author=<wrong-email>` returns zero rows silently.

For each repo across all configured projects, run:
```bash
git -C <repo> log --since=-90d --pretty='%ae' | sort -u
```
Aggregate the union, drop bot/CI addresses (`*[bot]@*`, `noreply@github.com`, etc.), and present every remaining candidate to the user:
```
I see commits in your configured repos from these author emails:
  1. barry@earsman.com   (412 commits, last 2026-05-06)
  2. barry@labrys.io     (38 commits, last 2026-04-02)
  3. baz@example.com     (1 commit, 2026-01-15)
Which of these are you? (e.g. "1,2")
```
Save the chosen list as `userIdentities.gitAuthorEmails`. **Always use multiple `--author` flags** when filtering commits — one per email — so a user with mismatched identities is covered:
```bash
git -C <repo> log --author="barry@earsman.com" --author="barry@labrys.io" --since=... --until=...
```

### Slack user ID (`slackUserId: string`)

Slack's `from:@me` modifier silently returns zero results in many workspaces. **Never** use `from:@me`. Always use `from:<@U…>` form with the resolved user ID.

If `slackUserId` is unset, resolve it once (via the available Slack tool's user-lookup against the user's name or email) and cache it. If multiple users match, ask the user to disambiguate. Use the cached ID for *every* Slack search going forward.

### Notion user ID (`notionUserId: string`)

Page `last_edited_by` is a Notion user ID, not an email. Resolve via the available Notion tool's user-listing capability and cache.

### Atlassian account ID (`atlassianAccountId: string`)

Some JQL filters require the account ID (`assignee = "<accountId>"`) rather than `currentUser()`. Resolve via the available Atlassian tool's user-info capability and cache.

### Hard rule

If any identity used by an enabled signal source can't be resolved, **stop** and prompt the user — do not fall back to `currentUser()` / `from:@me` / `userEmail` and produce a confidently-wrong empty timeline. The cost of asking is one prompt; the cost of a silent miss is the user re-doing the day's work by hand.

---

## Phase 2 — Integration availability preflight

Before establishing the day window, verify that the integrations needed for the configured projects and signal flags are actually available. **If required integrations are missing, stop and prompt the user — do not proceed with a partial signal set.**

This skill is **integration-agnostic**: it does not require any specific MCP server, CLI, or tool. For each capability below, use whatever tool is available in the current session that can fulfil it (an MCP server, a CLI like `gh`/`jira`, a REST API call via `curl`, a local script, etc.). Probe each capability by attempting a trivial call; treat unavailability as "missing" regardless of the underlying mechanism.

### Required capabilities

A capability is **required** if its corresponding flag is true in config OR if at least one configured project depends on it:

| Capability | Required when... | Probe (any working method) |
|------------|------------------|----------------------------|
| GitHub access | Any project has `githubRepoSlug` | Can list PRs/issues for the configured repo (e.g. `gh auth status` + `gh pr list`, GitHub MCP, or REST API with token) |
| Jira / Atlassian access | Any project has `tracker: "jira"` | Can list accessible sites and search issues (e.g. Atlassian MCP, `jira` CLI, or REST API) |
| Calendar access | `calendarEnabled: true` | Can list events for a date range for the user's primary calendar (Google Calendar MCP, ICS feed, `gcalcli`, or REST API) |
| Slack access | `slackEnabled: true` | Can search messages by author + date range (Slack MCP, `slack-cli`, or Web API with token) |
| Notion access | `notionEnabled: true` | Can search and fetch pages, AND resolve a Notion user ID for the current user |
| Time-tracker write access | `togglEnabled: true` | Can list workspaces, list projects (with each project's `billable` flag), list entries for a day, **create a time entry with explicit `start` and `duration`** (back-fill — not just "start a running timer now"), and delete entries. Verify every project's `togglProjectName` (including `internalProject.togglProjectName`) exists in the tracker, and **cache each project's `billable` flag** (see "Probe Toggl projects' billable flag" below). |
| Local git | Any project has `repos[]` | `git -C <repo> rev-parse --git-dir` exits 0 for each |

The skill names "Toggl" throughout for readability, but any time-tracking backend that supports the listed operations (list/create/delete entries with explicit start+duration, list projects) is acceptable.

Run all probes in parallel. Treat a probe that times out, errors, or requires re-auth as **missing**.

### When something is missing

Build a single status block, e.g.:

```
Toggl Tamer preflight — 2026-05-06

Required integrations:
  ✓ gh CLI authed (labrys-Group)
  ✓ Atlassian access (labrys.atlassian.net)
  ✗ Calendar — not authenticated
      Authenticate the available calendar tool, or disable
      calendar signals with `calendarEnabled: false` in config.
  ✓ Slack
  ✗ Notion — no working tool available in this session
      Configure a Notion tool, or disable with `notionEnabled: false` in config.
  ✓ Local git for ~/projects/labrys-website-v2
  ✓ Time tracker (workspace: Labrys, back-fill writes available)
```

Then **stop and prompt** with three options:

1. **Fix and re-run** — user resolves the missing integrations, then re-invokes `/toggl-tamer`.
2. **Disable and continue** — user accepts running with reduced signals; update the relevant config flag (`calendarEnabled`, `slackEnabled`, `notionEnabled`) to `false` and proceed. Surface this as a caveat in the final output.
3. **Abort** — exit cleanly without producing a timeline.

Do **not** silently proceed with missing integrations and bury the gap in a "Caveats" section. The user must explicitly choose option 2 to continue with reduced signals.

### Hard requirements (no fallback allowed)

These gaps **block execution** even if the user chooses "disable and continue". Prompt for fix or abort:

- No working git access for any configured project's repos → cannot derive commit signals → can't build a timeline.
- No Jira AND no GitHub access for any configured project → no way to associate or create tickets → output would be PR-centric, which is forbidden.
- The user's email (`# userEmail` in CLAUDE.md) is missing → cannot filter signals by author.
- `togglEnabled: true` but no available tool can create a time entry with explicit `start` + `duration` (back-fill), OR a configured `togglProjectName` is not found in the tracker → cannot complete the write phase. Either install/configure a tool that supports back-fill writes, fix the project-name mismatch, or set `togglEnabled: false` (which downgrades the run to "preview only" and prints a caveat instead of writing). A tool that can only "start a running timer now" is not sufficient — it cannot record past work.

For these, the only options are **Fix and re-run** or **Abort** — do not offer "disable and continue".

### Probe Toggl projects' `billable` flag

Toggl workspaces can mark a project as **billable-only**: writing a time entry to such a project without `billable: true` returns `400 "workspace does not allow non-billable entries in billable projects"`. Discovering this mid-batch is forbidden (see Phase 6 → 7d → NO SILENT RETRY); resolve it in preflight instead.

For each Toggl project resolved during preflight:

1. Read its `billable` flag from the project list response (Toggl REST returns it on `/me/projects`; if the available tool doesn't expose it, prompt the user once for any project we'll write to and cache the answer).
2. Cache as a per-project boolean alongside `togglProjectName`. The skill's in-memory project map should be `{name, togglProjectName, billable}` for every project in `projects[]` plus `internalProject.togglProjectName` plus `togglWrite.fallbackProjectName` plus any Toggl project name discovered via Slack/calendar/notion signals (see Phase 3 → 2i).
3. At write time, pass `billable: true` for any row whose resolved project is billable. See Phase 6 → 7b.

If the available time-tracker tool can't expose project billability and the user can't supply it manually, treat it like any other unresolved capability: stop and prompt — do not guess (`billable: true` for everything would silently misclassify non-billable internal time as billable client work; `billable: false` for everything triggers the 400 mid-batch).

---

## Phase 3 — Day window + signal gathering

Run sub-sections in parallel where possible. Section 2.0 (Notion daily log) runs **first** when enabled — it is ground truth and cheap to fetch.

### Day window

Compute `dayStart` and `dayEnd` as ISO 8601 timestamps in the configured timezone covering 00:00:00 → 23:59:59 of the target date. Use these for ALL queries. Do not use UTC unless that matches the configured timezone.

### 2.0. Notion daily-log (run FIRST, before everything else)

If `notionDailyLog.enabled` is true, **read the most recent daily-log page in Notion before doing anything else**. A user-curated daily log is far more accurate than any reconstruction from 30 separate signals — it is ground truth for what the user did and roughly when. The point of this skill is *not* to ignore that and rebuild it from scratch.

How to find it (use whichever Notion tool is available — MCP, API, etc.):
1. Search Notion filtered to **`last_edited_by: notionUserId`** (NOT `created_by` — daily logs are typically *edited* by the user but may be *created* once long ago, or via a template). Sort by `last_edited_time` desc.
2. Scan results for pages whose **title matches `notionDailyLog.titlePattern`** (default: a date like `2026-05-06`) — or whose title is "today's date", "yesterday's date", or a rolling header.
3. If `notionDailyLog.parentPageId` is set, restrict to children of that page.
4. Pick the page whose title or content matches the **target date** of this run, falling back to the most recently edited matching page.

Once found:
- Fetch the page and parse it into `{time?, summary, ticketHints[]}` entries.
- Treat ticket-key mentions in the daily log as **strong association evidence** for any commits/PRs/edits in the same time range.
- Treat free-text entries (e.g. "52min — Toggl automation discussion with Joshua") as evidence for `(internal)` blocks when no project ticket fits.
- Surface the daily log up front (one short status line per the output discipline section).

If no daily log exists for the target date, fall back to the multi-signal stitching below — and tell the user with a single status line.

### 2a. Calendar

If `calendarEnabled`, list all events for the day where the user attended (not declined). Capture: title, start, end, attendees, description, conferenceUrl (Meet/Zoom link if any).

**Calendar events are evidence-weighted, not unconditionally fixed.** An accepted recurring slot can sit on the calendar without the meeting actually happening — recurring blocks get accepted by default, organisers cancel without removing the event, the user no-shows. A "fixed" anchor for an event that didn't happen distorts the entire timeline.

Classify each event:

- **Strong (fixed)** — corroborated by ≥ 1 independent signal in the event's window: a Slack message in a related channel, a commit on a related branch, a Notion edit on a related page, or a calendar `attended: true` flag from a calendar that tracks attendance. Strong events anchor the timeline as before (truncate work blocks at boundaries, etc.).
- **Weak (probe)** — accepted but uncorroborated, AND > 30 minutes long, AND not the *only* signal for its slot. Surface as a single yes/no prompt before treating as fixed: *"Calendar shows VectorVault 16:00–17:00 (organiser: barry, recurring). No Slack/commit signal in that window. Did this happen?"* On "no", drop the event entirely and let the surrounding work blocks expand into the slot. On "yes", promote to strong.
- **Non-blocking** — events ≤ 30 minutes (standups, brief 1:1s) are anchored without prompting even when uncorroborated; the cost of asking outweighs the cost of a 15-min misallocation.

Events whose attendees are only the user (solo focus blocks, "deep work" calendar holds) are evidence of *intent*, not of work happening — treat them as Weak regardless of duration.

### 2b. Git commits — scan ALL local repos every run, not just configured ones

**The repo set to scan is NOT just `projects[].repos[]`.** Configured projects cover the *common* case. But users routinely commit to repos outside `projects[]`: side projects, tooling/MCP servers, dotfiles, internal scripts, scratch repos. If the skill only scans configured project repos, that work is silently invisible — it gets misrouted to `(internal)` with no commit-evidence anchor, or worse, omitted entirely.

**Build the scan set every run, in this order:**

1. **Configured repos** — every `projects[].repos[]` path.
2. **Auto-discovered local repos** — scan `~/projects`, `~/code`, `~/dev`, `~/src` (whichever exist) one level deep for directories containing `.git`. This is the same scan as Phase 0 → 0a, but run *every day*, not just on first config. Repos found this way that are not in `projects[].repos[]` are **discovery candidates** for this run.
3. **Optional explicit overrides**: if config has a top-level `additionalRepos: string[]` (paths outside the standard scan dirs the user wants to always include), add them.
4. **Apply `excludeRepos`** — drop any repo whose path or `git remote get-url origin` matches a pattern in `config.excludeRepos`.

For each repo in the scan set, filter by **every** identity in `userIdentities.gitAuthorEmails` — never just `# userEmail`. `git log` ANDs `--author` flags by repetition; pass one per email:
```bash
git -C <repo> log \
    $(printf -- '--author=%s ' "${gitAuthorEmails[@]}") \
    --since="<dayStart>" --until="<dayEnd>" \
    --pretty=format:'%H%x09%aI%x09%s%x09%D' --no-merges
```

If a single repo returns zero commits but the day has signals from other sources, log a caveat — don't silently accept the empty result. (Most likely cause: an author email used in this repo isn't in `gitAuthorEmails` yet.)

Also capture the branch each commit landed on (use `--source` or check current branch). Capture file mtimes for files touched in each commit:
```bash
git -C <repo> show --name-only --pretty=format: <sha>
```

#### Handling commits in non-configured repos

When a discovery-candidate repo (not in `projects[]`) returns commits today, you have a piece of code work that doesn't yet have a project home. Ticket-association rules from Phase 4 still apply: scan the commit messages and branch names for ticket keys. Three outcomes:

- **Tracker key found** (e.g. `LW2-228` in a commit on a non-LW2 repo) → associate to that ticket; the row's Toggl project resolves to the matching `projects[]` entry by Jira project key.
- **No tracker key, but the repo's name or `git remote get-url origin` matches a known Toggl project name** (case-insensitive, ignoring `Internal Project: ` / `Support - ` prefixes) → treat as a discovered project per §2i below. Surface for confirmation; don't silently route.
- **No association at all** → orphan group; follow Phase 4 (propose ticket creation) or fall back to `(no-ticket: <branch>)`. **Do not silently route to `(internal)`** — internal is for non-code time, not for code work whose project we couldn't identify.

After the run, if any discovery-candidate repo produced ≥ 3 days of commits in the recent past, prompt once at the end of the run: *"Found commits in `~/projects/toggl-track-mcp` (12 days in last 30, total 47 commits). Add to projects[] for future runs?"* This makes the skill self-improving across runs without forcing pre-config of every repo the user might touch.

### 2c. Pull requests

For each `githubRepoSlug`:
```bash
gh pr list --repo <slug> --author "@me" --state all \
   --search "created:<date> OR updated:<date>" \
   --json number,title,body,createdAt,updatedAt,mergedAt,headRefName,url
```
Include PRs **created**, **updated** (with the user's commits/comments), or **merged** that day.

### 2d. Issue trackers

- **Jira projects**: search via JQL like:
  `project = ACME AND (assignee = currentUser() OR comment ~ currentUser()) AND updated >= "<date>"`. Capture status changes, comments, assignment changes during the day window. Use whichever Atlassian tool is available.
- **GitHub projects**: search issues for `involves:@me updated:<date>` and fetch each issue's timeline events for the day. Use `gh`, the GitHub MCP, or REST API — whichever is available.

### 2e. Slack (optional)

If `slackEnabled`, search the user's messages for the day using whichever Slack tool is available. **Never use `from:@me`** — it silently returns zero results in many workspaces. Always use `from:<@U…>` with the cached `userIdentities.slackUserId`.

Run two searches in parallel and merge:
1. **All channels and DMs**: `from:<@SLACK_USER_ID> after:<dayStart-1> before:<dayEnd+1>`.
2. **Self-DM (notes-to-self)**: `from:<@SLACK_USER_ID> to:<@SLACK_USER_ID>`. Self-DMs often carry the most candid work-log signal — todo lists, "doing X next", links to PRs being reviewed — and are easy to miss without an explicit query.

For each match capture timestamp + channel + a short text excerpt (first 120 chars). De-dupe by message ts.

### 2f. Notion pages (optional)

If `notionEnabled`, find Notion pages the user **edited** during the day window using whichever Notion tool is available:
- Search Notion sorted by `last_edited_time` descending, then filter results where `last_edited_time` falls within `dayStart`–`dayEnd` AND `last_edited_by` matches `userIdentities.notionUserId`.
- For each matching page, capture: page title, URL, `last_edited_time`, parent workspace/database, and a short excerpt (first 200 chars of content fetched only if needed for summarisation).
- Treat Notion edits like commits: they are **end-of-work** signals, not start signals. A page edited at 14:32 means the user was working on it *before* 14:32, not starting then.

Associate Notion pages to tickets using the same rules as commits: ticket key in title or content, otherwise group by parent database/workspace and offer to create a tracker ticket if no association is found. A standalone Notion page (e.g. a meeting note or spec) with no ticket association is allowed — surface it in the timeline as `(notion: <page title>)`.

### 2g. File modification timestamps (use cautiously)

For each file touched in the day's commits, capture the filesystem mtime if the file still exists locally (`stat -f %m <path>` on macOS). This *can* help bound when work *started* on a commit — but mtimes are unreliable on macOS and easy to misread.

Sanity check before using mtimes as evidence:
1. If all candidate file mtimes cluster within a ±5 minute window that is **not on the target day**, treat them as junk and drop them entirely. They're almost certainly the result of Spotlight indexing, format-on-open, or `git checkout` rewriting timestamps wholesale.
2. If the cluster falls on the target day but is suspiciously tight (10+ files within ±2 min), be wary: format-on-save can rewrite many files at once. Use it as a weak signal only, not a primary anchor for `start`.
3. If a single file's mtime is on the target day but well outside any commit window, prefer the commit timestamp.

When mtimes are dropped or downgraded by these checks, note the assumption internally so it informs the row's `start` derivation.

### 2h. Previous day's last ticket (lightweight)

For the project with the **most signal volume today**, find the single latest ticket the user touched on the previous working day with any signal — commit, PR activity, Jira state change, Notion edit. Skip weekends and gap days, cap lookback at 7 days. Record `{ticket, lastSignalAt}` as `previousDayLastTicket`.

This is used in the carryover prompt only as a one-line question to the user — not as the basis for an automatically-inserted block.

### 2i. Project-name discovery from signals (every run, not just first run)

The Phase 0 flow is for building `projects[]` from scratch. But **a working day will frequently surface project names that aren't in `projects[]`** — e.g. a Slack self-DM "reading spec for VEWRS" when VEWRS is a real Toggl project but the user only configured Labrys Website V2. If we don't catch this, the row gets routed to the internal/ops fallback (wrong destination) or to the website project (wronger destination), and a real client-billable hour gets misclassified.

After all signals are gathered (and before ticket association in Phase 4), scan the day's free-text signals (Slack message bodies, calendar event titles, Notion entry text, commit messages without a Jira key) for tokens that match a known Toggl project name (case-insensitive, ignoring any `"Internal Project: "` or `"Support - "` prefix). Do this against the **cached Toggl project list from preflight**, not against `projects[]` (which is the user-configured subset).

For each match that is **not** already in `projects[]`:

1. Capture `{togglProjectName, signal kind, signal timestamp, excerpt}`.
2. After Phase 4 (per-ticket build), surface a single batched prompt:
   > Found references to projects not in your config: VEWRS (Slack 16:54 — "reading spec for VEWRS"), Vault App (calendar 16:00 — "VectorVault meeting"). Add to projects[] for future runs?
3. The prompt offers, per discovered project: **Add to config / Use this run only / Ignore**. "Add to config" appends a minimal entry (`{name, togglProjectName, tracker: null}`) — the user can fill in the tracker/repo on a later `--reconfigure` run.
4. Use the discovered project as the timeline row's destination regardless of choice (the question is only about persistence). On "Ignore", the row falls back to `internalProject.togglProjectName` as today.

This makes the skill **self-improving** — every run that surfaces a new project teaches it the project — without the user having to pre-populate `projects[]` for every Toggl project they might touch. Discovered project names also need their `billable` flag (see Phase 2 → "Probe Toggl projects' `billable` flag"); since they came from the cached Toggl project list, the flag is already known and should be carried into the row's write metadata.

---

## Phase 4 — Associate commits & PRs to tickets

For each commit and PR, attempt to associate it to a ticket using these signals **in priority order**, stopping at the first match:

1. **Explicit ticket key** in commit message, branch name, or PR title/body matching the configured Jira project key pattern (e.g. `ACME-123`) or `#123` for GitHub issues in that repo.
2. **Branch name** containing a ticket key (e.g. `feature/ACME-123-add-login`).
3. **PR linkage** — if the commit's SHA appears in a PR, inherit that PR's ticket association.
4. **Body references** — Jira/GitHub auto-link patterns in the PR body (`Closes #45`, `Fixes ACME-123`).

If **no ticket** can be associated:

1. Group orphan commits/PRs by branch name + repo. Multiple PRs on the same branch belong to the same group. PRs that share a branch prefix (`feature/lcp-perf-round-1` and `feature/lcp-perf-round-2`) or that touch overlapping files within a 4-hour window belong to the same group.
2. Summarise the work (use the commit messages and changed paths) into a 1-sentence title.
3. **Create a ticket** in the appropriate tracker. This step is **mandatory**, not optional — you must propose a ticket for every orphan group. Use the three-call sequence below for Jira; do not bundle assignee/status into the create call.
4. Use the new ticket as the association for those commits/PRs.

**Confirm with the user before creating tickets.** List proposed new tickets in a single batch and ask for approval (yes / edit / skip per item). If the user skips a proposal, mark that group's ticket as `(no-ticket: <branch-name>)` in the timeline — but **never** use a PR number as the ticket identifier.

### Jira ticket creation flow (three calls, not one)

Creating a Jira issue is unreliable when you try to set assignee and status on creation. The fields silently get dropped in many tooling implementations. Use this explicit sequence regardless of which Atlassian tool you're using:

1. **Create**: project key, summary, description, issue type — **no assignee, no status**. Newly-created tickets land in the project's default status (typically "To Do").
2. **Assign** as a separate call: set `assignee` to the user's Atlassian account ID. Doing this as a separate call is the only reliable way; don't trust assignee on creation.
3. **Transition** as a third call only if the work shipped today (commits merged, PR closed): move to "Done" or the project's equivalent terminal status. If the transition call is blocked by permissions, surface the failure to the user with the ticket key and the intended target status, and continue — do not retry silently.

For GitHub issues: create the issue with title/body/`@me` assignee, then close it only if the work merged. Use `gh`, the GitHub MCP, or the REST API — whichever is available.

**Tell the user upfront**, in the proposal batch, that newly-created Jira tickets will:
- land in the project's default status ("To Do" usually), and
- need a separate transition step to reach "Done", which may need extra permission.

### 3a. The internal/ops pseudo-project

Not all real work belongs to a tracker project. Meetings without a project ticket, ticket triage, code review on others' PRs, process discussions, internal tooling/automation, 1:1s with no agenda — this is real time that the skill must account for, but creating a tracker ticket for each is wrong.

If `internalProject` is configured, use it as the destination for orphan time blocks that aren't code-with-tickets. Use the label (default `(internal)`) in the timeline's Ticket column. Examples:

| Signal | Ticket column |
|--------|---------------|
| Calendar event "Toggl automation discussion with Joshua" with no Jira ticket | `(internal)` (or `(calendar)` if you prefer to keep meetings separate) |
| 50-minute Slack thread reviewing someone else's PR in another team's repo | `(internal)` |
| Notion daily-log entry "process: ticket triage 14:00–14:45" | `(internal)` |
| Commits on a branch with no project association after the user declines a ticket proposal | `(no-ticket: <branch>)` |

The distinction: `(no-ticket: <branch>)` is **code work that the user could have created a ticket for and chose not to**. `(internal)` is **non-code time that doesn't belong to any project**. Don't conflate them.

If `internalProject` is **not** configured but orphan non-code blocks exist, prompt the user once: "I have N minutes of non-project work today (meetings/discussions). Configure an internal pseudo-project to capture this, or label as `[unaccounted]`?"

### Hard rules for ticket association

- **PRs are not tickets.** A PR is evidence *for* a ticket, never the unit of work itself. The `Ticket` column in the output must contain a tracker ticket key (e.g. `ACME-123`, `#45`), `(no-ticket: <branch-name>)` for skipped proposals, `(calendar)`, `(lunch)`, `(internal)`, `(notion: <title>)`, `(carryover: <ticket>)`, or `[unaccounted]` — and nothing else. If you find yourself writing `PR #210` in that column, stop: you missed step 3.
- **One ticket per branch by default.** Don't split a branch's work into separate timeline rows just because it shipped as multiple PRs. Adjacent rows for the same ticket should be merged.
- **Don't invent ticket names.** Don't write things like `LCP investigation` or `Trim client bundle` as ticket identifiers — those are summaries. The ticket is the tracker key (or `(no-ticket: ...)`).

---

## Phase 5 — Build, merge, render

### 4. Build a per-ticket timeline

For each ticket touched today, produce a `{start, end, ticket, summary, evidence[]}` block:

- **end** = timestamp of the last commit / PR / Notion edit activity for that ticket on this day. If the only signal is a Jira state change, use that timestamp.
- **start** = inferred earliest moment the user was working on this ticket today. Use the **earliest** of:
  - Earliest commit timestamp on that ticket today
  - Earliest file mtime among files changed in those commits (only if ≥ `dayStart` and the mtime sanity check passed — see Phase 3 → 2g)
  - Earliest Slack message that day mentioning the ticket key, the branch, or related keywords
  - Earliest Notion page edit on that ticket (Notion edits are end-of-work signals; subtract a 15-minute lead-in for the start signal)
  - Jira state change timestamp (e.g. moving to In Progress) — but only if it's *before* the earliest commit; state changes that happen *after* commits are not start signals.
  - If none of the above bound the start, default to **15 minutes before the first commit**.

- **evidence[]** = list of `(kind, timestamp, ref)` tuples that justify the block. Used internally only — never printed.

Cap any single block at a sensible length — if `start` would be more than 3 hours before `end` with no intermediate evidence, shorten it to `end - 90min`.

### 4a. Carryover prompt (one-line, not a heuristic)

If there is a gap between `workdayDefaults.startTime` and the day's earliest evidence-backed block, **and** `previousDayLastTicket` is set, *do not* automatically insert a carryover block. Instead, surface a one-line prompt with the timeline:

> You last touched LW2-221 yesterday at 16:34. Continue from there to fill the 09:00–10:12 gap?

If the user confirms, insert a single block over the gap with `ticket = previousDayLastTicket.ticket` and the evidence entry `{kind: "carryover", timestamp: previousDayLastTicket.lastSignalAt}`. If they decline or ignore the prompt, leave the gap as `[unaccounted]`.

### 5. Combine and de-overlap

Merge all per-ticket blocks plus calendar events into a single ordered timeline:

1. **Calendar events are anchors only after classification** (see Phase 3 → 2a). Strong (corroborated, or short non-blocking) events behave as fixed: truncate any work block that overlaps to end at the event start, and resume after the event ends. **Weak (uncorroborated, > 30min) events must be probed via a single yes/no prompt before being treated as anchors** — if the user says it didn't happen, drop the event and let surrounding work blocks expand into the slot. Never anchor on an event the user couldn't confirm and that has no other evidence.
2. **Resolve work-block overlaps** by truncating the earlier block's `end` to the later block's `start` (the user can only do one thing at a time). When choosing which block "owns" the contested time, prefer the block with the most evidence in that window.
3. **Insert lunch** as a single fixed block of `lunchMinutes` near `lunchAroundTime`, snapping to a gap if one exists within ±60min of that time. If no gap exists, displace the lowest-evidence work block to make room.
4. **Bound the day** by `startTime` and `endTime`. Pull in the earliest block's start to no earlier than `startTime` and push the latest block's end to no later than `endTime` unless evidence (e.g. a commit at 19:00) clearly contradicts it — in that case keep the evidence and note the override internally.
5. **Fill gaps** > 30 minutes between work blocks with an `[unaccounted]` marker so the user can fill them in manually rather than silently extending neighbouring blocks.

### 6. Output

Render the timeline as a markdown table — **heading and table only, nothing else**. No Evidence section. No Caveats section. No narration. See "Output discipline" at the top of this skill.

The `Ticket` column must contain **only** one of: a tracker key (`ACME-123`, `#45`), `(no-ticket: <branch>)`, `(calendar)`, `(lunch)`, `(internal)`, `(notion: <title>)`, `(carryover: <ticket>)`, or `[unaccounted]`. PR numbers, branch names, and ad-hoc labels like "LCP investigation" are **not** valid values for this column — they belong in the Summary.

Evidence (timestamps, commit SHAs, PR URLs, mtime tuples) is gathered and used internally to anchor each row's `start`/`end`/`ticket`/`summary`. It is **not printed**. The user audits via the Toggl UI after the write phase, not via an evidence dump.

#### Rounding and collapsing (avoid false precision)

Toggl entries shorter than ~15 minutes are noise. Showing `09m`/`12m` blocks creates an impression of timeline accuracy that the underlying signals don't support.

Apply these transforms to the rendered timeline (keep precise timestamps internally for the write phase):

1. **Round Start and End to the nearest 15 minutes** in the table — `15:47–15:56` becomes `15:45–16:00`. Compute `Duration` from the rounded values.
2. **Collapse adjacent same-ticket rows** separated only by sub-15-min cleanup blocks. Example: a `LW2-222` block 15:47–15:56 followed immediately by a `LW2-223` block 15:56–16:22 → emit as one row if the user confirms (or, if you can tell from internal evidence, fold the shorter one into the longer one with a merged summary).
3. **Drop sub-5-minute fragments** entirely after rounding — they round to a 0-minute row and add only noise.
4. After rounding, recompute durations and re-check that the day still adds up to within 30 min of `endTime - startTime - lunch`. If rounding pushes total drift past that threshold, ask the user about it before printing rather than printing a Caveats block.

#### Example output (the COMPLETE output — heading, table, trailing prompt; nothing else)

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

### 6a. Pre-output self-check + mandatory accept prompt

Before printing, scan the rendered table and verify:

- [ ] Every `Ticket` column value matches one of the allowed forms above. If you see `PR #...`, a branch name, a phrase like "LCP investigation", or any free-text label, you have a bug — go back to Phase 4 and create the missing ticket(s) (or mark them `(no-ticket: <branch>)` if the user declined).
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

---

## Phase 6 — Write to the time tracker

Run this phase only when `togglEnabled: true` AND the user accepted the timeline in Phase 5. If `togglEnabled: false`, print "Time-tracker write disabled — preview only." and stop.

The skill calls this "Toggl" by convention, but any time-tracking backend that supports the operations described below (list/create/delete entries, list projects) is acceptable. Use whichever tool is available in the session — MCP, CLI, or REST API — and substitute the equivalent operation wherever the steps name a specific call.

### 7a. Check for existing entries on the target day

Before writing anything, list time entries for the target day. If the response is non-empty, **stop and prompt** the user with the existing entries listed (description, project, start, duration). Offer four options:

1. **Replace** — delete every existing entry for that day, then write the new timeline. Confirm the deletion list one more time before deleting.
2. **Keep and append** — leave existing entries alone, write the new ones alongside. Warn that this will likely produce overlapping entries; show the overlap count.
3. **Keep, skip overlapping** — for each new row whose `[start, end)` interval overlaps any existing entry, skip it. Write only the non-overlapping rows. Report which rows were skipped.
4. **Abort** — write nothing; exit cleanly.

If the response is empty, proceed directly to 7b without prompting.

### 7b. Map timeline rows to time-tracker entries

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
- **Resolve the row's billable flag** from the cached project metadata (see Phase 2 → "Probe Toggl projects' billable flag"). If the resolved project is billable, pass `billable: true` on the create call. Workspaces that forbid non-billable entries on billable projects return a 400 (`"workspace does not allow non-billable entries in billable projects"`) — discovering this mid-batch and silently retrying is forbidden (see 7d below).

### 7c. Confirm the write batch

Print the proposed write as a compact table — one row per planned entry — and ask: "Write these N entries to the time tracker? (yes / edit / abort)". Show the total minutes about to be written and the count, so the user can sanity-check against the day's accounted total. Do not proceed without explicit `yes`.

### 7d. Execute the writes

Create one time entry per row, **sequentially** (not in parallel — most trackers rate-limit and an out-of-order failure is hard to reason about mid-batch). For each call, capture the returned entry ID. If a call fails:

1. Stop the batch immediately. Do not continue writing further entries.
2. Print which rows succeeded (with their entry IDs) and which row failed (with the error message verbatim).
3. Ask the user whether to **roll back** (delete the successful entries), **leave as-is** (partial write), or **retry from the failed row**.

#### NO SILENT RETRY — even if you "know" the fix

A 400 from the time tracker is a STOP signal, full stop. The instinct to fix-and-retry mid-batch ("the only valid value is `billable: true`, so I'll just retry with that") is forbidden. **Even when the corrective action is obvious and would succeed, you must halt and surface the failure to the user.** Reasons:

- The user has not authorised that specific change. Auto-correcting hides it from them.
- "Obvious" corrections aren't always correct — a 400 saying "non-billable forbidden on billable project" might really mean the project was misclassified, the user wants this row routed elsewhere, or this row shouldn't exist at all.
- A class of error that's *predictable* (billable-only projects, project-name mismatches, missing tags) belongs in preflight, not in mid-batch retry. If you're tempted to silently fix it at write time, the real fix is to add a preflight check that catches it before any write happens. Add the rule to Phase 2 and stop the batch this time.

Common rationalisations for silent retry — all forbidden:

| Rationalisation | Why it's still forbidden |
|---|---|
| "The 400 message tells me exactly what to flip — `billable: true`. The retry is deterministic." | Not your call. The user accepted a batch with `billable: false`. Surface the mismatch. |
| "Auto mode says minimise interruptions." | Auto mode is for routine decisions. A failed write is not routine. |
| "Halting will lose user time; the retry is faster." | Speed is not the optimisation target. The user has time-tracking entries on the line; getting them right matters more than getting them now. |
| "I'll halt next time but this one's clearly safe." | Every silent retry felt clearly safe to whoever made it. Halt and surface. Always. |

### 7e. Confirm and link

After a successful batch, print a summary: count of entries written, total minutes, and (if known) a link to the user's tracker day view. Suggest the user double-check the tracker UI before closing the loop.

### Hard rules for the write phase

- **Never write without an accepted timeline.** If the user is still iterating in the rendered output, do not proceed.
- **Never silently overwrite existing entries.** If 7a finds entries on the target day and the user doesn't pick "Replace", existing entries are off-limits.
- **Always include a timezone in `start`.** Most trackers reject naive timestamps. Use `workdayDefaults.timezone` to construct the offset.
- **Sequential writes only.** Parallel time-entry writes are not safe for partial-failure reasoning.
- **Surface the project-name mismatch loudly.** If a row's resolved tracker project doesn't exist at write time (it was deleted/renamed since preflight), abort the batch — don't write the entry projectless.
- **Never silently retry a failed write with adjusted parameters.** §7d requires stopping the batch and prompting the user (rollback / leave / retry) on any failure. Quietly flipping `billable`, swapping a project, or changing the timestamp to make the call succeed is a violation, even if the new parameters work. The user must be told what failed and choose the resolution. (If a class of error is *known* and *predictable* — e.g. billable-only projects when the flag is missing — fix it in preflight, not at write time.)

---

## When the day looks empty

- Config file missing → run Phase 0 interactive setup, do not guess.
- Auto-discovery returned nothing (no GitHub, no Atlassian, no local repos) → fall back to manual entry and tell the user *why*.
- No commits, no PRs, no calendar events → ask the user if it was a working day before fabricating a timeline. Do not stretch evidence to fill the gap.
- Total accounted time differs from `endTime - startTime - lunch` by more than 90 minutes → flag it; do not stretch evidence to fill.
- Any *single* signal source returned zero hits today while others have signal → likely an unconfigured author email or Slack ID. Stop and ask before printing.
