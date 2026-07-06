import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { listPylonAccounts } from "../server/lib/pylon";

const StringListSchema = z.preprocess((value) => {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return undefined;
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}, z.array(z.string()).optional());

export default defineAction({
  readOnly: true,
  timeoutMs: 90_000,
  description:
    "Load a bounded cohort of Pylon accounts. Pass sentimentValues + sentimentField to filter by custom-field sentiment, or query for a text search. Property names are caller-defined.",
  schema: z.object({
    sentimentField: z.string().min(1).optional(),
    sentimentValues: StringListSchema,
    rootOrgIdField: z.string().min(1).optional(),
    domainField: z.string().min(1).optional(),
    query: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  http: { method: "GET" },
  run: async ({
    sentimentField,
    sentimentValues,
    rootOrgIdField,
    domainField,
    query,
    limit,
  }) => {
    return listPylonAccounts({
      sentimentField,
      sentimentValues,
      rootOrgIdField,
      domainField,
      query,
      limit,
    });
  },
});
