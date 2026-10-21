import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { fetchMarketplaceApps } from "../server/lib/connect-apps.js";

export default defineAction({
  description:
    "List verified Agent-Native marketplace apps that support connecting to a workspace.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  parallelSafe: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async () => fetchMarketplaceApps(),
});
