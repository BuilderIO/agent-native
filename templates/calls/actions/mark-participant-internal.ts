/**
 * Set the internal/external flag on a call participant.
 *
 * Usage:
 *   pnpm action mark-participant-internal --callId=<id> --speakerLabel="Speaker 0" --isInternal=true
 */

import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

const cliBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "Toggle the isInternal flag on a call participant (true = teammate, false = external).",
  schema: z.object({
    callId: z.string().describe("Call ID"),
    speakerLabel: z.string().describe("Diarized label, e.g. 'Speaker 0'"),
    isInternal: z
      .union([z.boolean(), cliBoolean])
      .describe("True if this speaker is on our team"),
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
      .set({ isInternal: args.isInternal })
      .where(eq(schema.callParticipants.id, existing.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return {
      id: existing.id,
      callId: args.callId,
      speakerLabel: args.speakerLabel,
      isInternal: args.isInternal,
    };
  },
});
