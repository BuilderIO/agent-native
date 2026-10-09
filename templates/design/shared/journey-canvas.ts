/**
 * Onboarding-journey storyboard: the input contract of `create-journey-canvas`
 * and the pure mapping from a journey tree plus captured frames to Design
 * artifacts — one standalone HTML screen per card, board-file fragments for
 * arrows, labels and stubs. No database, no network, no clock.
 */

import { ATTACHMENT_REF_MAX_CHARS } from "@agent-native/core/private-blob";
import { injectDocumentMarkup } from "@agent-native/core/shared";
import { parse } from "parse5";
import { z } from "zod";

import { boardObjectEntryToHtmlFragment } from "./board-file.js";
import type { BoardObjectEntry } from "./board-objects.js";
import { assertDesignHtmlCreateIntegrity } from "./html-integrity.js";
import {
  enUSJourneyCanvasMessages,
  interpolateJourneyCanvasMessage,
  type JourneyCanvasMessages,
} from "./journey-canvas-messages.js";
import {
  APP_BAND_HEADER_HEIGHT,
  CARD_HEADER_HEIGHT,
  CARD_PROVENANCE_HEADER_HEIGHT,
  layoutJourneyAppBands,
  layoutJourney,
  type JourneyLayoutNode,
  type PlacedEdge,
  type Point,
} from "./journey-layout.js";
import { annotateScreenHtmlForPersist } from "./screen-annotation.js";

/** Ids written by this action all start with one of these, so a rerun can find and replace them. */
export const JOURNEY_FILE_ID_PREFIX = "jc_";
export const JOURNEY_REPLAY_ROW_PREFIX = "jcs_";
export const JOURNEY_STAGED_REPLAY_ROW_PREFIX = "jcu_";
export const JOURNEY_BOARD_ID_PREFIX = "jc-";
export const JOURNEY_FILENAME_PREFIX = "journey-";
export const REPLAY_SCREENSHOT_ROUTE = "/api/design-board-replay-screenshots/";
export const JOURNEY_STAGED_REPLAY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1_000;

export const MAX_JOURNEY_NODES = 1000;
export const MAX_JOURNEY_FRAMES = 900;
export const MAX_EXAMPLES_PER_NODE = 6;
const MAX_DIMENSION = 16_384;
const MAX_IMAGE_URL_CHARS = 2_048;

// guard:allow-raw-color — generated storyboard HTML is standalone and cannot read app theme tokens
const INK = "#111827";
// guard:allow-raw-color — generated storyboard HTML is standalone and cannot read app theme tokens
const MUTED = "#6b7280";
// guard:allow-raw-color — generated storyboard HTML is standalone and cannot read app theme tokens
const BORDER = "#d1d5db";
// guard:allow-raw-color — generated storyboard HTML is standalone and cannot read app theme tokens
const SURFACE = "#ffffff";
// guard:allow-raw-color — generated storyboard HTML is standalone and cannot read app theme tokens
const IMAGE_WELL = "#f3f4f6";
// guard:allow-raw-color — generated storyboard HTML uses a neutral prompt disclosure shadow
const PROMPT_SHADOW = "rgba(17,24,39,.18)";
// guard:allow-raw-color — arrows sit on a canvas that is light or dark; mid-grey reads on both
const EDGE = "#8b8f98";
const isoTimestamp = z
  .string()
  .max(64)
  .refine(
    (value) =>
      /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value)),
    "Expected an ISO-8601 timestamp.",
  );

const pixels = z.number().int().min(1).max(MAX_DIMENSION);
const percent = z.number().min(0).max(100);
const count = z.number().int().min(0).max(2_147_483_647);

const journeyFrameCaptionSchema = z
  .object({
    outputTitle: z.string().max(300).optional(),
    observedState: z.string().max(500).optional(),
    actor: z.string().max(320).nullable().optional(),
    actorSource: z.string().max(256).optional(),
    dateLabel: z
      .enum([
        "Event time (UTC)",
        "generation_completed event (UTC)",
        "Replay observation (UTC)",
      ])
      .optional(),
    evidenceStatus: z
      .enum(["generation_completed", "rendered_output_observed"])
      .optional(),
    evidenceAt: isoTimestamp.optional(),
    prompt: z.string().max(5_000).nullable().optional(),
    promptTranslation: z.string().max(5_000).nullable().optional(),
    promptSource: z.string().max(256).nullable().optional(),
    promptUnavailableReason: z.string().max(256).nullable().optional(),
  })
  .strict();

type JourneyFrameCaption = z.infer<typeof journeyFrameCaptionSchema>;

export const journeyExampleSchema = z.object({
  sessionId: z.string().min(1).max(256),
  recordingId: z.string().max(256).nullable(),
  ts: isoTimestamp,
  offsetMs: z.number().min(0).nullable(),
  viewport: z.object({ width: pixels, height: pixels }).nullable(),
  viewportReason: z.string().max(200).optional(),
  replayUrl: z.string().max(MAX_IMAGE_URL_CHARS).optional(),
});

const journeyNodeBaseSchema = z.object({
  key: z.string().min(1).max(2_048),
  label: z.string().min(1).max(300),
  parentKey: z.string().min(1).max(2_048).nullable(),
  depth: count,
  examples: z.array(journeyExampleSchema).max(50),
});

const cohortJourneyNodeSchema = journeyNodeBaseSchema.extend({
  kind: z.enum(["step", "other"]),
  referenceOnly: z
    .literal(false)
    .default(false)
    .describe("False for nodes with cohort counts and percentages."),
  n: count,
  pctOfRoot: percent,
  pctOfParent: percent,
  dropoffN: count,
  dropoffPct: percent,
});

const referenceJourneyNodeSchema = journeyNodeBaseSchema.extend({
  kind: z.literal("step"),
  referenceOnly: z
    .literal(true)
    .describe(
      "A separately observed visual reference. It has no cohort metrics and is labeled Observed session reference.",
    ),
});

export const journeyNodeSchema = z.union([
  cohortJourneyNodeSchema,
  referenceJourneyNodeSchema,
]);

export const journeyTreeSchema = z.object({
  window: z.object({ from: z.string().max(64), to: z.string().max(64) }),
  app: z.string().min(1).max(128),
  rootN: count,
  appRootN: z
    .record(z.string().regex(/^[a-z][a-z0-9-]{0,127}$/), count.min(1))
    .optional()
    .describe("Per-app root denominators for separate app-band layouts."),
  coverage: z.object({
    sessionsWithEvents: count,
    sessionsWithReplay: count,
    truncated: z.boolean(),
  }),
  nodes: z.array(journeyNodeSchema).min(1).max(MAX_JOURNEY_NODES),
});

/** Why a URL cannot be an image source, or null when it can. */
export function imageUrlProblem(value: string): string | null {
  const scheme = /^\s*([a-z][a-z0-9+.-]*):/i.exec(value)?.[1]?.toLowerCase();
  if (scheme === "data") {
    return "data: URLs are not accepted (screenshot bytes must not be inlined); pass attachmentRef or an https:// URL.";
  }
  if (scheme !== "https") {
    return `must be an https:// URL, received ${scheme ? `${scheme}:` : "a value without a scheme"}.`;
  }
  if (/[\u0000- \u007f]/.test(value)) {
    return "must not contain whitespace or control characters.";
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "is not a valid URL.";
  }
  if (parsed.username || parsed.password) {
    return "must not embed credentials.";
  }
  return null;
}

