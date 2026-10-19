import { defineAction, fail } from "@agent-native/core/action";
import { deleteUploadedFile } from "@agent-native/core/file-upload";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull, like, or, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  finishOwnedUploadedAssetCleanup,
  retryOwnedUploadedAssetCleanup,
  scheduleUploadedAssetDeletion,
} from "../server/lib/uploaded-asset-cleanup-outbox.js";

function ownedImageScope(
  id: string,
  ownerEmail: string,
  orgId: string | null | undefined,
) {
  return and(
    eq(schema.uploadedAssets.id, id),
    eq(schema.uploadedAssets.ownerEmail, ownerEmail),
    orgId
      ? or(
          eq(schema.uploadedAssets.orgId, orgId),
          isNull(schema.uploadedAssets.orgId),
        )
      : isNull(schema.uploadedAssets.orgId),
    isNull(schema.uploadedAssets.deckId),
    like(schema.uploadedAssets.type, "image/%"),
  );
}

function registeredCleanupMarkerScope(args: {
  assetId: string;
  ownerEmail: string;
  orgId: string | null;
  provider: string;
  providerObjectId: string | null;
  url: string;
}) {
  return and(
    eq(schema.uploadedAssetCleanupOutbox.id, args.assetId),
    eq(schema.uploadedAssetCleanupOutbox.ownerEmail, args.ownerEmail),
    args.orgId
      ? eq(schema.uploadedAssetCleanupOutbox.orgId, args.orgId)
      : isNull(schema.uploadedAssetCleanupOutbox.orgId),
    eq(schema.uploadedAssetCleanupOutbox.intent, "registration"),
    eq(schema.uploadedAssetCleanupOutbox.state, "registered"),
    eq(schema.uploadedAssetCleanupOutbox.provider, args.provider),
    eq(schema.uploadedAssetCleanupOutbox.url, args.url),
    args.providerObjectId
      ? eq(
          schema.uploadedAssetCleanupOutbox.providerObjectId,
          args.providerObjectId,
        )
      : isNull(schema.uploadedAssetCleanupOutbox.providerObjectId),
  );
}

const updateAssetSchema = z
  .object({
    id: z.string().min(1).describe("Uploaded image ID"),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe("New image filename"),
    replacementId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "ID of a same-scope uploaded image that no saved slide already references",
      ),
  })
  .refine(
    ({ id, replacementId }) =>
      replacementId === undefined || replacementId !== id,
    {
      path: ["replacementId"],
      message: "Choose a different image to replace this one.",
    },
  )
  .refine(
    ({ filename, replacementId }) =>
      filename !== undefined || replacementId !== undefined,
    { message: "Provide a filename or replacement image." },
  );

function requireReplacementId(replacementId: string | undefined): string {
  if (!replacementId) {
    fail("Provide a filename or replacement image.", {
      errorCode: "asset_update_invalid",
      statusCode: 400,
    });
  }
  return replacementId;
}

