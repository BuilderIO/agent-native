import { defineAction } from "@agent-native/core/action";
import { isAgentKitFigmaSourceAvailable } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Check whether this authenticated Design session can use the Figma API without returning credential values or metadata.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) return { available: false };
    const available = await isAgentKitFigmaSourceAvailable({
      userEmail: ctx.userEmail,
      orgId: ctx.orgId ?? null,
      ...(ctx.credentialScope === "org"
        ? { credentialScope: "org" as const }
        : {}),
    });
    return { available };
  },
});
