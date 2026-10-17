import { bigint, index, table, text } from "../db/schema.js";

export const iconAssets = table(
  "private_icon_assets",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    mimeType: text("mime_type").notNull(),
    filename: text("filename"),
    alt: text("alt"),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    blobHandleJson: text("blob_handle_json").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    index("private_icon_assets_owner_org_created_idx").on(
      table.ownerEmail,
      table.orgId,
      table.createdAt,
    ),
  ],
);
