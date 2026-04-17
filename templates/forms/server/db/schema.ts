import {
  table,
  text,
  integer,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const forms = table("forms", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  slug: text("slug").notNull().unique(),
  fields: text("fields").notNull(), // JSON array of FormField
  settings: text("settings").notNull(), // JSON FormSettings
  status: text("status", { enum: ["draft", "published", "closed"] })
    .notNull()
    .default("draft"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  ...ownableColumns(),
});

export const responses = table("responses", {
  id: text("id").primaryKey(),
  formId: text("form_id")
    .notNull()
    .references(() => forms.id),
  data: text("data").notNull(), // JSON object: { fieldId: value }
  submittedAt: text("submitted_at").notNull(),
  ip: text("ip"),
});

export const formShares = createSharesTable("form_shares");
