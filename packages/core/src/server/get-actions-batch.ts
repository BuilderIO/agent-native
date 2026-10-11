import { z } from "zod";

import { defineAction } from "../action.js";
import { ACTION_BATCH_MAX_REQUESTS } from "../shared/action-batch.js";
import { runActionBatch } from "./action-batch.js";

export default defineAction({
  description:
    "Run several read-only action GET calls in one request. Each item goes through its own route, auth, and access checks, and one failing item does not fail the others.",
  schema: z.object({
    requests: z
      .array(
        z.object({
          action: z.string().min(1),
          query: z.string(),
        }),
      )
      .min(1)
      .max(ACTION_BATCH_MAX_REQUESTS),
  }),
  http: { method: "POST" },
  // Framework plumbing for the client, not an operation an agent, MCP client,
  // or sandboxed extension should call. Auth is per item, so the batch itself
  // is public and each item's route decides what its caller may read.
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  readOnly: true,
  requiresAuth: false,
  maxBodyBytes: 256 * 1024,
  run: (args, ctx) => runActionBatch(args, ctx),
});
