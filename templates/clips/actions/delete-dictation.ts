
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";

export default defineAction({
  description: "Permanently delete a dictation history row.",
  schema: z.object({
    id: z.string().describe("Dictation ID"),
  }),
  run: async (args) => {
    await assertAccess("dictation", args.id, "editor");

    const db = getDb();
    const [existing] = await db
      .select({ id: schema.dictations.id })
      .from(schema.dictations)
      .where(eq(schema.dictations.id, args.id));
    if (!existing) throw new Error(`Dictation not found: ${args.id}`);

    await db.transaction(async (tx) => {
      await tx
        .delete(schema.dictationShares)
        .where(eq(schema.dictationShares.resourceId, args.id));
      await tx
        .delete(schema.dictations)
        .where(eq(schema.dictations.id, args.id));
    });
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id };
  },
});
