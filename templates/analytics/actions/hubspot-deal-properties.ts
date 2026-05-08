import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getDealProperties } from "../server/lib/hubspot";

export default defineAction({
  description:
    "List searchable HubSpot deal property metadata so agents can request custom deal fields.",
  schema: z.object({
    search: z
      .string()
      .optional()
      .describe("Optional case-insensitive search over property name or label."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(100)
      .describe("Maximum properties to return."),
  }),
  http: { method: "GET" },
  run: async ({ search, limit }) => {
    const q = search?.trim().toLowerCase();
    const properties = await getDealProperties();
    const filtered = q
      ? properties.filter((property) => {
          const name = property.name.toLowerCase();
          const label = property.label.toLowerCase();
          return name.includes(q) || label.includes(q);
        })
      : properties;

    return {
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
