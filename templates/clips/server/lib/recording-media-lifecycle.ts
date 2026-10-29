import { createHash, randomUUID } from "node:crypto";

import type { FileUploadResult } from "@agent-native/core/file-upload";
import type { PrivateBlobHandle } from "@agent-native/core/private-blob";
import {
  decryptSecretValue,
  encryptSecretValue,
} from "@agent-native/core/secrets";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { bigint, pgTable, text } from "drizzle-orm/pg-core";

import { getDb, schema } from "../db/index.js";
import { recordingMediaUrls } from "./recording-media-cleanup.js";
import {
  withMediaUploadCheckpoint,
  type ProducedMediaReference,
} from "./recording-media-production-context.js";
import type { BuilderUploadProvenance } from "./recording-media-production-context.js";
import {
  builderObjectKey,
  type MediaCleanupScope,
} from "./recording-media-provider.js";
import { ownerEmailMatches } from "./recordings.js";

export type CleanupTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];
export interface CleanupPayload {
  builderUpload?: BuilderUploadProvenance;
  acceptedAt?: number;
  needsDeleteRetry?: boolean;
  urls: string[];
  storageProvider?: string;
  storageId?: string | null;
  blob?: Record<string, unknown>;
  registeredUrl?: string;
  credentialRef?: string | null;
  storageFingerprint?: string | null;
}
export interface CleanupManifest {
  stateKeys: string[];
  contextFootageIds: string[];
  unresolvedProducer: boolean;
  scope?: MediaCleanupScope;
  recoveryStates?: Array<{ key: string; value: unknown }>;
}
const stateTable = pgTable("application_state", {
  sessionId: text("session_id").notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export function sealCleanupPayload(value: unknown): string {
  return encryptSecretValue(JSON.stringify(value));
}
export function openCleanupPayload<T>(value: string): T {
  return JSON.parse(decryptSecretValue(value)) as T;
}

export async function journalPrivateBlob(
  tx: CleanupTransaction,
  input: {
    recordingId: string;
    ownerEmail: string;
    blob: Record<string, unknown>;
  },
): Promise<void> {
  if (
    typeof input.blob.id !== "string" ||
    typeof input.blob.provider !== "string"
  )
    throw new Error("Media blob identity is unreadable");
  const table = schema.recordingMediaCleanupObjects;
  const objectKey = `private-blob:${createHash("sha256")
    .update(input.blob.provider + "\n" + input.blob.id)
    .digest("hex")}`;
  await tx
    .insert(table)
    .values({
      recordingId: input.recordingId,
      objectKey,
      ownerEmail: input.ownerEmail,
      provider: "private_blob",
      payload: sealCleanupPayload({ urls: [], blob: input.blob }),
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoNothing();
}

function collectUrls(value: unknown, urls: Set<string>): void {
  if (typeof value === "string") {
    if (
      URL.canParse(value) &&
      ["https:", "http:"].includes(new URL(value).protocol)
    )
      urls.add(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectUrls(item, urls);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (
        [
          "url",
          "videoUrl",
          "thumbnailUrl",
          "animatedThumbnailUrl",
          "filmstripUrl",
          "imageUrl",
          "baseImageUrl",
          "sourceUrl",
          "compressedUrl",
          "outputUrl",
          "storageUrl",
        ].includes(key)
      )
        collectUrls(item, urls);
      else if (item && typeof item === "object") collectUrls(item, urls);
    }
  }
}

function knownExternalMedia(raw: string): boolean {
  if (!URL.canParse(raw)) return false;
  const url = new URL(raw);
  if (url.protocol !== "https:") return false;
  return (
    (["loom.com", "www.loom.com"].includes(url.hostname) &&
      /^\/(embed|share)\//.test(url.pathname)) ||
    (url.hostname === "cdn.loom.com" &&
      url.pathname.startsWith("/sessions/thumbnails/")) ||
    (["youtube.com", "www.youtube.com", "www.youtube-nocookie.com"].includes(
      url.hostname,
    ) &&
      url.pathname.startsWith("/embed/")) ||
    (url.hostname === "i.ytimg.com" && url.pathname.startsWith("/vi/"))
  );
}

export async function resolveBuilderUploadCustody(
  tx: CleanupTransaction,
  input: {
    recordingId: string;
    ownerEmail: string;
    objectKey: string;
    proof: BuilderUploadProvenance;
  },
): Promise<BuilderUploadProvenance> {
  const proof = input.proof;
  if (
    proof.objectKey !== input.objectKey ||
    proof.recordingId !== input.recordingId ||
    !proof.producerId
  )
    throw new Error("Upload provenance does not match recording media");
  if (proof.ownerEmail === input.ownerEmail) return proof;
  const custody = await tx
    .select({ id: schema.recordingMediaProducers.id })
    .from(schema.recordingMediaProducers)
    .where(
      and(
        eq(schema.recordingMediaProducers.id, proof.producerId),
        eq(schema.recordingMediaProducers.recordingId, input.recordingId),
        eq(schema.recordingMediaProducers.ownerEmail, input.ownerEmail),
      ),
    )
    .limit(1);
  if (!custody.length)
    throw new Error("Upload provenance custody is unavailable");
  return { ...proof, ownerEmail: input.ownerEmail };
}

export async function journalMediaObject(
  tx: CleanupTransaction,
  input: {
    recordingId: string;
    ownerEmail: string;
    url: string;
    provider?: string;
    storageId?: string | null;
    scope?: MediaCleanupScope;
    builderUpload?: BuilderUploadProvenance;
  },
): Promise<void> {
  const rows = await tx
    .select({ key: sql<string | null>`clips_media_object_key(${input.url})` })
    .from(schema.recordingMediaCleanups)
    .where(
      and(
        eq(schema.recordingMediaCleanups.id, input.recordingId),
        eq(schema.recordingMediaCleanups.ownerEmail, input.ownerEmail),
      ),
    )
    .limit(1);
  const key = rows.shift()?.key ?? null;
  if (!key) throw new Error("Media identity is unreadable");
  const builderUpload = input.builderUpload
    ? await resolveBuilderUploadCustody(tx, {
        ...input,
        objectKey: key,
        proof: input.builderUpload,
      })
    : undefined;
  const table = schema.recordingMediaCleanupObjects;
  const previousRows = await tx
    .select()
    .from(table)
    .where(
      and(eq(table.recordingId, input.recordingId), eq(table.objectKey, key)),
    )
    .for("update")
    .limit(1);
  const previous = previousRows.length ? previousRows[0] : null;
  const oldPayload = previous?.payload
    ? openCleanupPayload<CleanupPayload>(previous.payload)
    : null;
  const payload: CleanupPayload = {
    ...oldPayload,
    ...input.scope,
    ...(builderUpload ? { builderUpload } : {}),
    urls: [...new Set([...(oldPayload?.urls ?? []), input.url])],
    ...(input.provider ? { storageProvider: input.provider } : {}),
    ...(input.storageId ? { storageId: input.storageId } : {}),
  };
  const provider = key.startsWith("builder:")
    ? "builder"
    : key.startsWith("s3:")
      ? "s3"
      : knownExternalMedia(input.url)
        ? "external"
        : (input.provider ?? "unclassified");
  await tx
    .insert(table)
    .values({
      recordingId: input.recordingId,
      objectKey: key,
      ownerEmail: input.ownerEmail,
      provider,
      payload: provider === "external" ? null : sealCleanupPayload(payload),
      phase: provider === "external" ? "external" : "pending",
      updatedAt: new Date().toISOString(),
    })
    .onConflictDoUpdate({
      target: [table.recordingId, table.objectKey],
      set: {
        payload: provider === "external" ? null : sealCleanupPayload(payload),
        phase: provider === "external" ? "external" : "pending",
        reason: null,
        updatedAt: new Date().toISOString(),
      },
    });
}

type CleanupRecording = Pick<
  typeof schema.recordings.$inferSelect,
  | "id"
  | "ownerEmail"
  | "orgId"
  | "storageMode"
  | "videoUrl"
  | "thumbnailUrl"
  | "animatedThumbnailUrl"
  | "filmstripUrl"
  | "imageUrl"
  | "baseImageUrl"
  | "editsJson"
  | "kind"
  | "status"
  | "organizationId"
>;

export async function captureRecordingMediaCleanup(
  tx: CleanupTransaction,
  recording: CleanupRecording,
  contextFootageIds: string[] = [],
  scope: MediaCleanupScope = {},
): Promise<void> {
  const now = new Date().toISOString();
  const ownerEmail = recording.ownerEmail.toLowerCase();
  const allowance =
    recording.storageMode === "hosted"
      ? (
          await tx
            .select({ userId: schema.hostedClipAllowances.userId })
            .from(schema.hostedClipAllowances)
            .where(eq(schema.hostedClipAllowances.recordingId, recording.id))
            .limit(1)
        )[0]
      : null;
  const keys = [
    "recording-upload-",
    "recording-recovery-policy-",
    "recording-compression-",
    "recording-builder-compression-",
    "recording-blob-",
    "recording-thumbnail-asset-",
    "recording-thumbnail-lease-",
    "agent-task-recording-",
  ].map((prefix) => prefix + recording.id);
  const escapedId = recording.id.replace(/[!%_]/g, "!$&");
  const states = await tx
    .select({ key: stateTable.key, value: stateTable.value })
    .from(stateTable)
    .where(
      and(
        eq(stateTable.sessionId, ownerEmail),
        or(
          inArray(stateTable.key, keys),
          sql`${stateTable.key} LIKE ${`resumable-session-${escapedId}%`} ESCAPE '!'`,
        ),
      ),
    )
    .limit(100);
  if (states.length === 100)
    throw new Error("Too many media recovery records to capture safely");
  const urls = new Set(recordingMediaUrls(recording));
  let unresolvedProducer = false;
  for (const state of states) {
    const value: unknown = JSON.parse(state.value);
    collectUrls(value, urls);
    if (
      state.key.startsWith("recording-builder-compression-") &&
      !(
        value &&
        typeof value === "object" &&
        "status" in value &&
        (value.status === "ready" || value.status === "skipped-too-large")
      )
    )
      unresolvedProducer = true;
    if (
      state.key.startsWith("resumable-session-") &&
      !(
        value &&
        typeof value === "object" &&
        "providerClosed" in value &&
        value.providerClosed === true
      )
    )
      unresolvedProducer = true;
  }
  const frames = await tx
    .select({
      id: schema.recordingAgentFrames.id,
      url: schema.recordingAgentFrames.storageUrl,
      provider: schema.recordingAgentFrames.storageProvider,
      storageId: schema.recordingAgentFrames.storageId,
    })
    .from(schema.recordingAgentFrames)
    .where(eq(schema.recordingAgentFrames.recordingId, recording.id));
  const diagnostics = await tx
    .select({ blob: schema.recordingBrowserDiagnostics.appActivityBlobJson })
    .from(schema.recordingBrowserDiagnostics)
    .where(eq(schema.recordingBrowserDiagnostics.recordingId, recording.id))
    .limit(1);
  const manifest: CleanupManifest = {
    stateKeys: states.map((s) => s.key),
    contextFootageIds,
    scope,
    unresolvedProducer,
    recoveryStates: states
      .filter(
        (state) =>
          state.key.startsWith("resumable-session-") ||
          state.key.startsWith("recording-builder-compression-") ||
          state.key.startsWith("recording-compression-"),
      )
      .map((state) => ({
        key: state.key,
        value: JSON.parse(state.value) as unknown,
      })),
  };
  await tx.insert(schema.recordingMediaCleanups).values({
    id: recording.id,
    ownerEmail,
    orgId: recording.orgId ?? recording.organizationId,
    storageMode: recording.storageMode,
    allowanceUserId: allowance?.userId,
    manifest: sealCleanupPayload(manifest),
    nextAttemptAt: now,
    createdAt: now,
    updatedAt: now,
  });
  for (const url of urls)
    await journalMediaObject(tx, {
      recordingId: recording.id,
      ownerEmail,
      url,
      scope,
    });
  for (const frame of frames)
    await journalMediaObject(tx, {
      recordingId: recording.id,
      ownerEmail,
      url: frame.url,
      provider: frame.provider,
      storageId: frame.storageId,
      scope,
    });
  if (diagnostics[0]?.blob) {
    const blob: unknown = JSON.parse(diagnostics[0].blob);
    if (!blob || typeof blob !== "object" || Array.isArray(blob))
      throw new Error("Media blob reference is unreadable");
    await journalPrivateBlob(tx, {
      recordingId: recording.id,
      ownerEmail,
      blob: blob as Record<string, unknown>,
    });
  }
  await tx
    .delete(schema.recordingAgentFrames)
    .where(eq(schema.recordingAgentFrames.recordingId, recording.id));
  await tx.delete(stateTable).where(
    and(
      eq(stateTable.sessionId, ownerEmail),
      inArray(
        stateTable.key,
        keys.filter(
          (key) =>
            !key.startsWith("recording-builder-compression-") &&
            !key.startsWith("recording-upload-"),
        ),
      ),
    ),
  );
  // Legacy inline chunks are bytes, not object references; do not copy them into the manifest.
  await tx
    .delete(stateTable)
    .where(
      and(
        eq(stateTable.sessionId, ownerEmail),
        sql`${stateTable.key} LIKE ${`recording-chunks-${escapedId}-%`} ESCAPE '!'`,
      ),
    );
}

export async function beginMediaProduction(input: {
  recordingId: string;
  ownerEmail: string;
  newRecording?: boolean;
}): Promise<string> {
  return getDb().transaction(async (tx) => {
    const recordings = await tx
      .select({ id: schema.recordings.id })
      .from(schema.recordings)
      .where(
        and(
          eq(schema.recordings.id, input.recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail),
        ),
      )
      .for("update")
      .limit(1);
    if (!recordings.length) {
      if (!input.newRecording)
        throw new Error("Recording deleted or not found");
      // guard:allow-unscoped — collision detection returns no foreign recording data to the caller.
      const collision = await tx
        .select({ id: schema.recordings.id })
        .from(schema.recordings)
        .where(eq(schema.recordings.id, input.recordingId))
        .limit(1);
      const deleted = await tx
        .select({ id: schema.recordingMediaCleanups.id })
        .from(schema.recordingMediaCleanups)
        .where(eq(schema.recordingMediaCleanups.id, input.recordingId))
        .limit(1);
      if (collision.length || deleted.length)
        throw new Error("Recording deleted or not found");
    }
    const now = new Date().toISOString(),
      id = randomUUID();
    await tx.insert(schema.recordingMediaProducers).values({
      id,
      recordingId: input.recordingId,
      ownerEmail: input.ownerEmail.trim().toLowerCase(),
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

export async function finishMediaProduction(
  id: string,
  output: ProducedMediaReference | null,
): Promise<void> {
  const table = schema.recordingMediaProducers;
  await getDb().transaction(async (tx) => {
    const rows = await tx
      .select({ payload: table.payload })
      .from(table)
      .where(eq(table.id, id))
      .for("update")
      .limit(1);
    const row = rows.shift();
    if (!row) throw new Error("Media producer not found");
    const previous = row.payload
      ? openCleanupPayload<ProducedMediaReference>(row.payload)
      : null;
    await tx
      .update(table)
      .set({
        status: "finished",
        payload: output
          ? sealCleanupPayload({
              ...(previous?.url === output.url ? previous : {}),
              ...output,
            })
          : row.payload,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(table.id, id));
  });
}

export async function withRecordingMediaProduction<
  T extends FileUploadResult | null,
>(
  input: {
    recordingId: string;
    ownerEmail: string;
    recordAsset?: boolean;
    newRecording?: boolean;
  },
  produce: () => Promise<T>,
): Promise<T> {
  const id = await beginMediaProduction(input);
  const table = schema.recordingMediaProducers;
  return withMediaUploadCheckpoint(
    async (output) => {
      await getDb()
        .update(table)
        .set({
          payload: sealCleanupPayload(output),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(table.id, id));
    },
    async () => {
      try {
        const result = await produce();
        const key =
          result?.provider === "builder" && input.recordAsset === false
            ? builderObjectKey(result.url)
            : null;
        await finishMediaProduction(
          id,
          result && key
            ? {
                ...result,
                builderUpload: {
                  recordingId: input.recordingId,
                  ownerEmail: input.ownerEmail.trim().toLowerCase(),
                  producerId: id,
                  objectKey: key,
                },
              }
            : result,
        );
        return result;
      } catch (error) {
        await getDb().transaction(async (tx) => {
          const rows = await tx
            .select({ payload: table.payload })
            .from(table)
            .where(eq(table.id, id))
            .for("update")
            .limit(1);
          const row = rows.shift();
          if (!row) throw new Error("Media producer not found");
          const output = row.payload
            ? openCleanupPayload<ProducedMediaReference>(row.payload)
            : null;
          await tx
            .update(table)
            .set({
              status: output?.uploadConfirmed ? "finished" : "uncertain",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(table.id, id));
        });
        throw error;
      }
    },
  );
}

export async function removeCapturedAppState(
  tx: CleanupTransaction,
  recordingId: string,
  ownerEmail: string,
  keys: string[],
): Promise<void> {
  if (keys.length)
    await tx
      .delete(stateTable)
      .where(
        and(
          eq(stateTable.sessionId, ownerEmail),
          inArray(stateTable.key, keys),
        ),
      );
  await tx
    .delete(stateTable)
    .where(
      and(
        eq(stateTable.sessionId, ownerEmail),
        eq(stateTable.key, `resumable-session-${recordingId}`),
      ),
    );
}

export async function withRecordingPrivateBlobProduction(
  input: { recordingId: string; ownerEmail: string },
  produce: () => Promise<PrivateBlobHandle | null>,
): Promise<PrivateBlobHandle | null> {
  const id = await beginMediaProduction(input);
  try {
    const blob = await produce();
    await getDb()
      .update(schema.recordingMediaProducers)
      .set({
        status: "finished",
        payload: blob
          ? sealCleanupPayload({ kind: "private_blob", blob })
          : null,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(schema.recordingMediaProducers.id, id));
    return blob;
  } catch (error) {
    await getDb()
      .update(schema.recordingMediaProducers)
      .set({ status: "uncertain", updatedAt: new Date().toISOString() })
      .where(eq(schema.recordingMediaProducers.id, id));
    throw error;
  }
}
