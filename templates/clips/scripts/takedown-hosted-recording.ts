import { randomUUID } from "node:crypto";

import {
  insertAuditEvent,
  type AuditVisibility,
} from "@agent-native/core/audit";
import { closeDbExec, getDbExec } from "@agent-native/core/db";
import { loadEnv } from "@agent-native/core/scripts";
import { runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";

import { getDb, schema } from "../server/db/index.js";
import {
  deleteStoredMediaUrl,
  recordingMediaUrls,
} from "../server/lib/recording-media-cleanup.js";
import { ownerEmailMatches } from "../server/lib/recordings.js";
import { abortRecordingResumableSession } from "../server/lib/resumable-upload-cleanup.js";
import { isS3ObjectUrlBoundToRecording } from "../server/lib/s3-upload-provider.js";
import {
  adjustHostedClipRecordingBytes,
  getHostedClipRecordingAllowance,
  releaseHostedClipRecording,
} from "../server/lib/video-storage.js";

type RecordingRow = {
  id: string;
  owner_email: string;
  org_id: string | null;
  storage_mode: string | null;
};

function requiredArgument(flag: string): string {
  const index = process.argv.indexOf(flag);
  const value = index >= 0 ? process.argv[index + 1]?.trim() : "";
  if (!value || value.startsWith("--")) {
    throw new Error(
      "Usage: pnpm exec tsx scripts/takedown-hosted-recording.ts --recording-id <id> --actor <email> --reason <reason>",
    );
  }
  return value;
}

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function writeAudit(input: {
  actorEmail: string;
  ownerEmail: string;
  orgId: string | null;
  recordingId: string;
  reason: string;
  status: "success" | "error";
  summary: string;
  cleanupFailures?: number;
}): Promise<void> {
  const event: Parameters<typeof insertAuditEvent>[0] & { app: string } = {
    id: randomUUID(),
    createdAt: Date.now(),
    action: "clips-hosted-recording-takedown",
    caller: "clips-hosted-takedown-script",
    actorKind: "human",
    actorEmail: input.actorEmail,
    orgId: input.orgId,
    threadId: null,
    turnId: null,
    targetType: "recording",
    targetId: input.recordingId,
    status: input.status,
    summary: input.summary,
    input: JSON.stringify({
      reason: input.reason,
      cleanupFailures: input.cleanupFailures ?? 0,
    }),
    errorCode: input.status === "error" ? "hosted_takedown_incomplete" : null,
    ownerEmail: input.ownerEmail,
    visibility: (input.orgId ? "admins" : "private") as AuditVisibility,
    app: "clips",
  };
  await insertAuditEvent(event);
}

async function main(): Promise<void> {
  const recordingId = requiredArgument("--recording-id");
  const actorEmail = requiredArgument("--actor").toLowerCase();
  const reason = requiredArgument("--reason").slice(0, 1000);
  if (!validEmail(actorEmail)) {
    throw new Error("--actor must be an operator email address.");
  }

  const result = await getDbExec().execute({
    sql: `SELECT id, owner_email, org_id, storage_mode
      FROM recordings
      WHERE id = ?
      LIMIT 1`,
    args: [recordingId],
  });
  const recording = result.rows[0] as RecordingRow | undefined;
  if (!recording) throw new Error(`Recording not found: ${recordingId}`);
  if (!recording.owner_email) {
    throw new Error("Recording owner is missing; takedown was not started.");
  }
  if (recording.storage_mode !== "hosted") {
    throw new Error("This operator path only handles hosted Clips recordings.");
  }

  await runWithRequestContext(
    {
      userEmail: recording.owner_email,
      orgId: recording.org_id ?? undefined,
    },
    async () => {
      let auditWritten = false;
      try {
        const db = getDb();
        const [current] = await db
          .select()
          .from(schema.recordings)
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(
                schema.recordings.ownerEmail,
                recording.owner_email,
              ),
            ),
          )
          .limit(1);
        if (!current) {
          throw new Error("Recording could not be loaded for hosted takedown.");
        }
        if (current.storageMode !== "hosted") {
          throw new Error("Recording storage mode changed before takedown.");
        }
        if (current.kind === "image") {
          throw new Error("Hosted Clips takedown does not handle screenshots.");
        }

        const now = new Date().toISOString();
        const [claimed] = await db
          .update(schema.recordings)
          .set({
            status: "failed",
            failureCode: "taken_down",
            failureReason:
              "This recording was removed from hosted Clips storage.",
            loomImportClaimId: null,
            loomImportClaimedAt: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(
                schema.recordings.ownerEmail,
                current.ownerEmail,
              ),
              eq(schema.recordings.storageMode, "hosted"),
              eq(schema.recordings.updatedAt, current.updatedAt),
            ),
          )
          .returning({ id: schema.recordings.id });
        if (!claimed) {
          throw new Error("Recording changed before hosted takedown began.");
        }

        const [takedownRow] = await db
          .select()
          .from(schema.recordings)
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(
                schema.recordings.ownerEmail,
                current.ownerEmail,
              ),
            ),
          )
          .limit(1);
        if (!takedownRow) {
          throw new Error("Recording disappeared during hosted takedown.");
        }

        const failures: string[] = [];
        for (const url of recordingMediaUrls(takedownRow)) {
          try {
            const belongsToRecording = await isS3ObjectUrlBoundToRecording(
              url,
              recordingId,
              { storageMode: "hosted" },
            );
            if (belongsToRecording === null) {
              throw new Error("Hosted storage configuration is unavailable.");
            }
            if (!belongsToRecording) continue;
            const deleted = await deleteStoredMediaUrl(url, {
              storageMode: "hosted",
              recordingId,
            });
            if (!deleted) failures.push("hosted media object was not deleted");
          } catch (error) {
            failures.push(
              error instanceof Error ? error.message : String(error),
            );
          }
        }

        // An upload still in flight has no media URL; its session and uploaded
        // parts are the media.
        try {
          const sessionCleanup = await abortRecordingResumableSession(
            recordingId,
            takedownRow.uploadGenerationId,
            {
              hasPersistedMediaUrl: Boolean(takedownRow.videoUrl),
              label: `takedown-${recordingId}`,
            },
          );
          if (!sessionCleanup.ok) failures.push(sessionCleanup.reason);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
        }

        if (failures.length > 0) {
          await writeAudit({
            actorEmail,
            ownerEmail: current.ownerEmail,
            orgId: current.organizationId,
            recordingId,
            reason,
            status: "error",
            summary: `Hosted recording takedown is incomplete (${failures.length} media objects remain).`,
            cleanupFailures: failures.length,
          });
          auditWritten = true;
          throw new Error(
            `Hosted takedown stopped with ${failures.length} media object cleanup failure(s). The recording is failed and can be retried with the same command.`,
          );
        }

        const cleared = await db
          .update(schema.recordings)
          .set({
            videoUrl: null,
            thumbnailUrl: null,
            animatedThumbnailUrl: null,
            filmstripUrl: null,
            videoSizeBytes: 0,
            updatedAt: new Date().toISOString(),
          })
          .where(
            and(
              eq(schema.recordings.id, recordingId),
              ownerEmailMatches(
                schema.recordings.ownerEmail,
                current.ownerEmail,
              ),
              eq(schema.recordings.storageMode, "hosted"),
              eq(schema.recordings.status, "failed"),
              eq(schema.recordings.failureCode, "taken_down"),
              eq(schema.recordings.updatedAt, takedownRow.updatedAt),
            ),
          )
          .returning({ id: schema.recordings.id });
        if (!cleared.length) {
          throw new Error(
            "Hosted media was deleted but recording URLs could not be cleared; retained-byte accounting was kept conservative.",
          );
        }

        const allowance = await getHostedClipRecordingAllowance({
          recordingId,
          ownerEmail: current.ownerEmail,
        });
        if (allowance?.status === "reserved") {
          await releaseHostedClipRecording({
            recordingId,
            ownerEmail: current.ownerEmail,
          });
        } else if (allowance?.status === "consumed") {
          await adjustHostedClipRecordingBytes({
            recordingId,
            ownerEmail: current.ownerEmail,
            retainedBytes: 0,
          });
        }

        await writeAudit({
          actorEmail,
          ownerEmail: current.ownerEmail,
          orgId: current.organizationId,
          recordingId,
          reason,
          status: "success",
          summary: `Hosted recording ${recordingId} was taken down.`,
        });
        auditWritten = true;
        console.log(
          JSON.stringify({
            recordingId,
            status: "taken_down",
            mediaDeleted: true,
          }),
        );
      } catch (error) {
        if (!auditWritten) {
          await writeAudit({
            actorEmail,
            ownerEmail: recording.owner_email,
            orgId: recording.org_id,
            recordingId,
            reason,
            status: "error",
            summary: "Hosted recording takedown did not complete.",
          }).catch((auditError: unknown) => {
            console.error(
              "[clips-hosted-takedown] failure audit write failed",
              {
                recordingId,
                error:
                  auditError instanceof Error
                    ? auditError.message
                    : String(auditError),
              },
            );
          });
        }
        throw error;
      }
    },
  );
}

loadEnv();
try {
  await main();
} finally {
  await closeDbExec();
}
