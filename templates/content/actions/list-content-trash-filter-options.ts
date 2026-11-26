import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import { and, asc, eq, isNotNull, sql, type SQLWrapper } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ContentTrashFilterOptionsResponse } from "../shared/content-trash.js";
import { contentTrashPredicates } from "./_content-trash-query.js";

function containsText(column: SQLWrapper, query: string | undefined) {
  if (!query) return undefined;
  return sql`lower(${column}) like ${`%${query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`;
}

export default defineAction({
  description:
    "List the people (creators, last editors and deleters) and original parent locations across the signed-in user's authorized Trash, for the Trash page's filter pickers.",
  mcpTool: false,
  readOnly: true,
  http: { method: "GET" },
  schema: z.object({
    query: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Literal text an email, name or location title contains."),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(500)
      .default(500)
      .describe("Maximum people and maximum locations, up to 500 each."),
  }),
  outputSchema: z.object({
    people: z.array(
      z.object({ email: z.string(), name: z.string().nullable() }),
    ),
    locations: z.array(z.object({ id: z.string(), title: z.string() })),
    peopleComplete: z.boolean(),
    locationsComplete: z.boolean(),
  }),
  run: async (
    args,
  ): Promise<
    ContentTrashFilterOptionsResponse & {
      peopleComplete: boolean;
      locationsComplete: boolean;
    }
  > => {
    const email = getRequestUserEmail();
    if (!email)
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    const { limit } = args;
    const db = getDb();
    const doc = schema.documents;
    const database = schema.contentDatabases;
    const host = alias(doc, "trash_host");
    const parent = alias(doc, "trash_parent");
    const canonical = sql<string>`(select min(${database.id}) from ${database} where ${database.documentId} = ${doc.id})`;
    const { authority, deletedAt } = contentTrashPredicates(
      doc,
      database,
      accessFilter(doc, schema.documentShares, undefined, "admin"),
      accessFilter(doc, schema.documentShares),
      accessFilter(host, schema.documentShares, undefined, "editor"),
    );
    const visibleTrash = and(isNotNull(deletedAt), authority);
    const actors = (
      column:
        | typeof doc.createdBy
        | typeof doc.updatedBy
        | typeof doc.trashedBy,
    ) =>
      db
        .selectDistinct({ email: sql<string>`${column}` })
        .from(doc)
        .leftJoin(database, eq(database.id, canonical))
        .leftJoin(host, eq(host.id, database.ownerDocumentId))
        .where(
          and(
            visibleTrash,
            isNotNull(column),
            containsText(column, args.query),
          ),
        )
        .orderBy(asc(column))
        .limit(limit + 1);
    const [created, updated, trashed, locationRows] = await Promise.all([
      actors(doc.createdBy),
      actors(doc.updatedBy),
      actors(doc.trashedBy),
      db
        .selectDistinct({ id: parent.id, title: parent.title })
        .from(doc)
        .leftJoin(database, eq(database.id, canonical))
        .leftJoin(host, eq(host.id, database.ownerDocumentId))
        .innerJoin(
          parent,
          and(
            eq(parent.id, sql`coalesce(${doc.trashParentId}, ${doc.parentId})`),
            accessFilter(parent, schema.documentShares),
          ),
        )
        .where(and(visibleTrash, containsText(parent.title, args.query)))
        .orderBy(asc(parent.title), asc(parent.id))
        .limit(limit + 1),
    ]);
    const actorRows = [created, updated, trashed];
    const emails = [
      ...new Set(actorRows.flatMap((rows) => rows.map((row) => row.email))),
    ].sort();
    const people = emails.slice(0, limit);
    const profiles = await getUserProfiles(people);
    return {
      people: people.map((actor) => {
        const name = profiles.get(actor.toLowerCase())?.name;
        return {
          email: actor,
          name: name && !isEmailDerivedName(name, actor) ? name : null,
        };
      }),
      locations: locationRows.slice(0, limit),
      peopleComplete:
        emails.length <= limit &&
        actorRows.every((rows) => rows.length <= limit),
      locationsComplete: locationRows.length <= limit,
    };
  },
});
