import { defineAction, fail } from "@agent-native/core/action";
import { deleteUploadedFile } from "@agent-native/core/file-upload";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { and, eq, isNull, like, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

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

    let rows: Array<{
      id: string;
      url: string;
      provider: string | null;
      providerObjectId: string | null;
    }>;
    try {
      rows = await db
        .select({
          id: schema.uploadedAssets.id,
          url: schema.uploadedAssets.url,
          provider: schema.uploadedAssets.provider,
          providerObjectId: schema.uploadedAssets.providerObjectId,
        })
        .from(schema.uploadedAssets)
        .where(globalImageAssetScope(id, ownerEmail, orgId))
        .limit(1);
    } catch {
      fail("Could not delete uploaded image.", {
        errorCode: "asset_delete_failed",
        statusCode: 500,
      });
    }

    const [asset] = rows;
    if (!asset) return { success: true };
    if (!asset.provider) {
      fail("Could not remove the stored image.", {
        errorCode: "asset_delete_storage_unavailable",
        statusCode: 503,
      });
    }

    let objectDeleted = false;
    try {
      objectDeleted = await deleteUploadedFile(asset.provider, {
        url: asset.url,
        id: asset.providerObjectId ?? undefined,
      });
    } catch {
      fail("Could not remove the stored image.", {
        errorCode: "asset_delete_storage_failed",
        statusCode: 503,
      });
    }
    if (!objectDeleted) {
      fail("Could not remove the stored image.", {
        errorCode: "asset_delete_storage_failed",
        statusCode: 503,
      });
    }

    let deletedRows: Array<{ id: string }>;
    try {
      deletedRows = await db
        .delete(schema.uploadedAssets)
        .where(globalImageAssetScope(id, ownerEmail, orgId))
        .returning({ id: schema.uploadedAssets.id });
    } catch {
      fail("Could not delete uploaded image.", {
        errorCode: "asset_delete_failed",
        statusCode: 500,
      });
    }

    if (deletedRows.length === 0) {
      try {
        const [remaining] = await db
          .select({ id: schema.uploadedAssets.id })
          .from(schema.uploadedAssets)
          .where(globalImageAssetScope(id, ownerEmail, orgId))
          .limit(1);
        if (remaining) {
          fail("Could not verify uploaded image removal.", {
            errorCode: "asset_delete_failed",
            statusCode: 500,
          });
        }
      } catch (error) {
        if ((error as { errorCode?: unknown })?.errorCode) throw error;
        fail("Could not verify uploaded image removal.", {
          errorCode: "asset_delete_failed",
          statusCode: 500,
        });
      }
    }

    return { success: true };
  },
});
