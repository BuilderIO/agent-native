import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";

async function rejectCandidate(args: Record<string, string>) {
  if (!args.applicationId) {
    throw new Error("--applicationId is required");
  }
  await gh.rejectApplication(Number(args.applicationId), undefined, args.notes);
  return {
    success: true,
    message: `Rejected application ${args.applicationId}.`,
  };
}

export default defineAction({
  description: "Reject a candidate's application",
  parameters: {
    applicationId: {
      type: "string",
      description: "Application ID (required)",
    },
    notes: {
      type: "string",
      description: "Rejection notes",
    },
  },
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => rejectCandidate(args));
    }
    return rejectCandidate(args);
  },
});
