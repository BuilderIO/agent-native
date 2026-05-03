import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listWorkspaceApps } from "../server/lib/app-creation-store.js";

export default defineAction({
  description:
    "List apps installed in this workspace, including mounted paths and absolute URLs. Pass includeAgentCards=true when answering whether workspace apps expose agent cards or A2A endpoints; agent-card probing is optional and off by default.",
  schema: z.object({
    includeAgentCards: z
      .boolean()
      .optional()
      .describe(
        "Fetch each ready app's /.well-known/agent-card.json with a short non-throwing timeout and include agentCardUrl, agentCardReachable, a2aEndpointUrl, agentName, and agentSkillsCount. Defaults to false; pending Builder apps are not probed.",
      ),
  }),
  http: { method: "GET" },
  run: async (input) => listWorkspaceApps(input),
});
