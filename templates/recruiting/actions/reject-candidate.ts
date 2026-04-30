import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withCredentialContext } from "../server/lib/greenhouse-api.js";
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
    const orgId = getRequestOrgId() ?? null;
    const email = getRequestUserEmail() ?? null;
    return withCredentialContext({ email, orgId }, () => rejectCandidate(args));
  },
});
