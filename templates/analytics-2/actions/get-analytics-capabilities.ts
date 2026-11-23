import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { evaluateCapabilities } from "../server/lib/analytics-capabilities.js";
import {
  capabilityDecisionSchema,
  capabilityScopeRefSchema,
  controlIdSchema,
} from "../shared/capabilities.js";

export default defineAction({
  description:
    "Read the current member's analytics capability decisions for a workspace or resource.",
  schema: z.strictObject({
    scope: capabilityScopeRefSchema
      .meta({ type: "object" })
      .describe("Workspace or resource to check."),
    controlIds: z
      .array(controlIdSchema)
      .max(32)
      .optional()
      .describe(
        "Control IDs or aliases. Omit or pass an empty list to check all controls for the scope.",
      ),
  }),
  outputSchema: z
    .object({ decisions: z.array(capabilityDecisionSchema) })
    .strict(),
  http: { method: "GET" },
  readOnly: true,
  persistInBrowser: false,
  run: async ({ scope, controlIds }) => ({
    decisions: await evaluateCapabilities(scope, controlIds),
  }),
});
