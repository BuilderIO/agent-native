import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";

import { matchErrorIssuesBySignatures } from "../server/lib/error-capture.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Resolve session console error lines to their captured error issues. Given each line's message/stack/source (as shown in a session recording's devtools console), returns the matching Sentry-style issue id per line so the UI or agent can deep-link to /monitoring?view=errors&issue=<id>. Fingerprints are computed with the same grouping logic as ingest, so a match is the exact issue the error was filed under; lines with no captured issue are omitted. Read-only.",
  schema: z.object({
    signatures: z
      .array(
        z.object({
          key: z
            .string()
            .describe("Caller-chosen id echoed back as the result key."),
          source: z
            .string()
            .optional()
            .describe(
              "Console source, e.g. window-error / unhandledrejection / console.",
            ),
          message: z
            .string()
            .describe(
              'Console error message, e.g. "TypeError: x is not a function".',
            ),
          stack: z
            .string()
            .optional()
            .describe("Raw stack string for the error, if captured."),
        }),
      )
      .max(100)
      .describe("Session console error lines to resolve to issues."),
  }),
  http: { method: "POST" },
  readOnly: true,
  run: async (args) => {
    return matchErrorIssuesBySignatures(resolveScope(), args.signatures);
  },
});
