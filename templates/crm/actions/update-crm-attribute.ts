import { defineAction } from "@agent-native/core/action";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  CRM_ATTRIBUTE_FILL_MODES,
  CRM_ATTRIBUTE_TYPES,
} from "../shared/crm-contract.js";
import { toJson } from "./_crm-action-utils.js";
import {
  CrmAttributeValueError,
  loadAttributeOptions,
  requireEditableAttribute,
  toAttributeDefinition,
} from "./_crm-attribute-utils.js";

const MAX_CONFIG_CHARS = 4000;

export default defineAction({
  description:
    "Update one CRM attribute's presentation and behaviour: title, description, position, required, historyTracked, config, archived, and the manual fill mode. The api slug and the attribute type are immutable — every stored value row is keyed by the slug and typed by the type, so changing either would orphan history instead of migrating it. Setting fillMode never runs a fill; fills are triggered manually.",
  schema: z.object({
    attributeId: z.string().trim().min(1).max(128),
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullish(),
    position: z.number().int().min(0).max(10_000).optional(),
    required: z.boolean().optional(),
    historyTracked: z.boolean().optional(),
    config: z.record(z.string(), z.unknown()).optional(),
    fillMode: z.enum(CRM_ATTRIBUTE_FILL_MODES).nullish(),
    fillConfig: z.record(z.string(), z.unknown()).optional(),
    archived: z.boolean().optional(),
    apiSlug: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe("Immutable. Supplying a different slug is rejected."),
    type: z
      .enum(CRM_ATTRIBUTE_TYPES)
      .optional()
      .describe("Immutable. Supplying a different type is rejected."),
  }),
  audit: {
    target: (args) => ({ type: "crm-field-policy", id: args.attributeId }),
    summary: (args) => `Updated CRM attribute ${args.attributeId}`,
  },
  run: async (args) => {
    const current = await requireEditableAttribute(args.attributeId);

    if (
      args.apiSlug &&
      args.apiSlug !== (current.apiSlug ?? current.fieldName)
    ) {
      throw new CrmAttributeValueError(
        "crm-attribute-slug-immutable",
        `The api slug of attribute ${args.attributeId} is "${current.apiSlug ?? current.fieldName}" and cannot change: every stored value row is keyed by it, so a rename would orphan the attribute's history. Create a new attribute instead.`,
      );
    }
    if (args.type && args.type !== current.attributeType) {
      throw new CrmAttributeValueError(
        "crm-attribute-type-immutable",
        `The type of attribute ${args.attributeId} is "${current.attributeType}" and cannot change: stored values live in the column that type chose, and reinterpreting them is a migration, not an edit. Create a new attribute and move the values.`,
      );
    }

    const patch = {
      ...(args.title === undefined ? {} : { label: args.title }),
      ...(args.description === undefined
        ? {}
        : { description: args.description }),
      ...(args.position === undefined ? {} : { position: args.position }),
      ...(args.required === undefined ? {} : { required: args.required }),
      ...(args.historyTracked === undefined
        ? {}
        : { historyTracked: args.historyTracked }),
      ...(args.config === undefined
        ? {}
        : { configJson: toJson(args.config, MAX_CONFIG_CHARS) }),
      ...(args.fillMode === undefined ? {} : { fillMode: args.fillMode }),
      ...(args.fillConfig === undefined
        ? {}
        : { fillConfigJson: toJson(args.fillConfig, MAX_CONFIG_CHARS) }),
      ...(args.archived === undefined ? {} : { archived: args.archived }),
    };

    const db = getDb();
    if (Object.keys(patch).length > 0) {
      await db
        .update(schema.crmFieldPolicies)
        .set({ ...patch, updatedAt: new Date().toISOString() })
        .where(eq(schema.crmFieldPolicies.id, args.attributeId));
    }

    const [row] = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(eq(schema.crmFieldPolicies.id, args.attributeId))
      .limit(1);
    if (!row) {
      throw new Error("CRM attribute could not be verified after saving.");
    }
    const options = await loadAttributeOptions({
      attributeIds: [row.id],
      includeArchived: true,
    });
    return toAttributeDefinition(row, options.get(row.id) ?? []);
  },
});
