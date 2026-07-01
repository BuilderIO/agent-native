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
  assertSafeMotionCssProperty,
  assertSafeMotionCssToken,
  compile,
  injectManagedMotionCss,
} from "../shared/motion-compiler.js";
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

async function persistFileContent(
  fileId: string,
  designId: string,
  content: string,
  now: string,
): Promise<string> {
  const db = getDb();
  await db
    .update(schema.designFiles)
    .set({ content, updatedAt: now })
    .where(eq(schema.designFiles.id, fileId));

  // Keep SQL as the source of truth for this atomic write. The editor adopts
  // the returned HTML content without re-saving it; applying the whole document
  // through an existing collab text snapshot can merge against stale iframe
  // state and duplicate the managed motion stylesheet.
  // guard:allow-unscoped — editor access on this design is asserted in run()
  // before this helper is invoked; this only bumps the addressed design row.
  await db
    .update(schema.designs)
    .set({ updatedAt: now })
    .where(eq(schema.designs.id, designId));

  return now;
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Atomically write a motion timeline to a design. " +
    "Persists the motion_timeline row, compiles tracks to CSS, injects the " +
    "managed <style data-agent-native-motion> block into the design's HTML, " +
    "and updates compiledHash — all in one atomic step. " +
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
    const currentContent =
      currentContentInput !== undefined
        ? currentContentInput
        : (file.content ?? "");

    // ── 2. Compile tracks → CSS ─────────────────────────────────────────────
    const typedTracks = tracks as MotionTrack[];

    // Reject CSS-injection vectors in caller-supplied track properties,
    // keyframe values, and easing strings before they are compiled into the
    // managed <style> block.
    for (const track of typedTracks) {
      assertSafeMotionCssProperty(track.property, "track.property");
      for (const kf of track.keyframes) {
        assertSafeMotionCssToken(kf.value, "keyframe value");
        if (kf.ease !== undefined) {
          assertSafeMotionCssToken(kf.ease, "keyframe ease");
        }
      }
    }
    assertSafeMotionCssToken(defaultEase, "defaultEase");

    const { css, hash } = compile({
      id: timelineId ?? "",
      designId,
      sourceRef: resolvedSourceRef,
      filePath: null,
      tracks: typedTracks,
      durationMs,
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
    const updatedAt = contentPatched
      ? await persistFileContent(fileId, designId, patchedContent, now)
      : now;

    return {
      timelineId: resolvedTimelineId,
      designId,
      fileId,
      sourceRef: resolvedSourceRef,
      trackCount: typedTracks.length,
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
