import { defineAction } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { CLIPS_AI_REQUEST_KINDS } from "../shared/ai-request-status.js";
import {
  claimAiRequest,
  consumeAiRequest,
  releaseAiRequest,
} from "./lib/ai-request-status.js";

export default defineAction({
  description:
    "Claim, consume, or release one queued Clips AI request by its exact identity so only one browser tab starts it.",
  agentTool: false,
  schema: z.object({
    operation: z.enum(["claim", "consume", "release"]),
    recordingId: z.string().min(1),
    kind: z.enum(CLIPS_AI_REQUEST_KINDS),
    requestedAt: z.string().datetime(),
  }),
  run: async ({ operation, ...identity }) => {
    await assertAccess("recording", identity.recordingId, "viewer");
    switch (operation) {
      case "claim":
        return claimAiRequest(identity);
      case "consume":
        return { consumed: await consumeAiRequest(identity) };
      case "release":
        return { released: await releaseAiRequest(identity) };
    }
  },
});
