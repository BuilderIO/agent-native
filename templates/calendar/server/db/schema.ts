import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const bookings = table("bookings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  additionalGuestEmails: text("additional_guest_emails"),
  start: text("start").notNull(),
  end: text("end").notNull(),
  slug: text("slug").notNull(),
  eventTitle: text("event_title"),
  notes: text("notes"),
  fieldResponses: text("field_responses"),
  meetingLink: text("meeting_link"),
  meetingLinkPending: boolean("meeting_link_pending").notNull().default(false),
  googleEventId: text("google_event_id"),
  calendarAccountId: text("calendar_account_id"),
  cancelToken: text("cancel_token"),
  zoomNeedsReview: boolean("zoom_needs_review").notNull().default(false),
  zoomMeetingId: text("zoom_meeting_id"),
  zoomAccountId: text("zoom_account_id"),
  status: text("status", { enum: ["confirmed", "cancelled"] })
    .notNull()
    .default("confirmed"),
  createdAt: text("created_at").notNull(),
  ownerEmail: text("owner_email").notNull().default("local@localhost"),
  orgId: text("org_id"),
});

export const bookingLinks = table("booking_links", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  duration: integer("duration").notNull().default(30),
  durations: text("durations"),
  hosts: text("hosts"),
  customFields: text("custom_fields"),
  conferencing: text("conferencing"),
  color: text("color"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const bookingSlugRedirects = table("booking_slug_redirects", {
  oldSlug: text("old_slug").primaryKey(),
  newSlug: text("new_slug").notNull(),
  createdAt: text("created_at").notNull(),
});

export const bookingUsernames = table("booking_usernames", {
  username: text("username").primaryKey(),
  ownerEmail: text("owner_email").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const bookingUsernameChanges = table("booking_username_changes", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  oldUsername: text("old_username"),
  newUsername: text("new_username").notNull(),
  createdAt: text("created_at").notNull(),
});

export const bookingLinkShares = createSharesTable("booking_link_shares");
