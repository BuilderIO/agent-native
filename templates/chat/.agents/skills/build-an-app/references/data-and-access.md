# Data and access decisions

Use this when choosing who may see a row or when adding a schema/migration. A
table's columns control framework SQL-tool scoping; app actions still need their
own access checks for the people and records they return.

## Choose the row model

| Data                                                             | Columns                                                                            | App action behavior                                                                                                                                                      |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Private to its creator (notes, drafts)                           | `owner_email`                                                                      | Filter reads and writes by `ctx.userEmail`; set the owner on insert.                                                                                                     |
| Shareable resource (documents, dashboards)                       | `...ownableColumns()` plus `createSharesTable()` and `registerShareableResource()` | Use `accessFilter(table, shares)` for lists; use `assertAccess(type, id, role)` before reads/writes by id. Choose `private`, `org`, or `public` visibility deliberately. |
| Team resource (rooms, products, customers)                       | Same shareable-resource columns                                                    | Use `visibility: "org"` when an org is active. Without an org, choose a deliberate private or no-create behavior.                                                        |
| Child of a resource (bookings in a room, line items in an order) | `parent_id`, `owner_email`, and the parent's `org_id` when present                 | Check access to the parent in the action, then scope every child query by parent id and tenant. Apply child-specific rules in the write action.                          |
| Organization-only rows (for example, membership records)         | `org_id` only                                                                      | Filter each app action by the active org; this does not support private ownership or per-user share grants.                                                              |
| Public URL (published form or booking page)                      | Separate slug/token                                                                | Use a public route with its own validation and read policy; sharing visibility does not create anonymous URL access.                                                     |

Do not make a shared team resource private by adding only `owner_email`: that
causes normal app actions and lists to hide coworkers' rows. Use
`ownableColumns()` and the registered sharing helpers. Conversely, a room's
bookings can inherit the room's access if the booking actions check the room
before returning its rows.

### What agent SQL tools can see

`db-query`/`db-exec` create scoped views: an `owner_email` table is limited to
the current owner. If the caller has an active org and the table also has
`org_id`, rows are further limited to that org or a null org; without an active
org, only the owner filter applies. An `org_id`-only table is limited to the
current org and denied when there is no org. A table with neither column is
denied. This is deliberately narrower than share grants, so use typed app
actions to list team-shared records or children that inherit parent access.
Do not add filters to raw SQL that duplicate these views.

The same row scoping does not replace action authorization. `accessFilter`
resolves resource visibility/share grants; `assertAccess` checks one resource
and role. The person who owns a row and a person with an org role are different
access concepts.

## Schema and migrations

- PostgreSQL only. Define tables with `drizzle-orm/pg-core`; use
  `drizzle-orm` query operators. Import framework sharing helpers from
  `@agent-native/core/db/schema` only for ownable resources.
- Chat has no database files or Drizzle migration config. Add
  `server/db/schema.ts`, `server/db/index.ts` with `createGetDb(schema)`, and
  `server/plugins/db.ts` with `runMigrations([...], { table })`. Follow the
  bundled Database docs. Other starters may document their own migration path.
- Each migration entry needs a unique stable `{ version, name, sql }`. Never
  renumber or edit an applied entry; append a new additive migration.
- Additive only: new columns are nullable or have a default, and nothing is
  dropped, renamed, or retyped. Keep SQL DDL aligned with the Drizzle schema.
- Use text ids from `crypto.randomUUID()`. For sortable time text, normalize
  every input to UTC `Date#toISOString()` before storing or comparing it.
- Use a `CHECK` or `UNIQUE` constraint for single-row rules such as valid
  status, `end > start`, or unique slugs.

`ownableColumns()` provides a development fallback owner value for framework
compatibility. App actions must still set the authenticated `ownerEmail` from
`ctx.userEmail`; never rely on that fallback to identify a real user.

## Invariants across rows

For rules such as no overlapping bookings or no overselling:

1. Validate and normalize input, then check the caller's access to the parent.
2. Start `getDb().transaction(async (tx) => { ... })`.
3. Lock the parent row with `tx.select(...).from(parent).where(...).for("update")`
   so concurrent writers for that parent serialize.
4. Query for conflicts with `tx`; if one exists, use `fail()` with a stable
   `errorCode`, `statusCode: 409`, and a safe conflict identifier.
5. Insert with `tx` and return the saved result. Do not open a separate query
   or call another action from inside the transaction callback.

The lock is effective only when every writer follows the same parent-lock
protocol. Put the invariant in one action and use a database constraint when a
single-row constraint can express it.

## Query and security defaults

- Give every action a zod schema. Bound every list with a time range, `.limit()`,
  or pagination; select only fields the caller needs; index hot filters/sorts.
- Use parameterized Drizzle queries. Never concatenate user input into SQL.
- Keep secrets in workspace connections or the vault, not source, SQL, seeds, or
  instructions. See the `secrets` skill before adding credentials.
- Put file/image/audio/video/PDF payloads in configured blob storage and save
  only the returned URL or opaque id in SQL.
- Add a custom `/api/*` route only for uploads, webhooks, OAuth callbacks,
  streaming, or public unauthenticated responses. Use actions for app data.
- Keep startup limited to framework/plugin initialization and migrations;
  put imports, backfills, and provider calls behind an action or job.
