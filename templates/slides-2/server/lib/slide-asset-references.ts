import { asc, and, eq, gt, inArray, isNull, or } from "drizzle-orm";
import { parseFragment, type DefaultTreeAdapterTypes as P5 } from "parse5";

import { isSlides2DeckData } from "../../shared/deck-app-scope.js";
import { getDb, schema } from "../db/index.js";
import { collectSlideAssetIds } from "./slide-source.js";

type SlideAssetDatabase = ReturnType<typeof getDb>;
type SlideAssetConnection = Pick<
  SlideAssetDatabase,
  "delete" | "insert" | "select" | "update"
>;
type SlideAssetTransaction = Parameters<
  Parameters<SlideAssetDatabase["transaction"]>[0]
>[0];

type AssetScope = { ownerEmail: string; orgId?: string | null };

const DECK_REFERENCE_SCAN_BATCH_SIZE = 100;
const ASSET_HANDLE = /^asset:\/\/([A-Za-z0-9_-]{1,200})$/;
const CSS_ASSET_HANDLE =
  /url\(\s*(['"]?)asset:\/\/([A-Za-z0-9_-]{1,200})\1\s*\)/gi;

function deckSlides(deckData: unknown): unknown[] {
  let parsed = deckData;
  if (typeof parsed === "string") parsed = JSON.parse(parsed);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Deck data has an invalid shape.");
  }
  const slides = (parsed as Record<string, unknown>).slides;
  if (slides === undefined || slides === null) return [];
  if (!Array.isArray(slides))
    throw new Error("Deck has an invalid slide list.");
  return slides;
}

export function collectDeckSlideAssetIds(deckData: unknown): string[] {
  const ids = new Set<string>();
  for (const slide of deckSlides(deckData)) {
    if (!slide || typeof slide !== "object" || Array.isArray(slide)) continue;
    const slideRecord = slide as Record<string, unknown>;
    const imageUrl = slideRecord.imageUrl;
    if (imageUrl !== undefined && imageUrl !== null) {
      if (typeof imageUrl !== "string") {
        throw new Error("Stored slide image URL is invalid.");
      }
      const imageMatch = ASSET_HANDLE.exec(imageUrl.trim());
      if (imageMatch) ids.add(imageMatch[1]!);
    }

    const background = slideRecord.background;
    if (background !== undefined && background !== null) {
      if (typeof background !== "string") {
        throw new Error("Stored slide background is invalid.");
      }
      const directMatch = ASSET_HANDLE.exec(background.trim());
      if (directMatch) ids.add(directMatch[1]!);
      for (const match of background.matchAll(CSS_ASSET_HANDLE)) {
        ids.add(match[2]!);
      }
    }

    const sourceTsx = slideRecord.sourceTsx;
    if (sourceTsx !== undefined && sourceTsx !== null) {
      if (typeof sourceTsx !== "string") {
        throw new Error("Stored slide source is invalid.");
      }
      for (const id of collectSlideAssetIds(sourceTsx)) ids.add(id);
    }

    const content = slideRecord.content;
    if (content !== undefined && content !== null) {
      if (typeof content !== "string") {
        throw new Error("Stored slide content is invalid.");
      }
      for (const id of collectLegacyHtmlAssetIds(content)) ids.add(id);
    }
  }
  return [...ids].sort();
}

function collectLegacyHtmlAssetIds(content: string): string[] {
  const ids = new Set<string>();
  const visit = (node: P5.Node & { childNodes?: P5.Node[] }) => {
    if ("attrs" in node && Array.isArray(node.attrs)) {
      for (const attribute of node.attrs) {
        for (const match of attribute.value.matchAll(
          /asset:\/\/([A-Za-z0-9_-]{1,200})(?=[\s"'(),;\]]|$)/g,
        )) {
          ids.add(match[1]!);
        }
      }
    }
    for (const child of node.childNodes ?? []) {
      visit(child as P5.Node & { childNodes?: P5.Node[] });
    }
  };

  visit(parseFragment(content) as P5.Node & { childNodes?: P5.Node[] });
  return [...ids];
}

function uploadedAssetScope(scope: AssetScope) {
  const ownerScope = and(
    eq(schema.uploadedAssets.ownerEmail, scope.ownerEmail),
    scope.orgId
      ? eq(schema.uploadedAssets.orgId, scope.orgId)
      : isNull(schema.uploadedAssets.orgId),
  );
  return scope.orgId
    ? or(ownerScope, eq(schema.uploadedAssets.orgId, scope.orgId))
    : ownerScope;
}

function isMalformedJsonString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    JSON.parse(value);
    return false;
  } catch {
    return true;
  }
}

async function lockSlideAssetIds(
  tx: Pick<SlideAssetTransaction, "select">,
  assetIds: string[],
  scope: AssetScope,
): Promise<void> {
  if (assetIds.length === 0) return;

  // Writers share-lock assets; delete and replacement paths take update locks.
  const rows = await tx
    .select({ id: schema.uploadedAssets.id })
    .from(schema.uploadedAssets)
    .where(
      and(
        inArray(schema.uploadedAssets.id, assetIds),
        uploadedAssetScope(scope),
      ),
    )
    .orderBy(asc(schema.uploadedAssets.id))
    .for("share");
  const found = new Set(rows.map((row) => row.id));
  if (assetIds.some((id) => !found.has(id))) {
    throw Object.assign(
      new Error("One or more slide assets are unavailable to this deck."),
      { statusCode: 404, errorCode: "slide_asset_unavailable" },
    );
  }

  const cleanupScope = scope.orgId
    ? or(
        and(
          eq(schema.uploadedAssetCleanupOutbox.ownerEmail, scope.ownerEmail),
          eq(schema.uploadedAssetCleanupOutbox.orgId, scope.orgId),
        ),
        eq(schema.uploadedAssetCleanupOutbox.orgId, scope.orgId),
      )
    : and(
        eq(schema.uploadedAssetCleanupOutbox.ownerEmail, scope.ownerEmail),
        isNull(schema.uploadedAssetCleanupOutbox.orgId),
      );
  const pendingCleanup = await tx
    .select({ id: schema.uploadedAssetCleanupOutbox.id })
    .from(schema.uploadedAssetCleanupOutbox)
    .where(
      and(
        inArray(schema.uploadedAssetCleanupOutbox.id, assetIds),
        cleanupScope,
      ),
    );
  if (pendingCleanup.length > 0) {
    throw Object.assign(
      new Error("One or more slide assets are unavailable to this deck."),
      { statusCode: 404, errorCode: "slide_asset_unavailable" },
    );
  }
}

export async function lockSlideAssetReferences(
  tx: Pick<SlideAssetTransaction, "select">,
  deckData: unknown,
  scope: AssetScope,
  deckId?: string,
): Promise<void> {
  if (deckId) {
    // Deck writers and deletion must lock the deck before its asset rows.
    await tx
      .select({ id: schema.decks.id })
      .from(schema.decks)
      .where(eq(schema.decks.id, deckId))
      .for("update");
  }
  await lockSlideAssetIds(tx, collectDeckSlideAssetIds(deckData), scope);
}

export async function withSlideAssetReferencesLocked<T>(
  db: SlideAssetDatabase,
  deckData: unknown,
  scope: AssetScope,
  write: (connection: SlideAssetConnection) => Promise<T>,
  deckId?: string,
): Promise<T> {
  const assetIds = collectDeckSlideAssetIds(deckData);
  if (assetIds.length === 0 && !deckId) return write(db);

  return db.transaction(async (tx) => {
    if (deckId) {
      // Keep the same deck-before-asset order as delete-deck and upload registration.
      await tx
        .select({ id: schema.decks.id })
        .from(schema.decks)
        .where(eq(schema.decks.id, deckId))
        .for("update");
    }
    await lockSlideAssetIds(tx, assetIds, scope);
    return write(tx);
  });
}

export async function findDeckReferencingAsset(
  tx: Pick<SlideAssetTransaction, "select">,
  asset: { id: string; ownerEmail: string; orgId: string | null },
): Promise<{ id: string } | undefined> {
  const references = await findDeckReferencesToAssets(tx, [asset]);
  const deckId = references.get(asset.id);
  return deckId ? { id: deckId } : undefined;
}

export async function findDeckReferencesToAssets(
  tx: Pick<SlideAssetTransaction, "select">,
  assets: Array<{ id: string; ownerEmail: string; orgId: string | null }>,
  ignoredDeckId?: string,
): Promise<Map<string, string>> {
  if (assets.length === 0) return new Map();

  const uniqueDeckScopes = new Map<string, (typeof assets)[number]>();
  for (const asset of assets) {
    const key = asset.orgId
      ? `org:${asset.orgId}`
      : `owner:${asset.ownerEmail}`;
    uniqueDeckScopes.set(key, asset);
  }
  const deckScopes = [...uniqueDeckScopes.values()].map((asset) =>
    asset.orgId
      ? eq(schema.decks.orgId, asset.orgId)
      : and(
          eq(schema.decks.ownerEmail, asset.ownerEmail),
          isNull(schema.decks.orgId),
        ),
  );

  const references = new Map<string, string>();
  const assetIds = new Set(assets.map((asset) => asset.id));
  let cursor: string | undefined;
  while (references.size < assetIds.size) {
    const scope = or(...deckScopes);
    const decks = await tx
      .select({
        id: schema.decks.id,
        data: schema.decks.data,
        ownerEmail: schema.decks.ownerEmail,
        orgId: schema.decks.orgId,
      })
      .from(schema.decks)
      .where(cursor ? and(scope, gt(schema.decks.id, cursor)) : scope)
      .orderBy(asc(schema.decks.id))
      .limit(DECK_REFERENCE_SCAN_BATCH_SIZE);
    if (decks.length === 0) break;

    for (const deck of decks) {
      if (deck.id === ignoredDeckId) continue;
      const readableAssetIds = new Set(
        assets
          .filter((asset) =>
            asset.orgId
              ? deck.orgId === asset.orgId
              : deck.orgId === null && deck.ownerEmail === asset.ownerEmail,
          )
          .map((asset) => asset.id),
      );
      if (readableAssetIds.size === 0) continue;
      let referencedAssetIds: string[];
      if (!isSlides2DeckData(deck.data)) {
        if (!isMalformedJsonString(deck.data)) continue;

        // The scoped row may be a damaged Slides deck, so protect its assets.
        referencedAssetIds = [...readableAssetIds];
      } else {
        try {
          referencedAssetIds = collectDeckSlideAssetIds(deck.data);
        } catch {
          // Keep scoped assets when a Slides deck's references cannot be parsed.
          referencedAssetIds = [...readableAssetIds];
        }
      }
      for (const id of referencedAssetIds) {
        if (readableAssetIds.has(id) && !references.has(id)) {
          references.set(id, deck.id);
        }
      }
    }

    cursor = decks[decks.length - 1]!.id;
    if (decks.length < DECK_REFERENCE_SCAN_BATCH_SIZE) break;
  }
  return references;
}
