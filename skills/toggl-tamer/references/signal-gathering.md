# Signal gathering

Run sub-sections in parallel where possible. Section 2.0 (Notion daily log) runs **first** when enabled — it is ground truth and cheap to fetch.

## Day window

Compute `dayStart` and `dayEnd` as ISO 8601 timestamps in the configured timezone covering 00:00:00 → 23:59:59 of the target date. Use these for ALL queries. Do not use UTC unless that matches the configured timezone.

## 2.0. Notion daily-log (run FIRST, before everything else)

If `notionDailyLog.enabled` is true, **read the most recent daily-log page in Notion before doing anything else**. A user-curated daily log is far more accurate than any reconstruction from 30 separate signals — it is ground truth for what the user did and roughly when. The point of this skill is *not* to ignore that and rebuild it from scratch.

How to find it (use whichever Notion tool is available — MCP, API, etc.):
1. Search Notion filtered to `last_edited_by: notionUserId`, sorted by `last_edited_time` desc.
2. Scan results for pages whose **title matches `notionDailyLog.titlePattern`** (default: a date like `2026-05-06`) — or whose title is "today's date", "yesterday's date", or a rolling header.
3. If `notionDailyLog.parentPageId` is set, restrict to children of that page.
4. Pick the page whose title or content matches the **target date** of this run, falling back to the most recently edited matching page.

Once found:
- Fetch the page and parse it into `{time?, summary, ticketHints[]}` entries.
- Treat ticket-key mentions in the daily log as **strong association evidence** for any commits/PRs/edits in the same time range.
- Treat free-text entries (e.g. "52min — Toggl automation discussion with Joshua") as evidence for `(internal)` blocks when no project ticket fits.
- Surface the daily log up front (one short status line — see SKILL.md output discipline).

If no daily log exists for the target date, fall back to the multi-signal stitching below — and tell the user with a single status line.

## 2a. Calendar

If `calendarEnabled`, list all events for the day where the user attended (not declined). Capture: title, start, end, attendees, description, conferenceUrl (Meet/Zoom link if any).

**Calendar events are evidence-weighted, not unconditionally fixed.** An accepted recurring slot can sit on the calendar without the meeting actually happening — recurring blocks get accepted by default, organisers cancel without removing the event, the user no-shows. A "fixed" anchor for an event that didn't happen distorts the entire timeline.

Classify each event:

- **Strong (fixed)** — corroborated by ≥ 1 independent signal in the event's window: a Slack message in a related channel, a commit on a related branch, a Notion edit on a related page, or a calendar `attended: true` flag from a calendar that tracks attendance. Strong events anchor the timeline as before (truncate work blocks at boundaries, etc.).
- **Weak (probe)** — accepted but uncorroborated, AND > 30 minutes long, AND not the *only* signal for its slot. Surface as a single yes/no prompt before treating as fixed: *"Calendar shows VectorVault 16:00–17:00 (organiser: barry, recurring). No Slack/commit signal in that window. Did this happen?"* On "no", drop the event entirely and let the surrounding work blocks expand into the slot. On "yes", promote to strong.
- **Non-blocking** — events ≤ 30 minutes (standups, brief 1:1s) are anchored without prompting even when uncorroborated; the cost of asking outweighs the cost of a 15-min misallocation.

Events whose attendees are only the user (solo focus blocks, "deep work" calendar holds) are evidence of *intent*, not of work happening — treat them as Weak regardless of duration.

## 2b. Git commits — scan ALL local repos every run, not just configured ones

**The repo set to scan is NOT just `projects[].repos[]`.** Configured projects cover the *common* case. But users routinely commit to repos outside `projects[]`: side projects, tooling/MCP servers, dotfiles, internal scripts, scratch repos. If the skill only scans configured project repos, that work is silently invisible — it gets misrouted to `(internal)` with no commit-evidence anchor, or worse, omitted entirely.

**Build the scan set every run, in this order:**

