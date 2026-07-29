---
name: task-inbox-workflow
description: >-
  How the agent captures, reads, edits, reorders, and deletes tasks and inbox
  items using view-screen context. Use when the user mentions "this task",
  "these tasks", "this inbox item", or "the list", or asks to capture, show,
  review, reorder, complete, or delete tasks or inbox items.
---

# Task And Inbox Agent Workflow

## Rule

Read the user's visible context with `view-screen` before acting on anything
referential, capture ambiguous input into the inbox rather than the task list,
and never delete without explicit confirmation in chat.

## Capture

- Capture in chat → `create-inbox-item` by default; use `create-task` only when
  the user asks to add directly to the task list.

## Read the screen before ambiguous edits

- Call `view-screen` before ambiguous edits when the user says "this task",
  "these tasks", "this inbox item", or "the list".
- On `/tasks` or `/inbox`, `view-screen` returns `list` (with `items`), optional
  `selectedItem` (`inListSnapshot`), and optional `selection`
  (`selectedItems`, `selectedIdsNotInVisibleList`) when bulk-select is active.
- Prefer `selection.selectedItems` when the user has UI rows selected; fall back
  to `selectedItem` for a single deep-link highlight.
- Use `navigation.includeDone` and `list` from `view-screen` to match what the
  user sees on `/tasks`.

## Showing the list from another view

- When the user asks to see, review, or manage tasks while `navigation.view` is
  not `tasks`, call `render-task-list-inline` instead of navigating away. Pass
  `includeDone: true` when completed tasks should be included. The widget can
  add tasks and toggle completion through the existing task actions.
- When the user is already on `/tasks`, use `view-screen` and the native task
  list for task-list context unless the user explicitly asks for an inline
  widget.

## Reordering

- Use `reorder-tasks` with the same `includeDone` flag when moving tasks in the
  visible list.
- Use `reorder-inbox-items` with the inbox item ids in the desired
  top-to-bottom order.

## Deleting

- `delete-task`, `bulk-delete-tasks`, `delete-inbox-item`, and
  `bulk-delete-inbox-items` only after explicit user confirmation in chat.

## Task detail extension slot

The task detail panel exposes `tasks.task-detail.bottom` as an `ExtensionSlot`
with `slotContext` containing `taskId`, `title`, `done`, and `fieldValues`.

## Related Skills

- **custom-fields** — custom field definitions, values, and task-card visibility.
- **action-reference** — the full action table with HTTP methods and arguments.
- **store-conventions** — the server store functions these actions call.
