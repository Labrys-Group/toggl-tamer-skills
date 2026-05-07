# Identity resolution preflight (silent-failure prevention)

The `# userEmail` from CLAUDE.md is **only one identity**. Before any signal gathering, resolve and cache every identity that filters can use. Any of these resolving to the wrong value causes silent zero-result queries that look like "the user did no work today" — the highest blast-radius failure mode for this skill.

For each identity below: if it is missing or empty in `config.json` under `userIdentities`, **resolve it now and write it back** before continuing.

## Git author emails (`gitAuthorEmails: string[]`)

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

## Slack user ID (`slackUserId: string`)

Slack's `from:@me` modifier silently returns zero results in many workspaces. **Never** use `from:@me`. Always use `from:<@U…>` form with the resolved user ID.

If `slackUserId` is unset, resolve it once (via the available Slack tool's user-lookup against the user's name or email) and cache it. If multiple users match, ask the user to disambiguate. Use the cached ID for *every* Slack search going forward.

## Notion user ID (`notionUserId: string`)

Page `last_edited_by` is a Notion user ID, not an email. Resolve via the available Notion tool's user-listing capability and cache.

## Atlassian account ID (`atlassianAccountId: string`)

Some JQL filters require the account ID (`assignee = "<accountId>"`) rather than `currentUser()`. Resolve via the available Atlassian tool's user-info capability and cache.

## Hard rule

If any identity used by an enabled signal source can't be resolved, **stop** and prompt the user — do not fall back to `currentUser()` / `from:@me` / `userEmail` and produce a confidently-wrong empty timeline. The cost of asking is one prompt; the cost of a silent miss is the user re-doing the day's work by hand.
