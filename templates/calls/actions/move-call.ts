import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Move a call to a different folder (or to the library root when folderId is null).",
  schema: z.object({
    id: z.string().describe("Call ID"),
    folderId: z
      .string()
      .nullish()
      .describe("Target folder id, or null for root"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.id, "editor");
    const db = getDb();
    const now = new Date().toISOString();
    await db
      .update(schema.calls)
      .set({ folderId: args.folderId ?? null, updatedAt: now })
      .where(eq(schema.calls.id, args.id));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, folderId: args.folderId ?? null };
  },
});
