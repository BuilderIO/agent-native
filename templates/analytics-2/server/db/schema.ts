import {
  createSharesTable,
  ownableColumns,
} from "@agent-native/core/db/schema";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { z } from "zod";

import type { ProjectDocument } from "../../app/lib/model/contracts.js";
import type {
  AnalyticsPrompt,
  persistedThreadProjection,
  ThreadTurnReceipt,
  threadAccessReceipt,
  stopThreadReceipt,
  threadMode,
  uploadManifest,
} from "../../shared/analytics-thread.js";
import type { AppDocument } from "../../shared/app-layout.js";
import type {
  AppInputValues,
  AppSessionOperation,
  AppSessionRefresh,
  SavedAppView,
} from "../../shared/app-session-operations.js";
import type { CreationReceipt } from "../../shared/notebook-creation.js";
import type {
  AttemptIdentity,
  RunNamespace,
  RunReceipt,
  Snapshot,
} from "../../shared/notebook-execution.js";
import type { DraftHead } from "../../shared/notebook-snapshot-contract.js";
import type {
  CancelPublishPreviewReceipt,
  PublishPreviewReceipt,
  PublishProjectReceipt,
  ReleaseOutput,
} from "../../shared/project-publish.js";
import type { PublishedAppAccessReceipt } from "../../shared/project-sharing.js";
import type {
  PublishedAppScheduleConfig,
  ScheduleRecipient,
  scheduleTickStatus,
  scheduleCacheStatus,
  scheduleDiagnostic,
  scheduleDeliveryOutcome,
  setScheduleOutput,
  stopScheduleRunOutput,
} from "../../shared/published-app-schedules.js";
import type { KernelVariableState } from "../model/notebook-execution/schema.js";
import {
  notebookCellColumns,
  notebookProjectColumns,
} from "../model/notebook-operations/schema.js";
import { notebookThreadProjects } from "../model/notebook-proposal-schema.js";

export {
  notebookEvents,
  notebookReceipts,
  notebookTombstones,
} from "../model/notebook-operations/schema.js";

/**
 * Tables for the analytics workspace: projects and their versions, the cells
 * that make up a project, run outputs, the collection tree and the
 * organisation's project statuses.
 *
 * Table names carry the `analytics2_` prefix because this workspace shares one
 * database with the other apps.
 */
export const projects = pgTable(
  "analytics2_projects",
  {
    ...ownableColumns(),
    ...notebookProjectColumns,
    id: text("id").primaryKey(),
    title: text("title").notNull().default(""),
    untitledOrdinal: integer("untitled_ordinal"),
    description: text("description").notNull().default(""),
    language: text("language", { enum: ["python", "r"] })
      .notNull()
      .default("python"),
    statusId: text("status_id"),
    favorited: boolean("favorited").notNull().default(false),
    allowEmbedding: boolean("allow_embedding").notNull().default(false),
    listed: boolean("listed").notNull().default(true),
    trashedAt: text("trashed_at"),
    archivedAt: text("archived_at"),
    lastOpenedAt: text("last_opened_at"),
    userUpdatedAt: text("user_updated_at"),
    workingVersionId: text("working_version_id").notNull(),
    notebookDefaultRunMode: text("notebook_default_run_mode", {
      enum: ["auto", "upstream", "downstream", "cell-only"],
    })
      .notNull()
      .default("auto"),
    notebookAutoRerun: boolean("notebook_auto_rerun").notNull().default(true),
    notebookLastSqlSource: jsonb("notebook_last_sql_source").$type<
      { kind: "dataframes" } | { kind: "warehouse"; connectionId: string }
    >(),
    notebookRunSettingsRevision: bigint("notebook_run_settings_revision", {
      mode: "bigint",
    })
      .notNull()
      .default(0n),
    publishedVersionId: text("published_version_id"),
    appSharingRevision: bigint("app_sharing_revision", { mode: "bigint" })
      .notNull()
      .default(0n),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("analytics2_projects_owner_updated_idx").on(
      table.ownerEmail,
      table.updatedAt,
    ),
    index("analytics2_projects_owner_trashed_idx").on(
      table.ownerEmail,
      table.trashedAt,
    ),
    index("analytics2_projects_scope_page_idx").on(
      table.ownerEmail,
      table.orgId,
      table.updatedAt,
      table.id,
    ),
    index("analytics2_projects_working_version_idx").on(table.workingVersionId),
  ],
);

