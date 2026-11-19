import { randomUUID } from "node:crypto";

import {
  PrivateMediaStorageUnavailableError,
  deletePrivateMedia,
  putPrivateMedia,
} from "@agent-native/core/private-media";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
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

export const PLAN_ASSET_ROUTE_PREFIX = "/_agent-native/plan-asset";
const PLAN_ASSET_STORAGE_REQUIRED_REASON =
  "Image storage is not connected yet. Use Builder.io (free tier available) or configure S3-compatible storage to add images to visual plans.";

/**
 * A plan asset row's `data` starts with this when its bytes are in private
 * storage; the rest is the core private media id. Other rows hold `cdn:` and
 * a public URL (images added before private storage), or the base64 bytes.
 */
const PRIVATE_ASSET_PREFIX = "private:";

/** No storage can keep a plan's image: connect some in Settings → File uploads. */
export class PlanAssetStorageUnavailableError extends Error {
  constructor() {
    super(PLAN_ASSET_STORAGE_REQUIRED_REASON);
    this.name = "PlanAssetStorageUnavailableError";
  }
}

/** An image over the size caps of a plan kept in its own database table. */
export class PlanAssetTooLargeError extends Error {
  readonly statusCode = 413;
  constructor(message: string) {
    super(message);
    this.name = "PlanAssetTooLargeError";
  }
}

export function privatePlanAssetMediaId(data: string): string | null {
  return data.startsWith(PRIVATE_ASSET_PREFIX)
    ? data.slice(PRIVATE_ASSET_PREFIX.length)
    : null;
}

function newPlanAssetId(): string {
  return `passet_${randomUUID().replace(/-/g, "")}`;
}

export function planAssetUrl(assetId: string, filename: string): string {
  return `${PLAN_ASSET_ROUTE_PREFIX}/${encodeURIComponent(assetId)}/${encodeURIComponent(filename)}`;
}

export interface UpsertPlanAssetInput {
  planId: string;
  filename: string;
  base64: string;
  mimeType?: string;
}

export interface UpsertPlanAssetResult {
  assetId: string;
  cdnUrl: string | null;
  src: string;
  filename: string;
}

function requiresConfiguredPlanAssetStorage(): boolean {
  return process.env.NODE_ENV === "production" || !isPGlitePlanAssetDatabase();
}

function appDatabaseUrl(): string {
  const appName = process.env.APP_NAME?.toUpperCase().replace(/-/g, "_");
  if (appName) {
    const appUrl = process.env[`${appName}_DATABASE_URL`];
    if (appUrl) return appUrl;
  }
  return process.env.DATABASE_URL || process.env.NETLIFY_DATABASE_URL || "";
}

function isPGlitePlanAssetDatabase(): boolean {
  const url = appDatabaseUrl().toLowerCase();
  return url === "" || url.startsWith("pglite:");
}

export async function upsertPlanAsset(
  input: UpsertPlanAssetInput,
): Promise<UpsertPlanAssetResult> {
  return storePlanAsset({
    planId: input.planId,
    filename: input.filename,
    mimeType:
      input.mimeType ?? mimeTypeFromFilename(input.filename) ?? "image/png",
    data: Buffer.from(input.base64, "base64"),
  });
}

/**
 * Stores an image in a plan. The caller has already checked that the request's
 * user may edit the plan.
 *
 * The bytes go to private storage, so the image loads only through the plan
 * asset route, which checks that the reader can open the plan. A local
 * database with no storage connected keeps them in the plan's own table
 * instead, within the per-image and per-plan caps; a hosted one refuses.
 */
