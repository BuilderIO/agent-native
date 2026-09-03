/**
 * Credentials — thin view over framework `oauth_tokens` that records which
 * calendar / video integrations a user has connected. The actual OAuth
 * tokens live in core's `oauth_tokens` table; this table stores display
 * metadata and flags needed by the scheduling UI (display name, invalid
 * flag, app icon, default-for-type).
 */
import { table, text, integer } from "@agent-native/core/db/schema";

export const schedulingCredentials = table("scheduling_credentials", {
  id: text("id").primaryKey(),
  /** Provider slug: "google_calendar", "office365_calendar", "zoom_video", "daily_video", … */
  type: text("type").notNull(),
  /** Owner (user) — for team credentials, use teamId too */
  userEmail: text("user_email"),
  teamId: text("team_id"),
  /** App id from framework app store */
  appId: text("app_id"),
  /** Core `oauth_tokens.id` if applicable */
  oauthTokenId: text("oauth_token_id"),
  /** Human-friendly label shown in UI */
  displayName: text("display_name"),
  /** External account email (e.g. Google account email) */
  externalEmail: text("external_email"),
  /** True after a 401/403 — UI prompts re-connect */
  invalid: integer("invalid", { mode: "boolean" }).notNull().default(false),
  /** Whether this is the user's default for its category (e.g. default video) */
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Which external calendars a credential reads "busy" times from.
 * A single credential (e.g. a Google account) may expose multiple calendars
 * (primary, vacation, shared). Users pick a subset to check for conflicts,
 * plus exactly one as the destination for new events.
 */
export const selectedCalendars = table("selected_calendars", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull(),
  userEmail: text("user_email").notNull(),
  /** External calendar id from the provider */
  externalId: text("external_id").notNull(),
  /** Provider name for this entry */
  integration: text("integration").notNull(),
  /** Optional event-type-level override (only check this calendar for that event) */
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
});

export const destinationCalendars = table("destination_calendars", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull(),
  userEmail: text("user_email").notNull(),
  /** Provider name */
  integration: text("integration").notNull(),
  externalId: text("external_id").notNull(),
  primaryEmail: text("primary_email"),
  /** Optional event-type-level override */
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
});

/** Verified sender emails for workflows sending from a custom address. */
export const verifiedEmails = table("verified_emails", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  userEmail: text("user_email"),
  teamId: text("team_id"),
  verifiedAt: text("verified_at").notNull(),
});

/** Verified phone numbers for workflows sending SMS. */
export const verifiedNumbers = table("verified_numbers", {
  id: text("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),
  userEmail: text("user_email"),
  teamId: text("team_id"),
  verifiedAt: text("verified_at").notNull(),
});
