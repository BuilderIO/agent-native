---
name: issue-management
description: >-
  CRUD operations for Jira issues. Use when creating, updating, viewing, or
  searching issues. Covers create-issue, update-issue, get-issue scripts
  and the issue data model.
---

# Issue Management

## Creating Issues

Use the `create-issue` script:

```bash
pnpm script create-issue --project PROJ --summary "Fix login bug" --type Bug --priority High
```

| Arg          | Required | Description                                    |
| ------------ | -------- | ---------------------------------------------- |
| `--project`  | Yes      | Project key (e.g., PROJ, ENG)                  |
| `--summary`  | Yes      | Issue title/summary                            |
| `--type`     | No       | Issue type: Task, Bug, Story, Epic (default: Task) |
| `--priority` | No       | Priority: Highest, High, Medium, Low, Lowest   |

## Updating Issues

Use the `update-issue` script:

```bash
pnpm script update-issue --key PROJ-123 --summary "Updated title" --priority High --labels "bug,frontend"
```

| Arg          | Description                         |
| ------------ | ----------------------------------- |
| `--key`      | Issue key (required)                |
| `--summary`  | New title                           |
| `--priority` | New priority                        |
| `--labels`   | Comma-separated labels              |

## Viewing Issues

Use `get-issue` for full details:

```bash
pnpm script get-issue --key PROJ-123
```

Returns: summary, status, priority, assignee, reporter, labels, comments, subtasks, linked issues, sprint info.

## Listing Issues

```bash
pnpm script list-issues --view my-issues
pnpm script list-issues --view project --projectKey PROJ
```

Views: `my-issues`, `project`, `recent`.

## Searching Issues

```bash
# Text search
pnpm script search-issues --q "login bug"

# JQL search (see jql-queries skill)
pnpm script search-issues --jql "issuetype = Bug AND status != Done"
```

## Issue Data Model

Issues come from the Jira Cloud API. Key fields:

| Field          | Type       | Description                    |
| -------------- | ---------- | ------------------------------ |
| `key`          | string     | Unique identifier (PROJ-123)   |
| `summary`      | string     | Issue title                    |
| `status`       | object     | Current status + category      |
| `priority`     | object     | Priority level                 |
| `issuetype`    | object     | Type (Bug, Task, Story, etc.)  |
| `assignee`     | object     | Assigned user                  |
| `reporter`     | object     | Creator                        |
| `project`      | object     | Parent project                 |
| `labels`       | string[]   | Labels                         |
| `sprint`       | object     | Current sprint (if assigned)   |
| `parent`       | object     | Parent issue (for subtasks)    |
| `subtasks`     | array      | Child issues                   |

## After Mutations

Always run `pnpm script refresh-list` after creating or updating issues to trigger a UI refresh.

## Related Skills

- **issue-transitions** — Changing issue status
- **sprint-workflow** — Sprint and board management
- **jql-queries** — Advanced searching with JQL
