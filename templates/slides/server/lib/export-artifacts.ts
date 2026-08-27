import {
  deletePrivateBlob,
  putPrivateBlob,
  readPrivateBlob,
} from "@agent-native/core/private-blob";
import { signShortLivedToken } from "@agent-native/core/server";
import { and, eq, gte, lte } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb } from "../db/index.js";
import { exportArtifacts } from "../db/schema.js";

export const EXPORT_DOWNLOAD_TTL_SECONDS = 10 * 60;
const EXPIRED_ARTIFACT_GC_BATCH_SIZE = 20;

const blobHandleSchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  opaque: z.literal(true),
  encrypted: z.boolean(),
  mimeType: z.string().min(1).optional(),
  size: z.number().int().nonnegative().optional(),
  createdAt: z.string().datetime().optional(),
  metadata: z
    .record(
      z.string(),
      z.union([z.string(), z.number(), z.boolean(), z.null()]),
    )
    .optional(),
});

const artifactSchema = z.object({
  id: z.string().min(1),
  blobHandle: z.string().min(1),
  filename: z.string().regex(/^[A-Za-z0-9_.-]+$/),
  mimeType: z.string().min(1).max(200),
  expiresAt: z.string().datetime(),
});

export interface ExportArtifactDownload {
  downloadUrl: string;
  filename: string;
  expiresAt: string;
}

interface StoredExportArtifact {
  id: string;
  filename: string;
  mimeType: string;
  expiresAt: string;
  blobHandle: z.infer<typeof blobHandleSchema>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseStoredArtifact(row: unknown): StoredExportArtifact {
  const artifact = artifactSchema.parse(row);
  const blobHandle = blobHandleSchema.parse(JSON.parse(artifact.blobHandle));
  return { ...artifact, blobHandle };
}

export async function collectExpiredExportArtifacts(): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(exportArtifacts)
    .where(lte(exportArtifacts.expiresAt, nowIso()))
    .limit(EXPIRED_ARTIFACT_GC_BATCH_SIZE);

  for (const row of rows) {
    const artifact = parseStoredArtifact(row);
    const deletion = await deletePrivateBlob(artifact.blobHandle);
    if (!deletion.deleted) {
      throw new Error(
        `Could not delete expired export artifact ${artifact.id}`,
      );
    }
    await db.delete(exportArtifacts).where(eq(exportArtifacts.id, artifact.id));
  }
}

export async function createExportArtifact(input: {
  data: Uint8Array;
  filename: string;
  mimeType: string;
  ownerEmail: string;
  downloadBaseUrl: string;
}): Promise<ExportArtifactDownload | null> {
  await collectExpiredExportArtifacts();

  const filename = artifactSchema.shape.filename.parse(input.filename);
  const mimeType = artifactSchema.shape.mimeType.parse(input.mimeType);
  const handle = await putPrivateBlob({
    data: input.data,
    filename,
    mimeType,
    ownerEmail: input.ownerEmail,
  });
  if (!handle) return null;

  const id = `export-${nanoid()}`;
  const expiresAt = new Date(
    Date.now() + EXPORT_DOWNLOAD_TTL_SECONDS * 1000,
  ).toISOString();
  await getDb()
    .insert(exportArtifacts)
    .values({
      id,
      blobHandle: JSON.stringify(handle),
      filename,
      mimeType,
      expiresAt,
    });

  const token = signShortLivedToken({
    resourceId: id,
    ttlSeconds: EXPORT_DOWNLOAD_TTL_SECONDS,
  });
  const url = new URL(
    `${input.downloadBaseUrl.replace(/\/+$/, "")}/api/exports/download`,
  );
  url.searchParams.set("artifact", id);
  url.searchParams.set("token", token);
  return { downloadUrl: url.toString(), filename, expiresAt };
}

export async function readExportArtifact(
  id: string,
): Promise<StoredExportArtifact | null> {
  const rows = await getDb()
    .select()
    .from(exportArtifacts)
    .where(
      and(eq(exportArtifacts.id, id), gte(exportArtifacts.expiresAt, nowIso())),
    )
    .limit(1);
  const row = rows[0];
  return row ? parseStoredArtifact(row) : null;
}

export async function readExportArtifactBytes(id: string): Promise<{
  filename: string;
  mimeType: string;
  data: Uint8Array;
} | null> {
  const artifact = await readExportArtifact(id);
  if (!artifact) return null;
  const blob = await readPrivateBlob(artifact.blobHandle);
  return {
    filename: artifact.filename,
    mimeType: artifact.mimeType,
    data: blob.data,
  };
}
