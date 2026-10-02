import { z } from "zod";

import { defineAction } from "../../action.js";
import { listResourceAccessRequests } from "../access-requests.js";

export default defineAction({
  description:
    "List the newest pending access requests for a shareable resource, up to 50; `hasMore` says older ones exist. Only someone who manages access to it can list them.",
  schema: z.object({
    resourceType: z.string().min(1),
    resourceId: z.string().min(1),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: ({ resourceType, resourceId }) =>
    listResourceAccessRequests(resourceType, resourceId),
});
