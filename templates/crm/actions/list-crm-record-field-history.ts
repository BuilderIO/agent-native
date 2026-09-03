/**
 * The bitemporal history of one attribute value.
 *
 * `crm_record_fields` keeps every superseded value as its own row stamped with
 * when it stopped being current, so "changed from X to Y, by Z" is a read, not
 * an audit-log join. An attribute with `history_tracked = false` is updated in
 * place and therefore genuinely HAS no history — that is reported as
 * `historyTracked: false`, which is a different answer from "nothing changed".
 */

import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { CrmAttributeValueError } from "../server/lib/record-fields.js";
import { storageColumnFor } from "../shared/crm-attributes.js";
import type { CrmValue } from "../shared/crm-contract.js";

const MAX_CHANGES = 50;

export default defineAction({
  description:
    "Return the bitemporal change history of one CRM attribute value, newest first: each stored value with the window it was current for and the actor that set it. Pass entryId to read a list-entry attribute (a stage history) instead of a record attribute. historyTracked=false means the attribute is updated in place and keeps no history, which is not the same as no changes.",
  schema: z.object({
    recordId: z.string().trim().min(1).max(128),
    apiSlug: z.string().trim().min(1).max(120),
    entryId: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "Read a list-entry attribute's history instead of the record's.",
      ),
    limit: z.coerce.number().int().min(1).max(MAX_CHANGES).default(20),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const [record] = await db
      .select({
        id: schema.crmRecords.id,
        connectionId: schema.crmRecords.connectionId,
        objectType: schema.crmRecords.objectType,
      })
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.id, args.recordId),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      )
      .limit(1);
    if (!record) {
      const error = new Error("CRM record not found") as Error & {
        statusCode?: number;
      };
      error.statusCode = 404;
      throw error;
    }

    let attributeScope: { target: "object" | "list"; targetId: string };
    if (args.entryId) {
      const [entry] = await db
        .select({ listId: schema.crmListEntries.listId })
        .from(schema.crmListEntries)
        .where(
          and(
            eq(schema.crmListEntries.id, args.entryId),
            eq(schema.crmListEntries.recordId, record.id),
            accessFilter(schema.crmListEntries, schema.crmListEntryShares),
          ),
        )
        .limit(1);
      if (!entry) {
        throw new CrmAttributeValueError(
          "crm-list-entry-not-found",
          `CRM list entry "${args.entryId}" was not found on this record.`,
        );
      }
      attributeScope = { target: "list", targetId: entry.listId };
    } else {
      attributeScope = { target: "object", targetId: record.objectType };
    }

    const [attribute] = await db
      .select({
        id: schema.crmFieldPolicies.id,
        apiSlug: schema.crmFieldPolicies.apiSlug,
        fieldName: schema.crmFieldPolicies.fieldName,
        label: schema.crmFieldPolicies.label,
        attributeType: schema.crmFieldPolicies.attributeType,
        multi: schema.crmFieldPolicies.multi,
        historyTracked: schema.crmFieldPolicies.historyTracked,
      })
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.target, attributeScope.target),
          eq(schema.crmFieldPolicies.objectType, attributeScope.targetId),
          eq(schema.crmFieldPolicies.fieldName, args.apiSlug),
          accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
        ),
      )
      .limit(1);
    if (!attribute) {
      throw new CrmAttributeValueError(
        "crm-attribute-not-found",
        `"${args.apiSlug}" is not an attribute of ${attributeScope.target} "${attributeScope.targetId}".`,
      );
    }

    const column = storageColumnFor(attribute.attributeType, attribute.multi);
    const rows = await db
      .select({
        id: schema.crmRecordFields.id,
        stringValue: schema.crmRecordFields.stringValue,
        numberValue: schema.crmRecordFields.numberValue,
        booleanValue: schema.crmRecordFields.booleanValue,
        jsonValue: schema.crmRecordFields.jsonValue,
        activeFrom: schema.crmRecordFields.activeFrom,
        activeUntil: schema.crmRecordFields.activeUntil,
        actorType: schema.crmRecordFields.actorType,
        actorId: schema.crmRecordFields.actorId,
      })
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.recordId, record.id),
          args.entryId
            ? eq(schema.crmRecordFields.entryId, args.entryId)
            : isNull(schema.crmRecordFields.entryId),
          eq(schema.crmRecordFields.fieldName, args.apiSlug),
          accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
        ),
      )
      // Two writes can land in the same millisecond, so `activeFrom` alone does
      // not order the chain. The current row is first, then closed rows by when
      // they were closed — a row's `activeUntil` is the next row's `activeFrom`,
      // which is what actually orders same-instant edits. `(x is null) desc`
      // puts the current row first in both SQLite (1 > 0) and PostgreSQL
      // (true > false); NULLS FIRST/LAST defaults differ and cannot be relied on.
      .orderBy(
        desc(sql`(${schema.crmRecordFields.activeUntil} is null)`),
        desc(schema.crmRecordFields.activeUntil),
        desc(schema.crmRecordFields.activeFrom),
        desc(schema.crmRecordFields.id),
      )
      .limit(args.limit);

    return {
      recordId: record.id,
      entryId: args.entryId ?? null,
      apiSlug: attribute.apiSlug ?? attribute.fieldName,
      label: attribute.label,
      attributeType: attribute.attributeType,
      multi: attribute.multi,
      historyTracked: attribute.historyTracked,
      changes: rows.map((row) => ({
        id: row.id,
        value: decodeHistoryValue(column, args.apiSlug, row) as CrmValue,
        activeFrom: row.activeFrom,
        activeUntil: row.activeUntil,
        current: row.activeUntil === null,
        actorType: row.actorType,
        actorId: row.actorId,
      })),
      complete: rows.length < args.limit,
    };
  },
});

function decodeHistoryValue(
  column: ReturnType<typeof storageColumnFor>,
  apiSlug: string,
  row: {
    stringValue: string | null;
    numberValue: number | null;
    booleanValue: boolean | null;
    jsonValue: string | null;
  },
): CrmValue {
  if (column === "numberValue") return row.numberValue;
  if (column === "booleanValue") return row.booleanValue;
  if (column === "jsonValue") {
    if (row.jsonValue === null) return null;
    try {
      return JSON.parse(row.jsonValue) as CrmValue;
    } catch {
      throw new CrmAttributeValueError(
        "crm-attribute-value-unreadable",
        `A stored history value for "${apiSlug}" is not readable JSON. It was written outside the attribute writer.`,
      );
    }
  }
  return row.stringValue;
}
