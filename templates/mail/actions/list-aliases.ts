import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { readAliases } from "../server/lib/aliases.js";

export default defineAction({
  description: "List the user's saved recipient aliases (Settings → Aliases).",
  schema: z.object({}),
  http: { method: "GET" },
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    return readAliases(ownerEmail);
  },
});
