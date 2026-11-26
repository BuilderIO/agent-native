import {
  defineAction,
  fail,
  noteExternalWrite,
  NoWriteError,
} from "@agent-native/core/action";
import { z } from "zod";

import {
  appActionErrorCode,
  appActionRefusedBeforeRun,
  appActionResultText,
} from "../server/lib/app-action-result.js";
import { callGrantedDispatchMcpAppAction } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Run a single named action on a granted app as the signed-in user (such as listing an inbox, reading a thread, creating a draft, or listing or moving an event). Accepts an `app` id, an `action` name and input `args` (as described by `list_app_actions`), and returns the action result directly without running the app's agent.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    action: z
      .string()
      .describe("Action name from list_app_actions, e.g. list-emails."),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Action input matching its schema."),
    viewportMode: z
      .enum(["foreground", "background"])
      .optional()
      .describe(
        'Viewport targeting mode; "background" keeps the current foreground pane unchanged.',
      ),
  }),
  mcpOutputSchema: true,
  outputErrorStrategy: "strict",
  outputSchema: z.object({
    isError: z.boolean().optional(),
    approvalReview: z
      .object({ url: z.string().optional(), expiresAt: z.number().optional() })
      .optional(),
    structuredContent: z.unknown().optional(),
    content: z.array(z.unknown()),
  }),
  mcpApp: { structuredContent: true },
  run: async ({ app, action, args, viewportMode }) => {
    noteExternalWrite("app-action");
    const actionArgs = args ?? {};
    const result = viewportMode
      ? await callGrantedDispatchMcpAppAction(app, action, actionArgs, {
          viewportMode,
        })
      : await callGrantedDispatchMcpAppAction(app, action, actionArgs);
    if (result.isError !== true) return result;
    const text = appActionResultText(result);
    if (result.approvalReview) {
      fail(text, {
        errorCode: "approval_required",
        statusCode: 409,
        details: { approvalReview: result.approvalReview },
      });
    }
    const appCode = appActionErrorCode(text);
    const message = appCode
      ? text.replace(/(\s*\(errorCode: [a-z0-9_]+\))+\s*$/i, "")
      : text || "The app action failed.";
    if (appActionRefusedBeforeRun(message)) {
      throw new NoWriteError(`${message} Nothing was changed.`, {
        errorCode: appCode ?? "app_action_invalid_parameters",
        statusCode: 400,
      });
    }
    // A failed write can still have landed part of its change in the app.
    fail(
      `${message} Its write outcome may be unknown; inspect the app before retrying.`,
      { errorCode: appCode ?? "app_action_failed", statusCode: 502 },
    );
  },
});
