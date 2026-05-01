import { defineAction } from "@agent-native/core";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server";
import { z } from "zod";
import { createAnalyticsPublicKey } from "../server/lib/first-party-analytics.js";

function resolveScope() {
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  return { userEmail, orgId: getRequestOrgId() || null };
}

export default defineAction({
  description:
    "Generate a public write key for first-party analytics ingestion. Use this when the user wants hosted apps to send events to analytics.agent-native.com/track. The returned publicKey is shown once and should be put in AGENT_NATIVE_ANALYTICS_PUBLIC_KEY / VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY on the emitting app.",
  schema: z.object({
    name: z
      .string()
      .optional()
      .describe("Human label for this key, e.g. 'Hosted templates'."),
  }),
  run: async (args) => {
    return createAnalyticsPublicKey(resolveScope(), args.name ?? "Default key");
  },
});
