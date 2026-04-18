import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Archive a call. Hides it from the main library but keeps all data intact. Use restore-call to undo.",
  schema: z.object({
    id: z.string().describe("Call ID"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.id, "editor");
    const db = getDb();
    const now = new Date().toISOString();
    await db
      .update(schema.calls)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.calls.id, args.id));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, archivedAt: now };
  },
});
