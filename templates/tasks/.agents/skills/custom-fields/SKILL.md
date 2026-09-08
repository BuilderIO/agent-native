---
name: custom-fields
description: >-
  Custom field definitions, types, config, per-task values, and which fields
  show on task cards. Use when the user asks to add, edit, reorder, show, hide,
  or delete a custom field, set a field value on a task, or works on /fields.
---

# Custom Fields

## Rule

Field definitions, per-task values, and task-card visibility are three separate
surfaces with their own actions. Use the definition actions for the schema, the
`update-task` `fieldValues` patch for values, and the visible-field actions for
what shows on cards.

## Definitions

- Use `list-custom-fields`, `create-custom-field`, `update-custom-field`, and
  `delete-custom-field` for field definitions.
- Use `reorder-custom-fields` with every field id in the desired order when
  moving fields in the Fields list.
- A field's `type` is immutable after creation; `update-custom-field` patches
  the `title` and/or type-compatible `config` only.
- `delete-custom-field` only after explicit user confirmation; warn that
  deleting the definition removes its values on every task.

## Field types and config

- Custom field types are `text`, `rich_text`, `number`, `percent`, `currency`,
  `single_select`, `multi_select`, and `date`.
- Number, percent, and currency field `precision` limits decimal places;
  `precision: 0` means whole numbers only. Number fields also support optional
  `positiveOnly`.
- Select option colors are named tokens: `red`, `orange`, `yellow`, `green`,
  `blue`, `purple`, `pink`, and `gray`.

## Values on tasks

- Use `list-tasks` with `includeFields` to read per-task custom values and
  `update-task` with `fieldValues` to set or clear them; empty values clear the
  stored row.

## Task-card visibility

- Use `list-visible-task-fields` and `update-visible-task-fields` to read or
  change which fields appear on task cards (max 3, persisted per user in SQL).

## What `view-screen` returns

- On `/tasks`, `view-screen` includes `visibleTaskFields` from stored prefs for
  the custom fields currently shown on task cards and `selectedTaskFields` for
  a highlighted task.
- On `/fields`, `view-screen` returns the field-definition list and
  `selectedItem` when a field is highlighted.
- `navigation.fieldId` highlights a custom field when the Fields page is opened
  from a deep link.

## Related Skills

- **task-inbox-workflow** — reading visible task context before editing.
- **store-conventions** — how custom field value writes are shaped in the store.
