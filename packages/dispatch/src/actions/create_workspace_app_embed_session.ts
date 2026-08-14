import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { createWorkspaceSsoEmbedSession } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Create a one-time app-scoped embed session for a workspace app opened inside Dispatch. This browser-only path is rollout-gated and never exposes an app's reusable session to another app.",
  schema: z.object({
    app: z
      .string()
      .optional()
      .describe("Workspace app id when path is app-relative."),
    url: z
      .string()
      .optional()
      .describe("Absolute app URL or app-relative path."),
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
  parallelSafe: false,
  agentTool: false,
  toolCallable: false,
  run: async (args) => createWorkspaceSsoEmbedSession(args),
});
