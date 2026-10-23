import { z } from "zod";

import { defineAction } from "../../action.js";
import { requireIntegrationScopeAccess } from "../scope-action-access.js";
import { listIntegrationScopes } from "../scope-store.js";

export default defineAction({
  description:
    "List channel and direct-message conversation scopes and their agent grants in the signed-in user's organization or personal workspace. Integration callers are not permitted.",
  schema: z.object({
    platform: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .optional()
      .describe("Filter by integration platform; omit for all platforms."),
    tenantId: z
      .string()
      .trim()
      .min(1)
      .max(255)
      .optional()
      .describe("Filter by provider tenant ID; omit for all tenants."),
  }),
  http: { method: "GET" },
  run: async (args, ctx) => ({
    scopes: await listIntegrationScopes(
      await requireIntegrationScopeAccess(ctx),
      args,
    ),
  }),
});
