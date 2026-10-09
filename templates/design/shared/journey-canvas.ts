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
  CARD_HEADER_HEIGHT,
  CARD_PROVENANCE_HEADER_HEIGHT,
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

export const MAX_JOURNEY_NODES = 300;
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
        "Replay offset from recording.startedAt for this screenshot; omit when it matches the example event offset.",
      ),
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
  });

export const createJourneyCanvasInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    tree: journeyTreeSchema,
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

const formatInt = (value: number) => value.toLocaleString("en-US");

export function formatPercent(value: number): string {
  const clamped = Math.min(100, Math.max(0, value));
  return `${clamped >= 10 ? Math.round(clamped) : Math.round(clamped * 10) / 10}%`;
}

function replayObservedAt(
  example: z.infer<typeof journeyExampleSchema> | undefined,
  screenshotOffsetMs: number | null,
): string | null {
  if (!example || example.offsetMs === null || screenshotOffsetMs === null) {
    return null;
  }
  const eventAt = Date.parse(example.ts);
  if (!Number.isFinite(eventAt)) return null;
  return new Date(
    eventAt - example.offsetMs + screenshotOffsetMs,
  ).toISOString();
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
    offsetMs: number | null;
    sourceEventOffsetMs: number | null;
    replayObservedAt: string | null;
    screenshotCapturedAt: string;
    caption?: JourneyFrameCaption;
  };
  /** Frame geometry relative to the canvas origin. */
  frame: { x: number; y: number; width: number; height: number; z: number };
  /** Set when the image is an attachment to copy or a staged private Design blob to consume. */
  attachment?: {
    ref?: string;
    stagedFrameId?: string;
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
): string {
  if (!provenance) return "";
  const recordingId = provenance.recordingId ?? "unavailable";
  const replayOffset =
    provenance.offsetMs === null
      ? "unavailable"
      : `${formatInt(provenance.offsetMs)} ms`;
  const caption = provenance.caption;
  const captionMarkup = caption
    ? [
        caption.outputTitle
          ? `<p class="caption-line" title="Output title: ${escapeHtml(caption.outputTitle)}">Output: ${escapeHtml(caption.outputTitle)}</p>`
          : "",
        caption.actor
          ? `<p class="caption-line" title="Actor source: ${escapeHtml(caption.actorSource ?? "recording metadata")}">Actor (recording): ${escapeHtml(caption.actor)}</p>`
          : "",
        caption.evidenceStatus === "generation_completed"
          ? `<p class="caption-line">Evidence: generation_completed event${caption.evidenceAt ? ` (${escapeHtml(caption.evidenceAt)} UTC)` : ""}</p>`
          : caption.evidenceStatus === "rendered_output_observed"
            ? '<p class="caption-line">Evidence: rendered output observed; no completion event claimed</p>'
            : "",
        caption.prompt
          ? `<details class="prompt"><summary title="Open the full prompt">Prompt: ${escapeHtml(promptExcerpt(caption.promptTranslation ?? caption.prompt))}</summary><div class="prompt-body">${caption.promptTranslation ? `<p><strong>Prompt (English)</strong><br>${escapeHtml(caption.promptTranslation)}</p>` : ""}<p><strong>Prompt (source)</strong><br>${escapeHtml(caption.prompt)}</p>${caption.promptSource ? `<p class="prompt-source">Source: ${escapeHtml(caption.promptSource)}</p>` : ""}</div></details>`
          : caption.promptUnavailableReason
            ? `<p class="caption-line" title="${escapeHtml(caption.promptUnavailableReason)}">Prompt not captured</p>`
            : "",
      ].join("")
    : "";
  return `<section class="example-provenance" data-index="${index}">${[
    `<p class="provenance" title="UTC timestamp: ${escapeHtml(provenance.eventAt)}">${escapeHtml(provenance.dateLabel)} ${escapeHtml(provenance.eventAt)}</p>`,
    `<p class="provenance recording-id" title="Recording ID: ${escapeHtml(recordingId)}">Recording ID ${escapeHtml(recordingId)}</p>`,
    `<p class="provenance" title="Replay offset: ${escapeHtml(replayOffset)}">Replay offset ${escapeHtml(replayOffset)}</p>`,
    provenance.sourceEventOffsetMs !== null &&
    provenance.sourceEventOffsetMs !== provenance.offsetMs
      ? `<p class="provenance" title="Source event offset: ${formatInt(provenance.sourceEventOffsetMs)} ms">Source event offset ${formatInt(provenance.sourceEventOffsetMs)} ms</p>`
      : "",
    provenance.replayObservedAt &&
    provenance.replayObservedAt !== provenance.eventAt
      ? `<p class="provenance" title="Replay observation UTC timestamp: ${escapeHtml(provenance.replayObservedAt)}">Replay observed ${escapeHtml(provenance.replayObservedAt)} UTC</p>`
      : "",
    `<p class="provenance" title="UTC screenshot export timestamp: ${escapeHtml(provenance.screenshotCapturedAt)}">Screenshot captured ${escapeHtml(provenance.screenshotCapturedAt.slice(0, 10))} UTC</p>`,
    captionMarkup,
  ].join("")}</section>`;
}

