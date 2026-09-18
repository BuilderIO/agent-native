import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  attributeSummary,
  buildEntryFilter,
  buildEntryOrder,
  CRM_ENTRY_BUILTIN_FIELDS,
  CRM_ENTRY_FILTER_OPERATORS,
  CrmEntryFieldResolver,
  decodeCrmCursor,
  indexAttributes,
  loadCrmEntryValues,
  loadCrmListAttributes,
  MAX_LIST_ENTRY_FILTERS,
  MAX_LIST_ENTRY_LIMIT,
  MAX_LIST_ENTRY_SORTS,
  requireCrmList,
} from "./_crm-list-utils.js";

const filterValueSchema = z.union([
  z.string().max(500),
  z.number(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(500), z.number(), z.boolean()])).max(50),
]);

export default defineAction({
  description:
    "Read a bounded page of entries in a CRM list with each entry's record summary and its own entry attribute values. Filters, sorting, and pagination are applied in SQL, so a filtered page is the real result set and not one page narrowed afterwards. Filter and sort fields are a list attribute's api_slug or one of the built-in fields.",
  schema: z.object({
    listId: z.string().trim().min(1).max(128),
    filters: z
      .array(
        z.object({
          attribute: z
            .string()
            .trim()
            .min(1)
            .max(120)
            .describe(
              `A list attribute api_slug, or one of: ${CRM_ENTRY_BUILTIN_FIELDS.join(", ")}.`,
            ),
          operator: z.enum(CRM_ENTRY_FILTER_OPERATORS),
          value: filterValueSchema.optional(),
        }),
      )
      .max(MAX_LIST_ENTRY_FILTERS)
      .optional(),
    sort: z
      .array(
        z.object({
          attribute: z.string().trim().min(1).max(120),
          direction: z.enum(["asc", "desc"]).default("asc"),
        }),
      )
      .max(MAX_LIST_ENTRY_SORTS)
      .optional(),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_ENTRY_LIMIT).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe("Cursor returned by a previous page."),
  }),
  http: { method: "POST" },
  readOnly: true,
  run: async (args) => {
    const db = getDb();
    const list = await requireCrmList(db, args.listId, "viewer");
    const attributes = await loadCrmListAttributes(db, list.id);
    const bySlug = indexAttributes(attributes);

    const resolver = new CrmEntryFieldResolver(bySlug);
    // Filters and sorts are resolved before the query is built: resolving a
    // field is what registers the LEFT JOIN it needs.
    const conditions: SQL[] = (args.filters ?? []).map((filter) =>
      buildEntryFilter(resolver, filter),
    );
    const order = (args.sort ?? []).flatMap((sort) =>
      buildEntryOrder(resolver, sort),
    );

    const offset = decodeCrmCursor(args.cursor);
    const limit = Math.min(args.limit, MAX_LIST_ENTRY_LIMIT);

    let query = db
      .select({
        entryId: schema.crmListEntries.id,
        position: schema.crmListEntries.position,
        createdAt: schema.crmListEntries.createdAt,
        createdByActorType: schema.crmListEntries.createdByActorType,
        createdByActorId: schema.crmListEntries.createdByActorId,
        recordId: schema.crmRecords.id,
        objectType: schema.crmRecords.objectType,
        kind: schema.crmRecords.kind,
        displayName: schema.crmRecords.displayName,
        primaryEmail: schema.crmRecords.primaryEmail,
        domain: schema.crmRecords.domain,
        recordStage: schema.crmRecords.stage,
        ownerName: schema.crmRecords.ownerName,
        amount: schema.crmRecords.amount,
        currencyCode: schema.crmRecords.currencyCode,
        closeDate: schema.crmRecords.closeDate,
        recordUpdatedAt: schema.crmRecords.updatedAt,
      })
      .from(schema.crmListEntries)
      .innerJoin(
        schema.crmRecords,
        eq(schema.crmRecords.id, schema.crmListEntries.recordId),
      )
      .$dynamic();

    for (const join of resolver.joins) {
      query = query.leftJoin(join.table, join.on);
    }

    const rows = await query
      .where(
        and(
          eq(schema.crmListEntries.listId, list.id),
          ...conditions,
          accessFilter(schema.crmListEntries, schema.crmListEntryShares),
          accessFilter(schema.crmRecords, schema.crmRecordShares),
        ),
      )
      .orderBy(
        ...order,
        asc(schema.crmListEntries.position),
        asc(schema.crmListEntries.createdAt),
        asc(schema.crmListEntries.id),
      )
      .limit(limit + 1)
      .offset(offset);

    const page = rows.slice(0, limit);
    const values = await loadCrmEntryValues(
      db,
      page.map((row) => row.entryId),
      bySlug,
    );

    return {
      list: {
        id: list.id,
        name: list.name,
        apiSlug: list.apiSlug,
        parentObjectType: list.parentObjectType,
        defaultViewId: list.defaultViewId,
        archived: list.archived,
      },
      attributes: attributes.map(attributeSummary),
      entries: page.map((row) => {
        const entryValues = values.get(row.entryId) ?? {
          values: {},
          valuesSince: {},
        };
        return {
          id: row.entryId,
          listId: list.id,
          recordId: row.recordId,
          position: row.position,
          createdAt: row.createdAt,
          createdByActorType: row.createdByActorType,
          createdByActorId: row.createdByActorId,
          record: {
            id: row.recordId,
            objectType: row.objectType,
            kind: row.kind,
            displayName: row.displayName,
            primaryEmail: row.primaryEmail,
            domain: row.domain,
            stage: row.recordStage,
            ownerName: row.ownerName,
            amount: row.amount,
            currencyCode: row.currencyCode,
            closeDate: row.closeDate,
            updatedAt: row.recordUpdatedAt,
          },
          values: entryValues.values,
          valuesSince: entryValues.valuesSince,
        };
      }),
      nextCursor: rows.length > limit ? String(offset + limit) : undefined,
      complete: rows.length <= limit,
    };
  },
});
