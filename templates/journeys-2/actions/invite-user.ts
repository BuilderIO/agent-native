import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { errors, newId, nowIso, ready } from "../server/core.js";

export default defineAction({
  description: "Invite a teammate by email with a role. The invite is recorded; no email is sent in this demo.",
  schema: z.object({
    email: z.string().email().describe("Teammate email"),
    name: z.string().max(200).optional().describe("Display name"),
    role: z.enum(["admin", "editor", "viewer"]).default("editor").describe("Role; defaults to editor"),
  }),
  outputSchema: z.object({ id: z.string() }),
  errors,
  run: async ({ email, name, role }) => {
    await ready();
    const id = newId("u");
    const now = nowIso();
    await getDb().insert(schema.users).values({ id, email, name: name || email.split("@")[0]!, role, status: "invited", createdAt: now, updatedAt: now });
    return { id };
  },
});
