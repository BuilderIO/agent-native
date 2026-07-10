import { integer, now, table, text } from "@agent-native/core/db/schema";

export const tasks = table("tasks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  promotedToTask: integer("promoted_to_task", { mode: "boolean" })
    .notNull()
    .default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export type StoredItem = typeof tasks.$inferSelect;
export type NewStoredItem = typeof tasks.$inferInsert;

export const customFields = table("custom_fields", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  configJson: text("config_json").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const customFieldValues = table("custom_field_values", {
  id: text("id").primaryKey(),
  fieldId: text("field_id").notNull(),
  taskId: text("task_id").notNull(),
  valueJson: text("value_json").notNull(),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const userConfig = table("user_config", {
  ownerEmail: text("owner_email").primaryKey(),
  taskCardFieldIdsJson: text("task_card_field_ids_json").notNull().default("[]"),
  updatedAt: text("updated_at").notNull().default(now()),
});

export type StoredCustomField = typeof customFields.$inferSelect;
export type NewCustomField = typeof customFields.$inferInsert;
export type StoredCustomFieldValue = typeof customFieldValues.$inferSelect;
export type NewCustomFieldValue = typeof customFieldValues.$inferInsert;
export type StoredUserConfig = typeof userConfig.$inferSelect;
export type NewUserConfig = typeof userConfig.$inferInsert;
