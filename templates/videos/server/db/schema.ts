import { table, text, now } from "@agent-native/core/db/schema";

export const compositions = table("compositions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  data: text("data").notNull(), // Full composition JSON
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});
