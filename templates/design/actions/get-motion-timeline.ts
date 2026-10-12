import {
  defineAction,
  fail,
  type ActionRunContext,
} from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import {
  readLiveSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";
import type { MotionAnimationStyleDefinition } from "../shared/motion-animation-styles.js";
import {
  decodeMotionCodeMetadata,
  type MotionCodeDocument,
  type MotionAudioClip,
} from "../shared/motion-code.js";
import {
  extractManagedMotionCss,
  hashCss,
  MotionCssSourceParseError,
  parse,
  parseFirstAnimationDurationMs,
  parsePlaybackMode,
  parseTimelineSpanMs,
} from "../shared/motion-compiler.js";
import type { MotionEasingVariable } from "../shared/motion-easing.js";
import {
  inspectMotionHtmlSourceWriteCapability,
  readMotionHtmlSource,
  type MotionHtmlSourceWriteCapability,
} from "../shared/motion-html-source.js";
import { motionTextDocumentWithoutNativeStyles } from "../shared/motion-native-style-runtime.js";
import type { MotionNativeStyleInstance } from "../shared/motion-native-style.js";
import {
  inspectMotionReactSourceWriteCapability,
  readMotionReactSource,
  type MotionReactSourceWriteCapability,
} from "../shared/motion-react-source.js";
import {
  decodeMotionTextDocument,
  readMotionTextDocument,
  type MotionTextDocument,
} from "../shared/motion-text-code.js";
import type {
  MotionPlaybackMode,
  MotionTrack,
} from "../shared/motion-timeline.js";
import {
  MOTION_DEFAULT_PLAYBACK_MODE,
  MOTION_TIMELINE_DEFAULT_DURATION_MS,
  motionTimelineDurationForContent,
  readTimelinePlaybackMode,
} from "../shared/motion-timeline.js";
import { designSourceTypeFromData } from "../shared/source-mode.js";
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

type TimelineSource =
  | "stored"
  | "recovered-css"
  | "stored-css-drift"
  | "recovered-react"
  | "stored-react-drift"
  | "recovered-html"
  | "stored-html-drift"
  | "stored-local-unverified";

interface TimelineResult {
  id: string | null;
  designId: string;
  sourceRef: string | null;
  filePath: string | null;
  tracks: unknown;
  durationMs: number;
  playbackMode: MotionPlaybackMode;
  defaultEase: string;
  compiledHash: string | null;
  cssHash?: string | null;
  animationStyles: MotionAnimationStyleDefinition[];
  nativeStyles: MotionNativeStyleInstance[];
  easingVariables: MotionEasingVariable[];
  audioClips: MotionAudioClip[];
  textDocument: MotionTextDocument | null;
  sourceVersionHash?: string | null;
  source: TimelineSource;
  createdAt: string | null;
  updatedAt: string | null;
}

function parseTrackJson(raw: string | null): MotionTrack[] {
  if (raw === null) {
    fail("Stored motion timeline is missing its tracks JSON.", {
      errorCode: "motion_timeline_corrupt",
      statusCode: 500,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("Stored motion timeline tracks are not valid JSON.", {
      errorCode: "motion_timeline_corrupt",
      statusCode: 500,
    });
  }
  if (!Array.isArray(parsed)) {
    fail("Stored motion timeline tracks must be an array.", {
      errorCode: "motion_timeline_corrupt",
      statusCode: 500,
    });
  }
  return parsed as MotionTrack[];
}

function parseStoredMotionTextDocument(
  raw: string | null | undefined,
): MotionTextDocument | null {
  if (raw == null) return null;
  const parsed = decodeMotionTextDocument(raw);
  if (parsed.status === "invalid") {
    fail(`Stored Motion Text document is invalid: ${parsed.error.message}`, {
      errorCode: "motion_timeline_corrupt",
      statusCode: 500,
    });
  }
  if (parsed.status === "absent") {
    fail("Stored Motion Text document is empty.", {
      errorCode: "motion_timeline_corrupt",
      statusCode: 500,
    });
  }
  return parsed.document;
}

type ManagedCssSource = {
  css: string;
  hash: string | null;
  tracks: MotionTrack[];
  animationStyles: MotionAnimationStyleDefinition[];
  nativeStyles: MotionNativeStyleInstance[];
  easingVariables: MotionEasingVariable[];
  audioClips: MotionAudioClip[];
  textDocument: MotionTextDocument | null;
  durationMs: number | null;
  playbackMode: MotionPlaybackMode | null;
  defaultEase: string | null;
  filePath?: string | null;
  sourceVersionHash?: string | null;
  source?: "react" | "html";
};

const INLINE_SOURCE_PAGE_SIZE = 50;

class InvalidManagedMotionSourceError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "InvalidManagedMotionSourceError";
  }
}

interface ManagedSourceRecoveryIssue {
  sourceRef: string;
  errorCode: string;
  message: string;
}

function invalidManagedSource(
  errorCode: string,
  error: Error | string,
): InvalidManagedMotionSourceError {
  const message = typeof error === "string" ? error : error.message;
  return new InvalidManagedMotionSourceError(errorCode, message);
}

function parseLegacyMotionCss(css: string): MotionTrack[] {
  try {
    return parse(css).filter(
      (track) =>
        track.keyframes.length > 0 &&
        track.keyframes.every((keyframe) => keyframe.value.trim().length > 0),
    );
  } catch (error) {
    if (error instanceof MotionCssSourceParseError) {
      throw invalidManagedSource("motion_css_source_unreadable", error);
    }
    throw error;
  }
}

async function readManagedCssFromFile(
  file: SourceWorkspaceFile,
): Promise<ManagedCssSource | null> {
  const { content } = await readLiveSourceFile(file);
  const textRead =
    file.fileType === "html" && /\.html?$/i.test(file.filename)
      ? readMotionTextDocument(content)
      : { status: "absent" as const };
  if (textRead.status === "invalid") {
    throw invalidManagedSource(
      `motion_text_source_${textRead.error.code.replace(/-/g, "_")}`,
      textRead.error,
    );
  }
  const textDocument = textRead.status === "valid" ? textRead.document : null;
  const css = extractManagedMotionCss(content);
  if (!css) {
    return textDocument
      ? {
          css: "",
          hash: null,
          tracks: [],
          animationStyles: [],
          nativeStyles: [],
          easingVariables: [],
          audioClips: [],
          textDocument,
          durationMs: null,
          playbackMode: null,
          defaultEase: null,
        }
      : null;
  }

  const metadata = decodeMotionCodeMetadata(css);
  if (metadata.status === "invalid") {
    throw invalidManagedSource(
      `motion_source_${metadata.error.code.replace(/-/g, "_")}`,
      metadata.error,
    );
  }

  const tracks =
    metadata.status === "valid"
      ? metadata.document.tracks
      : parseLegacyMotionCss(css);
  const animationStyles =
    metadata.status === "valid"
      ? (metadata.document.animationStyles ?? [])
      : [];
  const nativeStyles =
    metadata.status === "valid" ? (metadata.document.nativeStyles ?? []) : [];
  const authoredTextDocument = motionTextDocumentWithoutNativeStyles(
    textDocument,
    nativeStyles,
  );
  const easingVariables =
    metadata.status === "valid"
      ? (metadata.document.easingVariables ?? [])
      : [];
  const audioClips =
    metadata.status === "valid" ? (metadata.document.audioClips ?? []) : [];
  if (
    tracks.length === 0 &&
    !authoredTextDocument &&
    metadata.status !== "valid"
  ) {
    throw invalidManagedSource(
      "motion_source_metadata_missing",
      "Managed inline Motion CSS is missing its versioned source document.",
    );
  }

  return {
    css,
    hash: hashCss(css),
    tracks,
    animationStyles,
    nativeStyles,
    easingVariables,
    audioClips,
    textDocument: authoredTextDocument,
    durationMs:
      metadata.status === "valid"
        ? metadata.document.durationMs
        : (parseTimelineSpanMs(css) ?? parseFirstAnimationDurationMs(css)),
    playbackMode:
      metadata.status === "valid"
        ? (metadata.document.playbackMode ??
          readTimelinePlaybackMode(metadata.document.tracks) ??
          parsePlaybackMode(css))
        : parsePlaybackMode(css),
    defaultEase:
      metadata.status === "valid" ? metadata.document.defaultEase : null,
  };
}

async function readManagedCssForSource(args: {
  designId: string;
  sourceRef?: string;
}): Promise<ManagedCssSource | null> {
  if (!args.sourceRef) return null;

  const db = getDb();
  const [file] = await db
    .select({
      id: schema.designFiles.id,
      designId: schema.designFiles.designId,
      filename: schema.designFiles.filename,
      fileType: schema.designFiles.fileType,
      content: schema.designFiles.content,
      createdAt: schema.designFiles.createdAt,
      updatedAt: schema.designFiles.updatedAt,
    })
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.designId, args.designId),
        eq(schema.designFiles.id, args.sourceRef),
      ),
    )
    .limit(1);

  if (!file) return null;

  try {
    return await readManagedCssFromFile(file);
  } catch (error) {
    if (error instanceof InvalidManagedMotionSourceError) {
      fail(error.message, { errorCode: error.errorCode, statusCode: 422 });
    }
    throw error;
  }
}

