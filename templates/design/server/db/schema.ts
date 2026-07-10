import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const designs = table("designs", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  // Monotonic per-client sequence numbers for path-addressed data writes.
  // Kept outside `data` so editor/export payloads stay free of transport
  // bookkeeping while late keepalive requests can be rejected atomically.
  dataOperationRevisions: text("data_operation_revisions")
    .notNull()
    .default("{}"),
  projectType: text("project_type").notNull().default("prototype"),
  designSystemId: text("design_system_id"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

export const designShares = createSharesTable("design_shares");

export const designSystems = table("design_systems", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  data: text("data").notNull(),
  assets: text("assets"),
  customInstructions: text("custom_instructions").notNull().default(""),
  isDefault: integer("is_default", { mode: "boolean" })
    .notNull()
    .default(false),
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
  // Last accepted browser content-save operation. This transport metadata
  // stays beside (rather than inside) the document so a late unload
  // keepalive can be rejected without parsing or rewriting user content.
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

// ---------------------------------------------------------------------------
// New tables — additive only; never alter existing tables.
// All ownable tables are read/written through accessFilter / assertAccess.
// ---------------------------------------------------------------------------

/**
 * Real-app component metadata indexed from TS prop types, cva/tailwind-variants
 * variants, and Storybook stories. Scoped to one design + source ref.
 */
export const componentIndex = table("component_index", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  /** Opaque string identifying the source connection (localhost bridge id, fusion project id, etc.) */
  sourceRef: text("source_ref"),
  name: text("name").notNull(),
  filePath: text("file_path"),
  exportName: text("export_name"),
  /** JSON: parsed prop types / cva variant definitions */
  props: text("props"),
  /** JSON: variant groups (size, color, state, …) */
  variants: text("variants"),
  /** JSON: Storybook stories referencing this component */
  stories: text("stories"),
  /** JSON: runtime CSS selectors used to outline instances on the canvas */
  runtimeSelectors: text("runtime_selectors"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

/**
 * Motion timeline — scoped to one design + source ref + screen/file.
 * A design may have many timelines (one per screen or animation target).
 * The compiled CSS is the runtime truth; tracks JSON aids editing only.
 */
export const motionTimeline = table("motion_timeline", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  /** Opaque source connection ref; null for inline designs. */
  sourceRef: text("source_ref"),
  /** File path for real-app CSS modules; null for inline (managed <style> block). */
  filePath: text("file_path"),
  /**
   * JSON array of track objects:
   *   [{ target_node_id, property, keyframes: [{ t, value, ease }] }]
   */
  tracks: text("tracks").notNull().default("[]"),
  /** Total animation duration in milliseconds. */
  durationMs: integer("duration_ms").notNull().default(300),
  /** Default easing function name (e.g. "ease", "ease-in-out", "linear"). */
  defaultEase: text("default_ease").notNull().default("ease"),
  /**
   * Hash of the compiled CSS output; used to detect drift between the tracks
   * JSON and the compiled CSS block. apply-motion-edit updates both atomically.
   */
  compiledHash: text("compiled_hash"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

/**
 * Design states, fixtures, and live captures.
 * States are alternate x-data / DOM snapshots (e.g. Default, Loading, Empty).
 * Fixtures hold static data payloads for real-app preview.
 * Captures are live snapshots of a running app's route + props + API data.
 */
export const designState = table("design_state", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  /** Opaque source connection ref. */
  sourceRef: text("source_ref"),
  name: text("name").notNull(),
  /** 'state' | 'fixture' | 'capture' */
  kind: text("kind", { enum: ["state", "fixture", "capture"] })
    .notNull()
    .default("state"),
  /** Active breakpoint when this state was created: 'auto' | 'desktop' | 'tablet' | 'mobile' */
  breakpoint: text("breakpoint", {
    enum: ["auto", "desktop", "tablet", "mobile"],
  })
    .notNull()
    .default("auto"),
  /** Route path captured (real-app captures only). */
  route: text("route"),
  /** JSON: static data fixture payload (fixture kind). */
  fixtureData: text("fixture_data"),
  /** JSON: live-captured route props + API response (capture kind). */
  captureData: text("capture_data"),
  /** Opaque reference to a design_version snapshot or stored preview artifact. */
  previewRef: text("preview_ref"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

/**
 * Localhost write-consent grants minted when the user explicitly allows file
 * writes for a specific design + connection pair. Expire after 8 hours.
 * Only HTML/CSS files may be written (enforced at the action layer).
 */
export const designLocalhostWriteGrants = table(
  "design_localhost_write_grants",
  {
    id: text("id").primaryKey(),
    designId: text("design_id").notNull(),
    connectionId: text("connection_id").notNull(),
    /** Filesystem root that was visible when the grant was created. */
    rootPath: text("root_path").notNull(),
    /** Short-lived token passed in the X-Bridge-Token header. */
    bridgeToken: text("bridge_token").notNull(),
    /** ISO timestamp after which the grant is considered expired (8 hours). */
    grantedUntil: text("granted_until").notNull(),
    createdAt: text("created_at").default(now()),
    ...ownableColumns(),
  },
);

/**
 * Queued AI edit requests for fusion-backed (full app) designs.
 *
 * Fusion screens are URL-backed iframes of a real running app, so edits cannot
 * be applied synchronously to local HTML. Instead they queue here as pending
 * intents; `apply-fusion-edits` batches pending rows into one prompt for the
 * in-container app agent and marks them `sent`. The app agent applies the code
 * changes in the fusion container; screens pick them up on reload.
 */
export const designFusionEdits = table("design_fusion_edits", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  /** design_files.id of the URL-backed screen this edit targets, when known. */
  screenFileId: text("screen_file_id"),
  /** Natural-language edit instruction for the app agent. */
  instruction: text("instruction").notNull(),
  /** JSON: optional target context ({ selector, path, url, nodeName }). */
  target: text("target"),
  /** 'pending' — queued; 'sent' — dispatched to the app agent; 'error'. */
  status: text("status", { enum: ["pending", "sent", "error"] })
    .notNull()
    .default("pending"),
  /** Groups edits dispatched together in one agent message. */
  batchId: text("batch_id"),
  error: text("error"),
  sentAt: text("sent_at"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});

/**
 * Cached accessibility audit + visual diff results for a design.
 * Keyed by design + optional base/compare design_versions pair + source ref.
 * status: 'pending' | 'ready' | 'error'
 */
export const designReviewSnapshot = table("design_review_snapshot", {
  id: text("id").primaryKey(),
  designId: text("design_id").notNull(),
  /** design_versions.id for the base (older) snapshot in a diff. */
  baseVersionId: text("base_version_id"),
  /** design_versions.id for the compare (newer) snapshot in a diff. */
  compareVersionId: text("compare_version_id"),
  /** Opaque source connection ref. */
  sourceRef: text("source_ref"),
  /** JSON: array of a11y findings (contrast, tap targets, roles, alt, focus). */
  a11yFindings: text("a11y_findings"),
  /** JSON: visual diff surface data (changed regions, before/after refs). */
  visualDiff: text("visual_diff"),
  /** 'pending' | 'ready' | 'error' */
  status: text("status", { enum: ["pending", "ready", "error"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  ...ownableColumns(),
});
