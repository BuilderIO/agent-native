import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { designSystemAuthoring } from "../server/lib/design-system-authoring.js";

export default defineAction({
  description:
    "Claim the initial system chat dispatch once. Reconciles persisted native conversation/run receipts before recovering an expired claim. Returns shouldDispatch, stable requestId, conversationId, knownNewThread and claimId.",
  schema: z.object({ id: z.string().min(1).describe("Design system ID") }),
  agentTool: false,
  run: ({ id }) => designSystemAuthoring.claimKickoff(id),
});
