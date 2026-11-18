import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  appActionErrorCode,
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
      fail(text, { errorCode: "approval_required", statusCode: 409 });
    }
    const appCode = appActionErrorCode(text);
    if (appCode) {
      fail(text.replace(/(\s*\(errorCode: [a-z0-9_]+\))+\s*$/i, ""), {
        errorCode: appCode,
        statusCode: 502,
      });
    }
    fail(
      `${text || "The app action failed."} Its write outcome may be unknown; inspect the app before retrying.`,
      { errorCode: "app_action_failed", statusCode: 502 },
    );
  },
});
