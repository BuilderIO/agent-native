import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { writeGongNativeInsightsPolicy } from "../server/lib/gong-native-policy";

export default defineAction({
  description:
    "Turn Gong native semantic operations on or off for the current workspace (organization owners and admins only). They are on by default; each run-gong-native-insight call consumes one Gong credit request. Turn them off to block every semantic request while keeping raw Gong evidence actions available.",
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
        ? "Gong native semantic requests are enabled for this scope. Each request independently consumes one Gong credit request."
        : "Gong native semantic requests are disabled. Use gong-calls or the provider corpus evidence path.",
    };
  },
});
