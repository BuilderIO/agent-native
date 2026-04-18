/**
 * Barrel export for all scheduling schema tables.
 *
 * Consumer apps compose this with their own schema:
 *
 *   // server/db/schema.ts
 *   export * from "@agent-native/scheduling/schema";
 *   export * from "./local-tables.js";
 *
 * Drizzle's schema scanner picks up all tables from the combined namespace.
 */
export * from "./event-types.js";
export * from "./schedules.js";
export * from "./bookings.js";
export * from "./teams.js";
export * from "./credentials.js";
export * from "./calendar-cache.js";
export * from "./workflows.js";
export * from "./routing-forms.js";
