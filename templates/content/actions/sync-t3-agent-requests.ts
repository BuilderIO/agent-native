import { defineAction, fail } from "@agent-native/core/action";
import { T3_CODE_AGENTS_LAB } from "@agent-native/core/labs/core-labs";
import { assertLabEnabled } from "@agent-native/core/labs/server";
import {
  getRequestUserEmail,
  getRequestUserName,
} from "@agent-native/core/server";
import { assertAccess } from "@agent-native/core/sharing";
import { z } from "zod";

import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  listT3AgentRequests,
  serializeT3AgentRequest,
  t3AgentRequestViewSchema,
  syncT3AgentRequests,
} from "../server/lib/t3-agent-requests.js";
import { displayNameFromEmail } from "../shared/author-name.js";

export default defineAction({
  description:
    "Move the current user's unfinished T3 Code agent requests on a page along: hand each new tag to its T3 thread, check on threads that are working, and post each finished thread's answer as its reply.",
  mcpTool: false,
  agentTool: false,
  schema: z.object({
    documentId: z.string().min(1).describe("Page ID"),
  }),
  outputSchema: z.object({
    requests: z.array(t3AgentRequestViewSchema),
    unreachable: z.boolean(),
    posted: z.boolean(),
  }),
  run: async ({ documentId }, ctx) => {
    await assertLabEnabled(T3_CODE_AGENTS_LAB, ctx);
    await assertAccess("document", documentId, "commenter");
    const email = getRequestUserEmail();
    if (!email) fail("Not authenticated.", { statusCode: 401 });
    const name = getRequestUserName()?.trim() || displayNameFromEmail(email);
    const { unreachable, posted } = await syncT3AgentRequests(
      email,
      documentId,
      name,
    );
    const rows = await listT3AgentRequests(email, documentId);
    return {
      requests: rows.map(serializeT3AgentRequest),
      unreachable,
      posted,
    };
  },
  changeResource: (input, result) =>
    result.posted ? documentChangeResource(input.documentId) : null,
});
