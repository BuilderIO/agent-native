import { createHash, randomUUID } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import uploadImage from "@agent-native/core/file-upload/actions/upload-image";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  DesignNativeTextureAssetError,
  MAX_DESIGN_NATIVE_TEXTURE_BYTES,
  designNativeTextureMime,
  designNativeTexturePath,
  validateDesignNativeTextureBytes,
} from "../server/lib/design-native-texture-assets.js";
import {
  commitDesignNativeTextureRegistration,
  NativeTextureCommitError,
} from "../server/lib/design-native-texture-commit.js";
import {
  NativeTextureProviderError,
  readDesignNativeTextureProvider,
} from "../server/lib/design-native-texture-provider.js";
import { resolveSourceWorkspace } from "../server/source-workspace.js";

const MAX_INPUT_BYTES = MAX_DESIGN_NATIVE_TEXTURE_BYTES;
function decodeRasterData(value: string): {
  bytes: Uint8Array;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  sha256: string;
} {
  const match =
    /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      value,
    );
  if (!match || match[2]!.length % 4 !== 0)
    fail("Native texture upload needs a PNG, JPEG or WebP data URL.", {
      errorCode: "native_texture_invalid_image",
      statusCode: 400,
    });
  const bytes = new Uint8Array(Buffer.from(match[2]!, "base64"));
  if (
    Buffer.from(bytes).toString("base64") !== match[2] ||
    bytes.byteLength > MAX_INPUT_BYTES
  )
    fail("Native texture bytes are invalid or exceed 1 MB.", {
      errorCode: "native_texture_limit",
      statusCode: 413,
    });
  const mimeType = designNativeTextureMime(match[1]!);
  if (!mimeType)
    fail("Native texture image type is unsupported.", {
      errorCode: "native_texture_invalid_image",
      statusCode: 400,
    });
  let sha256: string;
  try {
    sha256 = validateDesignNativeTextureBytes(mimeType, bytes);
  } catch (error) {
    if (error instanceof DesignNativeTextureAssetError)
      fail(error.message, {
        errorCode: `native_texture_${error.code.replace(/-/g, "_")}`,
        statusCode: error.code === "limit" ? 413 : 400,
      });
    throw error;
  }
  return { bytes, mimeType, sha256 };
}

