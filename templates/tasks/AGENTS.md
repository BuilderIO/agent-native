# tasks — Agent Guide

Tasks is a task-list-first agent-native app: the task list at `/tasks` is home, chat handles capture, and actions are the contract shared by UI, chat, HTTP, MCP, A2A, and CLI.

## Skills

Read the matching skill before acting. This file is the always-on layer; the skills hold the detail it no longer repeats.

- `task-inbox-workflow` — capture, `view-screen` context and selection, the inline task widget, reordering, deletes, the task-detail extension slot.
- `custom-fields` — field definitions, types and config, per-task values, task-card visibility.
- `action-reference` — the full action table with HTTP methods, arguments, and defaults.
- `capture-learnings` — record a user preference or correction so it outlives the thread.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog first; reuse its scoped resolver.
- Follow the root framework contract: data in SQL, actions first, application state for navigation/selection, and shared agent chat for AI work.
- Do not use `db-query` for normal task operations.
- Call `view-screen` first when the user's visible task context matters (especially on `/tasks`).
- Capture in chat with `create-inbox-item` by default; use `create-task` only when the user asks to add directly to the task list.
- Delete actions run only after explicit user confirmation in chat.
- Tasks are private to each user. Preserve `ownerEmail` scoping unless intentionally implementing sharing.
- Never fabricate. If an action fails or a task is not found, say so and recover instead of inventing a result.

## Application State

Default navigation shape on `/tasks`:

```json
{
  "view": "tasks",
  "path": "/tasks",
  "includeDone": false,
  "taskId": "optional-selected-id",
  "fieldId": "optional-selected-field-id"
}
```

- `includeDone` mirrors the task-list filter toggle (incomplete only vs show all).
- `taskId` highlights a row when opened from a deep link; MVP has no detail page.
- `fieldId` highlights a custom field when opened from a deep link; the Fields page manages definitions.
- Chat lives at `/chat`. Root `/` redirects to `/tasks`.

## Actions

Methods, arguments, and defaults are in the `action-reference` skill.

| Action | Purpose |
| --- | --- |
| `list-tasks` | List the user's tasks |
| `create-task` | Create a task |
| `update-task` | Patch title, done, or field values |
| `delete-task` | Delete a task |
| `bulk-update-tasks` | Patch title or done on many tasks |
| `bulk-delete-tasks` | Delete many tasks |
| `reorder-tasks` | Reorder the visible task list |
| `list-inbox-items` | List inbox items |
| `create-inbox-item` | Capture a not-ready inbox item |
| `update-inbox-item` | Rename an inbox item |
| `delete-inbox-item` | Delete an inbox item |
| `bulk-delete-inbox-items` | Delete many inbox items |
| `mark-inbox-item-ready` | Promote an inbox item to a task |
| `bulk-mark-inbox-items-ready` | Promote many inbox items to tasks |
| `reorder-inbox-items` | Reorder inbox items |
| `list-custom-fields` | List field definitions |
| `create-custom-field` | Create a field definition |
| `update-custom-field` | Patch a field title or config |
| `delete-custom-field` | Delete a field and its values everywhere |
| `reorder-custom-fields` | Reorder field definitions |
| `list-visible-task-fields` | Read fields shown on task cards |
| `update-visible-task-fields` | Set fields shown on task cards (max 3) |
| `view-screen` | Read navigation, selection, and visible items |
| `navigate` | Move the UI to a view |
| `render-task-list-inline` | Render the task list inline in chat |

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.
