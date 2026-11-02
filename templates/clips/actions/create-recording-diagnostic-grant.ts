import { fail, defineAction } from "@agent-native/core/action";
import { getRequestContext } from "@agent-native/core/server";
import { z } from "zod";

import { createDiagnosticGrant } from "../server/lib/diagnostic-context.js";
import { getServerAppBasePath } from "../server/lib/public-agent-context.js";
import { diagnosticScopeSchema } from "../shared/diagnostic-context.js";
export default defineAction({
  agentTool: false,
  audit: { recordInputs: false },
  description:
    "Explicitly authorize a temporary, revocable diagnostic-only agent read after the context owner previews its scopes and time interval. This bearer link does not grant video, transcript, or frame access. Never publish it.",
  schema: z.object({
    contextId: z.string(),
    label: z.string().trim().min(1).max(120),
    scopes: z.array(diagnosticScopeSchema).min(1).max(5),
    fromMs: z.number().finite().optional(),
    toMs: z.number().finite().optional(),
    ttlSeconds: z.number().int().min(1).max(604800).optional(),
  }),
  outputSchema: z.object({
    grantId: z.string(),
    url: z.string(),
    expiresAt: z.string(),
  }),
  run: async (args) => {
    const origin = getRequestContext()?.requestOrigin;
    if (!origin)
      fail("The diagnostic grant needs a verified request origin.", {
        errorCode: "diagnostic_origin_required",
        statusCode: 400,
      });
    const grant = await createDiagnosticGrant(args);
    const url = new URL(
      `${getServerAppBasePath()}/api/agent-app-activity.json`,
      origin,
    );
    url.searchParams.set("contextId", args.contextId);
    url.searchParams.set("diagnostic_access", grant.diagnosticAccess);
    return {
      grantId: grant.grantId,
      url: url.toString(),
      expiresAt: grant.expiresAt,
    };
  },
});
