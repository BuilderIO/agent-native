/**
 * Teams — groupings of users who share event types, round-robin across hosts,
 * and present a team booking page at `/team/:slug`.
 *
 * Framework `org` provides heavier identity (for full multi-tenant orgs);
 * teams here are lighter-weight and may be scoped to a single org.
 */
import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const teams = table("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color"),
  darkBrandColor: text("dark_brand_color"),
  bio: text("bio"),
  hideBranding: integer("hide_branding", { mode: "boolean" })
    .notNull()
    .default(false),
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const teamMembers = table("team_members", {
  id: text("id").primaryKey(),
  teamId: text("team_id").notNull(),
  userEmail: text("user_email").notNull(),
  role: text("role", { enum: ["owner", "admin", "member"] })
    .notNull()
    .default("member"),
  accepted: integer("accepted", { mode: "boolean" }).notNull().default(false),
  inviteToken: text("invite_token"),
  invitedAt: text("invited_at").notNull(),
  joinedAt: text("joined_at"),
});

export const teamShares = createSharesTable("team_shares");
