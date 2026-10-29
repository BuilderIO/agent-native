import { randomUUID } from "node:crypto";

import {
  deletePrivateBlob,
  type PrivateBlobHandle,
} from "@agent-native/core/private-blob";
import {
  readOrgMemberRole,
  runWithRequestContext,
} from "@agent-native/core/server";
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  isNotNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
} from "drizzle-orm";

import type { MediaCleanupSummary } from "../../shared/media-cleanup.js";
import { getDb, schema } from "../db/index.js";
import {
  journalMediaObject,
  journalPrivateBlob,
  openCleanupPayload,
  sealCleanupPayload,
  removeCapturedAppState,
  resolveBuilderUploadCustody,
  type CleanupPayload,
  type CleanupManifest,
  type CleanupTransaction,
} from "./recording-media-lifecycle.js";
import type { BuilderUploadProvenance } from "./recording-media-production-context.js";
import {
  deleteBuilderMediaForCleanup,
  type MediaCleanupStep,
} from "./recording-media-provider.js";
import { deleteS3MediaForCleanup } from "./s3-upload-provider.js";
import {
  adjustHostedClipRecordingBytes,
  getHostedClipRecordingAllowance,
  releaseHostedClipRecording,
} from "./video-storage.js";

const intents = schema.recordingMediaCleanups;
const objects = schema.recordingMediaCleanupObjects;
const producers = schema.recordingMediaProducers;
const LEASE_MS = 120_000;
const iso = () => new Date().toISOString();

export async function mediaCleanupSummary(
  id: string,
  ownerEmail: string,
): Promise<MediaCleanupSummary | null> {
  const found = await getDb()
    .select({
      id: intents.id,
      status: intents.status,
      reason: intents.reason,
      createdAt: intents.createdAt,
      updatedAt: intents.updatedAt,
    })
    .from(intents)
    .where(and(eq(intents.id, id), eq(intents.ownerEmail, ownerEmail)))
    .limit(1);
  const intent = found.shift();
  if (!intent) return null;
  const counts = await getDb()
    .select({ phase: objects.phase, count: sql<number>`count(*)::integer` })
    .from(objects)
    .where(and(eq(objects.recordingId, id), eq(objects.ownerEmail, ownerEmail)))
    .groupBy(objects.phase);
  let pending = 0,
    blocked = 0,
    deleted = 0,
    retained = 0,
    external = 0;
  for (const count of counts) {
    if (count.phase === "complete") deleted += count.count;
    else if (count.phase === "retained_shared") retained += count.count;
    else if (count.phase === "blocked") blocked += count.count;
    else if (count.phase === "external") external += count.count;
    else pending += count.count;
  }
  const status = intent.status;
  if (
    status !== "pending" &&
    status !== "blocked" &&
    status !== "complete" &&
    status !== "retained_shared"
  )
    throw new Error("Invalid cleanup state");
  return {
    ...intent,
    recordingId: id,
    status,
    pending,
    blocked,
    deleted,
    retained,
    external,
  };
}

