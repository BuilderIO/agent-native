import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { askGrantedDispatchMcpApp } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Send a natural-language request to an app available through Dispatch MCP. Use list_apps first to see which apps are granted.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    message: z.string().describe("The request to send to that app's agent."),
  }),
  run: async ({ app, message }) => askGrantedDispatchMcpApp(app, message),
});
