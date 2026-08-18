import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { storageColumnFor } from "../shared/crm-attributes.js";
import type { CrmValue } from "../shared/crm-contract.js";
import {
  CrmAttributeValueError,
  loadAttributeOptions,
  toAttributeDefinition,
  type CrmAttributeRow,
} from "./_crm-attribute-utils.js";

const MAX_RECORDS = 200;

interface StoredValueRow {
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
}

/**
 * Decode by the attribute's declared storage column, never by sniffing which
 * column is non-null: a `false` checkbox and an empty text field are otherwise
 * indistinguishable.
 */
function decodeValue(
  attribute: CrmAttributeRow,
  row: StoredValueRow,
): CrmValue {
  const column = storageColumnFor(attribute.attributeType, attribute.multi);
  if (column === "numberValue") return row.numberValue;
  if (column === "booleanValue") return row.booleanValue;
  if (column === "jsonValue") {
    if (row.jsonValue === null) return null;
    try {
      return JSON.parse(row.jsonValue) as CrmValue;
    } catch {
      throw new CrmAttributeValueError(
        "crm-attribute-value-unreadable",
        `Stored value for "${attribute.apiSlug ?? attribute.fieldName}" is not readable JSON. It was written outside the attribute writer.`,
      );
    }
  }
  return row.stringValue;
}

export default defineAction({
  description:
    "Return the current typed attribute values for a bounded set of CRM records, with each value's actor and provenance blob and each record's current revision. This is the value payload behind the record grid: list-crm-records returns row summaries, this returns the cells. Only current values are returned (the bitemporal row whose activeUntil is null); list-entry values are excluded.",
  schema: z.object({
    recordIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(MAX_RECORDS)
      .describe("Local CRM record IDs from list-crm-records."),
    includeArchived: z
      .boolean()
      .default(false)
      .describe("Include values of archived attributes."),
  }),
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const recordIds = [...new Set(args.recordIds)];
    const records = await db
      .select({
        id: schema.crmRecords.id,
        connectionId: schema.crmRecords.connectionId,
        objectType: schema.crmRecords.objectType,
        provider: schema.crmRecords.provider,
        remoteRevision: schema.crmRecords.remoteRevision,
      })
      .from(schema.crmRecords)
      .where(
        and(
          inArray(schema.crmRecords.id, recordIds),
          eq(schema.crmRecords.tombstone, false),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      );
    if (records.length === 0) {
      return { records: [], attributes: [] };
    }

    const objectTypes = [...new Set(records.map((row) => row.objectType))];
    const connectionIds = [...new Set(records.map((row) => row.connectionId))];
    const attributeRows = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.target, "object"),
          inArray(schema.crmFieldPolicies.objectType, objectTypes),
          inArray(schema.crmFieldPolicies.connectionId, connectionIds),
          ...(args.includeArchived
            ? []
            : [eq(schema.crmFieldPolicies.archived, false)]),
          accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
        ),
      );
    const options = await loadAttributeOptions({
      attributeIds: attributeRows.map((row) => row.id),
      includeArchived: args.includeArchived,
    });
    // Keyed by field_name: that is the column the bitemporal writer keys on and
    // the value `api_slug` was seeded from.
    const attributeByKey = new Map(
      attributeRows.map((row) => [
        `${row.connectionId}:${row.objectType}:${row.fieldName}`,
        row,
      ]),
    );

    const valueRows = await db
      .select({
        recordId: schema.crmRecordFields.recordId,
        fieldName: schema.crmRecordFields.fieldName,
        stringValue: schema.crmRecordFields.stringValue,
        numberValue: schema.crmRecordFields.numberValue,
        booleanValue: schema.crmRecordFields.booleanValue,
        jsonValue: schema.crmRecordFields.jsonValue,
        activeFrom: schema.crmRecordFields.activeFrom,
        actorType: schema.crmRecordFields.actorType,
        actorId: schema.crmRecordFields.actorId,
        provenanceJson: schema.crmRecordFields.provenanceJson,
      })
      .from(schema.crmRecordFields)
      .where(
        and(
          inArray(schema.crmRecordFields.recordId, recordIds),
          // A list-entry value lives in this same table; `entry_id IS NULL` is
          // the record-vs-entry discriminator.
          isNull(schema.crmRecordFields.entryId),
          isNull(schema.crmRecordFields.activeUntil),
          accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
        ),
      );

    const recordById = new Map(records.map((row) => [row.id, row]));
    const buckets = new Map<
      string,
      {
        values: Record<string, CrmValue>;
        valuesSince: Record<string, string>;
        provenance: Record<
          string,
          { actorType: string; actorId: string | null; provenanceJson: string }
        >;
      }
    >(
      records.map((row) => [
        row.id,
        { values: {}, valuesSince: {}, provenance: {} },
      ]),
    );

    for (const row of valueRows) {
      const record = recordById.get(row.recordId);
      const bucket = buckets.get(row.recordId);
      if (!record || !bucket) continue;
      const attribute = attributeByKey.get(
        `${record.connectionId}:${record.objectType}:${row.fieldName}`,
      );
      // A value with no surviving attribute definition is not a cell the grid
      // can type; skipping it here is not data loss — the row is still stored.
      if (!attribute) continue;
      const slug = attribute.apiSlug ?? attribute.fieldName;
      bucket.values[slug] = decodeValue(attribute, row);
      bucket.valuesSince[slug] = row.activeFrom;
      bucket.provenance[slug] = {
        actorType: row.actorType,
        actorId: row.actorId,
        provenanceJson: row.provenanceJson,
      };
    }

    return {
      attributes: attributeRows.map((row) =>
        toAttributeDefinition(row, options.get(row.id) ?? []),
      ),
      records: records.map((row) => {
        const bucket = buckets.get(row.id)!;
        return {
          recordId: row.id,
          connectionId: row.connectionId,
          objectType: row.objectType,
          provider: row.provider,
          remoteRevision: row.remoteRevision,
          values: bucket.values,
          valuesSince: bucket.valuesSince,
          provenance: bucket.provenance,
        };
      }),
    };
  },
});