export const kernelNamespaces = pgTable(
  "analytics2_kernel_namespaces",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").$type<RunNamespace["kind"]>().notNull(),
    scopeId: text("scope_id").notNull(),
    principalId: text("principal_id").notNull(),
    lineageId: text("lineage_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    hostId: text("host_id"),
    serviceSha: text("service_sha"),
    imageDigest: text("image_digest"),
    status: text("status", {
      enum: ["reserved", "ready", "busy", "stopped", "expired"],
    }).notNull(),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull(),
    variableState: jsonb("variable_state").$type<KernelVariableState>(),
  },
  (table) => [
    uniqueIndex("analytics2_kernel_namespaces_scope_uq").on(
      table.orgId,
      table.projectId,
      table.scopeKind,
      table.scopeId,
      table.principalId,
    ),
  ],
);

export const kernelOperations = pgTable(
  "analytics2_kernel_operations",
  {
    namespaceId: text("namespace_id")
      .notNull()
      .references(() => kernelNamespaces.id, { onDelete: "cascade" }),
    requestId: text("request_id").notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    intent: text("intent").notNull(),
    receipt: jsonb("receipt").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.namespaceId, table.requestId] })],
);

export const projectVersions = pgTable(
  "analytics2_project_versions",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: text("number").notNull(),
    kind: text("kind", {
      enum: ["autosave", "published", "named"],
    })
      .notNull()
      .default("autosave"),
    name: text("name"),
    capturedOutputCount: integer("captured_output_count"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    createdBy: text("created_by").notNull().default(""),
  },
  (table) => [
    uniqueIndex("analytics2_project_versions_number_uq").on(
      table.projectId,
      table.number,
    ),
    index("analytics2_project_versions_project_created_idx").on(
      table.projectId,
      table.createdAt,
    ),
  ],
);

export const appLayouts = pgTable(
  "analytics2_app_layouts",
  {
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workingVersionId: text("working_version_id")
      .notNull()
      .references(() => projectVersions.id, { onDelete: "cascade" }),
    layoutRevision: bigint("layout_revision", { mode: "bigint" }).notNull(),
    document: jsonb("document").$type<AppDocument>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.projectId, table.workingVersionId],
    }),
    index("analytics2_app_layouts_version_idx").on(table.workingVersionId),
  ],
);

export const cells = pgTable(
  "analytics2_cells",
  {
    ...notebookCellColumns,
    /** A cell keeps its id across versions, so a published copy can share it. */
    id: text("id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    versionId: text("version_id").notNull(),
    kind: text("kind").notNull(),
    /** Compared as text; see app/lib/model/order.ts. */
    order: text("order").notNull().default(""),
    label: text("label"),
    hidden: boolean("hidden").notNull().default(false),
    gridX: integer("grid_x"),
    gridY: integer("grid_y"),
    gridWidth: integer("grid_width"),
    gridHeight: integer("grid_height"),
    /** Serialized cell contents; see server/model/json-column.ts. */
    contents: text("contents").notNull().default("{}"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_cells_version_id_uq").on(table.versionId, table.id),
    index("analytics2_cells_version_order_idx").on(
      table.versionId,
      table.order,
    ),
    index("analytics2_cells_project_idx").on(table.projectId),
  ],
);

export const collections = pgTable(
  "analytics2_collections",
  {
    ...ownableColumns(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    emoji: text("emoji"),
    kind: text("kind", { enum: ["collection", "folder"] })
      .notNull()
      .default("collection"),
    parentId: text("parent_id"),
    favorited: boolean("favorited").notNull().default(false),
    trashedAt: text("trashed_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("analytics2_collections_owner_parent_idx").on(
      table.ownerEmail,
      table.parentId,
    ),
    index("analytics2_collections_owner_updated_idx").on(
      table.ownerEmail,
      table.updatedAt,
    ),
    index("analytics2_collections_scope_parent_idx").on(
      table.ownerEmail,
      table.orgId,
      table.parentId,
    ),
  ],
);

/**
 * A project's categories. Categories themselves are the organisation-wide
 * catalogue shared with the data surfaces; this table only records which
 * catalogue entries a project carries.
 */
export const projectCategories = pgTable(
  "analytics2_project_categories",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    categoryId: text("category_id").notNull(),
    addedAt: text("added_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_project_categories_uq").on(
      table.projectId,
      table.categoryId,
    ),
    index("analytics2_project_categories_category_idx").on(table.categoryId),
  ],
);

/**
 * One row per project open, by one viewer. "Popular" counts distinct viewers, so
 * four opens by the same person are one viewer, and the row is scoped on read
 * through the project it points at.
 */
export const projectViews = pgTable(
  "analytics2_project_views",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    viewerEmail: text("viewer_email").notNull(),
    orgId: text("org_id"),
    viewedAt: text("viewed_at").notNull(),
    viewKind: text("view_kind"),
  },
  (table) => [
    index("analytics2_project_views_project_idx").on(
      table.projectId,
      table.viewedAt,
    ),
    index("analytics2_project_views_viewer_idx").on(
      table.viewerEmail,
      table.viewedAt,
    ),
  ],
);

export const projectCollections = pgTable(
  "analytics2_project_collections",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    collectionId: text("collection_id")
      .notNull()
      .references(() => collections.id, { onDelete: "cascade" }),
    addedAt: text("added_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_project_collections_uq").on(
      table.projectId,
      table.collectionId,
    ),
    index("analytics2_project_collections_collection_idx").on(
      table.collectionId,
    ),
  ],
);