export const journeyFrameSchema = z
  .object({
    nodeKey: z.string().min(1).max(2_048),
    sourceApp: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9-]{0,127}$/)
      .optional()
      .describe(
        "Source template for this frame when tree.app is all or the node key does not include an app prefix.",
      ),
    route: z.string().min(1).max(2_048).optional(),
    exampleIndex: z.number().int().min(0).max(999),
    imageUrl: z.string().max(MAX_IMAGE_URL_CHARS).optional(),
    attachmentRef: z.string().min(1).max(ATTACHMENT_REF_MAX_CHARS).optional(),
    stagedFrameId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "Opaque frame ID returned by stage-journey-canvas-frames for this Design.",
      ),
    screenshotOffsetMs: z
      .number()
      .int()
      .min(0)
      .max(2_147_483_647)
      .optional()
      .describe(
        "Actual replay seek offset used to capture this screenshot, measured from recordingStartedAt. Required when stagedFrameId is passed.",
      ),
    recordingStartedAt: isoTimestamp
      .optional()
      .describe("Exact recording start timestamp from session metadata."),
    width: pixels,
    height: pixels,
    capturedAt: isoTimestamp,
    caption: journeyFrameCaptionSchema.optional(),
  })
  .superRefine((frame, ctx) => {
    if (
      [frame.imageUrl, frame.attachmentRef, frame.stagedFrameId].filter(
        (value) => value !== undefined,
      ).length !== 1
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Pass exactly one of imageUrl, attachmentRef, or stagedFrameId.",
      });
    }
    if (frame.imageUrl !== undefined) {
      const problem = imageUrlProblem(frame.imageUrl);
      if (problem) {
        ctx.addIssue({
          code: "custom",
          path: ["imageUrl"],
          message: `imageUrl ${problem}`,
        });
      }
    }
    if (frame.stagedFrameId !== undefined && frame.route === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["route"],
        message: "Pass the captured replay route for a staged frame.",
      });
    }
    if (
      frame.stagedFrameId !== undefined &&
      frame.screenshotOffsetMs === undefined
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["screenshotOffsetMs"],
        message: "Pass the actual screenshot seek offset for a staged frame.",
      });
    }
  });

export function journeyFrameSourceApp(
  nodeKey: string,
  treeApp: string,
  explicitSourceApp?: string,
): string | null {
  const nodeSourceApp = /^([a-z][a-z0-9-]{0,127})::/.exec(nodeKey)?.[1];
  const sourceApp =
    explicitSourceApp ?? nodeSourceApp ?? (treeApp !== "all" ? treeApp : null);
  if (
    !sourceApp ||
    sourceApp === "all" ||
    !/^[a-z][a-z0-9-]{0,127}$/.test(sourceApp) ||
    (nodeSourceApp !== undefined && nodeSourceApp !== sourceApp) ||
    (treeApp !== "all" && treeApp !== sourceApp)
  ) {
    return null;
  }
  return sourceApp;
}

export const createJourneyCanvasInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    locale: z
      .enum([
        "en-US",
        "zh-CN",
        "zh-TW",
        "es-ES",
        "fr-FR",
        "de-DE",
        "ja-JP",
        "ko-KR",
        "pt-BR",
        "hi-IN",
        "ar-SA",
      ])
      .optional()
      .default("en-US")
      .describe(
        "Locale used for the standalone storyboard labels; defaults to en-US.",
      ),
    tree: journeyTreeSchema,
    layoutMode: z
      .enum(["tree", "appBands"])
      .optional()
      .default("tree")
      .describe(
        "Use one tree or place independent app cohorts in side-by-side bands.",
      ),
    frames: z.array(journeyFrameSchema).max(MAX_JOURNEY_FRAMES),
    designId: z.string().min(1).max(128).optional(),
    cardWidth: z.number().int().min(200).max(800).optional().default(360),
    maxExamplesPerNode: z
      .number()
      .int()
      .min(1)
      .max(MAX_EXAMPLES_PER_NODE)
      .optional()
      .default(3),
    includeScreenshotless: z.boolean().optional().default(false),
    allowEncryptedPublicUploadFallback: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "Allow this call to store encrypted screenshot ciphertext with the configured public-upload provider when no private blob provider is available.",
      ),
  })
  .superRefine((input, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: "custom", path, message });
    if (input.layoutMode === "appBands") {
      if (input.tree.app !== "all") {
        issue(
          ["tree", "app"],
          'App-band layout requires tree.app to be "all".',
        );
      }
      if (!input.tree.appRootN) {
        issue(
          ["tree", "appRootN"],
          "Pass each app's root denominator for app-band layout.",
        );
      }
      const apps = new Set<string>();
      input.tree.nodes.forEach((node, index) => {
        const app = /^([a-z][a-z0-9-]{0,127})::/.exec(node.key)?.[1];
        if (!app) {
          issue(
            ["tree", "nodes", index, "key"],
            "App-band nodes need an app-prefixed key such as clips::....",
          );
          return;
        }
        apps.add(app);
        if (node.parentKey !== null) {
          const parentApp = /^([a-z][a-z0-9-]{0,127})::/.exec(
            node.parentKey,
          )?.[1];
          if (parentApp !== app) {
            issue(
              ["tree", "nodes", index, "parentKey"],
              "App-band parent links must stay within the same app cohort.",
            );
          }
        }
        if (
          input.tree.appRootN?.[app] !== undefined &&
          hasCohortMetrics(node) &&
          Math.abs(
            node.pctOfRoot - (node.n / input.tree.appRootN[app]!) * 100,
          ) > 0.011
        ) {
          issue(
            ["tree", "nodes", index, "pctOfRoot"],
            `Node "${node.key}" percent does not use the ${app} cohort denominator.`,
          );
        }
      });
      for (const app of apps) {
        if (input.tree.appRootN?.[app] === undefined) {
          issue(
            ["tree", "appRootN", app],
            `Pass the root denominator for the ${app} cohort.`,
          );
        }
      }
      for (const app of Object.keys(input.tree.appRootN ?? {})) {
        if (!apps.has(app)) {
          issue(
            ["tree", "appRootN", app],
            `The ${app} cohort has no nodes in this tree.`,
          );
        }
      }
    }
    if (
      !input.designId &&
      input.frames.some((frame) => frame.stagedFrameId !== undefined)
    ) {
      issue(
        ["designId"],
        "Pass the Design ID used to stage screenshots when any frame has stagedFrameId.",
      );
    }
    const byKey = new Map<string, number>();
    input.tree.nodes.forEach((node, index) => {
      if (byKey.has(node.key)) {
        issue(
          ["tree", "nodes", index, "key"],
          `Duplicate node key "${node.key}".`,
        );
      }
      byKey.set(node.key, index);
    });
    input.tree.nodes.forEach((node, index) => {
      if (node.parentKey === null) return;
      if (node.parentKey === node.key) {
        issue(
          ["tree", "nodes", index, "parentKey"],
          "A node cannot be its own parent.",
        );
      } else if (!byKey.has(node.parentKey)) {
        issue(
          ["tree", "nodes", index, "parentKey"],
          `Node "${node.key}" references missing parent "${node.parentKey}".`,
        );
      }
    });
    input.tree.nodes.forEach((node, index) => {
      const seen = new Set<string>([node.key]);
      let cursor = node.parentKey;
      while (cursor !== null) {
        if (seen.has(cursor)) {
          issue(
            ["tree", "nodes", index, "parentKey"],
            `Node "${node.key}" is part of a parent cycle.`,
          );
          return;
        }
        seen.add(cursor);
        const next = byKey.get(cursor);
        if (next === undefined) return;
        cursor = input.tree.nodes[next]!.parentKey;
      }
    });
    const seenFrames = new Set<string>();
    input.frames.forEach((frame, index) => {
      const nodeIndex = byKey.get(frame.nodeKey);
      if (nodeIndex === undefined) {
        issue(
          ["frames", index, "nodeKey"],
          `Frame references unknown node "${frame.nodeKey}".`,
        );
        return;
      }
      const examples = input.tree.nodes[nodeIndex]!.examples.length;
      if (frame.exampleIndex >= examples) {
        issue(
          ["frames", index, "exampleIndex"],
          `Node "${frame.nodeKey}" has ${examples} example(s); exampleIndex ${frame.exampleIndex} is out of range.`,
        );
      }
      const sourceApp = journeyFrameSourceApp(
        frame.nodeKey,
        input.tree.app,
        frame.sourceApp,
      );
      if (
        ((frame.attachmentRef !== undefined ||
          frame.stagedFrameId !== undefined) &&
          sourceApp === null) ||
        (frame.sourceApp !== undefined && sourceApp === null)
      ) {
        issue(
          ["frames", index, "sourceApp"],
          "Pass a valid sourceApp for private screenshots when tree.app is all, and keep it consistent with the node key and tree app.",
        );
      }
      const id = `${frame.nodeKey}\u0000${frame.exampleIndex}`;
      if (seenFrames.has(id)) {
        issue(
          ["frames", index],
          `Duplicate frame for node "${frame.nodeKey}" example ${frame.exampleIndex}.`,
        );
      }
      seenFrames.add(id);
    });
  });