async function readUnindexedManagedInlineSources(args: {
  designId: string;
  indexedSourceRefs: ReadonlySet<string>;
}): Promise<{
  recovered: Array<{ sourceRef: string; managedCss: ManagedCssSource }>;
  recoveryErrors: ManagedSourceRecoveryIssue[];
}> {
  const recovered: Array<{
    sourceRef: string;
    managedCss: ManagedCssSource;
  }> = [];
  const recoveryErrors: ManagedSourceRecoveryIssue[] = [];

  let afterId: string | undefined;
  while (true) {
    const conditions = [
      eq(schema.designFiles.designId, args.designId),
      eq(schema.designFiles.fileType, "html"),
    ];
    if (afterId) conditions.push(gt(schema.designFiles.id, afterId));

    const files = await getDb()
      .select({
        id: schema.designFiles.id,
        designId: schema.designFiles.designId,
        filename: schema.designFiles.filename,
        fileType: schema.designFiles.fileType,
        content: schema.designFiles.content,
        createdAt: schema.designFiles.createdAt,
        updatedAt: schema.designFiles.updatedAt,
      })
      .from(schema.designFiles)
      .where(and(...conditions))
      .orderBy(asc(schema.designFiles.id))
      .limit(INLINE_SOURCE_PAGE_SIZE);

    if (files.length === 0) break;
    afterId = files[files.length - 1]!.id;

    for (const file of files) {
      if (args.indexedSourceRefs.has(file.id)) continue;
      try {
        const managedCss = await readManagedCssFromFile(file);
        if (managedCss) recovered.push({ sourceRef: file.id, managedCss });
      } catch (error) {
        if (!(error instanceof InvalidManagedMotionSourceError)) throw error;
        recoveryErrors.push({
          sourceRef: file.id,
          errorCode: error.errorCode,
          message: error.message,
        });
      }
    }

    if (files.length < INLINE_SOURCE_PAGE_SIZE) break;
  }

  return { recovered, recoveryErrors };
}