async function claimObject(
  tx: CleanupTransaction,
  object: typeof objects.$inferSelect,
): Promise<boolean> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${`clips-media:${object.objectKey}`},0))`,
  );
  if (object.objectKey.startsWith("private-blob:")) {
    const payload = object.payload
      ? openCleanupPayload<CleanupPayload>(object.payload)
      : null;
    if (!payload?.blob) throw new Error("Media blob reference is unreadable");
    // guard:allow-unscoped — a shared private-blob handle must survive any one recording's deletion.
    const shared = await tx
      .select({ id: schema.recordingBrowserDiagnostics.recordingId })
      .from(schema.recordingBrowserDiagnostics)
      .where(
        sql`(${schema.recordingBrowserDiagnostics.appActivityBlobJson}::jsonb->>'provider')=${payload.blob.provider} AND (${schema.recordingBrowserDiagnostics.appActivityBlobJson}::jsonb->>'id')=${payload.blob.id}`,
      )
      .limit(1);
    if (!shared.length) {
      await tx
        .update(objects)
        .set({ deletionClaimed: true, updatedAt: iso() })
        .where(
          and(
            eq(objects.recordingId, object.recordingId),
            eq(objects.objectKey, object.objectKey),
          ),
        );
      return true;
    }
    await tx
      .update(objects)
      .set({
        phase: "retained_shared",
        reason: "shared_reference",
        updatedAt: iso(),
      })
      .where(
        and(
          eq(objects.recordingId, object.recordingId),
          eq(objects.objectKey, object.objectKey),
        ),
      );
    return false;
  }
  // guard:allow-unscoped — only a boolean leaves this cross-owner shared-object check.
  const referenceKeys = sql<
    string[]
  >`clips_recording_media_keys(${schema.recordings.videoUrl},${schema.recordings.thumbnailUrl},${schema.recordings.animatedThumbnailUrl},${schema.recordings.filmstripUrl},${schema.recordings.imageUrl},${schema.recordings.baseImageUrl},${schema.recordings.editsJson})`;
  const references = await tx
    .select({ keys: referenceKeys })
    .from(schema.recordings)
    .where(
      sql`${referenceKeys} && ARRAY[${object.objectKey},'unreadable:edits_json','unreadable:media_url']::text[]`,
    )
    .limit(1);
  // guard:allow-unscoped — frames can retain the same object independently of a recording column.
  const frames = await tx
    .select({
      key: sql<string>`clips_media_object_key(${schema.recordingAgentFrames.storageUrl})`,
    })
    .from(schema.recordingAgentFrames)
    .where(
      sql`clips_media_object_key(${schema.recordingAgentFrames.storageUrl}) IN (${object.objectKey},'unreadable:media_url')`,
    )
    .limit(1);
  if (
    references.some((row) =>
      row.keys.some((key) => key.startsWith("unreadable:")),
    ) ||
    frames.some((row) => row.key.startsWith("unreadable:"))
  ) {
    await tx
      .update(objects)
      .set({
        phase: "blocked",
        reason: "reference_unreadable",
        deletionClaimed: false,
        updatedAt: iso(),
      })
      .where(
        and(
          eq(objects.recordingId, object.recordingId),
          eq(objects.objectKey, object.objectKey),
        ),
      );
    return false;
  }
  if (references.length || frames.length) {
    await tx
      .update(objects)
      .set({
        phase: "retained_shared",
        reason: "shared_reference",
        deletionClaimed: false,
        updatedAt: iso(),
      })
      .where(
        and(
          eq(objects.recordingId, object.recordingId),
          eq(objects.objectKey, object.objectKey),
        ),
      );
    return false;
  }
  await tx
    .update(objects)
    .set({ deletionClaimed: true, updatedAt: iso() })
    .where(
      and(
        eq(objects.recordingId, object.recordingId),
        eq(objects.objectKey, object.objectKey),
      ),
    );
  return true;
}

export async function runRecordingMediaCleanup(
  id: string,
  options: { deadlineAt?: number; signal?: AbortSignal } = {},
): Promise<void> {
  const db = getDb(),
    now = iso(),
    leaseToken = randomUUID();
  const claimed = await db
    .update(intents)
    .set({
      leaseToken,
      leaseUntil: new Date(Date.now() + LEASE_MS).toISOString(),
      updatedAt: now,
      attempts: sql`${intents.attempts}+1`,
    })
    .where(
      and(
        eq(intents.id, id),
        ne(intents.status, "complete"),
        or(isNull(intents.leaseUntil), lte(intents.leaseUntil, now)),
      ),
    )
    .returning();
  const intent = claimed.shift();
  if (!intent) return;
  const deadlineAt = options.deadlineAt ?? Date.now() + 85_000;
  const assertLease = async () => {
    if (options.signal?.aborted || Date.now() >= deadlineAt)
      throw new Error("cleanup_deadline");
    const held = await db
      .update(intents)
      .set({ leaseUntil: new Date(Date.now() + LEASE_MS).toISOString() })
      .where(
        and(
          eq(intents.id, id),
          eq(intents.leaseToken, leaseToken),
          sql`${intents.leaseUntil}>${iso()}`,
        ),
      )
      .returning({ id: intents.id });
    if (!held.length) throw new Error("cleanup_lease_lost");
  };
  const underLease = async <T>(
    fn: (tx: CleanupTransaction) => Promise<T>,
  ): Promise<T> =>
    db.transaction(async (tx) => {
      const current = await tx
        .select({ id: intents.id })
        .from(intents)
        .where(
          and(
            eq(intents.id, id),
            eq(intents.leaseToken, leaseToken),
            sql`${intents.leaseUntil}>${iso()}`,
          ),
        )
        .for("update")
        .limit(1);
      if (!current.length) throw new Error("cleanup_lease_lost");
      return fn(tx);
    });
  let failureReason: string | null = null;
  let interrupted = false;
  try {
    await runWithRequestContext(
      {
        userEmail: intent.ownerEmail,
        ...(intent.orgId ? { orgId: intent.orgId } : {}),
      },
      async () => {
        if (
          intent.orgId &&
          !(await readOrgMemberRole(intent.orgId, intent.ownerEmail))
        ) {
          failureReason = "owner_unavailable";
          return;
        }
        const manifest = openCleanupPayload<CleanupManifest>(intent.manifest);
        await assertLease();
        await underLease(async (tx) => {
          const finished = await tx
            .select()
            .from(producers)
            .where(
              and(
                eq(producers.recordingId, id),
                eq(producers.ownerEmail, intent.ownerEmail),
                or(
                  eq(producers.status, "finished"),
                  eq(producers.status, "uncertain"),
                  and(
                    eq(producers.status, "active"),
                    isNotNull(producers.payload),
                    lte(
                      producers.updatedAt,
                      new Date(Date.now() - 600_000).toISOString(),
                    ),
                  ),
                ),
              ),
            )
            .limit(100);
          for (const producer of finished) {
            if (producer.payload) {
              const output = openCleanupPayload<{
                url: string;
                provider: string;
                id?: string;
                kind?: string;
                blob?: Record<string, unknown>;
                storageFingerprint?: string;
                builderUpload?: BuilderUploadProvenance;
              }>(producer.payload);
              if (output.kind === "private_blob" && output.blob)
                await journalPrivateBlob(tx, {
                  recordingId: id,
                  ownerEmail: intent.ownerEmail,
                  blob: output.blob,
                });
              else
                await journalMediaObject(tx, {
                  recordingId: id,
                  ownerEmail: intent.ownerEmail,
                  url: output.url,
                  provider: output.provider,
                  storageId: output.id ?? null,
                  ...(output.builderUpload
                    ? { builderUpload: output.builderUpload }
                    : {}),
                  scope: {
                    ...manifest.scope,
                    storageFingerprint: output.storageFingerprint ?? null,
                  },
                });
            }
            await tx
              .update(producers)
              .set(
                producer.status === "finished"
                  ? { status: "journaled", payload: null, updatedAt: iso() }
                  : { status: "uncertain_journaled", updatedAt: iso() },
              )
              .where(eq(producers.id, producer.id));
          }
        });
        const work = await db
          .select()
          .from(objects)
          .where(
            and(
              eq(objects.recordingId, id),
              eq(objects.ownerEmail, intent.ownerEmail),
              notInArray(objects.phase, ["complete", "external"]),
            ),
          )
          .orderBy(asc(objects.attempts), asc(objects.updatedAt))
          .limit(10);
        for (const object of work) {
          if (Date.now() + 45_000 > deadlineAt || options.signal?.aborted)
            break;
          await assertLease();
          if (!(await underLease((tx) => claimObject(tx, object)))) continue;
          if (object.attempts >= 12) {
            await underLease((tx) =>
              tx
                .update(objects)
                .set({
                  phase: "blocked",
                  reason: "retry_exhausted",
                  updatedAt: iso(),
                })
                .where(
                  and(
                    eq(objects.recordingId, id),
                    eq(objects.objectKey, object.objectKey),
                  ),
                ),
            );
            continue;
          }
          let currentPhase = object.phase;
          const payload = object.payload
            ? openCleanupPayload<CleanupPayload>(object.payload)
            : null;
          if (!payload) {
            failureReason = "manifest_unreadable";
            break;
          }
          const checkpoint = async (step: MediaCleanupStep) => {
            await assertLease();
            currentPhase = step.phase;
            await underLease((tx) =>
              tx
                .update(objects)
                .set({
                  phase: step.phase,
                  lastProviderPhase: step.phase,
                  reason: step.reason ?? null,
                  ...(step.payload
                    ? { payload: sealCleanupPayload(step.payload) }
                    : {}),
                  httpStatus: step.httpStatus,
                  servingStatus: step.servingStatus,
                  updatedAt: iso(),
                })
                .where(
                  and(
                    eq(objects.recordingId, id),
                    eq(objects.objectKey, object.objectKey),
                  ),
                ),
            );
          };
          let result: MediaCleanupStep;
          try {
            const proof = payload.builderUpload;
            if (proof)
              payload.builderUpload = await underLease((tx) =>
                resolveBuilderUploadCustody(tx, {
                  recordingId: id,
                  ownerEmail: intent.ownerEmail,
                  objectKey: object.objectKey,
                  proof,
                }),
              );
            if (object.provider === "builder")
              result = await deleteBuilderMediaForCleanup(
                {
                  recordingId: id,
                  ownerEmail: intent.ownerEmail,
                  objectKey: object.objectKey,
                  phase: object.lastProviderPhase ?? object.phase,
                  payload,
                },
                checkpoint,
              );
            else if (object.provider === "s3" && !payload.storageFingerprint)
              result = {
                phase: "blocked",
                reason: "storage_binding_unavailable",
              };
            else if (object.provider === "s3") {
              const [url] = payload.urls;
              if (!url)
                result = { phase: "blocked", reason: "manifest_unreadable" };
              else
                result = await deleteS3MediaForCleanup(
                  url,
                  {
                    storageMode:
                      intent.storageMode === "hosted" ? "hosted" : "own",
                    recordingId: id,
                    objectKey: object.objectKey,
                    fingerprint: payload.storageFingerprint ?? null,
                  },
                  async (fingerprint) =>
                    checkpoint({
                      phase: "delete_sent",
                      payload: { ...payload, storageFingerprint: fingerprint },
                    }),
                );
            } else if (object.provider === "private_blob" && payload.blob) {
              await checkpoint({ phase: "delete_sent" });
              const removed = await deletePrivateBlob(
                payload.blob as unknown as PrivateBlobHandle,
              );
              result = removed.deleted
                ? {
                    phase: "blocked",
                    reason: "private_blob_confirmation_unavailable",
                  }
                : { phase: "pending", reason: "delete_unconfirmed" };
            } else
              result = { phase: "blocked", reason: "unclassified_provider" };
          } catch {
            result = { phase: "pending", reason: "provider_unavailable" };
          }
          await assertLease();
          await underLease((tx) =>
            tx
              .update(objects)
              .set({
                phase: result.phase === "pending" ? currentPhase : result.phase,
                reason: result.reason ?? null,
                httpStatus: result.httpStatus,
                servingStatus: result.servingStatus,
                ...(result.payload
                  ? { payload: sealCleanupPayload(result.payload) }
                  : {}),
                ...(result.phase === "complete" ? { payload: null } : {}),
                attempts: sql`${objects.attempts}+1`,
                updatedAt: iso(),
              })
              .where(
                and(
                  eq(objects.recordingId, id),
                  eq(objects.objectKey, object.objectKey),
                ),
              ),
          );
          if (result.phase !== "complete")
            console.warn("[clips] media cleanup remains unconfirmed", {
              recordingId: id,
              provider: object.provider,
              phase: result.phase,
              reason: result.reason ?? "unconfirmed",
              httpStatus: result.httpStatus,
            });
        }
        const active = await db
          .select({ id: producers.id })
          .from(producers)
          .where(
            and(
              eq(producers.recordingId, id),
              eq(producers.ownerEmail, intent.ownerEmail),
              ne(producers.status, "journaled"),
            ),
          )
          .limit(1);
        if (manifest.unresolvedProducer || active.length)
          failureReason = "producer_unresolved";
        const summary = await mediaCleanupSummary(id, intent.ownerEmail);
        if (!summary) throw new Error("cleanup_missing");
        if (
          !failureReason &&
          !summary.pending &&
          !summary.blocked &&
          !summary.retained
        ) {
          if (intent.allowanceUserId && !intent.accountingSettled) {
            const allowance = await getHostedClipRecordingAllowance({
              recordingId: id,
              userId: intent.allowanceUserId,
            });
            if (!allowance) {
              failureReason = "accounting_unavailable";
              return;
            }
            if (allowance.status === "reserved")
              await releaseHostedClipRecording({
                recordingId: id,
                userId: intent.allowanceUserId,
              });
            else if (allowance.status === "consumed") {
              const adjustment = await adjustHostedClipRecordingBytes({
                recordingId: id,
                userId: intent.allowanceUserId,
                retainedBytes: 0,
              });
              if (!adjustment.ok) {
                failureReason = "accounting_unavailable";
                return;
              }
            }
          }
          await assertLease();
          await underLease(async (tx) => {
            await removeCapturedAppState(
              tx,
              id,
              intent.ownerEmail,
              manifest.stateKeys,
            );
            await tx
              .update(intents)
              .set({
                status: "complete",
                reason: null,
                accountingSettled: true,
                manifest: sealCleanupPayload({
                  stateKeys: [],
                  contextFootageIds: [],
                  unresolvedProducer: false,
                }),
                updatedAt: iso(),
              })
              .where(
                and(eq(intents.id, id), eq(intents.leaseToken, leaseToken)),
              );
          });
        } else {
          const blocked = await db
            .select({ reason: objects.reason })
            .from(objects)
            .where(
              and(eq(objects.recordingId, id), eq(objects.phase, "blocked")),
            )
            .limit(1);
          await db
            .update(intents)
            .set({
              status:
                failureReason || summary.blocked
                  ? "blocked"
                  : summary.pending
                    ? "pending"
                    : "retained_shared",
              reason:
                failureReason ??
                blocked.shift()?.reason ??
                (summary.retained ? "shared_reference" : null),
              updatedAt: iso(),
            })
            .where(and(eq(intents.id, id), eq(intents.leaseToken, leaseToken)));
        }
      },
    );
  } catch (error) {
    interrupted =
      error instanceof Error &&
      ["cleanup_deadline", "cleanup_lease_lost"].includes(error.message);
    failureReason = "cleanup_interrupted";
  } finally {
    const delay = interrupted
      ? 30_000
      : Math.min(3_600_000, 30_000 * 2 ** Math.min(intent.attempts, 7));
    await db
      .update(intents)
      .set({
        leaseToken: null,
        leaseUntil: null,
        nextAttemptAt: new Date(Date.now() + delay).toISOString(),
        ...(failureReason
          ? {
              status: interrupted ? "pending" : "blocked",
              reason: failureReason,
            }
          : {}),
        updatedAt: iso(),
      })
      .where(and(eq(intents.id, id), eq(intents.leaseToken, leaseToken)));
  }
}

export async function runRecordingMediaCleanupSweep(options: {
  deadlineAt: number;
  signal?: AbortSignal;
}): Promise<void> {
  const now = iso();
  // guard:allow-unscoped — the worker scans only durable, explicitly requested deletion intents.
  const due = await getDb()
    .select({ id: intents.id })
    .from(intents)
    .where(
      and(
        inArray(intents.status, ["pending", "blocked", "retained_shared"]),
        lte(intents.nextAttemptAt, now),
        or(isNull(intents.leaseUntil), lte(intents.leaseUntil, now)),
      ),
    )
    .orderBy(asc(intents.nextAttemptAt))
    .limit(5);
  for (const intent of due) {
    if (options.signal?.aborted || Date.now() + 45_000 > options.deadlineAt)
      return;
    await runRecordingMediaCleanup(intent.id, options);
  }
}
