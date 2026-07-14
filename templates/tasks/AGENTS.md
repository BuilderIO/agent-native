# tasks — Agent Guide

Tasks is a task-list-first agent-native app. The task list at `/tasks` is the default home; chat stays available for capture and agent operations. Actions are the contract shared by UI, chat, HTTP, MCP, A2A, and CLI.

## Core Rules

- Never hardcode API keys, tokens, webhook URLs, signing secrets, private Builder/internal data, customer data, or credential-looking literals. Use secrets/OAuth/runtime configuration and obvious placeholders in examples.
- Follow the root framework contract: data in SQL, actions first, application state for navigation/selection, and shared agent chat for AI work.
- Use actions for app operations and keep frontend/API parity.
- Prefer improving the action surface before adding new pages. The task list is the primary durable UI for MVP.
- Keep the action surface small: task CRUD actions plus `reorder-tasks`, `view-screen`, and `navigate`.
- Do not use `db-query` for normal task operations.
- Call `view-screen` first when the user's visible task context matters (especially on `/tasks`).

## Actions

| Action                       | Method | Purpose                                                                                      |
| ---------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `list-tasks`                 | GET    | List current user's tasks; `includeDone` and `includeFields` default to false                |
| `create-task`                | POST   | Create a task with `title`                                                                   |
| `update-task`                | POST   | Patch `title`, `done`, and/or `fieldValues` by `taskId`                                      |
| `delete-task`                | POST   | Delete a task by `taskId` (confirm with user first)                                          |
| `bulk-update-tasks`          | POST   | Patch `title` and/or `done` on multiple tasks by id                                          |
| `bulk-delete-tasks`          | POST   | Delete multiple tasks by id (confirm with user first)                                        |
| `reorder-tasks`              | POST   | Reorder visible tasks by id list top-to-bottom                                               |
| `list-inbox-items`           | GET    | List current user's inbox items                                                              |
| `create-inbox-item`          | POST   | Create a not-ready inbox item with `title` (default chat capture)                            |
| `update-inbox-item`          | POST   | Patch inbox item `title` by `inboxItemId`                                                    |
| `delete-inbox-item`          | POST   | Delete an inbox item (confirm with user first)                                               |
| `mark-inbox-item-ready`      | POST   | Promote inbox item to an incomplete task                                                     |
| `reorder-inbox-items`        | POST   | Reorder inbox items by id list top-to-bottom                                                 |
| `list-custom-fields`         | GET    | List custom field definitions                                                                |
| `create-custom-field`        | POST   | Create a custom field definition with `title`, `type`, and optional `config`                 |
| `update-custom-field`        | POST   | Patch a field definition `title` and/or type-compatible `config`; type is immutable          |
| `delete-custom-field`        | POST   | Delete a field definition and its values on every task (confirm with user first)             |
| `reorder-custom-fields`      | POST   | Reorder custom field definitions by id list top-to-bottom                                    |
| `list-visible-task-fields`   | GET    | List custom field ids shown on task cards for the current user                               |
| `update-visible-task-fields` | POST   | Replace which custom fields appear on task cards (max 3)                                     |
| `view-screen`                | —      | Read navigation, UI bulk selection, visible tasks, and inbox snapshot                        |
| `navigate`                   | —      | Move UI to a view: `tasks`, `inbox`, `fields`, `extensions`, `team` (`home`/`ask` → `tasks`) |

## Store Functions And Transactions

Every function in `server/**/store.ts` takes the database handle as an
**optional trailing argument**, so it runs standalone or joins a caller's
transaction. The handle is defined once, in `server/db/transaction.ts`:

```ts
export type DbHandle = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "delete" | "transaction"
>;
```

## Commit Message Conventions

- Never include `Made-with: Cursor` in commit messages. Remove it if it appears
  in a generated message.
- Use one of these prefixes:
  - `feature: ...` or `feature(PROJECT): ...`
  - `fix: ...` or `fix(PROJECT): ...`
  - `refactor: ...` or `refactor(PROJECT): ...`
  - `technical: ...` or `technical(PROJECT): ...`
  - `chore: ...` or `chore(PROJECT): ...`
