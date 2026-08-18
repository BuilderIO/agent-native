import { writeAppState } from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { and, asc, eq, gte, inArray } from "drizzle-orm";

import { getDb, schema } from "../../server/db/index.js";
import { queueBuilderMediaCompression } from "../../server/lib/builder-media-compression.js";
import { ownerEmailMatches } from "../../server/lib/recordings.js";
import { transactionalEmailStore } from "../../server/lib/transactional-email-store.js";
import {
  extractLoomVideoId,
  normalizeLoomShareUrl,
} from "../../shared/loom.js";
import {
  fetchLoomTranscript,
  loomTranscriptUnavailableMessage,
} from "./loom-transcript.js";
import { downloadLoomVideo } from "./loom-video.js";

export type LoomImportJobResult = {
  status: "ready" | "failed";
  failureReason?: string;
};

export async function enqueueFirstImportEmailIfEligible(
  input: { recordingId: string; ownerEmail: string; createdAt: string },
  db: ReturnType<typeof getDb> = getDb(),
): Promise<void> {
  const { enabledAt } = await transactionalEmailStore.ensureEnabledAt();
  if (input.createdAt < enabledAt) return;

  const [firstReadyImport] = await db
    .select({ id: schema.recordings.id })
    .from(schema.recordings)
    .where(
      and(
        ownerEmailMatches(schema.recordings.ownerEmail, input.ownerEmail),
        eq(schema.recordings.status, "ready"),
        inArray(schema.recordings.sourceAppName, ["Loom", "Video link"]),
        gte(schema.recordings.createdAt, enabledAt),
      ),
    )
    .orderBy(asc(schema.recordings.createdAt), asc(schema.recordings.id))
    .limit(1);
  if (firstReadyImport?.id !== input.recordingId) return;

  await transactionalEmailStore.enqueueOrConvergeFirstImport(
    input.ownerEmail,
    input.recordingId,
    input.ownerEmail,
  );
}

