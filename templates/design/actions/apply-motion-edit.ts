/**
 * apply-motion-edit — ATOMIC motion timeline write (§6.3).
 *
 * One action does all of:
 * 1. Validate the timeline against the design's source capabilities.
 * 2. Persist the `motion_timeline` row (insert or update).
 * 3. Compile the tracks into deterministic CSS.
 * 4. Inject/replace the managed `<style data-agent-native-motion>` block inside
 *    the design's HTML content, using the same persist path as apply-visual-edit
 *    (Yjs/collab + SQL, via agentEnterDocument / applyText / seedFromText).
 * 5. Update `compiledHash` on the row to guard against drift.
 * 6. Return a diff summary (bytes before/after, track count, hash).
 *
 * Never writes unless all steps succeed. Scrubbing/preview is handled by the
 * separate `motion-preview` postMessage path on the frontend — this action is
 * the deliberate "Write to CSS" commit step.
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
  applyText,
  getText,
  hasCollabState,
  seedFromText,
} from "@agent-native/core/collab";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import { compile } from "../shared/motion-compiler.js";
import type { MotionTrack } from "../shared/motion-timeline.js";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const keyframeSchema = z.object({
  t: z
    .number()
    .min(0)
    .max(1)
    .describe("Normalised time in [0, 1] where 0 = 0% and 1 = 100%."),
  value: z.string().describe("CSS property value at this keyframe."),
  ease: z
    .string()
    .optional()
    .describe(
      'Per-keyframe easing, e.g. "ease-out" or "cubic-bezier(0.4,0,0.2,1)".',
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
    .describe('CSS property to animate, e.g. "opacity" or "transform".'),
  keyframes: z
    .array(keyframeSchema)
    .min(1)
    .describe("At least one keyframe is required per track."),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOTION_STYLE_OPEN = "<style data-agent-native-motion>";
const MOTION_STYLE_CLOSE = "</style>";

/**
 * Bounded, case-insensitive matcher for any HTML `</style>` end tag
 * (`</style >`, `</STYLE>`, …). Used to locate the close of the managed block
 * without a naive `indexOf("</style>")` that would miss case/whitespace
 * variants — and to detect any `</style` sequence smuggled into compiled CSS.
 */
const STYLE_CLOSE_RE = /<\s*\/\s*style\b[^>]*>/i;

/**
 * Reject `<`, `>`, and any `</style` sequence in a CSS token before it is
 * compiled into the managed `<style>` block. Keyframe `value` / `ease` come
 * straight from the caller and are interpolated raw into the CSS, so an
 * unescaped `</style>` (or angle bracket) would break out of the style block
 * and inject arbitrary markup. Returns the original string when safe; throws on
 * a breakout attempt so the whole atomic write fails loudly rather than
 * persisting a poisoned block.
 */
function assertSafeCssToken(value: string, field: string): string {
  if (/[<>]/.test(value) || /<\s*\/\s*style/i.test(value)) {
    throw new Error(
      `Invalid ${field}: "<", ">", and "</style" are not allowed in motion CSS values.`,
    );
  }
  return value;
}

/**
 * Inject or replace the managed `<style data-agent-native-motion>` block in
 * the HTML content.  Inserts before `</head>` when not already present.
 */
function injectMotionStyle(html: string, css: string): string {
  const open = MOTION_STYLE_OPEN;
  const close = MOTION_STYLE_CLOSE;
  const openIdx = html.indexOf(open);

  if (openIdx !== -1) {
    // Find the matching closing tag after the open tag using a bounded regex
    // (tolerates `</style >`, `</STYLE>`, etc.) instead of a literal indexOf.
    const after = html.slice(openIdx + open.length);
    const closeMatch = STYLE_CLOSE_RE.exec(after);
    if (closeMatch) {
      const closeIdx = openIdx + open.length + closeMatch.index;
      // Replace the existing block.
      return (
        html.slice(0, openIdx) + open + "\n" + css + "\n" + html.slice(closeIdx)
      );
    }
  }

  // Not found — insert before </head> or, if there is no <head>, at the top.
  const headClose = html.lastIndexOf("</head>");
  const block = `${open}\n${css}\n${close}`;
  if (headClose !== -1) {
    return html.slice(0, headClose) + block + "\n" + html.slice(headClose);
  }
  return block + "\n" + html;
}

async function liveFileContent(
  fileId: string,
  storedContent: string,
): Promise<string> {
  try {
    if (await hasCollabState(fileId)) {
      const live = await getText(fileId, "content");
      if (typeof live === "string") return live;
    }
  } catch {
    // Best-effort; SQL is the fallback.
  }
  return storedContent;
}

