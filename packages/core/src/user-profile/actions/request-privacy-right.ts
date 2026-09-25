import { z } from "zod";

import { defineAction } from "../../action.js";
import { mutateUserSetting } from "../../settings/user-settings.js";

const PRIVACY_REQUESTS_SETTING_KEY = "privacy-rights-requests";
const pendingRequestSchema = z.object({
  status: z.literal("pending"),
  requestedAt: z.number().int().positive(),
});
const storedPrivacyRequestsSchema = z
  .object({
    access: pendingRequestSchema.optional(),
    deletion: pendingRequestSchema.optional(),
  })
  .strict();

const requestTypeSchema = z.enum(["access", "deletion"]);

export default defineAction({
  description:
    "Record the current user's request for a copy of their data or deletion of their personal data. This only records a request for verified operator fulfillment; it never deletes or exports data directly.",
  schema: z.object({
    requestType: requestTypeSchema.describe(
      "The privacy right to request: access for a copy of personal data, or deletion for erasure review.",
    ),
  }),
  uiOnly: true,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  authorize: (_args, ctx) => ctx?.caller === "frontend",
  run: async ({ requestType }, ctx) => {
    if (!ctx?.userEmail) throw new Error("Not authenticated.");

    const stored = await mutateUserSetting(
      ctx.userEmail,
      PRIVACY_REQUESTS_SETTING_KEY,
      (current) => {
        const parsed = storedPrivacyRequestsSchema.parse(current ?? {});
        if (parsed[requestType]) return parsed;
        return {
          ...parsed,
          [requestType]: {
            status: "pending" as const,
            requestedAt: Date.now(),
          },
        };
      },
    );
    const request = storedPrivacyRequestsSchema.parse(stored)[requestType];
    if (!request) throw new Error("Privacy request was not persisted.");

    return { requestType, ...request };
  },
});
