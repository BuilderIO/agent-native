/**
 * App tables live here. Read this file + `drizzle/crud-action-example.ts`
 * before exploring node_modules or running find/cat over the repo.
 *
 * Paths for this template:
 * - Schema: `server/db/schema.ts` (this file)
 * - DB client: `server/db/index.ts` → `getDb()`, `schema`
 * - Migrate: `pnpm db:generate` then `pnpm db:migrate`
 * - Actions: `actions/<name>.ts` (see the CRUD example at
 *   `drizzle/crud-action-example.ts`)
 *
 * Uncomment (or copy) the example table below when you need a first domain
 * table, then generate + run a migration before calling actions that use it.
 *
 * Use `@agent-native/core/db/schema` helpers — not `drizzle-orm/sqlite-core`
 * or `drizzle-orm/pg-core`.
 */

// Add tables for this project below.
//
// Example (uncomment when needed):
//
// import { table, text, integer, now } from "@agent-native/core/db/schema";
//
// export const notes = table("notes", {
//   id: text("id").primaryKey(),
//   title: text("title").notNull(),
//   body: text("body").notNull().default(""),
//   archived: integer("archived", { mode: "boolean" }).notNull().default(false),
//   createdAt: text("created_at").notNull().default(now()),
//   updatedAt: text("updated_at").notNull().default(now()),
// });

export {};
