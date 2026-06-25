import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { listNotionLinks } from "../server/lib/notion-sync.js";

export default defineAction({
  description: "List all documents linked to Notion pages.",
  schema: z.object({}),
  http: false,
  run: async () => {
    const owner = getRequestUserEmail();
    if (!owner) throw new Error("no authenticated user");
    return listNotionLinks(owner);
  },
});