async function resolveManagedReactLocation(args: {
  designId: string;
  designData: unknown;
  sourceRef?: string;
  expectedFilePath?: string | null;
  previewModulePath?: string;
}): Promise<ReturnType<typeof resolveMotionLocalSourceLocation>> {
  if (!args.sourceRef) {
    fail("The selected localhost screen is not part of this Design.", {
      errorCode: "motion_local_source_screen_not_found",
      statusCode: 404,
    });
  }

  const [screen] = await getDb()
    .select({ id: schema.designFiles.id })
    .from(schema.designFiles)
    .where(
      and(
        eq(schema.designFiles.designId, args.designId),
        eq(schema.designFiles.id, args.sourceRef),
      ),
    )
    .limit(1);
  if (!screen) {
    fail("The selected localhost screen is not part of this Design.", {
      errorCode: "motion_local_source_screen_not_found",
      statusCode: 404,
    });
  }

  let location: ReturnType<typeof resolveMotionLocalSourceLocation>;
  try {
    const declaredFilePath = args.expectedFilePath ?? args.previewModulePath;
    location = resolveMotionLocalSourceLocation({
      designData: args.designData,
      screenId: args.sourceRef,
      ...(declaredFilePath
        ? { declaration: { filePath: declaredFilePath } }
        : {}),
    });
  } catch (error) {
    if (error instanceof MotionLocalSourceError) {
      fail(error.message, {
        errorCode: `motion_local_source_${error.code.replace(/-/g, "_")}`,
        statusCode: 422,
      });
    }
    throw error;
  }
  if (args.expectedFilePath && args.expectedFilePath !== location.filePath) {
    fail(
      "The saved motion timeline source file no longer matches the selected localhost screen.",
      { errorCode: "motion_local_source_metadata_mismatch", statusCode: 409 },
    );
  }
  return location;
}

async function readManagedReactForSource(args: {
  designId: string;
  location: ReturnType<typeof resolveMotionLocalSourceLocation>;
  context?: ActionRunContext;
  targetNodeIds: readonly string[];
  previewModuleVersionHash?: string;
}): Promise<
  | {
      managed: {
        css: string;
        hash: string;
        tracks: MotionTrack[];
        document: MotionCodeDocument | null;
        textDocument: MotionTextDocument | null;
        filePath: string;
        versionHash: string;
        source: "react";
      } | null;
      writeCapability: MotionReactSourceWriteCapability | null;
    }
  | null
  | import("../shared/visual-edit-bridge-relay.js").LocalhostBridgeRelay
