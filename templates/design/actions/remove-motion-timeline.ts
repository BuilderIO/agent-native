
import { defineAction } from "@agent-native/core/action";
import {
  agentEnterDocument,
  agentLeaveDocument,
} from "@agent-native/core/collab";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import "../server/db/index.js";
import { snapshotDesignBeforeAgentEdit } from "../server/lib/design-versions.js";
import {
  readLiveSourceFile,
  writeInlineSourceFile,
  type SourceWorkspaceFile,
} from "../server/source-workspace.js";


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
  const end = closeIdx + MOTION_STYLE_CLOSE.length;
  const tail = html[end] === "\n" ? end + 1 : end;
  return html.slice(0, openIdx) + html.slice(tail);
}


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
  run: async ({ designId, timelineId, fileId: fileIdInput }, context) => {
    await assertAccess("design", designId, "editor");
    await snapshotDesignBeforeAgentEdit(designId, context);

    const db = getDb();

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
