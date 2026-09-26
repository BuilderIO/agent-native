
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { defineAction } from "@agent-native/core/action";
import {
  deleteAppState,
  writeAppState,
} from "@agent-native/core/application-state";
import { uploadFile } from "@agent-native/core/file-upload";
import { runWithRequestContext } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { parseEdits, serializeEdits } from "../app/lib/timestamp-mapping.js";
import {
  otherOverlays,
  parseRedactions,
  redactionBurnFfmpegArgs,
  redactionFilterGraph,
  type VideoRedaction,
} from "../app/lib/video-redactions.js";
import { getDb, schema } from "../server/db/index.js";
import { ensureRecordingThumbnail } from "../server/lib/ensure-recording-thumbnail.js";
import { loadRecordingMediaBytes } from "../server/lib/public-agent-context.js";
import { deleteStoredMediaUrl } from "../server/lib/recording-media-cleanup.js";
import { getCurrentOwnerEmail } from "../server/lib/recordings.js";
import {
  failBurn,
  finishBurn,
  setBurnProgress,
  startBurn,
} from "../server/lib/redaction-burn-progress.js";
import {
  isFfmpegAvailable,
  probeDurationMs,
  probeMediaInfo,
  probeHasAudioStream,
  runFfmpegWithProgress,
  withRemuxSlot,
} from "../server/lib/video-remux.js";
import { STORAGE_SETUP_REQUIRED_REASON } from "../server/lib/video-storage.js";
import { ensureRecordingFilmstrip } from "./lib/ensure-recording-filmstrip.js";
import { assertNativeRecordingMedia } from "./lib/native-media.js";

const BURN_TIMEOUT_MS = 20 * 60 * 1000;
const MAX_DURATION_DRIFT_MS = 250;
const REDACTED_MARKER = "(Redacted)";
const REDACTED_PREFIX_RE = /^\(redacted\)\s*/i;
const REDACTED_SUFFIX_RE = /\s*\(redacted\)$/i;
const EDITED_SUFFIX_RE = /\s*\(edited\)$/i;

export function redactedTitle(title: string | null | undefined): string | null {
  const current = (title ?? "").trim();
  if (!current) return title ?? null;
  const bare = current
    .replace(REDACTED_PREFIX_RE, "")
    .replace(REDACTED_SUFFIX_RE, "")
    .replace(EDITED_SUFFIX_RE, "")
    .trim();
  return bare ? `${REDACTED_MARKER} ${bare}` : REDACTED_MARKER;
}

function phaseTimer() {
  const marks: Array<[string, number]> = [];
  const started = Date.now();
  let last = started;
  return {
    mark(name: string) {
      const now = Date.now();
      marks.push([name, now - last]);
      last = now;
    },
    summary(): string {
      const total = ((Date.now() - started) / 1000).toFixed(1);
      const parts = marks
        .filter(([, ms]) => ms >= 50)
        .map(([name, ms]) => `${name} ${(ms / 1000).toFixed(1)}s`);
      return `${total}s total (${parts.join(", ")})`;
    },
  };
}