> {
  const live = await runLocalhostBridgeStep({
    action: readLocalFileAction,
    actionArgs: {
      designId: args.designId,
      connectionId: args.location.connectionId,
      path: args.location.filePath,
    },
    context: args.context,
    step: "source-read",
  });
  if (isLocalhostBridgeRelay(live)) return live;
  if (typeof live.content !== "string") {
    fail("The localhost bridge did not return source content.", {
      errorCode: "motion_local_source_read_invalid",
      statusCode: 502,
    });
  }
  if (!isBridgeSha256VersionHash(live.versionHash)) {
    fail("The localhost bridge did not return a SHA-256 source version hash.", {
      errorCode: "motion_local_source_version_unavailable",
      statusCode: 502,
    });
  }
  const read = readMotionReactSource(live.content);
  if (read.status === "invalid") {
    fail(read.error.message, {
      errorCode: `motion_react_source_${read.error.code.replace(/-/g, "_")}`,
      statusCode: 422,
    });
  }
  const nativeStyleTargetNodeIds =
    read.status === "valid"
      ? (read.document?.nativeStyles?.map((style) => style.targetNodeId) ?? [])
      : [];
  const capabilityTargetNodeIds = [
    ...new Set([...args.targetNodeIds, ...nativeStyleTargetNodeIds]),
  ];
  const canEditMetadataWithoutTarget =
    read.status === "valid" &&
    ((read.document?.animationStyles?.length ?? 0) > 0 ||
      read.document?.audioClips !== undefined);
  const shouldCheckWriteCapability =
    capabilityTargetNodeIds.length > 0 || canEditMetadataWithoutTarget;
  const writeCapability = shouldCheckWriteCapability
    ? args.previewModuleVersionHash &&
      args.previewModuleVersionHash !== live.versionHash
      ? {
          status: "unsupported" as const,
          modulePath: args.location.filePath,
          moduleVersionHash: live.versionHash,
          targetNodeIds: capabilityTargetNodeIds,
          code: "stale-preview" as const,
          reason:
            "The rendered React source version changed before Motion capability could be verified.",
        }
      : inspectMotionReactSourceWriteCapability({
          source: live.content,
          targetNodeIds: capabilityTargetNodeIds,
          modulePath: args.location.filePath,
          moduleVersionHash: live.versionHash,
        })
    : null;
  if (read.status === "absent") {
    return { managed: null, writeCapability };
  }

  return {
    managed: {
      css: read.css,
      hash: hashCss(read.css),
      tracks: read.document?.tracks ?? [],
      document: read.document,
      textDocument: motionTextDocumentWithoutNativeStyles(
        read.textDocument,
        read.document?.nativeStyles ?? [],
      ),
      filePath: args.location.filePath,
      versionHash: live.versionHash,
      source: "react",
    },
    writeCapability,
  };
}

async function readManagedHtmlForSource(args: {
  designId: string;
  location: ReturnType<typeof resolveMotionLocalSourceLocation>;
  context?: ActionRunContext;
  targetNodeIds: readonly string[];
  previewModuleVersionHash?: string;
}): Promise<
  | {
      managed: ManagedCssSource | null;
      writeCapability:
        | (MotionHtmlSourceWriteCapability & {
            modulePath: string;
            moduleVersionHash: string;
          })
        | null;
    }
  | null
  | import("../shared/visual-edit-bridge-relay.js").LocalhostBridgeRelay
