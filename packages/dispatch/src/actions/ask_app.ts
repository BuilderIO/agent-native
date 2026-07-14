import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { askGrantedDispatchMcpApp } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Send a natural-language request to an app available through Dispatch MCP. Use list_apps first to see which apps are granted.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    message: z.string().describe("The request to send to that app's agent."),
    async: z
      .boolean()
      .optional()
      .describe("Start a durable task and return immediately with a taskId."),
    maxWaitMs: z
      .number()
      .int()
      .min(0)
      .max(25_000)
      .optional()
      .describe("Maximum inline wait in milliseconds."),
  }),
  run: async ({ app, message, async, maxWaitMs }) =>
    askGrantedDispatchMcpApp(app, message, { async, maxWaitMs }),
});
