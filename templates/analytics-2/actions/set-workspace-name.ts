import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { changeWorkspaceName } from "./_workspace-name.js";
export default defineAction({
  description:
    "Change the active workspace name. Only current owners and admins can rename their workspace.",
  schema: z.object({
    name: z.string().trim().min(1),
    expectedOrgId: z.string().min(1),
  }),
  outputSchema: z.object({ name: z.string() }),
  http: { method: "POST" },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: true,
    openWorldHint: false,
  },
  run: ({ name, expectedOrgId }) => changeWorkspaceName(name, expectedOrgId),
});
