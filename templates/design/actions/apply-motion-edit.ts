
import { defineAction } from "@agent-native/core/action";
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
import "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  prepareInlineSourceEdit,
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


export const MAX_MOTION_TRACKS = 64;
export const MAX_MOTION_KEYFRAMES_PER_TRACK = 128;
export const MAX_MOTION_DURATION_MS = 120_000;


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
          "last SQL snapshot so in-flight local edits are preserved. " +
          "revision must also be supplied.",
      ),
    revision: z
      .string()
      .optional()
      .describe(
        "design_files.updatedAt value the currentContent is based on. " +
          "Required when currentContent is supplied.",
      ),
  }),
  run: async (
    {
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
      revision,
    },
    context,
  ) => {
    const access = await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const db = getDb();
    const now = new Date().toISOString();

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
        updatedAt: schema.designFiles.updatedAt,
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

    const prepared = await prepareInlineSourceEdit({
      file: {
        id: file.id,
        designId: file.designId,
        filename: file.filename,
        fileType: file.fileType,
        content: file.content,
        createdAt: null,
        updatedAt: file.updatedAt,
      },
      currentContent: currentContentInput,
      revision,
    });
    const currentContent = prepared.content;
    const baseVersionHash = prepared.expectedVersionHash;

    const inputTracks = tracks as MotionTrack[];

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

    const contentPatched = canPatchManagedMotionCss(currentContent);
    const patchedContent = contentPatched
      ? injectManagedMotionCss(currentContent, css)
      : currentContent;
    const bytesBefore = currentContent.length;
    const bytesAfter = patchedContent.length;

    const tracksJson = JSON.stringify(typedTracks);
    let existingTimelineId = timelineId;

    let insertOwnerEmail: string | null = null;
    let insertOrgId: string | null = null;

    if (timelineId) {
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
