import { defineAction } from "@agent-native/core";
import { z } from "zod";
import {
  HUBSPOT_OBJECT_TYPES,
  getObjectProperties,
} from "../server/lib/hubspot";

export default defineAction({
  description:
    "List HubSpot CRM property metadata for contacts, companies, deals, or tickets so agents can request the right fields before querying records.",
  schema: z.object({
    objectType: z
      .enum(HUBSPOT_OBJECT_TYPES)
      .default("contacts")
      .describe("HubSpot CRM object type whose properties should be listed."),
    search: z
      .string()
      .optional()
      .describe(
        "Optional case-insensitive search over property name or label.",
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Maximum properties to return."),
  }),
  http: { method: "GET" },
  run: async ({ objectType, search, limit }) => {
    const q = search?.trim().toLowerCase();
    const properties = await getObjectProperties(objectType);
    const filtered = q
      ? properties.filter((property) => {
          const name = property.name.toLowerCase();
          const label = property.label.toLowerCase();
          return name.includes(q) || label.includes(q);
        })
      : properties;

    return {
      objectType,
      count: filtered.length,
      properties: filtered.slice(0, limit).map((property) => ({
        name: property.name,
        label: property.label,
        type: property.type ?? null,
        fieldType: property.fieldType ?? null,
        description: property.description ?? null,
      })),
    };
  },
});
