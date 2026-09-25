import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { queryFlag } from "./_crm-action-utils.js";
import {
  loadAttributeOptions,
  toAttributeDefinition,
} from "./_crm-attribute-utils.js";

export default defineAction({
  description:
    "List the typed attributes (schema) of one CRM object type or list, with their managed status/select options. Use this before reading, writing, filtering, or grouping record values so slugs, types, cardinality, and option values are exact. Archived attributes are excluded unless includeArchived is set.",
  schema: z.object({
    target: z.enum(["object", "list"]).default("object"),
    targetId: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .describe(
        "The object type for target=object (for example accounts), or the list id for target=list.",
      ),
    connectionId: z.string().trim().min(1).max(128).optional(),
    includeArchived: queryFlag,
    limit: z.coerce.number().int().min(1).max(500).default(200),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const rows = await getDb()
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.target, args.target),
          // `object_type` carries the target for both kinds — for list
          // attributes it mirrors `target_id` — and, unlike `target_id`, it is
          // populated on rows written by the provider adapters.
          eq(schema.crmFieldPolicies.objectType, args.targetId),
          ...(args.connectionId
            ? [eq(schema.crmFieldPolicies.connectionId, args.connectionId)]
            : []),
          ...(args.includeArchived
            ? []
            : [eq(schema.crmFieldPolicies.archived, false)]),
          accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
        ),
      )
      .orderBy(
        asc(schema.crmFieldPolicies.position),
        asc(schema.crmFieldPolicies.label),
      )
      .limit(args.limit);

    const options = await loadAttributeOptions({
      attributeIds: rows.map((row) => row.id),
      includeArchived: args.includeArchived,
    });

    return {
      target: args.target,
      targetId: args.targetId,
      attributes: rows.map((row) =>
        toAttributeDefinition(row, options.get(row.id) ?? []),
      ),
    };
  },
});