export default defineAction({
  description:
    "Upload a raster photo for one editable Design file's native shader texture and return a durable same-origin reference.",
  requiresAuth: true,
  maxBodyBytes: 1_400_000,
  schema: z.object({
    designId: z.string().min(1).describe("Design project ID"),
    fileId: z.string().min(1).describe("Editable HTML file ID in that Design"),
    data: z
      .string()
      .min(32)
      .max(10_700_000)
      .describe("PNG, JPEG or WebP base64 data URL, at most 1 MB decoded"),
    filename: z.string().min(1).max(160).describe("Original image filename"),
    idempotencyKey: z
      .string()
      .min(1)
      .max(96)
      .describe("Stable unique key for retrying this exact file upload"),
  }),
  run: async ({ designId, fileId, data, filename, idempotencyKey }) => {
    const workspace = await resolveSourceWorkspace(designId, {
      includeContent: false,
      includeBoard: true,
    });
    if (workspace.sourceType !== "inline" || !workspace.canEdit)
      fail("Native texture upload requires an editable inline Design.", {
        errorCode: "native_texture_forbidden",
        statusCode: 403,
      });
    if (
      !workspace.files.some(
        (file) => file.id === fileId && file.fileType === "html",
      )
    )
      fail("Native texture target file was not found.", {
        errorCode: "native_texture_file_not_found",
        statusCode: 404,
      });
    const uploaderEmail = getRequestUserEmail();
    if (!uploaderEmail)
      fail("Native texture upload requires an authenticated editor.", {
        errorCode: "native_texture_forbidden",
        statusCode: 403,
      });
    const decoded = decodeRasterData(data);
    const receiptKey = `design-native-texture:${createHash("sha256")
      .update(JSON.stringify([designId, fileId, idempotencyKey, uploaderEmail]))
      .digest("hex")}`;
    const db = getDb();
    const [designOwner] = await db
      .select({
        ownerEmail: schema.designs.ownerEmail,
        orgId: schema.designs.orgId,
      })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    if (!designOwner || !designOwner.ownerEmail)
      fail("Native texture Design owner is unavailable.", {
        errorCode: "native_texture_forbidden",
        statusCode: 403,
      });
    const table = schema.designNativeTextureAssets;
    const where = and(
      eq(table.designId, designId),
      eq(table.fileId, fileId),
      eq(table.idempotencyKey, idempotencyKey),
    );
    const [existing] = await db.select().from(table).where(where).limit(1);
    if (existing) {
      if (
        existing.sha256 !== decoded.sha256 ||
        existing.mimeType !== decoded.mimeType
      )
        fail("This upload key belongs to different image bytes.", {
          errorCode: "native_texture_idempotency_conflict",
          statusCode: 409,
        });
      return {
        url: designNativeTexturePath(existing.id, decoded.mimeType),
        id: existing.id,
        sha256: existing.sha256,
      };
    }
    const uploaded = await uploadImage.run({
      data,
      filename,
      idempotencyKey: receiptKey,
    });
    if (
      !("url" in uploaded) ||
      typeof uploaded.url !== "string" ||
      !uploaded.url
    )
      fail("Native texture storage is unavailable.", {
        errorCode: "native_texture_storage_unavailable",
        statusCode: 503,
      });
    let verified;
    try {
      verified = await readDesignNativeTextureProvider(
        uploaded.url,
        uploaderEmail,
        MAX_INPUT_BYTES,
      );
    } catch (error) {
      if (error instanceof NativeTextureProviderError)
        fail(error.message, {
          errorCode: `native_texture_${error.code.replace(/-/g, "_")}`,
          statusCode:
            error.code === "limit"
              ? 413
              : error.code === "forbidden"
                ? 403
                : 422,
        });
      throw error;
    }
    if (
      verified.mimeType !== decoded.mimeType ||
      verified.data.byteLength !== decoded.bytes.byteLength ||
      validateDesignNativeTextureBytes(decoded.mimeType, verified.data) !==
        decoded.sha256
    )
      fail("Uploaded texture bytes differ from the selected image.", {
        errorCode: "native_texture_mismatch",
        statusCode: 409,
      });
    let committed;
    try {
      committed = await commitDesignNativeTextureRegistration({
        id: randomUUID(),
        designId,
        fileId,
        idempotencyKey,
        uploaderEmail,
        ownerEmail: designOwner.ownerEmail,
        orgId: designOwner.orgId,
        receiptKey,
        providerUrl: uploaded.url,
        mimeType: decoded.mimeType,
        byteLength: decoded.bytes.byteLength,
        sha256: decoded.sha256,
      });
    } catch (error) {
      if (error instanceof NativeTextureCommitError)
        fail(error.message, {
          errorCode: `native_texture_${error.code.replace(/-/g, "_")}`,
          statusCode: error.code === "registration-conflict" ? 409 : 503,
        });
      throw error;
    }
    if (!committed.sameProviderObject) {
      const settled = await uploadImage.run({
        idempotencyKey: receiptKey,
        cleanup: "delete",
      });
      if (
        !("deleted" in settled && settled.deleted === true) &&
        !("alreadyMissing" in settled && settled.alreadyMissing === true)
      )
        fail("Native texture upload could not be finalized.", {
          errorCode: "native_texture_commit_failed",
          statusCode: 503,
        });
    }
    return {
      url: designNativeTexturePath(committed.id, decoded.mimeType),
      id: committed.id,
      sha256: decoded.sha256,
    };
  },
});
