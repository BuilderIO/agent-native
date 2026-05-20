import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { createGrantedDispatchMcpEmbedSession } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "MCP Apps helper: create a browser embed session for a Dispatch-granted app URL. Usually called by an MCP App iframe, not directly by the model.",
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
  run: async (args) => createGrantedDispatchMcpEmbedSession(args),
});
