import { createProviderApiRequestAction } from "@agent-native/core/provider-api/actions/provider-api";
import { getCredentialContext } from "@agent-native/core/server/request-context";
import { z } from "zod";

import {
  CRM_APP_ID,
  CRM_PROVIDER_API_IDS,
  getCrmProviderApiRuntime,
} from "../server/lib/provider-api.js";

const ProviderSchema = z.enum(CRM_PROVIDER_API_IDS);
const MethodSchema = z.enum(["GET", "HEAD"]);

const PaginationSchema = z
  .object({
    nextCursorPath: z.string().optional(),
    cursorParam: z.string().optional(),
    pageParam: z.string().optional(),
    startPage: z.coerce.number().int().optional(),
    offsetParam: z.string().optional(),
    pageSize: z.coerce.number().int().min(1).optional(),
    maxPages: z.coerce.number().int().min(1).max(200).optional(),
  })
  .optional();

export default createProviderApiRequestAction(getCrmProviderApiRuntime(), {
  description:
    "Make an exact read-only authenticated HubSpot or Salesforce GET or HEAD request through a CRM-granted workspace connection. This is the flexible escape hatch for custom object, field, relationship, pagination, and API-version reads that CRM convenience actions do not model. It is host-constrained, access-scoped to the granted connection, and redacts secrets. Provider writes must use revision-aware CRM proposals, never this action. Use stageAs for large results instead of returning raw provider payloads to chat.",
  schema: z
    .object({
      provider: ProviderSchema.describe("CRM provider: hubspot or salesforce."),
      method: MethodSchema.default("GET"),
      path: z
        .string()
        .min(1)
        .describe(
          "Provider API path, or a full URL on the selected connection's allowed provider host.",
        ),
      query: z.unknown().optional(),
      headers: z.record(z.string(), z.unknown()).optional(),
      auth: z.enum(["default", "none"]).default("default"),
      connectionId: z
        .string()
        .trim()
        .min(1)
        .optional()
        .describe(
          "Granted workspace connection id. Required for Salesforce so its actor-bound token and instance URL stay coupled.",
        ),
      timeoutMs: z.coerce.number().int().min(1_000).max(120_000).optional(),
      maxBytes: z.coerce
        .number()
        .int()
        .min(1_000)
        .max(4 * 1024 * 1024)
        .optional(),
      stageAs: z
        .string()
        .min(1)
        .optional()
        .describe(
          "Store response items as a caller-scoped scratch dataset and return a compact summary.",
        ),
      itemsPath: z.string().optional(),
      pagination: PaginationSchema.describe(
        "Server-side query-string pagination for a staged response. Use the provider's catalog/docs to choose its cursor fields.",
      ),
      saveToFile: z.string().optional(),
      fetchAllPages: z
        .object({
          cursorPath: z.string(),
          cursorParam: z.string().optional(),
          itemsPath: z.string().optional(),
          maxPages: z.coerce.number().int().min(1).max(50).optional(),
        })
        .optional(),
    })
    .superRefine((value, ctx) => {
      if (value.provider === "salesforce" && !value.connectionId) {
        ctx.addIssue({
          code: "custom",
          path: ["connectionId"],
          message:
            "Salesforce provider reads require the granted workspace connection id.",
        });
      }
    }),
  appId: CRM_APP_ID,
  getOwnerEmail: () => getCredentialContext()?.userEmail ?? null,
  http: false,
  toolCallable: false,
});