function promptExcerpt(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= 72 ? normalized : `${normalized.slice(0, 69)}…`;
}

interface ExampleGalleryItem {
  selectorId: string;
  index: number;
  src: string;
  alt: string;
  external: boolean;
  provenance?: PlannedScreen["provenance"];
}

function exampleSwitchMarkup(items: ExampleGalleryItem[]): string {
  if (items.length < 2) return "";
  const positions = items
    .map(
      (item) =>
        `<span class="example-position" data-index="${item.index}">Example ${item.index + 1} of ${items.length}</span>`,
    )
    .join("");
  const labels = items
    .map(
      (item) =>
        `<label for="${item.selectorId}" title="Show example ${item.index + 1} of ${items.length}">${item.index + 1}</label>`,
    )
    .join("");
  return `<div class="example-switcher" role="group" aria-label="Screenshot examples">${positions}${labels}</div>`;
}

function exampleSelectorsMarkup(
  items: ExampleGalleryItem[],
  activeIndex: number,
): string {
  if (items.length < 2) return "";
  return items
    .map(
      (item) =>
        `<input class="example-selector" type="radio" name="journey-example" id="${item.selectorId}" aria-label="Show example ${item.index + 1} of ${items.length}"${item.index === activeIndex ? " checked" : ""}>`,
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
}): string {
  const body = args.examples.length
    ? exampleGalleryMarkup(args.examples)
    : `<p>${escapeHtml(args.placeholder)}</p>`;
  const provenanceMarkup = args.examples
    .map((item, index) => cardProvenanceMarkup(item.provenance, index))
    .join("");
  return `<!DOCTYPE html>
<html lang="en">
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
header .provenance{font-size:9px;line-height:10px}
header .example-provenance{display:block}
header .recording-id{font-family:ui-monospace,monospace;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;white-space:normal;overflow-wrap:anywhere}
header .caption-line,header .prompt summary{font-size:10px;line-height:12px}
header details{margin:0;color:${MUTED};font-size:10px;line-height:12px}
header details summary{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
header details[open] .prompt-body{position:absolute;z-index:3;top:100%;left:0;width:100%;max-height:45vh;overflow:auto;padding:8px 12px;background:${SURFACE};border:1px solid ${BORDER};box-shadow:0 4px 12px ${PROMPT_SHADOW};white-space:pre-wrap;color:${INK}}
header .prompt-body p{margin:0 0 8px;overflow:visible;text-overflow:clip;white-space:pre-wrap;color:${INK};overflow-wrap:anywhere}
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
${exampleSelectorsMarkup(args.examples, args.activeExampleIndex)}
<header><h1>${escapeHtml(args.label)}</h1><p class="metrics">${escapeHtml(args.meta)}</p>${args.coverageNote ? `<p class="coverage-note" title="${escapeHtml(args.coverageNote)}">${escapeHtml(args.coverageNote)}</p>` : ""}${provenanceMarkup}${exampleSwitchMarkup(args.examples)}</header>
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

  const childSessionsByParent = new Map<string, number>();
  for (const node of tree.nodes) {
    if (node.parentKey === null || !hasCohortMetrics(node)) continue;
    const pictured =
      node.kind === "other" ||
      (framesByNode.get(node.key)?.length ?? 0) > 0 ||
      (node.kind === "step" && includeScreenshotless);
    if (!pictured) continue;
    childSessionsByParent.set(
      node.parentKey,
      (childSessionsByParent.get(node.parentKey) ?? 0) + node.n,
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
    const sessionLabel = continued === 1 ? "session" : "sessions";
    continuationNotes.set(
      node.key,
      `${formatInt(continued)} ${sessionLabel} continued on unpictured paths · ${formatPercent((continued / Math.max(1, node.n)) * 100)} of this step`,
    );
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

  // Analytics already returns roots and siblings in presentation order. Keep
  // that order so concatenated app journeys stay grouped on the canvas.
  const ordered = [...rendered.values()];

  const layoutNodes: JourneyLayoutNode[] = [];
  const dropoffOf = new Map<string, z.infer<typeof cohortJourneyNodeSchema>>();
  const effectiveParent = new Map<string, JourneyNode | null>();
  for (const entry of ordered) {
    const parent = nearestCardAncestor(entry.node);
    effectiveParent.set(entry.node.key, parent);
    const parentId = parent ? rendered.get(parent.key)!.layoutId : null;
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
              ? CARD_PROVENANCE_HEADER_HEIGHT +
                (entry.frames.some((frame) => frame.caption) ? 48 : 0) +
                (entry.frames.some((frame) => frame.caption?.evidenceAt)
                  ? 12
                  : 0) +
                (entry.frames.some((frame) => {
                  const eventOffset =
                    entry.node.examples[frame.exampleIndex]?.offsetMs;
                  return (
                    frame.screenshotOffsetMs !== undefined &&
                    eventOffset != null &&
                    frame.screenshotOffsetMs !== eventOffset
                  );
                })
                  ? 20
                  : 0) +
                (continuationNotes.has(entry.node.key) ? 12 : 0) +
                (entry.frames.length > 1 ? 20 : 0)
              : CARD_HEADER_HEIGHT,
            layers: Math.max(0, entry.frames.length - 1),
            footer: entry.frames.length > 0,
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
    }
  }

  const layout = layoutJourney(layoutNodes, { cardWidth });
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
      const candidateProvenance = candidateExample
        ? {
            eventAt: candidateExample.ts,
            dateLabel:
              candidate.caption?.dateLabel ??
              (entry.node.referenceOnly
                ? "Replay observation (UTC)"
                : "Event time (UTC)"),
            recordingId: candidateExample.recordingId,
            offsetMs: candidate.screenshotOffsetMs ?? candidateExample.offsetMs,
            sourceEventOffsetMs: candidateExample.offsetMs,
            replayObservedAt: replayObservedAt(
              candidateExample,
              candidate.screenshotOffsetMs ?? candidateExample.offsetMs,
            ),
            screenshotCapturedAt: candidate.capturedAt,
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
        alt: `${candidate.caption?.outputTitle ?? entry.node.label}, example ${index + 1} of ${entry.frames.length}, captured ${candidate.capturedAt.slice(0, 10)}`,
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
        placeholder: "No screenshot captured",
        headerHeight: provenance
          ? CARD_PROVENANCE_HEADER_HEIGHT +
            (entry.frames.some((candidate) => candidate.caption) ? 48 : 0) +
            (entry.frames.some((candidate) => candidate.caption?.evidenceAt)
              ? 12
              : 0) +
            (entry.frames.some((candidate) => {
              const eventOffset =
                entry.node.examples[candidate.exampleIndex]?.offsetMs;
              return (
                candidate.screenshotOffsetMs !== undefined &&
                eventOffset != null &&
                candidate.screenshotOffsetMs !== eventOffset
              );
            })
              ? 20
              : 0) +
            (continuationNotes.has(entry.node.key) ? 12 : 0) +
            (entry.frames.length > 1 ? 20 : 0)
          : CARD_HEADER_HEIGHT,
      }),
      "html",
    );
    assertDesignHtmlCreateIntegrity({
      content: html,
      fileType: "html",
      filename,
    });
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
              rowId,
              replayId:
                example?.recordingId ?? example?.sessionId ?? entry.node.key,
              capturedAt: frame.capturedAt,
              offsetMs: Math.round(
                frame.screenshotOffsetMs ?? example?.offsetMs ?? 0,
              ),
              route: entry.node.key.slice(0, 2_048),
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
      ? "Observed session reference"
      : !parent || !hasCohortMetrics(parent)
        ? `${formatInt(entry.node.n)} sessions · ${formatPercent(entry.node.pctOfRoot)} of all`
        : viaSkipped
          ? `${formatInt(entry.node.n)} sessions · ${formatPercent((entry.node.n / Math.max(1, parent.n)) * 100)} of ${parent.label}`
          : `${formatInt(entry.node.n)} sessions · ${formatPercent(entry.node.pctOfParent)} of previous`;
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
      ? formatPercent(pct)
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
    const heading = at({ x: 0, y: -72, width: 560, height: 56 });
    fragments.push(
      boardDiv({
        id: `${JOURNEY_BOARD_ID_PREFIX}title`,
        name: "Journey title",
        primitive: "text",
        rect: heading,
        style: `padding:4px 12px;background:${SURFACE};border:1px solid ${BORDER};border-radius:6px;font-family:system-ui,sans-serif;color:${INK};overflow:hidden;white-space:nowrap;text-overflow:ellipsis`,
        html: `<div style="font-size:20px;line-height:28px;font-weight:600">${escapeHtml(input.title)}</div><div style="font-size:13px;line-height:20px;color:${MUTED}">${escapeHtml(
          `${tree.app} · ${tree.window.from} to ${tree.window.to} · ${formatInt(tree.rootN)} sessions${tree.coverage.truncated ? " · partial sample" : ""}`,
        )}</div>`,
      }),
    );

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
            "Other paths",
            at(box.rect),
            MUTED,
            escapeHtml(entry.node.label),
            `${formatInt(entry.node.n)} sessions · ${formatPercent(entry.node.pctOfParent)}`,
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
            "No later step observed",
            at(stub.rect),
            MUTED,
            "No later step observed",
            `${formatInt(dropoff.dropoffN)} sessions · ${formatPercent(dropoff.dropoffPct)} of this step`,
          ),
        );
      }
      if (box.footer && entry.frames[0]) {
        const extra = entry.frames.length - 1;
        fragments.push(
          boardDiv({
            id: `${JOURNEY_BOARD_ID_PREFIX}date-${hashId(`${designId}\u0000${entry.node.key}`)}`,
            name: "Captured date",
            primitive: "text",
            rect: at(box.footer),
            style: `padding:0 8px;background:${SURFACE};border:1px solid ${BORDER};border-radius:4px;font:12px/20px system-ui,sans-serif;color:${MUTED};white-space:nowrap;overflow:hidden;text-overflow:ellipsis`,
            html: escapeHtml(
              `Captured ${entry.frames[0].capturedAt.slice(0, 10)}${extra > 0 ? ` · ${extra + 1} examples` : ""}`,
            ),
          }),
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
