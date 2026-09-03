import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter, assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  ATTRIBUTE_TYPE_SPECS,
  CRM_ATTRIBUTE_TYPES,
} from "../shared/crm-attributes.js";
import { requireCrmScope, toJson } from "./_crm-action-utils.js";
import {
  CrmAttributeValueError,
  legacyValueTypeFor,
  loadAttributeOptions,
  requireAttributeType,
  requireEditableAttribute,
  toApiSlug,
  toAttributeDefinition,
} from "./_crm-attribute-utils.js";

const MAX_CONFIG_CHARS = 4000;

const optionInput = z.object({
  value: z.string().trim().min(1).max(200),
  title: z.string().trim().min(1).max(200).optional(),
  color: z.string().trim().min(1).max(64).optional(),
  targetDays: z.number().int().min(0).max(3650).nullish(),
  celebrate: z.boolean().optional(),
});

export default defineAction({
  description:
    "Create one local, typed CRM attribute on an object type or a list. The attribute is always local-authoritative — never provider-owned — and its snake_case api slug is derived from the title and immutable afterwards. Supply options only for status and select attributes; status options may carry targetDays (stage SLA) and celebrate. The system-only types interaction and personal-name are rejected.",
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
    title: z.string().trim().min(1).max(200),
    type: z.enum(CRM_ATTRIBUTE_TYPES),
    multi: z
      .boolean()
      .default(false)
      .describe(
        "The only cardinality knob, including for record-reference attributes.",
      ),
    description: z.string().trim().max(2000).optional(),
    config: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        'Type configuration, for example {"currency":{"code":"USD"}} or {"reference":{"allowedObjectTypes":["accounts"]}}.',
      ),
    required: z.boolean().default(false),
    uniqueValue: z.boolean().default(false),
    historyTracked: z
      .boolean()
      .default(true)
      .describe(
        "Set false only for churny mirror fields whose history is not worth keeping.",
      ),
    position: z.number().int().min(0).max(10_000).optional(),
    inverseAttributeId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "record-reference only: pairs this attribute with the reverse-direction attribute on the other object.",
      ),
    options: z.array(optionInput).max(200).optional(),
  }),
  audit: {
    target: (_args, result) => {
      const attribute = result as {
        id: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-field-policy",
        id: attribute.id,
        ownerEmail: attribute.ownerEmail,
        orgId: attribute.orgId,
        visibility: attribute.visibility,
      };
    },
    summary: (args) =>
      `Created CRM ${args.type} attribute ${args.title} on ${args.target} ${args.targetId}`,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    requireAttributeType(args.type);
    const spec = ATTRIBUTE_TYPE_SPECS[args.type];

    if (args.multi && !spec.supportsMulti) {
      throw new CrmAttributeValueError(
        "crm-attribute-cardinality",
        `Attribute type "${args.type}" cannot be multi-valued.`,
      );
    }
    const optionInputs = args.options ?? [];
    if (optionInputs.length > 0 && !spec.usesOptions) {
      throw new CrmAttributeValueError(
        "crm-attribute-options-unsupported",
        `Attribute type "${args.type}" does not use managed options. Only status and select attributes take options.`,
      );
    }
    if (args.type !== "status") {
      const stageOnly = optionInputs.find(
        (option) => option.targetDays != null || option.celebrate === true,
      );
      if (stageOnly) {
        throw new CrmAttributeValueError(
          "crm-attribute-option-stage-fields",
          `targetDays and celebrate describe a pipeline stage and apply to status attributes only; option "${stageOnly.value}" is on a ${args.type} attribute.`,
        );
      }
    }
    const duplicate = optionInputs.find(
      (option, index) =>
        optionInputs.findIndex((other) => other.value === option.value) !==
        index,
    );
    if (duplicate) {
      throw new CrmAttributeValueError(
        "crm-attribute-option-duplicate",
        `Option value "${duplicate.value}" was supplied more than once.`,
      );
    }
    if (args.inverseAttributeId && args.type !== "record-reference") {
      throw new CrmAttributeValueError(
        "crm-attribute-inverse-type",
        `inverseAttributeId pairs two record-reference attributes; this attribute is a ${args.type}.`,
      );
    }

    const db = getDb();
    const connectionId = await resolveConnectionId(args);

    // Deliberately not access-filtered: the unique index spans every row for
    // (connection_id, object_type, field_name), so a slug taken by a row this
    // caller cannot see still collides. Reporting that as a clean 422 beats a
    // raw constraint violation.
    const siblings = await db
      .select({
        id: schema.crmFieldPolicies.id,
        fieldName: schema.crmFieldPolicies.fieldName,
        position: schema.crmFieldPolicies.position,
      })
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.connectionId, connectionId),
          eq(schema.crmFieldPolicies.objectType, args.targetId),
        ),
      );

    const apiSlug = toApiSlug(args.title);
    if (siblings.some((sibling) => sibling.fieldName === apiSlug)) {
      throw new CrmAttributeValueError(
        "crm-attribute-slug-taken",
        `An attribute with the slug "${apiSlug}" already exists on ${args.target} ${args.targetId}. Slugs are immutable, so pick a different title.`,
      );
    }

    const inverse = args.inverseAttributeId
      ? await loadPairableInverse(args.inverseAttributeId)
      : null;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db.insert(schema.crmFieldPolicies).values({
      id,
      connectionId,
      // Both columns carry the target: `object_type` keeps the legacy unique
      // index meaningful for list attributes too.
      objectType: args.targetId,
      targetId: args.targetId,
      target: args.target,
      fieldName: apiSlug,
      apiSlug,
      label: args.title,
      description: args.description ?? null,
      valueType: legacyValueTypeFor(args.type, args.multi),
      // An authored attribute is owned here, never by a provider, even when the
      // connection mirrors HubSpot or Salesforce.
      storagePolicy: "local-authoritative",
      authority: "local-authoritative",
      attributeType: args.type,
      multi: args.multi,
      historyTracked: args.historyTracked,
      inverseAttributeId: inverse?.id ?? null,
      configJson: toJson(args.config ?? {}, MAX_CONFIG_CHARS),
      uniqueValue: args.uniqueValue,
      required: args.required,
      readable: true,
      createable: true,
      updateable: true,
      position:
        args.position ??
        siblings.reduce((max, sibling) => Math.max(max, sibling.position), -1) +
          1,
      createdAt: now,
      updatedAt: now,
      ...ownership,
    });

    if (optionInputs.length > 0) {
      await db.insert(schema.crmAttributeOptions).values(
        optionInputs.map((option, index) => ({
          id: crypto.randomUUID(),
          attributeId: id,
          value: option.value,
          title: option.title ?? option.value,
          color: option.color ?? null,
          position: index,
          targetDays: option.targetDays ?? null,
          celebrate: option.celebrate ?? false,
          createdAt: now,
          updatedAt: now,
          ...ownership,
        })),
      );
    }

    if (inverse) {
      await db
        .update(schema.crmFieldPolicies)
        .set({ inverseAttributeId: id, updatedAt: now })
        .where(
          and(
            eq(schema.crmFieldPolicies.id, inverse.id),
            accessFilter(
              schema.crmFieldPolicies,
              schema.crmFieldPolicyShares,
              undefined,
              "editor",
            ),
          ),
        );
    }

    const [row] = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(eq(schema.crmFieldPolicies.id, id))
      .limit(1);
    if (!row) {
      throw new Error("CRM attribute could not be verified after creating it.");
    }
    const options = await loadAttributeOptions({
      attributeIds: [id],
      includeArchived: true,
    });
    return {
      ...toAttributeDefinition(row, options.get(id) ?? []),
      ...ownership,
    };
  },
});

