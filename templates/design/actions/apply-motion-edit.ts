/**
 * apply-motion-edit — ATOMIC motion timeline write (§6.3).
 *
 * One action does all of:
 * 1. Validate the timeline against the design's source capabilities.
 * 2. Persist the `motion_timeline` row (insert or update).
 * 3. Compile the tracks into deterministic CSS.
 * 4. Inject/replace the managed `<style data-agent-native-motion>` block inside
 *    the design's durable HTML content.
 * 5. Update `compiledHash` on the row to guard against drift.
 * 6. Return a diff summary (bytes before/after, track count, hash).
 *
 * Never writes unless all steps succeed. Scrubbing/preview is handled by the
 * separate `motion-preview` postMessage path on the frontend — this action is
 * the durable autosave/persist path for edited timelines.
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import {
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
  compile,
  injectManagedMotionCss,
} from "../shared/motion-compiler.js";
import { parseSpringToken } from "../shared/motion-easing.js";
import type {
  MotionPlaybackMode,
  MotionTrack,
} from "../shared/motion-timeline.js";
import {
  readTimelinePlaybackMode,
  withTimelinePlaybackMode,
} from "../shared/motion-timeline.js";
import { sourceContentHash } from "../shared/source-workspace.js";

// ─── DoS-guard caps ──────────────────────────────────────────────────────────
//
// Mirrors the style of other hard resource caps in this template (e.g.
// MAX_SHADERS_PER_ARTBOARD in shared/shader-safety.ts): a small, exported
// constant plus a clear thrown Error (never a silent clamp) so callers see
// exactly which limit was exceeded and by how much.

/** Max tracks per timeline/screen — keeps compile() bounded and DOM-safe. */
export const MAX_MOTION_TRACKS = 64;
/** Max keyframes per track — keeps @keyframes blocks bounded. */
export const MAX_MOTION_KEYFRAMES_PER_TRACK = 128;
/** Max total timeline duration, ms (120s) — guards against runaway timelines. */
export const MAX_MOTION_DURATION_MS = 120_000;

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const keyframeSchema = z.object({
  t: z
    .number()
    .min(0)
    .max(1)
    .describe(
      "Normalised time in [0, 1] within the track's own span " +
        "(0 = span start, 1 = span end; the span is the whole timeline " +
        "unless the track sets delayMs/durationMs).",
    ),
  value: z.string().describe("CSS property value at this keyframe."),
  ease: z
    .string()
    .optional()
    .describe(
      "Easing of the SEGMENT leaving this keyframe toward the next one " +
        "(Figma semantics: the easing INTO the following keyframe). " +
        'Accepts CSS keywords ("linear", "ease-out", "step-start" — the ' +
        '"Hold" preset), "cubic-bezier(x1,y1,x2,y2)", "steps(n, pos)", ' +
        'CSS "linear(...)" stop lists, and spring physics as ' +
        '"spring(bounce)" or "spring(bounce, settle)" with bounce in [0, 1] ' +
        "(compiled to a CSS linear() approximation).",
    ),
});

