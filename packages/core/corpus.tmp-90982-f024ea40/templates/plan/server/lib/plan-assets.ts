/**
 * Plan asset helpers: upsert, URL resolution, and size-cap enforcement.
 *
 * SIZE CAPS (per design):
 *   - single asset  ≤ 2 MB decoded
 *   - all assets per plan ≤ 10 MB total decoded
 *
 * MIME SNIFFING: derived from filename extension only (no magic-byte probe),
 * restricted to browser-safe image formats.
 *
 * SVG is accepted at the storage layer (mimeType = "image/svg+xml") but served
 * with `Content-Type: application/octet-stream` by the route handler to
 * prevent inline script execution.
 */
import { randomUUID } from "node:crypto";

import { uploadFile } from "@agent-native/core/file-upload";
import { and, eq, sum } from "drizzle-orm";

import {
  PLAN_ASSET_MAX_SINGLE_BYTES,
  PLAN_ASSET_MAX_TOTAL_BYTES,
  mimeTypeFromFilename,
} from "../../shared/plan-assets.js";
import { getDb, schema } from "../db/index.js";

export {
  PLAN_ASSET_MAX_SINGLE_BYTES,
  PLAN_ASSET_MAX_TOTAL_BYTES,
  mimeTypeFromFilename,
} from "../../shared/plan-assets.js";

/** The route prefix under which plan assets are served. */
export const PLAN_ASSET_ROUTE_PREFIX = "/_agent-native/plan-asset";
const PLAN_ASSET_STORAGE_REQUIRED_REASON =
  "Image storage is not connected yet. Connect Builder.io or configure S3-compatible storage to add images to visual plans.";

/**
 * Build the serving URL for an asset stored in the `plan_assets` table.
 * The URL is origin-relative so it works on any deployment.
 */
export function planAssetUrl(assetId: string, filename: string): string {
  return `${PLAN_ASSET_ROUTE_PREFIX}/${encodeURIComponent(assetId)}/${encodeURIComponent(filename)}`;
}

export interface UpsertPlanAssetInput {
  planId: string;
  filename: string;
  /** Base64-encoded image data. */
  base64: string;
  /** If provided, overrides the MIME type derived from the filename. */
  mimeType?: string;
}

export interface UpsertPlanAssetResult {
  /** The stored asset ID — use with `planAssetUrl` to build a src URL. */
  assetId: string;
  /**
   * A CDN URL when an upload provider was configured and the upload succeeded.
   * `null` only for local-development fallback rows in `plan_assets`.
   */
  cdnUrl: string | null;
  /**
   * The final `src` to embed in the image block.
   * - CDN URL when provider upload succeeded.
   * - Local route URL (`/_agent-native/plan-asset/...`) for dev fallback rows.
   */
  src: string;
  filename: string;
}

function requiresConfiguredPlanAssetStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isLocalPlanAssetDatabase();
}

function appDatabaseUrl(): string {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const appUrl = process.env[`${appName}_DATABASE_URL`];
    if (appUrl) return appUrl;
  }
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || "";
}

function isLocalPlanAssetDatabase(): boolean {
  const url = appDatabaseUrl().toLowerCase();
  return (
    url === "" ||
    url.startsWith("file:") ||
    url.startsWith("pglite:") ||
    !url.includes("://")
  );
}

/**
 * Store a plan asset, uploading via the active file-upload provider first.
 * Falls back to the `plan_assets` SQL table only on local databases.
 *
 * Enforces single-asset and per-plan size caps.
 */
