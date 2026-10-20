import { z } from "zod";

import { defineAction } from "../../action.js";
import { declineAccessRequest } from "../access-requests.js";

export default defineAction({
  description:
    "Decline a pending access request. The requester isn't told, and can ask again after a cooldown.",
  schema: z.object({
    requestId: z.string().min(1),
    generation: z.number().int().positive(),
  }),
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: (args) => declineAccessRequest(args),
});
