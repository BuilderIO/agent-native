import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { stays } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";

export default defineAction({
  description:
    "Delete a stay from the presence ledger by id (e.g. dismiss a wrongly detected inbox booking). This permanently removes the row and recomputes all rule counters.",
  schema: z.object({
    id: z.string().describe("Stay id to delete"),
  }),
  run: async (args) => {
    const owner = requireOwner();
    const db = getDb();
    const owned = and(eq(stays.id, args.id), eq(stays.ownerEmail, owner));
    const existing = await db.select().from(stays).where(owned);
    if (existing.length === 0) {
      throw new Error(`No stay found with id ${args.id}`);
    }
    await db.delete(stays).where(owned);
    return { deleted: true, stay: existing[0] };
  },
});