async function persistFileContent(
  fileId: string,
  designId: string,
  content: string,
  now: string,
): Promise<void> {
  const db = getDb();
  agentEnterDocument(fileId);
  try {
    await db
      .update(schema.designFiles)
      .set({ content, updatedAt: now })
      .where(eq(schema.designFiles.id, fileId));

    if (await hasCollabState(fileId)) {
      await applyText(fileId, content, "content", "agent");
    } else {
      await seedFromText(fileId, content);
    }

    await db
      .update(schema.designs)
      .set({ updatedAt: now })
      .where(eq(schema.designs.id, designId));
  } finally {
    agentLeaveDocument(fileId);
  }
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Atomically write a motion timeline to a design. " +
    "Persists the motion_timeline row, compiles tracks to CSS, injects the " +
    "managed <style data-agent-native-motion> block into the design's HTML, " +
    "and updates compiledHash — all in one atomic step. " +
    "This is the 'Write to CSS' commit path; preview/scrubbing uses the " +
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
          "data-agent-native-node-id and animates one CSS property.",
      ),
    durationMs: z
      .number()
      .int()
      .positive()
      .default(300)
      .describe("Total animation duration in milliseconds."),
    defaultEase: z
      .string()
      .default("ease")
      .describe(
        "Default easing applied to keyframe intervals that omit ease. " +
          'E.g. "ease", "ease-in-out", "cubic-bezier(0.4,0,0.2,1)".',
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
  }),
  run: async ({
    designId,
    fileId: fileIdInput,
    timelineId,
    sourceRef,
    tracks,
    durationMs,
    defaultEase,
    includeContent,
  }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();
    const now = new Date().toISOString();

    // ── 1. Resolve the target design file ──────────────────────────────────
    const conditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
    ];
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
    const currentContent = await liveFileContent(fileId, file.content ?? "");

    // ── 2. Compile tracks → CSS ─────────────────────────────────────────────
    const typedTracks = tracks as MotionTrack[];

    // Reject CSS-injection vectors in caller-supplied keyframe values and
    // easing strings before they are compiled into the managed <style> block.
    for (const track of typedTracks) {
      for (const kf of track.keyframes) {
        assertSafeCssToken(kf.value, "keyframe value");
        if (kf.ease !== undefined) {
          assertSafeCssToken(kf.ease, "keyframe ease");
        }
      }
    }
    assertSafeCssToken(defaultEase, "defaultEase");

    const { css, hash } = compile({
      id: timelineId ?? "",
      designId,
      sourceRef: sourceRef ?? null,
      filePath: null,
      tracks: typedTracks,
      durationMs,
      defaultEase,
      compiledHash: null,
      createdAt: now,
      updatedAt: now,
    });

    // ── 3. Inject the managed CSS block into the HTML ───────────────────────
    const patchedContent = injectMotionStyle(currentContent, css);
    const bytesBefore = currentContent.length;
    const bytesAfter = patchedContent.length;

    // ── 4. Pre-flight the motion_timeline row write ─────────────────────────
    // Resolve everything that can fail (existence + ownership) BEFORE touching
    // content, so we never persist HTML for a row that can't be written.
    const tracksJson = JSON.stringify(typedTracks);
    const resolvedTimelineId = timelineId ?? nanoid();

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
      // Insert new row — derive ownership from the request context (same
      // pattern as create-design-state and other create actions).
      insertOwnerEmail = getRequestUserEmail() ?? null;
      if (!insertOwnerEmail) throw new Error("no authenticated user");
      insertOrgId = getRequestOrgId() ?? null;
    }

    // ── 5. Persist the patched HTML content FIRST (Yjs/collab + SQL) ─────────
    // Content is written before the row so a partial failure can't leave a
    // motion_timeline row pointing at HTML that was never updated (drift).
    await persistFileContent(fileId, designId, patchedContent, now);

    // ── 6. Persist the motion_timeline row SECOND (atomic SQL portion) ──────
    await db.transaction(async (tx) => {
      if (timelineId) {
        await tx
          .update(schema.motionTimeline)
          .set({
            tracks: tracksJson,
            durationMs,
            defaultEase,
            compiledHash: hash,
            sourceRef: sourceRef ?? null,
            updatedAt: now,
          })
          .where(eq(schema.motionTimeline.id, timelineId));
      } else {
        await tx.insert(schema.motionTimeline).values({
          id: resolvedTimelineId,
          designId,
          sourceRef: sourceRef ?? null,
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

    return {
      timelineId: resolvedTimelineId,
      designId,
      fileId,
      trackCount: typedTracks.length,
      compiledHash: hash,
      bytesBefore,
      bytesAfter,
      bytesDelta: bytesAfter - bytesBefore,
      persisted: true,
      patchedContent: includeContent ? patchedContent : undefined,
    };
  },
});
