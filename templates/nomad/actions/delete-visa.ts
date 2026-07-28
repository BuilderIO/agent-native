import { defineAction } from "@agent-native/core/action";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "../server/db/index.js";
import { visas } from "../server/db/schema.js";
import { requireOwner } from "../server/lib/owner.js";

export default defineAction({
  description:
    "Delete a visa/permit by id. Exit projections stop being capped by its expiry and its alerts disappear.",
  schema: z.object({
    id: z.string().describe("Visa id to delete"),
  }),
  run: async (args) => {
    const owner = requireOwner();
    const db = getDb();
    const owned = and(eq(visas.id, args.id), eq(visas.ownerEmail, owner));
    const existing = await db.select().from(visas).where(owned);
    if (existing.length === 0) {
      throw new Error(`No visa found with id ${args.id}`);
    }
    await db.delete(visas).where(owned);
    return { deleted: true, visa: existing[0] };
  },
});
