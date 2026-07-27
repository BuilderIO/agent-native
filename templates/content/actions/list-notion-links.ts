import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listNotionLinks } from "../server/lib/notion-sync.js";
import { getCurrentNotionOwner } from "./_notion-action-utils.js";

export default defineAction({
  description: "List all documents linked to Notion pages.",
  schema: z.object({}),
  http: { method: "GET" },
  run: async () => {
    const owner = getCurrentNotionOwner();
    return listNotionLinks(owner);
  },
});
