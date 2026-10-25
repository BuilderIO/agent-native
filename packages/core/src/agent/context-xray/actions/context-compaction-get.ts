import { z } from "zod";

import { defineAction, fail } from "../../../action.js";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "../../../server/request-context.js";
import {
  getThreadCompactionStatus,
  type ThreadCompactionStatus,
} from "../../observational-memory/compactor.js";
import { callerOwnsThread } from "../../run-ownership.js";

export default defineAction({
  description:
    "Read how close a chat thread is to automatic context compaction: tokens not yet compacted, the threshold the post-turn pass compacts at, and tokens left until it does.",
  schema: z.object({
    threadId: z.string().min(1).describe("Chat thread id to inspect."),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (args): Promise<ThreadCompactionStatus & { threadId: string }> => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) {
      fail("Sign in to read context compaction.", {
        errorCode: "auth_required",
        statusCode: 401,
      });
    }
    if (!(await callerOwnsThread(ownerEmail, args.threadId))) {
      fail("Thread not found.", { errorCode: "not_found", statusCode: 404 });
    }
    const status = await getThreadCompactionStatus({
      ownerEmail,
      orgId: getRequestOrgId() ?? null,
      threadId: args.threadId,
    });
    return { threadId: args.threadId, ...status };
  },
});
