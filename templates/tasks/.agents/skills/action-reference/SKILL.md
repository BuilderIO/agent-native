---
name: action-reference
description: >-
  Full reference for the 25 tasks actions: HTTP method, arguments, defaults,
  and confirmation rules. Use when you need an action's method or exact
  behavior beyond the compact index in AGENTS.md, or before adding an action.
---

# Tasks Action Reference

The compact index in `AGENTS.md` lists action names and purposes. This is the
full table, including the HTTP method each action is exposed under. The
canonical descriptions and input schemas live in [`actions/`](../../../actions/).

| Action                        | Method | Purpose                                                                                      |
| ----------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| `list-tasks`                  | GET    | List current user's tasks; `includeDone` and `includeFields` default to false                |
| `create-task`                 | POST   | Create a task with `title`                                                                   |
| `update-task`                 | POST   | Patch `title`, `done`, and/or `fieldValues` by `taskId`                                      |
| `delete-task`                 | POST   | Delete a task by `taskId` (confirm with user first)                                          |
| `bulk-update-tasks`           | POST   | Patch `title` and/or `done` on multiple tasks by id                                          |
| `bulk-delete-tasks`           | POST   | Delete multiple tasks by id (confirm with user first)                                        |
| `reorder-tasks`               | POST   | Reorder visible tasks by id list top-to-bottom                                               |
| `list-inbox-items`            | GET    | List current user's inbox items                                                              |
| `create-inbox-item`           | POST   | Create a not-ready inbox item with `title` (default chat capture)                            |
| `update-inbox-item`           | POST   | Patch inbox item `title` by `inboxItemId`                                                    |
| `delete-inbox-item`           | POST   | Delete an inbox item (confirm with user first)                                               |
| `bulk-delete-inbox-items`     | POST   | Delete multiple inbox items by id (confirm with user first)                                  |
| `mark-inbox-item-ready`       | POST   | Promote inbox item to an incomplete task                                                     |
| `bulk-mark-inbox-items-ready` | POST   | Promote multiple inbox items to incomplete tasks by id                                       |
| `reorder-inbox-items`         | POST   | Reorder inbox items by id list top-to-bottom                                                 |
| `list-custom-fields`          | GET    | List custom field definitions                                                                |
| `create-custom-field`         | POST   | Create a custom field definition with `title`, `type`, and optional `config`                 |
| `update-custom-field`         | POST   | Patch a field definition `title` and/or type-compatible `config`; type is immutable          |
| `delete-custom-field`         | POST   | Delete a field definition and its values on every task (confirm with user first)             |
| `reorder-custom-fields`       | POST   | Reorder custom field definitions by id list top-to-bottom                                    |
| `list-visible-task-fields`    | GET    | List custom field ids shown on task cards for the current user                               |
| `update-visible-task-fields`  | POST   | Replace which custom fields appear on task cards (max 3)                                     |
| `view-screen`                 | —      | Read navigation, UI bulk selection, visible tasks, and inbox snapshot                        |
| `navigate`                    | —      | Move UI to a view: `tasks`, `inbox`, `fields`, `extensions`, `team` (`home`/`ask` → `tasks`) |
| `render-task-list-inline`     | —      | Render an interactive task-list widget inline in chat without leaving the current view       |

## Related Skills

- **task-inbox-workflow** — when to call the task and inbox actions.
- **custom-fields** — the custom field definition, value, and visibility actions.
- **actions** — how to create a new action with `defineAction`.
