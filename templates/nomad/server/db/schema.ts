import { table, text, integer } from "@agent-native/core/db/schema";

/**
 * Presence ledger: one row per continuous stay in a country. Entry and exit
 * days are inclusive calendar dates (YYYY-MM-DD); a NULL exit means the user
 * is still there (or the trip is open-ended).
 */
export const stays = table("stays", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  countryCode: text("country_code").notNull(),
  city: text("city"),
  entryDate: text("entry_date").notNull(),
  exitDate: text("exit_date"),
  source: text("source", { enum: ["manual", "inbox", "import"] })
    .notNull()
    .default("manual"),
  status: text("status", { enum: ["confirmed", "pending"] })
    .notNull()
    .default("confirmed"),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Visas, permits, and entry authorizations with hard validity windows.
 * Scoped to one country OR a zone ("schengen") — a Schengen visa grants the
 * whole area until `expires_on` (inclusive), capping every exit projection.
 */
export const visas = table("visas", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  label: text("label").notNull(),
  countryCode: text("country_code"),
  zone: text("zone"),
  validFrom: text("valid_from"),
  expiresOn: text("expires_on").notNull(),
  notes: text("notes"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Compliance rules the app tracks (Schengen 90/180, 183-day tax residency,
 * PR presence minimums, visa caps). Pure day-count math over `stays`.
 */
export const rules = table("rules", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  name: text("name").notNull(),
  kind: text("kind", {
    enum: ["rolling-window", "calendar-year", "presence-minimum"],
  }).notNull(),
  countryCode: text("country_code"),
  zone: text("zone"),
  limitDays: integer("limit_days").notNull(),
  windowDays: integer("window_days"),
  description: text("description"),
  // Stable preset identity for idempotent seeding (see ensurePresetRules in
  // actions/update-profile.ts); unique per owner via
  // rules_owner_preset_slug_unique_idx, distinct from the row's own `id`.
  presetSlug: text("preset_slug"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
