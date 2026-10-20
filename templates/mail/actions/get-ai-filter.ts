import { defineAction } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { getAiFilterState } from "../server/lib/ai-filter.js";

export default defineAction({
  description:
    "Read the Mail AI filter settings, recent decisions, and learned examples.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("Unauthenticated");
    return getAiFilterState(ownerEmail);
  },
});
