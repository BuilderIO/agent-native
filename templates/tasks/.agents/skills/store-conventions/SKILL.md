---
name: store-conventions
description: >-
  Naming and transaction rules for server store functions in
  `server/**/store.ts`. Use when adding, renaming, or calling a store function,
  writing a bulk or singular CRUD helper, or wiring a query into a transaction.
---

# Store Functions And Transactions

Every store in `server/**/store.ts` exposes full CRUD for its entity: `create`,
`get` + `list`, `update`, `delete`. Naming follows three rules:

- **Unsuffixed means "by ids."** `deleteCustomFieldValues({ ids })` deletes by
  value id. Any other selector is explicit: `deleteCustomFieldValuesByTaskIds`,
  `deleteCustomFieldValuesByFieldIds`, `updateCustomFieldValuesByTaskId`.
- **The plural is the implementation; the singular delegates to it** with a
  one-element id list. `deleteTask` calls `deleteTasks`, `updateCustomFieldValue`
  calls `updateCustomFieldValues`. Never write the same query twice.
- **`list` takes every selector as optional** rather than splitting into `ByX`
  variants — `listStoredItems({ ids?, includeDone? })`,
  `listCustomFieldValues({ ids?, taskIds?, fieldIds? })`.

Where a patch is genuinely per-row (custom field title/config, a task's field
values), the bulk form takes one entry per id instead of one patch across ids.
Upsert counts as create; do not add a separate `create` for upserted rows.

Action names are a separate public surface and do not follow this convention:
the `bulk-delete-tasks` action still exists and calls `deleteTasks`.

Every function takes the database handle as an **optional trailing argument**,
so it runs standalone or joins a caller's transaction. The handle is defined
once, in `server/db/transaction.ts`:

```ts
export type DbHandle = Pick<
  ReturnType<typeof getDb>,
  "select" | "insert" | "update" | "delete" | "transaction"
>;
```

## Related Skills

- **actions** — actions are the callers that compose these store functions.
- **task-inbox-workflow** — the task/inbox operations backed by these stores.
