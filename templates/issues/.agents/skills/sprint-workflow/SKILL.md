---
name: sprint-workflow
description: >-
  Sprint and board management in Jira. Use when working with sprints, boards,
  or understanding the board-sprint-issue hierarchy.
---

# Sprint Workflow

## Hierarchy

```
Board -> Sprint(s) -> Issue(s)
  |
  +-> Project (boards belong to projects)
```

- **Board** — A Scrum or Kanban board. Has columns and sprints.
- **Sprint** — A time-boxed iteration. States: `active`, `future`, `closed`.
- **Issue** — A work item assigned to a sprint.

## Listing Sprints

```bash
pnpm action list-sprints --boardId <id>
```

Returns all sprints for a board, including their state (active/future/closed), start/end dates, and goals.

## Listing Projects

```bash
pnpm action list-projects [--compact]
```

Returns all Jira projects with their keys, names, and types.

## Finding the Right Board

1. `list-projects` to see available projects
2. Use the board view in the UI or check `GET /api/boards` to find board IDs
3. `list-sprints --boardId <id>` to see sprints

## Views in the App

| View      | URL Pattern           | Shows                            |
| --------- | --------------------- | -------------------------------- |
| My Issues | `/my-issues`          | Issues assigned to current user  |
| Projects  | `/projects/:key`      | Issues in a project              |
| Board     | `/board/:id`          | Kanban/Scrum board columns       |
| Sprint    | `/sprint/:id`         | Active sprint backlog            |

## Navigation

```bash
# Navigate to a project
pnpm action navigate --view=projects --projectKey=PROJ

# Navigate to a board
pnpm action navigate --view=board --boardId=123

# Navigate to sprint view
pnpm action navigate --view=sprint --boardId=123
```

## Related Skills

- **issue-management** — CRUD for individual issues
- **issue-transitions** — Moving issues through workflow states
- **jql-queries** — Finding issues across sprints and projects
