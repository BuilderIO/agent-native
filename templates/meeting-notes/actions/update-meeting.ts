/**
 * Partially update a meeting's metadata.
 *
 * Usage:
 *   pnpm action update-meeting --id=<id> --title="New title"
 *   pnpm action update-meeting --id=<id> --status=done
 */

import { defineAction } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "../server/db/index.js";
import { getCurrentOwnerEmail } from "../server/lib/meetings.js";

export default defineAction({
  description:
    "Partially update a meeting's metadata and status. All fields are optional — only the ones you pass get updated.",
  schema: z.object({
    id: z.string().describe("Meeting ID"),
    title: z.string().optional(),
    startTime: z.string().nullish(),
    endTime: z.string().nullish(),
    status: z
      .enum(["scheduled", "recording", "enhancing", "done"])
      .optional(),
    folderId: z.string().nullish(),
    calendarEventId: z.string().nullish(),
    calendarProvider: z.enum(["google", "microsoft"]).nullish(),
  }),
  run: async (args) => {
    const db = getDb();
    const ownerEmail = getCurrentOwnerEmail();

    const [existing] = await db
      .select()
      .from(schema.meetings)
      .where(
        and(
          eq(schema.meetings.id, args.id),
          eq(schema.meetings.ownerEmail, ownerEmail),
        ),
      );
    if (!existing) throw new Error(`Meeting not found: ${args.id}`);

    const patch: Record<string, unknown> = {
      updatedAt: new Date().toISOString(),
    };

    if (typeof args.title === "string") patch.title = args.title.trim();
    if (args.startTime !== undefined)
      patch.startTime = args.startTime ?? null;
    if (args.endTime !== undefined) patch.endTime = args.endTime ?? null;
    if (args.status) patch.status = args.status;
    if (args.folderId !== undefined) patch.folderId = args.folderId ?? null;
    if (args.calendarEventId !== undefined)
      patch.calendarEventId = args.calendarEventId ?? null;
    if (args.calendarProvider !== undefined)
      patch.calendarProvider = args.calendarProvider ?? null;

    await db
      .update(schema.meetings)
      .set(patch)
      .where(eq(schema.meetings.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    const [updated] = await db
      .select()
      .from(schema.meetings)
      .where(eq(schema.meetings.id, args.id));

    console.log(`Updated meeting ${args.id}`);
    return { id: args.id, meeting: updated };
  },
});
