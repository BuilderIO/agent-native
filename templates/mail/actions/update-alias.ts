import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { readAliases, writeAliases } from "../server/lib/aliases.js";

export default defineAction({
  description:
    "Rename a recipient alias or replace the addresses it expands to.",
  schema: z.object({
    id: z.string().describe("Alias id"),
    name: z.string().optional().describe("New alias display name"),
    emails: z
      .array(z.string())
      .optional()
      .describe("Replacement list of email addresses"),
  }),
  http: { method: "PUT" },
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");

    const aliases = await readAliases(ownerEmail);
    const idx = aliases.findIndex((a) => a.id === args.id);
    if (idx === -1) throw new Error("Alias not found");

    aliases[idx] = {
      ...aliases[idx],
      ...(args.name !== undefined ? { name: args.name.trim() } : {}),
      ...(args.emails !== undefined ? { emails: args.emails } : {}),
      updatedAt: new Date().toISOString(),
    };
    await writeAliases(ownerEmail, aliases);
    return aliases[idx];
  },
});
