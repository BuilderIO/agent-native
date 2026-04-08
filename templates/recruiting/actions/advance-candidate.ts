import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function advanceCandidate(args: Record<string, string>) {
  if (!args.applicationId || !args.fromStageId) {
    throw new Error("--applicationId and --fromStageId are required");
  }
  await gh.advanceApplication(
    Number(args.applicationId),
    Number(args.fromStageId),
  );
  return {
    success: true,
    message: `Advanced application ${args.applicationId} to the next stage.`,
  };
}

export default defineAction({
  description: "Advance a candidate's application to the next stage",
  parameters: {
    applicationId: {
      type: "string",
      description: "Application ID (required)",
    },
    fromStageId: {
      type: "string",
      description: "Current stage ID (required)",
    },
  },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => advanceCandidate(args));
    }
    return advanceCandidate(args);
  },
});
