// App tables live here, defined with Drizzle's PostgreSQL builders. Local dev
// runs them on PGlite and hosted deploys on Postgres.
//
// After editing this file, run `pnpm db:generate` and restart the dev server
// (see `drizzle/START_HERE.md`). Example table, private to its creator unless
// shared (see the `sharing` skill) — uncomment and adapt:
//
// import { sql } from "drizzle-orm";
// import { boolean, pgTable, text } from "drizzle-orm/pg-core";
// import {
//   createSharesTable,
//   ownableColumns,
// } from "@agent-native/core/db/schema";
//
// export const notes = pgTable("notes", {
//   id: text("id").primaryKey(),
//   title: text("title").notNull(),
//   body: text("body").notNull().default(""),
//   archived: boolean("archived").notNull().default(false),
//   createdAt: text("created_at").notNull().default(sql`now()`),
//   updatedAt: text("updated_at").notNull().default(sql`now()`),
//   ...ownableColumns(),
// });
//
// export const noteShares = createSharesTable("note_shares");

export {};
