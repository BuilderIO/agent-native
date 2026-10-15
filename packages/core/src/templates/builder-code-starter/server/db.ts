// App data layer — the DB client lives here.
//
// This starter ships without any tables, so the wiring is stubbed out. `getDb()`
// returns a Drizzle client bound to the app's `schema`. Enable it when you add
// your first table (see `drizzle/START_HERE.md`):
//
//   1. Define tables in `drizzle/schema.ts`.
//   2. Uncomment the lines below, run `pnpm db:generate`, then `pnpm db:migrate`
//      to apply the new migration. (drizzle-orm, drizzle-kit, drizzle.config.ts,
//      and the db:generate/db:migrate scripts already ship.)
//
// import { createGetDb } from "@agent-native/core/db";
// import { registerShareableResource } from "@agent-native/core/sharing";
// import * as schema from "../drizzle/schema";
//
// export const getDb = createGetDb(schema);
// export { schema };
//
// // Lets accessFilter/assertAccess and the share actions resolve "note" rows.
// registerShareableResource({
//   type: "note",
//   resourceTable: schema.notes,
//   sharesTable: schema.noteShares,
//   displayName: "Note",
//   titleColumn: "title",
//   getResourcePath: (note) => `/notes/${note.id}`,
//   getDb,
// });

export {};
