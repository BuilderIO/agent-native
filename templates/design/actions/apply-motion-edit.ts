import { defineAction, fail } from "@agent-native/core/action";
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
  assertMotionAnimationStyleDefinitions,
  MOTION_ANIMATION_STYLE_MAX_DEFINITIONS,
  MOTION_ANIMATION_STYLE_MAX_KEYFRAMES,
  MOTION_ANIMATION_STYLE_MAX_TOTAL_KEYFRAMES,
  MOTION_ANIMATION_STYLE_MAX_TRACKS,
  type MotionAnimationStyleDefinition,
} from "../shared/motion-animation-styles.js";
import {
  compileMotionCode,
  decodeMotionCodeMetadata,
  motionAudioClipsEndTimeMs,
  MOTION_SOURCE_WRITE_UNAVAILABLE,
} from "../shared/motion-code.js";
import type { MotionAudioClip } from "../shared/motion-code.js";
import {
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
  extractManagedMotionCss,
  injectManagedMotionCss,
} from "../shared/motion-compiler.js";
import { isValidMotionEase } from "../shared/motion-easing.js";
import {
  assertValidMotionEasingVariables,
  type MotionEasingVariable,
} from "../shared/motion-easing.js";
import {
  applyMotionHtmlSourceEdit,
  MotionHtmlSourceError,
  readMotionHtmlSource,
} from "../shared/motion-html-source.js";
import {
  motionNativeStyleEndTimeMs,
  motionTextDocumentWithNativeStyles,
  motionTextDocumentWithoutNativeStyles,
  MotionNativeStyleRuntimeError,
} from "../shared/motion-native-style-runtime.js";
import {
  assertMotionNativeStyleInstances,
  MotionNativeStyleInstanceError,
  type MotionNativeStyleInstance,
} from "../shared/motion-native-style.js";
import {
  applyMotionPathTrimSource,
  MotionPathTrimSourceError,
} from "../shared/motion-path-trim-source.js";
import {
  applyMotionReactSourceEdit,
  MotionReactSourceError,
  readMotionReactSource,
} from "../shared/motion-react-source.js";
import {
  injectMotionTextRuntime,
  MOTION_TEXT_PROPERTIES,
  MOTION_TEXT_UNITS,
  MOTION_TEXT_SOURCE_VERSION,
  encodeMotionTextDocument,
  MotionTextSourceError,
  readMotionTextDocument,
  removeMotionTextRuntime,
  type MotionTextDocument,
} from "../shared/motion-text-code.js";
import type {
  MotionPlaybackMode,
  MotionTimeline,
  MotionTrack,
} from "../shared/motion-timeline.js";
import {
  readTimelinePlaybackMode,
  motionTimelineDurationForContent,
  MOTION_PATH_MAX_CONTROL_OFFSET_PX,
  MOTION_TIMELINE_DEFAULT_DURATION_MS,
  MOTION_TIMELINE_MAX_DURATION_MS,
  parseMotionPosition,
  withTimelinePlaybackMode,
} from "../shared/motion-timeline.js";
import {
  isBridgeSha256VersionHash,
  MotionLocalSourceError,
  resolveMotionLocalSourceLocation,
} from "./_motion-local-source.js";
import {
  isLocalhostBridgeRelay,
  runLocalhostBridgeStep,
  withMotionLocalhostRelayIdentity,
} from "./motion-localhost-relay.js";
import readLocalFileAction from "./read-local-file.js";
import writeLocalFileAction from "./write-local-file.js";

export const MAX_MOTION_TRACKS = 64;
export const MAX_MOTION_KEYFRAMES_PER_TRACK = 128;
export const MAX_MOTION_DURATION_MS = MOTION_TIMELINE_MAX_DURATION_MS;

const motionTextKeyframeSchema = z
  .object({
    t: z.number().min(0).max(1),
    value: z.string(),
    ease: z.string().optional(),
  })
  .strict();

const motionTextDocumentSchema = z
  .object({
    version: z.literal(MOTION_TEXT_SOURCE_VERSION),
    animations: z
      .array(
        z
          .object({
            targetNodeId: z.string(),
            unit: z.enum(MOTION_TEXT_UNITS),
            direction: z.enum(["forward", "reverse"]),
            staggerMs: z.number().min(0).max(5000),
            delayMs: z.number().min(0).max(MAX_MOTION_DURATION_MS).optional(),
            property: z.enum(MOTION_TEXT_PROPERTIES),
            durationMs: z.number().positive().max(MAX_MOTION_DURATION_MS),
            keyframes: z.array(motionTextKeyframeSchema).min(2).max(128),
          })
          .strict(),
      )
      .min(1)
      .max(64),
  })
  .strict();

const motionAudioClipSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .refine(
        (value) =>
          value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value),
        "Must be a non-empty audio clip id",
      ),
    name: z
      .string()
      .min(1)
      .max(240)
      .refine(
        (value) =>
          value.trim().length > 0 && !/[\u0000-\u001f\u007f]/.test(value),
        "Must be a printable audio clip name",
      )
      .optional(),
    sourceUrl: z
      .string()
      .min(1)
      .max(4096)
      .refine(isSafeMotionAudioSourceUrl, "Must be a safe audio URL"),
    timelineStartMs: z.number().finite().min(0).max(MAX_MOTION_DURATION_MS),
    sourceTrimStartMs: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
    durationMs: z.number().finite().positive().max(MAX_MOTION_DURATION_MS),
    volume: z.number().finite().min(0).max(1),
    muted: z.boolean(),
  })
  .strict();

const motionAudioClipsSchema = z
  .array(motionAudioClipSchema)
  .max(64)
  .superRefine((clips, context) => {
    const ids = new Set<string>();
    for (const [index, clip] of clips.entries()) {
      if (ids.has(clip.id)) {
        context.addIssue({
          code: "custom",
          path: [index, "id"],
          message: "Audio clip ids must be unique",
        });
      }
      ids.add(clip.id);
      if (clip.timelineStartMs + clip.durationMs > MAX_MOTION_DURATION_MS) {
        context.addIssue({
          code: "custom",
          path: [index, "durationMs"],
          message: `Audio clips must end by ${MAX_MOTION_DURATION_MS}ms`,
        });
      }
      if (clip.sourceTrimStartMs + clip.durationMs > Number.MAX_SAFE_INTEGER) {
        context.addIssue({
          code: "custom",
          path: [index, "sourceTrimStartMs"],
          message: "Audio trim and duration exceed safe precision",
        });
      }
    }
  });

function isSafeMotionAudioSourceUrl(value: string): boolean {
  if (
    value !== value.trim() ||
    /[\\\u0000-\u0020\u007f]/.test(value) ||
    value.startsWith("//")
  ) {
    return false;
  }
  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(value);
  if (hasScheme && !/^https?:\/\//i.test(value)) return false;
  const baseUrl = "https://motion-source.invalid/";
  if (!URL.canParse(value, baseUrl)) return false;
  const parsed = new URL(value, baseUrl);
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.username.length === 0 &&
    parsed.password.length === 0
  );
}

function failMotionTextSourceError(error: MotionTextSourceError): never {
  return fail(error.message, {
    errorCode: `motion_text_source_${error.code.replace(/-/g, "_")}`,
    statusCode: 422,
  });
}

function failMotionReactSourceError(error: MotionReactSourceError): never {
  return fail(error.message, {
    errorCode: `motion_react_source_${error.code.replace(/-/g, "_")}`,
    statusCode:
      error.code === "stale-source" || error.code === "stale-preview"
        ? 409
        : 422,
  });
}

function failMotionHtmlSourceError(error: MotionHtmlSourceError): never {
  return fail(error.message, {
    errorCode: `motion_html_source_${error.code.replace(/-/g, "_")}`,
    statusCode:
      error.code === "stale-source" || error.code === "stale-preview"
        ? 409
        : 422,
  });
}

function failMotionLocalSourceError(error: MotionLocalSourceError): never {
  return fail(error.message, {
    errorCode: `motion_local_source_${error.code.replace(/-/g, "_")}`,
    statusCode: 422,
  });
}

const motionPathPointSchema = z
  .object({
    x: z
      .number()
      .finite()
      .min(-MOTION_PATH_MAX_CONTROL_OFFSET_PX)
      .max(MOTION_PATH_MAX_CONTROL_OFFSET_PX),
    y: z
      .number()
      .finite()
      .min(-MOTION_PATH_MAX_CONTROL_OFFSET_PX)
      .max(MOTION_PATH_MAX_CONTROL_OFFSET_PX),
  })
  .strict();

const motionPathSchema = z
  .object({
    version: z.literal(1),
    type: z.literal("cubic"),
    control1: motionPathPointSchema,
    control2: motionPathPointSchema,
  })
  .strict()
  .describe(
    "Outgoing cubic Position geometry, separate from temporal easing. Controls are px offsets from the segment start and end values.",
  );

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
      "Easing of the SEGMENT leaving this keyframe toward the next one. " +
        'Accepts CSS keywords ("linear", "ease-out", "step-start" — the ' +
        '"Hold" preset), "cubic-bezier(x1,y1,x2,y2)", "steps(n, pos)", ' +
        'CSS "linear(...)" stop lists, and spring physics as ' +
        '"spring(bounce)" or "spring(bounce, settle)" with bounce in [0, 1] ' +
        "(compiled to a CSS linear() approximation).",
    ),
  motionPath: motionPathSchema.optional(),
});

