import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { rules } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";

export default defineAction({
  description:
    "Stop tracking a compliance rule by deleting it. The presence ledger is untouched — only the rule and its alerts disappear.",
  schema: z.object({
    id: z.string().describe("Rule id to delete"),
  }),
  run: async (args) => {
    const owner = requireOwner();
    const db = getDb();
    const owned = and(eq(rules.id, args.id), eq(rules.ownerEmail, owner));
    const existing = await db.select().from(rules).where(owned);
    if (existing.length === 0) {
      throw new Error(`No rule found with id ${args.id}`);
    }
    await db.delete(rules).where(owned);
    return { deleted: true, rule: existing[0] };
  },
});
