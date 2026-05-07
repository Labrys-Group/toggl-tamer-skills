# Auto-discovery and config setup

Use this reference when `~/.claude/skills/toggl-tamer/config.json` does not exist. The schema lives in `references/config-schema.md`. A starter template lives at `skills/toggl-tamer/config.example.json`.

If the config file is missing, **derive a draft project list automatically** from evidence before asking the user. Do not invent projects — only include items backed by the probes below.

## 0a. Auto-discover projects

Run these probes in parallel:

### GitHub (via `gh`)

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

### Jira / Atlassian (whichever tool is available — MCP, `jira` CLI, REST)

- List accessible site URLs.
- For each site, list visible projects and keep projects where the user has activity in the last 90 days, found via JQL:
  `assignee = currentUser() OR reporter = currentUser() OR comment ~ currentUser() AND updated >= -90d`. Group by `project.key`, keep projects with ≥ 1 hit.

### Local repos

- Scan `~/projects` (and `~/code`, `~/dev`, `~/src` if present) one level deep for directories containing `.git`. Use `git -C <dir> remote get-url origin` to map each local path to a GitHub repo slug.
- For each repo, harvest Jira project keys directly from commit history — this is a **first-class discovery signal**, not just a pairing signal:
  ```bash
  git -C <repo> log --since=-90d --pretty='%s %D' | grep -oE '[A-Z]{2,}-[0-9]+' | awk -F- '{print $1}' | sort | uniq -c | sort -rn
  ```
  Any project key appearing ≥ 3 times in the last 90 days of commits/branches is a candidate Jira project — propose it even if there's **no Jira activity for the user** on that project. Users who never move tickets in Jira but commit constantly are otherwise invisible to JQL-based discovery.

## 0b. Build the draft

Combine the discoveries:
- Each GitHub repo with recent activity becomes a candidate project. Pair it with the most frequent Jira project key from the commit-message harvest in 0a — even if that Jira project had no JQL hits for the user.
- Jira projects with activity but no matching GitHub repo become tracker-only candidates (`tracker: "jira"`, no `repos`).
- Jira project keys that appeared **only** via the commit-message harvest are still candidates — list them with a note `(discovered via commit messages)` so the user can confirm they're real and supply the site URL.
- Local repos that match a GitHub candidate get their path attached as `repos[]`. A local repo with no GitHub match is still listed (with `githubRepoSlug: null`) so the user can decide.

Name each candidate after the GitHub repo (e.g. `labrys/acme-web`) or the Jira project name when there's no repo. Sort by recent activity volume, descending.

## 0c. Confirm with the user

Present the draft as a numbered list, e.g.:

```
I found these candidate projects from the last 90 days:

  1. labrys/acme-web         (jira: ACME, 47 commits, 12 PRs, local: ~/projects/acme-web)
  2. labrys/internal-tools   (github issues, 8 PRs, local: ~/projects/internal-tools)
  3. PLAT (Jira only)        (3 issues touched, no matching repo)

Reply with: keep numbers (e.g. "1,2"), edit details, or "all" to keep everything.
Add anything missing? Anything to drop?
```

Iterate until the user confirms. Then ask only for the **gaps** that auto-discovery couldn't fill — **one question at a time** (see the clarifying-question style in SKILL.md). Do not concatenate the gap list into a single multi-part prompt; resolve each before moving on.

Gap order:
1. For confirmed Jira projects without a known site URL → ask for the Atlassian site URL (one project per question if there are several).
2. For confirmed projects without a local repo path → ask for the path (or skip).
3. Whether to use Slack, Google Calendar, and Notion signals — ask per source, defaulting to yes if a working tool is available for that source.
4. Workday defaults — present the suggested defaults (09:00 / 17:30 / 60min lunch / 12:30 lunch midpoint) as a single accept-or-edit decision, not four separate questions.
5. **Catch-all Toggl project for `internalProject.togglProjectName`** — list candidate Toggl projects whose name matches `/^(internal|admin|ops|housekeeping)/i`, and ask the user which one to use as the destination for `(internal)` rows. **Do NOT silently default to one of them, even in auto mode.** Different workspaces use different conventions ("Internal Process", "Admin & Housekeeping", "Internal / Ops") and silently picking one will misclassify hours that are then hard to find later. If no candidate matches the pattern, prompt for free-text. Persist the chosen value in the new config.

Write the config and confirm before proceeding. On subsequent runs, read it without prompting unless the user passes `--reconfigure`.

If auto-discovery returns **nothing** (no GitHub access, no Atlassian access, no local repos), fall back to fully manual entry — but tell the user *why* you're falling back.

## Discovering project names from signals (every run, not just first run)

The first-run flow above is for building `projects[]` from scratch. But **a working day will frequently surface project names that aren't in `projects[]`** — e.g. a Slack self-DM "reading spec for VEWRS" when VEWRS is a real Toggl project but the user only configured Labrys Website V2. If we don't catch this, the row gets routed to the internal/ops fallback (wrong destination) or to the website project (wronger destination), and a real client-billable hour gets misclassified.

After signal gathering and before timeline rendering, scan the day's free-text signals (Slack message bodies, calendar event titles, Notion entry text, commit messages without a Jira key) for tokens that match a known Toggl project name (case-insensitive, ignoring any `"Internal Project: "` or `"Support - "` prefix). Do this against the **cached Toggl project list from preflight** (which the skill already has — see integration-preflight.md), not against `projects[]` (which is the user-configured subset).

For each match that is **not** already in `projects[]`:

1. Capture `{togglProjectName, signal kind, signal timestamp, excerpt}`.
2. After Section 4 (per-ticket build), surface a single batched prompt:
   > Found references to projects not in your config: VEWRS (Slack 16:54 — "reading spec for VEWRS"), Vault App (calendar 16:00 — "VectorVault meeting"). Add to projects[] for future runs?
3. The prompt offers, per discovered project: **Add to config / Use this run only / Ignore**. "Add to config" appends a minimal entry (`{name, togglProjectName, tracker: null}`) — the user can fill in the tracker/repo on a later `--reconfigure` run.
4. Use the discovered project as the timeline row's destination regardless of choice (the question is only about persistence). On "Ignore", the row falls back to `internalProject.togglProjectName` as today.

This makes the skill **self-improving** — every run that surfaces a new project teaches it the project — without the user having to pre-populate `projects[]` for every Toggl project they might touch.

Discovered project names also need their `billable` flag (see integration-preflight.md "Probe Toggl projects' `billable` flag"); since they came from the cached Toggl project list, the flag is already known and should be carried into the row's write metadata.
