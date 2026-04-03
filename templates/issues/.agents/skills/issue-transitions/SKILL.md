---
name: issue-transitions
description: >-
  How to change issue status in Jira. Use when transitioning issues between
  workflow states (e.g., To Do -> In Progress -> Done).
---

# Issue Transitions

## How Transitions Work

Jira issues move through workflow states via transitions. You can't set a status directly — you must use the available transitions for the issue's current state.

## Transitioning an Issue

```bash
pnpm action transition-issue --key PROJ-123 --status "In Progress"
```

The script:
1. Fetches available transitions for the issue (`GET /api/issues/:key/transitions`)
2. Finds a transition matching the target status name
3. Executes the transition (`POST /api/issues/:key/transitions`)

## Common Workflow States

| Status Category | Typical Statuses                     |
| --------------- | ------------------------------------ |
| To Do           | To Do, Open, Backlog, New            |
| In Progress     | In Progress, In Review, In QA        |
| Done            | Done, Closed, Resolved, Released     |

Status names vary by project — always use `get-issue` first to see the current status, then `transition-issue` with the desired target status.

## Listing Available Transitions

The API endpoint `GET /api/issues/:key/transitions` returns all valid transitions from the current state. The `transition-issue` script handles this automatically.

## Important Notes

- **Status names are case-sensitive** — use the exact name from the transition list
- **Not all transitions are available** — you can only move to states allowed by the workflow
- **Some transitions require fields** — certain workflows require additional fields (e.g., resolution). The script handles common cases.

## After Transitioning

Always run `pnpm action refresh-list` after transitions to update the UI.

## Related Skills

- **issue-management** — Full issue CRUD operations
- **sprint-workflow** — Sprint context for issue transitions
