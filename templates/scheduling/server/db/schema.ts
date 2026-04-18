/**
 * App database schema.
 *
 * Core scheduling primitives come from the shared @agent-native/scheduling
 * package; local tables unique to this template go below.
 */
export * from "@agent-native/scheduling/schema";

// Template-local tables (none yet). Example:
// import { table, text, integer, ownableColumns, createSharesTable }
//   from "@agent-native/core/db/schema";
// export const announcements = table("announcements", {
//   id: text("id").primaryKey(),
//   body: text("body").notNull(),
//   ...ownableColumns(),
// });
