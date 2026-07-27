import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { ATTRIBUTE_TYPE_SPECS } from "../shared/crm-attributes.js";
import { requireCrmScope } from "./_crm-action-utils.js";
import {
  CrmAttributeValueError,
  loadAttributeOptions,
  requireEditableAttribute,
  toAttributeDefinition,
  type CrmAttributeOptionRow,
} from "./_crm-attribute-utils.js";

const inputSchema = z
  .object({
    attributeId: z.string().trim().min(1).max(128),
    operation: z.enum(["add", "update", "archive", "reorder"]),
    optionId: z.string().trim().min(1).max(128).optional(),
    value: z
      .string()
      .trim()
      .min(1)
      .max(200)
      .optional()
      .describe(
        "add only. The stored value; immutable afterwards because record values reference it.",
      ),
    title: z.string().trim().min(1).max(200).optional(),
    color: z.string().trim().min(1).max(64).nullish(),
    position: z.number().int().min(0).max(10_000).optional(),
    targetDays: z
      .number()
      .int()
      .min(0)
      .max(3650)
      .nullish()
      .describe("status attributes only: the stage SLA in days."),
    celebrate: z.boolean().optional().describe("status attributes only."),
    archived: z.boolean().default(true),
    optionIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(200)
      .optional()
      .describe("reorder only. Options take the position of their index."),
  })
  .superRefine((value, ctx) => {
    if (value.operation === "add" && !value.value) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message: "value is required when adding an option.",
      });
    }
    if (
      (value.operation === "update" || value.operation === "archive") &&
      !value.optionId
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["optionId"],
        message: `optionId is required when you ${value.operation} an option.`,
      });
    }
    if (value.operation === "reorder" && !value.optionIds) {
      ctx.addIssue({
        code: "custom",
        path: ["optionIds"],
        message: "optionIds is required when reordering options.",
      });
    }
    if (value.operation !== "add" && value.value) {
      ctx.addIssue({
        code: "custom",
        path: ["value"],
        message:
          "An option value is immutable — stored record values reference it. Archive this option and add a new one instead.",
      });
    }
  });