export async function burnRedactionsFor(args: {
  recordingId: string;
  ownerEmail: string;
}) {
  await assertAccess("recording", args.recordingId, "editor");

  const db = getDb();
  const { ownerEmail } = args;
  const timer = phaseTimer();

  const [existing] = await db
    .select()
    .from(schema.recordings)
    .where(eq(schema.recordings.id, args.recordingId));
  if (!existing) {
    throw new Error(`Recording not found: ${args.recordingId}`);
  }
  assertNativeRecordingMedia(existing);
  if (!existing.videoUrl) {
    throw new Error(
      "Only a recording with a video file can have redactions burned in.",
    );
  }
  const previousVideoUrl: string = existing.videoUrl;
  if (!isFfmpegAvailable()) {
    throw new Error(
      "Redactions are rendered with ffmpeg, which is not available on this server.",
    );
  }

  const edits = parseEdits(existing.editsJson);
  const redactions: VideoRedaction[] = parseRedactions(edits.overlays);
  if (!redactions.length) {
    throw new Error("There are no redactions on this recording to burn in.");
  }

  setBurnProgress(args.recordingId, 2);
  const source = await loadRecordingMediaBytes(existing);
  timer.mark("fetch");
  setBurnProgress(args.recordingId, 6);
  const sourceExtension = existing.videoFormat === "mp4" ? "mp4" : "webm";

  const probed = await probeMediaInfo(source.bytes, sourceExtension);
  const burnDurationMs = probed.durationMs;
  const burnWidth = probed.width ?? (existing.width > 0 ? existing.width : 0);
  const burnHeight =
    probed.height ?? (existing.height > 0 ? existing.height : 0);
  if (!burnWidth || !burnHeight || !burnDurationMs) {
    throw new Error(
      "The frame size or length of this recording could not be read, so the redaction cannot be sized or timed. Nothing was changed.",
    );
  }

  const mosaicSeed = Math.floor(Math.random() * 2 ** 31);
  const graph = redactionFilterGraph(
    redactions,
    burnDurationMs,
    burnWidth,
    burnHeight,
    mosaicSeed,
  );
  if (!graph.filterComplex) {
    throw new Error(
      "The redactions on this recording cover no part of it — check their time ranges.",
    );
  }

  const dir = await mkdtemp(join(tmpdir(), "clips-redaction-burn-"));
  const inputPath = join(dir, `input.${sourceExtension}`);
  const outputPath = join(dir, "output.mp4");
  let burned: Uint8Array;
  try {
    await writeFile(inputPath, source.bytes);
    let lastWrite = 0;
    await withRemuxSlot(() =>
      runFfmpegWithProgress(
        redactionBurnFfmpegArgs({
          inputPath,
          outputPath,
          filterComplex: graph.filterComplex,
          outputLabel: graph.outputLabel,
        }),
        {
          timeoutMs: BURN_TIMEOUT_MS,
          label: "redaction burn",
          totalMs: existing.durationMs,
          onProgress: (fraction) => {
            const now = Date.now();
            if (now - lastWrite < 250) return;
            lastWrite = now;
            setBurnProgress(args.recordingId, 6 + fraction * 74);
          },
        },
      ),
    );
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(outputPath);
    } catch (err) {
      throw new Error(
        `The redacted video could not be read back after rendering: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    if (info.size === 0) {
      throw new Error("The redacted video came out empty.");
    }
    burned = new Uint8Array(await readFile(outputPath));
    timer.mark("encode");
    setBurnProgress(args.recordingId, 82);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }

  setBurnProgress(args.recordingId, 85);
  const sourceHadAudio = await probeHasAudioStream(
    source.bytes,
    sourceExtension,
  );
  if (sourceHadAudio === true) {
    const burnedHasAudio = await probeHasAudioStream(burned, "mp4");
    if (burnedHasAudio !== true) {
      throw new Error(
        "The redacted video lost its audio, so it has not been saved. Nothing was deleted.",
      );
    }
  }
  const sourceDuration = burnDurationMs;
  const burnedDuration = await probeDurationMs(burned, "mp4");
  if (burnedDuration === null) {
    throw new Error(
      "The length of the redacted video could not be read, so it cannot be checked against the original. It has not been saved, and nothing was deleted.",
    );
  }
  if (Math.abs(sourceDuration - burnedDuration) > MAX_DURATION_DRIFT_MS) {
    throw new Error(
      `The redacted video came out ${Math.abs(sourceDuration - burnedDuration)}ms longer or shorter than the original, which would move every comment and transcript timestamp. It has not been saved, and nothing was deleted.`,
    );
  }

  timer.mark("verify");
  setBurnProgress(args.recordingId, 88);
  const upload = await uploadFile({
    data: burned,
    filename: `${args.recordingId}.mp4`,
    mimeType: "video/mp4",
    ownerEmail,
    recordAsset: false,
  }).catch((err) => {
    console.warn("[burn-recording-redactions] upload failed", {
      recordingId: args.recordingId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
  if (!upload?.url) {
    throw new Error(STORAGE_SETUP_REQUIRED_REASON);
  }

  timer.mark("upload");
  const burnedAt = new Date().toISOString();

  const [fresh] = await db
    .select({
      editsJson: schema.recordings.editsJson,
      title: schema.recordings.title,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, args.recordingId));
  const freshEditsJson = fresh?.editsJson ?? null;
  const freshTitle = fresh?.title ?? existing.title;
  const nextTitle = redactedTitle(freshTitle) ?? undefined;
  const freshEdits = parseEdits(freshEditsJson);
  const burnedIds = new Set(redactions.map((r) => r.id));
  const rawOverlays: unknown[] = Array.isArray(freshEdits.overlays)
    ? freshEdits.overlays
    : [];
  const burnedById = new Map(
    parseRedactions(edits.overlays).map((r) => [r.id, JSON.stringify(r)]),
  );
  const survivingRedactions = rawOverlays.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const overlay = item as Record<string, unknown>;
    if (overlay.kind !== "redact") return false;
    if (typeof overlay.id !== "string" || !burnedIds.has(overlay.id)) {
      return true;
    }
    const asBurned = burnedById.get(overlay.id);
    const [parsed] = parseRedactions([item]);
    return !parsed || JSON.stringify(parsed) !== asBurned;
  });
  const history: unknown[] = freshEdits.burnedRedactions ?? [];
  const nextEdits = {
    ...freshEdits,
    overlays: [...otherOverlays(freshEdits.overlays), ...survivingRedactions],
    burnedRedactions: [
      ...history,
      ...redactions.map((r) => ({
        id: r.id,
        startMs: r.startMs,
        endMs: r.endMs,
        keys: r.keys,
        burnedAt,
      })),
    ],
  };

  const updated = await db
    .update(schema.recordings)
    .set({
      title: nextTitle,
      videoUrl: upload.url,
      videoFormat: "mp4",
      videoSizeBytes: burned.byteLength,
      thumbnailUrl: null,
      thumbnailStatus: "pending",
      animatedThumbnailUrl: null,
      filmstripUrl: null,
      filmstripFrameCount: 0,
      filmstripColumns: 0,
      filmstripRows: 0,
      filmstripFrameWidth: 0,
      filmstripFrameHeight: 0,
      mediaUpdatedAt: burnedAt,
      updatedAt: burnedAt,
    })
    .where(
      and(
        eq(schema.recordings.id, args.recordingId),
        eq(schema.recordings.videoUrl, previousVideoUrl),
        eq(schema.recordings.title, freshTitle),
        freshEditsJson == null
          ? isNull(schema.recordings.editsJson)
          : eq(schema.recordings.editsJson, freshEditsJson),
      ),
    )
    .returning({ id: schema.recordings.id });

  if (!updated.length) {
    if (upload.url !== previousVideoUrl) {
      try {
        await deleteStoredMediaUrl(upload.url);
      } catch (err) {
        console.warn("[burn] could not delete the orphaned upload", {
          url: upload.url,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    throw new Error(
      "The recording changed while the redaction was rendering. Nothing was deleted — try again.",
    );
  }

  timer.mark("row");
  setBurnProgress(args.recordingId, 93);

  const keep = new Set([upload.url]);
  const stale = [
    previousVideoUrl,
    existing.thumbnailUrl,
    existing.animatedThumbnailUrl,
    existing.filmstripUrl,
  ]
    .filter((url): url is string => Boolean(url))
    .filter((url) => !keep.has(url));

  const failedDeletes: string[] = [];
  for (const url of stale) {
    try {
      const deleted = await deleteStoredMediaUrl(url);
      if (!deleted) failedDeletes.push(url);
    } catch (err) {
      failedDeletes.push(url);
      console.warn(
        `[burn-recording-redactions] could not delete ${url} for ${args.recordingId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  const wasLocalBlob = previousVideoUrl.startsWith("/api/video/");
  if (wasLocalBlob) {
    try {
      await deleteAppState(`recording-blob-${args.recordingId}`);
    } catch (err) {
      failedDeletes.push(previousVideoUrl);
      console.warn(
        `[burn-recording-redactions] could not delete the local blob for ${args.recordingId}:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  timer.mark("delete");
  setBurnProgress(args.recordingId, 96);
  const thumbnail = await ensureRecordingThumbnail({
    recordingId: args.recordingId,
    ownerEmail,
    mediaBytes: burned,
    mimeType: "video/mp4",
  }).catch((err) => {
    console.warn("[burn-recording-redactions] thumbnail rebuild failed", err);
    return null;
  });
  timer.mark("thumbnail");
  const filmstrip = await ensureRecordingFilmstrip({
    recordingId: args.recordingId,
    ownerEmail,
    force: true,
  }).catch((err) => {
    console.warn("[burn-recording-redactions] filmstrip rebuild failed", err);
    return null;
  });
  timer.mark("filmstrip");

  await writeAppState("refresh-signal", { ts: Date.now() });
  console.log(
    `Burned ${redactions.length} redaction(s) into ${args.recordingId}: ` +
      `thumbnail ${thumbnail?.status ?? "failed"}, filmstrip ${filmstrip?.status ?? "failed"}, ` +
      `${stale.length} old file(s) deleted${failedDeletes.length ? `, ${failedDeletes.length} FAILED` : ""}` +
      ` — ${timer.summary()}`,
  );

  if (failedDeletes.length) {
    throw new Error(
      "The video was redacted and saved, but the original file could not be deleted from storage. The clip is being held back from viewers until it is. Treat what you redacted as still exposed, and delete the recording.",
    );
  }

  const released = await db
    .update(schema.recordings)
    .set({ editsJson: serializeEdits(nextEdits), updatedAt: burnedAt })
    .where(
      and(
        eq(schema.recordings.id, args.recordingId),
        freshEditsJson == null
          ? isNull(schema.recordings.editsJson)
          : eq(schema.recordings.editsJson, freshEditsJson),
      ),
    )
    .returning({ id: schema.recordings.id });

  if (!released.length) {
    console.warn(
      `[burn-recording-redactions] redactions burned for ${args.recordingId}, but the edits changed while it ran, so the boxes were left on the timeline`,
    );
  }

  return {
    id: args.recordingId,
    videoUrl: upload.url,
    redactionsBurned: redactions.length,
    thumbnail: thumbnail?.status ?? "failed",
    filmstrip: filmstrip?.status ?? "failed",
  };
}

export default defineAction({
  description:
    "Permanently render a recording's redaction boxes into the video: re-encodes the full-length clip with the covered areas filled in, replaces the stored file, rebuilds the thumbnail and filmstrip from the redacted frames, and deletes the original. Cuts, chapters, comments and the transcript are untouched and stay editable. Cannot be undone.",
  agentTool: false,
  schema: z.object({
    recordingId: z.string().describe("Recording ID"),
  }),
  run: async (args) => {
    await assertAccess("recording", args.recordingId, "editor");
    const ownerEmail = getCurrentOwnerEmail();

    const db = getDb();
    const [existing] = await db
      .select()
      .from(schema.recordings)
      .where(eq(schema.recordings.id, args.recordingId));
    if (!existing) {
      throw new Error(`Recording not found: ${args.recordingId}`);
    }
    assertNativeRecordingMedia(existing);
    if (!existing.videoUrl) {
      return {
        id: args.recordingId,
        started: false,
        reason:
          "Only a recording with a video file can have redactions burned in.",
      };
    }
    if (!isFfmpegAvailable()) {
      return {
        id: args.recordingId,
        started: false,
        reason:
          "Redactions are rendered with ffmpeg, which is not available on this server.",
      };
    }
    const pending = parseRedactions(parseEdits(existing.editsJson).overlays);
    if (!pending.length) {
      return {
        id: args.recordingId,
        started: false,
        reason: "There are no redactions on this recording to burn in.",
      };
    }
    if (!startBurn(args.recordingId)) {
      return {
        id: args.recordingId,
        started: true,
        alreadyRunning: true,
        redactions: pending.length,
      };
    }

    console.log(
      `[burn] started ${args.recordingId}: ${pending.length} redaction(s)`,
    );
    void runWithRequestContext({ userEmail: ownerEmail }, async () => {
      try {
        await burnRedactionsFor({ recordingId: args.recordingId, ownerEmail });
        finishBurn(args.recordingId);
        console.log(`[burn] finished ${args.recordingId}`);
      } catch (err: any) {
        const message =
          err instanceof Error ? err.message : String(err ?? "Burn failed");
        console.warn(
          `[burn-recording-redactions] ${args.recordingId} failed:`,
          message,
        );
        failBurn(args.recordingId, message);
      }
    });

    return {
      id: args.recordingId,
      started: true,
      alreadyRunning: false,
      redactions: pending.length,
    };
  },
});
