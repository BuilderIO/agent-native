import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

export default defineAction({
  description: "Confirm the deterministic AgentKit browser acceptance step.",
  schema: z.object({
    release: z
      .literal("agentkit-acceptance")
      .describe("The release contract being accepted"),
  }),
  needsApproval: true,
  allowPersistentApproval: false,
  http: false,
  run: async ({ release }) => ({ accepted: release }),
});
