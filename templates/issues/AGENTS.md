# Issues — Agent Guide

Issues is an agent-native issue/project tracking workspace. The agent manages
issues, transitions, JQL/search, sprint workflows, notes, and navigation through
actions and SQL state.

Detailed issue, transition, sprint, and JQL rules live in `.agents/skills/`.

## Core Rules

- Use actions for issue reads/search, creation, updates, transitions, sprint
  work, notes, navigation, and sync. Do not bypass access checks.
- Do not invent issue status, assignees, priorities, sprint membership, or
  external tracker facts. Inspect the source when unsure.
- Use `view-screen` when the active issue, board, sprint, filter, or selected
  row is unclear.
- Keep workflow changes explicit: status, assignee, due date, sprint, and reason.
- Use existing integration/config paths for Jira or other trackers.

## Application State

- `navigation` exposes board/list/detail, selected issue, sprint, filter, and
  search context.
- `navigate` moves the UI to issues, boards, sprints, and settings.

## Skills

Read the relevant skill before deeper work:

- `issue-management`, `issue-transitions`, `sprint-workflow`, and
  `jql-queries` for issue workflows.
- `storing-data`, `real-time-sync`, `security`, `actions`, `frontend-design`,
  and `shadcn-ui` for framework work.
