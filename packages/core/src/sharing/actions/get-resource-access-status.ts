import { z } from "zod";

import { defineAction } from "../../action.js";
import { resolveLinkStatus } from "../access-requests.js";

export default defineAction({
  description:
    "Say whether the current viewer can open a shareable resource, and if not, whether the link points at something that exists and whether they can ask for access. Returns only the state, the viewer's own role, and their own request; never the title, owner, visibility, or workspace.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  // A signed-out visitor holding a link gets `signed-out` and nothing else.
  requiresAuth: false,
  // Only the app's own access screens ask; agents read resources directly.
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async ({ resourceType, resourceId }) =>
    resolveLinkStatus(resourceType, resourceId),
});
