# `<repo-name>`

[![skills.sh](https://skills.sh/b/<owner>/<repo>)](https://skills.sh/<owner>/<repo>)

A collection of [Agent Skills](https://agentskills.io) — reusable instruction sets for AI coding agents (Claude Code, Cursor, Codex, OpenCode, and [50+ more](https://github.com/vercel-labs/skills#supported-agents)).

## Install

```bash
# All skills
npx skills add <owner>/<repo>

# A specific skill
npx skills add <owner>/<repo> --skill hello-skill

# Globally (across all your projects)
npx skills add <owner>/<repo> -g
```

## Skills in this repo

| Skill | Description |
| ----- | ----------- |
| [`hello-skill`](skills/hello-skill/SKILL.md) | Example placeholder skill — replace it. |

## Adding a new skill

1. Create `skills/<skill-name>/SKILL.md` with YAML frontmatter:
   ```markdown
   ---
   name: <skill-name>
   description: One-sentence summary including trigger phrases.
   ---

   # <Skill Name>

   Instructions for the agent…
   ```
2. Add the skill to the table above.
3. Add `"./skills/<skill-name>"` to `.claude-plugin/marketplace.json`.
4. Run `node scripts/lint-skills.mjs` locally — CI runs the same check on PRs.

## Repo layout

```
.
├── .claude-plugin/marketplace.json   # Claude Code plugin marketplace manifest
├── .github/workflows/lint-skills.yml # CI: validates SKILL.md frontmatter
├── scripts/lint-skills.mjs           # Frontmatter linter
└── skills/                           # One folder per skill
    └── hello-skill/SKILL.md
```

## Using this as a template

This repo is a GitHub template. Click **Use this template** at the top of the repo, then:

1. Replace `<owner>`, `<repo>`, and `<repo-name>` placeholders in `README.md`.
2. Update `LICENSE` (year + owner).
3. Update the `name` field in `.claude-plugin/marketplace.json`.
4. Replace `skills/hello-skill/` with your own skill(s).

## Licence

MIT
