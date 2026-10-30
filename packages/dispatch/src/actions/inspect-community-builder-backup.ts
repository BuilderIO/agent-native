import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  communityInstallVerificationErrors,
  inspectCommunityBuilderBackup,
} from "../server/lib/community-install-verification.js";

const resultSchema = z.object({
  branchName: z.string(),
  branchState: z
    .enum(["active", "archived", "deleted", "unknown"])
    .describe(
      "Whether Builder reports the branch active, archived, deleted or unknown",
    ),
  backupPartial: z
    .union([z.boolean(), z.literal("missing"), z.literal("invalid")])
    .describe(
      'Whether Builder marks the existing backup partial; "missing" or "invalid" means its flag could not be interpreted',
    ),
  backupValid: z
    .boolean()
    .describe("Whether Builder reports the backup state and outcome as valid"),
  backupComplete: z
    .boolean()
    .describe("Whether Builder reports the backup status as completed"),
  backupCurrent: z
    .boolean()
    .describe("Whether recorded commit and activity metadata match the branch"),
  agentIdle: z
    .boolean()
    .describe("Whether Builder reports the branch agent idle"),
  hasUnpushedChanges: z
    .boolean()
    .describe("Whether Builder reports unpushed branch changes"),
  verificationPerformed: z
    .literal(false)
    .describe("Always false; this action does not verify branch file bytes"),
});

export default defineAction({
  description:
    "Read existing backup metadata for a branch in the saved Builder project. Returns partial, valid, complete and current status plus idle and unpushed flags; it does not download files or verify a community app.",
  schema: z.object({
    branchName: z
      .string()
      .min(1)
      .max(256)
      .describe("Existing Builder branch name in the saved project"),
  }),
  outputSchema: resultSchema,
  mcpOutputSchema: true,
  http: { method: "GET" },
  readOnly: true,
  requiresAuth: true,
  errors: communityInstallVerificationErrors,
  run: async (input, context?: ActionRunContext) => {
    if (
      !context ||
      context.caller === "a2a" ||
      context.networkProtocol === "a2a" ||
      context.caller === "automation" ||
      context.caller === "mcp-widget" ||
      context.caller === "mcp-widget-write"
    ) {
      return communityInstallVerificationErrors.fail(
        "A directly authenticated organization owner or admin is required to inspect a Builder branch backup.",
        "community_verification_identity_required",
        { statusCode: 403 },
      );
    }
    return inspectCommunityBuilderBackup(input);
  },
});