const motionAnimationStyleKeyframeSchema = keyframeSchema
  .extend({
    value: z.string().max(512),
    ease: z.string().max(512).optional(),
  })
  .strict();

const motionAnimationStyleSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(128)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    name: z.string().min(1).max(120),
    category: z.enum(["basic", "enter", "cycle", "exit"]),
    description: z.string().min(1).max(500).optional(),
    tracks: z
      .array(
        z
          .object({
            property: z.string().min(1).max(128),
            keyframes: z
              .array(motionAnimationStyleKeyframeSchema)
              .min(1)
              .max(MOTION_ANIMATION_STYLE_MAX_KEYFRAMES),
            delayMs: z.number().min(0).max(MAX_MOTION_DURATION_MS).optional(),
            enabled: z.boolean().optional(),
            durationMs: z
              .number()
              .positive()
              .max(MAX_MOTION_DURATION_MS)
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MOTION_ANIMATION_STYLE_MAX_TRACKS),
  })
  .strict();

const motionAnimationStylesSchema = z
  .array(motionAnimationStyleSchema)
  .max(MOTION_ANIMATION_STYLE_MAX_DEFINITIONS)
  .superRefine((styles, context) => {
    const keyframeCount = styles.reduce(
      (total, style) =>
        total +
        style.tracks.reduce(
          (count, track) => count + track.keyframes.length,
          0,
        ),
      0,
    );
    if (keyframeCount > MOTION_ANIMATION_STYLE_MAX_TOTAL_KEYFRAMES) {
      context.addIssue({
        code: "custom",
        message: `animationStyles must contain at most ${MOTION_ANIMATION_STYLE_MAX_TOTAL_KEYFRAMES} keyframes in total`,
      });
    }
  });

