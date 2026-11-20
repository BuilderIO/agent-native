import { defineAction, fail, NoWriteError } from "@agent-native/core/action";
import { z } from "zod";

import {
  appActionErrorCode,
  appActionRefusedBeforeRun,
  appActionResultText,
} from "../server/lib/app-action-result.js";
import { callGrantedDispatchMcpAppAction } from "../server/lib/mcp-gateway.js";

export default defineAction({
  description:
    "Run one action of a granted app as the signed-in user and return its result in about a second. Prefer this to ask_app whenever the step is a known action (list the inbox, read a thread, create a draft, list or move an event); ask_app runs the app's whole agent and takes 20 seconds or more. Call list_app_actions first for names and inputs. The app's screen updates from the same data, so call open_app once to show it beside the chat.",
  schema: z.object({
    app: z.string().describe("Granted app id, e.g. mail or calendar."),
    action: z
      .string()
      .describe("Action name from list_app_actions, e.g. list-emails."),
    args: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("Action input matching its schema."),
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
  run: async ({ app, action, args }) => {
    const result = await callGrantedDispatchMcpAppAction(
      app,
      action,
      args ?? {},
    );
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
