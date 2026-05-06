import {
  table,
  text,
  integer,
  now,
  ownableColumns,
  createSharesTable,
} from "@agent-native/core/db/schema";

export const imageLibraries = table("image_libraries", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  styleBrief: text("style_brief").notNull().default("{}"),
  settings: text("settings").notNull().default("{}"),
  canonicalLogoAssetId: text("canonical_logo_asset_id"),
  coverAssetId: text("cover_asset_id"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
  ...ownableColumns(),
});

export const imageLibraryShares = createSharesTable("image_library_shares");

export const imageCollections = table("image_collections", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  category: text("category").notNull().default("style-only"),
  styleBrief: text("style_brief").notNull().default("{}"),
  promptTemplate: text("prompt_template"),
  defaultAspectRatio: text("default_aspect_ratio").notNull().default("16:9"),
  defaultImageSize: text("default_image_size").notNull().default("2K"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const imageAssets = table("image_assets", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  collectionId: text("collection_id"),
  role: text("role").notNull().default("generated"),
  status: text("status").notNull().default("candidate"),
  title: text("title"),
  altText: text("alt_text"),
  prompt: text("prompt"),
  model: text("model"),
  aspectRatio: text("aspect_ratio"),
  imageSize: text("image_size"),
  mimeType: text("mime_type").notNull(),
  width: integer("width"),
  height: integer("height"),
  sizeBytes: integer("size_bytes"),
  objectKey: text("object_key").notNull(),
  thumbnailObjectKey: text("thumbnail_object_key"),
  sourceUrl: text("source_url"),
  generationRunId: text("generation_run_id"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  updatedAt: text("updated_at").notNull().default(now()),
});

export const imageGenerationRuns = table("image_generation_runs", {
  id: text("id").primaryKey(),
  libraryId: text("library_id").notNull(),
  collectionId: text("collection_id"),
  prompt: text("prompt").notNull(),
  compiledPrompt: text("compiled_prompt").notNull(),
  model: text("model").notNull(),
  aspectRatio: text("aspect_ratio").notNull().default("16:9"),
  imageSize: text("image_size").notNull().default("2K"),
  groundingMode: text("grounding_mode").notNull().default("auto"),
  referenceAssetIds: text("reference_asset_ids").notNull().default("[]"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(now()),
  completedAt: text("completed_at"),
  // ── audit-log columns (v6-v9 migrations) ──
  // `source`: who triggered the generation ("chat" | "ui" | "a2a"). Defaulted
  // to "chat" because that's the historical path; UI button popovers and A2A
  // callers update this on insert.
  source: text("source").notNull().default("chat"),
  // `callerAppId`: only set for `source = "a2a"` — the calling app's id
  // (e.g. "slides", "design"). Lets the audit log filter "all generations
  // triggered by slides".
  callerAppId: text("caller_app_id"),
  // Identity columns for org-admin audit. Captured at insert time from the
  // request context so audit reads don't need to re-resolve who owned the run.
  ownerEmail: text("owner_email"),
  orgId: text("org_id"),
});
