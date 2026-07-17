import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { writeGongNativeInsightsPolicy } from "../server/lib/gong-native-policy";

export default defineAction({
  description:
    "Enable or disable paid Gong native semantic operations for the current workspace. Enabling this permits individually authorized gong-native-insights calls to consume Gong credits; it does not send a Gong request by itself. Disable it to fail closed for every semantic request while keeping raw Gong evidence actions available.",
  schema: z.object({
    enabled: z
      .boolean()
      .describe(
        "Whether this workspace may make paid Gong native semantic requests.",
      ),
  }),
  http: { method: "POST" },
  needsApproval: true,
  toolCallable: false,
  run: async ({ enabled }) => {
    const policy = await writeGongNativeInsightsPolicy(enabled);
    return {
      ...policy,
      creditRequests: 0,
      guidance: enabled
        ? "Gong native semantic requests are enabled for this scope. Each request still requires allowCreditRequest=true and independently consumes Gong credits."
        : "Gong native semantic requests are disabled. Use gong-calls or the provider corpus evidence path.",
    };
  },
});