export type JourneyNode = z.infer<typeof journeyNodeSchema>;
export type JourneyFrame = z.infer<typeof journeyFrameSchema>;
export type CreateJourneyCanvasInput = z.infer<
  typeof createJourneyCanvasInputSchema
>;

function hasCohortMetrics(
  node: JourneyNode,
): node is z.infer<typeof cohortJourneyNodeSchema> {
  return node.referenceOnly !== true;
}

/** 53-bit string hash (cyrb53), hex. Ids only need to be stable and collision-free in one design. */
function hashId(value: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 =
    Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^
    Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 =
    Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^
    Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (
    (h2 >>> 0).toString(16).padStart(8, "0") +
    (h1 >>> 0).toString(16).padStart(8, "0")
  ).slice(0, 14);
}

function journeyFileId(
  designId: string,
  nodeKey: string,
  exampleIndex: number,
): string {
  return `${JOURNEY_FILE_ID_PREFIX}${hashId(`${designId}\u0000${nodeKey}\u0000${exampleIndex}`)}`;
}

function journeyReplayRowId(fileId: string): string {
  return `${JOURNEY_REPLAY_ROW_PREFIX}${fileId.slice(JOURNEY_FILE_ID_PREFIX.length)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "step"
  );
}

const formatInt = (value: number, locale = "en-US") =>
  value.toLocaleString(locale);

function appDisplayName(value: string): string {
  const knownApps = new Map([
    ["clips", "Clips"],
    ["design", "Design"],
    ["slides", "Slides"],
  ]);
  return (
    knownApps.get(value) ??
    value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function formatPercent(value: number, locale = "en-US"): string {
  const clamped = Math.min(100, Math.max(0, value));
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: clamped >= 10 ? 0 : 1,
  }).format(clamped / 100);
}

function replayObservedAt(
  recordingStartedAt: string | undefined,
  screenshotOffsetMs: number | undefined,
): string | null {
  if (!recordingStartedAt || screenshotOffsetMs === undefined) {
    return null;
  }
  const recordingStart = Date.parse(recordingStartedAt);
  if (!Number.isFinite(recordingStart)) return null;
  return new Date(recordingStart + screenshotOffsetMs).toISOString();
}

function utcTimestamp(value: string): string {
  return new Date(Date.parse(value)).toISOString();
}

function utcDate(value: string): string {
  return `${utcTimestamp(value).slice(0, 10)} UTC`;
}

function localizedDateLabel(
  value: JourneyFrameCaption["dateLabel"] | undefined,
  referenceOnly: boolean,
  hasReplayObservation: boolean,
  hasGenerationCompletionEvidence: boolean,
  messages: JourneyCanvasMessages,
): string {
  if (
    value === "generation_completed event (UTC)" &&
    hasGenerationCompletionEvidence
  ) {
    return messages.generationCompletedEvent;
  }
  if (
    (value === "Replay observation (UTC)" || referenceOnly) &&
    hasReplayObservation
  ) {
    return `${messages.replayObservation} (UTC)`;
  }
  return messages.eventTime;
}

function captionEvidenceText(
  caption: JourneyFrameCaption,
  messages: JourneyCanvasMessages,
): string | null {
  const evidence =
    caption.evidenceStatus === "generation_completed"
      ? messages.generationCompletedEvidence
      : caption.evidenceStatus === "rendered_output_observed"
        ? messages.renderedOutputEvidence
        : null;
  if (!evidence) return null;
  const timestamp =
    caption.evidenceStatus === "generation_completed" && caption.evidenceAt
      ? ` (${utcTimestamp(caption.evidenceAt)} UTC)`
      : "";
  return `${messages.evidence}: ${evidence}${timestamp}`;
}

export interface PlannedScreen {
  fileId: string;
  filename: string;
  html: string;
  /** Name shown above the frame. Empty for stacked extra examples so their labels do not smear over the front card's. */
  title: string;
  nodeKey: string;
  exampleIndex: number;
  provenance?: {
    eventAt: string;
    dateLabel: string;
    recordingId: string | null;
    recordingStartedAt?: string;
    offsetMs: number | null;
    offsetIsObserved: boolean;
    checkpointOffsetMs: number | null;
    replayObservedAt: string | null;
    screenshotCapturedAt: string;
    sourceApp?: string;
    route?: string;
    caption?: JourneyFrameCaption;
  };
  /** Frame geometry relative to the canvas origin. */
  frame: { x: number; y: number; width: number; height: number; z: number };
  /** Set when the image is an attachment to copy or a staged private Design blob to consume. */
  attachment?: {
    ref?: string;
    stagedFrameId?: string;
    sourceApp?: string;
    rowId: string;
    replayId: string;
    capturedAt: string;
    offsetMs: number;
    route: string;
    width: number;
    height: number;
  };
}

export interface JourneyCanvasPlan {
  screens: PlannedScreen[];
  /** Board fragments for a canvas whose top-left corner is `origin`. */
  boardFragments: (origin: Point) => string[];
  nodeCount: number;
  frameCount: number;
  skippedNodes: Array<{ key: string; reason: string }>;
}

interface Rendered {
  node: JourneyNode;
  index: number;
  frames: JourneyFrame[];
  kind: "card" | "stub";
  layoutId: string;
}

function replayImageSrc(rowId: string): string {
  return `${REPLAY_SCREENSHOT_ROUTE}${rowId}`;
}

function cardProvenanceMarkup(
  provenance: PlannedScreen["provenance"],
  index: number,
  messages: JourneyCanvasMessages,
): string {
  if (!provenance) return "";
  const recordingId = provenance.recordingId ?? messages.recordingUnavailable;
  const replayOffset =
    provenance.offsetMs === null
      ? messages.replayOffsetUnavailable
      : `${formatInt(provenance.offsetMs, messages.htmlLanguage)} ms`;
  const caption = provenance.caption;
  const showsReplayObservation =
    provenance.dateLabel === `${messages.replayObservation} (UTC)` &&
    provenance.replayObservedAt !== null;
  const showsGenerationCompletion =
    provenance.dateLabel === messages.generationCompletedEvent &&
    caption?.evidenceStatus === "generation_completed" &&
    caption.evidenceAt !== undefined;
  const displayedTimestamp = showsReplayObservation
    ? provenance.replayObservedAt!
    : showsGenerationCompletion
      ? caption!.evidenceAt!
      : provenance.eventAt;
  const captionMarkup = caption
    ? [
        caption.observedState
          ? `<p class="caption-line" title="${escapeHtml(`${messages.observedState}: ${caption.observedState}`)}"><strong>${escapeHtml(messages.observedState)}:</strong> ${escapeHtml(caption.observedState)}</p>`
          : "",
        caption.outputTitle
          ? `<p class="caption-line" title="${escapeHtml(messages.outputTitle)}: ${escapeHtml(caption.outputTitle)}">${escapeHtml(messages.output)}: ${escapeHtml(caption.outputTitle)}</p>`
          : "",
        caption.prompt
          ? `<details class="prompt" name="journey-card-details"><summary title="${escapeHtml(messages.openFullPrompt)}">${escapeHtml(messages.prompt)}: ${escapeHtml(promptExcerpt(caption.promptTranslation ?? caption.prompt))}</summary><div class="prompt-body">${caption.promptTranslation ? `<p><strong>${escapeHtml(messages.promptEnglish)}</strong><br>${escapeHtml(caption.promptTranslation)}</p>` : ""}<p><strong>${escapeHtml(messages.promptSource)}</strong><br>${escapeHtml(caption.prompt)}</p>${caption.promptSource ? `<p class="prompt-source">${escapeHtml(messages.source)}: ${escapeHtml(caption.promptSource)}</p>` : ""}</div></details>`
          : caption.promptUnavailableReason
            ? `<p class="caption-line" title="${escapeHtml(caption.promptUnavailableReason)}">${escapeHtml(messages.promptNotCaptured)}</p>`
            : "",
      ].join("")
    : "";
  const actor = caption?.actor ?? messages.actorUnavailable;
  const actorSource = caption?.actorSource;
  const actorTitle = `${messages.actorRecording}: ${actor}${actorSource ? ` (${messages.actorSource}: ${actorSource})` : ""}`;
  const evidenceText = caption ? captionEvidenceText(caption, messages) : null;
  const technicalRows = [
    `<p>${escapeHtml(messages.recordingId)}: ${escapeHtml(recordingId)}</p>`,
    provenance.sourceApp
      ? `<p>${escapeHtml(messages.sourceApp)}: ${escapeHtml(appDisplayName(provenance.sourceApp))}</p>`
      : "",
    provenance.route
      ? `<p>${escapeHtml(messages.route)}: ${escapeHtml(provenance.route)}</p>`
      : "",
    provenance.recordingStartedAt
      ? `<p>${escapeHtml(messages.recordingStarted)}: ${escapeHtml(utcTimestamp(provenance.recordingStartedAt))}</p>`
      : "",
    `<p>${escapeHtml(provenance.dateLabel)}: ${escapeHtml(utcTimestamp(displayedTimestamp))}</p>`,
    provenance.eventAt !== displayedTimestamp
      ? `<p>${escapeHtml(messages.eventTime)}: ${escapeHtml(utcTimestamp(provenance.eventAt))}</p>`
      : "",
    provenance.replayObservedAt &&
    provenance.replayObservedAt !== displayedTimestamp
      ? `<p>${escapeHtml(messages.replayObserved)}: ${escapeHtml(utcTimestamp(provenance.replayObservedAt))}</p>`
      : "",
    `<p>${escapeHtml(messages.replayOffset)}: ${escapeHtml(replayOffset)}</p>`,
    provenance.offsetIsObserved
      ? `<p>${escapeHtml(messages.replaySeek)}: ${escapeHtml(replayOffset)}</p>`
      : provenance.checkpointOffsetMs !== null
        ? `<p>${escapeHtml(messages.checkpointSeekTarget)}: ${formatInt(provenance.checkpointOffsetMs, messages.htmlLanguage)} ms</p>`
        : "",
    provenance.checkpointOffsetMs !== null &&
    provenance.checkpointOffsetMs !== provenance.offsetMs
      ? `<p>${escapeHtml(messages.analyticsCheckpointOffset)}: ${formatInt(provenance.checkpointOffsetMs, messages.htmlLanguage)} ms</p>`
      : "",
    `<p>${escapeHtml(messages.screenshotCaptured)}: ${escapeHtml(utcTimestamp(provenance.screenshotCapturedAt))}</p>`,
    caption?.actor && actorSource
      ? `<p>${escapeHtml(messages.actorSource)}: ${escapeHtml(actorSource)}</p>`
      : "",
    evidenceText ? `<p>${escapeHtml(evidenceText)}</p>` : "",
  ].join("");
  return `<section class="example-provenance" data-index="${index}"><p class="provenance date-line" title="${escapeHtml(`${messages.utcTimestamp}: ${utcTimestamp(displayedTimestamp)}`)}"><time datetime="${escapeHtml(utcTimestamp(displayedTimestamp))}">${escapeHtml(utcDate(displayedTimestamp))}</time><span class="date-kind">${escapeHtml(provenance.dateLabel)}</span></p><p class="provenance actor-line" title="${escapeHtml(actorTitle)}">${escapeHtml(messages.actorRecording)}: ${escapeHtml(actor)}</p>${captionMarkup}<details class="provenance-details" name="journey-card-details"><summary title="${escapeHtml(messages.replayDetails)}">${escapeHtml(messages.replayDetails)}</summary><div class="provenance-body">${technicalRows}</div></details></section>`;
}

function promptExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69)}…`;
}

