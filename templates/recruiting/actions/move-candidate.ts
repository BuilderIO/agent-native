import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import * as gh from "../server/lib/greenhouse-api.js";
import { withCredentialContext } from "../server/lib/greenhouse-api.js";
import { z } from "zod";

async function moveCandidate(args: {
  applicationId?: number;
  fromStageId?: number;
  toStageId?: number;
}) {
  if (!args.applicationId || !args.fromStageId || !args.toStageId) {
    throw new Error(
      "--applicationId, --fromStageId, and --toStageId are required",
    );
  }
  await gh.moveApplication(
    args.applicationId,
    args.fromStageId,
    args.toStageId,
  );
  return {
    success: true,
    message: `Moved application ${args.applicationId} to stage ${args.toStageId}.`,
  };
}

export default defineAction({
  description: "Move a candidate's application to a specific stage",
  schema: z.object({
    applicationId: z.coerce
      .number()
      .optional()
      .describe("Application ID (required)"),
    fromStageId: z.coerce
      .number()
      .optional()
      .describe("Current stage ID (required)"),
    toStageId: z.coerce
      .number()
      .optional()
      .describe("Target stage ID (required)"),
  }),
  run: async (args) => {
    const orgId = getRequestOrgId() ?? null;
    const email = getRequestUserEmail() ?? null;
    return withCredentialContext({ email, orgId }, () => moveCandidate(args));
  },
});