export const runs = pgTable(
  "analytics2_runs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    cellId: text("cell_id").notNull(),
    status: text("status", {
      enum: ["queued", "running", "complete", "error", "cancelled"],
    })
      .notNull()
      .default("queued"),
    startedAt: text("started_at").notNull(),
    finishedAt: text("finished_at"),
    durationMs: bigint("duration_ms", { mode: "number" }),
    output: text("output"),
  },
  (table) => [
    index("analytics2_runs_project_started_idx").on(
      table.projectId,
      table.startedAt,
    ),
    index("analytics2_runs_cell_started_idx").on(table.cellId, table.startedAt),
  ],
);

/** The output a cell currently shows, one row per cell. */
export const cellOutputs = pgTable(
  "analytics2_cell_outputs",
  {
    cellId: text("cell_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    runId: text("run_id"),
    sourceConnectionId: text("source_connection_id"),
    connectionProvenanceRecorded: boolean("connection_provenance_recorded")
      .notNull()
      .default(false),
    status: text("status", {
      enum: ["queued", "running", "complete", "error", "cancelled"],
    })
      .notNull()
      .default("queued"),
    output: text("output"),
    ranAt: text("ran_at").notNull(),
    undo: jsonb("undo"),
  },
  (table) => [index("analytics2_cell_outputs_project_idx").on(table.projectId)],
);

export const cellOutputGenerations = pgTable(
  "analytics2_cell_output_generations",
  {
    cellId: text("cell_id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    generation: text("generation").notNull(),
  },
  (table) => [
    index("analytics2_cell_output_generations_project_idx").on(table.projectId),
  ],
);

/** Results captured with one published version; working output writes never touch these rows. */
export const publishedCellOutputs = pgTable(
  "analytics2_published_cell_outputs",
  {
    versionId: text("version_id")
      .notNull()
      .references(() => projectVersions.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    cellId: text("cell_id").notNull(),
    sourceConnectionId: text("source_connection_id"),
    connectionProvenanceRecorded: boolean("connection_provenance_recorded")
      .notNull()
      .default(false),
    status: text("status", {
      enum: ["queued", "running", "complete", "error", "cancelled"],
    })
      .notNull()
      .default("queued"),
    output: text("output"),
    ranAt: text("ran_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.versionId, table.cellId] }),
    index("analytics2_published_cell_outputs_project_version_idx").on(
      table.projectId,
      table.versionId,
    ),
  ],
);

/**
 * Private dataframe blobs created for this project's outputs. Runs, working
 * outputs and published snapshots refer to a blob by handle; this table is the
 * durable ledger cleanup reads, so it deliberately has no foreign key and
 * survives a project's deletion until the stored blob is confirmed gone.
 */
export const dataframeBlobs = pgTable(
  "analytics2_dataframe_blobs",
  {
    provider: text("provider").notNull(),
    handleId: text("handle_id").notNull(),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id").notNull(),
    handleJson: text("handle_json").notNull(),
    state: text("state", { enum: ["live", "deleting"] })
      .notNull()
      .default("live"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.handleId] }),
    index("analytics2_dataframe_blobs_project_idx").on(
      table.ownerEmail,
      table.orgId,
      table.projectId,
    ),
  ],
);

export const statuses = pgTable(
  "analytics2_statuses",
  {
    ...ownableColumns(),
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    color: text("color"),
    endorsed: boolean("endorsed").notNull().default(false),
    inLibrary: boolean("in_library").notNull().default(false),
    enforcesReview: boolean("enforces_review").notNull().default(false),
    isDefault: boolean("is_default").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_statuses_org_name_uq").on(table.orgId, table.name),
    index("analytics2_statuses_scope_order_idx").on(
      table.ownerEmail,
      table.orgId,
      table.sortOrder,
    ),
  ],
);

/** Project sharing grants. */
export const projectShares = createSharesTable("analytics2_project_shares");

export const publishedAppGrants = pgTable(
  "analytics2_published_app_grants",
  {
    id: text("id").primaryKey(),
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull(),
    role: text("role", { enum: ["app_viewer"] })
      .notNull()
      .default("app_viewer"),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "string" }),
  },
  (table) => [
    check(
      "analytics2_published_app_grants_role_check",
      sql`${table.role} = 'app_viewer'`,
    ),
    uniqueIndex("analytics2_app_grant_active")
      .on(table.orgId, table.projectId, table.memberId)
      .where(sql`${table.revokedAt} IS NULL`),
    index("analytics2_app_grant_member_active")
      .on(table.orgId, table.memberId, table.projectId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

export const projectConnectionLinks = pgTable(
  "analytics2_project_connection_links",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    orgId: text("workspace_id").notNull(),
    connectionId: text("connection_id").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.projectId, table.connectionId] })],
);

