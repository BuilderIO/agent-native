// App tables live here. Define each table with the framework's portable column
// helpers so the same schema works on local libSQL and hosted Postgres.
//
// After editing this file, run `pnpm db:generate` and restart the dev server
// (see `drizzle/START_HERE.md`). Example table — uncomment and adapt:
//
// import { integer, now, table, text } from "@agent-native/core/db/schema";
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