export async function storePlanAsset(input: {
  planId: string;
  filename: string;
  mimeType: string;
  data: Uint8Array;
  /** The plan's organization; the request's when left out. */
  orgId?: string | null;
}): Promise<UpsertPlanAssetResult> {
  const db = getDb();
  const ownerEmail = getRequestUserEmail();
  if (ownerEmail) {
    let media: Awaited<ReturnType<typeof putPrivateMedia>> | null = null;
    try {
      media = await putPrivateMedia({
        ownerEmail,
        orgId:
          input.orgId === undefined ? (getRequestOrgId() ?? null) : input.orgId,
        data: input.data,
        mimeType: input.mimeType,
        filename: input.filename,
      });
    } catch (error) {
      if (!(error instanceof PrivateMediaStorageUnavailableError)) throw error;
    }
    if (media) {
      const assetId = newPlanAssetId();
      try {
        await db.insert(schema.planAssets).values({
          id: assetId,
          planId: input.planId,
          filename: input.filename,
          mimeType: media.mimeType,
          data: `${PRIVATE_ASSET_PREFIX}${media.id}`,
          byteSize: input.data.byteLength,
          createdAt: new Date().toISOString(),
        });
      } catch (error) {
        await deletePrivateMedia(media.id).catch((cleanupError) =>
          console.warn(
            "[plan-assets] could not remove an image that failed to attach",
            cleanupError,
          ),
        );
        throw error;
      }
      return {
        assetId,
        cdnUrl: null,
        src: planAssetUrl(assetId, input.filename),
        filename: input.filename,
      };
    }
  }

  if (requiresConfiguredPlanAssetStorage()) {
    throw new PlanAssetStorageUnavailableError();
  }

  if (input.data.byteLength > PLAN_ASSET_MAX_SINGLE_BYTES) {
    throw new PlanAssetTooLargeError(
      `Asset "${input.filename}" is too large (${(input.data.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum single asset size is 2 MB.`,
    );
  }
  const [totalRow] = await db
    .select({ total: sum(schema.planAssets.byteSize) })
    .from(schema.planAssets)
    .where(eq(schema.planAssets.planId, input.planId));
  const currentTotal = Number(totalRow?.total ?? 0);
  if (currentTotal + input.data.byteLength > PLAN_ASSET_MAX_TOTAL_BYTES) {
    throw new PlanAssetTooLargeError(
      `Adding this asset would exceed the 10 MB per-plan asset limit. Current usage: ${(currentTotal / 1024 / 1024).toFixed(1)} MB.`,
    );
  }

  const assetId = newPlanAssetId();
  await db.insert(schema.planAssets).values({
    id: assetId,
    planId: input.planId,
    filename: input.filename,
    mimeType: input.mimeType,
    data: Buffer.from(input.data).toString("base64"),
    byteSize: input.data.byteLength,
    createdAt: new Date().toISOString(),
  });

  return {
    assetId,
    cdnUrl: null,
    src: planAssetUrl(assetId, input.filename),
    filename: input.filename,
  };
}

/** Removes the private bytes behind a plan's assets once their rows are gone. */
export async function deletePrivatePlanAssetBytes(
  rows: Array<{ data: string }>,
): Promise<void> {
  for (const row of rows) {
    const mediaId = privatePlanAssetMediaId(row.data);
    if (!mediaId) continue;
    await deletePrivateMedia(mediaId).catch((error) =>
      console.warn("[plan-assets] could not delete a plan image", error),
    );
  }
}

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
    // Images kept at a URL (public or private) stay links in the export.
    if (asset.data.startsWith("cdn:")) continue;
    if (privatePlanAssetMediaId(asset.data)) continue;
    result[asset.filename] = asset.data;
  }
  return result;
}

export interface SkippedPlanAsset {
  filename: string;
  reason: string;
}

export async function importPlanAssets(
  planId: string,
  assets: Record<string, string>,
  options: { onSkip?: (skipped: SkippedPlanAsset) => void } = {},
): Promise<Record<string, string>> {
  const srcByFilename: Record<string, string> = {};
  const skip = (filename: string, reason: string) => {
    console.warn(`[plan-assets] skipping ${filename}: ${reason}`);
    options.onSkip?.({ filename, reason });
  };

  for (const [filename, base64] of Object.entries(assets)) {
    const mimeType = mimeTypeFromFilename(filename);
    if (!mimeType) {
      skip(filename, "unsupported file type");
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
      skip(filename, err instanceof Error ? err.message : String(err));
    }
  }

  return srcByFilename;
}

/** One warning for an import's images that weren't kept, or null for none. */
export function skippedPlanAssetsWarning(
  skipped: SkippedPlanAsset[],
): string | null {
  if (skipped.length === 0) return null;
  const byReason = new Map<string, string[]>();
  for (const { filename, reason } of skipped) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), filename]);
  }
  const reasons = [...byReason]
    .map(
      ([reason, filenames]) =>
        `${filenames.map((name) => `assets/${name}`).join(", ")}: ${reason}`,
    )
    .join("; ");
  return `${skipped.length === 1 ? "1 image wasn't" : `${skipped.length} images weren't`} added to the plan, so its links still point at assets/ paths. ${reasons}`;
}

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