export const publishedAppShareReceipts = pgTable(
  "analytics2_published_app_share_receipts",
  {
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    opId: uuid("op_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    receipt: jsonb("receipt").$type<PublishedAppAccessReceipt>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.projectId, table.actorId, table.opId],
    }),
  ],
);

export const collectionShares = createSharesTable(
  "analytics2_collection_shares",
);

export const schema = {
  projects,
  projectShares,
  collectionShares,
  projectVersions,
  cells,
  collections,
  projectCollections,
  projectCategories,
  runs,
  cellOutputs,
  cellOutputGenerations,
  statuses,
};

/** Server-managed query provenance; never stored in browser-writable settings. */
export const dbtQueryOperations = pgTable("analytics2_dbt_query_operations", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  orgId: text("org_id").notNull(),
  value: text("value").notNull(),
});

export const notebookCreationReceipts = pgTable(
  "analytics2_notebook_creation_receipts",
  {
    orgId: text("workspace_id").notNull(),
    principalId: text("principal_id").notNull(),
    requestId: text("request_id").notNull(),
    projectId: text("project_id").notNull(),
    workingVersionId: text("working_version_id").notNull(),
    fingerprint: text("intent_fingerprint").notNull(),
    receipt: jsonb("receipt_json").$type<CreationReceipt>(),
    committedAt: text("committed_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orgId, table.principalId, table.requestId] }),
    index("analytics2_notebook_creation_receipts_project_idx").on(
      table.projectId,
    ),
  ],
);

export const publishPreviews = pgTable(
  "analytics2_publish_previews",
  {
    id: text("id").primaryKey(),
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    createRequestId: text("create_request_id").notNull(),
    intent: text("intent").notNull(),
    snapshot: jsonb("snapshot").$type<Snapshot>().notNull(),
    project: jsonb("project").$type<ProjectDocument>().notNull(),
    comparedReleaseId: text("compared_release_id"),
    runId: text("run_id"),
    createReceipt: jsonb("create_receipt").$type<PublishPreviewReceipt>(),
    cancelledAt: text("cancelled_at"),
    publishedReleaseId: text("published_release_id"),
    createdAt: text("created_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_publish_previews_intent_uq").on(
      table.orgId,
      table.projectId,
      table.actorId,
      table.createRequestId,
    ),
  ],
);

export const publishPreviewCancels = pgTable(
  "analytics2_publish_preview_cancels",
  {
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    actorId: text("actor_id").notNull(),
    createRequestId: text("create_request_id").notNull(),
    requestId: text("request_id").notNull(),
    receipt: jsonb("receipt").$type<CancelPublishPreviewReceipt>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.projectId, table.actorId, table.requestId],
    }),
    index("analytics2_publish_preview_cancel_intent_idx").on(
      table.orgId,
      table.projectId,
      table.actorId,
      table.createRequestId,
    ),
  ],
);