1. **Configured repos** — every `projects[].repos[]` path.
2. **Auto-discovered local repos** — scan `~/projects`, `~/code`, `~/dev`, `~/src` (whichever exist) one level deep for directories containing `.git`. This is the same scan as auto-discovery.md §0a, but run *every day*, not just on first config. Repos found this way that are not in `projects[].repos[]` are **discovery candidates** for this run.
3. **Optional explicit overrides**: if config has a top-level `additionalRepos: string[]` (paths outside the standard scan dirs the user wants to always include), add them.
4. **Apply `excludeRepos`** — drop any repo whose path or `git remote get-url origin` matches a pattern in `config.excludeRepos`. (Example: a personal-finance repo that should never be scanned even if it's in `~/projects`.)

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

### Handling commits in non-configured repos

When a discovery-candidate repo (not in `projects[]`) returns commits today, you have a piece of code work that doesn't yet have a project home. Ticket-association rules from `references/ticket-association.md` still apply: scan the commit messages and branch names for ticket keys. Three outcomes:

- **Tracker key found** (e.g. `LW2-228` in a commit on a non-LW2 repo) → associate to that ticket; the row's Toggl project resolves to the matching `projects[]` entry by Jira project key.
- **No tracker key, but the repo's name or `git remote get-url origin` matches a known Toggl project name** (case-insensitive, ignoring `Internal Project: ` / `Support - ` prefixes) → treat as a discovered project per `auto-discovery.md` → "Discovering project names from signals". Surface for confirmation; don't silently route.
- **No association at all** → orphan group; follow §3 (propose ticket creation) or fall back to `(no-ticket: <branch>)`. **Do not silently route to `(internal)`** — internal is for non-code time, not for code work whose project we couldn't identify (see ticket-association.md §3a).

After the run, if any discovery-candidate repo produced ≥ 3 days of commits in the recent past, prompt once at the end of the run: *"Found commits in `~/projects/toggl-track-mcp` (12 days in last 30, total 47 commits). Add to projects[] for future runs?"* This makes the skill self-improving across runs without forcing pre-config of every repo the user might touch.

## 2c. Pull requests

For each `githubRepoSlug`:
```bash
gh pr list --repo <slug> --author "@me" --state all \
   --search "created:<date> OR updated:<date>" \
   --json number,title,body,createdAt,updatedAt,mergedAt,headRefName,url
```
Include PRs **created**, **updated** (with the user's commits/comments), or **merged** that day.

## 2d. Issue trackers

- **Jira projects**: search via JQL like:
  `project = ACME AND (assignee = currentUser() OR comment ~ currentUser()) AND updated >= "<date>"`. Capture status changes, comments, assignment changes during the day window. Use whichever Atlassian tool is available.
- **GitHub projects**: search issues for `involves:@me updated:<date>` and fetch each issue's timeline events for the day. Use `gh`, the GitHub MCP, or REST API — whichever is available.

## 2e. Slack (optional)

If `slackEnabled`, search the user's messages for the day using whichever Slack tool is available. **Never use `from:@me`** — it silently returns zero results in many workspaces. Always use `from:<@U…>` with the cached `userIdentities.slackUserId`.

Run two searches in parallel and merge:
1. **All channels and DMs**: `from:<@SLACK_USER_ID> after:<dayStart-1> before:<dayEnd+1>`.
2. **Self-DM (notes-to-self)**: `from:<@SLACK_USER_ID> to:<@SLACK_USER_ID>`. Self-DMs often carry the most candid work-log signal — todo lists, "doing X next", links to PRs being reviewed — and are easy to miss without an explicit query.

For each match capture timestamp + channel + a short text excerpt (first 120 chars). De-dupe by message ts.

## 2f. Notion pages (optional)

If `notionEnabled`, find Notion pages the user **edited** during the day window using whichever Notion tool is available:
- Search Notion sorted by `last_edited_time` descending, then filter results where `last_edited_time` falls within `dayStart`–`dayEnd` AND `last_edited_by` matches `userIdentities.notionUserId`.
- For each matching page, capture: page title, URL, `last_edited_time`, parent workspace/database, and a short excerpt (first 200 chars of content fetched only if needed for summarisation).
- Treat Notion edits like commits: they are **end-of-work** signals, not start signals. A page edited at 14:32 means the user was working on it *before* 14:32, not starting then.

Associate Notion pages to tickets using the same rules as commits: ticket key in title or content, otherwise group by parent database/workspace and offer to create a tracker ticket if no association is found. A standalone Notion page (e.g. a meeting note or spec) with no ticket association is allowed — surface it in the timeline as `(notion: <page title>)`.

## 2g. File modification timestamps (use cautiously)

For each file touched in the day's commits, capture the filesystem mtime if the file still exists locally (`stat -f %m <path>` on macOS). This *can* help bound when work *started* on a commit — but mtimes are unreliable on macOS and easy to misread.

Sanity check before using mtimes as evidence:
1. If all candidate file mtimes cluster within a ±5 minute window that is **not on the target day**, treat them as junk and drop them entirely. They're almost certainly the result of Spotlight indexing, format-on-open, or `git checkout` rewriting timestamps wholesale.
2. If the cluster falls on the target day but is suspiciously tight (10+ files within ±2 min), be wary: format-on-save can rewrite many files at once. Use it as a weak signal only, not a primary anchor for `start`.
3. If a single file's mtime is on the target day but well outside any commit window, prefer the commit timestamp.

When mtimes are dropped or downgraded by these checks, note the assumption internally so it informs the row's `start` derivation.

## 2h. Previous day's last ticket (lightweight)

For the project with the **most signal volume today**, find the single latest ticket the user touched on the previous working day with any signal — commit, PR activity, Jira state change, Notion edit. Skip weekends and gap days, cap lookback at 7 days. Record `{ticket, lastSignalAt}` as `previousDayLastTicket`.

This is used in the carryover prompt only as a one-line question to the user — not as the basis for an automatically-inserted block.

## 2i. Project-name discovery from signals

After all signals are gathered (and before ticket association in §3), scan free-text signal bodies (Slack messages, calendar titles, Notion entries, commit messages without a Jira key) for tokens matching a known Toggl project name from the cached project list. Surface any matches that aren't in `projects[]`.

Full procedure: see `auto-discovery.md` → "Discovering project names from signals (every run, not just first run)". The point of running this every day, not just on first config, is to catch projects that the user touches occasionally without configuring — silently misrouting that time is the failure mode.
