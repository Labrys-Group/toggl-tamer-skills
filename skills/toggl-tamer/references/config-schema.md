# Config schema

Configuration lives at `~/.claude/skills/toggl-tamer/config.json`. A starter template is at `skills/toggl-tamer/config.example.json` — copy it to the target path and edit. Never commit a populated `config.json` to a shared repo; it contains identity data.

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
  }
}
```

## Critical identity fields (silent-failure risks)

- **`userIdentities.gitAuthorEmails`** — list of every email that has authored commits in any configured repo. The user's `# userEmail` from CLAUDE.md is often *not* the git author email (e.g. `barry@labrys.io` vs `barry@earsman.com`). Filtering `git log` by the wrong identity returns zero results and the skill confidently reports "no commits today".
- **`userIdentities.slackUserId`** — Slack's `from:@me` modifier silently returns zero results in many workspaces. You **must** use `from:<@U…>` form with the resolved user ID.
- **`notionDailyLog`** — if enabled, the skill reads the most recent daily-log page first as ground truth before stitching together other signals.
- **`internalProject`** — pseudo-project for non-project work (meetings without a project ticket, process discussions, ticket triage, code review on others' PRs, tooling). Without this, internal time gets dropped from the timeline.

The `# userEmail` from CLAUDE.md is **only one identity**. The user's git author email and Slack user ID are often *different* and must be discovered separately. See `references/identity-preflight.md`.
