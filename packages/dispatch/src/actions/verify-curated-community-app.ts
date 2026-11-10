import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { z } from "zod";

import {
  communityInstallVerificationErrors,
  verifyCuratedCommunityApp,
} from "../server/lib/community-install-verification.js";

const receiptSchema = z.object({
  projectId: z.string(),
  branchName: z.string(),
  commitSha: z.string().regex(/^[a-f0-9]{40}$/),
  sourceId: z.string(),
  appId: z.string(),
  files: z
    .array(
      z.object({
        path: z.string(),
        blobSha: z.string().regex(/^[a-f0-9]{40}$/),
      }),
    )
    .max(64),
  verified: z.literal(true),
});

export default defineAction({
  description:
    "Read back a Builder branch selected by an organization owner or admin and compare its app files with a reviewed community template. Returns a hash-only verification receipt; this does not install the app or enable Builder community installs.",
  schema: z.object({
    sourceId: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("Reviewed community source id"),
    appId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .describe("Target app id inside apps/"),
    branchName: z
      .string()
      .min(1)
      .max(256)
      .describe("Existing Builder branch to inspect"),
  }),
  outputSchema: receiptSchema,
  mcpOutputSchema: true,
  http: { method: "POST" },
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
        "A directly authenticated organization owner or admin is required to verify a Builder community branch.",
        "community_verification_identity_required",
        { statusCode: 403 },
      );
    }
    return verifyCuratedCommunityApp(input);
  },
});
