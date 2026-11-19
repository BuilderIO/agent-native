import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { listGrantedDispatchMcpAppActions } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "List the actions a granted app exposes (read inbox, create draft, move event, and so on) as names and one-line descriptions. Pass names to get full input schemas for just those actions. Call before call_app_action; results are fast, unlike ask_app.",
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
