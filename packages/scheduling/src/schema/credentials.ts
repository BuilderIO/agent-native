import { table, text } from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const schedulingCredentials = table("scheduling_credentials", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  userEmail: text("user_email"),
  teamId: text("team_id"),
  appId: text("app_id"),
  oauthTokenId: text("oauth_token_id"),
  displayName: text("display_name"),
  externalEmail: text("external_email"),
  invalid: boolean("invalid").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const selectedCalendars = table("selected_calendars", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull(),
  userEmail: text("user_email").notNull(),
  externalId: text("external_id").notNull(),
  integration: text("integration").notNull(),
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
});

export const destinationCalendars = table("destination_calendars", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id").notNull(),
  userEmail: text("user_email").notNull(),
  integration: text("integration").notNull(),
  externalId: text("external_id").notNull(),
  primaryEmail: text("primary_email"),
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
});

export const verifiedEmails = table("verified_emails", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  userEmail: text("user_email"),
  teamId: text("team_id"),
  verifiedAt: text("verified_at").notNull(),
});

export const verifiedNumbers = table("verified_numbers", {
  id: text("id").primaryKey(),
  phoneNumber: text("phone_number").notNull(),
  userEmail: text("user_email"),
  teamId: text("team_id"),
  verifiedAt: text("verified_at").notNull(),
});
