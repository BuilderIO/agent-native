import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  parseFragment,
  serialize,
  type DefaultTreeAdapterTypes as P5,
} from "parse5";

import { getDb, schema } from "../server/db/index.js";
import { legacySlideHtmlToSource } from "../server/lib/legacy-slide-source.js";
import { compileSlideSource } from "./_slide-source.js";

export interface ImportedSlideAsset {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
}

export async function compileImportedSlideSource(
  html: string,
  scope: { ownerEmail: string; orgId?: string | null },
  assets: readonly ImportedSlideAsset[] = [],
): Promise<{
  sourceTsx: string;
  revision: 1;
  sourceHash: string;
  content: string;
}> {
  const assetIdsByUrl = new Map<string, string>();
  const records = new Map<
    string,
    { id: string; filename: string; mimeType: string; size: number }
  >();

  for (const asset of assets) {
    if (!asset.url || asset.url.startsWith("asset://")) continue;
    let id = assetIdsByUrl.get(asset.url);
    if (!id) {
      id = nanoid();
      assetIdsByUrl.set(asset.url, id);
      records.set(asset.url, {
        id,
        filename: asset.filename,
        mimeType: asset.mimeType,
        size: asset.size,
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
    await getDb()
      .insert(schema.uploadedAssets)
      .values(
        [...records.entries()].map(([url, asset]) => ({
          id: asset.id,
          filename: asset.filename,
          url,
          type: asset.mimeType,
          size: asset.size,
          provider: null,
          orgId: scope.orgId ?? null,
          ownerEmail: scope.ownerEmail,
          createdAt,
        })),
      );
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
        throw new Error(
          "Imported slide images must reference an uploaded asset before source conversion.",
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
