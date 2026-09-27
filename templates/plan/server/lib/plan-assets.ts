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

export const PLAN_ASSET_ROUTE_PREFIX = "/_agent-native/plan-asset";
const PLAN_ASSET_STORAGE_REQUIRED_REASON =
  "Image storage is not connected yet. Connect Builder.io (free tier available) or configure S3-compatible storage to add images to visual plans.";

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
  const mimeType =
    input.mimeType ?? mimeTypeFromFilename(input.filename) ?? "image/png";

  const bytes = Buffer.from(input.base64, "base64");
  if (bytes.byteLength > PLAN_ASSET_MAX_SINGLE_BYTES) {
    throw new Error(
      `Asset "${input.filename}" is too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB). Maximum single asset size is 2 MB.`,
    );
  }

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

  const uploaded = await uploadFile({
    data: bytes,
    filename: input.filename,
    mimeType,
  }).catch(() => null);

  if (uploaded?.url) {
    const assetId = `passet_${randomUUID().replace(/-/g, "")}`;
    const now = new Date().toISOString();
    await db.insert(schema.planAssets).values({
      id: assetId,
      planId: input.planId,
      filename: input.filename,
      mimeType,
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
    if (!asset.data.startsWith("cdn:")) {
      result[asset.filename] = asset.data;
    }
  }
  return result;
}

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
