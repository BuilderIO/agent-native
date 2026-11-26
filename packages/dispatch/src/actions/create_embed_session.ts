import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { createGrantedDispatchMcpEmbedSession } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Create a one-time browser embed session for a Dispatch-granted app URL, used by embedded MCP App views.",
  schema: z.object({
    app: z
      .string()
      .optional()
      .describe("Optional granted app id when path is app-relative."),
    url: z
      .string()
      .optional()
      .describe("Absolute URL returned by open_app, or app-relative path."),
    path: z
      .string()
      .optional()
      .describe("App-relative path. Requires app when url is not provided."),
    chrome: z
      .enum(["full", "minimal"])
      .optional()
      .describe("Embed chrome preference. Defaults to full."),
  }),
  readOnly: false,
  parallelSafe: true,
  mcpApp: { visibility: ["app"] },
  run: async (args, context) =>
    createGrantedDispatchMcpEmbedSession(
      args,
      context?.caller === "http" && args.chrome === "minimal"
        ? { bindBrowserTab: true }
        : undefined,
    ),
});
