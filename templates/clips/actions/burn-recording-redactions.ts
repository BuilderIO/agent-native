/**
 * Burn a recording's redaction boxes into the video, permanently.
 *
 * A box drawn over a playing video hides nothing: the stored file still has
 * the pixels, and they can be read from the network tab, a download, the
 * poster image or the editor's filmstrip. This action is what makes a
 * redaction mean what people assume it means — the covered pixels are
 * destroyed, the new file replaces the old one, and the old one is deleted.
 *
 * Four things this gets right, each of which is a way it could go wrong:
 *
 *  - **Only the redaction is burned, never the cuts.** Comments, reactions,
 *    chapters and transcript segments are stored against the original clock.
 *    The re-encode keeps the recording's full length, so every one of them
 *    still lands where it did, and the timeline stays editable afterwards.
 *  - **The derived images are rebuilt.** The thumbnail, the animated
 *    thumbnail and the editor filmstrip are separate files made from the
 *    unredacted frames — the filmstrip is literally a grid of them. Leaving
 *    any of them in place would leak exactly what was redacted.
 *  - **The row points at the new file before the old one is deleted**, so a
 *    failure never leaves a recording pointing at something that is gone.
 *  - **A failed delete fails the action, loudly.** The video is already
 *    redacted at that point, but the original is still sitting in storage and
 *    the owner has to know.
 *
 * There is no undo. What was under the box is gone from the file.
 *
 * UI-only: destructive and irreversible, so it is not offered as an agent
 * tool. The agent can place redactions with `set-recording-overlays`; a person
 * decides when they are burned.
 */

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

/** Long enough for a full re-encode of a long clip on a small host. */
const BURN_TIMEOUT_MS = 20 * 60 * 1000;
/**
 * How far the burned file's length may drift from the source before this is
 * treated as a failure. One frame of rounding at the container level is
 * normal; anything more means timestamps have moved and every comment and
 * transcript segment would be pointing at the wrong moment.
 */
const MAX_DURATION_DRIFT_MS = 250;
/**
 * Goes on the front of the title, where a list shows it.
 *
 * It used to be appended, which put it exactly where a narrow library card,
 * a share link or an email subject runs out of room and trims — so the one
 * word saying these pixels are gone was the first thing to disappear. Pete
 * asked for it moved on 2026-09-21. Capitalised because it now starts the
 * title.
 */
const REDACTED_MARKER = "(Redacted)";
/** Already says what it is — a second burn must not stack a second marker. */
const REDACTED_PREFIX_RE = /^\(redacted\)\s*/i;
/** Where the marker used to go: a re-burn moves it rather than adding to it. */
const REDACTED_SUFFIX_RE = /\s*\(redacted\)$/i;
/** What the first version of this appended; upgraded rather than left behind. */
const EDITED_SUFFIX_RE = /\s*\(edited\)$/i;

export function redactedTitle(title: string | null | undefined): string | null {
  const current = (title ?? "").trim();
  if (!current) return title ?? null;
  // Every marker comes off first, wherever it sits, so the result is the same
  // whether this is a first burn, a second one, or a title carrying the old
  // trailing marker from before the move.
  const bare = current
    .replace(REDACTED_PREFIX_RE, "")
    .replace(REDACTED_SUFFIX_RE, "")
    .replace(EDITED_SUFFIX_RE, "")
    .trim();
  return bare ? `${REDACTED_MARKER} ${bare}` : REDACTED_MARKER;
}

/**
 * How long each stage of the burn took, printed when it finishes.
 *
 * "The burn is slow" is not something that can be acted on: the job is a media
 * fetch, an encode, four probes, an upload, a row update, a set of deletes and
 * two rebuilt images, and on a two-core host any one of them can be the one
 * spending the minutes. Measuring them costs nothing and turns the next report
 * into a number — on 2026-09-21 it was the difference between blaming the
 * filter graph, which took 2.6s, and finding the encode was never the problem.
 */
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

/**
 * The burn itself, run in the background.
 *
 * It cannot be the action's return value: a full re-encode of a long clip
 * takes minutes and an action is given sixty seconds, so waiting for it
 * produced "Action burn-recording-redactions timed out after 60s" while
 * ffmpeg carried on working, invisibly, on a recording the user now believed
 * had failed.
 */
