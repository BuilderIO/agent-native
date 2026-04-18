import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { resolveDefaultWorkspaceId } from "../server/lib/calls.js";

export default defineAction({
  description:
    "List scheduled and active Recall.ai bots for the current workspace. Defaults to non-final statuses (scheduled, joining, recording).",
  schema: z.object({
    workspaceId: z
      .string()
      .optional()
      .describe("Workspace id (defaults to the user's current workspace)"),
    includeDone: z
      .boolean()
      .default(false)
      .describe("Include bots in 'done' or 'failed' status"),
    limit: z.coerce.number().int().min(1).max(500).default(100),
  }),
  http: { method: "GET" },
  run: async (args) => {
    const db = getDb();
    const workspaceId = args.workspaceId || (await resolveDefaultWorkspaceId());

    const statuses: Array<
      "scheduled" | "joining" | "recording" | "done" | "failed"
    > = args.includeDone
      ? ["scheduled", "joining", "recording", "done", "failed"]
      : ["scheduled", "joining", "recording"];

    const rows = await db
      .select()
      .from(schema.recallBots)
      .where(
        and(
          eq(schema.recallBots.workspaceId, workspaceId),
          inArray(schema.recallBots.status, statuses),
        ),
      )
      .orderBy(desc(schema.recallBots.createdAt))
      .limit(args.limit);

    return {
      workspaceId,
      bots: rows.map((r) => ({
        id: r.id,
        callId: r.callId,
        meetingUrl: r.meetingUrl,
        status: r.status,
        scheduledAt: r.scheduledAt,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        createdBy: r.createdBy,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
    };
  },
});
