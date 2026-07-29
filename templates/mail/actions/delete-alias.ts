import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { readAliases, writeAliases } from "../server/lib/aliases.js";

export default defineAction({
  description: "Delete a recipient alias.",
  schema: z.object({
    id: z.string().describe("Alias id"),
  }),
  http: { method: "DELETE" },
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const aliases = await readAliases(ownerEmail);
    const remaining = aliases.filter((a) => a.id !== args.id);
    if (remaining.length === aliases.length) {
      throw new Error("Alias not found");
    }
    await writeAliases(ownerEmail, remaining);
    return { ok: true, id: args.id };
  },
});
