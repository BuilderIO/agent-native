import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fetchConnectAgentCard } from "../server/lib/connect-apps.js";

export default defineAction({
  description:
    "Inspect a user-entered Agent-Native app URL for a compatible connection card.",
  schema: z.object({ url: z.string().trim().min(1).max(2048) }),
  http: { method: "POST" },
  readOnly: true,
  parallelSafe: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async ({ url }) => fetchConnectAgentCard(url),
});
