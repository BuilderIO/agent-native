import { defineAction } from "@agent-native/core";
import { getRequestOrgId } from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withOrgContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function advanceCandidate(args: {
  applicationId?: number;
  fromStageId?: number;
}) {
  if (!args.applicationId || !args.fromStageId) {
    throw new Error("--applicationId and --fromStageId are required");
  }
  await gh.advanceApplication(args.applicationId, args.fromStageId);
  return {
    success: true,
    message: `Advanced application ${args.applicationId} to the next stage.`,
  };
}

export default defineAction({
  description: "Advance a candidate's application to the next stage",
  schema: z.object({
    applicationId: z.coerce
      .number()
      .optional()
      .describe("Application ID (required)"),
    fromStageId: z.coerce
      .number()
      .optional()
      .describe("Current stage ID (required)"),
  }),
  run: async (args) => {
    const orgId = getRequestOrgId();
    if (orgId) {
      return withOrgContext(orgId, () => advanceCandidate(args));
    }
    return advanceCandidate(args);
  },
});
