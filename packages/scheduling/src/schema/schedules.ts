/**
 * Schedules — named availability presets ("Working Hours", "Evenings").
 *
 * A Schedule has weekly rules (e.g. Mon-Fri 9am-5pm) stored as rows in
 * `schedule_availability`, plus one-off overrides stored in `date_overrides`.
 *
 * Each user has one default schedule; event types can pick any of the user's
 * schedules, or a host-specific override for team events.
 */
import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const schedules = table("schedules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

/**
 * Weekly availability rules.
 * Each row is one interval on one day-of-week for one schedule.
 * Example: scheduleId=X, day=1 (Mon), startTime="09:00", endTime="12:00".
 */
export const scheduleAvailability = table("schedule_availability", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  /** 0=Sunday … 6=Saturday */
  day: integer("day").notNull(),
  /** "HH:MM" in schedule's timezone */
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: text("created_at").notNull(),
});

/**
 * Date-specific overrides.
 * Example: scheduleId=X, date="2026-04-25", intervals=[] (fully blocked).
 * Or intervals=[{"09:00"-"11:00"}] (only 9-11 on that day).
 */
export const dateOverrides = table("date_overrides", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  /** YYYY-MM-DD in schedule's timezone */
  date: text("date").notNull(),
  /** JSON array of {startTime,endTime}. Empty = fully blocked. */
  intervals: text("intervals").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

/** Time-zoned travel windows that override the user's default timezone. */
export const travelSchedules = table("travel_schedules", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: text("created_at").notNull(),
});

/** Out of office — blocks bookings and optionally redirects to a coworker. */
export const outOfOfficeEntries = table("out_of_office_entries", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  reason: text("reason"),
  notes: text("notes"),
  redirectUserEmail: text("redirect_user_email"),
  createdAt: text("created_at").notNull(),
});

export const scheduleShares = createSharesTable("schedule_shares");
