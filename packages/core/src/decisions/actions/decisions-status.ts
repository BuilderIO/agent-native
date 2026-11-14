import { z } from "zod";

import { defineAction, fail } from "../../action.js";
import { getDecisionsStatus } from "../decide.js";

const providerSchema = z.enum(["openai", "jev"]);
const capabilitySchema = z.object({
  status: z.enum(["verified", "unverified"]),
  enabled: z.boolean(),
});
const questionCapabilitiesSchema = z.object({
  predicate: capabilitySchema,
  choice: capabilitySchema,
  score: capabilitySchema,
});
const decisionsStatusOutputSchema = z.object({
  providerOrder: z.array(providerSchema),
  capabilities: z.object({
    jev: z.object({ builderProxy: questionCapabilitiesSchema }),
    openai: z.object({ decisionsApi: questionCapabilitiesSchema }),
  }),
  providers: z.array(
    z.object({
      provider: providerSchema,
      status: z.enum(["ready", "not_configured", "unknown"]),
    }),
  ),
});

export default defineAction({
  description:
    "Check decision provider readiness and question capabilities for this workspace. Returns provider order, capability verification/enabled states, and credential readiness without revealing API keys.",
  schema: z.object({}),
  outputSchema: decisionsStatusOutputSchema,
  readOnly: true,
  run: async (_args, ctx) => {
    if (!ctx?.userEmail) fail("Not authenticated.", { statusCode: 401 });
    return getDecisionsStatus(ctx.userEmail, {
      ...(ctx.signal ? { signal: ctx.signal } : {}),
    });
  },
});
