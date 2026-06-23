import {
  table,
  text,
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
  // ISO timestamp when soft-deleted, NULL while live. Soft delete keeps
  // responses queryable from the Archive view; restore-form clears this.
  deletedAt: text("deleted_at"),
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
  submitterEmail: text("submitter_email"),
  // URL of the page the respondent was on, forwarded by trusted embeds (e.g.
  // the framework FeedbackButton) as a hidden pass-through field. Client-scrubbed
  // of sensitive query params. NULL for direct fills that send no page context.
  pageUrl: text("page_url"),
  // Runtime shell the feedback was sent from: "web", "electron", or "tauri".
  // Hidden pass-through field forwarded by trusted embeds. NULL when unknown.
  clientSurface: text("client_surface"),
});

export const formShares = createSharesTable("form_shares");
