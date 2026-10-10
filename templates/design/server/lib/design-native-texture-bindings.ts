import { createHash } from "node:crypto";

import type { DbExec } from "@agent-native/core/db";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../db/index";
import {
  DesignNativeTextureAssetError,
  MAX_DESIGN_NATIVE_TEXTURE_BYTES,
  findReadableNativeTextureBoundFile,
  parseDesignNativeTexturePath,
  readDesignNativeTextureAsset,
  verifiedNativeTextureSourceReferences,
} from "./design-native-texture-assets";
import {
  NativeTextureProviderError,
  readDesignNativeTextureProvider,
} from "./design-native-texture-provider";

const MAX_BINDINGS = 256;

export type NativeTextureTransferGrant = {
  id: string;
  path: string;
  sha256: string;
  providerUrl: string;
  sourceDesignId: string;
  sourceFileId: string;
  retained: boolean;
};

export async function preflightNativeTextureGrants(args: {
  designId: string;
  fileId: string;
  fileType: string;
  content: string;
  allowRetainedFileBinding?: boolean;
}): Promise<NativeTextureTransferGrant[]> {
  const paths = verifiedNativeTextureSourceReferences(
    args.fileType,
    args.content,
  );
  if (!paths.length) return [];
  if (args.allowRetainedFileBinding)
    await assertAccess("design", args.designId, "editor");
  const db = getDb();
  const grants: NativeTextureTransferGrant[] = [];
  for (const path of paths) {
    const parsed = parseDesignNativeTexturePath(path);
    if (!parsed)
      throw new DesignNativeTextureAssetError(
        "invalid-reference",
        "Native texture path is malformed.",
      );
    const [object] = await db
      .select()
      .from(schema.designNativeTextureObjects)
      .where(eq(schema.designNativeTextureObjects.id, parsed.id))
      .limit(1);
    if (!object)
      throw new DesignNativeTextureAssetError(
        "unavailable",
        "Native texture retention metadata is not ready; complete the bounded backfill before copying.",
      );
    const sourceFiles = await db
      .select({
        designId: schema.designNativeTextureBindings.designId,
        fileId: schema.designNativeTextureBindings.fileId,
      })
      .from(schema.designNativeTextureBindings)
      .where(eq(schema.designNativeTextureBindings.assetId, parsed.id))
      .limit(MAX_BINDINGS + 1);
    if (sourceFiles.length > MAX_BINDINGS)
      throw new DesignNativeTextureAssetError(
        "limit",
        "Native texture has too many bound source files.",
      );
    let source: { designId: string; fileId: string; retained: boolean } | null =
      null;
    if (args.allowRetainedFileBinding) {
      const [retained] = await db
        .select({ assetId: schema.designNativeTextureBindings.assetId })
        .from(schema.designNativeTextureBindings)
        .where(
          and(
            eq(schema.designNativeTextureBindings.assetId, parsed.id),
            eq(schema.designNativeTextureBindings.designId, args.designId),
            eq(schema.designNativeTextureBindings.fileId, args.fileId),
          ),
        )
        .limit(1);
      if (retained)
        source = {
          designId: args.designId,
          fileId: args.fileId,
          retained: true,
        };
    }
    if (!source) {
      const readable = await findReadableNativeTextureBoundFile(
        sourceFiles,
        path,
      );
      if (
        readable &&
        verifiedNativeTextureSourceReferences(
          readable.fileType,
          readable.content,
        ).includes(path)
      )
        source = {
          designId: readable.designId,
          fileId: readable.fileId,
          retained: false,
        };
    }
    if (!source)
      throw new DesignNativeTextureAssetError(
        "forbidden",
        "Native texture has no readable source binding.",
      );
    const read = source.retained
      ? await readRetainedNativeTexture(object, path)
      : await readDesignNativeTextureAsset(
          path,
          MAX_DESIGN_NATIVE_TEXTURE_BYTES,
        );
    if (
      read.mimeType !== parsed.mimeType ||
      createHash("sha256").update(read.bytes).digest("hex") !== object.sha256
    )
      throw new DesignNativeTextureAssetError(
        "mismatch",
        "Native texture bytes changed after registration.",
      );
    grants.push({
      id: parsed.id,
      path,
      sha256: object.sha256,
      providerUrl: object.providerUrl,
      sourceDesignId: source.designId,
      sourceFileId: source.fileId,
      retained: source.retained,
    });
  }
  return grants;
}

async function readRetainedNativeTexture(
  object: typeof schema.designNativeTextureObjects.$inferSelect,
  path: string,
) {
  // The caller has editor access to the exact retained binding. Provider byte
  // verification is still required before a history source can be restored.
  const { validateDesignNativeTextureBytes } =
    await import("./design-native-texture-assets");
  const parsed = parseDesignNativeTexturePath(path)!;
  let uploaded;
  try {
    uploaded = await readDesignNativeTextureProvider(
      object.providerUrl,
      object.uploaderEmail,
      MAX_DESIGN_NATIVE_TEXTURE_BYTES,
    );
  } catch (error) {
    if (error instanceof NativeTextureProviderError)
      throw new DesignNativeTextureAssetError(error.code, error.message);
    throw error;
  }
  if (
    uploaded.mimeType !== parsed.mimeType ||
    uploaded.data.byteLength !== object.byteLength ||
    validateDesignNativeTextureBytes(parsed.mimeType, uploaded.data) !==
      object.sha256
  )
    throw new DesignNativeTextureAssetError(
      "mismatch",
      "Retained native texture bytes changed.",
    );
  return { mimeType: parsed.mimeType, bytes: uploaded.data };
}

