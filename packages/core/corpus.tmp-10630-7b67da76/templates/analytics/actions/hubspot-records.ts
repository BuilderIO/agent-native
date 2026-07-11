import { defineAction } from "@agent-native/core";
import { z } from "zod";

import {
  HUBSPOT_OBJECT_TYPES,
  searchHubSpotObjects,
} from "../server/lib/hubspot";

const StringListSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}, z.array(z.string()).optional());

export default defineAction({
  // Read-only provider query: safe to call from run-code `appAction` and
  // reusable across continuation retries (no re-fetch on resume).
  readOnly: true,
  description:
    "Search or list HubSpot CRM records across contacts, companies, deals, and tickets. Use this for HubSpot data that is not just deal pipeline metrics. This is a convenience reader; for unsupported object types, associations, custom filters, batch APIs, pagination modes, or any HubSpot endpoint this does not model, use provider-api-catalog/provider-api-docs/provider-api-request with provider = hubspot.",
  schema: z.object({
    objectType: z
      .enum(HUBSPOT_OBJECT_TYPES)
      .default("contacts")
      .describe("HubSpot CRM object type to query."),
    query: z
      .string()
      .optional()
      .describe(
        "Optional full-text search, such as a company name, domain, email, person name, or deal name. Omit to list recent records.",
      ),
    properties: StringListSchema.describe(
      "Optional comma-separated HubSpot property names to include in addition to safe defaults.",
    ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(25)
      .describe("Maximum records to return."),
    after: z
      .string()
      .optional()
      .describe("Optional HubSpot pagination cursor from a previous result."),
  }),
  http: { method: "GET" },
  run: async ({ objectType, query, properties, limit, after }) => {
    const result = await searchHubSpotObjects({
      objectType,
      query,
      properties,
      limit,
      after,
    });

    return {
      objectType,
      query: query?.trim() || null,
      count: result.records.length,
      total: result.total,
      nextAfter: result.nextAfter,
      properties: result.properties,
      records: result.records,
    };
  },
});
