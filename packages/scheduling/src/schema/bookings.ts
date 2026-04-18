/**
 * Bookings — the materialized appointments created when someone books an
 * event type.
 *
 * Each Booking may have multiple attendees (seated events), multiple
 * references (one per external system: Google Calendar event id, Zoom
 * meeting id, etc.), and a recurring parent (for recurring series).
 */
import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const bookings = table("bookings", {
  id: text("id").primaryKey(),
  /** Public booking uid used in URLs like /booking/:uid and /reschedule/:uid */
  uid: text("uid").notNull().unique(),
  eventTypeId: text("event_type_id").notNull(),
  /** Organizer email (assigned host for round-robin) */
  hostEmail: text("host_email").notNull(),

  title: text("title").notNull(),
  description: text("description"),

  /** ISO 8601 UTC */
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  /** Timezone in which the organizer/attendees originally picked the slot */
  timezone: text("timezone").notNull().default("UTC"),

  status: text("status", {
    enum: ["pending", "confirmed", "cancelled", "rejected", "rescheduled"],
  })
    .notNull()
    .default("confirmed"),

  /** JSON Location — see shared types */
  location: text("location"),

  /** JSON object of custom field responses */
  customResponses: text("custom_responses"),

  /** Reschedule/cancel tokens for public magic links */
  cancelToken: text("cancel_token"),
  rescheduleToken: text("reschedule_token"),

  /** uid of the booking this one replaced (reschedule chain) */
  fromReschedule: text("from_reschedule"),
  cancellationReason: text("cancellation_reason"),
  reschedulingReason: text("rescheduling_reason"),

  /** Calendar invite iCal UID (stable across reschedules for RFC 5545 compliance) */
  iCalUid: text("ical_uid").notNull(),
  iCalSequence: integer("ical_sequence").notNull().default(0),

  /** Recurring series parent id; null for non-recurring */
  recurringEventId: text("recurring_event_id"),

  /** Payment state (Tier 2) */
  paid: integer("paid", { mode: "boolean" }).notNull().default(false),

  /** Whether the host marked themselves a no-show */
  noShowHost: integer("no_show_host", { mode: "boolean" })
    .notNull()
    .default(false),

  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  ...ownableColumns(),
});

/** Attendees attached to a booking (N for seated events, 1 for personal). */
export const bookingAttendees = table("booking_attendees", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone"),
  locale: text("locale"),
  noShow: integer("no_show", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull(),
});

/**
 * External system references — Google Calendar event ids, Zoom meeting ids,
 * ICS UIDs, etc. One booking → many references.
 */
export const bookingReferences = table("booking_references", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  /** Provider kind: "google_calendar", "office365_calendar", "zoom_video", … */
  type: text("type").notNull(),
  externalId: text("external_id").notNull(),
  meetingUrl: text("meeting_url"),
  meetingPassword: text("meeting_password"),
  credentialId: text("credential_id"),
  createdAt: text("created_at").notNull(),
});

/** Seat reservations — one per attendee on a seated event. */
export const bookingSeats = table("booking_seats", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  attendeeId: text("attendee_id").notNull(),
  /** Opaque reference string used for attendee self-manage links */
  referenceUid: text("reference_uid").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

/** Internal notes on a booking (host-only). */
export const bookingNotes = table("booking_notes", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  authorEmail: text("author_email").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const bookingShares = createSharesTable("booking_shares");
