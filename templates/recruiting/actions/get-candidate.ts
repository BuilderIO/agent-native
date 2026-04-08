import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function getCandidate(args: Record<string, string>) {
  if (!args.id) throw new Error("--id is required");
  return gh.getCandidate(Number(args.id));
}

export default defineAction({
  description: "Get full details about a specific candidate",
  parameters: {
    id: { type: "string", description: "Candidate ID (required)" },
  },
  http: { method: "GET" },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => getCandidate(args));
    }
    return getCandidate(args);
  },
});
