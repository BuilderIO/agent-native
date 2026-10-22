import { integer, now, table, text } from "@agent-native/core/db/schema";

export const qrHistory = table("qr_history", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull().default(""),
  label: text("label").notNull(),
  content: text("content").notNull(),
  // guard:allow-raw-color — persisted QR output default must remain black.
  fgColor: text("fg_color").notNull().default("#000000"),
  // guard:allow-raw-color — persisted QR output default must remain white.
  bgColor: text("bg_color").notNull().default("#ffffff"),
  format: text("format").notNull().default("png"),
  size: integer("size").notNull().default(256),
  margin: integer("margin").notNull().default(2),
  createdAt: text("created_at").notNull().default(now()),
});
