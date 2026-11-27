import { defineAction } from "@agent-native/core/action";
import { normalizeTrackingDimension } from "@agent-native/core/shared";
import { track } from "@agent-native/core/tracking";
import { z } from "zod";

import { askGrantedDispatchMcpApp } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Send a natural-language request to an app accessible through this Dispatch connection. Accepts a granted `app` id (such as those returned by `list_apps`) and routes the message to that app's agent.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    message: z.string().describe("The request to send to that app's agent."),
    viewportMode: z
      .enum(["foreground", "background"])
      .optional()
      .describe(
        'Viewport targeting mode; "background" keeps the current foreground pane unchanged.',
      ),
    async: z
      .boolean()
      .optional()
      .describe("Start a durable task and return immediately with a taskId."),
    maxWaitMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Maximum inline wait in milliseconds."),
  }),
  run: async ({ app, message, viewportMode, async, maxWaitMs }, ctx) => {
    const result = await askGrantedDispatchMcpApp(app, message, {
      async,
      maxWaitMs,
      ...(viewportMode ? { viewportMode } : {}),
    });
    track(
      "a2a_delegated",
      {
        app_name: "dispatch",
        template_name: "dispatch",
        target_app: normalizeTrackingDimension(app) ?? app.trim().toLowerCase(),
        job_type: async === true ? "async" : "inline",
      },
      ctx,
    );
    return result;
  },
});
