import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import { boolean } from "drizzle-orm/pg-core";

export const schedules = table("schedules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timezone: text("timezone").notNull().default("UTC"),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const scheduleAvailability = table("schedule_availability", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  day: integer("day").notNull(),
  startTime: text("start_time").notNull(),
  endTime: text("end_time").notNull(),
  createdAt: text("created_at").notNull(),
});

export const dateOverrides = table("date_overrides", {
  id: text("id").primaryKey(),
  scheduleId: text("schedule_id").notNull(),
  date: text("date").notNull(),
  intervals: text("intervals").notNull().default("[]"),
  createdAt: text("created_at").notNull(),
});

export const travelSchedules = table("travel_schedules", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  startDate: text("start_date").notNull(),
  endDate: text("end_date").notNull(),
  timezone: text("timezone").notNull(),
  createdAt: text("created_at").notNull(),
});

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