const trackSchema = z
  .object({
    targetNodeId: z
      .string()
      .describe(
        "data-agent-native-node-id of the target DOM element. " +
          "Must be stamped on the element (ensureCodeLayerNodeIdsInHtml).",
      ),
    property: z
      .string()
      .describe(
        "CSS property to animate. CSS mapping: translation → " +
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
    enabled: z.boolean().optional(),
    delayMs: z
      .number()
      .min(0)
      .max(MAX_MOTION_DURATION_MS)
      .optional()
      .describe(
        "Start-time offset of this track within the timeline, in ms " +
          "(compiled to animation-delay). Use for staggering layers.",
      ),
    durationMs: z
      .number()
      .positive()
      .max(MAX_MOTION_DURATION_MS)
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
  })
  .superRefine((track, context) => {
    for (const [index, keyframe] of track.keyframes.entries()) {
      if (!keyframe.motionPath) continue;
      if (track.property !== "translate") {
        context.addIssue({
          code: "custom",
          path: ["property"],
          message:
            "Spatial motion paths are only supported for translate tracks.",
        });
      }
      const next = track.keyframes[index + 1];
      if (!next) {
        context.addIssue({
          code: "custom",
          path: ["keyframes", index, "motionPath"],
          message:
            "A motion path must belong to a keyframe with a following keyframe.",
        });
        continue;
      }
      if (
        !parseMotionPosition(keyframe.value) ||
        !parseMotionPosition(next.value)
      ) {
        context.addIssue({
          code: "custom",
          path: ["keyframes", index, "value"],
          message:
            "Spatial motion paths require finite 2D px Position values or unitless zero.",
        });
      }
    }
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
  if (!isValidMotionEase(ease)) {
    fail(
      `Invalid ${field}: "${ease}" is not a supported CSS timing function or Motion spring token.`,
      { errorCode: "motion_invalid_easing", statusCode: 422 },
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
    "Apply one Motion timeline to its Design source and return the timeline id " +
    "and compiled source hash, preserving omitted Text, audio, saved-style, " +
    "and native Figma style data.",
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
    localSource: z
      .object({
        connectionId: z.string().min(1),
        modulePath: z.string().min(1),
        moduleVersionHash: z.string().regex(/^[a-f0-9]{64}$/i),
        renderedNodeIds: z.array(z.string()).max(2048).optional(),
      })
      .strict()
      .optional()
      .describe(
        "Local React/JSX or linked HTML source snapshot from the Vite dev preview. The source " +
          "module path and SHA-256 hash are checked against the selected " +
          "localhost file before writeback. renderedNodeIds is an optional " +
          "legacy hint and is not used to authorize targets; target identity " +
          "is resolved from the live React or HTML source.",
      ),
    tracks: z
      .preprocess(
        (v) => (typeof v === "string" ? JSON.parse(v) : v),
        z.array(trackSchema),
      )
      .describe(
        "CSS animation tracks; an empty array clears CSS tracks and supports " +
          "a text-only timeline when textDocument contains animations. Each " +
          "track targets one DOM element by " +
          "data-agent-native-node-id and animates one CSS property. " +
          `Max ${MAX_MOTION_TRACKS} tracks per timeline.`,
      ),
    textDocument: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        motionTextDocumentSchema.nullable(),
      )
      .optional()
      .describe(
        "Versioned Text animation source for static inline or linked HTML, or React JSX. " +
          "Omit to preserve existing text animations, provide a document to " +
          "replace them, or provide null to remove them. React targets must " +
          "have static JSX text children.",
      ),
    audioClips: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        motionAudioClipsSchema,
      )
      .optional()
      .describe(
        "Source-backed audio clips. Omit to preserve existing clips; provide " +
          "an array to replace them or [] to clear them. Audio bytes stay in " +
          "hosted file storage; sourceUrl must reference that file.",
      ),
    animationStyles: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        motionAnimationStylesSchema,
      )
      .optional()
      .describe(
        "Target-independent composite Motion styles stored in the versioned " +
          "source metadata. Omit to preserve the current library; provide an " +
          "array to replace it; use [] to clear it while other timeline motion remains.",
      ),
    nativeStyles: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z.unknown(),
      )
      .optional()
      .describe(
        "Lossless native Figma Motion style instances stored in the versioned " +
          "source metadata. Omit to preserve existing instances; provide an " +
          "array to replace them or [] to clear them.",
      ),
    easingVariables: z
      .preprocess(
        (value) => (typeof value === "string" ? JSON.parse(value) : value),
        z.unknown(),
      )
      .optional()
      .describe(
        "Named easing variables stored in the versioned Motion source document. " +
          "Omit to preserve the current library; provide an array to replace it, " +
          "or [] to clear it.",
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
      .default(MOTION_TIMELINE_DEFAULT_DURATION_MS)
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
  run: async (args, context) => {
    context = withMotionLocalhostRelayIdentity(
      context,
      "apply-motion-edit",
      args,
    );
    const {
      designId,
      fileId: fileIdInput,
      timelineId,
      sourceRef,
      localSource: localSourceInput,
      tracks,
      textDocument: textDocumentInput,
      audioClips: audioClipsInput,
      animationStyles: animationStylesInput,
      nativeStyles: nativeStylesInput,
      easingVariables: easingVariablesInput,
      durationMs: requestedDurationMs,
      playbackMode,
      defaultEase,
      includeContent,
      currentContent: currentContentInput,
      revision,
    } = args;
    const access = await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    if (localSourceInput && !sourceRef) {
      fail(
        "Local Motion source edits require the selected localhost screen as sourceRef.",
        { errorCode: "motion_local_source_screen_required", statusCode: 422 },
      );
    }
    if (
      localSourceInput &&
      fileIdInput !== undefined &&
      fileIdInput !== sourceRef
    ) {
      fail(
        "The requested source file does not match the selected localhost screen.",
        { errorCode: "motion_local_source_screen_mismatch", statusCode: 422 },
      );
    }

    const conditions = [eq(schema.designFiles.designId, designId)];
    if (localSourceInput && sourceRef) {
      conditions.push(eq(schema.designFiles.id, sourceRef));
    } else if (fileIdInput) {
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
        designData: schema.designs.data,
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

    const isInlineHtml =
      !localSourceInput &&
      file.fileType === "html" &&
      /\.html?$/i.test(file.filename);
    if (!isInlineHtml && !localSourceInput) {
      if (textDocumentInput !== undefined) {
        fail(
          "Motion Text source writes are available only for inline HTML files; React and JSX source writes are unavailable.",
          {
            errorCode: "motion_text_source_write_unavailable",
            statusCode: 422,
          },
        );
      }
      fail(
        `${MOTION_SOURCE_WRITE_UNAVAILABLE}: Motion code writes currently work only in inline HTML files; React and JSX source writes are unavailable.`,
        {
          errorCode: MOTION_SOURCE_WRITE_UNAVAILABLE,
          statusCode: 422,
        },
      );
    }

    let localSourceLocation: ReturnType<
      typeof resolveMotionLocalSourceLocation
    > | null = null;
    let localBridgeVersionHash: string | null = null;
    let currentContent: string;
    let baseVersionHash: string;
    if (localSourceInput) {
      if (currentContentInput !== undefined || revision !== undefined) {
        fail(
          "Local Motion source edits read the current source through the localhost bridge; currentContent and revision are not accepted.",
          {
            errorCode: "motion_local_source_inline_snapshot_unsupported",
            statusCode: 422,
          },
        );
      }
      try {
        localSourceLocation = resolveMotionLocalSourceLocation({
          designData: file.designData,
          screenId: resolvedSourceRef,
          declaration: {
            connectionId: localSourceInput.connectionId,
            filePath: localSourceInput.modulePath,
          },
        });
      } catch (error) {
        if (error instanceof MotionLocalSourceError) {
          failMotionLocalSourceError(error);
        }
        throw error;
      }
      const provenance = await runLocalhostBridgeStep({
        action: readLocalFileAction,
        actionArgs: {
          designId,
          connectionId: localSourceLocation.connectionId,
          path: localSourceLocation.filePath,
          motionScreenId: resolvedSourceRef,
        },
        context,
        step: "source-provenance",
      });
      if (isLocalhostBridgeRelay(provenance)) return provenance;
      if (provenance.reachable !== true) {
        fail(
          "The React Motion module is not in the selected screen's saved import graph.",
          {
            errorCode: "motion_local_source_module_not_imported",
            statusCode: 422,
          },
        );
      }
      const live = await runLocalhostBridgeStep({
        action: readLocalFileAction,
        actionArgs: {
          designId,
          connectionId: localSourceLocation.connectionId,
          path: localSourceLocation.filePath,
        },
        context,
        step: "source-read",
      });
      if (isLocalhostBridgeRelay(live)) return live;
      if (!isBridgeSha256VersionHash(live.versionHash)) {
        fail(
          "The localhost bridge did not return a SHA-256 source version hash; no source was written.",
          {
            errorCode: "motion_local_source_version_unavailable",
            statusCode: 502,
          },
        );
      }
      if (localSourceInput.moduleVersionHash !== live.versionHash) {
        fail(
          "The localhost preview or source changed after the target identities were captured. Refresh the preview and retry.",
          { errorCode: "motion_local_source_stale_preview", statusCode: 409 },
        );
      }
      currentContent = live.content;
      baseVersionHash = live.versionHash;
      localBridgeVersionHash = live.versionHash;
    } else {
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
      currentContent = prepared.content;
      baseVersionHash = prepared.expectedVersionHash;
    }

    const isLocalHtmlSource = Boolean(
      localSourceLocation && /\.html?$/i.test(localSourceLocation.filePath),
    );
    const currentReactRead =
      localSourceLocation && !isLocalHtmlSource
        ? readMotionReactSource(currentContent)
        : null;
    if (currentReactRead?.status === "invalid") {
      failMotionReactSourceError(currentReactRead.error);
    }
    const currentHtmlRead = isLocalHtmlSource
      ? readMotionHtmlSource(currentContent)
      : null;
    if (currentHtmlRead?.status === "invalid") {
      failMotionHtmlSourceError(currentHtmlRead.error);
    }
    const currentTextRead = isInlineHtml
      ? readMotionTextDocument(currentContent)
      : { status: "absent" as const };
    if (currentTextRead.status === "invalid") {
      failMotionTextSourceError(currentTextRead.error);
    }
    const sourceTextDocument: MotionTextDocument | null =
      textDocumentInput === undefined
        ? currentReactRead?.status === "valid"
          ? currentReactRead.textDocument
          : currentHtmlRead?.status === "valid"
            ? currentHtmlRead.textDocument
            : currentTextRead.status === "valid"
              ? currentTextRead.document
              : null
        : textDocumentInput;

    const inlineMotionCss = isInlineHtml
      ? extractManagedMotionCss(currentContent)
      : null;
    const inlineMotionMetadata = isInlineHtml
      ? decodeMotionCodeMetadata(inlineMotionCss ?? "")
      : null;
    if (inlineMotionMetadata?.status === "invalid") {
      fail(inlineMotionMetadata.error.message, {
        errorCode: `motion_source_${inlineMotionMetadata.error.code.replace(/-/g, "_")}`,
        statusCode: 422,
      });
    }
    const existingAnimationStyles =
      currentReactRead?.status === "valid"
        ? (currentReactRead.document?.animationStyles ?? [])
        : currentHtmlRead?.status === "valid"
          ? (currentHtmlRead.document?.animationStyles ?? [])
          : inlineMotionMetadata?.status === "valid"
            ? (inlineMotionMetadata.document.animationStyles ?? [])
            : [];
    const existingNativeStyles =
      currentReactRead?.status === "valid"
        ? (currentReactRead.document?.nativeStyles ?? [])
        : currentHtmlRead?.status === "valid"
          ? (currentHtmlRead.document?.nativeStyles ?? [])
          : inlineMotionMetadata?.status === "valid"
            ? (inlineMotionMetadata.document.nativeStyles ?? [])
            : [];
    let textDocument: MotionTextDocument | null =
      textDocumentInput === undefined ? sourceTextDocument : textDocumentInput;
    if (textDocumentInput === undefined) {
      try {
        textDocument = motionTextDocumentWithoutNativeStyles(
          sourceTextDocument,
          existingNativeStyles,
        );
      } catch (error) {
        if (error instanceof MotionNativeStyleRuntimeError) {
          fail(error.message, {
            errorCode: `motion_native_style_${error.code.replace(/-/g, "_")}`,
            statusCode: 422,
          });
        }
        throw error;
      }
    }
    const existingEasingVariables =
      currentReactRead?.status === "valid"
        ? (currentReactRead.document?.easingVariables ?? [])
        : currentHtmlRead?.status === "valid"
          ? (currentHtmlRead.document?.easingVariables ?? [])
          : inlineMotionMetadata?.status === "valid"
            ? (inlineMotionMetadata.document.easingVariables ?? [])
            : [];
    const existingMotionDocument =
      currentReactRead?.status === "valid"
        ? currentReactRead.document
        : currentHtmlRead?.status === "valid"
          ? (currentHtmlRead.document ?? undefined)
          : inlineMotionMetadata?.status === "valid"
            ? inlineMotionMetadata.document
            : undefined;
    const existingAudioClips = existingMotionDocument?.audioClips ?? [];
    const audioClips: MotionAudioClip[] =
      audioClipsInput === undefined
        ? existingAudioClips
        : (audioClipsInput as MotionAudioClip[]);
    const sourceAudioClips =
      audioClipsInput !== undefined ||
      existingMotionDocument?.audioClips !== undefined
        ? audioClips
        : undefined;
    let audioEndMs = 0;
    try {
      audioEndMs = motionAudioClipsEndTimeMs(audioClips);
    } catch (error) {
      fail(
        error instanceof Error ? error.message : "Invalid Motion audio clips.",
        { errorCode: "motion_audio_clips_invalid", statusCode: 422 },
      );
    }
    const easingVariables: MotionEasingVariable[] =
      easingVariablesInput === undefined
        ? existingEasingVariables
        : (easingVariablesInput as MotionEasingVariable[]);
    try {
      assertValidMotionEasingVariables(easingVariables);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Invalid Motion easing variables.",
        { errorCode: "motion_easing_variables_invalid", statusCode: 422 },
      );
    }
    const nativeStyles: MotionNativeStyleInstance[] =
      nativeStylesInput === undefined
        ? existingNativeStyles
        : (nativeStylesInput as MotionNativeStyleInstance[]);
    try {
      assertMotionNativeStyleInstances(nativeStyles);
    } catch (error) {
      fail(
        error instanceof MotionNativeStyleInstanceError
          ? `${error.message}${error.path ? ` (${error.path})` : ""}`
          : "Invalid native Figma Motion styles.",
        {
          errorCode: "motion_native_style_invalid",
          statusCode: 422,
        },
      );
    }
    let runtimeTextDocument: MotionTextDocument | null;
    try {
      runtimeTextDocument = motionTextDocumentWithNativeStyles(
        textDocument,
        nativeStyles,
      );
    } catch (error) {
      if (error instanceof MotionNativeStyleRuntimeError) {
        fail(error.message, {
          errorCode: `motion_native_style_${error.code.replace(/-/g, "_")}`,
          statusCode: 422,
        });
      }
      throw error;
    }
    const animationStyles: MotionAnimationStyleDefinition[] =
      animationStylesInput ?? existingAnimationStyles;
    try {
      assertMotionAnimationStyleDefinitions(animationStyles, easingVariables);
    } catch (error) {
      fail(
        error instanceof Error
          ? error.message
          : "Invalid Motion animation styles.",
        {
          errorCode: "motion_animation_style_invalid",
          statusCode: 422,
        },
      );
    }

    let textDocumentJson: string | null = null;
    if (textDocument) {
      try {
        textDocumentJson = encodeMotionTextDocument(textDocument);
      } catch (error) {
        if (error instanceof MotionTextSourceError) {
          failMotionTextSourceError(error);
        }
        throw error;
      }
    }

    const inputTracks = tracks as MotionTrack[];

    if (
      inputTracks.length === 0 &&
      !textDocument &&
      audioClips.length === 0 &&
      animationStyles.length === 0 &&
      nativeStyles.length === 0
    ) {
      fail(
        "A timeline with no CSS tracks must contain a Text animation, a saved Motion style, or a native Figma style.",
        {
          errorCode: "motion_text_source_required",
          statusCode: 422,
        },
      );
    }

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

    const durationMs = Math.ceil(
      Math.max(
        motionTimelineDurationForContent(
          requestedDurationMs,
          inputTracks,
          textDocument?.animations ?? [],
        ),
        ...nativeStyles.map(motionNativeStyleEndTimeMs),
        audioEndMs,
      ),
    );
    if (durationMs > MAX_MOTION_DURATION_MS) {
      fail(
        `The timeline content ends at ${durationMs}ms, which exceeds the ${MAX_MOTION_DURATION_MS}ms limit. Reduce a track delay or duration.`,
        { errorCode: "motion_timeline_duration_exceeded", statusCode: 422 },
      );
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

    const sourceTimeline: MotionTimeline = {
      id: timelineId ?? "",
      designId,
      sourceRef: resolvedSourceRef,
      filePath: localSourceLocation?.filePath ?? null,
      tracks: typedTracks,
      durationMs,
      playbackMode: resolvedPlaybackMode,
      defaultEase,
      compiledHash: null,
      ...(animationStyles.length > 0 ? { animationStyles } : {}),
      ...(nativeStyles.length > 0 ? { nativeStyles } : {}),
      createdAt: now,
      updatedAt: now,
    };

    let reactSourceEdit: ReturnType<typeof applyMotionReactSourceEdit> | null =
      null;
    let htmlSourceEdit: ReturnType<typeof applyMotionHtmlSourceEdit> | null =
      null;
    let compiled: ReturnType<typeof compileMotionCode>;
    if (localSourceLocation && localSourceInput) {
      try {
        if (isLocalHtmlSource) {
          htmlSourceEdit = applyMotionHtmlSourceEdit({
            currentSource: currentContent,
            expectedSource: currentContent,
            preview: { sourceHash: localSourceInput.moduleVersionHash },
            sourceFilePath: localSourceLocation.filePath,
            timeline: sourceTimeline,
            textDocument: runtimeTextDocument,
            easingVariables,
            audioClips: sourceAudioClips,
          });
        } else {
          reactSourceEdit = applyMotionReactSourceEdit({
            currentSource: currentContent,
            expectedSource: currentContent,
            // The bridge SHA-256 checks above authorize the snapshot and CAS base.
            // This helper hash is only an internal consistency check.
            preview: {
              sourceHash: localSourceInput.moduleVersionHash,
            },
            modulePath: localSourceLocation.filePath,
            timeline: sourceTimeline,
            textDocument: runtimeTextDocument,
            easingVariables,
            audioClips: sourceAudioClips,
          });
        }
      } catch (error) {
        if (error instanceof MotionReactSourceError) {
          failMotionReactSourceError(error);
        }
        if (error instanceof MotionHtmlSourceError) {
          failMotionHtmlSourceError(error);
        }
        if (error instanceof MotionNativeStyleRuntimeError) {
          fail(error.message, {
            errorCode: `motion_native_style_${error.code.replace(/-/g, "_")}`,
            statusCode: 422,
          });
        }
        throw error;
      }
      const sourceEdit = htmlSourceEdit ?? reactSourceEdit;
      if (!sourceEdit) {
        // guard:allow-bare-error — invariant: the validated source extension selects exactly one adapter above.
        throw new Error("Motion source adapter did not return an edit.");
      }
      compiled = { css: sourceEdit.css, hash: sourceEdit.hash };
    } else {
      try {
        compiled = compileMotionCode(sourceTimeline, {
          easingVariables,
          ...(sourceAudioClips !== undefined
            ? { audioClips: sourceAudioClips }
            : {}),
        });
      } catch (error) {
        if (error instanceof MotionNativeStyleRuntimeError) {
          fail(error.message, {
            errorCode: `motion_native_style_${error.code.replace(/-/g, "_")}`,
            statusCode: 422,
          });
        }
        throw error;
      }
    }
    const { css, hash } = compiled;

    if (
      !reactSourceEdit &&
      !htmlSourceEdit &&
      !canPatchManagedMotionCss(currentContent)
    ) {
      fail(
        `${MOTION_SOURCE_WRITE_UNAVAILABLE}: Motion code writes currently work only in inline HTML designs.`,
        {
          errorCode: MOTION_SOURCE_WRITE_UNAVAILABLE,
          statusCode: 422,
        },
      );
    }
    const contentPatched = true;
    let patchedContent = reactSourceEdit
      ? reactSourceEdit.source
      : htmlSourceEdit
        ? htmlSourceEdit.source
        : injectManagedMotionCss(currentContent, css);
    if (!localSourceLocation && !htmlSourceEdit) {
      try {
        if (runtimeTextDocument) {
          patchedContent = injectMotionTextRuntime(
            patchedContent,
            runtimeTextDocument,
            resolvedPlaybackMode,
          );
        } else if (
          currentTextRead.status === "valid" ||
          textDocumentInput === null
        ) {
          patchedContent = removeMotionTextRuntime(patchedContent);
        }
      } catch (error) {
        if (error instanceof MotionTextSourceError) {
          failMotionTextSourceError(error);
        }
        throw error;
      }
    }
    try {
      const pathTrimTargetNodeIds = [
        ...typedTracks
          .filter((track) => track.property === "path-trim")
          .map((track) => track.targetNodeId),
        ...nativeStyles
          .filter(
            (style) => style.styleKey === "Path" && style.enabled !== false,
          )
          .map((style) => style.targetNodeId),
      ];
      if (!htmlSourceEdit) {
        patchedContent = applyMotionPathTrimSource(
          patchedContent,
          [...new Set(pathTrimTargetNodeIds)],
          localSourceLocation ? "tsx" : "html",
        );
      }
    } catch (error) {
      if (error instanceof MotionPathTrimSourceError) {
        fail(error.message, {
          errorCode: `motion_path_trim_source_${error.code.replace(/-/g, "_")}`,
          statusCode: 422,
        });
      }
      throw error;
    }
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

    let updatedAt: string;
    if (localSourceLocation) {
      const write = await runLocalhostBridgeStep({
        action: writeLocalFileAction,
        actionArgs: {
          designId,
          connectionId: localSourceLocation.connectionId,
          relPath: localSourceLocation.filePath,
          content: patchedContent,
          expectedVersionHash: baseVersionHash,
          requireExpectedVersionHash: true,
        },
        context,
        step: "source-write",
        beforeStep: () => snapshotDesignBeforeAgentEdit(designId, context),
      });
      if (isLocalhostBridgeRelay(write)) return write;
      if (!write.written || !isBridgeSha256VersionHash(write.versionHash)) {
        fail(
          "The localhost bridge did not confirm the React source write with a new SHA-256 version hash.",
          {
            errorCode: "motion_local_source_write_unconfirmed",
            statusCode: 502,
          },
        );
      }
      localBridgeVersionHash = write.versionHash;
      updatedAt = now;
    } else {
      await snapshotDesignBeforeAgentEdit(designId, context);
      // Inline source is canonical; the SQL row is a recoverable index.
      updatedAt = await persistFileContent(
        {
          id: fileId,
          designId,
          filename: file.filename,
          fileType: file.fileType,
        },
        patchedContent,
        baseVersionHash,
      );
    }

    await db.transaction(async (tx) => {
      if (existingTimelineId) {
        await tx
          .update(schema.motionTimeline)
          .set({
            tracks: tracksJson,
            textDocument: localSourceLocation ? textDocumentJson : null,
            durationMs,
            defaultEase,
            compiledHash: hash,
            sourceRef: resolvedSourceRef,
            filePath: localSourceLocation?.filePath ?? null,
            updatedAt: now,
          })
          .where(eq(schema.motionTimeline.id, existingTimelineId));
      } else {
        await tx.insert(schema.motionTimeline).values({
          id: resolvedTimelineId,
          designId,
          sourceRef: resolvedSourceRef,
          filePath: localSourceLocation?.filePath ?? null,
          tracks: tracksJson,
          textDocument: localSourceLocation ? textDocumentJson : null,
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

    return {
      timelineId: resolvedTimelineId,
      designId,
      fileId,
      sourceRef: resolvedSourceRef,
      sourceType: localSourceLocation ? "localhost" : "inline",
      filePath: localSourceLocation?.filePath ?? null,
      versionHash: localBridgeVersionHash ?? undefined,
      trackCount: typedTracks.length,
      textAnimationCount: textDocument?.animations.length ?? 0,
      audioClipCount: audioClips.length,
      audioClips,
      animationStyleCount: animationStyles.length,
      playbackMode: resolvedPlaybackMode,
      compiledHash: hash,
      updatedAt,
      bytesBefore,
      bytesAfter,
      bytesDelta: bytesAfter - bytesBefore,
      persisted: true,
      contentPatched: localSourceLocation ? false : contentPatched,
      sourcePatched: Boolean(localSourceLocation),
      patchedContent:
        includeContent && !localSourceLocation ? patchedContent : undefined,
      sourceContent:
        includeContent && localSourceLocation ? patchedContent : undefined,
    };
  },
});