- `PROJECT` is optional. If provided, it must be one of `generator` or `web`.
- Before creating any commit, always:
  - ask for confirmation,
  - show the proposed commit message first,
  - commit only after explicit user approval.

## Commit Message Conventions

- Never include `Made-with: Cursor` in commit messages. Remove it if it appears
  in a generated message.
- Use one of these prefixes:
  - `feature: ...` or `feature(PROJECT): ...`
  - `fix: ...` or `fix(PROJECT): ...`
  - `refactor: ...` or `refactor(PROJECT): ...`
  - `technical: ...` or `technical(PROJECT): ...`
  - `chore: ...` or `chore(PROJECT): ...`
- `PROJECT` is optional. If provided, it must be one of `generator` or `web`.
- Before creating any commit, always:
  - ask for confirmation,
  - show the proposed commit message first,
  - commit only after explicit user approval.

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

## Agent behavior (MVP)

- Capture in chat → `create-inbox-item` by default; use `create-task` only when the user asks to add directly to the task list.
- Call `view-screen` before ambiguous edits when the user says "this task", "these tasks", "this inbox item", or "the list".
- On `/tasks` or `/inbox`, `view-screen` returns `list` (with `items`), optional `selectedItem` (`inListSnapshot`), and optional `selection` (`selectedItems`, `selectedIdsNotInVisibleList`) when bulk-select is active.
- Prefer `selection.selectedItems` when the user has UI rows selected; fall back to `selectedItem` for a single deep-link highlight.
- `delete-task`, `bulk-delete-tasks`, and `delete-inbox-item` only after explicit user confirmation in chat.
- Use `navigation.includeDone` and `list` from `view-screen` to match what the user sees on `/tasks`.
- Use `reorder-tasks` with the same `includeDone` flag when moving tasks in the visible list.
- Use `list-custom-fields`, `create-custom-field`, `update-custom-field`, and `delete-custom-field` for field definitions.
- Use `reorder-custom-fields` with every field id in the desired order when moving fields in the Fields list.
- Use `list-visible-task-fields` and `update-visible-task-fields` to read or change which fields appear on task cards (max 3, persisted per user in SQL).
- Use `list-tasks` with `includeFields` to read per-task custom values and `update-task` with `fieldValues` to set or clear them; empty values clear the stored row.
- On `/tasks`, `view-screen` includes `visibleTaskFields` from stored prefs for the custom fields currently shown on task cards and `selectedTaskFields` for a highlighted task.
- On `/fields`, `view-screen` returns the field-definition list and `selectedItem` when a field is highlighted.
- Custom field types are `text`, `rich_text`, `number`, `percent`, `currency`, `single_select`, `multi_select`, and `date`.
- Number, percent, and currency field `precision` limits decimal places; `precision: 0` means whole numbers only. Number fields also support optional `positiveOnly`.
- Select option colors are named tokens: `red`, `orange`, `yellow`, `green`, `blue`, `purple`, `pink`, and `gray`.
- `delete-custom-field` only after explicit user confirmation; warn that deleting the definition removes its values on every task.
- After code changes, include the **Change summary** from the `change-summary` skill (Code / Tests / Config / Docs with line counts).

## Skills

Read the relevant root skill before implementation: `adding-a-feature`, `actions`, `agent-native-docs`, `change-summary`, `storing-data`, `real-time-sync`, `security`, `delegate-to-agent`, `frontend-design`, `shadcn-ui`, and `self-modifying-code`.

<!-- BEGIN @agent-native/skills -->

When operating as Claude Fable, use the /efficient-fable skill always.
When using a high-cost frontier model for codebase-heavy work, use the /efficient-frontier skill always.
When writing final response status indicators, use the /quick-recap skill always.
When long-running or parallel work needs usage-limit checks, use the /stay-within-limits skill always.

<!-- END @agent-native/skills -->
