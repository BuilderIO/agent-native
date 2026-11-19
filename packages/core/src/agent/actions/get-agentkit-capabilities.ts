import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { listAgentKitCapabilities } from "../../agentkit/capabilities.js";

export default defineAction({
  description:
    "Read context-source availability and connected workspace integrations usable by the authenticated caller in the current app. Returns scoped capability labels, never credentials or connection details.",
  schema: z.object({}),
  outputSchema: z.object({
    sources: z.object({ figma: z.object({ available: z.boolean() }) }),
    integrations: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        kind: z.enum(["provider-api", "mcp"]),
      }),
    ),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async (_args, ctx) => {
    const appId = ctx?.appId?.trim();
    if (!appId) {
      fail("An app context is required to read workspace integrations.", {
        errorCode: "agentkit_capabilities_unsupported_app",
        statusCode: 400,
      });
    }
    const userEmail = ctx?.userEmail?.trim().toLowerCase();
    if (!userEmail) {
      fail("Sign in to view AgentKit integrations.", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    }
    return listAgentKitCapabilities(appId, {
      userEmail,
      orgId: ctx?.orgId ?? null,
      ...(ctx?.credentialScope === "org"
        ? { credentialScope: "org" as const }
        : {}),
    });
  },
});
