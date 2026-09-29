import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import {
  listAgentKitCapabilities,
  type AgentKitCapabilityAppId,
} from "../../agentkit/capabilities.js";

export default defineAction({
  description:
    "Read the signed-in user's AgentKit context-source and integration capabilities for Design or Slides. Returns only supported, connected capability labels and availability; never returns credentials or connection details.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  toolCallable: false,
  run: async (_args, ctx) => {
    const appId = ctx?.appId;
    if (appId !== "design" && appId !== "slides") {
      fail("AgentKit capabilities are only available in Design and Slides.", {
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
    return listAgentKitCapabilities(appId as AgentKitCapabilityAppId, {
      userEmail,
      orgId: ctx?.orgId ?? null,
      ...(ctx?.credentialScope === "org"
        ? { credentialScope: "org" as const }
        : {}),
    });
  },
});
