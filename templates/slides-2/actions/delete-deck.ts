import { defineAction, fail } from "@agent-native/core/action";
import { deleteUploadedFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess, ForbiddenError } from "@agent-native/core/sharing";
import { and, asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { notifyClients } from "../server/handlers/decks.js";
import { localImportedAssetIdentity } from "../server/lib/import-asset-storage.js";
import { findDeckReferencesToAssets } from "../server/lib/slide-asset-references.js";
import {
  finishOwnedUploadedAssetCleanup,
  retryOwnedUploadedAssetCleanup,
  scheduleUploadedAssetDeletion,
  type SlidesTransaction,
} from "../server/lib/uploaded-asset-cleanup-outbox.js";
import { deleteUploadedAssetObject } from "../server/lib/uploaded-asset-object-lifecycle.js";
import { isSlides2DeckData } from "../shared/deck-app-scope.js";

type DeckUploadedAsset = {
  id: string;
  url: string;
  provider: string;
  providerObjectId: string | null;
  orgId: string | null;
  ownerEmail: string;
};

function sameStoredObject(
  left: Pick<DeckUploadedAsset, "provider" | "providerObjectId" | "url">,
  right: Pick<DeckUploadedAsset, "provider" | "providerObjectId" | "url">,
): boolean {
  return (
    left.url === right.url ||
    (left.providerObjectId !== null &&
      left.provider === right.provider &&
      left.providerObjectId === right.providerObjectId)
  );
}

function storedObjectGroups(
  assets: DeckUploadedAsset[],
): DeckUploadedAsset[][] {
  const remaining = [...assets];
  const groups: DeckUploadedAsset[][] = [];
  while (remaining.length > 0) {
    const group = [remaining.shift()!];
    for (let index = 0; index < group.length; index += 1) {
      for (
        let candidateIndex = remaining.length - 1;
        candidateIndex >= 0;
        candidateIndex -= 1
      ) {
        const candidate = remaining[candidateIndex]!;
        if (!sameStoredObject(group[index]!, candidate)) continue;
        group.push(candidate);
        remaining.splice(candidateIndex, 1);
      }
    }
    groups.push(group);
  }
  return groups;
}

function storedObjectWhere(
  asset: Pick<DeckUploadedAsset, "provider" | "providerObjectId" | "url">,
) {
  const urlMatch = eq(schema.uploadedAssets.url, asset.url);
  if (asset.providerObjectId === null) return urlMatch;

  const providerObjectMatch = and(
    eq(schema.uploadedAssets.provider, asset.provider),
    eq(schema.uploadedAssets.providerObjectId, asset.providerObjectId),
  );
  return providerObjectMatch ? or(urlMatch, providerObjectMatch) : urlMatch;
}

function uploadedAssetCleanupScope(asset: DeckUploadedAsset) {
  return and(
    eq(schema.uploadedAssetCleanupOutbox.id, asset.id),
    eq(schema.uploadedAssetCleanupOutbox.ownerEmail, asset.ownerEmail),
    asset.orgId
      ? eq(schema.uploadedAssetCleanupOutbox.orgId, asset.orgId)
      : isNull(schema.uploadedAssetCleanupOutbox.orgId),
    eq(schema.uploadedAssetCleanupOutbox.provider, asset.provider),
    eq(schema.uploadedAssetCleanupOutbox.url, asset.url),
    asset.providerObjectId
      ? eq(
          schema.uploadedAssetCleanupOutbox.providerObjectId,
          asset.providerObjectId,
        )
      : isNull(schema.uploadedAssetCleanupOutbox.providerObjectId),
  );
}

async function clearUploadedAssetCleanup(
  transaction: SlidesTransaction,
  asset: DeckUploadedAsset,
): Promise<void> {
  await transaction
    .delete(schema.uploadedAssetCleanupOutbox)
    .where(uploadedAssetCleanupScope(asset));
}

export default defineAction({
  description: "Delete a deck and its saved versions.",
  schema: z.object({
    id: z.string().min(1).describe("Deck ID"),
  }),
  http: { method: "DELETE" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    try {
      const access = await assertAccess("deck", id, "admin");
      const owner = access.resource.ownerEmail as string;
      const orgId =
        typeof access.resource.orgId === "string"
          ? access.resource.orgId
          : undefined;
      const db = getDb();
      const ownerRecipients = new Set<string>();
      const orgRecipients = new Set<string>();
      const normalizedOwner = owner.trim().toLowerCase();
      if (normalizedOwner) ownerRecipients.add(normalizedOwner);
      if (access.resource.visibility === "org" && orgId) {
        orgRecipients.add(orgId);
      }
      const result = await db.transaction(async (tx) => {
        // Comment creation takes this same lock before validating the slide,
        // as does upload registration before inserting its asset row.
        const [lockedDeck] = await tx
          .select({ id: schema.decks.id, data: schema.decks.data })
          .from(schema.decks)
          .where(eq(schema.decks.id, id))
          .for("update");
        if (!lockedDeck)
          return { deletedDecks: [], shares: [], assetCleanupRecords: [] };
        if (!isSlides2DeckData(lockedDeck.data)) {
          fail("Deck not found.", {
            errorCode: "deck_not_found",
            statusCode: 404,
          });
        }
        const uploadedAssets = await tx
          .select({
            id: schema.uploadedAssets.id,
            url: schema.uploadedAssets.url,
            provider: schema.uploadedAssets.provider,
            providerObjectId: schema.uploadedAssets.providerObjectId,
            orgId: schema.uploadedAssets.orgId,
            ownerEmail: schema.uploadedAssets.ownerEmail,
          })
          .from(schema.uploadedAssets)
          .where(eq(schema.uploadedAssets.deckId, id))
          .orderBy(asc(schema.uploadedAssets.id))
          .for("update");

        const shares = await tx
          .select({
            principalType: schema.deckShares.principalType,
            principalId: schema.deckShares.principalId,
          })
          .from(schema.deckShares)
          .where(eq(schema.deckShares.resourceId, id));
        const referencedAssets = await findDeckReferencesToAssets(
          tx,
          uploadedAssets,
          id,
        );
        const referencedAssetIds = new Set(referencedAssets.keys());
        for (const assetId of [...referencedAssetIds].sort()) {
          const [detachedAsset] = await tx
            .update(schema.uploadedAssets)
            .set({ deckId: null })
            .where(
              and(
                eq(schema.uploadedAssets.id, assetId),
                eq(schema.uploadedAssets.deckId, id),
              ),
            )
            .returning({ id: schema.uploadedAssets.id });
          if (!detachedAsset) {
            fail("A referenced slide asset changed during deck deletion.", {
              errorCode: "deck_asset_reference_conflict",
              statusCode: 409,
            });
          }
        }
        const deletedAssets = uploadedAssets.filter(
          (asset) => !referencedAssetIds.has(asset.id),
        );
        const assetsWithProvider = deletedAssets.map((asset) => {
          const localIdentity = asset.provider
            ? null
            : localImportedAssetIdentity(asset.url);
          const provider = asset.provider ?? localIdentity?.provider;
          const providerObjectId =
            asset.providerObjectId ?? localIdentity?.providerObjectId ?? null;
          if (!provider) {
            fail("Could not delete deck assets without a storage provider.", {
              errorCode: "deck_asset_cleanup_unavailable",
              statusCode: 503,
            });
          }
          return { ...asset, provider, providerObjectId };
        });
        const assetCleanupRecords: Array<{
          assetId: string;
          url: string;
          provider: string;
          providerObjectId: string | null;
          orgId: string | null;
          ownerEmail: string;
          token: string;
        }> = [];
        const deletedAssetIds = new Set(deletedAssets.map((asset) => asset.id));
        for (const group of storedObjectGroups(assetsWithProvider)) {
          const referenceConditions = group.map(storedObjectWhere);
          const references = await tx
            .select({ id: schema.uploadedAssets.id })
            .from(schema.uploadedAssets)
            .where(or(...referenceConditions))
            .for("update");
          const hasSurvivingReference = references.some(
            (reference) => !deletedAssetIds.has(reference.id),
          );

          if (hasSurvivingReference) {
            for (const asset of group) {
              await clearUploadedAssetCleanup(tx, asset);
            }
            continue;
          }

          const [asset, ...duplicates] = group;
          const token = await scheduleUploadedAssetDeletion(tx, {
            assetId: asset.id,
            ownerEmail: asset.ownerEmail,
            orgId: asset.orgId,
            provider: asset.provider,
            providerObjectId: asset.providerObjectId,
            url: asset.url,
          });
          assetCleanupRecords.push({
            assetId: asset.id,
            url: asset.url,
            provider: asset.provider,
            providerObjectId: asset.providerObjectId,
            orgId: asset.orgId,
            ownerEmail: asset.ownerEmail,
            token,
          });
          for (const duplicate of duplicates) {
            await clearUploadedAssetCleanup(tx, duplicate);
          }
        }
        await tx
          .delete(schema.deckShares)
          .where(eq(schema.deckShares.resourceId, id));
        await tx
          .delete(schema.deckShareLinks)
          .where(eq(schema.deckShareLinks.deckId, id));
        await tx
          .delete(schema.deckEvents)
          .where(eq(schema.deckEvents.deckId, id));
        await tx
          .delete(schema.deckAccessRequestLimits)
          .where(eq(schema.deckAccessRequestLimits.deckId, id));
        await tx
          .delete(schema.deckVersions)
          .where(
            and(
              eq(schema.deckVersions.deckId, id),
              eq(schema.deckVersions.ownerEmail, owner),
            ),
          );
        await tx
          .delete(schema.uploadedAssets)
          .where(eq(schema.uploadedAssets.deckId, id));
        await tx
          .delete(schema.slideComments)
          .where(eq(schema.slideComments.deckId, id));
        const deletedDecks = await tx
          .delete(schema.decks)
          .where(eq(schema.decks.id, id))
          .returning();
        return {
          deletedDecks,
          shares,
          assetCleanupRecords,
        };
      });

      if (result.deletedDecks.length === 0) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }
      await Promise.all(
        result.assetCleanupRecords.map(async (asset) => {
          const requestContext = {
            userEmail: asset.ownerEmail,
            ...(asset.orgId ? { orgId: asset.orgId } : {}),
          };
          try {
            const cleanupScope = {
              assetId: asset.assetId,
              ownerEmail: asset.ownerEmail,
              orgId: asset.orgId,
            };
            const finishCleanup = async (tx: SlidesTransaction) => {
              const removed = await finishOwnedUploadedAssetCleanup(
                tx,
                cleanupScope,
                asset.token,
              );
              if (!removed) {
                fail("Deck asset cleanup lease was no longer current.", {
                  errorCode: "deck_asset_cleanup_lease_lost",
                  statusCode: 409,
                });
              }
              await tx
                .delete(schema.uploadedAssets)
                .where(
                  and(
                    eq(schema.uploadedAssets.id, asset.assetId),
                    eq(schema.uploadedAssets.ownerEmail, asset.ownerEmail),
                    asset.orgId
                      ? eq(schema.uploadedAssets.orgId, asset.orgId)
                      : isNull(schema.uploadedAssets.orgId),
                    eq(schema.uploadedAssets.url, asset.url),
                    eq(schema.uploadedAssets.provider, asset.provider),
                    asset.providerObjectId
                      ? eq(
                          schema.uploadedAssets.providerObjectId,
                          asset.providerObjectId,
                        )
                      : isNull(schema.uploadedAssets.providerObjectId),
                    isNull(schema.uploadedAssets.deckId),
                  ),
                );
            };
            const deletion = await runWithRequestContext(requestContext, () =>
              deleteUploadedAssetObject({
                identity: {
                  url: asset.url,
                  provider: asset.provider,
                  providerObjectId: asset.providerObjectId,
                },
                excludeAssetId: asset.assetId,
                lease: { ...cleanupScope, token: asset.token },
                deleteObject: () =>
                  deleteUploadedFile(asset.provider, {
                    id: asset.providerObjectId ?? undefined,
                    url: asset.url,
                  }),
                onShared: finishCleanup,
                onAlreadyDeleted: finishCleanup,
                onDeleted: finishCleanup,
              }),
            );
            if (deletion.status === "failed") {
              await runWithRequestContext(requestContext, () =>
                retryOwnedUploadedAssetCleanup(cleanupScope, asset.token, 1),
              );
              console.warn(
                "[slides-upload] deck asset cleanup remains queued",
                {
                  assetId: asset.assetId,
                },
              );
            }
          } catch (error) {
            console.warn(
              "[slides-upload] could not clean up deleted deck asset",
              {
                assetId: asset.assetId,
                error: error instanceof Error ? error.message : String(error),
              },
            );
          }
        }),
      );
      for (const share of result.shares) {
        if (
          share.principalType === "user" &&
          typeof share.principalId === "string"
        ) {
          const recipient = share.principalId.trim().toLowerCase();
          if (recipient) ownerRecipients.add(recipient);
        } else if (
          share.principalType === "org" &&
          typeof share.principalId === "string"
        ) {
          const recipient = share.principalId.trim();
          if (recipient) orgRecipients.add(recipient);
        }
      }
      if (access.resource.visibility === "public") {
        await notifyClients(id, { type: "deck-deleted", visibility: "public" });
      } else {
        for (const recipient of ownerRecipients) {
          await notifyClients(id, { type: "deck-deleted", owner: recipient });
        }
        for (const recipient of orgRecipients) {
          await notifyClients(id, { type: "deck-deleted", orgId: recipient });
        }
      }
      return { success: true };
    } catch (err) {
      if (err instanceof ForbiddenError) {
        fail("Deck not found.", {
          errorCode: "deck_not_found",
          statusCode: 404,
        });
      }
      throw err;
    }
  },
});