export default defineAction({
  description:
    "Add, edit, reorder, or archive one managed option on a status or select CRM attribute. Options are never auto-created by a value write, so add the option here before writing it. Status options may carry targetDays (the stage SLA) and celebrate. Archiving an option removes it from the picker only: records already holding that value keep it untouched.",
  schema: inputSchema,
  audit: {
    target: (args) => ({ type: "crm-field-policy", id: args.attributeId }),
    summary: (args) =>
      `${args.operation} option on CRM attribute ${args.attributeId}`,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const attribute = await requireEditableAttribute(args.attributeId);
    const spec = ATTRIBUTE_TYPE_SPECS[attribute.attributeType];
    if (!spec.usesOptions) {
      throw new CrmAttributeValueError(
        "crm-attribute-options-unsupported",
        `Attribute "${attribute.apiSlug ?? attribute.fieldName}" is a ${attribute.attributeType} and does not use managed options. Only status and select attributes take options.`,
      );
    }
    if (
      attribute.attributeType !== "status" &&
      (args.targetDays != null || args.celebrate !== undefined)
    ) {
      throw new CrmAttributeValueError(
        "crm-attribute-option-stage-fields",
        `targetDays and celebrate describe a pipeline stage and apply to status attributes only; this attribute is a ${attribute.attributeType}.`,
      );
    }

    const db = getDb();
    const now = new Date().toISOString();

    if (args.operation === "add") {
      const siblings = await loadOptionSlots(args.attributeId);
      if (siblings.some((option) => option.value === args.value)) {
        throw new CrmAttributeValueError(
          "crm-attribute-option-duplicate",
          `Option "${args.value}" already exists on this attribute.`,
        );
      }
      // guard:allow-unscoped — requireEditableAttribute() above already ran
      // assertAccess("crm-field-policy", …, "editor"), and requireCrmScope(ctx)
      // below sets ownerEmail/orgId from the request context.
      await db.insert(schema.crmAttributeOptions).values({
        id: crypto.randomUUID(),
        attributeId: args.attributeId,
        value: args.value!,
        title: args.title ?? args.value!,
        color: args.color ?? null,
        position:
          args.position ??
          siblings.reduce((max, option) => Math.max(max, option.position), -1) +
            1,
        targetDays: args.targetDays ?? null,
        celebrate: args.celebrate ?? false,
        createdAt: now,
        updatedAt: now,
        ...requireCrmScope(ctx),
      });
    } else if (args.operation === "reorder") {
      const known = new Set(
        (await loadOptionRows(args.attributeId)).map((option) => option.id),
      );
      const unknown = args.optionIds!.find((id) => !known.has(id));
      if (unknown) {
        throw new CrmAttributeValueError(
          "crm-attribute-option-unknown",
          `Option ${unknown} does not belong to attribute ${args.attributeId}.`,
        );
      }
      for (const [index, optionId] of args.optionIds!.entries()) {
        // guard:allow-unscoped — editableOption() carries the editor
        // accessFilter; the guard cannot follow it out of the helper.
        await db
          .update(schema.crmAttributeOptions)
          .set({ position: index, updatedAt: now })
          .where(editableOption(args.attributeId, optionId));
      }
    } else {
      const patch =
        args.operation === "archive"
          ? { archived: args.archived }
          : {
              ...(args.title === undefined ? {} : { title: args.title }),
              ...(args.color === undefined ? {} : { color: args.color }),
              ...(args.position === undefined
                ? {}
                : { position: args.position }),
              ...(args.targetDays === undefined
                ? {}
                : { targetDays: args.targetDays }),
              ...(args.celebrate === undefined
                ? {}
                : { celebrate: args.celebrate }),
            };
      const options = await loadOptionRows(args.attributeId);
      if (!options.some((option) => option.id === args.optionId)) {
        throw new CrmAttributeValueError(
          "crm-attribute-option-unknown",
          `Option ${args.optionId} does not belong to attribute ${args.attributeId}.`,
        );
      }
      if (Object.keys(patch).length > 0) {
        // Only `crm_attribute_options` is touched. Archiving an option in use
        // must leave every stored value alone: the value stays, the picker
        // stops offering it.
        // guard:allow-unscoped — editableOption() carries the editor
        // accessFilter; the guard cannot follow it out of the helper.
        await db
          .update(schema.crmAttributeOptions)
          .set({ ...patch, updatedAt: now })
          .where(editableOption(args.attributeId, args.optionId!));
      }
    }

    const [row] = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.id, args.attributeId),
          accessFilter(
            schema.crmFieldPolicies,
            schema.crmFieldPolicyShares,
            undefined,
            "editor",
          ),
        ),
      )
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

function editableOption(attributeId: string, optionId: string) {
  return and(
    eq(schema.crmAttributeOptions.id, optionId),
    eq(schema.crmAttributeOptions.attributeId, attributeId),
    accessFilter(
      schema.crmAttributeOptions,
      schema.crmAttributeOptionShares,
      undefined,
      "editor",
    ),
  );
}

/**
 * Value and position of every option row, deliberately not access-filtered: the
 * unique index on (attribute_id, value) spans rows this caller cannot see, so a
 * scoped check would report a clean insert and then hit a constraint violation.
 */
function loadOptionSlots(attributeId: string) {
  // guard:allow-unscoped — see the note above: callers are already gated on
  // editor access to the attribute, and only value/position are read.
  return getDb()
    .select({
      value: schema.crmAttributeOptions.value,
      position: schema.crmAttributeOptions.position,
    })
    .from(schema.crmAttributeOptions)
    .where(eq(schema.crmAttributeOptions.attributeId, attributeId));
}

/** Every option the caller may edit, archived ones included. */
function loadOptionRows(attributeId: string): Promise<CrmAttributeOptionRow[]> {
  return getDb()
    .select()
    .from(schema.crmAttributeOptions)
    .where(
      and(
        eq(schema.crmAttributeOptions.attributeId, attributeId),
        accessFilter(
          schema.crmAttributeOptions,
          schema.crmAttributeOptionShares,
          undefined,
          "editor",
        ),
      ),
    )
    .orderBy(asc(schema.crmAttributeOptions.position));
}