/**
 * The connection an attribute belongs to. A list already names one, so a list
 * attribute never has to be told which connection it is on.
 */
async function resolveConnectionId(args: {
  target: "object" | "list";
  targetId: string;
  connectionId?: string;
}): Promise<string> {
  const db = getDb();
  if (args.target === "list") {
    await assertAccess("crm-list", args.targetId, "editor");
    const [list] = await db
      .select({ connectionId: schema.crmLists.connectionId })
      .from(schema.crmLists)
      .where(eq(schema.crmLists.id, args.targetId))
      .limit(1);
    if (!list) {
      throw new CrmAttributeValueError(
        "crm-list-not-found",
        `CRM list ${args.targetId} was not found.`,
      );
    }
    if (args.connectionId && args.connectionId !== list.connectionId) {
      throw new CrmAttributeValueError(
        "crm-attribute-connection-mismatch",
        `List ${args.targetId} belongs to connection ${list.connectionId}, not ${args.connectionId}.`,
      );
    }
    return list.connectionId;
  }

  const connections = await db
    .select({ id: schema.crmConnections.id })
    .from(schema.crmConnections)
    .where(
      and(
        ...(args.connectionId
          ? [eq(schema.crmConnections.id, args.connectionId)]
          : []),
        accessFilter(
          schema.crmConnections,
          schema.crmConnectionShares,
          undefined,
          "editor",
        ),
      ),
    )
    .limit(args.connectionId ? 1 : 2);
  if (!connections.length) {
    throw new Error(
      "No CRM connection is available with editor access. Configure a Native SQL CRM or a provider connection first.",
    );
  }
  if (!args.connectionId && connections.length > 1) {
    throw new Error(
      "More than one CRM connection is available. Provide connectionId to choose one.",
    );
  }
  return connections[0]!.id;
}

/** The other half of a paired relationship, or a typed error explaining why not. */
async function loadPairableInverse(inverseAttributeId: string) {
  const inverse = await requireEditableAttribute(inverseAttributeId);
  if (inverse.attributeType !== "record-reference") {
    throw new CrmAttributeValueError(
      "crm-attribute-inverse-type",
      `Attribute ${inverseAttributeId} is a ${inverse.attributeType}; only a record-reference attribute can be the inverse side.`,
    );
  }
  if (inverse.inverseAttributeId) {
    throw new CrmAttributeValueError(
      "crm-attribute-inverse-taken",
      `Attribute ${inverseAttributeId} is already paired with ${inverse.inverseAttributeId}. Unpair it before pairing it again.`,
    );
  }
  return inverse;
}
