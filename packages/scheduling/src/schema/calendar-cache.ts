/**
 * Calendar cache — short-TTL cache of busy intervals fetched from external
 * calendars. Keyed by (credentialId, selected-calendars-hash, time-window).
 *
 * Booking the same slot twice at 3:00pm is the worst UX in a scheduling
 * product, so this cache has a short TTL (default 5 min) and is explicitly
 * busted on every booking create/update/cancel.
 */
import { table, text, integer } from "@agent-native/core/db/schema";

export const calendarCache = table("calendar_cache", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull(),
  /** Hash of (credentialId + sorted selected calendar ids + time range) */
  cacheKey: text("cache_key").notNull().unique(),
  /** ISO 8601 start of the queried window */
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
  /** JSON array of {start, end} busy intervals */
  busyJson: text("busy_json").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
