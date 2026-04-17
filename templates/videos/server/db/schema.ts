import {
  table,
  text,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const compositions = table("compositions", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  data: text("data").notNull(), // Full composition JSON
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const compositionShares = createSharesTable("composition_shares");