> {
  const live = await runLocalhostBridgeStep({
    action: readLocalFileAction,
    actionArgs: {
      designId: args.designId,
      connectionId: args.location.connectionId,
      path: args.location.filePath,
    },
    context: args.context,
    step: "source-read",
  });
  if (isLocalhostBridgeRelay(live)) return live;
  if (typeof live.content !== "string") {
    fail("The localhost bridge did not return HTML source content.", {
      errorCode: "motion_local_source_read_invalid",
      statusCode: 502,
    });
  }
  if (!isBridgeSha256VersionHash(live.versionHash)) {
    fail("The localhost bridge did not return a SHA-256 source version hash.", {
      errorCode: "motion_local_source_version_unavailable",
      statusCode: 502,
    });
  }

  const read = readMotionHtmlSource(live.content);
  if (read.status === "invalid") {
    const stale =
      read.error.code === "stale-source" || read.error.code === "stale-preview";
    fail(read.error.message, {
      errorCode: `motion_html_source_${read.error.code.replace(/-/g, "_")}`,
      statusCode: stale ? 409 : 422,
    });
  }

  const document = read.status === "valid" ? read.document : null;
  const sourceTargetNodeIds = read.status === "valid" ? read.targetNodeIds : [];
  const capabilityTargetNodeIds = [
    ...new Set([...args.targetNodeIds, ...sourceTargetNodeIds]),
  ];
  const canEditMetadataWithoutTarget =
    document !== null &&
    ((document.animationStyles?.length ?? 0) > 0 ||
      document.audioClips !== undefined);
  const shouldCheckWriteCapability =
    capabilityTargetNodeIds.length > 0 || canEditMetadataWithoutTarget;
  const writeCapability = shouldCheckWriteCapability
    ? args.previewModuleVersionHash &&
      args.previewModuleVersionHash !== live.versionHash
      ? {
          status: "unsupported" as const,
          modulePath: args.location.filePath,
          moduleVersionHash: live.versionHash,
          targetNodeIds: capabilityTargetNodeIds,
          code: "stale-preview" as const,
          reason:
            "The rendered HTML source version changed before Motion capability could be verified.",
        }
      : {
          ...inspectMotionHtmlSourceWriteCapability({
            source: live.content,
            targetNodeIds: capabilityTargetNodeIds,
            sourceFilePath: args.location.filePath,
          }),
          modulePath: args.location.filePath,
          moduleVersionHash: live.versionHash,
        }
    : null;

  if (read.status === "absent") {
    return { managed: null, writeCapability };
  }

  return {
    managed: {
      css: read.css,
      hash: hashCss(read.css),
      tracks: document?.tracks ?? [],
      animationStyles: document?.animationStyles ?? [],
      nativeStyles: document?.nativeStyles ?? [],
      easingVariables: document?.easingVariables ?? [],
      audioClips: document?.audioClips ?? [],
      textDocument: motionTextDocumentWithoutNativeStyles(
        read.textDocument,
        document?.nativeStyles ?? [],
      ),
      durationMs: document?.durationMs ?? null,
      playbackMode: read.playbackMode,
      defaultEase: document?.defaultEase ?? null,
      filePath: args.location.filePath,
      sourceVersionHash: live.versionHash,
      source: "html",
    },
    writeCapability,
  };
}