function captionHeaderHeight(
  frames: JourneyFrame[],
  cardWidth: number,
  messages: JourneyCanvasMessages,
): number {
  const charactersPerLine = Math.max(18, Math.floor((cardWidth - 24) / 10));
  const rowsFor = (value: string) =>
    Math.max(1, Math.ceil(value.length / charactersPerLine));
  const rows = Math.max(
    0,
    ...frames.map((frame) => {
      const caption = frame.caption;
      if (!caption) return 0;
      const rowsForCaption = (value: string) => Math.min(2, rowsFor(value));
      return (
        (caption.outputTitle
          ? rowsForCaption(`${messages.output}: ${caption.outputTitle}`)
          : 0) +
        (caption.observedState
          ? rowsForCaption(
              `${messages.observedState}: ${caption.observedState}`,
            )
          : 0) +
        Number(Boolean(caption.prompt || caption.promptUnavailableReason))
      );
    }),
  );
  return rows * 12;
}

function cardHeaderHeight(
  frames: JourneyFrame[],
  cardWidth: number,
  messages: JourneyCanvasMessages,
  hasCoverageNote: boolean,
): number {
  return (
    CARD_PROVENANCE_HEADER_HEIGHT +
    captionHeaderHeight(frames, cardWidth, messages) +
    (hasCoverageNote ? 12 : 0) +
    (frames.length > 1 ? 20 : 0)
  );
}

function appKeyForNode(nodeKey: string): string | null {
  return /^([a-z][a-z0-9-]{0,127})::/.exec(nodeKey)?.[1] ?? null;
}

function orderAppBandComponents(
  nodes: JourneyLayoutNode[],
  entriesByLayoutId: Map<string, Rendered>,
): JourneyLayoutNode[] {
  const byKey = new Map(nodes.map((node) => [node.key, node]));
  const originalIndex = new Map(nodes.map((node, index) => [node.key, index]));
  const rootKeyFor = (node: JourneyLayoutNode): string => {
    const visited = new Set<string>();
    let current = node;
    while (current.parentKey !== null) {
      if (visited.has(current.key)) return current.key;
      visited.add(current.key);
      const parent = byKey.get(current.parentKey);
      if (!parent) return current.key;
      current = parent;
    }
    return current.key;
  };
  const componentNodes = new Map<string, JourneyLayoutNode[]>();
  for (const node of nodes) {
    const rootKey = rootKeyFor(node);
    const component = componentNodes.get(rootKey) ?? [];
    component.push(node);
    componentNodes.set(rootKey, component);
  }

  const onboardingPath = /step:(?:role|choice)|auth:signup|signup_clicked/;
  const componentOrder = [...componentNodes.entries()]
    .map(([rootKey, component]) => {
      const rootEntry = entriesByLayoutId.get(rootKey);
      const containsOnboardingPath = component.some((node) =>
        onboardingPath.test(
          entriesByLayoutId.get(node.key)?.node.key ?? node.key,
        ),
      );
      return {
        rootKey,
        originalIndex: originalIndex.get(rootKey) ?? Number.MAX_SAFE_INTEGER,
        hasOnboardingPath: containsOnboardingPath,
        rootCount:
          rootEntry && hasCohortMetrics(rootEntry.node) ? rootEntry.node.n : 0,
      };
    })
    .sort(
      (left, right) =>
        Number(right.hasOnboardingPath) - Number(left.hasOnboardingPath) ||
        right.rootCount - left.rootCount ||
        left.originalIndex - right.originalIndex,
    );
  const orderByRoot = new Map(
    componentOrder.map((component, index) => [component.rootKey, index]),
  );
  return [...nodes].sort(
    (left, right) =>
      (orderByRoot.get(rootKeyFor(left)) ?? Number.MAX_SAFE_INTEGER) -
        (orderByRoot.get(rootKeyFor(right)) ?? Number.MAX_SAFE_INTEGER) ||
      (originalIndex.get(left.key) ?? 0) - (originalIndex.get(right.key) ?? 0),
  );
}

