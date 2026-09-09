import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import {
  and,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ListContentTrashResponse } from "../shared/content-trash.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";

const inputSchema = z.object({
  query: z
    .string()
    .trim()
    .max(200)
    .optional()
    .describe("Literal title text to find."),
  kind: z
    .enum(["page", "database"])
    .optional()
    .describe("Restrict results to Pages or Databases."),
  spaceId: z
    .string()
    .max(200)
    .optional()
    .describe("Authorized original space ID."),
  parentId: z
    .string()
    .max(200)
    .optional()
    .describe("Authorized original parent Page ID."),
  groupId: z
    .string()
    .max(200)
    .optional()
    .describe(
      "Browse authorized members of this deletion group instead of roots.",
    ),
  actor: z
    .string()
    .trim()
    .max(320)
    .optional()
    .describe(
      "Exact deletion actor email; historical unknown actors do not match.",
    ),
  cursor: z
    .string()
    .max(2000)
    .optional()
    .describe("Continuation cursor from the same filters."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100)
    .default(50)
    .describe("Maximum number of results, up to 100."),
});

const cursorSchema = z
  .object({
    version: z.literal(1),
    filter: z.string().regex(/^[a-f0-9]{64}$/),
    time: z
      .string()
      .max(64)
      .refine((value) => Number.isFinite(Date.parse(value))),
    id: z.string().min(1).max(200),
  })
  .strict();

