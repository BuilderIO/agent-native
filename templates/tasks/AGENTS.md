# tasks — Agent Guide

Tasks is a task-list-first agent-native app: the task list at `/tasks` is home, chat handles capture, and actions are the contract shared by UI, chat, HTTP, MCP, A2A, and CLI.

## Skills

Read the matching skill before acting. This file is the always-on layer; the skills hold the detail it no longer repeats.

- `task-inbox-workflow` — capture, `view-screen` context and selection, the inline task widget, reordering, deletes, the task-detail extension slot.
- `custom-fields` — field definitions, types and config, per-task values, task-card visibility.
- `action-reference` — the full action table with HTTP methods, arguments, and defaults.
- `store-conventions` — `server/**/store.ts` CRUD naming and the shared transaction handle.
- `change-summary` — the Change summary table for code-change responses, plus commit message conventions.
- Before building common workspace or agent UI, read `agent-native-toolkit` to inventory existing public kits and installed package seams; use `customizing-agent-native` for the configure → compose → eject → propose seam ladder.
- Root skills to read before implementation: `adding-a-feature`, `actions`, `agent-native-docs`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`, `frontend-design`, `shadcn-ui`, `self-modifying-code`.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Follow the root framework contract: data in SQL, actions first, application state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Prefer improving the action surface before adding new pages. The task list is the primary durable UI for MVP.
- Keep the action surface deliberate: it already covers task and inbox-item CRUD/bulk operations, custom field definitions and visibility prefs, reordering, `view-screen`, `navigate`, and `render-task-list-inline` (25 actions total). Extend it thoughtfully rather than adding new pages.
- Do not use `db-query` for normal task operations.
- Call `view-screen` first when the user's visible task context matters (especially on `/tasks`).
- Capture in chat with `create-inbox-item` by default; use `create-task` only when the user asks to add directly to the task list.
- Delete actions run only after explicit user confirmation in chat.
- Tasks are private to each user. Preserve `ownerEmail` scoping unless intentionally implementing sharing.
- After code changes, include the **Change summary** from the `change-summary` skill (Code / Tests / Config / Docs with line counts).

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

## Authoritative References

- [Feature docs](./docs/features/README.md) define product behavior and feature status.
- [Action definitions](./actions/) contain the canonical tool descriptions, input schemas, and implementations.

<!-- BEGIN @agent-native/skills -->

When operating as Claude Fable, use the /efficient-fable skill always.
When using a high-cost frontier model for codebase-heavy work, use the /efficient-frontier skill always.
When writing final response status indicators, use the /quick-recap skill always.
When long-running or parallel work needs usage-limit checks, use the /stay-within-limits skill always.

<!-- END @agent-native/skills -->
