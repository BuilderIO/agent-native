import { table, text } from "@agent-native/core/db/schema";

export const calendarCache = table("calendar_cache", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull(),
  cacheKey: text("cache_key").notNull().unique(),
  windowStart: text("window_start").notNull(),
  windowEnd: text("window_end").notNull(),
  busyJson: text("busy_json").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: text("created_at").notNull(),
});
