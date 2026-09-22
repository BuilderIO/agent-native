import { createHash } from "node:crypto";

import { defineAction, fail } from "@agent-native/core/action";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { isEmailDerivedName } from "@agent-native/core/user-profile";
import { getUserProfiles } from "@agent-native/core/user-profile/server";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { ListContentTrashResponse } from "../shared/content-trash.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  contentTrashDateSchema,
  contentTrashPredicates,
  validateContentTrashDateRange,
} from "./_content-trash-query.js";

const inputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(200)
      .optional()
      .describe("Literal title text to find."),
    kind: z
      .enum(["page", "database"])
      .optional()
      .describe("Exact content kind filter."),
    spaceId: z
      .string()
      .max(200)
      .optional()
      .describe("Exact authorized original space ID."),
    parentId: z
      .string()
      .max(200)
      .optional()
      .describe("Exact authorized original parent Page ID."),
    groupId: z
      .string()
      .max(200)
      .optional()
      .describe("Browse members of this deletion group."),
    actor: z
      .string()
      .trim()
      .max(320)
      .optional()
      .describe("Exact deletion actor email."),
    createdBy: z
      .string()
      .trim()
      .max(320)
      .optional()
      .describe("Exact creator email."),
    updatedBy: z
      .string()
      .trim()
      .max(320)
      .optional()
      .describe("Exact last editor email."),
    deletedFrom: contentTrashDateSchema
      .optional()
      .describe("Inclusive deletion-time start."),
    deletedTo: contentTrashDateSchema
      .optional()
      .describe("Inclusive deletion-time end."),
    sort: z
      .enum(["name", "createdAt", "updatedAt", "deletedAt"])
      .default("deletedAt")
      .describe("Stable sort field; defaults to deletedAt."),
    direction: z
      .enum(["asc", "desc"])
      .default("desc")
      .describe("Sort direction; defaults to desc."),
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
      .describe("Maximum results, up to 100."),
  })
  .superRefine(validateContentTrashDateRange);

const cursorSchema = z
  .object({
    version: z.literal(2),
    filter: z.string().regex(/^[a-f0-9]{64}$/),
    value: z.string().min(1).max(500),
    id: z.string().min(1).max(200),
  })
  .strict();

