/**
 * remove-motion-timeline — ATOMIC delete of a motion timeline row and its
 * managed `<style data-agent-native-motion>` block (§6.3).
 *
 * Steps performed atomically:
 * 1. Verify the timeline belongs to this design and the caller has editor access.
 * 2. Delete the `motion_timeline` row.
 * 3. Remove the managed CSS block from the design's HTML content.
 * 4. Persist the cleaned HTML via the same Yjs/collab + SQL path used by
 *    apply-visual-edit.
 */

import { defineAction } from "@agent-native/core";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js"; // ensure registerShareableResource runs
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MOTION_STYLE_OPEN = "<style data-agent-native-motion>";
const MOTION_STYLE_CLOSE = "</style>";

function removeMotionStyleBlock(html: string): string {
  const openIdx = html.indexOf(MOTION_STYLE_OPEN);
  if (openIdx === -1) return html;
  const closeIdx = html.indexOf(
    MOTION_STYLE_CLOSE,
    openIdx + MOTION_STYLE_OPEN.length,
  );
  if (closeIdx === -1) return html;
  // Also trim the optional newline that injectMotionStyle adds after the block.
  const end = closeIdx + MOTION_STYLE_CLOSE.length;
  const tail = html[end] === "\n" ? end + 1 : end;
  return html.slice(0, openIdx) + html.slice(tail);
}

// ─── Action ───────────────────────────────────────────────────────────────────

export default defineAction({
  description:
    "Atomically delete a motion timeline row and remove the managed " +
    "<style data-agent-native-motion> block from the design's HTML. " +
    "This is the inverse of apply-motion-edit. The HTML is persisted via " +
    "the same Yjs/collab path so live editors see the change immediately.",
  schema: z.object({
    designId: z.string().describe("Design project ID."),
    timelineId: z.string().describe("motion_timeline.id to delete."),
    fileId: z
      .string()
      .optional()
      .describe(
        "Target design_files.id. Defaults to the design's primary index.html " +
          "when omitted.",
      ),
  }),
  run: async ({ designId, timelineId, fileId: fileIdInput }) => {
    await assertAccess("design", designId, "editor");

    const db = getDb();

    // ── 1. Verify timeline exists and belongs to this design ────────────────
    const [timeline] = await db
      .select({ id: schema.motionTimeline.id })
      .from(schema.motionTimeline)
      .where(
        and(
          eq(schema.motionTimeline.id, timelineId),
          eq(schema.motionTimeline.designId, designId),
        ),
      )
      .limit(1);

    if (!timeline) {
      throw new Error(
        `motion_timeline not found for this design: ${timelineId}`,
      );
    }

    // ── 2. Resolve the target HTML file ─────────────────────────────────────
    const fileConditions = [
      accessFilter(schema.designs, schema.designShares),
      eq(schema.designFiles.designId, designId),
    ];
    if (fileIdInput) {
      fileConditions.push(eq(schema.designFiles.id, fileIdInput));
    } else {
      fileConditions.push(eq(schema.designFiles.filename, "index.html"));
    }

    const [file] = await db
      .select({
        id: schema.designFiles.id,
        content: schema.designFiles.content,
      })
      .from(schema.designFiles)
      .innerJoin(
        schema.designs,
        eq(schema.designFiles.designId, schema.designs.id),
      )
      .where(and(...fileConditions))
      .limit(1);

    if (!file) {
      // The timeline row can still be deleted even if the file is gone.
      await db
        .delete(schema.motionTimeline)
        .where(eq(schema.motionTimeline.id, timelineId));
      return {
        timelineId,
        designId,
        deleted: true,
        htmlPatched: false,
        reason: "File not found — timeline row deleted without HTML cleanup.",
      };
    }

    // ── 3. Remove the managed CSS block from the HTML ───────────────────────
    // Read the LIVE base (collab text when present, else the SQL row) right
    // before transforming, and carry its versionHash through to the write
    // below. writeInlineSourceFile re-reads the live text immediately before
    // its own applyText/DB write and rejects if it no longer matches this
    // hash — closing the race window where a concurrent editor/agent write
    // lands between this read and the persist (the same stale-diff-base bug
    // fixed for insert-design-native-asset.ts/insert-asset.ts: a diff computed
    // from a stale base, written unconditionally, can corrupt or drop the
    // other writer's concurrent change).
    const workspaceFile: SourceWorkspaceFile = {
      id: file.id,
      designId,
      filename: "",
      fileType: "html",
      content: file.content,
      createdAt: null,
      updatedAt: null,
    };
    const live = await readLiveSourceFile(workspaceFile);
    const currentContent = live.content;
    const bytesBefore = currentContent.length;
    const cleanedContent = removeMotionStyleBlock(currentContent);
    const bytesAfter = cleanedContent.length;
    const htmlChanged = cleanedContent !== currentContent;

    // ── 4. Clean the HTML/style block FIRST, then delete the row LAST ───────
    // Ordering matters: if the HTML cleanup persists but the row delete fails,
    // re-running this action is idempotent (the block is already gone, the row
    // is still deletable). The reverse order could leave an orphaned managed
    // <style> block with no row to track it.
    if (htmlChanged) {
      agentEnterDocument(file.id);
      try {
        await writeInlineSourceFile({
          designId,
          file: workspaceFile,
          content: cleanedContent,
          expectedVersionHash: live.versionHash,
        });
      } finally {
        agentLeaveDocument(file.id);
      }
    }

    // ── 5. Delete the motion_timeline row LAST (so a failure leaves no
    //        orphaned row pointing at HTML that was already cleaned). ────────
    await db
      .delete(schema.motionTimeline)
      .where(eq(schema.motionTimeline.id, timelineId));

    return {
      timelineId,
      designId,
      fileId: file.id,
      deleted: true,
      htmlPatched: htmlChanged,
      bytesBefore,
      bytesAfter,
      bytesDelta: bytesAfter - bytesBefore,
    };
  },
});
