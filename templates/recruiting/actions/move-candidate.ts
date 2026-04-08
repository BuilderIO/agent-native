import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function moveCandidate(args: Record<string, string>) {
  if (!args.applicationId || !args.fromStageId || !args.toStageId) {
    throw new Error(
      "--applicationId, --fromStageId, and --toStageId are required",
    );
  }
  await gh.moveApplication(
    Number(args.applicationId),
    Number(args.fromStageId),
    Number(args.toStageId),
  );
  return {
    success: true,
    message: `Moved application ${args.applicationId} to stage ${args.toStageId}.`,
  };
}

export default defineAction({
  description: "Move a candidate's application to a specific stage",
  parameters: {
    applicationId: {
      type: "string",
      description: "Application ID (required)",
    },
    fromStageId: {
      type: "string",
      description: "Current stage ID (required)",
    },
    toStageId: {
      type: "string",
      description: "Target stage ID (required)",
    },
  },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => moveCandidate(args));
    }
    return moveCandidate(args);
  },
});
