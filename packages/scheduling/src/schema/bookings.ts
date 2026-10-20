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
  uid: text("uid").notNull().unique(),
  eventTypeId: text("event_type_id").notNull(),
  hostEmail: text("host_email").notNull(),

  title: text("title").notNull(),
  description: text("description"),

  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  timezone: text("timezone").notNull().default("UTC"),

  status: text("status", {
    enum: ["pending", "confirmed", "cancelled", "rejected", "rescheduled"],
  })
    .notNull()
    .default("confirmed"),

  location: text("location"),

  customResponses: text("custom_responses"),

  cancelToken: text("cancel_token"),
  rescheduleToken: text("reschedule_token"),

  fromReschedule: text("from_reschedule"),
  cancellationReason: text("cancellation_reason"),
  reschedulingReason: text("rescheduling_reason"),

  iCalUid: text("ical_uid").notNull(),
  iCalSequence: integer("ical_sequence").notNull().default(0),

  recurringEventId: text("recurring_event_id"),

  paid: boolean("paid").notNull().default(false),

  noShowHost: boolean("no_show_host").notNull().default(false),

  metadata: text("metadata"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),

  ...ownableColumns(),
});

export const bookingAttendees = table("booking_attendees", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  timezone: text("timezone"),
  locale: text("locale"),
  noShow: boolean("no_show").notNull().default(false),
  createdAt: text("created_at").notNull(),
});

export const bookingReferences = table("booking_references", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  type: text("type").notNull(),
  externalId: text("external_id").notNull(),
  meetingUrl: text("meeting_url"),
  meetingPassword: text("meeting_password"),
  credentialId: text("credential_id"),
  createdAt: text("created_at").notNull(),
});

export const bookingSeats = table("booking_seats", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  attendeeId: text("attendee_id").notNull(),
  referenceUid: text("reference_uid").notNull().unique(),
  createdAt: text("created_at").notNull(),
});

export const bookingNotes = table("booking_notes", {
  id: text("id").primaryKey(),
  bookingId: text("booking_id").notNull(),
  authorEmail: text("author_email").notNull(),
  content: text("content").notNull(),
  createdAt: text("created_at").notNull(),
});

export const bookingShares = createSharesTable("booking_shares");
