import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { disconnectNotionForOwner } from "../server/lib/notion.js";
import { getCurrentNotionCaller } from "./_notion-action-utils.js";

export default defineAction({
  description: "Disconnect the current user's Notion workspace.",
  schema: z.object({}),
  http: { method: "POST" },
  run: async () => {
    const callerEmail = getCurrentNotionCaller();
    const deleted = await disconnectNotionForOwner(callerEmail);
    return { success: true, deleted };
  },
});
