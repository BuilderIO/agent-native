import { z } from "zod";

import { defineAction } from "../../action.js";
import { getAccessRequestReview } from "../access-requests.js";

export default defineAction({
  description:
    "Read one access request for review: who asked, for which resource, and whether it is still pending. Only someone who manages access to the resource can read it.",
  schema: z.object({ requestId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: ({ requestId }) => getAccessRequestReview(requestId),
});
