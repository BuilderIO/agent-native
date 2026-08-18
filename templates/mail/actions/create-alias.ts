import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { nanoid } from "nanoid";
import { z } from "zod";

import { readAliases, writeAliases } from "../server/lib/aliases.js";
import type { Alias } from "../shared/types.js";

export default defineAction({
  description: "Create a recipient alias grouping several email addresses.",
  schema: z.object({
    name: z.string().describe("Alias display name"),
    emails: z.array(z.string()).describe("Email addresses in the alias"),
  }),
  agentTool: false,
  run: async (args) => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    if (!args.name?.trim() || !args.emails?.length) {
      throw new Error("name and emails are required");
    }

    const aliases = await readAliases(ownerEmail);
    const now = new Date().toISOString();
    const alias: Alias = {
      id: nanoid(10),
      name: args.name.trim(),
      emails: args.emails,
      createdAt: now,
      updatedAt: now,
    };
    aliases.push(alias);
    await writeAliases(ownerEmail, aliases);
    return alias;
  },
});