export async function bindNativeTextureGrantsInSourceTransaction(
  tx: DbExec,
  destination: { designId: string; fileId: string },
  grants: readonly NativeTextureTransferGrant[],
): Promise<void> {
  for (const grant of grants) {
    const object = await tx.execute({
      sql: `SELECT id FROM design_native_texture_objects
        WHERE id = ? AND provider_url = ? AND sha256 = ? FOR UPDATE`,
      args: [grant.id, grant.providerUrl, grant.sha256],
    });
    if (object.rows.length !== 1)
      throw new DesignNativeTextureAssetError(
        "unavailable",
        "Native texture object changed during source save.",
      );
    if (grant.retained) {
      if (
        grant.sourceDesignId !== destination.designId ||
        grant.sourceFileId !== destination.fileId
      )
        throw new DesignNativeTextureAssetError(
          "forbidden",
          "A retained binding cannot grant a different file.",
        );
      const retained = await tx.execute({
        sql: `SELECT asset_id FROM design_native_texture_bindings
          WHERE asset_id = ? AND design_id = ? AND file_id = ? FOR SHARE`,
        args: [grant.id, grant.sourceDesignId, grant.sourceFileId],
      });
      if (retained.rows.length !== 1)
        throw new DesignNativeTextureAssetError(
          "unavailable",
          "Retained native texture binding changed.",
        );
    } else {
      const sourceMetadata = await tx.execute({
        sql: `SELECT binding.asset_id, file.file_type,
          octet_length(file.content) AS byte_length
        FROM design_native_texture_bindings binding
        JOIN design_files file ON file.id = binding.file_id
          AND file.design_id = binding.design_id
        WHERE binding.asset_id = ? AND binding.design_id = ?
          AND binding.file_id = ? FOR SHARE OF binding, file`,
        args: [grant.id, grant.sourceDesignId, grant.sourceFileId],
      });
      const metadata = sourceMetadata.rows[0] as
        | { file_type?: unknown; byte_length?: unknown }
        | undefined;
      if (!metadata || typeof metadata.file_type !== "string")
        throw new DesignNativeTextureAssetError(
          "unavailable",
          "Native texture source changed during copy.",
        );
      const byteLength = metadata.byte_length;
      if (typeof byteLength !== "number" || !Number.isSafeInteger(byteLength))
        throw new DesignNativeTextureAssetError(
          "unavailable",
          "Native texture source length is unreadable.",
        );
      if (byteLength < 0 || byteLength > 4_000_000)
        throw new DesignNativeTextureAssetError(
          "limit",
          "Native texture source exceeds the bounded parser size.",
        );
      const source = await tx.execute({
        sql: `SELECT file.file_type, file.content
        FROM design_native_texture_bindings binding
        JOIN design_files file ON file.id = binding.file_id
          AND file.design_id = binding.design_id
        WHERE binding.asset_id = ? AND binding.design_id = ?
          AND binding.file_id = ?
          AND octet_length(file.content) <= 4000000
        FOR SHARE OF binding, file`,
        args: [grant.id, grant.sourceDesignId, grant.sourceFileId],
      });
      const row = source.rows[0] as
        | { file_type?: unknown; content?: unknown }
        | undefined;
      if (
        !row ||
        typeof row.file_type !== "string" ||
        typeof row.content !== "string" ||
        Buffer.byteLength(row.content, "utf8") !== byteLength ||
        !verifiedNativeTextureSourceReferences(
          row.file_type,
          row.content,
        ).includes(grant.path)
      )
        throw new DesignNativeTextureAssetError(
          "unavailable",
          "Native texture source changed during copy.",
        );
    }
    const boundCount = await tx.execute({
      sql: `SELECT count(*)::int AS count FROM design_native_texture_bindings
        WHERE asset_id = ?`,
      args: [grant.id],
    });
    const alreadyBound = await tx.execute({
      sql: `SELECT asset_id FROM design_native_texture_bindings
        WHERE asset_id = ? AND design_id = ? AND file_id = ?`,
      args: [grant.id, destination.designId, destination.fileId],
    });
    const count = (boundCount.rows[0] as { count?: unknown } | undefined)
      ?.count;
    if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0)
      throw new DesignNativeTextureAssetError(
        "unavailable",
        "Native texture binding count is unreadable.",
      );
    if (alreadyBound.rows.length === 0 && count >= MAX_BINDINGS)
      throw new DesignNativeTextureAssetError(
        "limit",
        "Native texture has too many bound files.",
      );
    await tx.execute({
      sql: `INSERT INTO design_native_texture_bindings(asset_id, design_id, file_id)
        VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
      args: [grant.id, destination.designId, destination.fileId],
    });
  }
}