const trackSchema = z.object({
  targetNodeId: z
    .string()
    .describe(
      "data-agent-native-node-id of the target DOM element. " +
        "Must be stamped on the element (ensureCodeLayerNodeIdsInHtml).",
    ),
  property: z
    .string()
    .describe(
      "CSS property to animate. Figma-parity mapping: translation → " +
        '"translate", scale → "scale", rotation → "rotate", opacity → ' +
        '"opacity", corner radius → "border-radius", fill → ' +
        '"background-color", stroke paint → "border-color", stroke weight ' +
        '→ "border-width", drop shadow → "box-shadow". translate/scale/' +
        "rotate are individual CSS transform properties, so they compose " +
        "freely on one node as separate tracks.",
    ),
  keyframes: z
    .array(keyframeSchema)
    .min(1)
    .describe(
      "At least one keyframe is required per track " +
        `(max ${MAX_MOTION_KEYFRAMES_PER_TRACK} per track).`,
    ),
  delayMs: z
    .number()
    .min(0)
    .optional()
    .describe(
      "Start-time offset of this track within the timeline, in ms " +
        "(compiled to animation-delay). Use for staggering layers.",
    ),
  durationMs: z
    .number()
    .positive()
    .optional()
    .describe(
      "This track's own animation span in ms (compiled to a per-track " +
        "animation-duration). Omit to span the whole timeline.",
    ),
  timelinePlaybackMode: z
    .enum(["loop", "once", "ping-pong"])
    .optional()
    .describe(
      "Internal: timeline-level playback mode stamp persisted on the first " +
        "track. Prefer the top-level playbackMode parameter.",
    ),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function resolveMotionTimelineInsertOwnership(args: {
  requestUserEmail?: string | null;
  requestOrgId?: string | null;
  designOwnerEmail?: unknown;
  designOrgId?: unknown;
}): { ownerEmail: string; orgId: string | null } {
  const ownerEmail =
    nonEmptyString(args.requestUserEmail) ??
    nonEmptyString(args.designOwnerEmail);

  if (!ownerEmail) throw new Error("no authenticated user");

  return {
    ownerEmail,
    orgId:
      nonEmptyString(args.requestOrgId) ?? nonEmptyString(args.designOrgId),
  };
}

export function canPatchManagedMotionCss(content: string): boolean {
  return /<\s*(?:!doctype|[a-z][a-z0-9:-]*(?:\s|>|\/>))/i.test(content);
}

// Composite key for detecting duplicate (targetNodeId, property) track pairs.
// Uses the ASCII Unit Separator (U+001F) — an escape in source, so the file
// stays plain text (a literal NUL made tooling treat it as binary). U+001F
// cannot appear in a valid data-agent-native-node-id or CSS property name
// (both are validated to CSS-safe identifiers), so it can never collide with
// real content and remains an unambiguous field delimiter.
const MOTION_TRACK_KEY_SEPARATOR = "\x1f";

export function motionTrackKey(targetNodeId: string, property: string): string {
  return `${targetNodeId}${MOTION_TRACK_KEY_SEPARATOR}${property}`;
}

/**
 * Validate a caller-supplied ease token: CSS-injection safety plus
 * spring-token well-formedness. A string that LOOKS like a spring token but
 * cannot be parsed would otherwise pass injection checks and then be emitted
 * verbatim into the stylesheet as an invalid timing function.
 */
export function assertValidMotionEase(ease: string, field: string): string {
  assertSafeMotionCssToken(ease, field);
  if (/^\s*spring/i.test(ease) && parseSpringToken(ease) === null) {
    throw new Error(
      `Invalid ${field}: "${ease}" is not a valid spring token. ` +
        'Use "spring(bounce)" or "spring(bounce, settle)" with bounce in [0, 1].',
    );
  }
  return ease;
}

/**
 * Persist the patched HTML through the same collab-aware seam as
 * apply-visual-edit.ts / remove-motion-timeline.ts: `writeInlineSourceFile`
 * re-reads the live (collab-authoritative, else SQL) text immediately before
 * its own write and rejects if it no longer matches `expectedVersionHash` —
 * closing the race window where a concurrent editor's change lands between
 * the base read that produced `content` and this persist call. It also bumps
 * `schema.designs.updatedAt` internally, so no separate designs-row bump is
 * needed here (unlike the old raw-SQL `persistFileContent`).
 */
async function persistFileContent(
  file: {
    id: string;
    designId: string;
    filename: string;
    fileType: string;
  },
  content: string,
  expectedVersionHash: string,
): Promise<string> {
  agentEnterDocument(file.id);
  try {
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId: file.designId,
      filename: file.filename,
      fileType: file.fileType,
      content,
      createdAt: null,
      updatedAt: null,
    };
    const result = await writeInlineSourceFile({
      designId: file.designId,
      file: workspaceFile,
      content,
      expectedVersionHash,
    });
    return result.updatedAt;
  } finally {
    agentLeaveDocument(file.id);
  }
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Atomically write a motion timeline to a design. " +
    "Persists the motion_timeline row, compiles tracks to CSS, injects the " +
    "managed <style data-agent-native-motion> block into the design's HTML, " +
    "and updates compiledHash — all in one atomic step. " +
    "Supports the full keyframe model: per-property tracks (translate/scale/" +
    "rotate compose as separate tracks on one node), per-segment easing " +
    "(curves, steps, springs via spring(bounce)), playback modes " +
    "(loop/once/ping-pong), and per-track start offsets/durations for " +
    "staggering. " +
    "This is the durable timeline persist path; preview/scrubbing uses the " +
    "motion-preview postMessage bridge, NOT this action.",
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    fileId: z
      .string()
      .optional()
      .describe(
        "Target design_files.id. Defaults to the design's primary index.html " +
          "when omitted. Required for multi-file designs.",
      ),
    timelineId: z
      .string()
      .optional()
      .describe(
        "Existing motion_timeline.id to update. Omit to create a new timeline.",
      ),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Opaque source ref (fileId for inline, routeId for real apps). " +
          "Stored on the timeline row for scoping.",
      ),
    tracks: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.array(trackSchema).min(1),
      )
      .describe(
        "Animation tracks. Each track targets one DOM element by " +
          "data-agent-native-node-id and animates one CSS property. " +
          `Max ${MAX_MOTION_TRACKS} tracks per timeline.`,
      ),
    durationMs: z
      .number()
      .int()
      .positive()
      .max(
        MAX_MOTION_DURATION_MS,
        `Total animation duration must be at most ${MAX_MOTION_DURATION_MS}ms (${
          MAX_MOTION_DURATION_MS / 1000
        }s).`,
      )
      // Keep in sync with the MotionDock default (DesignEditor
      // motionDurationMs) and get-motion-timeline's CSS-recovery fallback so
      // an omitted duration means the same thing on every surface.
      .default(1000)
      .describe(
        "Total animation duration in milliseconds. " +
          `Capped at ${MAX_MOTION_DURATION_MS}ms (${
            MAX_MOTION_DURATION_MS / 1000
          }s) to guard against runaway/DoS timelines.`,
      ),
    playbackMode: z
      .enum(["loop", "once", "ping-pong"])
      .optional()
      .describe(
        'Timeline playback mode: "loop" repeats, "once" plays a single ' +
          'time, "ping-pong" alternates forward/backward. Omit to keep the ' +
          'timeline\'s existing mode (or "once" for new timelines).',
      ),
    defaultEase: z
      .string()
      .default("ease")
      .describe(
        "Default easing applied to keyframe intervals that omit ease. " +
          'E.g. "ease", "ease-in-out", "cubic-bezier(0.4,0,0.2,1)", or ' +
          '"spring(0.25)".',
      ),
    label: z
      .string()
      .optional()
      .describe("Optional human-readable label for the timeline."),
    includeContent: z
      .boolean()
      .optional()
      .default(false)
      .describe("Include the full patched HTML in the response (large)."),
    currentContent: z
      .string()
      .optional()
      .describe(
        "Current open editor HTML for the target file. When supplied, the " +
          "managed motion CSS is patched into this content instead of the " +
          "last SQL snapshot so in-flight local edits are preserved.",
      ),
  }),
  run: async ({
    designId,
    fileId: fileIdInput,
    timelineId,
    sourceRef,
    tracks,
    durationMs,
    playbackMode,
    defaultEase,
    includeContent,
    currentContent: currentContentInput,
  }) => {
    const access = await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // ── 1. Resolve the target design file ──────────────────────────────────
    const conditions = [eq(schema.designFiles.designId, designId)];
    if (fileIdInput) {
      conditions.push(eq(schema.designFiles.id, fileIdInput));
    } else {
      conditions.push(eq(schema.designFiles.filename, "index.html"));
    }

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...conditions))
      .limit(1);

    if (!file) {
      throw new Error(
        fileIdInput
          ? `Design file not found: ${fileIdInput}`
          : `No index.html found for design: ${designId}`,
      );
    }

    const fileId = file.id;
    const resolvedSourceRef = sourceRef ?? fileId;

    // The EDITABLE base for compiling/injecting CSS: prefer the caller's
    // in-flight editor snapshot when supplied (currentContentInput), else the
    // LIVE collab-authoritative content for this file (not the raw SQL row —
    // a live editor's Y.Text may be ahead of the last SQL snapshot). Either
    // way, `baseVersionHash` is computed from the EXACT string chosen as the
    // base, at this same point in time, so it faithfully represents "what
    // this transform's base was" for the persist's optimistic-concurrency
    // check below — never a fresh re-hash of already-transformed content
    // (that would trivially match itself and prove nothing raced).
    let currentContent: string;
    let baseVersionHash: string;
    if (currentContentInput !== undefined) {
      // Caller supplied their own editor snapshot as the patch base. It may
      // already be stale relative to the live doc — that's fine.
      // writeInlineSourceFile's own guard (via readLiveSourceFile at write
      // time) correctly rejects the write if this base no longer matches
      // live state, exactly as designed for every other caller-supplied-base
      // action (see apply-component-prop-edit.ts / apply-shader-fill.ts).
      currentContent = currentContentInput;
      baseVersionHash = sourceContentHash(currentContent);
    } else {
      const workspaceFileForRead: SourceWorkspaceFile = {
        id: file.id,
        designId: file.designId,
        filename: file.filename,
        fileType: file.fileType,
        content: file.content,
        createdAt: null,
        updatedAt: null,
      };
      const live = await readLiveSourceFile(workspaceFileForRead);
      currentContent = live.content;
      baseVersionHash = live.versionHash;
    }

    // ── 2. Compile tracks → CSS ─────────────────────────────────────────────
    const inputTracks = tracks as MotionTrack[];

    // DoS guards: reject (never silently clamp) before any compilation work
    // so an over-limit request fails fast with a clear, actionable error.
    if (inputTracks.length > MAX_MOTION_TRACKS) {
      throw new Error(
        `Too many motion tracks: ${inputTracks.length} exceeds the ` +
          `${MAX_MOTION_TRACKS}-track limit per timeline. Split the ` +
          "animation across multiple timelines/screens or remove unused tracks.",
      );
    }
    for (const track of inputTracks) {
      if (track.keyframes.length > MAX_MOTION_KEYFRAMES_PER_TRACK) {
        throw new Error(
          `Too many keyframes on track "${track.targetNodeId}"/"${track.property}": ` +
            `${track.keyframes.length} exceeds the ${MAX_MOTION_KEYFRAMES_PER_TRACK}-keyframe ` +
            "limit per track.",
        );
      }
    }

    // Reject CSS-injection vectors in caller-supplied track properties,
    // keyframe values, and easing strings before they are compiled into the
    // managed <style> block. Also reject duplicate (targetNodeId, property)
    // pairs: the compiler derives the animation name from that pair, so a
    // duplicate would silently overwrite the earlier track's keyframes.
    const seenTrackKeys = new Set<string>();
    for (const track of inputTracks) {
      assertSafeMotionCssProperty(track.property, "track.property");
      const trackKey = motionTrackKey(track.targetNodeId, track.property);
      if (seenTrackKeys.has(trackKey)) {
        throw new Error(
          `Duplicate motion track for targetNodeId "${track.targetNodeId}" ` +
            `and property "${track.property}". Each (targetNodeId, property) ` +
            "pair may appear at most once — merge the keyframes into a single track.",
        );
      }
      seenTrackKeys.add(trackKey);
      for (const kf of track.keyframes) {
        assertSafeMotionCssToken(kf.value, "keyframe value");
        if (kf.ease !== undefined) {
          assertValidMotionEase(kf.ease, "keyframe ease");
        }
      }
    }
    assertValidMotionEase(defaultEase, "defaultEase");

    // Persist the timeline-level playback mode as a stamp on the first track
    // so the stored tracks JSON stays a plain (schema-compatible) array. An
    // explicit playbackMode wins; otherwise any stamp already present in the
    // incoming tracks is preserved.
    const typedTracks = playbackMode
      ? withTimelinePlaybackMode(inputTracks, playbackMode)
      : inputTracks;
    const resolvedPlaybackMode: MotionPlaybackMode =
      playbackMode ?? readTimelinePlaybackMode(inputTracks) ?? "once";

    const { css, hash } = compile({
      id: timelineId ?? "",
      designId,
      sourceRef: resolvedSourceRef,
      filePath: null,
      tracks: typedTracks,
      durationMs,
      playbackMode: resolvedPlaybackMode,
      defaultEase,
      compiledHash: null,
      createdAt: now,
      updatedAt: now,
    });

    // ── 3. Inject the managed CSS block into the HTML ───────────────────────
    const contentPatched = canPatchManagedMotionCss(currentContent);
    const patchedContent = contentPatched
      ? injectManagedMotionCss(currentContent, css)
      : currentContent;
    const bytesBefore = currentContent.length;
    const bytesAfter = patchedContent.length;

    // ── 4. Pre-flight the motion_timeline row write ─────────────────────────
    // Resolve everything that can fail (existence + ownership) BEFORE touching
    // content, so we never persist HTML for a row that can't be written.
    const tracksJson = JSON.stringify(typedTracks);
    let existingTimelineId = timelineId;

    let insertOwnerEmail: string | null = null;
    let insertOrgId: string | null = null;

    if (timelineId) {
      // Update existing row — verify it belongs to this design.
      const [existing] = await db
        .select({ id: schema.motionTimeline.id })
        .from(schema.motionTimeline)
        .where(
          and(
            eq(schema.motionTimeline.id, timelineId),
            eq(schema.motionTimeline.designId, designId),
          ),
        )
        .limit(1);

      if (!existing) {
        throw new Error(
          `motion_timeline not found for this design: ${timelineId}`,
        );
      }
    } else {
      const [existingForSource] = await db
        .select({ id: schema.motionTimeline.id })
        .from(schema.motionTimeline)
        .where(
          and(
            eq(schema.motionTimeline.designId, designId),
            eq(schema.motionTimeline.sourceRef, resolvedSourceRef),
          ),
        )
        .orderBy(desc(schema.motionTimeline.updatedAt))
        .limit(1);

      if (existingForSource) {
        existingTimelineId = existingForSource.id;
      } else {
        // Insert new row — derive ownership from the request context, falling
        // back to the already-authorized design owner for local/public editor
        // sessions that do not carry an authenticated request user.
        const insertOwnership = resolveMotionTimelineInsertOwnership({
          requestUserEmail: getRequestUserEmail(),
          requestOrgId: getRequestOrgId(),
          designOwnerEmail: (access.resource as { ownerEmail?: unknown })
            .ownerEmail,
          designOrgId: (access.resource as { orgId?: unknown }).orgId,
        });
        insertOwnerEmail = insertOwnership.ownerEmail;
        insertOrgId = insertOwnership.orgId;
      }
    }

    const resolvedTimelineId = existingTimelineId ?? nanoid();

    // ── 5. Persist the motion_timeline row FIRST (atomic SQL portion) ───────
    // The timeline row is written before the HTML so that a failure in the
    // HTML write step cannot leave the design content mutated without a
    // corresponding row.
    await db.transaction(async (tx) => {
      if (existingTimelineId) {
        await tx
          .update(schema.motionTimeline)
          .set({
            tracks: tracksJson,
            durationMs,
            defaultEase,
            compiledHash: hash,
            sourceRef: resolvedSourceRef,
            updatedAt: now,
          })
          .where(eq(schema.motionTimeline.id, existingTimelineId));
      } else {
        await tx.insert(schema.motionTimeline).values({
          id: resolvedTimelineId,
          designId,
          sourceRef: resolvedSourceRef,
          filePath: null,
          tracks: tracksJson,
          durationMs,
          defaultEase,
          compiledHash: hash,
          ownerEmail: insertOwnerEmail as string,
          orgId: insertOrgId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });

    // ── 6. Persist the patched HTML content SECOND ─────────────────────────
    // Written after the row so a SQL failure here leaves the timeline row
    // accurate (correct tracks + hash) and the stale HTML can be recompiled on
    // the next apply-motion-edit call via compiledHash drift detection.
    // Goes through the collab-aware writeInlineSourceFile seam, conditioned on
    // baseVersionHash (the hash of the SAME base string used above to compile
    // patchedContent), so a concurrent editor's write between that base read
    // and this persist is rejected loud rather than silently overwritten.
    const updatedAt = contentPatched
      ? await persistFileContent(
          {
            id: fileId,
            designId,
            filename: file.filename,
            fileType: file.fileType,
          },
          patchedContent,
          baseVersionHash,
        )
      : now;

    return {
      timelineId: resolvedTimelineId,
      designId,
      fileId,
      sourceRef: resolvedSourceRef,
      trackCount: typedTracks.length,
      playbackMode: resolvedPlaybackMode,
      compiledHash: hash,
      updatedAt,
      bytesBefore,
      bytesAfter,
      bytesDelta: bytesAfter - bytesBefore,
      persisted: true,
      contentPatched,
      patchedContent: includeContent ? patchedContent : undefined,
    };
  },
});
