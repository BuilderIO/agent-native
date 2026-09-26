import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  crmScopeResolver,
  recordsInCurrentScope,
} from "../server/lib/crm-query.js";
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

// ponytail: bounds the reads per call when most rows are withheld; the page
// comes back short with a cursor instead of scanning the whole list.
const MAX_SCOPE_FILL_BATCHES = 5;

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
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args, ctx?: ActionRunContext) => {
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

    const selectEntries = (at: number, size: number) => {
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
          connectionId: schema.crmRecords.connectionId,
          provider: schema.crmRecords.provider,
          accessScopeJson: schema.crmRecords.accessScopeJson,
          workspaceConnectionId: schema.crmConnections.workspaceConnectionId,
        })
        .from(schema.crmListEntries)
        .innerJoin(
          schema.crmRecords,
          eq(schema.crmRecords.id, schema.crmListEntries.recordId),
        )
        .innerJoin(
          schema.crmConnections,
          eq(schema.crmRecords.connectionId, schema.crmConnections.id),
        )
        .$dynamic();
      for (const join of resolver.joins) {
        query = query.leftJoin(join.table, join.on);
      }
      return query
        .where(
          and(
            eq(schema.crmListEntries.listId, list.id),
            ...conditions,
            accessFilter(schema.crmListEntries, schema.crmListEntryShares),
            accessFilter(schema.crmRecords, schema.crmRecordShares),
            accessFilter(schema.crmConnections, schema.crmConnectionShares),
          ),
        )
        .orderBy(
          ...order,
          asc(schema.crmListEntries.position),
          asc(schema.crmListEntries.createdAt),
          asc(schema.crmListEntries.id),
        )
        .limit(size)
        .offset(at);
    };

    // Entries whose record is out of the current provider scope are dropped
    // after SQL, so keep reading until the page is full: a short page would
    // hide visible entries behind withheld ones, and the cursor never moves
    // past a row that was not returned.
    const scopeResolver = crmScopeResolver(ctx);
    const kept: Array<{
      row: Awaited<ReturnType<typeof selectEntries>>[number];
      at: number;
    }> = [];
    let scanned = offset;
    let exhausted = false;
    for (
      let batch = 0;
      batch < MAX_SCOPE_FILL_BATCHES && kept.length <= limit && !exhausted;
      batch++
    ) {
      const rows = await selectEntries(scanned, limit + 1);
      exhausted = rows.length < limit + 1;
      const inScope = new Set(await recordsInCurrentScope(rows, scopeResolver));
      rows.forEach((row, index) => {
        if (inScope.has(row)) kept.push({ row, at: scanned + index });
      });
      scanned += rows.length;
    }
    const page = kept.slice(0, limit).map((entry) => entry.row);
    const nextAt =
      kept.length > limit ? kept[limit]!.at : exhausted ? undefined : scanned;
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
      nextCursor: nextAt === undefined ? undefined : String(nextAt),
      complete: nextAt === undefined,
    };
  },
});