export default defineAction({
  title: "Update uploaded image",
  description:
    "Rename an uploaded image or replace its stored file with another uploaded image while preserving its ID and every slide reference.",
  schema: updateAssetSchema,
  http: { method: "PUT" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id, filename, replacementId }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to update uploaded images.", {
        errorCode: "asset_update_auth_required",
        statusCode: 401,
      });
    }

    if (replacementId === id) {
      fail("Choose a different image to replace this one.", {
        errorCode: "asset_replacement_invalid",
        statusCode: 400,
      });
    }

    const orgId = getRequestOrgId();
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch {
      fail("Could not update the uploaded image.", {
        errorCode: "asset_update_failed",
        statusCode: 500,
      });
    }

    if (replacementId === undefined) {
      if (filename === undefined) {
        fail("Provide a filename or replacement image.", {
          errorCode: "asset_update_invalid",
          statusCode: 400,
        });
      }
      let updated: Array<{ filename: string }>;
      try {
        updated = await db
          .update(schema.uploadedAssets)
          .set({ filename })
          .where(ownedImageScope(id, ownerEmail, orgId))
          .returning({ filename: schema.uploadedAssets.filename });
      } catch {
        fail("Could not rename the uploaded image.", {
          errorCode: "asset_rename_failed",
          statusCode: 500,
        });
      }
      if (updated.length === 0) {
        fail("Uploaded image not found.", {
          errorCode: "asset_not_found",
          statusCode: 404,
        });
      }
      return { success: true, filename: updated[0]!.filename };
    }

    const replacementAssetId = requireReplacementId(replacementId);

    let assets: Array<{
      id: string;
      filename: string;
      url: string;
      type: string;
      size: number;
      provider: string | null;
      providerObjectId: string | null;
      orgId: string | null;
    }>;
    try {
      assets = await db
        .select({
          id: schema.uploadedAssets.id,
          filename: schema.uploadedAssets.filename,
          url: schema.uploadedAssets.url,
          type: schema.uploadedAssets.type,
          size: schema.uploadedAssets.size,
          provider: schema.uploadedAssets.provider,
          providerObjectId: schema.uploadedAssets.providerObjectId,
          orgId: schema.uploadedAssets.orgId,
        })
        .from(schema.uploadedAssets)
        .where(
          and(
            inArray(schema.uploadedAssets.id, [id, replacementAssetId]),
            eq(schema.uploadedAssets.ownerEmail, ownerEmail),
            orgId
              ? or(
                  eq(schema.uploadedAssets.orgId, orgId),
                  isNull(schema.uploadedAssets.orgId),
                )
              : isNull(schema.uploadedAssets.orgId),
            isNull(schema.uploadedAssets.deckId),
            like(schema.uploadedAssets.type, "image/%"),
          ),
        );
    } catch {
      fail("Could not read the uploaded images.", {
        errorCode: "asset_update_failed",
        statusCode: 500,
      });
    }

    const previous = assets.find((asset) => asset.id === id);
    const replacement = assets.find((asset) => asset.id === replacementAssetId);
    if (!previous || !replacement) {
      fail("Uploaded image not found.", {
        errorCode: "asset_not_found",
        statusCode: 404,
      });
    }
    if (!previous.provider || !replacement.provider) {
      fail("Image storage could not be verified.", {
        errorCode: "asset_replace_storage_unavailable",
        statusCode: 503,
      });
    }
    let referencingDeck: { id: string } | undefined;
    try {
      // Check private same-org decks too, while returning only a generic conflict.
      const deckScope = replacement.orgId
        ? eq(schema.decks.orgId, replacement.orgId)
        : and(
            eq(schema.decks.ownerEmail, ownerEmail),
            isNull(schema.decks.orgId),
          );
      [referencingDeck] = await db
        .select({ id: schema.decks.id })
        .from(schema.decks)
        .where(
          and(
            deckScope,
            sql`position(${`asset://${replacementAssetId}`} in ${schema.decks.data}) > 0`,
          ),
        )
        .limit(1);
    } catch {
      fail("Could not verify whether the replacement image is in use.", {
        errorCode: "asset_replacement_check_failed",
        statusCode: 500,
      });
    }
    if (referencingDeck) {
      fail("Choose an image that no saved slide already uses.", {
        errorCode: "asset_replacement_in_use",
        statusCode: 409,
      });
    }
    const sameStoredFile =
      previous.url === replacement.url ||
      (previous.provider === replacement.provider &&
        previous.providerObjectId !== null &&
        previous.providerObjectId === replacement.providerObjectId);

    let updated: {
      filename: string;
      cleanup: {
        assetId: string;
        ownerEmail: string;
        orgId: string | null;
        provider: string;
        providerObjectId: string | null;
        url: string;
        token: string;
      } | null;
    };
    try {
      updated = await db.transaction(async (tx) => {
        const [saved] = await tx
          .update(schema.uploadedAssets)
          .set({
            filename: filename ?? replacement.filename,
            url: replacement.url,
            type: replacement.type,
            size: replacement.size,
            provider: replacement.provider,
            providerObjectId: replacement.providerObjectId,
          })
          .where(
            and(
              ownedImageScope(id, ownerEmail, orgId),
              eq(schema.uploadedAssets.url, previous.url),
              eq(schema.uploadedAssets.provider, previous.provider),
              previous.providerObjectId
                ? eq(
                    schema.uploadedAssets.providerObjectId,
                    previous.providerObjectId,
                  )
                : isNull(schema.uploadedAssets.providerObjectId),
            ),
          )
          .returning({ filename: schema.uploadedAssets.filename });
        if (!saved)
          fail("The image being replaced is no longer available.", {
            errorCode: "asset_replace_update_missing",
            statusCode: 409,
          });

        const [removed] = await tx
          .delete(schema.uploadedAssets)
          .where(
            and(
              ownedImageScope(replacementAssetId, ownerEmail, orgId),
              eq(schema.uploadedAssets.url, replacement.url),
              eq(schema.uploadedAssets.provider, replacement.provider),
              replacement.providerObjectId
                ? eq(
                    schema.uploadedAssets.providerObjectId,
                    replacement.providerObjectId,
                  )
                : isNull(schema.uploadedAssets.providerObjectId),
            ),
          )
          .returning({ id: schema.uploadedAssets.id });
        if (!removed)
          fail("The replacement image is no longer available.", {
            errorCode: "asset_replace_source_missing",
            statusCode: 409,
          });

        await tx.delete(schema.uploadedAssetCleanupOutbox).where(
          registeredCleanupMarkerScope({
            assetId: replacementAssetId,
            ownerEmail,
            orgId: replacement.orgId,
            provider: replacement.provider,
            providerObjectId: replacement.providerObjectId,
            url: replacement.url,
          }),
        );

        let cleanup: {
          assetId: string;
          ownerEmail: string;
          orgId: string | null;
          provider: string;
          providerObjectId: string | null;
          url: string;
          token: string;
        } | null = null;
        if (!sameStoredFile) {
          const cleanupInput = {
            assetId: id,
            ownerEmail,
            orgId: previous.orgId,
            provider: previous.provider,
            providerObjectId: previous.providerObjectId,
            url: previous.url,
          };
          const token = await scheduleUploadedAssetDeletion(tx, cleanupInput);
          cleanup = { ...cleanupInput, token };
        } else {
          await tx.delete(schema.uploadedAssetCleanupOutbox).where(
            registeredCleanupMarkerScope({
              assetId: id,
              ownerEmail,
              orgId: previous.orgId,
              provider: previous.provider,
              providerObjectId: previous.providerObjectId,
              url: previous.url,
            }),
          );
        }

        return { filename: saved.filename, cleanup };
      });
    } catch {
      fail("Could not replace the uploaded image.", {
        errorCode: "asset_replace_failed",
        statusCode: 500,
      });
    }

    let cleanupWarning = false;
    if (updated.cleanup) {
      const cleanup = updated.cleanup;
      const cleanupScope = {
        assetId: cleanup.assetId,
        ownerEmail: cleanup.ownerEmail,
        orgId: cleanup.orgId,
      };
      try {
        const deleted = await deleteUploadedFile(cleanup.provider, {
          url: cleanup.url,
          id: cleanup.providerObjectId ?? undefined,
        });
        if (!deleted) {
          cleanupWarning = true;
          await retryOwnedUploadedAssetCleanup(cleanupScope, cleanup.token, 1);
        } else {
          await db.transaction(async (tx) => {
            const removed = await finishOwnedUploadedAssetCleanup(
              tx,
              cleanupScope,
              cleanup.token,
            );
            if (!removed) {
              fail("Replaced image cleanup lease is no longer current.", {
                errorCode: "asset_replace_cleanup_lease_lost",
                statusCode: 409,
              });
            }
          });
        }
      } catch {
        cleanupWarning = true;
        try {
          await retryOwnedUploadedAssetCleanup(cleanupScope, cleanup.token, 1);
        } catch {
          // The cleanup lease expires for the recurring sweep to reclaim.
        }
      }
    }

    return { success: true, filename: updated.filename, cleanupWarning };
  },
});
