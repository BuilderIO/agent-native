import { createDashboardStorageSchema } from "@agent-native/core/dashboard-storage";
import { getDialect } from "@agent-native/core/db";
import {
  createSharesTable,
  integer,
  now,
  ownableColumns,
  real,
  table,
  text,
} from "@agent-native/core/db/schema";
import { customType as pgCustomType } from "drizzle-orm/pg-core";
import { integer as sqliteInteger } from "drizzle-orm/sqlite-core";

import { CRM_ATTRIBUTE_TYPES } from "../../shared/crm-attributes.js";

const pgIntegerBoolean = pgCustomType<{
  data: boolean;
  driverData: number;
}>({
  dataType: () => "integer",
  fromDriver: (value) => value !== 0,
  toDriver: (value) => (value ? 1 : 0),
});

const sqliteBoolean = <TName extends string>(name: TName) =>
  sqliteInteger(name, { mode: "boolean" });

const portableBoolean: typeof sqliteBoolean = ((name: string) =>
  getDialect() === "postgres"
    ? pgIntegerBoolean(name)
    : sqliteBoolean(name)) as unknown as typeof sqliteBoolean;

export const crmConnections = table("crm_connections", {
  id: text("id").primaryKey(),
  provider: text("provider", {
    enum: ["hubspot", "salesforce", "native", "custom"],
  }).notNull(),
  workspaceConnectionId: text("workspace_connection_id"),
  label: text("label").notNull(),
  accountId: text("account_id"),
  // `hybrid` is deprecated — kept so existing rows stay valid, treated as
  // `mirrored`. Per-attribute `authority` replaced it. See shared/crm-contract.ts.
  mode: text("mode", { enum: ["connected", "hybrid", "native"] })
    .notNull()
    .default("connected"),
  status: text("status", {
    enum: ["connected", "syncing", "error", "disconnected"],
  })
    .notNull()
    .default("connected"),
  selectedPipelinesJson: text("selected_pipelines_json")
    .notNull()
    .default("[]"),
  selectedObjectTypesJson: text("selected_object_types_json")
    .notNull()
    .default("[]"),
  accessScopeKey: text("access_scope_key").notNull(),
  accessScopeJson: text("access_scope_json").notNull().default("{}"),
  lastSyncedAt: text("last_synced_at"),
  lastError: text("last_error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmConnectionShares = createSharesTable("crm_connection_shares");

export const crmObjects = table("crm_objects", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  provider: text("provider").notNull(),
  objectType: text("object_type").notNull(),
  kind: text("kind", {
    enum: ["account", "person", "opportunity", "activity", "task", "custom"],
  }).notNull(),
  label: text("label").notNull(),
  pluralLabel: text("plural_label").notNull(),
  custom: portableBoolean("custom").notNull().default(false),
  queryable: portableBoolean("queryable").notNull().default(true),
  searchable: portableBoolean("searchable").notNull().default(true),
  createable: portableBoolean("createable").notNull().default(false),
  updateable: portableBoolean("updateable").notNull().default(false),
  deleteable: portableBoolean("deleteable").notNull().default(false),
  capabilitiesJson: text("capabilities_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmObjectShares = createSharesTable("crm_object_shares");

export const crmFieldPolicies = table("crm_field_policies", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  objectType: text("object_type").notNull(),
  fieldName: text("field_name").notNull(),
  label: text("label").notNull(),
  valueType: text("value_type").notNull(),
  storagePolicy: text("storage_policy", {
    enum: [
      "mirrored",
      "remote-only",
      "redacted",
      "derived-local",
      "local-authoritative",
    ],
  })
    .notNull()
    .default("remote-only"),
  sensitive: portableBoolean("sensitive").notNull().default(false),
  readable: portableBoolean("readable").notNull().default(true),
  createable: portableBoolean("createable").notNull().default(false),
  updateable: portableBoolean("updateable").notNull().default(false),
  required: portableBoolean("required").notNull().default(false),
  metadataJson: text("metadata_json").notNull().default("{}"),
  // --- typed attribute surface (additive; `crm_field_policies` IS the attribute table) ---
  attributeType: text("attribute_type", { enum: CRM_ATTRIBUTE_TYPES })
    .notNull()
    .default("text"),
  target: text("target", { enum: ["object", "list"] })
    .notNull()
    .default("object"),
  // `object_type` deliberately mirrors `target_id` for list attributes too, so
  // the legacy unique index (connection_id, object_type, field_name) keeps
  // guarding one attribute per target without a second unique index.
  targetId: text("target_id"),
  apiSlug: text("api_slug"),
  description: text("description"),
  multi: portableBoolean("multi").notNull().default(false),
  inverseAttributeId: text("inverse_attribute_id"),
  authority: text("authority", {
    enum: ["provider", "derived-local", "local-authoritative"],
  })
    .notNull()
    .default("provider"),
  historyTracked: portableBoolean("history_tracked").notNull().default(true),
  fillMode: text("fill_mode", {
    enum: ["agent-summarize", "agent-classify", "agent-research", "formula"],
  }),
  fillConfigJson: text("fill_config_json").notNull().default("{}"),
  configJson: text("config_json").notNull().default("{}"),
  uniqueValue: portableBoolean("unique_value").notNull().default(false),
  archived: portableBoolean("archived").notNull().default(false),
  position: integer("position").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmFieldPolicyShares = createSharesTable(
  "crm_field_policy_shares",
);

export const crmAttributeOptions = table("crm_attribute_options", {
  id: text("id").primaryKey(),
  attributeId: text("attribute_id").notNull(),
  value: text("value").notNull(),
  title: text("title").notNull(),
  color: text("color"),
  position: integer("position").notNull().default(0),
  archived: portableBoolean("archived").notNull().default(false),
  /** `status` attributes only: stage SLA in days. */
  targetDays: integer("target_days"),
  /** `status` attributes only. */
  celebrate: portableBoolean("celebrate").notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmAttributeOptionShares = createSharesTable(
  "crm_attribute_option_shares",
);

export const crmRecords = table("crm_records", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  provider: text("provider").notNull(),
  objectType: text("object_type").notNull(),
  kind: text("kind", {
    enum: ["account", "person", "opportunity", "activity", "task", "custom"],
  }).notNull(),
  remoteId: text("remote_id").notNull(),
  displayName: text("display_name").notNull(),
  primaryEmail: text("primary_email"),
  domain: text("domain"),
  stage: text("stage"),
  pipelineId: text("pipeline_id"),
  pipelineName: text("pipeline_name"),
  ownerRemoteId: text("owner_remote_id"),
  ownerName: text("owner_name"),
  amount: real("amount"),
  currencyCode: text("currency_code"),
  closeDate: text("close_date"),
  desiredCadenceDays: integer("desired_cadence_days"),
  lastMeaningfulInteractionAt: text("last_meaningful_interaction_at"),
  nextContactAt: text("next_contact_at"),
  remoteRevision: text("remote_revision"),
  remoteUpdatedAt: text("remote_updated_at"),
  lastSyncedAt: text("last_synced_at"),
  accessScopeKey: text("access_scope_key").notNull(),
  accessScopeJson: text("access_scope_json").notNull().default("{}"),
  tombstone: portableBoolean("tombstone").notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmRecordShares = createSharesTable("crm_record_shares");

/**
 * Bitemporal attribute values. The current value of an attribute is the row
 * with `activeUntil IS NULL`; every superseded value keeps its own row with the
 * instant it stopped being current. All writes go through
 * `server/lib/record-fields.ts` — a direct insert here bypasses the equality
 * check that keeps mirror syncs from writing a new history row every pass.
 */
export const crmRecordFields = table("crm_record_fields", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull(),
  /**
   * Set when this row holds a LIST-ENTRY attribute value rather than a record
   * attribute value. `recordId` stays populated either way (it is NOT NULL and
   * cannot be loosened additively), so the discriminator is `entryId IS NULL`.
   */
  entryId: text("entry_id"),
  fieldPolicyId: text("field_policy_id"),
  attributeId: text("attribute_id"),
  fieldName: text("field_name").notNull(),
  valueType: text("value_type").notNull(),
  storagePolicy: text("storage_policy", {
    enum: ["mirrored", "derived-local", "local-authoritative"],
  }).notNull(),
  stringValue: text("string_value"),
  numberValue: real("number_value"),
  booleanValue: portableBoolean("boolean_value"),
  jsonValue: text("json_value"),
  // ISO 8601, not the `datetime('now')` SQL default the older timestamp columns
  // use: this column is ordered against `activeUntil` in history queries, and
  // `"… 20:56:04"` sorts before `"…T20:56:04Z"` for the same instant.
  activeFrom: text("active_from")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  /** Null means this row is the current value. */
  activeUntil: text("active_until"),
  actorType: text("actor_type", {
    enum: ["user", "agent", "automation", "provider", "system"],
  })
    .notNull()
    .default("system"),
  actorId: text("actor_id"),
  // Sparse composite sub-fields. Columns, not json_extract: a WHERE clause over
  // JSON is dialect-divergent, and these are what the grid filters on.
  emailLocal: text("email_local"),
  emailDomain: text("email_domain"),
  emailRootDomain: text("email_root_domain"),
  phoneE164: text("phone_e164"),
  phoneCountry: text("phone_country"),
  domainRoot: text("domain_root"),
  nameFirst: text("name_first"),
  nameLast: text("name_last"),
  provenanceJson: text("provenance_json").notNull().default("[]"),
  accessScopeKey: text("access_scope_key").notNull().default("unverified"),
  accessScopeJson: text("access_scope_json").notNull().default("{}"),
  remoteRevision: text("remote_revision"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmRecordFieldShares = createSharesTable(
  "crm_record_field_shares",
);

/**
 * Lists are local-authoritative on every backend, including HubSpot and
 * Salesforce. `source: "imported"` records where a list came from; it never
 * makes the provider authoritative for its membership.
 */
export const crmLists = table("crm_lists", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  name: text("name").notNull(),
  apiSlug: text("api_slug").notNull(),
  parentObjectType: text("parent_object_type").notNull(),
  description: text("description").notNull().default(""),
  defaultViewId: text("default_view_id"),
  archived: portableBoolean("archived").notNull().default(false),
  position: integer("position").notNull().default(0),
  source: text("source", { enum: ["local", "imported"] })
    .notNull()
    .default("local"),
  sourceRemoteId: text("source_remote_id"),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmListShares = createSharesTable("crm_list_shares");

/**
 * A record may hold more than one entry in the same list (two open renewals for
 * one account, say), so there is deliberately no unique `(list_id, record_id)`.
 */
export const crmListEntries = table("crm_list_entries", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  recordId: text("record_id").notNull(),
  position: integer("position").notNull().default(0),
  createdByActorType: text("created_by_actor_type", {
    enum: ["user", "agent", "automation", "provider", "system"],
  })
    .notNull()
    .default("system"),
  createdByActorId: text("created_by_actor_id"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmListEntryShares = createSharesTable("crm_list_entry_shares");

export const crmRelationships = table("crm_relationships", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  fromRecordId: text("from_record_id").notNull(),
  toRecordId: text("to_record_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  label: text("label"),
  inverseLabel: text("inverse_label"),
  sourceField: text("source_field"),
  remoteRelationshipId: text("remote_relationship_id"),
  remoteRevision: text("remote_revision"),
  tombstone: portableBoolean("tombstone").notNull().default(false),
  lastSyncedAt: text("last_synced_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmRelationshipShares = createSharesTable(
  "crm_relationship_shares",
);

export const crmInteractions = table("crm_interactions", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull(),
  connectionId: text("connection_id"),
  kind: text("kind", {
    enum: ["call", "meeting", "email", "note", "message", "other"],
  }).notNull(),
  direction: text("direction", {
    enum: ["inbound", "outbound", "internal", "unknown"],
  })
    .notNull()
    .default("unknown"),
  title: text("title").notNull(),
  summary: text("summary").notNull().default(""),
  occurredAt: text("occurred_at").notNull(),
  meaningful: portableBoolean("meaningful").notNull().default(true),
  providerObjectType: text("provider_object_type"),
  providerRemoteId: text("provider_remote_id"),
  sourceApp: text("source_app"),
  sourceUrl: text("source_url"),
  participantsJson: text("participants_json").notNull().default("[]"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmInteractionShares = createSharesTable("crm_interaction_shares");

export const crmCallEvidence = table("crm_call_evidence", {
  id: text("id").primaryKey(),
  interactionId: text("interaction_id"),
  recordId: text("record_id").notNull(),
  sourceApp: text("source_app").notNull().default("clips"),
  artifactType: text("artifact_type").notNull().default("call-evidence"),
  artifactId: text("artifact_id").notNull(),
  sourceUrl: text("source_url").notNull(),
  quote: text("quote").notNull().default(""),
  speaker: text("speaker"),
  startSeconds: real("start_seconds"),
  endSeconds: real("end_seconds"),
  summary: text("summary").notNull().default(""),
  capturedAt: text("captured_at").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmCallEvidenceShares = createSharesTable(
  "crm_call_evidence_shares",
);

export const crmSignalTrackers = table("crm_signal_trackers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  kind: text("kind", { enum: ["keyword", "smart"] }).notNull(),
  keywordsJson: text("keywords_json").notNull().default("[]"),
  classifierPrompt: text("classifier_prompt").notNull().default(""),
  enabled: portableBoolean("enabled").notNull().default(true),
  isDefault: portableBoolean("is_default").notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmSignalTrackerShares = createSharesTable(
  "crm_signal_tracker_shares",
);

export const crmSignalRuns = table("crm_signal_runs", {
  id: text("id").primaryKey(),
  trackerId: text("tracker_id"),
  recordId: text("record_id").notNull(),
  kind: text("kind", { enum: ["keyword", "smart", "summary"] }).notNull(),
  status: text("status", {
    enum: ["queued", "running", "completed", "failed"],
  })
    .notNull()
    .default("queued"),
  evidenceCount: integer("evidence_count").notNull().default(0),
  model: text("model"),
  modelVersion: text("model_version"),
  idempotencyKey: text("idempotency_key").notNull(),
  error: text("error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  completedAt: text("completed_at"),
  ...ownableColumns(),
});

export const crmSignalRunShares = createSharesTable("crm_signal_run_shares");

export const crmSignals = table("crm_signals", {
  id: text("id").primaryKey(),
  runId: text("run_id"),
  trackerId: text("tracker_id"),
  recordId: text("record_id").notNull(),
  evidenceId: text("evidence_id").notNull(),
  kind: text("kind", {
    enum: ["moment", "call-summary", "next-step"],
  }).notNull(),
  label: text("label").notNull(),
  quote: text("quote").notNull().default(""),
  speaker: text("speaker"),
  startSeconds: real("start_seconds"),
  endSeconds: real("end_seconds"),
  summary: text("summary").notNull().default(""),
  confidence: real("confidence").notNull().default(0),
  detector: text("detector", { enum: ["keyword", "agent"] }).notNull(),
  model: text("model"),
  modelVersion: text("model_version"),
  reviewStatus: text("review_status", {
    enum: ["unreviewed", "confirmed", "dismissed"],
  })
    .notNull()
    .default("unreviewed"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmSignalShares = createSharesTable("crm_signal_shares");

export const crmTasks = table("crm_tasks", {
  id: text("id").primaryKey(),
  recordId: text("record_id"),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  status: text("status", { enum: ["open", "done", "cancelled"] })
    .notNull()
    .default("open"),
  dueAt: text("due_at"),
  assignedTo: text("assigned_to"),
  authority: text("authority", { enum: ["local", "provider"] })
    .notNull()
    .default("local"),
  connectionId: text("connection_id"),
  providerObjectType: text("provider_object_type"),
  providerRemoteId: text("provider_remote_id"),
  remoteRevision: text("remote_revision"),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmTaskShares = createSharesTable("crm_task_shares");

export const crmSavedViews = table("crm_saved_views", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // `kind` predates typed views and holds the RECORD kind (account/person/
  // opportunity) that crm-store.ts validates. The table-vs-board discriminator
  // is `viewKind`; do not repurpose `kind`.
  kind: text("kind"),
  viewKind: text("view_kind", { enum: ["table", "board"] })
    .notNull()
    .default("table"),
  targetKind: text("target_kind", { enum: ["object", "list"] })
    .notNull()
    .default("object"),
  targetId: text("target_id"),
  /** Board views only; must reference a `status` attribute. */
  groupByAttributeId: text("group_by_attribute_id"),
  // personal-vs-shared is the framework `visibility` column from
  // ownableColumns(): "private" is personal, "org" is shared. No second column.
  filtersJson: text("filters_json").notNull().default("{}"),
  columnsJson: text("columns_json").notNull().default("[]"),
  sortJson: text("sort_json").notNull().default("[]"),
  dataProgramId: text("data_program_id"),
  pinned: portableBoolean("pinned").notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmSavedViewShares = createSharesTable("crm_saved_view_shares");

export const crmMutations = table("crm_mutations", {
  id: text("id").primaryKey(),
  recordId: text("record_id"),
  connectionId: text("connection_id"),
  operation: text("operation", {
    enum: ["create", "update", "delete", "associate", "disassociate"],
  }).notNull(),
  initiatedBy: text("initiated_by", {
    enum: ["human", "agent", "automation"],
  }).notNull(),
  target: text("target", { enum: ["local", "provider"] }).notNull(),
  policyDecision: text("policy_decision", {
    enum: ["execute", "propose", "require-approval", "deny"],
  }).notNull(),
  risk: text("risk").notNull().default("routine"),
  status: text("status", {
    enum: ["pending", "approved", "applied", "rejected", "conflict", "failed"],
  })
    .notNull()
    .default("pending"),
  patchJson: text("patch_json").notNull().default("{}"),
  beforeJson: text("before_json").notNull().default("{}"),
  afterJson: text("after_json").notNull().default("{}"),
  idempotencyKey: text("idempotency_key").notNull(),
  expectedRemoteRevision: text("expected_remote_revision"),
  providerRemoteRevision: text("provider_remote_revision"),
  approvedBy: text("approved_by"),
  approvedAt: text("approved_at"),
  appliedAt: text("applied_at"),
  error: text("error"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmMutationShares = createSharesTable("crm_mutation_shares");

export const crmSyncRuns = table("crm_sync_runs", {
  id: text("id").primaryKey(),
  connectionId: text("connection_id").notNull(),
  status: text("status", {
    enum: ["running", "success", "partial", "failed"],
  })
    .notNull()
    .default("running"),
  scopeJson: text("scope_json").notNull().default("{}"),
  cursor: text("cursor"),
  recordsUpserted: integer("records_upserted").notNull().default(0),
  tombstonesApplied: integer("tombstones_applied").notNull().default(0),
  relationshipsUpserted: integer("relationships_upserted").notNull().default(0),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmSyncRunShares = createSharesTable("crm_sync_run_shares");

/**
 * One enrichment pass over a scope of records.
 *
 * Two rows make one gated enrichment: a `verify` run that gathers evidence
 * without touching contact data, and — only after a human approves some of its
 * records — a `spend` run whose `inputRecordIdsJson` is built from those
 * approvals alone. That frozen id list is the structural bound on spend: the
 * paid pass never sees an unapproved record, rather than filtering one out.
 */
export const crmEnrichmentRuns = table("crm_enrichment_runs", {
  id: text("id").primaryKey(),
  /**
   * What a duplicate run is "the same scope" as, keyed `${scopeKind}:${scopeId}`.
   * An ad-hoc `records` scope has no natural id, so `scopeId` is a deterministic
   * hash of its sorted record ids — without that, the duplicate-run guard either
   * collides across unrelated ad-hoc runs or never matches, and a double-click
   * buys the same contacts twice.
   */
  scopeKind: text("scope_kind", {
    enum: ["object", "list", "records"],
  }).notNull(),
  scopeId: text("scope_id").notNull(),
  phase: text("phase", { enum: ["verify", "spend"] }).notNull(),
  status: text("status", {
    enum: ["queued", "running", "completed", "failed"],
  })
    .notNull()
    .default("queued"),
  /** `spend` only: the verify run whose approved evidence built this input set. */
  sourceRunId: text("source_run_id"),
  slotsJson: text("slots_json").notNull().default("[]"),
  inputRecordIdsJson: text("input_record_ids_json").notNull().default("[]"),
  /** Per-record slot outcomes. Bounded facts and errors only — never payloads. */
  outcomesJson: text("outcomes_json").notNull().default("[]"),
  estimateJson: text("estimate_json").notNull().default("{}"),
  costUnits: real("cost_units"),
  /** Atomic claim: write a unique nonce, read it back, only the winner proceeds. */
  claimNonce: text("claim_nonce"),
  claimedAt: text("claimed_at"),
  error: text("error"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmEnrichmentRunShares = createSharesTable(
  "crm_enrichment_run_shares",
);

const crmDashboardStorageSchema = createDashboardStorageSchema({
  dashboardsTable: "crm_dashboards",
  revisionsTable: "crm_dashboard_revisions",
  sharesTable: "crm_dashboard_shares",
});

export const crmDashboards = crmDashboardStorageSchema.dashboards;
export const crmDashboardRevisions =
  crmDashboardStorageSchema.dashboardRevisions;
export const crmDashboardShares = crmDashboardStorageSchema.dashboardShares;