export const projectReleases = pgTable(
  "analytics2_project_releases",
  {
    id: text("id")
      .primaryKey()
      .references(() => projectVersions.id, { onDelete: "cascade" }),
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    head: jsonb("head").$type<DraftHead>().notNull(),
    project: jsonb("project").$type<ProjectDocument>().notNull(),
    snapshot: jsonb("snapshot").$type<Snapshot>().notNull(),
    manifestId: text("manifest_id").notNull().unique(),
    comparedReleaseId: text("compared_release_id"),
    description: text("description"),
    publishedAt: text("published_at").notNull(),
    publisherId: text("publisher_id").notNull(),
    requestId: text("request_id").notNull(),
    mode: text("mode", { enum: ["ready", "accept-errors", "force"] }).notNull(),
    intent: text("intent").notNull(),
    receipt: jsonb("receipt").$type<PublishProjectReceipt>().notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_project_releases_intent_uq").on(
      table.orgId,
      table.projectId,
      table.publisherId,
      table.requestId,
    ),
  ],
);

export const releaseManifestOutputs = pgTable(
  "analytics2_release_manifest_outputs",
  {
    manifestId: text("manifest_id")
      .notNull()
      .references(() => projectReleases.manifestId, { onDelete: "cascade" }),
    cellId: text("cell_id").notNull(),
    state: text("state").$type<ReleaseOutput["state"]>().notNull(),
    resultId: text("result_id"),
    diagnosticId: text("diagnostic_id"),
    attemptId: text("attempt_id"),
    executionSignature: text("execution_signature"),
    dependencyDigest: text("dependency_digest"),
    authorityDigest: text("authority_digest"),
  },
  (table) => [primaryKey({ columns: [table.manifestId, table.cellId] })],
);

type ResultId = Extract<
  RunReceipt["attempts"][number]["state"],
  { status: "complete" }
>["resultIds"][number];
export type BaselineResult = {
  cellId: AttemptIdentity["cellId"];
  resultId: ResultId;
};

export const publishedAppSessions = pgTable(
  "analytics2_published_app_sessions",
  {
    id: text("id").primaryKey(),
    orgId: text("workspace_id").notNull(),
    ownerEmail: text("principal_email").notNull(),
    projectId: text("project_id").notNull(),
    releaseId: text("release_id").notNull(),
    openId: text("open_id").notNull(),
    openIntent: text("open_intent").notNull(),
    inputRevision: bigint("input_revision", { mode: "bigint" })
      .notNull()
      .default(0n),
    overrides: jsonb("overrides").$type<AppInputValues>().notNull(),
    baselineGeneration: bigint("baseline_generation", { mode: "bigint" })
      .notNull()
      .default(0n),
    baseline: jsonb("baseline").$type<BaselineResult[]>().notNull(),
    baselineRefreshedAt: text("baseline_refreshed_at"),
    refreshedAt: text("refreshed_at"),
    runId: text("run_id").$type<RunReceipt["runId"]>(),
    pendingInputIds: jsonb("pending_input_ids")
      .$type<AttemptIdentity["cellId"][]>()
      .notNull(),
  },
);

export const publishedAppSessionReceipts = pgTable(
  "analytics2_published_app_session_receipts",
  {
    sessionId: text("session_id").notNull(),
    requestId: text("request_id").notNull(),
    intent: text("intent").notNull(),
    receipt: jsonb("receipt")
      .$type<AppSessionOperation | AppSessionRefresh>()
      .notNull(),
  },
  (table) => [primaryKey({ columns: [table.sessionId, table.requestId] })],
);

export const publishedAppDefaultCaches = pgTable(
  "analytics2_published_app_default_caches",
  {
    releaseId: text("release_id").primaryKey(),
    generation: bigint("generation", { mode: "bigint" }).notNull().default(0n),
    results: jsonb("results").$type<BaselineResult[]>().notNull(),
    refreshedAt: text("refreshed_at"),
    attemptedAt: text("attempted_at"),
    scheduleDueAt: text("schedule_due_at"),
    runId: text("run_id").$type<RunReceipt["runId"]>(),
  },
);

