import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Reassign an account's owner.",
  schema: z.object({ id: z.string().min(1).describe("Account id"), owner: z.string().min(1).max(200).describe("New owner name") }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ id, owner }) => {
    await ready();
    const rows = await getDb().update(schema.accounts).set({ owner, updatedAt: nowIso() }).where(eq(schema.accounts.id, id)).returning({ id: schema.accounts.id });
    if (rows.length === 0) return errors.noWrite("Account not found.", "not_found", { statusCode: 404 });
    return { id };
  },
});
