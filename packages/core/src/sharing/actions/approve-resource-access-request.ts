import { z } from "zod";

import { defineAction } from "../../action.js";
import { approveAccessRequest } from "../access-requests.js";

export default defineAction({
  description:
    "Allow a pending access request, giving the requester a role on the resource under the same sharing rules as Share. A stronger role they already hold is kept.",
  schema: z.object({
    requestId: z.string().min(1),
    generation: z.number().int().positive(),
    role: z.enum(["viewer", "commenter", "editor", "admin"]).default("viewer"),
  }),
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: (args) => approveAccessRequest(args),
});