export async function upsertPlanAsset(
  input: UpsertPlanAssetInput,
): Promise<UpsertPlanAssetResult> {
  const mimeType =
    input.mimeType ?? mimeTypeFromFilename(input.filename) ?? "image/png";

  // Decode and validate size.
  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.byteLength > PLAN_ASSET_MAX_SINGLE_BYTES) {
    throw new Error(
      `Asset "${input.filename}" is too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum single asset size is 2 MB.`,
    );
  }

  // Enforce per-plan total cap.
  const db = getDb();
  const [totalRow] = await db
    .select({ total: sum(schema.planAssets.byteSize) })
    .from(schema.planAssets)
    .where(eq(schema.planAssets.planId, input.planId));
  const currentTotal = Number(totalRow?.total ?? 0);
  if (currentTotal + bytes.byteLength > PLAN_ASSET_MAX_TOTAL_BYTES) {
    throw new Error(
      `Adding this asset would exceed the 10 MB per-plan asset limit. Current usage: ${(currentTotal / 1024 / 1024).toFixed(1)} MB.`,
    );
  }

  // Try provider upload (CDN path).
  const uploaded = await uploadFile({
    data: bytes,
    filename: input.filename,
    mimeType,
  }).catch(() => null);

  if (uploaded?.url) {
    // Provider upload succeeded — store a lightweight row (data="") to track
    // the asset for export, but the image is served from the CDN URL.
    const assetId = `passet_${randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    await db.insert(schema.planAssets).values({
      id: assetId,
      planId: input.planId,
      filename: input.filename,
      mimeType,
      // Store the CDN URL in the data field for export reconstruction.
      data: `cdn:${uploaded.url}`,
      byteSize: bytes.byteLength,
      createdAt: now,
    });
    return {
      assetId,
      cdnUrl: uploaded.url,
      src: uploaded.url,
      filename: input.filename,
    };
  }

  if (requiresConfiguredPlanAssetStorage()) {
    throw new Error(PLAN_ASSET_STORAGE_REQUIRED_REASON);
  }

  // Local SQL fallback: store base64 in plan_assets for development-only use.
  const assetId = `passet_${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  await db.insert(schema.planAssets).values({
    id: assetId,
    planId: input.planId,
    filename: input.filename,
    mimeType,
    data: input.base64,
    byteSize: bytes.byteLength,
    createdAt: now,
  });

  return {
    assetId,
    cdnUrl: null,
    src: planAssetUrl(assetId, input.filename),
    filename: input.filename,
  };
}

/**
 * Resolve the serving src for a stored plan asset.
 *
 * - CDN assets: `data` starts with `cdn:` — strip the prefix and return the URL.
 * - SQL fallback assets: return the local route URL.
 *
 * Returns `null` if the asset does not exist.
 */
export async function resolveAssetSrc(assetId: string): Promise<string | null> {
  const db = getDb();
  const [asset] = await db
    .select({
      id: schema.planAssets.id,
      filename: schema.planAssets.filename,
      data: schema.planAssets.data,
    })
    .from(schema.planAssets)
    .where(eq(schema.planAssets.id, assetId))
    .limit(1);

  if (!asset) return null;

  if (asset.data.startsWith("cdn:")) {
    return asset.data.slice(4);
  }

  return planAssetUrl(asset.id, asset.filename);
}

/**
 * Load all assets for a plan as a `Record<filename, base64>` suitable for
 * the `"assets/"` key in a `PlanMdxFolder`.
 *
 * CDN assets are represented as `cdn:<url>` (their data field value) so the
 * export preserves the remote URL without re-fetching the bytes.
 */
export async function loadPlanAssetsForExport(
  planId: string,
): Promise<Record<string, string>> {
  const db = getDb();
  const assets = await db
    .select()
    .from(schema.planAssets)
    .where(
      and(
        eq(schema.planAssets.planId, planId),
        // Only include SQL-fallback assets (CDN assets have a CDN URL and don't
        // need to be round-tripped as base64 in the export folder).
      ),
    );

  const result: Record<string, string> = {};
  for (const asset of assets) {
    if (!asset.data.startsWith("cdn:")) {
      result[asset.filename] = asset.data;
    }
  }
  return result;
}

/**
 * Import assets from a `Record<filename, base64>` (the `"assets/"` folder key).
 *
 * Returns a map from filename to the resolved `src` (CDN URL or local route URL).
 * Invalid / oversized entries are skipped with a console warning rather than
 * aborting the whole import.
 *
 * SIZE CAPS are applied per-asset and in aggregate. A single asset that exceeds
 * 2 MB is skipped; if the batch would push the plan over 10 MB total, remaining
 * assets are skipped.
 */
export async function importPlanAssets(
  planId: string,
  assets: Record<string, string>,
): Promise<Record<string, string>> {
  const srcByFilename: Record<string, string> = {};

  for (const [filename, base64] of Object.entries(assets)) {
    const mimeType = mimeTypeFromFilename(filename);
    if (!mimeType) {
      console.warn(`[plan-assets] skipping unsupported file type: ${filename}`);
      continue;
    }

    try {
      const result = await upsertPlanAsset({
        planId,
        filename,
        base64,
        mimeType,
      });
      srcByFilename[filename] = result.src;
    } catch (err) {
      console.warn(
        `[plan-assets] skipping ${filename}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return srcByFilename;
}

/**
 * Rewrite image blocks in parsed `PlanContent` that reference a relative
 * `assets/<filename>` path (as emitted by `exportPlanContentToMdxFolder`),
 * replacing the `url` with the resolved CDN URL or local route URL.
 *
 * `srcByFilename` is the map returned by `importPlanAssets`.
 * Returns a new content object; original is not mutated.
 */
export function applyImportedAssets(
  content: import("../../shared/plan-content.js").PlanContent,
  srcByFilename: Record<string, string>,
): import("../../shared/plan-content.js").PlanContent {
  if (Object.keys(srcByFilename).length === 0) return content;

  const rewriteBlocks = (
    blocks: import("../../shared/plan-content.js").PlanBlock[],
  ): import("../../shared/plan-content.js").PlanBlock[] =>
    blocks.map((block): import("../../shared/plan-content.js").PlanBlock => {
      if (block.type === "image") {
        const url = block.data.url ?? "";
        // Match `assets/<filename>` (with or without leading slash).
        const filenameMatch = url.match(/^(?:\.\/)?assets\/(.+)$/);
        if (filenameMatch) {
          const filename = filenameMatch[1];
          const resolved = filename ? srcByFilename[filename] : undefined;
          if (resolved) {
            return {
              ...block,
              data: { ...block.data, url: resolved, assetId: undefined },
            };
          }
        }
      }
      // Recurse into tabs and columns.
      if (block.type === "tabs") {
        return {
          ...block,
          data: {
            ...block.data,
            tabs: block.data.tabs.map((tab) => ({
              ...tab,
              blocks: rewriteBlocks(tab.blocks),
            })),
          },
        };
      }
      if (block.type === "columns") {
        return {
          ...block,
          data: {
            ...block.data,
            columns: block.data.columns.map((col) => ({
              ...col,
              blocks: rewriteBlocks(col.blocks),
            })),
          },
        };
      }
      return block;
    });

  return { ...content, blocks: rewriteBlocks(content.blocks) };
}
