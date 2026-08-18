/**
 * Update a meeting's metadata. Editor access required.
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { nanoid } from "../server/lib/recordings.js";
import { booleanParam } from "./lib/cli-params.js";

export default defineAction({
  description:
    "Partially update a meeting (title, schedule, notes, summary, action items). Only provided fields are updated.",
  schema: z.object({
    id: z.string().describe("Meeting id"),
    title: z.string().optional(),
    scheduledStart: z.string().nullish(),
    scheduledEnd: z.string().nullish(),
    actualStart: z.string().nullish(),
    actualEnd: z.string().nullish(),
    platform: z
      .enum(["zoom", "meet", "teams", "webex", "phone", "adhoc", "other"])
      .optional(),
    joinUrl: z.string().nullish(),
    userNotesMd: z.string().optional(),
    summaryMd: z.string().optional(),
    bullets: z
      .array(z.object({ text: z.string() }))
      .optional()
      .describe("Replace the bullet set"),
    actionItems: z
      .array(
        z.object({
          id: z.string().optional(),
          assigneeEmail: z.string().email().nullable().optional(),
          text: z.string().trim().min(1),
          dueDate: z.string().nullable().optional(),
          completedAt: z.string().nullable().optional(),
        }),
      )
      .optional()
      .describe("Replace the action item set on the meeting"),
    transcriptStatus: z.enum(["idle", "pending", "ready", "failed"]).optional(),
    shareTranscript: booleanParam
      .optional()
      .describe(
        "Include the linked recording transcript on meeting share pages",
      ),
    visibility: z.enum(["private", "org", "public"]).optional(),
  }),
  run: async (args) => {
    const updatesSharing =
      args.shareTranscript !== undefined || args.visibility !== undefined;
    await assertAccess("meeting", args.id, updatesSharing ? "admin" : "editor");
    const db = getDb();

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };
    if (typeof args.title === "string") patch.title = args.title.trim();
    if (args.scheduledStart !== undefined)
      patch.scheduledStart = args.scheduledStart ?? null;
    if (args.scheduledEnd !== undefined)
      patch.scheduledEnd = args.scheduledEnd ?? null;
    if (args.actualStart !== undefined)
      patch.actualStart = args.actualStart ?? null;
    if (args.actualEnd !== undefined) patch.actualEnd = args.actualEnd ?? null;
    if (args.platform) patch.platform = args.platform;
    if (args.joinUrl !== undefined) patch.joinUrl = args.joinUrl ?? null;
    if (typeof args.userNotesMd === "string")
      patch.userNotesMd = args.userNotesMd;
    if (typeof args.summaryMd === "string") patch.summaryMd = args.summaryMd;
    if (args.bullets) patch.bulletsJson = JSON.stringify(args.bullets);
    const normalizedActionItems = args.actionItems?.map((item) => ({
      id: item.id?.trim() || nanoid(),
      assigneeEmail: item.assigneeEmail ?? null,
      text: item.text.trim(),
      dueDate: item.dueDate ?? null,
      completedAt: item.completedAt ?? null,
    }));
    if (normalizedActionItems !== undefined)
      patch.actionItemsJson = JSON.stringify(normalizedActionItems);
    if (args.transcriptStatus) patch.transcriptStatus = args.transcriptStatus;
    if (args.shareTranscript !== undefined)
      patch.shareTranscript = args.shareTranscript;
    if (args.visibility) patch.visibility = args.visibility;

    // Keep the denormalized JSON used by the summary and the dedicated action
    // item rows used by list/query surfaces in sync as one mutation. In
    // particular, completion state and manual edits must survive a refresh.
    await db.transaction(async (tx) => {
      await tx
        .update(schema.meetings)
        .set(patch)
        .where(eq(schema.meetings.id, args.id));

      if (normalizedActionItems !== undefined) {
        await tx
          .delete(schema.meetingActionItems)
          .where(eq(schema.meetingActionItems.meetingId, args.id));
        if (normalizedActionItems.length > 0) {
          await tx.insert(schema.meetingActionItems).values(
            normalizedActionItems.map((item) => ({
              id: item.id,
              meetingId: args.id,
              assigneeEmail: item.assigneeEmail,
              text: item.text,
              dueDate: item.dueDate,
              completedAt: item.completedAt,
            })),
          );
        }
      }
    });

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.id))
      .limit(1);

    return { meeting, actionItems: normalizedActionItems };
  },
});
