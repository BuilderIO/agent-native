/**
 * List all diarized participants for a call.
 *
 * Usage:
 *   pnpm action list-participants --callId=<id>
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { asc, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description:
    "List all participants on a call (speaker label, display name, email, internal flag, color, talk stats).",
  schema: z.object({
    callId: z.string().describe("Call ID"),
  }),
  http: { method: "GET" },
  run: async (args) => {
    await assertAccess("call", args.callId, "viewer");

    const db = getDb();
    const rows = await db
      .select()
      .from(schema.callParticipants)
      .where(eq(schema.callParticipants.callId, args.callId))
      .orderBy(asc(schema.callParticipants.speakerLabel));

    const participants = rows.map((p) => ({
      id: p.id,
      callId: p.callId,
      speakerLabel: p.speakerLabel,
      displayName: p.displayName,
      email: p.email,
      isInternal: Boolean(p.isInternal),
      avatarUrl: p.avatarUrl,
      color: p.color,
      talkMs: p.talkMs,
      talkPct: p.talkPct,
      longestMonologueMs: p.longestMonologueMs,
      interruptionsCount: p.interruptionsCount,
      questionsCount: p.questionsCount,
    }));

    return { callId: args.callId, participants };
  },
});
