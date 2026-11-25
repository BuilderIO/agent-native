import { defineAction, fail } from "@agent-native/core/action";
import { T3_CODE_AGENTS_LAB } from "@agent-native/core/labs/core-labs";
import { assertLabEnabled } from "@agent-native/core/labs/server";
import { getRequestUserEmail } from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import {
  listT3AgentRequests,
  serializeT3AgentRequest,
  t3AgentRequestViewSchema,
} from "../server/lib/t3-agent-requests.js";

export default defineAction({
  description:
    "List the current user's T3 Code agent requests on a page: each comment that tagged one of their own agents, and whether its thread is working, waiting on them, or answered.",
  readOnly: true,
  http: { method: "GET" },
  mcpTool: false,
  agentTool: false,
  schema: z.object({
    documentId: z.string().min(1).describe("Page ID"),
  }),
  outputSchema: z.object({ requests: z.array(t3AgentRequestViewSchema) }),
  run: async ({ documentId }, ctx) => {
    await assertLabEnabled(T3_CODE_AGENTS_LAB, ctx);
    await assertAccess("document", documentId, "commenter");
    const email = getRequestUserEmail();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    const rows = await listT3AgentRequests(email, documentId);
    return { requests: rows.map(serializeT3AgentRequest) };
  },
});