export async function failLoomImport(
  recordingId: string,
  failureReason: string,
  claimId?: string,
): Promise<LoomImportJobResult> {
  console.error("[loom-import] failed", {
    recordingId,
    claimId,
    failureReason,
  });
  const now = new Date().toISOString();
  const [updated] = await getDb()
    .update(schema.recordings)
    .set({
      status: "failed",
      failureReason,
      loomImportClaimId: null,
      loomImportClaimedAt: null,
      updatedAt: now,
    })
    .where(
      claimId
        ? and(
            eq(schema.recordings.id, recordingId),
            eq(schema.recordings.loomImportClaimId, claimId),
          )
        : eq(schema.recordings.id, recordingId),
    )
    .returning({ id: schema.recordings.id });
  if (!updated) return { status: "failed", failureReason };

  try {
    await writeAppState(`recording-upload-${recordingId}`, {
      recordingId,
      status: "failed",
      failureReason,
      updatedAt: now,
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (err) {
    console.warn("[clips] Loom failure state update failed", {
      recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return { status: "failed", failureReason };
}

/**
 * Downloads a Loom video and re-uploads it to Clips storage, off the request
 * that created the "processing" row. Loom's CDN plus a reupload can outlast a
 * synchronous serverless function's execution ceiling; running it here keeps
 * import-loom-recording's own request fast regardless of Loom video length.
 */
export async function runLoomImportJob({
  recordingId,
  ownerEmail,
  claimId,
}: {
  recordingId: string;
  ownerEmail: string;
  claimId: string;
}): Promise<LoomImportJobResult> {
  const db = getDb();
  const [recording] = await db
    .select({
      id: schema.recordings.id,
      durationMs: schema.recordings.durationMs,
      sourceWindowTitle: schema.recordings.sourceWindowTitle,
      loomImportClaimId: schema.recordings.loomImportClaimId,
      createdAt: schema.recordings.createdAt,
    })
    .from(schema.recordings)
    .where(
      and(
        eq(schema.recordings.id, recordingId),
        ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
      ),
    );

  const shareUrl = normalizeLoomShareUrl(recording?.sourceWindowTitle ?? "");
  const loomId = shareUrl ? extractLoomVideoId(shareUrl) : null;
  if (
    !recording ||
    recording.loomImportClaimId !== claimId ||
    !shareUrl ||
    !loomId
  ) {
    return failLoomImport(
      recordingId,
      "This Loom recording is missing its source URL.",
      claimId,
    );
  }

  console.log("[loom-import] job started", { recordingId, claimId });

  let media: Awaited<ReturnType<typeof downloadLoomVideo>>;
  try {
    media = await downloadLoomVideo({ loomId, shareUrl });
    console.log("[loom-import] download complete", {
      recordingId,
      bytes: media.sizeBytes,
      mimeType: media.mimeType,
    });
  } catch (err) {
    return failLoomImport(
      recordingId,
      err instanceof Error ? err.message : String(err),
      claimId,
    );
  }

  try {
    const upload = await uploadFile({
      data: media.bytes,
      filename: `${recordingId}.mp4`,
      mimeType: media.mimeType,
      ownerEmail,
      stableUrl: true,
      recordAsset: false,
    });
    if (!upload?.url) {
      return failLoomImport(
        recordingId,
        "File upload returned no URL. Check your storage provider configuration.",
        claimId,
      );
    }
    console.log("[loom-import] reupload complete", {
      recordingId,
      videoUrl: upload.url,
    });

    const now = new Date().toISOString();
    const [mediaReady] = await db
      .update(schema.recordings)
      .set({
        videoUrl: upload.url,
        videoSizeBytes: media.sizeBytes,
        status: "ready",
        failureReason: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.recordings.id, recordingId),
          ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
          eq(schema.recordings.loomImportClaimId, claimId),
        ),
      )
      .returning({ id: schema.recordings.id });
    if (!mediaReady) {
      const failureReason =
        "The Loom import lease was lost before media was saved.";
      console.warn("[loom-import] lease lost before ready", {
        recordingId,
        claimId,
      });
      return { status: "failed", failureReason };
    }
    console.log("[loom-import] recording ready", { recordingId });

    void queueBuilderMediaCompression({
      recordingId,
      ownerEmail,
      videoUrl: upload.url,
      mimeType: media.mimeType,
      providerId: upload.provider,
      assetDbId: upload.id,
      sourceSizeBytes: media.sizeBytes,
    }).catch((err) => {
      console.warn("[clips] Loom media compression queue failed", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    });

    try {
      let transcript: Awaited<ReturnType<typeof fetchLoomTranscript>> = null;
      try {
        transcript = await fetchLoomTranscript({
          shareUrl,
          durationMs: recording.durationMs,
        });
      } catch (err) {
        console.warn(
          `[clips] Loom transcript import skipped for ${loomId}:`,
          err instanceof Error ? err.message : String(err),
        );
      }

      const transcriptValues = {
        ownerEmail,
        language: transcript?.language ?? "en",
        segmentsJson: transcript ? JSON.stringify(transcript.segments) : "[]",
        fullText: transcript?.fullText ?? "",
        status: transcript ? ("ready" as const) : ("failed" as const),
        failureReason: transcript ? null : loomTranscriptUnavailableMessage(),
        updatedAt: now,
      };
      const [existingTranscript] = await db
        .select({ recordingId: schema.recordingTranscripts.recordingId })
        .from(schema.recordingTranscripts)
        .where(eq(schema.recordingTranscripts.recordingId, recordingId));
      if (existingTranscript) {
        await db
          .update(schema.recordingTranscripts)
          .set(transcriptValues)
          .where(eq(schema.recordingTranscripts.recordingId, recordingId));
      } else {
        await db.insert(schema.recordingTranscripts).values({
          recordingId,
          ...transcriptValues,
          createdAt: now,
        });
      }
    } catch (err) {
      console.warn("[clips] Loom transcript persistence skipped", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await enqueueFirstImportEmailIfEligible(
        { recordingId, ownerEmail, createdAt: recording.createdAt },
        db,
      );
    } catch (err) {
      console.warn("[clips] First-import email enqueue failed", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await writeAppState(`recording-upload-${recordingId}`, {
        recordingId,
        status: "ready",
        progress: 100,
        videoUrl: upload.url,
        updatedAt: now,
      });
      await writeAppState("refresh-signal", { ts: Date.now() });
    } catch (err) {
      console.warn("[clips] Loom ready state update skipped", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    try {
      await db
        .update(schema.recordings)
        .set({ loomImportClaimId: null, loomImportClaimedAt: null })
        .where(
          and(
            eq(schema.recordings.id, recordingId),
            ownerEmailMatches(schema.recordings.ownerEmail, ownerEmail),
            eq(schema.recordings.loomImportClaimId, claimId),
          ),
        );
    } catch (err) {
      console.warn("[clips] Loom import lease release failed", {
        recordingId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    return { status: "ready" };
  } catch (err) {
    return failLoomImport(
      recordingId,
      err instanceof Error ? err.message : String(err),
      claimId,
    );
  }
}
