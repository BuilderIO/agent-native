/**
 * Event types — the top-level bookable definition.
 *
 * An EventType represents "a 30-minute intro call", "a team round-robin sales
 * demo", or "a managed internal 1:1". It's the Cal.com EventType, and the
 * primary resource users create, edit, and share links for.
 *
 * Ownership: personal event types are owned by a user (ownerEmail);
 * team event types are owned by a team (teamId). Sharing is via the framework
 * sharing system (`event_type_shares`).
 */
import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const eventTypes = table("event_types", {
  id: text("id").primaryKey(),

  // Identity
  title: text("title").notNull(),
  slug: text("slug").notNull(),
  description: text("description"),
  /** Default duration in minutes */
  length: integer("length").notNull().default(30),
  /** JSON array of additional duration choices, e.g. [15, 30, 60] */
  durations: text("durations"),
  position: integer("position").notNull().default(0),
  hidden: integer("hidden", { mode: "boolean" }).notNull().default(false),
  color: text("color"),

  // Scheduling model
  schedulingType: text("scheduling_type", {
    enum: ["personal", "collective", "round-robin", "managed"],
  })
    .notNull()
    .default("personal"),
  /** Team id if this is a team event type; null for personal */
  teamId: text("team_id"),

  // Locations (JSON array of Location objects)
  locations: text("locations"),

  // Custom fields (JSON array of CustomField objects)
  customFields: text("custom_fields"),

  // Default schedule reference
  scheduleId: text("schedule_id"),

  // Buffers & notice
  minimumBookingNotice: integer("minimum_booking_notice").notNull().default(0),
  beforeEventBuffer: integer("before_event_buffer").notNull().default(0),
  afterEventBuffer: integer("after_event_buffer").notNull().default(0),
  /** Slot granularity in minutes; null = use duration */
  slotInterval: integer("slot_interval"),

  // Booking window
  periodType: text("period_type", {
    enum: ["unlimited", "rolling", "range"],
  })
    .notNull()
    .default("rolling"),
  periodDays: integer("period_days").default(60),
  periodStartDate: text("period_start_date"),
  periodEndDate: text("period_end_date"),

  // Capacity & policies
  seatsPerTimeSlot: integer("seats_per_time_slot"),
  requiresConfirmation: integer("requires_confirmation", { mode: "boolean" })
    .notNull()
    .default(false),
  disableGuests: integer("disable_guests", { mode: "boolean" })
    .notNull()
    .default(false),
  hideCalendarNotes: integer("hide_calendar_notes", { mode: "boolean" })
    .notNull()
    .default(false),
  successRedirectUrl: text("success_redirect_url"),
  bookingLimits: text("booking_limits"),
  /** Lock timezone on Booker (for in-person or local-only events) */
  lockTimeZoneToggle: integer("lock_time_zone_toggle", { mode: "boolean" })
    .notNull()
    .default(false),

  // Recurring (JSON RecurringEventRule) — Tier 2
  recurringEvent: text("recurring_event"),

  // Templated event name: "{name} + {host}"
  eventName: text("event_name"),

  // Misc
  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  ...ownableColumns(),
});

/**
 * Host assignments for team / round-robin / collective event types.
 * Composite key (userEmail, eventTypeId).
 */
export const eventTypeHosts = table("event_type_hosts", {
  eventTypeId: text("event_type_id").notNull(),
  userEmail: text("user_email").notNull(),
  /** Fixed hosts always attend; non-fixed hosts rotate in round-robin */
  isFixed: integer("is_fixed", { mode: "boolean" }).notNull().default(false),
  /** Relative weight for weighted round-robin (default 1) */
  weight: integer("weight").notNull().default(1),
  /** Lower number = higher priority in round-robin tiebreak */
  priority: integer("priority").notNull().default(2),
  /** Host-specific schedule override; null = use host's default */
  scheduleId: text("schedule_id"),
  groupId: text("group_id"),
  createdAt: text("created_at").notNull(),
});

/** Host groups — collective assignment within a round-robin group. */
export const eventTypeHostGroups = table("event_type_host_groups", {
  id: text("id").primaryKey(),
  eventTypeId: text("event_type_id").notNull(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Rename history — e.g. `/me/old-slug` → `/me/new-slug`.
 * Public booker redirects the old slug to the new one.
 */
export const eventTypeSlugRedirects = table("event_type_slug_redirects", {
  /** Composite: "ownerEmail:slug" or "team:teamId:slug" — unique across ownership scope */
  oldKey: text("old_key").primaryKey(),
  newKey: text("new_key").notNull(),
  eventTypeId: text("event_type_id"),
  createdAt: text("created_at").notNull(),
});

/** Hashed private links (Cal.com's `/d/:hash/:slug`). */
export const hashedLinks = table("hashed_links", {
  id: text("id").primaryKey(),
  hash: text("hash").notNull().unique(),
  eventTypeId: text("event_type_id").notNull(),
  expiresAt: text("expires_at"),
  isSingleUse: integer("is_single_use", { mode: "boolean" })
    .notNull()
    .default(false),
  usedAt: text("used_at"),
  createdAt: text("created_at").notNull(),
});

export const eventTypeShares = createSharesTable("event_type_shares");
