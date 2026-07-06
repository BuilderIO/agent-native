import {
  index,
  integer,
  table,
  text,
  uniqueIndex,
} from "@agent-native/core/db/schema";

export const sourceCursors = table(
  "delivery_source_cursors",
  {
    id: text("id").primaryKey(),
    scopeKey: text("scope_key").notNull(),
    provider: text("provider").notNull(),
    cursorKey: text("cursor_key").notNull().default("default"),
    cursorValue: text("cursor_value"),
    lastSyncRunId: text("last_sync_run_id"),
    lastSyncStatus: text("last_sync_status", {
      enum: ["idle", "succeeded", "failed"],
    })
      .notNull()
      .default("idle"),
    lastSyncedAt: text("last_synced_at"),
    error: text("error"),
    updatedAt: text("updated_at").notNull(),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    providerCursorUnique: uniqueIndex(
      "delivery_source_cursors_provider_key_uidx",
    ).on(t.scopeKey, t.provider, t.cursorKey),
    ownerUpdated: index("delivery_source_cursors_owner_org_updated_idx").on(
      t.ownerEmail,
      t.orgId,
      t.updatedAt,
    ),
  }),
);

export const rawArchives = table(
  "delivery_raw_archives",
  {
    id: text("id").primaryKey(),
    provider: text("provider").notNull(),
    sourceId: text("source_id").notNull(),
    rawRef: text("raw_ref").notNull(),
    ingestRunId: text("ingest_run_id"),
    capturedAt: text("captured_at").notNull(),
    retained: integer("retained", { mode: "boolean" }).notNull().default(true),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id"),
  },
  (t) => ({
    providerSource: index("delivery_raw_archives_provider_source_idx").on(
      t.provider,
      t.sourceId,
      t.capturedAt,
    ),
  }),
);