export default defineAction({
  description:
    "Search cursor-paginated authorized Trash items, or browse root groups and their nested members. Returns metadata only.",
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
    const normalizedEmail = email.toLowerCase();
    const filter = createHash("sha256")
      .update(
        JSON.stringify([
          normalizedEmail,
          args.query ?? "",
          args.kind ?? null,
          args.spaceId ?? null,
          args.parentId ?? null,
          args.groupId ?? null,
          args.actor ?? null,
          args.createdBy?.toLowerCase() ?? null,
          args.updatedBy?.toLowerCase() ?? null,
          args.deletedFrom ?? null,
          args.deletedTo ?? null,
          args.sort,
          args.direction,
        ]),
      )
      .digest("hex");
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (args.cursor) {
      let decoded: unknown;
      try {
        decoded = JSON.parse(
          Buffer.from(args.cursor, "base64url").toString("utf8"),
        );
      } catch {
        fail("Invalid Trash cursor", {
          errorCode: "invalid_cursor",
          statusCode: 400,
        });
      }
      const parsed = cursorSchema.safeParse(decoded);
      if (!parsed.success || parsed.data.filter !== filter) {
        fail("Trash cursor does not match these filters", {
          errorCode: "invalid_cursor",
          statusCode: 400,
        });
      }
      cursor = parsed.data;
    }

    const db = getDb();
    const memberships = await listContentOrganizationMemberships(email);
    const doc = schema.documents;
    const database = schema.contentDatabases;
    const host = alias(doc, "trash_host");
    const parent = alias(doc, "trash_parent");
    const root = alias(doc, "trash_root");
    const space = schema.contentSpaces;
    const canonical = sql<string>`(select min(${database.id}) from ${database} where ${database.documentId} = ${doc.id})`;
    const { authority, deletedAt } = contentTrashPredicates(
      doc,
      database,
      accessFilter(doc, schema.documentShares, undefined, "admin"),
      accessFilter(doc, schema.documentShares),
      accessFilter(host, schema.documentShares, undefined, "editor"),
    );
    const originalParent = sql<string>`coalesce(${doc.trashParentId}, ${doc.parentId})`;
    const matchingMode = !!(
      args.query ||
      args.kind ||
      args.spaceId ||
      args.parentId ||
      args.actor ||
      args.createdBy ||
      args.updatedBy ||
      args.deletedFrom ||
      args.deletedTo
    );
    const sortValue =
      args.sort === "name"
        ? sql<string>`lower(${doc.title})`
        : args.sort === "createdAt"
          ? sql<string>`${doc.createdAt}`
          : args.sort === "updatedAt"
            ? sql<string>`${doc.updatedAt}`
            : deletedAt;
    const compare = args.direction === "asc" ? gt : lt;
    const order = args.direction === "asc" ? asc : desc;
    const rows = await db
      .select({
        documentId: doc.id,
        databaseId: database.id,
        title: doc.title,
        createdBy: doc.createdBy,
        updatedBy: doc.updatedBy,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
        trashedAt: deletedAt,
        sortValue,
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
              sql`lower(${space.ownerEmail}) = ${normalizedEmail}`,
            ),
            memberships.length
              ? inArray(
                  space.orgId,
                  memberships.map((item) => item.orgId),
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
            : matchingMode
              ? undefined
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
          args.createdBy
            ? sql`lower(${doc.createdBy}) = ${args.createdBy.toLowerCase()}`
            : undefined,
          args.updatedBy
            ? sql`lower(${doc.updatedBy}) = ${args.updatedBy.toLowerCase()}`
            : undefined,
          args.deletedFrom ? gte(deletedAt, args.deletedFrom) : undefined,
          args.deletedTo ? lte(deletedAt, args.deletedTo) : undefined,
          cursor
            ? or(
                compare(sortValue, cursor.value),
                and(eq(sortValue, cursor.value), compare(doc.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(order(sortValue), order(doc.id))
      .limit(args.limit + 1);
    const page = rows.slice(0, args.limit);
    const last = page[page.length - 1];
    const pageIds = page.map((row) => row.documentId);
    const child = alias(doc, "trash_child");
    const childDatabase = alias(database, "trash_child_database");
    const childHost = alias(doc, "trash_child_host");
    const childCanonical = sql<string>`(select min(${database.id}) from ${database} where ${database.documentId} = ${child.id})`;
    const { authority: childAuthority, deletedAt: childDeletedAt } =
      contentTrashPredicates(
        child,
        childDatabase,
        accessFilter(child, schema.documentShares, undefined, "admin"),
        accessFilter(child, schema.documentShares),
        accessFilter(childHost, schema.documentShares, undefined, "editor"),
      );
    const childRoots = pageIds.length
      ? await db
          .selectDistinct({ rootId: child.trashRootId })
          .from(child)
          .leftJoin(childDatabase, eq(childDatabase.id, childCanonical))
          .leftJoin(childHost, eq(childHost.id, childDatabase.ownerDocumentId))
          .where(
            and(
              inArray(child.trashRootId, pageIds),
              ne(child.id, child.trashRootId),
              isNotNull(childDeletedAt),
              childAuthority,
            ),
          )
      : [];
    const rootsWithAccessibleChildren = new Set(
      childRoots.flatMap(({ rootId }) => (rootId ? [rootId] : [])),
    );
    const actorEmails = page.flatMap((row) =>
      [row.createdBy, row.updatedBy, row.trashedBy].filter(
        (actor): actor is string => actor !== null,
      ),
    );
    const profiles = await getUserProfiles(actorEmails);
    const actorName = (actor: string | null) => {
      if (!actor) return null;
      const name = profiles.get(actor.toLowerCase())?.name;
      return name && !isEmailDerivedName(name, actor) ? name : null;
    };
    return {
      items: page.map(
        ({
          ownerDocumentId,
          currentParentId,
          rawRootId,
          documentTrashedAt,
          databaseDeletedAt,
          sortValue: _sortValue,
          ...row
        }) => ({
          ...row,
          createdByState: row.createdBy === null ? "unresolved" : "known",
          updatedByState: row.updatedBy === null ? "unresolved" : "known",
          trashedByState: row.trashedBy === null ? "unresolved" : "known",
          createdByName: actorName(row.createdBy),
          updatedByName: actorName(row.updatedBy),
          trashedByName: actorName(row.trashedBy),
          kind: row.databaseId === null ? "page" : "database",
          legacyRestoreDatabaseId:
            documentTrashedAt === null &&
            rawRootId === null &&
            databaseDeletedAt !== null
              ? row.databaseId
              : null,
          canRestore:
            (documentTrashedAt !== null && rawRootId === row.documentId) ||
            (documentTrashedAt === null &&
              rawRootId === null &&
              databaseDeletedAt !== null),
          canPermanentlyDelete:
            rawRootId === row.documentId &&
            (row.databaseId === null ||
              ownerDocumentId === null ||
              currentParentId !== ownerDocumentId),
          hasAccessibleTrashedChildren:
            rootsWithAccessibleChildren.has(row.documentId) &&
            rawRootId === row.documentId,
        }),
      ),
      nextCursor:
        rows.length > args.limit && last
          ? Buffer.from(
              JSON.stringify({
                version: 2,
                filter,
                value: last.sortValue,
                id: last.documentId,
              }),
            ).toString("base64url")
          : null,
    };
  },
});