interface ExampleGalleryItem {
  selectorId: string;
  index: number;
  src: string;
  alt: string;
  external: boolean;
  provenance?: PlannedScreen["provenance"];
}

function exampleSwitchMarkup(
  items: ExampleGalleryItem[],
  messages: JourneyCanvasMessages,
): string {
  if (items.length < 2) return "";
  const positions = items
    .map(
      (item) =>
        `<span class="example-position" data-index="${item.index}">${escapeHtml(interpolateJourneyCanvasMessage(messages.examplePosition, { current: formatInt(item.index + 1, messages.htmlLanguage), total: formatInt(items.length, messages.htmlLanguage) }))}</span>`,
    )
    .join("");
  const labels = items
    .map(
      (item) =>
        `<label for="${item.selectorId}" title="${escapeHtml(interpolateJourneyCanvasMessage(messages.showExample, { current: formatInt(item.index + 1, messages.htmlLanguage), total: formatInt(items.length, messages.htmlLanguage) }))}">${formatInt(item.index + 1, messages.htmlLanguage)}</label>`,
    )
    .join("");
  return `<div class="example-switcher" role="group" aria-label="${escapeHtml(messages.screenshotExamples)}">${positions}${labels}</div>`;
}

function exampleSelectorsMarkup(
  items: ExampleGalleryItem[],
  activeIndex: number,
  messages: JourneyCanvasMessages,
): string {
  if (items.length < 2) return "";
  return items
    .map(
      (item) =>
        `<input class="example-selector" type="radio" name="journey-example" id="${item.selectorId}" aria-label="${escapeHtml(interpolateJourneyCanvasMessage(messages.showExample, { current: formatInt(item.index + 1, messages.htmlLanguage), total: formatInt(items.length, messages.htmlLanguage) }))}"${item.index === activeIndex ? " checked" : ""}>`,
    )
    .join("");
}

function exampleGalleryMarkup(items: ExampleGalleryItem[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) {
    const item = items[0]!;
    return `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" decoding="async"${item.external ? ' referrerpolicy="no-referrer"' : ""}>`;
  }
  const styles = items
    .map(
      (item) =>
        `#${item.selectorId}:checked~main .example-frame[data-index="${item.index}"]{display:flex}#${item.selectorId}:checked~header .example-provenance[data-index="${item.index}"]{display:block}#${item.selectorId}:checked~header .example-position[data-index="${item.index}"]{display:inline}#${item.selectorId}:checked~header label[for="${item.selectorId}"]{background:${INK};color:${SURFACE}}#${item.selectorId}:focus-visible~header label[for="${item.selectorId}"]{outline:2px solid ${INK};outline-offset:2px}`,
    )
    .join("");
  const figures = items
    .map(
      (item) =>
        `<div class="example-frame" data-index="${item.index}"><img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" decoding="async" loading="lazy"${item.external ? ' referrerpolicy="no-referrer"' : ""}></div>`,
    )
    .join("");
  return `<style>${styles}</style><div class="example-gallery">${figures}</div>`;
}

