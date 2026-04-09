import { defineAction } from "@agent-native/core";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function rejectCandidate(args: {
  applicationId?: number;
  notes?: string;
}) {
  if (!args.applicationId) {
    throw new Error("--applicationId is required");
  }
  await gh.rejectApplication(args.applicationId, undefined, args.notes);
  return {
    success: true,
    message: `Rejected application ${args.applicationId}.`,
  };
}

export default defineAction({
  description: "Reject a candidate's application",
  schema: z.object({
    applicationId: z.coerce
      .number()
      .optional()
      .describe("Application ID (required)"),
    notes: z.string().optional().describe("Rejection notes"),
  }),
  run: async (args) => {
    const orgId = process.env.AGENT_ORG_ID;
    if (orgId) {
      return withOrgContext(orgId, () => rejectCandidate(args));
    }
    return rejectCandidate(args);
  },
});
