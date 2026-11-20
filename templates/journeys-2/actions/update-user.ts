import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Change a user's role, or remove the user (remove: true).",
  schema: z.object({
    id: z.string().min(1).describe("User id"),
    role: z.enum(["admin", "editor", "viewer"]).optional().describe("New role"),
    remove: z.boolean().optional().describe("Remove the user from the workspace"),
  }),
  outputSchema: z.object({ id: z.string(), removed: z.boolean() }),
  errors,
  run: async ({ id, role, remove }) => {
    await ready();
    if (remove) {
      await getDb().delete(schema.users).where(eq(schema.users.id, id));
      return { id, removed: true };
    }
    const rows = await getDb().update(schema.users).set({ ...(role && { role }), updatedAt: nowIso() }).where(eq(schema.users.id, id)).returning({ id: schema.users.id });
    if (rows.length === 0) return errors.noWrite("User not found.", "not_found", { statusCode: 404 });
    return { id, removed: false };
  },
});
