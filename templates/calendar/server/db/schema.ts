import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const bookings = sqliteTable("bookings", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  start: text("start").notNull(),
  end: text("end").notNull(),
  slug: text("slug").notNull(),
  eventTitle: text("event_title"),
  notes: text("notes"),
  /** JSON object of custom field responses, keyed by field ID */
  fieldResponses: text("field_responses"),
  status: text("status", { enum: ["confirmed", "cancelled"] })
    .notNull()
    .default("confirmed"),
  createdAt: text("created_at").notNull(),
});

export const bookingLinks = sqliteTable("booking_links", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description"),
  duration: integer("duration").notNull().default(30),
  /** JSON array of additional duration options, e.g. [15, 30, 60] */
  durations: text("durations"),
  /** JSON array of custom field definitions */
  customFields: text("custom_fields"),
  color: text("color"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});
