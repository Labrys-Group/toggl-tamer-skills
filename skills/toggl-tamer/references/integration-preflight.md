# Integration availability preflight

Before establishing the day window, verify that the integrations needed for the configured projects and signal flags are actually available. **If required integrations are missing, stop and prompt the user — do not proceed with a partial signal set.**

This skill is **integration-agnostic**: it does not require any specific MCP server, CLI, or tool. For each capability below, use whatever tool is available in the current session that can fulfil it (an MCP server, a CLI like `gh`/`jira`, a REST API call via `curl`, a local script, etc.). Probe each capability by attempting a trivial call; treat unavailability as "missing" regardless of the underlying mechanism.

## Required capabilities

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

## When something is missing

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

## Hard requirements (no fallback allowed)

These gaps **block execution** even if the user chooses "disable and continue". Prompt for fix or abort:

- No working git access for any configured project's repos → cannot derive commit signals → can't build a timeline.
- No Jira AND no GitHub access for any configured project → no way to associate or create tickets → output would be PR-centric, which is forbidden.
- The user's email (`# userEmail` in CLAUDE.md) is missing → cannot filter signals by author.
- `togglEnabled: true` but no available tool can create a time entry with explicit `start` + `duration` (back-fill), OR a configured `togglProjectName` is not found in the tracker → cannot complete the write phase. Either install/configure a tool that supports back-fill writes, fix the project-name mismatch, or set `togglEnabled: false` (which downgrades the run to "preview only" and prints a caveat instead of writing). A tool that can only "start a running timer now" is not sufficient — it cannot record past work.

For these, the only options are **Fix and re-run** or **Abort** — do not offer "disable and continue".

## Probe Toggl projects' `billable` flag

Toggl workspaces can mark a project as **billable-only**: writing a time entry to such a project without `billable: true` returns `400 "workspace does not allow non-billable entries in billable projects"`. Discovering this mid-batch is forbidden (see toggl-write.md Hard rules — no silent retries with adjusted parameters); resolve it in preflight instead.

For each Toggl project resolved during preflight:

1. Read its `billable` flag from the project list response (Toggl REST returns it on `/me/projects`; if the available tool doesn't expose it, prompt the user once for any project we'll write to and cache the answer).
2. Cache as a per-project boolean alongside `togglProjectName`. The skill's in-memory project map should be `{name, togglProjectName, billable}` for every project in `projects[]` plus `internalProject.togglProjectName` plus `togglWrite.fallbackProjectName` plus any Toggl project name discovered via Slack/calendar/notion signals (see auto-discovery.md "Discovering project names from signals").
3. At write time, pass `billable: true` for any row whose resolved project is billable. See toggl-write.md §7b.

If the available time-tracker tool can't expose project billability and the user can't supply it manually, treat it like any other unresolved capability: stop and prompt — do not guess (`billable: true` for everything would silently misclassify non-billable internal time as billable client work; `billable: false` for everything triggers the 400 mid-batch).
