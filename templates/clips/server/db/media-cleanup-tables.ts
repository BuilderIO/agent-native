import {
  index,
  integer,
  pgTable,
  text,
  boolean,
  primaryKey,
} from "drizzle-orm/pg-core";

export const recordingMediaCleanups = pgTable(
  "recording_media_cleanups",
  {
    id: text("id").primaryKey(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    storageMode: text("storage_mode"),
    allowanceUserId: text("allowance_user_id"),
    manifest: text("manifest").notNull(),
    status: text("status").notNull().default("pending"),
    reason: text("reason"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at").notNull(),
    leaseToken: text("lease_token"),
    leaseUntil: text("lease_until"),
    accountingSettled: boolean("accounting_settled").notNull().default(false),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("recording_media_cleanup_due_idx").on(t.status, t.nextAttemptAt),
    index("recording_media_cleanup_owner_idx").on(t.ownerEmail, t.createdAt),
  ],
);

export const recordingMediaCleanupObjects = pgTable(
  "recording_media_cleanup_objects",
  {
    recordingId: text("recording_id").notNull(),
    objectKey: text("object_key").notNull(),
    ownerEmail: text("owner_email").notNull(),
    provider: text("provider").notNull(),
    payload: text("payload"),
    phase: text("phase").notNull().default("pending"),
    lastProviderPhase: text("last_provider_phase"),
    reason: text("reason"),
    httpStatus: integer("http_status"),
    servingStatus: integer("serving_status"),
    deletionClaimed: boolean("deletion_claimed").notNull().default(false),
    attempts: integer("attempts").notNull().default(0),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recordingId, t.objectKey] }),
    index("recording_media_cleanup_object_idx").on(
      t.objectKey,
      t.deletionClaimed,
    ),
  ],
);

export const recordingMediaProducers = pgTable(
  "recording_media_producers",
  {
    id: text("id").primaryKey(),
    recordingId: text("recording_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    status: text("status").notNull().default("active"),
    payload: text("payload"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    index("recording_media_producer_recording_idx").on(t.recordingId, t.status),
  ],
);
