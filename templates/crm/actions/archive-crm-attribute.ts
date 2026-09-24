import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, count, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  loadAttributeOptions,
  requireEditableAttribute,
  toAttributeDefinition,
} from "./_crm-attribute-utils.js";

export default defineAction({
  description:
    "Archive one CRM attribute. This is a soft archive: the attribute stops appearing in the grid and pickers, and every stored value and history row it owns is retained untouched. Attributes are never deleted. Use update-crm-attribute with archived=false to restore one.",
  schema: z.object({
    attributeId: z.string().trim().min(1).max(128),
  }),
  audit: {
    target: (args) => ({ type: "crm-field-policy", id: args.attributeId }),
    summary: (args) => `Archived CRM attribute ${args.attributeId}`,
  },
  run: async (args) => {
    const current = await requireEditableAttribute(args.attributeId);
    const db = getDb();

    if (!current.archived) {
      await db
        .update(schema.crmFieldPolicies)
        .set({ archived: true, updatedAt: new Date().toISOString() })
        .where(eq(schema.crmFieldPolicies.id, args.attributeId));
    }

    // Reported so a caller can see the archive kept data rather than removed it.
    const [values] = await db
      .select({ total: count() })
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.attributeId, args.attributeId),
          isNull(schema.crmRecordFields.activeUntil),
          accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
        ),
      );

    if (!values) {
      throw new Error(
        "Retained CRM attribute values could not be counted; the archive was not confirmed.",
      );
    }

    const [row] = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(eq(schema.crmFieldPolicies.id, args.attributeId))
      .limit(1);
    if (!row) {
      throw new Error("CRM attribute could not be verified after archiving.");
    }
    const options = await loadAttributeOptions({
      attributeIds: [row.id],
      includeArchived: true,
    });
    return {
      ...toAttributeDefinition(row, options.get(row.id) ?? []),
      retainedValueCount: values.total,
    };
  },
});
