import { defineAction } from "@agent-native/core/action";
import { claimWorkspaceAppForOrganization } from "@agent-native/core/org";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { isValidWorkspaceAppIdFormat } from "@agent-native/core/shared";
import { z } from "zod";

export default defineAction({
  description:
    "Claim a fresh ownerless workspace app for the current organization. Returns whether the signed-in organization owner or admin may access it.",
  schema: z.object({
    appId: z
      .string()
      .trim()
      .refine(isValidWorkspaceAppIdFormat)
      .describe("Workspace app id to claim"),
  }),
  http: { method: "POST" },
  readOnly: false,
  agentTool: false,
  mcpTool: false,
  toolCallable: false,
  run: async ({ appId }) => ({
    allowed: await claimWorkspaceAppForOrganization(appId, {
      email: getRequestUserEmail() ?? "",
      orgId: getRequestOrgId() ?? null,
    }),
  }),
});
