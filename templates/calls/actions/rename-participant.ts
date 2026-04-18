/**
 * Rename a participant's display name.
 *
 * Usage:
 *   pnpm action rename-participant --callId=<id> --speakerLabel="Speaker 1" --displayName="Alice"
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description: "Update just the displayName for a call participant.",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    speakerLabel: z.string().describe("Diarized label, e.g. 'Speaker 0'"),
    displayName: z.string().min(1).max(120),
  }),
  run: async (args) => {
    await assertAccess("call", args.callId, "editor");

    const db = getDb();

    const [existing] = await db
      .select({ id: schema.callParticipants.id })
      .from(schema.callParticipants)
      .where(
        and(
          eq(schema.callParticipants.callId, args.callId),
          eq(schema.callParticipants.speakerLabel, args.speakerLabel),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `Participant not found: callId=${args.callId} speakerLabel=${args.speakerLabel}`,
      );
    }

    await db
      .update(schema.callParticipants)
      .set({ displayName: args.displayName.trim() })
      .where(eq(schema.callParticipants.id, existing.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: existing.id,
      callId: args.callId,
      speakerLabel: args.speakerLabel,
      displayName: args.displayName.trim(),
    };
  },
});
