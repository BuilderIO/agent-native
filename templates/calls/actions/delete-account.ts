import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../server/db/index.js";
import { writeAppState } from "@agent-native/core/application-state";

export default defineAction({
  description:
    "Delete an account and clear the account_id field on any call that points at it.",
  schema: z.object({
    id: z.string().describe("Account ID"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const [existing] = await db
      .select({ id: schema.accounts.id })
      .from(schema.accounts)
      .where(eq(schema.accounts.id, args.id));
    if (!existing) throw new Error(`Account not found: ${args.id}`);

    await db
      .update(schema.calls)
      .set({ accountId: null, updatedAt: sql`${new Date().toISOString()}` })
      .where(eq(schema.calls.accountId, args.id));

    await db.delete(schema.accounts).where(eq(schema.accounts.id, args.id));

    await writeAppState("refresh-signal", { ts: Date.now() });
    return { id: args.id, deleted: true };
  },
});
