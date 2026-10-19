import {
  defineAction,
  fail,
  isActionContractError,
} from "@agent-native/core/action";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { scheduleUploadedAssetDeletion } from "../server/lib/uploaded-asset-cleanup-outbox.js";

function imageAssetWorkspaceScope(orgId: string | null | undefined) {
  if (!orgId) return isNull(schema.uploadedAssets.orgId);
  return or(
    eq(schema.uploadedAssets.orgId, orgId),
    isNull(schema.uploadedAssets.orgId),
  );
}

function globalImageAssetScope(
  id: string,
  ownerEmail: string,
  orgId: string | null | undefined,
) {
  return and(
    eq(schema.uploadedAssets.id, id),
    eq(schema.uploadedAssets.ownerEmail, ownerEmail),
    imageAssetWorkspaceScope(orgId),
    isNull(schema.uploadedAssets.deckId),
    like(schema.uploadedAssets.type, "image/%"),
  );
}

export default defineAction({
  title: "Delete uploaded image",
  description:
    "Delete an image from the current user's global upload collection and its stored file.",
  schema: z.object({ id: z.string().min(1).describe("Uploaded image ID") }),
  retrySafe: true,
  http: { method: "DELETE" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: async ({ id }) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to delete uploaded images.", {
        errorCode: "asset_delete_auth_required",
        statusCode: 401,
      });
    }

    const orgId = getRequestOrgId();
    let db: ReturnType<typeof getDb>;
    try {
      db = getDb();
    } catch {
      fail("Could not delete uploaded image.", {
        errorCode: "asset_delete_failed",
        statusCode: 500,
      });
    }

    let result: "missing" | "storage_unavailable" | "deleted";
    try {
      result = await db.transaction(async (tx) => {
        const [asset] = await tx
          .select({
            id: schema.uploadedAssets.id,
            url: schema.uploadedAssets.url,
            provider: schema.uploadedAssets.provider,
            providerObjectId: schema.uploadedAssets.providerObjectId,
            orgId: schema.uploadedAssets.orgId,
          })
          .from(schema.uploadedAssets)
          .where(globalImageAssetScope(id, ownerEmail, orgId))
          .for("update");

        if (!asset) return "missing";
        if (!asset.provider) return "storage_unavailable";

        await scheduleUploadedAssetDeletion(tx, {
          assetId: asset.id,
          ownerEmail,
          orgId: asset.orgId,
          provider: asset.provider,
          providerObjectId: asset.providerObjectId,
          url: asset.url,
        });

        const [deleted] = await tx
          .delete(schema.uploadedAssets)
          .where(globalImageAssetScope(id, ownerEmail, orgId))
          .returning({ id: schema.uploadedAssets.id });
        if (!deleted) {
          fail("The uploaded image changed while it was being deleted.", {
            errorCode: "asset_delete_conflict",
            statusCode: 409,
          });
        }
        return "deleted";
      });
    } catch (error) {
      if (isActionContractError(error)) throw error;
      fail("Could not delete uploaded image.", {
        errorCode: "asset_delete_failed",
        statusCode: 500,
      });
    }

    if (result === "storage_unavailable") {
      fail("Could not remove the stored image.", {
        errorCode: "asset_delete_storage_unavailable",
        statusCode: 503,
      });
    }

    return { success: true };
  },
});
