import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { assertAccess } from "@agent-native/core/sharing";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Tie a call to an account (CRM-lite). Pass accountId=null to clear the association.",
  schema: z.object({
    id: z.string().describe("Call ID"),
    accountId: z
      .string()
      .nullish()
      .describe("Account id to associate, or null to clear"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    await assertAccess("call", args.id, "editor");
    const db = getDb();
    const now = new Date().toISOString();
    await db
      .update(schema.calls)
      .set({ accountId: args.accountId ?? null, updatedAt: now })
      .where(eq(schema.calls.id, args.id));
    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, accountId: args.accountId ?? null };
  },
});
