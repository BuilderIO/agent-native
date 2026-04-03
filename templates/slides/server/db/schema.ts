import { table, text, now } from "@agent-native/core/db/schema";

export const decks = table("decks", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  data: text("data").notNull(), // Full deck JSON
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});
