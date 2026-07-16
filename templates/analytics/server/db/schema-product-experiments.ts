import { index, integer, now, table, text } from "@agent-native/core/db/schema";

/** Analytics-owned record of a boolean feature-flag product experiment. */
export const productExperiments = table(
  "product_experiments",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    hypothesis: text("hypothesis").notNull().default(""),
    appId: text("app_id").notNull(),
    appOrigin: text("app_origin").notNull(),
    flagKey: text("flag_key").notNull(),
    primaryEventName: text("primary_event_name").notNull(),
    status: text("status", {
      enum: ["draft", "running", "paused", "completed", "interrupted"],
    })
      .notNull()
      .default("draft"),
    treatmentPercentage: integer("treatment_percentage").notNull().default(50),
    rolloutEpoch: text("rollout_epoch"),
    startedAt: text("started_at"),
    endedAt: text("ended_at"),
    interruptionReason: text("interruption_reason"),
    reconciledAt: text("reconciled_at"),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: text("created_at").notNull().default(now()),
    updatedAt: text("updated_at").notNull().default(now()),
    ownerEmail: text("owner_email").notNull().default("local@localhost"),
    orgId: text("org_id").notNull(),
  },
  (t) => ({
    scopeUpdatedIdx: index("product_experiments_scope_updated_idx").on(
      t.orgId,
      t.updatedAt,
    ),
    appFlagStatusIdx: index("product_experiments_app_flag_status_idx").on(
      t.orgId,
      t.appId,
      t.flagKey,
      t.status,
    ),
    resultWindowIdx: index("product_experiments_result_window_idx").on(
      t.orgId,
      t.appId,
      t.startedAt,
      t.endedAt,
    ),
  }),
);

/** Short-lived cross-instance guard for target-first experiment starts. */
export const featureFlagMutationLocks = table(
  "feature_flag_mutation_locks",
  {
    lockKey: text("lock_key").primaryKey(),
    lockToken: text("lock_token").notNull(),
    operationId: text("operation_id").notNull(),
    orgId: text("org_id").notNull(),
    createdAt: text("created_at").notNull().default(now()),
  },
  (t) => ({
    createdIdx: index("feature_flag_mutation_locks_created_idx").on(
      t.createdAt,
    ),
  }),
);
