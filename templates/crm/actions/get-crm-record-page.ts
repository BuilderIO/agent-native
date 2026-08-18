/**
 * The typed data the record page needs and no existing action exposes: the
 * object's attribute schema, the CURRENT bitemporal values, the record's list
 * memberships with their entry values, and the upstream deep link.
 *
 * It deliberately does not replace `get-crm-record`. That action is the one
 * that verifies provider read-through permission for a mirrored record, so the
 * page calls both: this one for the typed surface, that one for the verified
 * remote view, evidence, tasks, and relationships.
 */

import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { resolveProviderRecordLinks } from "../server/crm/provider-record-link.js";
import { getDb, schema } from "../server/db/index.js";
import { CrmAttributeValueError } from "../server/lib/record-fields.js";
import { storageColumnFor } from "../shared/crm-attributes.js";
import type {
  CrmAttributeDefinition,
  CrmValue,
} from "../shared/crm-contract.js";
import {
  loadAttributeOptions,
  toAttributeDefinition,
} from "./_crm-attribute-utils.js";
import {
  attributeSummary,
  indexAttributes,
  loadCrmEntryValues,
  loadCrmListAttributes,
} from "./_crm-list-utils.js";

const MAX_ATTRIBUTES = 200;
const MAX_LIST_MEMBERSHIPS = 100;
const MAX_MEMBERSHIP_LISTS = 25;

interface StoredValueRow {
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: string | null;
}

/**
 * Decode using the attribute's declared storage column, never by sniffing which
 * column is non-null — a `false` checkbox and an empty text field are otherwise
 * the same row. Unreadable JSON is a typed failure, not an absent value.
 */
function decodeValue(
  attribute: Pick<
    CrmAttributeDefinition,
    "apiSlug" | "attributeType" | "multi"
  >,
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
        `Stored value for "${attribute.apiSlug}" is not readable JSON. It was written outside the attribute writer.`,
      );
    }
  }
  return row.stringValue;
}

