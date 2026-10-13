import {
  table,
  text,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const teams = table("teams", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color"),
  darkBrandColor: text("dark_brand_color"),
  bio: text("bio"),
  hideBranding: boolean("hide_branding").notNull().default(false),
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
  accepted: boolean("accepted").notNull().default(false),
  inviteToken: text("invite_token"),
  invitedAt: text("invited_at").notNull(),
  joinedAt: text("joined_at"),
});

export const teamShares = createSharesTable("team_shares");
