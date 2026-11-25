import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listGrantedDispatchMcpAppActions } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "List the actions exposed by a granted app (such as reading inbox messages, creating drafts, or managing events) as names and brief descriptions. Optional `names` filters the response to full input schemas for specific actions.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    names: z
      .array(z.string())
      .optional()
      .describe("Action names to return full input schemas for."),
  }),
  outputSchema: z.object({
    app: z.string(),
    actions: z.array(
      z.object({
        name: z.string(),
        description: z.string(),
        inputSchema: z.record(z.string(), z.unknown()).optional(),
        readOnly: z.boolean().optional(),
      }),
    ),
  }),
  readOnly: true,
  parallelSafe: true,
  run: async ({ app, names }) => ({
    app,
    actions: await listGrantedDispatchMcpAppActions(app, names),
  }),
});
