import {
  createSharesTable,
  integer,
  now,
  ownableColumns,
  real,
  table,
  text,
} from "@agent-native/core/db/schema";

export const crmConnections = table("crm_connections", {
  id: text("id").primaryKey(),
  provider: text("provider", {
    enum: ["hubspot", "salesforce", "native", "custom"],
  }).notNull(),
  workspaceConnectionId: text("workspace_connection_id"),
  label: text("label").notNull(),
  accountId: text("account_id"),
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
  custom: integer("custom", { mode: "boolean" }).notNull().default(false),
  queryable: integer("queryable", { mode: "boolean" }).notNull().default(true),
  searchable: integer("searchable", { mode: "boolean" })
    .notNull()
    .default(true),
  createable: integer("createable", { mode: "boolean" })
    .notNull()
    .default(false),
  updateable: integer("updateable", { mode: "boolean" })
    .notNull()
    .default(false),
  deleteable: integer("deleteable", { mode: "boolean" })
    .notNull()
    .default(false),
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
  sensitive: integer("sensitive", { mode: "boolean" }).notNull().default(false),
  readable: integer("readable", { mode: "boolean" }).notNull().default(true),
  createable: integer("createable", { mode: "boolean" })
    .notNull()
    .default(false),
  updateable: integer("updateable", { mode: "boolean" })
    .notNull()
    .default(false),
  required: integer("required", { mode: "boolean" }).notNull().default(false),
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmFieldPolicyShares = createSharesTable(
  "crm_field_policy_shares",
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
  tombstone: integer("tombstone", { mode: "boolean" }).notNull().default(false),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmRecordShares = createSharesTable("crm_record_shares");

export const crmRecordFields = table("crm_record_fields", {
  id: text("id").primaryKey(),
  recordId: text("record_id").notNull(),
  fieldPolicyId: text("field_policy_id"),
  fieldName: text("field_name").notNull(),
  valueType: text("value_type").notNull(),
  storagePolicy: text("storage_policy", {
    enum: ["mirrored", "derived-local", "local-authoritative"],
  }).notNull(),
  stringValue: text("string_value"),
  numberValue: real("number_value"),
  booleanValue: integer("boolean_value", { mode: "boolean" }),
  jsonValue: text("json_value"),
  provenanceJson: text("provenance_json").notNull().default("[]"),
  remoteRevision: text("remote_revision"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const crmRecordFieldShares = createSharesTable(
  "crm_record_field_shares",
);

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
  tombstone: integer("tombstone", { mode: "boolean" }).notNull().default(false),
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
  meaningful: integer("meaningful", { mode: "boolean" })
    .notNull()
    .default(true),
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
  kind: text("kind"),
  filtersJson: text("filters_json").notNull().default("{}"),
  columnsJson: text("columns_json").notNull().default("[]"),
  sortJson: text("sort_json").notNull().default("[]"),
  dataProgramId: text("data_program_id"),
  pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
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
