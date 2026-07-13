import { defineAction } from "@agent-native/core";
import { appStateGetMany } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server";
import { z } from "zod";

const PROVIDERS = ["apollo", "hubspot", "gong", "pylon"] as const;

function hasConfiguredKey(value: Record<string, unknown> | null): boolean {
  return typeof value?.apiKey === "string" && value.apiKey.trim().length > 0;
}

export default defineAction({
  description:
    "Read which optional Mail contact-sidebar integrations are configured without returning credential values.",
  schema: z.object({}),
  outputSchema: z.object({
    apollo: z.boolean(),
    hubspot: z.boolean(),
    gong: z.boolean(),
    pylon: z.boolean(),
  }),
  http: { method: "GET" },
  readOnly: true,
  agentTool: false,
  run: async () => {
    const ownerEmail = getRequestUserEmail();
    if (!ownerEmail) throw new Error("no authenticated user");
    const states = await appStateGetMany(ownerEmail, PROVIDERS);
    return {
      apollo: hasConfiguredKey(states.apollo),
      hubspot: hasConfiguredKey(states.hubspot),
      gong: hasConfiguredKey(states.gong),
      pylon: hasConfiguredKey(states.pylon),
    };
  },
});
