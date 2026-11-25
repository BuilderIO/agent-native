import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  appActionErrorCode,
  appActionResultText,
} from "../server/lib/app-action-result.js";
import { callGrantedDispatchMcpAppAction } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Read the current view state in the active tab of a granted app, including the open screen, selection, and any open composer or unsaved draft edits.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
  }),
  outputSchema: z.object({ app: z.string(), view: z.unknown() }),
  readOnly: true,
  parallelSafe: true,
  run: async ({ app }) => {
    const result = await callGrantedDispatchMcpAppAction(
      app,
      "view-screen",
      {},
    );
    const text = appActionResultText(result);
    if (result.isError === true) {
      fail(text || "The app could not report its current view.", {
        errorCode: appActionErrorCode(text) ?? "view_unavailable",
        statusCode: 502,
      });
    }
    if (result.structuredContent !== undefined) {
      return { app, view: result.structuredContent };
    }
    let view: unknown;
    try {
      view = JSON.parse(text);
    } catch {
      fail("The app returned a view that could not be read.", {
        errorCode: "view_unreadable",
        statusCode: 502,
      });
    }
    return { app, view };
  },
});
