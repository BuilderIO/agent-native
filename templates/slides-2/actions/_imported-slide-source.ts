import { fail } from "@agent-native/core/action";
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes as P5,
} from "parse5";

import { getDb, schema } from "../server/db/index.js";
import type { ImportedAssetUpload } from "../server/lib/imported-asset-batch.js";
import { legacySlideHtmlToSource } from "../server/lib/legacy-slide-source.js";
import { registerUploadedAssetObjectIdentities } from "../server/lib/uploaded-asset-object-lifecycle.js";
import { compileSlideSource } from "./_slide-source.js";

export type ImportedSlideAsset = ImportedAssetUpload;

export async function compileImportedSlideSource(
  html: string,
  scope: { ownerEmail: string; orgId?: string | null; deckId?: string | null },
  assets: readonly ImportedSlideAsset[] = [],
): Promise<{
  sourceTsx: string;
  revision: 1;
  sourceHash: string;
  content: string;
}> {
  const assetIdsByUrl = new Map<string, string>();
  const records = new Map<string, ImportedSlideAsset>();

  for (const asset of assets) {
    if (!asset.url || asset.url.startsWith("asset://")) continue;
    let id = assetIdsByUrl.get(asset.url);
    if (!id) {
      id = asset.assetId;
      assetIdsByUrl.set(asset.url, id);
      records.set(asset.url, {
        ...asset,
        assetId: id,
      });
    }
  }

  const fragment = parseFragment(html);
  const existingAssetUrls = [
    ...collectUnmappedSourceUrls(fragment, assetIdsByUrl),
  ];
  if (existingAssetUrls.length > 0) {
    const ownerScope = and(
      eq(schema.uploadedAssets.ownerEmail, scope.ownerEmail),
      scope.orgId
        ? eq(schema.uploadedAssets.orgId, scope.orgId)
        : isNull(schema.uploadedAssets.orgId),
    );
    const assetScope = scope.orgId
      ? or(ownerScope, eq(schema.uploadedAssets.orgId, scope.orgId))
      : ownerScope;
    const rows = await getDb()
      .select({ id: schema.uploadedAssets.id, url: schema.uploadedAssets.url })
      .from(schema.uploadedAssets)
      .where(
        and(inArray(schema.uploadedAssets.url, existingAssetUrls), assetScope),
      );
    for (const row of rows) {
      if (!assetIdsByUrl.has(row.url)) assetIdsByUrl.set(row.url, row.id);
    }
  }
  replaceUploadedImageSources(fragment, assetIdsByUrl);
  const sourceTsx = legacySlideHtmlToSource(serialize(fragment));

  if (records.size > 0) {
    const createdAt = new Date().toISOString();
    const rows = [...records.entries()].map(([url, asset]) => ({
      id: asset.assetId,
      filename: asset.filename,
      url,
      type: asset.mimeType,
      size: asset.size,
      provider: asset.provider,
      providerObjectId: asset.providerObjectId,
      deckId: scope.deckId ?? null,
      orgId: scope.orgId ?? null,
      ownerEmail: scope.ownerEmail,
      createdAt,
    }));
    await getDb().transaction(async (transaction) => {
      await registerUploadedAssetObjectIdentities(
        transaction,
        rows.map((row) => ({
          url: row.url,
          provider: row.provider,
          providerObjectId: row.providerObjectId,
        })),
      );
      await transaction.insert(schema.uploadedAssets).values(rows);
    });
  }

  const compiled = await compileSlideSource(sourceTsx, scope);
  return {
    sourceTsx,
    revision: 1,
    sourceHash: compiled.sourceHash,
    content: compiled.content,
  };
}

function collectUnmappedSourceUrls(
  node: P5.Node & { childNodes?: P5.Node[] },
  assetIdsByUrl: ReadonlyMap<string, string>,
  urls = new Set<string>(),
): Set<string> {
  if ("attrs" in node && Array.isArray(node.attrs)) {
    const src = node.attrs.find((attribute) => attribute.name === "src");
    if (
      src &&
      src.value &&
      !src.value.startsWith("asset://") &&
      !assetIdsByUrl.has(src.value)
    ) {
      urls.add(src.value);
    }
  }
  if (Array.isArray(node.childNodes)) {
    for (const child of node.childNodes) {
      collectUnmappedSourceUrls(
        child as P5.Node & { childNodes?: P5.Node[] },
        assetIdsByUrl,
        urls,
      );
    }
  }
  return urls;
}

function replaceUploadedImageSources(
  node: P5.Node & { childNodes?: P5.Node[] },
  assetIdsByUrl: ReadonlyMap<string, string>,
): void {
  if ("attrs" in node && Array.isArray(node.attrs)) {
    const src = node.attrs.find((attribute) => attribute.name === "src");
    if (src && !src.value.startsWith("asset://")) {
      const assetId = assetIdsByUrl.get(src.value);
      if (!assetId) {
        fail(
          "Imported slide images must reference an uploaded asset before source conversion.",
          {
            errorCode: "imported_slide_asset_not_uploaded",
            statusCode: 400,
          },
        );
      }
      src.value = `asset://${assetId}`;
    }
  }
  if (!Array.isArray(node.childNodes)) return;
  for (const child of node.childNodes) {
    replaceUploadedImageSources(
      child as P5.Node & { childNodes?: P5.Node[] },
      assetIdsByUrl,
    );
  }
}
