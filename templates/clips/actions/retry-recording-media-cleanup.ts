import { defineAction, fail } from "@agent-native/core/action";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { mediaCleanupSummary } from "../server/lib/recording-media-cleanup-worker.js";
import {
  openCleanupPayload,
  sealCleanupPayload,
  type CleanupManifest,
  type CleanupPayload,
} from "../server/lib/recording-media-lifecycle.js";
import { captureMediaCleanupScope } from "../server/lib/recording-media-provider.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import { mediaCleanupSummarySchema } from "../shared/media-cleanup.js";

export default defineAction({
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: true,
  },
  description:
    "Queue another attempt for one of your retained media cleanup intents. This does not confirm storage deletion; check its pending or blocked state afterward.",
  schema: z.object({
    id: z
      .string()
      .describe("Cleanup ID returned by list-recording-media-cleanups"),
  }),
  outputSchema: mediaCleanupSummarySchema,
  run: async ({ id }) => {
    const ownerEmail = getCurrentOwnerEmail(),
      t = schema.recordingMediaCleanups;
    const summary = await mediaCleanupSummary(id, ownerEmail);
    if (!summary)
      fail("Media cleanup not found", {
        errorCode: "media_cleanup_not_found",
        statusCode: 404,
      });
    if (summary.status === "complete") return summary;
    const jobs = await getDb()
      .select()
      .from(t)
      .where(and(eq(t.id, id), eq(t.ownerEmail, ownerEmail)))
      .limit(1);
    const job = jobs.shift();
    if (!job)
      fail("Media cleanup not found", {
        errorCode: "media_cleanup_not_found",
        statusCode: 404,
      });
    const objectTable = schema.recordingMediaCleanupObjects;
    const references = await getDb()
      .select({ payload: objectTable.payload })
      .from(objectTable)
      .where(
        and(
          eq(objectTable.recordingId, id),
          eq(objectTable.ownerEmail, ownerEmail),
          ne(objectTable.phase, "complete"),
        ),
      )
      .limit(1000);
    const urls = references.flatMap((row) =>
      row.payload ? openCleanupPayload<CleanupPayload>(row.payload).urls : [],
    );
    const scope = await captureMediaCleanupScope({
      ownerEmail,
      orgId: job.orgId,
      storageMode: job.storageMode === "hosted" ? "hosted" : "own",
      urls,
    });
    await getDb().transaction(async (tx) => {
      const held = await tx
        .select({ leaseUntil: t.leaseUntil })
        .from(t)
        .where(and(eq(t.id, id), eq(t.ownerEmail, ownerEmail)))
        .for("update")
        .limit(1);
      const lease = held.shift();
      if (!lease)
        fail("Media cleanup not found", {
          errorCode: "media_cleanup_not_found",
          statusCode: 404,
        });
      if (lease.leaseUntil && lease.leaseUntil > new Date().toISOString())
        fail("Media cleanup is already running", {
          errorCode: "media_cleanup_busy",
          statusCode: 409,
        });
      const manifest = openCleanupPayload<CleanupManifest>(job.manifest);
      const current = await tx
        .select()
        .from(objectTable)
        .where(
          and(
            eq(objectTable.recordingId, id),
            eq(objectTable.ownerEmail, ownerEmail),
            ne(objectTable.phase, "complete"),
          ),
        )
        .limit(1000);
      for (const object of current)
        if (object.payload) {
          const payload = openCleanupPayload<CleanupPayload>(object.payload);
          await tx
            .update(objectTable)
            .set({
              payload: sealCleanupPayload({
                ...payload,
                ...scope,
                ...(payload.credentialRef
                  ? { credentialRef: payload.credentialRef }
                  : {}),
                storageFingerprint:
                  payload.storageFingerprint === undefined
                    ? (scope.storageFingerprint ?? null)
                    : payload.storageFingerprint,
              }),
              attempts: 0,
            })
            .where(
              and(
                eq(objectTable.recordingId, id),
                eq(objectTable.objectKey, object.objectKey),
                eq(objectTable.ownerEmail, ownerEmail),
              ),
            );
        }
      await tx
        .update(t)
        .set({
          manifest: sealCleanupPayload({
            ...manifest,
            scope: {
              ...scope,
              ...(manifest.scope?.credentialRef
                ? { credentialRef: manifest.scope.credentialRef }
                : {}),
            },
          }),
          attempts: 0,
          nextAttemptAt: new Date().toISOString(),
          status: "pending",
          reason: null,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(t.id, id),
            eq(t.ownerEmail, ownerEmail),
            ne(t.status, "complete"),
          ),
        );
    });
    const updated = await mediaCleanupSummary(id, ownerEmail);
    if (!updated)
      fail("Media cleanup could not be read", {
        errorCode: "media_cleanup_unavailable",
        statusCode: 503,
      });
    return updated;
  },
});
