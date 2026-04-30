import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";

export default defineAction({
  description: "Delete a call-to-action button from a recording.",
  schema: z.object({
    id: z.string().describe("CTA ID"),
  }),
  run: async (args) => {
    const db = getDb();

    const [existing] = await db
      .select()
      .from(schema.recordingCtas)
      .where(eq(schema.recordingCtas.id, args.id))
      .limit(1);
    if (!existing) throw new Error(`CTA not found: ${args.id}`);
    await assertAccess("recording", existing.recordingId, "editor");

    await db
      .delete(schema.recordingCtas)
      .where(eq(schema.recordingCtas.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });

    return { id: args.id };
  },
});
