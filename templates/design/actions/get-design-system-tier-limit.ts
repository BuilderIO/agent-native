import { defineAction } from "@agent-native/core/action";
import { fetchBuilderDesignSystemTierLimit } from "@agent-native/core/server";
import { z } from "zod";

export default defineAction({
  description:
    "Read the DSI plan/tier limit (current design-system count vs. the plan max, and whether code/GitHub indexing is allowed). Use before offering to create a design system, so a user already at their plan's cap sees the limit and an upgrade link instead of a generic failure after they try.",
  schema: z.object({}),
  readOnly: true,
  http: { method: "GET" },
  run: async () => fetchBuilderDesignSystemTierLimit(),
});
