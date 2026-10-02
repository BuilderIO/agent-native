import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, count, eq, getTableColumns, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  crmScopeResolver,
  recordsInCurrentScope,
} from "../server/lib/crm-query.js";
import { queryFlag } from "./_crm-action-utils.js";
import { decodeCrmCursor, MAX_LIST_LIMIT } from "./_crm-list-utils.js";

export default defineAction({
  description:
    "List the access-scoped CRM lists with their entry counts. A list is a workflow overlay over one object type; its entries and entry attribute values are always local, never provider rows.",
  schema: z.object({
    connectionId: z.string().trim().min(1).max(128).optional(),
    includeArchived: queryFlag.describe(
      "Include archived lists so they can be inspected or restored.",
    ),
    limit: z.coerce.number().int().min(1).max(MAX_LIST_LIMIT).default(50),
    cursor: z
      .string()
      .regex(/^\d+$/)
      .optional()
      .describe("Cursor returned by a previous page."),
  }),
  http: { method: "GET" },
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  run: async (args, ctx?: ActionRunContext) => {
    const db = getDb();
    const offset = decodeCrmCursor(args.cursor);
    const limit = Math.min(args.limit, MAX_LIST_LIMIT);

    const rows = await db
      .select(getTableColumns(schema.crmLists))
      .from(schema.crmLists)
      .innerJoin(
        schema.crmConnections,
        eq(schema.crmLists.connectionId, schema.crmConnections.id),
      )
      .where(
        and(
          ...(args.connectionId
            ? [eq(schema.crmLists.connectionId, args.connectionId)]
            : []),
          ...(args.includeArchived
            ? []
            : [eq(schema.crmLists.archived, false)]),
          accessFilter(schema.crmLists, schema.crmListShares),
          accessFilter(schema.crmConnections, schema.crmConnectionShares),
        ),
      )
      .orderBy(asc(schema.crmLists.position), asc(schema.crmLists.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const page = rows.slice(0, limit);
    const listIds = page.map((list) => list.id);
    // Counts only entries the entries page would return: the record and its
    // connection are visible and the record's stored scope is still current.
    // Grouping by scope keeps the revalidation to one check per distinct
    // scope instead of one per entry.
    const countRows = listIds.length
      ? await db
          .select({
            listId: schema.crmListEntries.listId,
            connectionId: schema.crmRecords.connectionId,
            provider: schema.crmRecords.provider,
            objectType: schema.crmRecords.objectType,
            accessScopeJson: schema.crmRecords.accessScopeJson,
            workspaceConnectionId: schema.crmConnections.workspaceConnectionId,
            entries: count(),
          })
          .from(schema.crmListEntries)
          .innerJoin(
            schema.crmRecords,
            eq(schema.crmRecords.id, schema.crmListEntries.recordId),
          )
          .innerJoin(
            schema.crmConnections,
            eq(schema.crmConnections.id, schema.crmRecords.connectionId),
          )
          .where(
            and(
              inArray(schema.crmListEntries.listId, listIds),
              accessFilter(schema.crmListEntries, schema.crmListEntryShares),
              accessFilter(schema.crmRecords, schema.crmRecordShares),
              accessFilter(schema.crmConnections, schema.crmConnectionShares),
            ),
          )
          .groupBy(
            schema.crmListEntries.listId,
            schema.crmRecords.connectionId,
            schema.crmRecords.provider,
            schema.crmRecords.objectType,
            schema.crmRecords.accessScopeJson,
            schema.crmConnections.workspaceConnectionId,
          )
      : [];
    const entryCounts = new Map<string, number>();
    for (const row of await recordsInCurrentScope(
      countRows,
      crmScopeResolver(ctx),
    )) {
      entryCounts.set(
        row.listId,
        (entryCounts.get(row.listId) ?? 0) + Number(row.entries),
      );
    }

    return {
      lists: page.map((list) => ({
        ...list,
        entryCount: entryCounts.get(list.id) ?? 0,
      })),
      nextCursor: rows.length > limit ? String(offset + limit) : undefined,
      complete: rows.length <= limit,
    };
  },
});
