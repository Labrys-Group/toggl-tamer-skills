# `toggl-tamer-skills`

[![skills.sh](https://skills.sh/b/Labrys-Group/toggl-tamer-skills)](https://skills.sh/Labrys-Group/toggl-tamer-skills)

An [Agent Skill](https://agentskills.io) for AI coding agents (Claude Code, Cursor, Codex, OpenCode, and [50+ more](https://github.com/vercel-labs/skills#supported-agents)) that reconstructs a daily ticket-centric work timeline — ready for pasting into Toggl or any other timesheet tool.

The skill ingests evidence from calendar, git history, pull requests, issue trackers (Jira/GitHub) and Slack, then emits a clean, non-overlapping timeline grouped by ticket.

## Install

```bash
# Add this skill to the current project
npx skills add Labrys-Group/toggl-tamer-skills

# Globally (across all your projects)
npx skills add Labrys-Group/toggl-tamer-skills -g
```

## Usage

In your agent, invoke the skill (e.g. in Claude Code: `/toggl-tamer`) optionally with a date:

```
/toggl-tamer 2026-05-05
```

If no date is supplied, the skill assumes today.

## Skills in this repo

| Skill | Description |
| ----- | ----------- |
| [`toggl-tamer`](skills/toggl-tamer/SKILL.md) | Reconstruct a daily ticket-centric work timeline from Jira/GitHub, git, calendar, and Slack signals. |

## Repo layout

```
.
├── .claude-plugin/marketplace.json   # Claude Code plugin marketplace manifest
├── .github/workflows/lint-skills.yml # CI: validates SKILL.md frontmatter
├── scripts/lint-skills.mjs           # Frontmatter linter
└── skills/
    └── toggl-tamer/
        ├── SKILL.md                  # Skill instructions
        └── config.json               # Skill-specific configuration
```

## Development

Run the linter locally before opening a PR (CI runs the same check):

```bash
node scripts/lint-skills.mjs
```

## Licence

MIT
