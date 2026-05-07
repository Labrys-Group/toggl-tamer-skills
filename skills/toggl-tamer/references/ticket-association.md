# Ticket association

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

## Jira ticket creation flow (three calls, not one)

Creating a Jira issue is unreliable when you try to set assignee and status on creation. The fields silently get dropped in many tooling implementations. Use this explicit sequence regardless of which Atlassian tool you're using:

1. **Create**: project key, summary, description, issue type — **no assignee, no status**. Newly-created tickets land in the project's default status (typically "To Do").
2. **Assign** as a separate call: set `assignee` to the user's Atlassian account ID. Doing this as a separate call is the only reliable way; don't trust assignee on creation.
3. **Transition** as a third call only if the work shipped today (commits merged, PR closed): move to "Done" or the project's equivalent terminal status. If the transition call is blocked by permissions, surface the failure to the user with the ticket key and the intended target status, and continue — do not retry silently.

For GitHub issues: create the issue with title/body/`@me` assignee, then close it only if the work merged. Use `gh`, the GitHub MCP, or the REST API — whichever is available.

**Tell the user upfront**, in the proposal batch, that newly-created Jira tickets will:
- land in the project's default status ("To Do" usually), and
- need a separate transition step to reach "Done", which may need extra permission.

## 3a. The internal/ops pseudo-project

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

## Hard rules

- **PRs are not tickets.** A PR is evidence *for* a ticket, never the unit of work itself. The `Ticket` column in the output must contain a tracker ticket key (e.g. `ACME-123`, `#45`), `(no-ticket: <branch-name>)` for skipped proposals, `(calendar)`, `(lunch)`, `(internal)`, `(notion: <title>)`, `(carryover: <ticket>)`, or `[unaccounted]` — and nothing else. If you find yourself writing `PR #210` in that column, stop: you missed step 3.
- **One ticket per branch by default.** Don't split a branch's work into separate timeline rows just because it shipped as multiple PRs. Adjacent rows for the same ticket should be merged.
- **Don't invent ticket names.** Don't write things like `LCP investigation` or `Trim client bundle` as ticket identifiers — those are summaries. The ticket is the tracker key (or `(no-ticket: ...)`).
