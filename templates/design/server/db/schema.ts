import {
  bigint,
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";
import { boolean, primaryKey } from "drizzle-orm/pg-core";

export const designs = table("designs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  dataOperationRevisions: text("data_operation_revisions")
    .notNull()
    .default("{}"),
  liveCollaborationEnabled: boolean("live_collaboration_enabled")
    .notNull()
    .default(false),
  projectType: text("project_type").notNull().default("prototype"),
  designSystemId: text("design_system_id"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designShares = createSharesTable("design_shares");

export const designAccessRequests = table("design_access_requests", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  requesterEmail: text("requester_email").notNull(),
  requesterName: text("requester_name").notNull(),
  requestedAt: text("requested_at").notNull().default(now()),
  notifiedAt: text("notified_at"),
  notificationClaimedAt: text("notification_claimed_at"),
});

export const designTemplates = table("design_templates", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category", {
    enum: [
      "ad",
      "one-pager",
      "landing-page",
      "social",
      "presentation",
      "other",
    ],
  })
    .notNull()
    .default("other"),
  sourceDesignId: text("source_design_id"),
  designSystemId: text("design_system_id"),
  data: text("data").notNull().default("{}"),
  width: integer("width"),
  height: integer("height"),
  lockedLayerCount: integer("locked_layer_count").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designTemplateShares = createSharesTable("design_template_shares");

export const designTemplateFiles = table("design_template_files", {
  id: text("id").primaryKey(),
  templateId: text("template_id").notNull(),
  filename: text("filename").notNull(),
  content: text("content").notNull(),
  fileType: text("file_type").notNull().default("html"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

export const designSystems = table("design_systems", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  assets: text("assets"),
  customInstructions: text("custom_instructions").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designSystemShares = createSharesTable("design_system_shares");

export const designFiles = table("design_files", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  filename: text("filename").notNull(),
  content: text("content").notNull(),
  contentOperationSource: text("content_operation_source"),
  contentOperationRevision: integer("content_operation_revision"),
  contentOperationResultHash: text("content_operation_result_hash"),
  fileType: text("file_type").notNull().default("html"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

export const designVersions = table("design_versions", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  label: text("label"),
  snapshot: text("snapshot").notNull(),
  chatContext: text("chat_context"),
  fileCount: integer("file_count"),
  createdAt: text("created_at").default(now()),
});

export const designLocalhostConnections = table(
  "design_localhost_connections",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    sourceType: text("source_type", { enum: ["localhost"] })
      .notNull()
      .default("localhost"),
    devServerUrl: text("dev_server_url").notNull(),
    bridgeUrl: text("bridge_url"),
    rootPath: text("root_path"),
    routeManifest: text("route_manifest").notNull().default("{}"),
    capabilities: text("capabilities").notNull().default("[]"),
    status: text("status", {
      enum: ["connected", "detected", "manual", "error"],
    })
      .notNull()
      .default("connected"),
    lastSeenAt: text("last_seen_at"),
    /** Read-only credential used by browser preview/bridge-registration calls.
     * It is one-way derived from the filesystem token when not supplied by a
     * newer bridge, so leaking it cannot grant source-file access. */
    previewToken: text("preview_token"),
    bridgeToken: text("bridge_token"),
    ownerEmail: text("owner_email").notNull(),
    orgId: text("org_id"),
    createdAt: text("created_at").default(now()),
    updatedAt: text("updated_at").default(now()),
  },
);


export const componentIndex = table("component_index", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  sourceRef: text("source_ref"),
  name: text("name").notNull(),
  filePath: text("file_path"),
  exportName: text("export_name"),
  props: text("props"),
  variants: text("variants"),
  stories: text("stories"),
  runtimeSelectors: text("runtime_selectors"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const motionTimeline = table("motion_timeline", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  sourceRef: text("source_ref"),
  filePath: text("file_path"),
  tracks: text("tracks").notNull().default("[]"),
  durationMs: integer("duration_ms").notNull().default(300),
  defaultEase: text("default_ease").notNull().default("ease"),
  compiledHash: text("compiled_hash"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designState = table("design_state", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  sourceRef: text("source_ref"),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["state", "fixture", "capture"] })
    .notNull()
    .default("state"),
  breakpoint: text("breakpoint", {
    enum: ["auto", "desktop", "tablet", "mobile"],
  })
    .notNull()
    .default("auto"),
  route: text("route"),
  fixtureData: text("fixture_data"),
  captureData: text("capture_data"),
  previewRef: text("preview_ref"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designLocalhostWriteGrants = table(
  "design_localhost_write_grants",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    connectionId: text("connection_id").notNull(),
    rootPath: text("root_path").notNull(),
    bridgeToken: text("bridge_token").notNull(),
    grantedUntil: text("granted_until").notNull(),
    createdAt: text("created_at").default(now()),
    ...ownableColumns(),
  },
);

export const designFusionEdits = table("design_fusion_edits", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  screenFileId: text("screen_file_id"),
  instruction: text("instruction").notNull(),
  target: text("target"),
  status: text("status", { enum: ["pending", "sent", "error"] })
    .notNull()
    .default("pending"),
  batchId: text("batch_id"),
  error: text("error"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designReviewSnapshot = table("design_review_snapshot", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  baseVersionId: text("base_version_id"),
  compareVersionId: text("compare_version_id"),
  sourceRef: text("source_ref"),
  a11yFindings: text("a11y_findings"),
  visualDiff: text("visual_diff"),
  status: text("status", { enum: ["pending", "ready", "error"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designVisualEditPending = table("design_visual_edit_pending", {
  designId: text("design_id").primaryKey(),
  pendingEditCount: integer("pending_edit_count").notNull().default(0),
  status: text("status", { enum: ["ready", "empty"] })
    .notNull()
    .default("empty"),
  prompt: text("prompt").notNull().default(""),
  revision: bigint("revision", { mode: "number" }).notNull().default(0),
  publisherId: text("publisher_id").notNull().default(""),
  clientRevision: bigint("client_revision", { mode: "number" })
    .notNull()
    .default(0),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designVisualEditSnapshots = table(
  "design_visual_edit_snapshots",
  {
    designId: text("design_id")
      .notNull()
      .references(() => designs.id, { onDelete: "cascade" }),
    fileId: text("file_id")
      .notNull()
      .references(() => designFiles.id, { onDelete: "cascade" }),
    html: text("html").notNull(),
    blobHandle: text("blob_handle"),
    captureRevision: bigint("capture_revision", { mode: "bigint" })
      .notNull()
      .default(0n),
    publishedRevision: bigint("published_revision", { mode: "bigint" })
      .notNull()
      .default(0n),
    updatedAt: text("updated_at").default(now()),
    ...ownableColumns(),
  },
  (t) => [primaryKey({ columns: [t.designId, t.fileId] })],
);

export const designVisualEditSnapshotBlobCleanup = table(
  "design_visual_edit_snapshot_blob_cleanup",
  {
    blobHandle: text("blob_handle").primaryKey(),
    createdAt: text("created_at").notNull().default(now()),
  },
);
