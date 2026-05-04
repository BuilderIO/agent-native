import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { listWorkspaceApps } from "../server/lib/app-creation-store.js";

const httpBoolean = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return value;
}, z.boolean());

export default defineAction({
  description:
    "List apps installed in this workspace, including mounted paths, absolute URLs, and agent-card/A2A metadata for ready apps by default. UI polling callers can pass includeAgentCards=false to skip network probes.",
  schema: z.object({
    includeAgentCards: httpBoolean
      .default(true)
      .describe(
        "Fetch each ready app's /.well-known/agent-card.json with a short non-throwing timeout and include agentCardUrl, agentCardReachable, a2aEndpointUrl, agentName, and agentSkillsCount. Defaults to true for agent calls; UI polling should pass false. Pending Builder apps are not probed.",
      ),
  }),
  http: { method: "GET" },
  run: async (input) => listWorkspaceApps(input),
});