export async function burnRedactionsFor(args: {
  recordingId: string;
  ownerEmail: string;
}) {
  // Asserted here, not only in the action that usually calls this. The
  // function is exported and runs the burn's own reads and writes, so the
  // check belongs beside them — a caller that forgot would otherwise reach
  // every row by id.
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

  // Progress covers the whole job, not just the encode. On a short clip
  // ffmpeg is a second of a ten-second job — fetching the media, uploading
  // the result and rebuilding the thumbnail and filmstrip are the rest of
  // it, and a bar that only moves during the encode looks stuck for most of
  // the wait.
  setBurnProgress(args.recordingId, 2);
  const source = await loadRecordingMediaBytes(existing);
  timer.mark("fetch");
  setBurnProgress(args.recordingId, 6);
  const sourceExtension = existing.videoFormat === "mp4" ? "mp4" : "webm";

  // Size and clip the graph against the file, not against the row. Both
  // columns can be wrong in a way that leaves pixels on show:
  //
  //   `durationMs` is client-reported at finalize and is unreliable for
  //   MediaRecorder webm. If it is short, `redactionSegments` clips every
  //   range to it, so everything past that point is encoded untouched — and
  //   the boxes are cleared afterwards regardless, publishing a
  //   partly-redacted clip as a redacted one.
  //
  //   `recordings.width` defaults to 0, and `mosaicBlockPx` then quietly
  //   assumes 1280. On a 4K capture that is a third of the intended block
  //   size against letters three times the size, i.e. plausibly still
  //   readable.
  const probed = await probeMediaInfo(source.bytes, sourceExtension);
  // No fallback to `recordings.durationMs`: it is client-reported at finalize
  // and unreliable for MediaRecorder webm. A short value clips every redaction
  // range while the whole file is re-encoded, and the boxes are cleared
  // afterwards regardless — publishing a partly-redacted clip as a redacted
  // one. If the file will not say how long it is, the burn stops.
  const burnDurationMs = probed.durationMs;
  const burnWidth = probed.width ?? (existing.width > 0 ? existing.width : 0);
  const burnHeight =
    probed.height ?? (existing.height > 0 ? existing.height : 0);
  if (!burnWidth || !burnHeight || !burnDurationMs) {
    // Both, not just the width. The fill is scaled to a size computed from
    // these, so an under-estimate leaves the rest of the box showing the
    // original — an unguarded height did that on everything that was not 720
    // tall. Guessing here is what a checker exists to stop: refusing costs a
    // burn, guessing costs the redaction.
    throw new Error(
      "The frame size or length of this recording could not be read, so the redaction cannot be sized or timed. Nothing was changed.",
    );
  }

  // A fresh pattern each burn: two clips redacted the same way should not
  // carry the same blocks, and a re-burn should not reproduce the first.
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
    // Throttled: ffmpeg reports far more often than the editor polls.
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
            // Often enough that a short clip still shows movement; ffmpeg
            // itself only reports every half second or so of wall time.
            if (now - lastWrite < 250) return;
            lastWrite = now;
            // The encode is the 6–80 band of the whole job.
            setBurnProgress(args.recordingId, 6 + fraction * 74);
          },
        },
      ),
    );
    let info: Awaited<ReturnType<typeof stat>>;
    try {
      info = await stat(outputPath);
    } catch (err) {
      // ffmpeg exited without writing anything readable. Say which failure it
      // was rather than folding it into the empty-output message below.
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

  // Nothing below this line may run against a file that is not what it
  // claims to be: the original is about to be deleted.
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
  // Already read from the same bytes above; probing twice is a second
  // ffmpeg run for an answer we have.
  const sourceDuration = burnDurationMs;
  const burnedDuration = await probeDurationMs(burned, "mp4");
  // An unreadable length is not a pass. This check is the only thing standing
  // between a drifted re-encode and every comment and transcript timestamp
  // moving, so skipping it when the answer is missing amounts to not having
  // it — the output would be promoted and the original deleted unverified.
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
    // Deliberately NOT a stable URL. Writing the burned bytes over the object
    // the row still points at replaces the live file before the compare-and-
    // swap below has decided whether this burn is the one that wins — so a
    // losing burn would still have mutated what everyone is watching. A fresh
    // object is promoted only by the row update, and orphaned if that fails.
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

  // What was burned is recorded — where and when, never what was under it —
  // so the editor can show that a stretch has already been redacted and does
  // not offer to move a box whose pixels are gone.
  timer.mark("upload");
  const burnedAt = new Date().toISOString();

  // Re-read the edits rather than writing back the copy taken before the
  // encode: that read is minutes old by now, and anything added since —
  // another box drawn in the editor, or one placed by `set-recording-overlays`
  // — would be wiped by writing the stale value back. Wiping it would also
  // drop the count to zero and lift the hold on a clip that still shows what
  // that box is over. So only the boxes actually burned are removed, by id,
  // and the write below is pinned to this value.
  const [fresh] = await db
    .select({
      editsJson: schema.recordings.editsJson,
      title: schema.recordings.title,
    })
    .from(schema.recordings)
    .where(eq(schema.recordings.id, args.recordingId));
  const freshEditsJson = fresh?.editsJson ?? null;
  // Same name with a marker on the front, so the redacted copy is tellable
  // from the original in a list. Burning twice does not stack the marker.
  // Built from this read rather than the one before the encode, so a rename
  // made while it ran is kept; the write below is pinned to it as well.
  // `undefined` leaves the column alone; the column itself is never null.
  const freshTitle = fresh?.title ?? existing.title;
  const nextTitle = redactedTitle(freshTitle) ?? undefined;
  const freshEdits = parseEdits(freshEditsJson);
  const burnedIds = new Set(redactions.map((r) => r.id));
  const rawOverlays: unknown[] = Array.isArray(freshEdits.overlays)
    ? freshEdits.overlays
    : [];
  // Matched on what was burned, not merely on its id. An overlay edited while
  // the encode was running keeps its id but has geometry or timing that was
  // never rendered, so removing it by id alone would clear a box whose pixels
  // are still there — and lift the hold with it. An overlay with no id cannot
  // be matched at all, so it is kept. Keeping one too many leaves the clip
  // held; dropping one too many publishes it.
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
    // Same id, different box: it was changed since the encode read it.
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
      // `editsJson` is deliberately NOT written here. Clearing the overlays is
      // what lifts the hold, and the originals have not been deleted yet — if
      // that fails below, the clip has to stay held while its unredacted files
      // are still reachable. The second write does it, once they are gone.
      // The derived images are all made of unredacted frames. Clearing them
      // here, before anything is deleted, means a failure further down
      // leaves a recording with no thumbnail rather than a leaking one.
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
        // Compare-and-swap on the edits too: if anything touched them between
        // the read above and this write, the row is left alone rather than
        // overwritten with a document built from a value that has since moved.
        freshEditsJson == null
          ? isNull(schema.recordings.editsJson)
          : eq(schema.recordings.editsJson, freshEditsJson),
      ),
    )
    .returning({ id: schema.recordings.id });

  if (!updated.length) {
    // The recording moved under us. The upload is its own object, so it is
    // simply an orphan — the file everyone is watching was never touched.
    if (upload.url !== previousVideoUrl) {
      try {
        await deleteStoredMediaUrl(upload.url);
      } catch (err) {
        // Losing the orphan costs storage, not correctness, and the throw
        // below is the thing the caller needs to see — but a silent failure
        // here is how orphans accumulate unnoticed.
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

  // Now destroy the originals: the source file and every image made from it.
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

  // Local/dev media lives in application_state rather than storage, and
  // `deleteStoredMediaUrl` cannot see it. Left behind, the unredacted bytes
  // are still served by the `/api/video/:id` fallback route.
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

  // Rebuild what was thrown away, from the redacted file.
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
    // The overlays are still on the row, so every media path stays shut and
    // the clip cannot be shared. That is the right state: the unredacted
    // original is still sitting in storage.
    throw new Error(
      "The video was redacted and saved, but the original file could not be deleted from storage. The clip is being held back from viewers until it is. Treat what you redacted as still exposed, and delete the recording.",
    );
  }

  // Only now: the originals are gone, so clearing the overlays — which is what
  // lifts the hold — can no longer publish a clip whose unredacted files are
  // still reachable. Pinned to the same value the first write was, so an edit
  // made in between keeps its box rather than losing it to this write.
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
    // Someone drew or moved a box while this was running. The pixels are
    // burned and the originals are deleted, so nothing is exposed — but the
    // editor still shows boxes that no longer have anything under them, and
    // saying so is better than silently clearing their work.
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
    // Everything cheap enough to answer for happens here, so a mistake comes
    // back as a plain error rather than as a job that fails out of sight.
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
      // Returned rather than thrown: the framework turns a thrown Error into
      // "Internal server error", which tells the person nothing. Anything the
      // user can act on comes back as a reason they can read.
      return {
        id: args.recordingId,
        started: false,
        reason: "There are no redactions on this recording to burn in.",
      };
    }
    if (!startBurn(args.recordingId)) {
      // Pressing Burn twice, or pressing it on a page opened while one was
      // already running, joins the job rather than failing.
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
    // Deliberately not awaited. The job carries the caller's identity with
    // it, because a background promise has no request context to read one
    // from — without this it would run as the deploy environment.
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
