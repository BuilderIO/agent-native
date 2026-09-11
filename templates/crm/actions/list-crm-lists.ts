import { defineAction } from "@agent-native/core/action";
import { accessFilter } from "@agent-native/core/sharing";
import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
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
  run: async (args) => {
    const db = getDb();
    const offset = decodeCrmCursor(args.cursor);
    const limit = Math.min(args.limit, MAX_LIST_LIMIT);

    const rows = await db
      .select()
      .from(schema.crmLists)
      .where(
        and(
          ...(args.connectionId
            ? [eq(schema.crmLists.connectionId, args.connectionId)]
            : []),
          ...(args.includeArchived
            ? []
            : [eq(schema.crmLists.archived, false)]),
          accessFilter(schema.crmLists, schema.crmListShares),
        ),
      )
      .orderBy(asc(schema.crmLists.position), asc(schema.crmLists.createdAt))
      .limit(limit + 1)
      .offset(offset);

    const page = rows.slice(0, limit);
    const listIds = page.map((list) => list.id);
    const countRows = listIds.length
      ? await db
          .select({
            listId: schema.crmListEntries.listId,
            entries: count(),
          })
          .from(schema.crmListEntries)
          .where(
            and(
              inArray(schema.crmListEntries.listId, listIds),
              accessFilter(schema.crmListEntries, schema.crmListEntryShares),
            ),
          )
          .groupBy(schema.crmListEntries.listId)
      : [];
    const entryCounts = new Map(
      countRows.map((row) => [row.listId, Number(row.entries)]),
    );

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