export const publishedAppSavedViews = pgTable(
  "analytics2_published_app_saved_views",
  {
    id: text("id").primaryKey(),
    sessionId: text("session_id").notNull(),
    requestId: text("request_id").notNull(),
    intent: text("intent").notNull(),
    overrides: jsonb("overrides").$type<AppInputValues>().notNull(),
    receipt: jsonb("receipt").$type<SavedAppView>().notNull(),
  },
);

export const publishedAppSchedules = pgTable(
  "analytics2_published_app_schedules",
  {
    id: text("id").primaryKey(),
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    creatorId: text("creator_id").notNull(),
    runPrincipalId: text("run_principal_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    enabled: boolean("enabled").notNull(),
    cadence: jsonb("cadence")
      .$type<PublishedAppScheduleConfig["cadence"]>()
      .notNull(),
    timezone: text("timezone").notNull(),
    normalizedCron: text("normalized_cron").notNull(),
    updatePublishedResults: boolean("update_published_results").notNull(),
    useCachedSqlResults: boolean("use_cached_sql_results").notNull(),
    target: text("target").$type<"default">().notNull(),
    nextFireAt: text("next_fire_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    deletedAt: text("deleted_at"),
  },
);
export const publishedAppScheduleRecipients = pgTable(
  "analytics2_published_app_schedule_recipients",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    memberId: text("member_id").notNull(),
    on: text("trigger").$type<ScheduleRecipient["on"]>().notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: text("created_at").notNull(),
    revokedAt: text("revoked_at"),
  },
);
export const publishedAppScheduleTicks = pgTable(
  "analytics2_published_app_schedule_ticks",
  {
    id: text("id").primaryKey(),
    scheduleId: text("schedule_id").notNull(),
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    principalId: text("principal_id").notNull(),
    dueAt: text("due_at").notNull(),
    scheduleRevision: bigint("schedule_revision", { mode: "bigint" }).notNull(),
    releaseId: text("release_id"),
    snapshot: jsonb("snapshot").$type<Snapshot>(),
    inputDigest: text("input_digest"),
    flags: jsonb("flags")
      .$type<Omit<PublishedAppScheduleConfig, "recipients">>()
      .notNull(),
    recipients: jsonb("recipient_snapshot")
      .$type<ScheduleRecipient[]>()
      .notNull(),
    coreHistoryId: text("core_history_id").notNull(),
    runId: text("run_id").$type<RunReceipt["runId"]>(),
    status: text("status")
      .$type<z.infer<typeof scheduleTickStatus>>()
      .notNull(),
    cacheReservation: bigint("cache_reservation", { mode: "bigint" }),
    cacheOutcome: text("cache_outcome")
      .$type<z.infer<typeof scheduleCacheStatus>>()
      .notNull(),
    diagnostic: jsonb("diagnostic").$type<z.infer<typeof scheduleDiagnostic>>(),
    createdAt: text("created_at").notNull(),
    terminalAt: text("terminal_at"),
  },
);
export const publishedAppScheduleDeliveries = pgTable(
  "analytics2_published_app_schedule_deliveries",
  {
    id: text("id").primaryKey(),
    tickId: text("tick_id").notNull(),
    recipientId: text("recipient_id").notNull(),
    eventType: text("event_type").$type<"success" | "failure">().notNull(),
    dedupKey: text("dedup_key").notNull(),
    status: text("status")
      .$type<z.infer<typeof scheduleDeliveryOutcome> | "sending">()
      .notNull(),
    deliveryAttemptId: text("delivery_attempt_id"),
    sendAttempts: integer("send_attempts").notNull(),
    firstAttemptAt: text("first_attempt_at"),
    sentAt: text("sent_at"),
    lastErrorCode: text("last_error_code"),
    nextRetryAt: text("next_retry_at"),
    updatedAt: text("updated_at").notNull(),
  },
);
export const publishedAppScheduleReceipts = pgTable(
  "analytics2_published_app_schedule_receipts",
  {
    orgId: text("workspace_id").notNull(),
    projectId: text("project_id").notNull(),
    actorId: text("actor_id").notNull(),
    opId: text("op_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    response: jsonb("response")
      .$type<
        | z.infer<typeof setScheduleOutput>
        | z.infer<typeof stopScheduleRunOutput>
      >()
      .notNull(),
    committedAt: text("committed_at").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.orgId, table.projectId, table.actorId, table.opId],
    }),
  ],
);

