import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  description:
    "Acknowledge confirmed native chat delivery or record its actual dispatch failure for the current kickoff claim.",
  schema: z.object({
    id: z.string().min(1).describe("Design system ID"),
    claimId: z
      .string()
      .min(1)
      .describe("Claim returned by claim-design-system-kickoff"),
    status: z.enum(["delivered", "failed"]).describe("Actual delivery result"),
    error: z
      .string()
      .min(1)
      .max(2000)
      .optional()
      .describe("Required error message for a failed dispatch"),
  }),
  agentTool: false,
  run: (args) => designSystemAuthoring.completeKickoff(args),
});
