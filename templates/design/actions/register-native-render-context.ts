import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { registerNativeRenderContext } from "./_native-render-contexts.js";

export default defineAction({
  agentTool: false,
  description:
    "Register a short-lived local native export capability for this authenticated, already-open Design editor tab. Returns metadata only.",
  schema: z
    .object({
      designId: z.string().min(1).max(128),
      documentId: z.string().uuid(),
    })
    .strict(),
  http: { method: "POST" },
  run: async ({ designId, documentId }) =>
    registerNativeRenderContext(designId, documentId),
});