export default defineAction({
  description:
    "Search a bounded, access-scoped Trash list of Pages and Databases, or browse a deletion group. Location metadata is returned only when currently authorized. No page bodies or inaccessible counts are returned.",
  schema: inputSchema,
  http: { method: "GET" },
  readOnly: true,
  run: async (args): Promise<ListContentTrashResponse> => {
    const email = getRequestUserEmail();
    if (!email)
      fail("Authentication required", {
        errorCode: "unauthorized",
        statusCode: 401,
      });
    const filter = createHash("sha256")
      .update(
        JSON.stringify([
          email.toLowerCase(),
          args.query ?? "",
          args.kind ?? null,
          args.spaceId ?? null,
          args.parentId ?? null,
          args.groupId ?? null,
          args.actor ?? null,
        ]),
      )
      .digest("hex");
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (args.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(args.cursor, "base64url").toString("utf8")),
        );
      } catch {
        fail("Invalid Trash cursor", {
          errorCode: "invalid_cursor",
          statusCode: 400,
        });
      }
      if (cursor.filter !== filter)
        fail("Trash cursor does not match these filters", {
          errorCode: "invalid_cursor",
          statusCode: 400,
        });
    }
    const db = getDb();
    const memberships = await listContentOrganizationMemberships(email);
    const doc = schema.documents;
    const database = schema.contentDatabases;
    const host = alias(doc, "trash_host");
    const parent = alias(doc, "trash_parent");
    const root = alias(doc, "trash_root");
    const space = schema.contentSpaces;
    // Legacy data can contain multiple database records for one backing Page.
    const canonical = sql<string>`(select min(${database.id}) from ${database} where ${database.documentId} = ${doc.id})`;
    const blockOwned = and(
      isNotNull(database.ownerDocumentId),
      eq(doc.parentId, database.ownerDocumentId),
    );
    const notBlockOwned = or(
      isNull(database.ownerDocumentId),
      isNull(doc.parentId),
      ne(doc.parentId, database.ownerDocumentId),
    );
    const authority = or(
      and(
        or(isNull(database.id), notBlockOwned),
        accessFilter(doc, schema.documentShares, undefined, "admin"),
      ),
      and(
        isNotNull(database.id),
        blockOwned,
        accessFilter(doc, schema.documentShares),
        accessFilter(host, schema.documentShares, undefined, "editor"),
      ),
    );
    const deletedAt = sql<string>`coalesce(${doc.trashedAt}, ${database.deletedAt})`;
    const originalParent = sql<string>`coalesce(${doc.trashParentId}, ${doc.parentId})`;
    const rows = await db
      .select({
        documentId: doc.id,
        databaseId: database.id,
        title: doc.title,
        trashedAt: deletedAt,
        trashedBy: doc.trashedBy,
        trashOrigin: doc.trashOrigin,
        trashRootId: root.id,
        parentId: parent.id,
        parentTitle: parent.title,
        spaceId: space.id,
        spaceName: space.name,
        ownerDocumentId: database.ownerDocumentId,
        currentParentId: doc.parentId,
        rawRootId: doc.trashRootId,
        documentTrashedAt: doc.trashedAt,
        databaseDeletedAt: database.deletedAt,
      })
      .from(doc)
      .leftJoin(database, eq(database.id, canonical))
      .leftJoin(host, eq(host.id, database.ownerDocumentId))
      .leftJoin(
        parent,
        and(
          eq(parent.id, originalParent),
          accessFilter(parent, schema.documentShares),
        ),
      )
      .leftJoin(
        root,
        and(
          eq(root.id, doc.trashRootId),
          accessFilter(root, schema.documentShares),
        ),
      )
      .leftJoin(
        space,
        and(
          eq(space.id, doc.spaceId),
          isNull(space.archivedAt),
          or(
            and(
              isNull(space.orgId),
              sql`lower(${space.ownerEmail}) = ${email.toLowerCase()}`,
            ),
            memberships.length
              ? inArray(
                  space.orgId,
                  memberships.map((membership) => membership.orgId),
                )
              : sql`false`,
          ),
        ),
      )
      .where(
        and(
          isNotNull(deletedAt),
          authority,
          args.groupId
            ? and(eq(doc.trashRootId, args.groupId), isNotNull(root.id))
            : or(
                eq(doc.trashRootId, doc.id),
                and(isNull(doc.trashRootId), isNotNull(database.deletedAt)),
              ),
          args.query
            ? sql`lower(${doc.title}) like ${`%${args.query.toLowerCase().replace(/[\\%_]/g, "\\$&")}%`} escape '\\'`
            : undefined,
          args.kind === "page"
            ? isNull(database.id)
            : args.kind === "database"
              ? isNotNull(database.id)
              : undefined,
          args.spaceId ? eq(space.id, args.spaceId) : undefined,
          args.parentId ? eq(parent.id, args.parentId) : undefined,
          args.actor ? eq(doc.trashedBy, args.actor) : undefined,
          cursor
            ? or(
                lt(deletedAt, cursor.time),
                and(eq(deletedAt, cursor.time), lt(doc.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(deletedAt), desc(doc.id))
      .limit(args.limit + 1);
    const page = rows.slice(0, args.limit);
    const last = page[page.length - 1];
    return {
      items: page.map(
        ({
          ownerDocumentId,
          currentParentId,
          rawRootId,
          documentTrashedAt,
          databaseDeletedAt,
          ...row
        }) => ({
          ...row,
          kind: row.databaseId === null ? "page" : "database",
          legacyRestoreDatabaseId:
            documentTrashedAt === null &&
            rawRootId === null &&
            databaseDeletedAt !== null
              ? row.databaseId
              : null,
          canRestore:
            (documentTrashedAt !== null && rawRootId !== null) ||
            (documentTrashedAt === null &&
              rawRootId === null &&
              databaseDeletedAt !== null),
          canPermanentlyDelete:
            rawRootId !== null &&
            (row.databaseId === null ||
              ownerDocumentId === null ||
              currentParentId !== ownerDocumentId),
        }),
      ),
      nextCursor:
        rows.length > args.limit && last
          ? Buffer.from(
              JSON.stringify({
                version: 1,
                filter,
                time: last.trashedAt,
                id: last.documentId,
              }),
            ).toString("base64url")
          : null,
    };
  },
});
