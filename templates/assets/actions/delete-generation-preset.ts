import { defineAction, isOutsideAgentCall } from "@agent-native/core/action";
import { z } from "zod";

import deleteTemplate from "./delete-template.js";

export default defineAction({
  description: "Deprecated — use delete-template. Delete a generation preset.",
  schema: z.object({ id: z.string() }),
  needsApproval: (_args, ctx) => isOutsideAgentCall(ctx),
  mcpTool: "search",
  run: async (args) => deleteTemplate.run(args),
});