export default defineAction({
  description:
    "Return the typed attribute panel for one CRM record: the object's attribute definitions with their managed options, the record's current attribute values with when and by whom each was last set, every list the record belongs to with that entry's own attribute values, and the upstream provider deep link. Values are the current bitemporal rows only. Use list-crm-record-field-history for how a value changed.",
  schema: z.object({
    recordId: z.string().trim().min(1).max(128),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const [record] = await db
      .select({
        id: schema.crmRecords.id,
        connectionId: schema.crmRecords.connectionId,
        provider: schema.crmRecords.provider,
        objectType: schema.crmRecords.objectType,
        kind: schema.crmRecords.kind,
        displayName: schema.crmRecords.displayName,
        remoteRevision: schema.crmRecords.remoteRevision,
        updatedAt: schema.crmRecords.updatedAt,
      })
      .from(schema.crmRecords)
      .where(
        and(
          eq(schema.crmRecords.id, args.recordId),
          eq(schema.crmRecords.tombstone, false),
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

    const attributeRows = await db
      .select()
      .from(schema.crmFieldPolicies)
      .where(
        and(
          eq(schema.crmFieldPolicies.target, "object"),
          // `object_type` is populated on every row including the ones the
          // provider adapters write; `target_id` is not.
          eq(schema.crmFieldPolicies.objectType, record.objectType),
          eq(schema.crmFieldPolicies.connectionId, record.connectionId),
          eq(schema.crmFieldPolicies.archived, false),
          accessFilter(schema.crmFieldPolicies, schema.crmFieldPolicyShares),
        ),
      )
      .orderBy(
        asc(schema.crmFieldPolicies.position),
        asc(schema.crmFieldPolicies.label),
      )
      .limit(MAX_ATTRIBUTES);

    const options = await loadAttributeOptions({
      attributeIds: attributeRows.map((row) => row.id),
      includeArchived: false,
    });
    const attributes = attributeRows.map((row) =>
      toAttributeDefinition(row, options.get(row.id) ?? []),
    );
    const attributeBySlug = new Map(
      attributes.map((attribute) => [attribute.apiSlug, attribute]),
    );

    const valueRows = await db
      .select({
        fieldName: schema.crmRecordFields.fieldName,
        stringValue: schema.crmRecordFields.stringValue,
        numberValue: schema.crmRecordFields.numberValue,
        booleanValue: schema.crmRecordFields.booleanValue,
        jsonValue: schema.crmRecordFields.jsonValue,
        activeFrom: schema.crmRecordFields.activeFrom,
        actorType: schema.crmRecordFields.actorType,
        actorId: schema.crmRecordFields.actorId,
      })
      .from(schema.crmRecordFields)
      .where(
        and(
          eq(schema.crmRecordFields.recordId, record.id),
          // `record_id` is populated on entry rows too, so the record-vs-entry
          // discriminator is `entry_id IS NULL`.
          isNull(schema.crmRecordFields.entryId),
          isNull(schema.crmRecordFields.activeUntil),
          accessFilter(schema.crmRecordFields, schema.crmRecordFieldShares),
        ),
      )
      .limit(MAX_ATTRIBUTES);

    const values: Record<string, CrmValue> = {};
    const valueMeta: Record<
      string,
      { since: string; actorType: string; actorId: string | null }
    > = {};
    for (const row of valueRows) {
      const attribute = attributeBySlug.get(row.fieldName);
      if (!attribute) continue;
      values[attribute.apiSlug] = decodeValue(attribute, row);
      valueMeta[attribute.apiSlug] = {
        since: row.activeFrom,
        actorType: row.actorType,
        actorId: row.actorId,
      };
    }

    const membershipRows = await db
      .select({
        entryId: schema.crmListEntries.id,
        listId: schema.crmListEntries.listId,
        position: schema.crmListEntries.position,
        createdAt: schema.crmListEntries.createdAt,
        createdByActorType: schema.crmListEntries.createdByActorType,
        createdByActorId: schema.crmListEntries.createdByActorId,
        listName: schema.crmLists.name,
        listApiSlug: schema.crmLists.apiSlug,
        listParentObjectType: schema.crmLists.parentObjectType,
        listArchived: schema.crmLists.archived,
      })
      .from(schema.crmListEntries)
      .innerJoin(
        schema.crmLists,
        eq(schema.crmLists.id, schema.crmListEntries.listId),
      )
      .where(
        and(
          eq(schema.crmListEntries.recordId, record.id),
          eq(schema.crmLists.archived, false),
          accessFilter(schema.crmListEntries, schema.crmListEntryShares),
          accessFilter(schema.crmLists, schema.crmListShares),
        ),
      )
      .orderBy(
        asc(schema.crmLists.position),
        asc(schema.crmLists.name),
        asc(schema.crmListEntries.position),
        asc(schema.crmListEntries.createdAt),
      )
      .limit(MAX_LIST_MEMBERSHIPS);

    const listIds = [...new Set(membershipRows.map((row) => row.listId))].slice(
      0,
      MAX_MEMBERSHIP_LISTS,
    );
    const lists = [];
    for (const listId of listIds) {
      const listRows = membershipRows.filter((row) => row.listId === listId);
      const first = listRows[0]!;
      const listAttributes = await loadCrmListAttributes(db, listId);
      const entryValues = await loadCrmEntryValues(
        db,
        listRows.map((row) => row.entryId),
        indexAttributes(listAttributes),
      );
      lists.push({
        id: listId,
        name: first.listName,
        apiSlug: first.listApiSlug,
        parentObjectType: first.listParentObjectType,
        attributes: listAttributes.map(attributeSummary),
        // A record may hold more than one entry in the same list; each entry is
        // its own row here rather than being collapsed into a membership flag.
        entries: listRows.map((row) => {
          const entry = entryValues.get(row.entryId) ?? {
            values: {},
            valuesSince: {},
          };
          return {
            id: row.entryId,
            listId,
            recordId: record.id,
            position: row.position,
            createdAt: row.createdAt,
            createdByActorType: row.createdByActorType,
            createdByActorId: row.createdByActorId,
            values: entry.values,
            valuesSince: entry.valuesSince,
          };
        }),
      });
    }

    const link = (await resolveProviderRecordLinks([record.id])).get(record.id);

    return {
      record: {
        id: record.id,
        connectionId: record.connectionId,
        provider: record.provider,
        objectType: record.objectType,
        kind: record.kind,
        displayName: record.displayName,
        remoteRevision: record.remoteRevision,
        updatedAt: record.updatedAt,
      },
      attributes,
      values,
      valueMeta,
      lists,
      listMembershipsTruncated:
        membershipRows.length >= MAX_LIST_MEMBERSHIPS ||
        new Set(membershipRows.map((row) => row.listId)).size > listIds.length,
      // Absent link and unavailable link are different states: a native record
      // has no upstream record at all, and both fields stay null for it.
      recordUrl: link?.available ? link.url : null,
      recordUrlUnavailableReason: link && !link.available ? link.reason : null,
    };
  },
});
