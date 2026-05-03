/**
 * Update a meeting's metadata. Editor access required.
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

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
          assigneeEmail: z.string().email().optional(),
          text: z.string(),
          dueDate: z.string().optional(),
        }),
      )
      .optional()
      .describe("Replace the action item set on the meetings row JSON"),
    transcriptStatus: z.enum(["idle", "pending", "ready", "failed"]).optional(),
    visibility: z.enum(["private", "org", "public"]).optional(),
  }),
  run: async (args) => {
    await assertAccess("meeting", args.id, "editor");
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
    if (args.actionItems)
      patch.actionItemsJson = JSON.stringify(args.actionItems);
    if (args.transcriptStatus) patch.transcriptStatus = args.transcriptStatus;
    if (args.visibility) patch.visibility = args.visibility;

    await db
      .update(schema.meetings)
      .set(patch)
      .where(eq(schema.meetings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [meeting] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.id))
      .limit(1);

    return { meeting };
  },
});
