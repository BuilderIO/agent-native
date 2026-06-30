import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { disconnectNotionForOwner } from "../server/lib/notion.js";
import { getCurrentNotionOwner } from "./_notion-action-utils.js";

export default defineAction({
  description: "Disconnect the current user's Notion workspace.",
  schema: z.object({}),
  http: { method: "POST" },
  run: async () => {
    const owner = getCurrentNotionOwner();
    const deleted = await disconnectNotionForOwner(owner);
    return { success: true, deleted };
  },
});