export type ThreadUpload = z.infer<typeof uploadManifest> & {
  uploadId: string;
  state: "pending" | "ready" | "failed";
  fileId?: string;
};
export const analyticsThreadBootstraps = pgTable(
  "analytics2_thread_bootstraps",
  {
    orgId: text("org_id").notNull(),
    appId: text("app_id").notNull(),
    ownerId: text("owner_email").notNull(),
    intentId: uuid("intent_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    projectId: text("reserved_project_id").notNull(),
    threadId: text("reserved_thread_id").notNull().unique(),
    bindingId: text("binding_id").notNull().unique(),
    mode: text("mode").$type<z.infer<typeof threadMode>>().notNull(),
    phase: text("phase")
      .$type<"binding" | "awaiting_upload" | "ready" | "submitted">()
      .notNull(),
    initialMessageId: uuid("initial_message_id"),
    initialPrompt: jsonb("bounded_initial_prompt").$type<AnalyticsPrompt>(),
    uploads: jsonb("upload_manifest").$type<ThreadUpload[]>().notNull(),
    revision: bigint("share_revision", { mode: "bigint" })
      .notNull()
      .default(0n),
    updatedAt: text("updated_at").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.orgId, row.appId, row.ownerId, row.intentId] }),
  ],
);

export const analyticsThreadTurns = pgTable(
  "analytics2_thread_turns",
  {
    bindingId: text("binding_id")
      .notNull()
      .references(() => notebookThreadProjects.id, { onDelete: "cascade" }),
    messageId: uuid("message_id").notNull(),
    sequence: bigint("seq", { mode: "bigint" }).notNull(),
    fingerprint: text("fingerprint").notNull(),
    prompt: jsonb("pending_prompt").$type<AnalyticsPrompt>(),
    sourceIds: jsonb("source_ids").$type<string[]>().notNull(),
    privateContext: boolean("private_context").notNull().default(false),
    receipt: jsonb("admission_receipt").$type<ThreadTurnReceipt>(),
    projection: jsonb("terminal_projection").$type<
      z.infer<typeof persistedThreadProjection>
    >(),
    stoppedAt: text("stopped_at"),
    createdAt: text("created_at").notNull(),
  },
  (row) => [
    primaryKey({ columns: [row.bindingId, row.messageId] }),
    uniqueIndex("analytics2_thread_turn_seq").on(row.bindingId, row.sequence),
  ],
);

export const analyticsThreadGrants = pgTable(
  "analytics2_thread_grants",
  {
    id: text("id").primaryKey(),
    bindingId: text("binding_id")
      .notNull()
      .references(() => notebookThreadProjects.id, { onDelete: "cascade" }),
    memberId: text("member_id").notNull(),
  },
  (row) => [
    uniqueIndex("analytics2_thread_grant_member").on(
      row.bindingId,
      row.memberId,
    ),
    index("analytics2_thread_grant_page").on(row.bindingId, row.id),
  ],
);

export const analyticsThreadReceipts = pgTable(
  "analytics2_thread_receipts",
  {
    bindingId: text("binding_id")
      .notNull()
      .references(() => notebookThreadProjects.id, { onDelete: "cascade" }),
    opId: uuid("op_id").notNull(),
    fingerprint: text("fingerprint").notNull(),
    receipt: jsonb("receipt")
      .$type<
        z.infer<typeof threadAccessReceipt> | z.infer<typeof stopThreadReceipt>
      >()
      .notNull(),
  },
  (row) => [primaryKey({ columns: [row.bindingId, row.opId] })],
);

export const signedEmbedTokens = pgTable(
  "analytics2_signed_embed_tokens",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    createdByEmail: text("created_by_email").notNull(),
    tokenHash: text("token_hash").notNull(),
    userAttributes: jsonb("user_attributes")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("analytics2_signed_embed_tokens_hash_idx").on(table.tokenHash),
    index("analytics2_signed_embed_tokens_project_idx").on(
      table.orgId,
      table.projectId,
      table.createdAt,
    ),
  ],
);