export default defineAction({
  description:
    "Read one or all motion timelines for a design. " +
    "Reads managed CSS from inline HTML or the verified live React/HTML source " +
    "for an editable localhost screen; viewers receive stored source marked " +
    "unverified. Returns timeline metadata (id, sourceRef, filePath, durationMs, " +
    "playbackMode [loop|once|ping-pong], defaultEase, compiledHash) and the " +
    "full tracks array (each track has targetNodeId, property, keyframes " +
    "with per-segment easing incl. spring(...)/linear(...), and optional " +
    "delayMs/durationMs start-offset timing). If sourceRef points at a " +
    "design file and the metadata is missing or stale, recovers editable " +
    "tracks (incl. offsets and playback mode) from the managed " +
    "<style data-agent-native-motion> block. Also returns the versioned " +
    "textDocument source for static HTML/JSX Text animations and source-backed " +
    "audioClips containing hosted URLs and clip timing. Versioned source metadata is " +
    "read losslessly; legacy CSS remains parseable. An all-design inline " +
    "listing returns malformed unindexed HTML sources in recoveryErrors with " +
    "sourceRef, errorCode, and message; an explicitly selected invalid source " +
    "returns its validation error. Editors read live localhost React/HTML " +
    "source; viewers receive stored source marked unverified. Read-only.",
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({
    designId: z.string().describe("Design project ID to read timelines for."),
    timelineId: z
      .string()
      .optional()
      .describe(
        "If provided, return only this specific timeline row. " +
          "Omit to list all timelines for the design.",
      ),
    sourceRef: z
      .string()
      .optional()
      .describe(
        "Filter by source ref (fileId for inline designs, routeId for " +
          "localhost/fusion). Ignored when timelineId is provided.",
      ),
    targetNodeIds: z
      .array(z.string().min(1).max(256))
      .max(100)
      .optional()
      .describe(
        "Optional rendered node IDs to check for safe Motion source writes.",
      ),
    previewModuleVersionHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/i)
      .optional()
      .describe("Source version hash witnessed by the current local preview."),
    previewModulePath: z
      .string()
      .min(1)
      .max(1024)
      .optional()
      .describe(
        "Project-relative React module or HTML path witnessed by the preview.",
      ),
  }),
  run: async (args, context) => {
    context = withMotionLocalhostRelayIdentity(
      context,
      "get-motion-timeline",
      args,
    );
    const {
      designId,
      timelineId,
      sourceRef,
      targetNodeIds,
      previewModuleVersionHash,
      previewModulePath,
    } = args;
    const access = await assertAccess("design", designId, "viewer");

    const db = getDb();

    const conditions = [eq(schema.motionTimeline.designId, designId)];

    if (timelineId) {
      conditions.push(eq(schema.motionTimeline.id, timelineId));
    } else if (sourceRef) {
      conditions.push(eq(schema.motionTimeline.sourceRef, sourceRef));
    }

    const rows = await db
      .select({
        id: schema.motionTimeline.id,
        designId: schema.motionTimeline.designId,
        sourceRef: schema.motionTimeline.sourceRef,
        filePath: schema.motionTimeline.filePath,
        tracks: schema.motionTimeline.tracks,
        textDocument: schema.motionTimeline.textDocument,
        durationMs: schema.motionTimeline.durationMs,
        defaultEase: schema.motionTimeline.defaultEase,
        compiledHash: schema.motionTimeline.compiledHash,
        createdAt: schema.motionTimeline.createdAt,
        updatedAt: schema.motionTimeline.updatedAt,
      })
      .from(schema.motionTimeline)
      .where(and(...conditions))
      .orderBy(desc(schema.motionTimeline.updatedAt))
      .limit(timelineId ? 1 : 100);

    const timelines: TimelineResult[] = rows.map((row) => {
      const parsedTracks = parseTrackJson(row.tracks);
      return {
        id: row.id,
        designId: row.designId,
        sourceRef: row.sourceRef ?? null,
        filePath: row.filePath ?? null,
        tracks: parsedTracks,
        durationMs: row.durationMs,
        playbackMode:
          readTimelinePlaybackMode(parsedTracks) ??
          MOTION_DEFAULT_PLAYBACK_MODE,
        defaultEase: row.defaultEase,
        compiledHash: row.compiledHash ?? null,
        cssHash: null,
        animationStyles: [],
        nativeStyles: [],
        easingVariables: [],
        audioClips: [],
        textDocument: null,
        source: "stored",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    });

    const managedSourceRef = timelineId
      ? (timelines[0]?.sourceRef ?? sourceRef)
      : (sourceRef ?? timelines[0]?.sourceRef);
    const [design] = await db
      .select({ data: schema.designs.data })
      .from(schema.designs)
      .where(eq(schema.designs.id, designId))
      .limit(1);
    if (!design) {
      fail(`Design not found: ${designId}`, {
        errorCode: "design_not_found",
        statusCode: 404,
      });
    }
    const sourceType = designSourceTypeFromData(design.data);
    const useLocalSource =
      sourceType === "localhost" || Boolean(timelines[0]?.filePath);
    const inlineManagedSourceCache = new Map<
      string,
      Promise<ManagedCssSource | null>
    >();
    const readInlineManagedSource = (inlineSourceRef: string) => {
      let result = inlineManagedSourceCache.get(inlineSourceRef);
      if (!result) {
        result = readManagedCssForSource({
          designId,
          sourceRef: inlineSourceRef,
        });
        inlineManagedSourceCache.set(inlineSourceRef, result);
      }
      return result;
    };
    const canReadLocalSource = ["owner", "admin", "editor"].includes(
      access.role,
    );
    let recoveryErrors: ManagedSourceRecoveryIssue[] = [];
    if (
      !timelineId &&
      !sourceRef &&
      sourceType === "inline" &&
      !timelines.some((timeline) => timeline.filePath) &&
      rows.length < 100
    ) {
      const indexedSourceRefs = new Set(
        timelines.flatMap((timeline) =>
          timeline.sourceRef ? [timeline.sourceRef] : [],
        ),
      );
      const recovery = await readUnindexedManagedInlineSources({
        designId,
        indexedSourceRefs,
      });
      recoveryErrors = recovery.recoveryErrors;
      for (const {
        sourceRef: recoveredSourceRef,
        managedCss,
      } of recovery.recovered) {
        inlineManagedSourceCache.set(
          recoveredSourceRef,
          Promise.resolve(managedCss),
        );
        timelines.push({
          id: null,
          designId,
          sourceRef: recoveredSourceRef,
          filePath: null,
          tracks: managedCss.tracks,
          animationStyles: managedCss.animationStyles,
          nativeStyles: managedCss.nativeStyles,
          easingVariables: managedCss.easingVariables,
          audioClips: managedCss.audioClips,
          durationMs:
            managedCss.durationMs ?? MOTION_TIMELINE_DEFAULT_DURATION_MS,
          playbackMode: managedCss.playbackMode ?? MOTION_DEFAULT_PLAYBACK_MODE,
          defaultEase: managedCss.defaultEase ?? "ease",
          compiledHash: managedCss.hash,
          cssHash: managedCss.hash,
          textDocument: managedCss.textDocument,
          sourceVersionHash: null,
          source: "recovered-css",
          createdAt: null,
          updatedAt: null,
        });
      }
    }
    if (sourceType === "inline" && !useLocalSource) {
      for (const timeline of timelines) {
        const managedCss = timeline.sourceRef
          ? await readInlineManagedSource(timeline.sourceRef)
          : null;
        if (!managedCss) {
          fail(
            "The stored inline Motion timeline is missing its canonical managed source.",
            { errorCode: "motion_inline_source_missing", statusCode: 422 },
          );
        }
      }
    }
    if (useLocalSource && timelines[0] && !managedSourceRef) {
      fail(
        "The stored local Motion timeline has no localhost screen reference.",
        { errorCode: "motion_local_source_screen_not_found", statusCode: 422 },
      );
    }
    const localSourceLocation =
      useLocalSource && managedSourceRef
        ? await resolveManagedReactLocation({
            designId,
            designData: design.data,
            sourceRef: managedSourceRef,
            expectedFilePath: timelines[0]?.filePath,
            previewModulePath,
          })
        : null;
    const isLocalHtmlSource = Boolean(
      localSourceLocation && /\.html?$/i.test(localSourceLocation.filePath),
    );
    if (useLocalSource && canReadLocalSource && localSourceLocation) {
      const provenance = await runLocalhostBridgeStep({
        action: readLocalFileAction,
        actionArgs: {
          designId,
          connectionId: localSourceLocation.connectionId,
          path: localSourceLocation.filePath,
          motionScreenId: managedSourceRef!,
        },
        context,
        step: "source-provenance",
      });
      if (isLocalhostBridgeRelay(provenance)) return provenance;
      if (provenance.reachable !== true) {
        fail(
          "The Motion source is not in the selected screen's verified source graph.",
          {
            errorCode: "motion_local_source_module_not_imported",
            statusCode: 422,
          },
        );
      }
    }
    const localSourceResult =
      useLocalSource && canReadLocalSource && localSourceLocation
        ? isLocalHtmlSource
          ? await readManagedHtmlForSource({
              designId,
              location: localSourceLocation,
              context,
              targetNodeIds: [...new Set(targetNodeIds ?? [])],
              previewModuleVersionHash,
            })
          : await readManagedReactForSource({
              designId,
              location: localSourceLocation,
              context,
              targetNodeIds: [...new Set(targetNodeIds ?? [])],
              previewModuleVersionHash,
            })
        : null;
    if (isLocalhostBridgeRelay(localSourceResult)) return localSourceResult;
    const localSource = localSourceResult?.managed ?? null;
    const sourceWriteCapability = localSourceResult?.writeCapability ?? null;
    if (useLocalSource && canReadLocalSource && !localSource && timelines[0]) {
      fail(
        `The stored local Motion timeline is missing its canonical managed source for ${isLocalHtmlSource ? "HTML" : "React"}.`,
        {
          errorCode: isLocalHtmlSource
            ? "motion_html_source_missing"
            : "motion_react_source_missing",
          statusCode: 422,
        },
      );
    }
    if (useLocalSource && !canReadLocalSource && timelines[0]) {
      timelines[0] = {
        ...timelines[0],
        filePath: null,
        textDocument: parseStoredMotionTextDocument(rows[0]?.textDocument),
        cssHash: null,
        sourceVersionHash: null,
        source: "stored-local-unverified",
      };
    }
    const localSourceDocument =
      localSource && "document" in localSource ? localSource.document : null;
    const managedLocalCss = localSource
      ? {
          ...localSource,
          animationStyles:
            "animationStyles" in localSource
              ? localSource.animationStyles
              : (localSourceDocument?.animationStyles ?? []),
          nativeStyles:
            "nativeStyles" in localSource
              ? localSource.nativeStyles
              : (localSourceDocument?.nativeStyles ?? []),
          easingVariables:
            "easingVariables" in localSource
              ? localSource.easingVariables
              : (localSourceDocument?.easingVariables ?? []),
          audioClips:
            "audioClips" in localSource
              ? localSource.audioClips
              : (localSourceDocument?.audioClips ?? []),
          durationMs:
            localSourceDocument?.durationMs ??
            ("durationMs" in localSource ? localSource.durationMs : null) ??
            motionTimelineDurationForContent(
              MOTION_TIMELINE_DEFAULT_DURATION_MS,
              localSource.tracks,
              localSource.textDocument?.animations ?? [],
            ),
          playbackMode:
            localSourceDocument?.playbackMode ??
            ("playbackMode" in localSource ? localSource.playbackMode : null) ??
            readTimelinePlaybackMode(localSource.tracks) ??
            MOTION_DEFAULT_PLAYBACK_MODE,
          defaultEase:
            localSourceDocument?.defaultEase ??
            ("defaultEase" in localSource ? localSource.defaultEase : null) ??
            "ease",
          sourceVersionHash:
            "versionHash" in localSource
              ? localSource.versionHash
              : (localSource.sourceVersionHash ?? null),
        }
      : null;
    const managedCss =
      useLocalSource && !canReadLocalSource
        ? null
        : localSourceResult
          ? managedLocalCss
          : sourceType === "inline" && managedSourceRef
            ? await readInlineManagedSource(managedSourceRef)
            : await readManagedCssForSource({
                designId,
                sourceRef: managedSourceRef ?? undefined,
              });

    if (managedCss) {
      const [first] = timelines;
      if (!first) {
        timelines.push({
          id: null,
          designId,
          sourceRef: sourceRef ?? null,
          filePath:
            "filePath" in managedCss ? (managedCss.filePath ?? null) : null,
          tracks: managedCss.tracks,
          animationStyles: managedCss.animationStyles,
          nativeStyles: managedCss.nativeStyles,
          easingVariables: managedCss.easingVariables,
          audioClips: managedCss.audioClips,
          durationMs:
            managedCss.durationMs ?? MOTION_TIMELINE_DEFAULT_DURATION_MS,
          playbackMode: managedCss.playbackMode ?? MOTION_DEFAULT_PLAYBACK_MODE,
          defaultEase: managedCss.defaultEase ?? "ease",
          compiledHash: managedCss.hash,
          cssHash: managedCss.hash,
          textDocument: managedCss.textDocument,
          sourceVersionHash:
            "sourceVersionHash" in managedCss
              ? managedCss.sourceVersionHash
              : null,
          source:
            managedCss.source === "react"
              ? "recovered-react"
              : managedCss.source === "html"
                ? "recovered-html"
                : "recovered-css",
          createdAt: null,
          updatedAt: null,
        });
      } else if (
        managedCss.hash !== null &&
        first.compiledHash !== managedCss.hash
      ) {
        timelines[0] = {
          ...first,
          tracks: managedCss.tracks,
          animationStyles: managedCss.animationStyles,
          nativeStyles: managedCss.nativeStyles,
          easingVariables: managedCss.easingVariables,
          audioClips: managedCss.audioClips,
          durationMs: managedCss.durationMs ?? first.durationMs,
          playbackMode: managedCss.playbackMode ?? first.playbackMode,
          defaultEase: managedCss.defaultEase ?? first.defaultEase,
          cssHash: managedCss.hash,
          textDocument: managedCss.textDocument,
          sourceVersionHash:
            "sourceVersionHash" in managedCss
              ? managedCss.sourceVersionHash
              : first.sourceVersionHash,
          source:
            managedCss.source === "react"
              ? "stored-react-drift"
              : managedCss.source === "html"
                ? "stored-html-drift"
                : "stored-css-drift",
        };
      } else {
        timelines[0] = {
          ...first,
          tracks: managedCss.tracks,
          durationMs: managedCss.durationMs ?? first.durationMs,
          playbackMode: managedCss.playbackMode ?? first.playbackMode,
          defaultEase: managedCss.defaultEase ?? first.defaultEase,
          cssHash: managedCss.hash,
          animationStyles: managedCss.animationStyles,
          nativeStyles: managedCss.nativeStyles,
          easingVariables: managedCss.easingVariables,
          audioClips: managedCss.audioClips,
          textDocument: managedCss.textDocument,
          filePath: managedCss.filePath ?? first.filePath,
          sourceVersionHash:
            "sourceVersionHash" in managedCss
              ? managedCss.sourceVersionHash
              : first.sourceVersionHash,
        };
      }
    }

    if (timelineId) {
      if (timelines.length === 0) {
        throw new Error(`Motion timeline not found: ${timelineId}`);
      }
      return { timeline: timelines[0], sourceWriteCapability };
    }

    return {
      designId,
      timelines,
      count: timelines.length,
      recoveryErrors,
      sourceWriteCapability,
    };
  },
});