function cardHtml(args: {
  label: string;
  meta: string;
  coverageNote?: string;
  examples: ExampleGalleryItem[];
  activeExampleIndex: number;
  placeholder: string;
  headerHeight: number;
  messages: JourneyCanvasMessages;
}): string {
  const direction = args.messages.htmlLanguage.startsWith("ar-")
    ? "rtl"
    : "ltr";
  const body = args.examples.length
    ? exampleGalleryMarkup(args.examples)
    : `<p>${escapeHtml(args.placeholder)}</p>`;
  const provenanceMarkup = args.examples
    .map((item, index) =>
      cardProvenanceMarkup(item.provenance, index, args.messages),
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="${escapeHtml(args.messages.htmlLanguage)}" dir="${direction}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(args.label)}</title>
<style>
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;height:100%;overflow:hidden;background:${SURFACE};font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
header{height:${args.headerHeight}px;padding:6px 12px 0;border-bottom:1px solid ${BORDER};position:relative}
h1{margin:0;font-size:14px;line-height:20px;font-weight:600;color:${INK};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header p{margin:0;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .metrics{font-size:12px;line-height:18px}
header .coverage-note{font-size:10px;line-height:12px;overflow:hidden;text-overflow:ellipsis}
header .provenance{font-size:9px;line-height:12px}
header .example-provenance{display:block}
header .date-line,header .actor-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header .date-line{display:flex;gap:5px;align-items:baseline}
header .date-kind{font-size:9px;opacity:.8}
header .caption-line{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;font-size:10px;line-height:12px;white-space:normal;overflow-wrap:anywhere}
header .prompt summary{font-size:10px;line-height:12px}
header details{margin:0;color:${MUTED};font-size:10px;line-height:12px}
header details summary{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header details[open] .prompt-body,header details[open] .provenance-body{position:absolute;z-index:3;top:100%;left:0;width:100%;max-height:45vh;overflow:auto;padding:8px 12px;background:${SURFACE};border:1px solid ${BORDER};box-shadow:0 4px 12px ${PROMPT_SHADOW};white-space:pre-wrap;color:${INK}}
header .prompt-body p{margin:0 0 8px;overflow:visible;text-overflow:clip;white-space:pre-wrap;color:${INK};overflow-wrap:anywhere}
header .provenance-body p{margin:0 0 6px;overflow:visible;text-overflow:clip;white-space:pre-wrap;color:${INK};overflow-wrap:anywhere}
header .prompt-source{font-size:9px;color:${MUTED}}
header .example-switcher{display:flex;align-items:center;gap:5px;height:20px;color:${MUTED};font-size:10px;line-height:14px}
header .example-position{display:none;margin-right:3px}
header .example-switcher label{display:inline-flex;min-width:18px;height:18px;align-items:center;justify-content:center;border:1px solid ${BORDER};border-radius:3px;cursor:pointer;color:${INK};font-size:10px;line-height:16px}
.example-selector{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
${args.examples.length > 1 ? "header .example-provenance{display:none}" : ""}
main{height:calc(100% - ${args.headerHeight}px);background:${IMAGE_WELL};display:flex;align-items:center;justify-content:center}
main img{display:block;width:100%;height:100%;object-fit:contain}
main .example-gallery,main .example-frame{width:100%;height:100%}
main .example-frame{display:none;align-items:center;justify-content:center}
main p{margin:0;font-size:13px;color:${MUTED}}
</style>
</head>
<body>
${exampleSelectorsMarkup(args.examples, args.activeExampleIndex, args.messages)}
<header><h1 title="${escapeHtml(args.label)}">${escapeHtml(args.label)}</h1><p class="metrics">${escapeHtml(args.meta)}</p>${args.coverageNote ? `<p class="coverage-note" title="${escapeHtml(args.coverageNote)}">${escapeHtml(args.coverageNote)}</p>` : ""}${provenanceMarkup}${exampleSwitchMarkup(args.examples, args.messages)}</header>
<main>${body}</main>
</body>
</html>`;
}

function absolute(rect: {
  x: number;
  y: number;
  width: number;
  height: number;
}) {
  return `position:absolute;left:${rect.x}px;top:${rect.y}px;width:${rect.width}px;height:${rect.height}px;box-sizing:border-box`;
}

function boardDiv(args: {
  id: string;
  name: string;
  primitive: "text" | "rectangle";
  rect: { x: number; y: number; width: number; height: number };
  style: string;
  html: string;
}): string {
  return `<div data-agent-native-node-id="${escapeHtml(args.id)}" data-agent-native-layer-name="${escapeHtml(args.name)}" data-an-primitive="${args.primitive}" style="${absolute(args.rect)};${args.style}">${args.html}</div>`;
}

function arrowFragment(
  id: string,
  name: string,
  points: Point[],
  dashed: boolean,
): string {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const entry: BoardObjectEntry = {
    id,
    kind: "arrow",
    geometry: {
      x: Math.min(...xs),
      y: Math.min(...ys),
      width: Math.max(1, Math.max(...xs) - Math.min(...xs)),
      height: Math.max(1, Math.max(...ys) - Math.min(...ys)),
    },
    points,
    stroke: EDGE,
    strokeWidth: 1.5,
    endPoint: "triangle",
    name,
    createdAt: "1970-01-01T00:00:00.000Z",
  };
  const fragment = boardObjectEntryToHtmlFragment(entry);
  return dashed
    ? fragment.replace(
        'stroke-linecap="round"',
        'stroke-dasharray="6 6" stroke-linecap="round"',
      )
    : fragment;
}

/**
 * Pure mapping from validated input to screens and board fragments. `designId`
 * seeds every generated id, so a rerun against the same design reproduces them.
 */
export function planJourneyCanvas(
  input: CreateJourneyCanvasInput,
  designId: string,
  messages: JourneyCanvasMessages = enUSJourneyCanvasMessages,
): JourneyCanvasPlan {
  const { tree, cardWidth, maxExamplesPerNode, includeScreenshotless } = input;
  const nodeIndex = new Map(tree.nodes.map((node, index) => [node.key, index]));
  const framesByNode = new Map<string, JourneyFrame[]>();
  for (const frame of input.frames) {
    if (frame.exampleIndex >= maxExamplesPerNode) continue;
    const list = framesByNode.get(frame.nodeKey) ?? [];
    list.push(frame);
    framesByNode.set(frame.nodeKey, list);
  }
  for (const list of framesByNode.values()) {
    list.sort((a, b) => a.exampleIndex - b.exampleIndex);
  }

  const skippedNodes: Array<{ key: string; reason: string }> = [];
  const rendered = new Map<string, Rendered>();
  tree.nodes.forEach((node, index) => {
    const frames = framesByNode.get(node.key) ?? [];
    if (frames.length > 0 || (node.kind === "step" && includeScreenshotless)) {
      rendered.set(node.key, {
        node,
        index,
        frames,
        kind: "card",
        layoutId: `c${index}`,
      });
    } else if (node.kind === "other") {
      rendered.set(node.key, {
        node,
        index,
        frames,
        kind: "stub",
        layoutId: `c${index}`,
      });
    } else {
      const outOfRange = input.frames.some(
        (frame) => frame.nodeKey === node.key,
      );
      skippedNodes.push({
        key: node.key,
        reason: outOfRange
          ? `No frame within maxExamplesPerNode (${maxExamplesPerNode}).`
          : "No screenshot captured.",
      });
    }
  });

  const nearestCardAncestor = (node: JourneyNode): JourneyNode | null => {
    let cursor = node.parentKey;
    while (cursor !== null) {
      const candidate = tree.nodes[nodeIndex.get(cursor)!]!;
      if (rendered.get(cursor)?.kind === "card") return candidate;
      cursor = candidate.parentKey;
    }
    return null;
  };

  const childSessionsByParent = new Map<string, number>();
  for (const node of tree.nodes) {
    if (!hasCohortMetrics(node) || !rendered.has(node.key)) continue;
    const parent = nearestCardAncestor(node);
    if (!parent || !hasCohortMetrics(parent)) continue;
    childSessionsByParent.set(
      parent.key,
      (childSessionsByParent.get(parent.key) ?? 0) + node.n,
    );
  }
  const continuationNotes = new Map<string, string>();
  for (const node of tree.nodes) {
    if (!hasCohortMetrics(node)) continue;
    const continued = Math.max(
      0,
      node.n - node.dropoffN - (childSessionsByParent.get(node.key) ?? 0),
    );
    if (continued === 0) continue;
    continuationNotes.set(
      node.key,
      interpolateJourneyCanvasMessage(messages.continuedOnUnpictured, {
        count: formatInt(continued, messages.htmlLanguage),
        percent: formatPercent(
          (continued / Math.max(1, node.n)) * 100,
          messages.htmlLanguage,
        ),
      }),
    );
  }

  // Analytics already returns siblings in presentation order. App bands put
  // the main onboarding path ahead of independent route components.
  const ordered = [...rendered.values()];

  const layoutNodes: JourneyLayoutNode[] = [];
  const layoutAppById = new Map<string, string>();
  const layoutEntryById = new Map<string, Rendered>();
  const dropoffOf = new Map<string, z.infer<typeof cohortJourneyNodeSchema>>();
  const effectiveParent = new Map<string, JourneyNode | null>();
  for (const entry of ordered) {
    const parent = nearestCardAncestor(entry.node);
    effectiveParent.set(entry.node.key, parent);
    const parentId = parent ? rendered.get(parent.key)!.layoutId : null;
    const appKey = appKeyForNode(entry.node.key);
    if (appKey) {
      layoutAppById.set(entry.layoutId, appKey);
      layoutEntryById.set(entry.layoutId, entry);
    }
    layoutNodes.push(
      entry.kind === "stub"
        ? { key: entry.layoutId, parentKey: parentId, kind: "stub" }
        : {
            key: entry.layoutId,
            parentKey: parentId,
            kind: "card",
            frame: entry.frames[0]
              ? { width: entry.frames[0].width, height: entry.frames[0].height }
              : (entry.node.examples[0]?.viewport ?? undefined),
            headerHeight: entry.frames.length
              ? cardHeaderHeight(
                  entry.frames,
                  cardWidth,
                  messages,
                  continuationNotes.has(entry.node.key),
                )
              : CARD_HEADER_HEIGHT,
            layers: Math.max(0, entry.frames.length - 1),
            footer: false,
          },
    );
  }
  for (const entry of ordered) {
    if (
      entry.kind === "card" &&
      hasCohortMetrics(entry.node) &&
      entry.node.dropoffN > 0
    ) {
      dropoffOf.set(entry.node.key, entry.node);
      layoutNodes.push({
        key: `d${entry.index}`,
        parentKey: entry.layoutId,
        kind: "stub",
      });
      const appKey = appKeyForNode(entry.node.key);
      if (appKey) {
        layoutAppById.set(`d${entry.index}`, appKey);
        layoutEntryById.set(`d${entry.index}`, entry);
      }
    }
  }

  const appBandLayout =
    input.layoutMode === "appBands"
      ? layoutJourneyAppBands(
          [...new Set(ordered.map((entry) => appKeyForNode(entry.node.key)!))]
            .filter((app) => app !== null)
            .map((app) => ({
              key: app,
              rootN: tree.appRootN![app]!,
              nodes: orderAppBandComponents(
                layoutNodes.filter(
                  (node) => layoutAppById.get(node.key) === app,
                ),
                layoutEntryById,
              ),
            })),
          { cardWidth },
        )
      : null;
  const layout = appBandLayout ?? layoutJourney(layoutNodes, { cardWidth });
  const placed = new Map(layout.nodes.map((node) => [node.key, node]));
  const outgoing = new Map<string, number>();
  for (const edge of layout.edges) {
    outgoing.set(edge.fromKey, (outgoing.get(edge.fromKey) ?? 0) + 1);
  }

  const screens: PlannedScreen[] = [];
  let frameCount = 0;
  const cards = ordered
    .filter((entry) => entry.kind === "card")
    .sort((a, b) => {
      const boxA = placed.get(a.layoutId)!.rect;
      const boxB = placed.get(b.layoutId)!.rect;
      return boxA.x - boxB.x || boxA.y - boxB.y;
    });
  const numberWidth = String(cards.length).length;
  const addScreen = (
    entry: Rendered,
    cardNumber: number,
    frame: JourneyFrame | null,
    geometry: { x: number; y: number; width: number; height: number },
    z: number,
    meta: string,
  ) => {
    const exampleIndex = frame?.exampleIndex ?? -1;
    const fileId = journeyFileId(designId, entry.node.key, exampleIndex);
    // Numbered in reading order: the Screens list reads left to right and filenames cannot collide.
    const filename = `${JOURNEY_FILENAME_PREFIX}${String(cardNumber).padStart(numberWidth, "0")}-${slug(entry.node.label)}${exampleIndex > 0 ? `-ex${exampleIndex + 1}` : ""}.html`;
    const isStackedExample = frame !== null && frame !== entry.frames[0];
    const example = frame ? entry.node.examples[frame.exampleIndex] : undefined;
    const rowId = journeyReplayRowId(fileId);
    const activeExampleIndex = frame
      ? entry.frames.findIndex(
          (candidate) => candidate.exampleIndex === frame.exampleIndex,
        )
      : -1;
    const galleryItems = entry.frames.map((candidate, index) => {
      const candidateExample = entry.node.examples[candidate.exampleIndex];
      const candidateReplayObservedAt = candidateExample
        ? replayObservedAt(
            candidate.recordingStartedAt,
            candidate.screenshotOffsetMs,
          )
        : null;
      const candidateProvenance = candidateExample
        ? {
            eventAt: utcTimestamp(candidateExample.ts),
            dateLabel: localizedDateLabel(
              candidate.caption?.dateLabel,
              entry.node.referenceOnly === true,
              candidateReplayObservedAt !== null,
              candidate.caption?.evidenceStatus === "generation_completed" &&
                candidate.caption.evidenceAt !== undefined,
              messages,
            ),
            recordingId: candidateExample.recordingId,
            ...(candidate.recordingStartedAt
              ? {
                  recordingStartedAt: utcTimestamp(
                    candidate.recordingStartedAt,
                  ),
                }
              : {}),
            offsetMs: candidate.screenshotOffsetMs ?? candidateExample.offsetMs,
            offsetIsObserved: candidate.screenshotOffsetMs !== undefined,
            checkpointOffsetMs: candidateExample.offsetMs,
            replayObservedAt: candidateReplayObservedAt,
            screenshotCapturedAt: utcTimestamp(candidate.capturedAt),
            ...(journeyFrameSourceApp(
              entry.node.key,
              tree.app,
              candidate.sourceApp,
            )
              ? {
                  sourceApp: journeyFrameSourceApp(
                    entry.node.key,
                    tree.app,
                    candidate.sourceApp,
                  )!,
                }
              : {}),
            ...(candidate.route ? { route: candidate.route } : {}),
            ...(candidate.caption ? { caption: candidate.caption } : {}),
          }
        : undefined;
      const candidateFileId = journeyFileId(
        designId,
        entry.node.key,
        candidate.exampleIndex,
      );
      const candidateRowId = journeyReplayRowId(candidateFileId);
      return {
        selectorId: `journey-example-${hashId(`${designId}\u0000${entry.node.key}`)}-${index}`,
        index,
        src:
          candidate.attachmentRef || candidate.stagedFrameId
            ? replayImageSrc(candidateRowId)
            : candidate.imageUrl!,
        external: Boolean(candidate.imageUrl),
        ...(candidateProvenance ? { provenance: candidateProvenance } : {}),
        alt: interpolateJourneyCanvasMessage(messages.screenshotAlt, {
          label: candidate.caption?.outputTitle ?? entry.node.label,
          current: formatInt(index + 1, messages.htmlLanguage),
          total: formatInt(entry.frames.length, messages.htmlLanguage),
          date: utcTimestamp(candidate.capturedAt).slice(0, 10),
        }),
      };
    });
    const provenance = galleryItems[activeExampleIndex]?.provenance;
    const html = annotateScreenHtmlForPersist(
      cardHtml({
        label: entry.node.label,
        meta,
        coverageNote: continuationNotes.get(entry.node.key),
        examples: galleryItems,
        activeExampleIndex,
        placeholder: messages.screenshotMissing,
        messages,
        headerHeight: provenance
          ? cardHeaderHeight(
              entry.frames,
              cardWidth,
              messages,
              continuationNotes.has(entry.node.key),
            )
          : CARD_HEADER_HEIGHT,
      }),
      "html",
    );
    assertDesignHtmlCreateIntegrity({
      content: html,
      fileType: "html",
      filename,
    });
    const sourceApp = frame
      ? journeyFrameSourceApp(entry.node.key, input.tree.app, frame.sourceApp)
      : null;
    screens.push({
      fileId,
      filename,
      html,
      title: isStackedExample ? "" : entry.node.label,
      nodeKey: entry.node.key,
      exampleIndex,
      ...(provenance ? { provenance } : {}),
      frame: { ...geometry, z },
      ...(frame?.attachmentRef || frame?.stagedFrameId
        ? {
            attachment: {
              ...(frame.attachmentRef ? { ref: frame.attachmentRef } : {}),
              ...(frame.stagedFrameId
                ? { stagedFrameId: frame.stagedFrameId }
                : {}),
              ...(sourceApp ? { sourceApp } : {}),
              rowId,
              replayId:
                example?.recordingId ?? example?.sessionId ?? entry.node.key,
              capturedAt: utcTimestamp(frame.capturedAt),
              offsetMs: Math.round(
                frame.screenshotOffsetMs ?? example?.offsetMs ?? 0,
              ),
              route: frame.route ?? entry.node.key.slice(0, 2_048),
              width: frame.width,
              height: frame.height,
            },
          }
        : {}),
    });
    if (frame) frameCount += 1;
  };

  cards.forEach((entry, cardIndex) => {
    const box = placed.get(entry.layoutId)!;
    const parent = effectiveParent.get(entry.node.key) ?? null;
    const viaSkipped = parent !== null && parent.key !== entry.node.parentKey;
    const meta = !hasCohortMetrics(entry.node)
      ? messages.observedSessionReference
      : !parent || !hasCohortMetrics(parent)
        ? input.layoutMode === "appBands"
          ? interpolateJourneyCanvasMessage(messages.sessionsOfAppRoot, {
              count: formatInt(entry.node.n, messages.htmlLanguage),
              percent: formatPercent(
                entry.node.pctOfRoot,
                messages.htmlLanguage,
              ),
              app: appDisplayName(appKeyForNode(entry.node.key)!),
              rootCount: formatInt(
                tree.appRootN![appKeyForNode(entry.node.key)!]!,
                messages.htmlLanguage,
              ),
            })
          : interpolateJourneyCanvasMessage(messages.sessionsOfAll, {
              count: formatInt(entry.node.n, messages.htmlLanguage),
              percent: formatPercent(
                entry.node.pctOfRoot,
                messages.htmlLanguage,
              ),
            })
        : viaSkipped
          ? interpolateJourneyCanvasMessage(messages.sessionsOfParent, {
              count: formatInt(entry.node.n, messages.htmlLanguage),
              percent: formatPercent(
                (entry.node.n / Math.max(1, parent.n)) * 100,
                messages.htmlLanguage,
              ),
              label: parent.label,
            })
          : interpolateJourneyCanvasMessage(messages.sessionsOfPrevious, {
              count: formatInt(entry.node.n, messages.htmlLanguage),
              percent: formatPercent(
                entry.node.pctOfParent,
                messages.htmlLanguage,
              ),
            });
    addScreen(
      entry,
      cardIndex + 1,
      entry.frames[0] ?? null,
      box.rect,
      10,
      meta,
    );
    entry.frames.slice(1).forEach((frame, index) => {
      addScreen(
        entry,
        cardIndex + 1,
        frame,
        box.layers[index]!,
        9 - index,
        meta,
      );
    });
  });

  const byLayoutId = new Map(ordered.map((entry) => [entry.layoutId, entry]));
  const labelText = (edge: PlacedEdge): string | null => {
    const child = byLayoutId.get(edge.toKey);
    if (!child || child.kind !== "card" || !hasCohortMetrics(child.node))
      return null;
    const parent = effectiveParent.get(child.node.key);
    if (!parent || !hasCohortMetrics(parent)) return null;
    const pct =
      parent.key === child.node.parentKey
        ? child.node.pctOfParent
        : (child.node.n / Math.max(1, parent.n)) * 100;
    return (outgoing.get(edge.fromKey) ?? 0) > 1 || pct < 99.5
      ? formatPercent(pct, messages.htmlLanguage)
      : null;
  };

  const boardFragments = (origin: Point): string[] => {
    const at = (rect: {
      x: number;
      y: number;
      width: number;
      height: number;
    }) => ({
      ...rect,
      x: rect.x + origin.x,
      y: rect.y + origin.y,
    });
    const fragments: string[] = [];
    const partial = tree.coverage.truncated
      ? ` · ${messages.partialSample}`
      : "";
    const titleSummary =
      input.layoutMode === "appBands"
        ? interpolateJourneyCanvasMessage(
            messages.journeyTitleAppBandsSummary,
            {
              from: tree.window.from,
              to: tree.window.to,
              partial,
            },
          )
        : interpolateJourneyCanvasMessage(messages.journeyTitleSummary, {
            app: tree.app,
            from: tree.window.from,
            to: tree.window.to,
            count: formatInt(tree.rootN, messages.htmlLanguage),
            partial,
          });
    const heading = at({ x: 0, y: -72, width: 560, height: 56 });
    fragments.push(
      boardDiv({
        id: `${JOURNEY_BOARD_ID_PREFIX}title`,
        name: "Journey title",
        primitive: "text",
        rect: heading,
        style: `padding:4px 12px;background:${SURFACE};border:1px solid ${BORDER};border-radius:6px;font-family:system-ui,sans-serif;color:${INK};overflow:hidden;white-space:nowrap;text-overflow:ellipsis`,
        html: `<div style="font-size:20px;line-height:28px;font-weight:600">${escapeHtml(input.title)}</div><div style="font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(titleSummary)}</div>`,
      }),
    );

    for (const band of appBandLayout?.bands ?? []) {
      fragments.push(
        boardDiv({
          id: `${JOURNEY_BOARD_ID_PREFIX}band-${hashId(`${designId}\u0000${band.key}`)}`,
          name: "App journey band",
          primitive: "text",
          rect: at({
            ...band.rect,
            height: APP_BAND_HEADER_HEIGHT,
          }),
          style: `padding:6px 10px;background:${SURFACE};border:1px solid ${BORDER};border-radius:6px;font-family:system-ui,sans-serif;color:${INK};overflow:hidden;white-space:nowrap;text-overflow:ellipsis`,
          html: escapeHtml(
            interpolateJourneyCanvasMessage(messages.appBandHeading, {
              app: appDisplayName(band.key),
              count: formatInt(band.rootN, messages.htmlLanguage),
            }),
          ),
        }),
      );
    }

    for (const edge of layout.edges) {
      const id = `${JOURNEY_BOARD_ID_PREFIX}edge-${hashId(`${designId}\u0000${edge.fromKey}\u0000${edge.toKey}`)}`;
      const child = byLayoutId.get(edge.toKey);
      const dashed = Boolean(
        child &&
        effectiveParent.get(child.node.key)?.key !== child.node.parentKey,
      );
      fragments.push(
        arrowFragment(
          id,
          "Journey edge",
          edge.points.map((point) => ({
            x: point.x + origin.x,
            y: point.y + origin.y,
          })),
          dashed,
        ),
      );
      const text = labelText(edge);
      if (text) {
        fragments.push(
          boardDiv({
            id: `${id}-label`,
            name: "Journey edge label",
            primitive: "text",
            rect: at(edge.labelRect),
            style: `background:${SURFACE};border:1px solid ${BORDER};border-radius:11px;text-align:center;font:600 12px/20px system-ui,sans-serif;color:${INK}`,
            html: escapeHtml(text),
          }),
        );
      }
    }

    for (const entry of ordered) {
      const box = placed.get(entry.layoutId)!;
      if (entry.kind === "stub") {
        if (!hasCohortMetrics(entry.node)) continue;
        fragments.push(
          stubFragment(
            `${JOURNEY_BOARD_ID_PREFIX}other-${hashId(`${designId}\u0000${entry.node.key}`)}`,
            messages.otherPaths,
            at(box.rect),
            MUTED,
            escapeHtml(entry.node.label),
            interpolateJourneyCanvasMessage(messages.sessionsOfPrevious, {
              count: formatInt(entry.node.n, messages.htmlLanguage),
              percent: formatPercent(
                entry.node.pctOfParent,
                messages.htmlLanguage,
              ),
            }),
          ),
        );
        continue;
      }
      const dropoff = dropoffOf.get(entry.node.key);
      if (dropoff) {
        const stub = placed.get(`d${entry.index}`)!;
        fragments.push(
          stubFragment(
            `${JOURNEY_BOARD_ID_PREFIX}dropoff-${hashId(`${designId}\u0000${entry.node.key}`)}`,
            messages.noLaterStepObserved,
            at(stub.rect),
            MUTED,
            messages.noLaterStepObserved,
            interpolateJourneyCanvasMessage(messages.sessionsOfStep, {
              count: formatInt(dropoff.dropoffN, messages.htmlLanguage),
              percent: formatPercent(dropoff.dropoffPct, messages.htmlLanguage),
            }),
          ),
        );
      }
    }
    return fragments;
  };

  return {
    screens,
    boardFragments,
    nodeCount: rendered.size,
    frameCount,
    skippedNodes,
  };
}

function stubFragment(
  id: string,
  name: string,
  rect: { x: number; y: number; width: number; height: number },
  marker: string,
  title: string,
  detail: string,
): string {
  return boardDiv({
    id,
    name,
    primitive: "rectangle",
    rect,
    style: `padding:7px 10px;background:${SURFACE};border:1px solid ${BORDER};border-left:4px solid ${marker};border-radius:6px;font-family:system-ui,sans-serif;overflow:hidden;white-space:nowrap`,
    html: `<div style="font-size:13px;line-height:18px;font-weight:600;color:${INK};overflow:hidden;text-overflow:ellipsis">${title}</div><div style="font-size:12px;line-height:16px;color:${MUTED}">${escapeHtml(detail)}</div>`,
  });
}

interface ParsedNode {
  nodeName: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  sourceCodeLocation?: { startOffset: number; endOffset: number } | null;
}

function findBody(node: ParsedNode): ParsedNode | null {
  if (node.nodeName === "body") return node;
  for (const child of node.childNodes ?? []) {
    const found = findBody(child);
    if (found) return found;
  }
  return null;
}

/**
 * Drops every top-level board object this action wrote earlier, byte-exactly
 * leaving everything else in place, then appends the new fragments.
 */
export function replaceJourneyBoardObjects(
  html: string,
  fragments: readonly string[],
): string {
  const document = parse(html, { sourceCodeLocationInfo: true }) as ParsedNode;
  const body = findBody(document);
  const ranges = (body?.childNodes ?? [])
    .filter((child) =>
      child.attrs?.some(
        (attr) =>
          attr.name === "data-agent-native-node-id" &&
          attr.value.startsWith(JOURNEY_BOARD_ID_PREFIX),
      ),
    )
    .flatMap((child) =>
      child.sourceCodeLocation
        ? [
            [
              child.sourceCodeLocation.startOffset,
              child.sourceCodeLocation.endOffset,
            ] as const,
          ]
        : [],
    )
    .sort((a, b) => b[0] - a[0]);
  let next = html;
  for (const [start, end] of ranges) {
    const trailing = next[end] === "\n" ? 1 : 0;
    next = next.slice(0, start) + next.slice(end + trailing);
  }
  return injectDocumentMarkup(next, `${fragments.join("\n")}\n`);
}
