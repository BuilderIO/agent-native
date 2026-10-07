import { createProviderApiRuntime } from "@agent-native/core/provider-api";
import { createProviderApiRequestAction } from "@agent-native/core/provider-api/actions/provider-api";
import { z } from "zod";

const runtime = createProviderApiRuntime({
  appId: "chat",
  providerIds: ["slack"],
});

const schema = z.object({
  provider: z.literal("slack").default("slack"),
  method: z
    .enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
    .default("GET"),
  path: z.string().min(1).describe("Slack Web API path, such as /auth.test."),
  query: z.unknown().optional().describe("Optional query parameters."),
  headers: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Optional non-authentication headers."),
  body: z.unknown().optional().describe("Optional request body."),
  connectionId: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Optional workspace connection to use."),
  timeoutMs: z.coerce.number().int().min(1_000).max(120_000).optional(),
  maxBytes: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(4 * 1024 * 1024)
    .optional(),
});

export function requiresProviderApiApproval(args: { method: string }): boolean {
  return args.method !== "GET" && args.method !== "HEAD";
}

export default createProviderApiRequestAction(runtime, {
  appId: "chat",
  schema,
  http: false,
  needsApproval: requiresProviderApiApproval,
  description:
    "Call Slack's authenticated Web API through the user's workspace connection. Use this when the conversation needs a concrete Slack read or write. If Slack is not connected, the runtime pauses the run and surfaces the standard contextual connection card; do not replace that request with prose or ask for credentials in chat.",
});
