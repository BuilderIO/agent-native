import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  isSafeCrmMutationFields,
  MAX_CRM_FIELDS_PER_MUTATION,
  requireCrmScope,
} from "./_crm-action-utils.js";
import {
  CrmListError,
  crmActorFrom,
  indexAttributes,
  initialCrmEntryValues,
  loadCrmListAttributes,
  requireCrmList,
  writeCrmListEntryValues,
} from "./_crm-list-utils.js";

export const listEntryValuesSchema = z
  .record(z.string().trim().min(1).max(120), z.unknown())
  .refine(
    (values) => Object.keys(values).length <= MAX_CRM_FIELDS_PER_MUTATION,
    `Provide at most ${MAX_CRM_FIELDS_PER_MUTATION} entry attributes.`,
  )
  .refine(
    isSafeCrmMutationFields,
    "CRM entry values cannot contain media, transcripts, data URLs, base64, or oversized JSON.",
  );

export default defineAction({
  description:
    "Add a record to a CRM list as a new entry, with optional starting values for the list's own entry attributes. Any list attribute you do not supply is INITIALIZED from the record's own attribute of the same slug and type — a one-time copy at insert, reported in initialValues, so a new board is populated. It is a copy and not a link: the entry never re-reads the record and editing the entry never writes the record. A record may hold more than one entry in the same list — two open deals for one company are two entries — so this never de-duplicates; it returns existingEntryIds for the caller to decide. The record's objectType must match the list's parentObjectType. The entry is local-authoritative even when the record mirrors HubSpot or Salesforce.",
  schema: z.object({
    listId: z.string().trim().min(1).max(128),
    recordId: z.string().trim().min(1).max(128),
    values: listEntryValuesSchema.optional(),
    position: z.number().int().min(0).max(100_000).optional(),
  }),
  audit: {
    target: (_args, result) => {
      const entry = result as {
        entryId: string;
        ownerEmail: string;
        orgId: string | null;
        visibility: "private" | "org";
      };
      return {
        type: "crm-list-entry",
        id: entry.entryId,
        ownerEmail: entry.ownerEmail,
        orgId: entry.orgId,
        visibility: entry.visibility,
      };
    },
    summary: (args) =>
      `Added CRM record ${args.recordId} to list ${args.listId}`,
    recordInputs: false,
  },
  run: async (args, ctx?: ActionRunContext) => {
    const ownership = requireCrmScope(ctx);
    const db = getDb();
    const list = await requireCrmList(db, args.listId, "editor");

    const [record] = await db
      .select({
        id: schema.crmRecords.id,
        objectType: schema.crmRecords.objectType,
        displayName: schema.crmRecords.displayName,
        connectionId: schema.crmRecords.connectionId,
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
      throw new CrmListError(
        "crm-record-not-found",
        `CRM record "${args.recordId}" was not found or is not visible to you.`,
      );
    }
    if (record.objectType !== list.parentObjectType) {
      throw new CrmListError(
        "crm-list-object-type-mismatch",
        `List "${list.name}" holds ${list.parentObjectType}; record ${record.id} is ${record.objectType}.`,
      );
    }

    const existing = await db
      .select({ id: schema.crmListEntries.id })
      .from(schema.crmListEntries)
      .where(
        and(
          eq(schema.crmListEntries.listId, list.id),
          eq(schema.crmListEntries.recordId, record.id),
          accessFilter(schema.crmListEntries, schema.crmListEntryShares),
        ),
      )
      .limit(50);

    const attributes = indexAttributes(
      await loadCrmListAttributes(db, list.id),
    );
    const [last] = await db
      .select({ position: schema.crmListEntries.position })
      .from(schema.crmListEntries)
      .where(
        and(
          eq(schema.crmListEntries.listId, list.id),
          accessFilter(schema.crmListEntries, schema.crmListEntryShares),
        ),
      )
      .orderBy(desc(schema.crmListEntries.position))
      .limit(1);

    // The entry's first values, copied once from the record. A value the caller
    // supplied is left alone — including an explicit null, which is the caller
    // saying "start this one empty".
    const initial = await initialCrmEntryValues({
      db,
      connectionId: record.connectionId,
      record,
      attributes,
      supplied: new Set(Object.keys(args.values ?? {})),
    });
    const values = { ...initial.values, ...(args.values ?? {}) };

    const entryId = crypto.randomUUID();
    const actor = crmActorFrom(ctx);
    const now = new Date().toISOString();

    // One transaction so a rejected value (an unknown status option, say) can
    // never leave a half-populated entry behind.
    const writes = await db.transaction(async (tx) => {
      await tx.insert(schema.crmListEntries).values({
        id: entryId,
        listId: list.id,
        recordId: record.id,
        position: args.position ?? (last ? last.position + 1 : 0),
        createdByActorType: actor.type,
        createdByActorId: actor.id,
        ...ownership,
        createdAt: now,
        updatedAt: now,
      });
      return writeCrmListEntryValues({
        db: tx,
        recordId: record.id,
        entryId,
        attributes,
        values,
        actor,
        ownership,
        now,
      });
    });

    return {
      entryId,
      listId: list.id,
      recordId: record.id,
      /**
       * What the entry's values were initialized from. An `applied: false` row
       * is a value the record held that this list cannot represent — reported,
       * never dropped silently, because an unexplained empty card is exactly
       * how a board looks broken.
       */
      initialValues: initial.initialValues,
      /**
       * Entries this record already had in this list. Non-empty is normal, not
       * an error — the caller decides whether a second entry was intended.
       */
      existingEntryIds: existing.map((entry) => entry.id),
      values: writes,
      ...ownership,
    };
  },
});
