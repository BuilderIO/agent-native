import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  ANALYTICS_PROVIDER_API_IDS,
  fetchProviderApiDocs,
} from "../server/lib/provider-api";

const ProviderSchema = z.enum(ANALYTICS_PROVIDER_API_IDS);

export default defineAction({
  description:
    "Inspect provider API docs/spec metadata, or fetch a registered provider docs/spec URL. Use this before arbitrary provider-api-request calls when the exact endpoint, filter operator, payload shape, pagination, or API version is uncertain.",
  schema: z.object({
    provider: ProviderSchema.describe(
      "Provider whose API docs/spec to inspect.",
    ),
    url: z
      .string()
      .url()
      .optional()
      .describe(
        "Optional docs/spec URL from provider-api-catalog to fetch. Only registered docs/spec origins are allowed.",
      ),
    maxBytes: z.coerce
      .number()
      .int()
      .min(1_000)
      .max(4 * 1024 * 1024)
      .optional()
      .describe("Maximum response bytes to read. Default 1MB, max 4MB."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => fetchProviderApiDocs(args),
});
