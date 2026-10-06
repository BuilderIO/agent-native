import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const eventTypes = table("event_types", {
  id: text("id").primaryKey(),

  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  length: integer("length").notNull().default(30),
  durations: text("durations"),
  position: integer("position").notNull().default(0),
  hidden: boolean("hidden").notNull().default(false),
  color: text("color"),

  schedulingType: text("scheduling_type", {
    enum: ["personal", "collective", "round-robin", "managed"],
  })
    .notNull()
    .default("personal"),
  teamId: text("team_id"),

  locations: text("locations"),

  customFields: text("custom_fields"),

  scheduleId: text("schedule_id"),

  minimumBookingNotice: integer("minimum_booking_notice").notNull().default(0),
  beforeEventBuffer: integer("before_event_buffer").notNull().default(0),
  afterEventBuffer: integer("after_event_buffer").notNull().default(0),
  slotInterval: integer("slot_interval"),

  periodType: text("period_type", {
    enum: ["unlimited", "rolling", "range"],
  })
    .notNull()
    .default("rolling"),
  periodDays: integer("period_days").default(60),
  periodStartDate: text("period_start_date"),
  periodEndDate: text("period_end_date"),

  seatsPerTimeSlot: integer("seats_per_time_slot"),
  requiresConfirmation: boolean("requires_confirmation")
    .notNull()
    .default(false),
  disableGuests: boolean("disable_guests").notNull().default(false),
  hideCalendarNotes: boolean("hide_calendar_notes").notNull().default(false),
  successRedirectUrl: text("success_redirect_url"),
  bookingLimits: text("booking_limits"),
  lockTimeZoneToggle: boolean("lock_time_zone_toggle").notNull().default(false),

  recurringEvent: text("recurring_event"),

  eventName: text("event_name"),

  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  ...ownableColumns(),
});

export const eventTypeHosts = table("event_type_hosts", {
  eventTypeId: text("event_type_id").notNull(),
  userEmail: text("user_email").notNull(),
  isFixed: boolean("is_fixed").notNull().default(false),
  weight: integer("weight").notNull().default(1),
  priority: integer("priority").notNull().default(2),
  scheduleId: text("schedule_id"),
  groupId: text("group_id"),
  createdAt: text("created_at").notNull(),
});

export const eventTypeHostGroups = table("event_type_host_groups", {
  id: text("id").primaryKey(),
  eventTypeId: text("event_type_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

export const eventTypeSlugRedirects = table("event_type_slug_redirects", {
  oldKey: text("old_key").primaryKey(),
  newKey: text("new_key").notNull(),
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
});

export const hashedLinks = table("hashed_links", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull().unique(),
  eventTypeId: text("event_type_id").notNull(),
  expiresAt: text("expires_at"),
  isSingleUse: boolean("is_single_use").notNull().default(false),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const eventTypeShares = createSharesTable("event_type_shares");
