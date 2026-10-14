import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

import { resolveReplayStoryboardDesignTarget } from "../server/lib/replay-storyboard-design-target.js";

export default defineAction({
  description:
    "Check whether the signed-in Analytics caller resolves the approved Design target for session replay storyboard export. Returns only fixed readiness, failure, and target-class codes.",
  schema: z.object({}),
  http: { method: "GET" },
  requiresAuth: true,
  readOnly: true,
  agentTool: false,
  mcpTool: false,
  persistInBrowser: false,
  run: async () => {
    if (!getRequestUserEmail()) {
      fail("Sign in to check the Design export target", {
        errorCode: "unauthenticated",
        statusCode: 401,
      });
    }
    const result = await resolveReplayStoryboardDesignTarget();
    return {
      code: result.code,
      ...(result.code === "notready"
        ? { failureCode: result.failureCode }
        : {}),
      targetClass: result.targetClass,
    };
  },
});
