import { defineAction, fail } from "@agent-native/core/action";
import { roleSatisfies } from "@agent-native/core/sharing";
import { and, asc, eq, gt, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { resolveDocumentAccess } from "./_document-access.js";

function unavailable(): never {
  return fail("Document unavailable", {
    errorCode: "not_found",
    statusCode: 404,
  });
}

export async function readTrashedDocument(args: {
  documentId: string;
  databaseId?: string;
  databaseDocumentId?: string;
  commentsCursor?: string;
}) {
  const access = await resolveDocumentAccess(args.documentId);
  if (!access) unavailable();
  const doc = access.resource;
  let commentsCursor: { createdAt: string; id: string } | undefined;
  if (args.commentsCursor) {
    try {
      commentsCursor = z
        .object({ createdAt: z.string().min(1), id: z.string().min(1) })
        .parse(
          JSON.parse(
            Buffer.from(args.commentsCursor, "base64url").toString("utf8"),
          ),
        );
    } catch {
      fail("Invalid comments cursor", {
        errorCode: "invalid_cursor",
        statusCode: 400,
      });
    }
  }
  const db = getDb();
  const [ownDatabase] = await db
    .select()
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, doc.id))
    .orderBy(asc(schema.contentDatabases.id))
    .limit(1);
  if (!doc.trashedAt && !ownDatabase?.deletedAt) unavailable();
  if (args.databaseDocumentId && !args.databaseId) unavailable();

  const blockOwned =
    !!ownDatabase?.ownerDocumentId &&
    doc.parentId === ownDatabase.ownerDocumentId;
  const hostAccess = blockOwned
    ? await resolveDocumentAccess(ownDatabase.ownerDocumentId!)
    : null;
  const recoverableGroup = !!doc.trashedAt && !!doc.trashRootId;
  const restoreAuthority = blockOwned
    ? !!hostAccess && roleSatisfies(hostAccess.role, "editor")
    : roleSatisfies(access.role, "admin");
  const legacyRestoreDatabaseId =
    restoreAuthority &&
    !doc.trashedAt &&
    !doc.trashRootId &&
    ownDatabase?.deletedAt
      ? ownDatabase.id
      : null;
  const canRestore =
    (recoverableGroup && restoreAuthority) || legacyRestoreDatabaseId !== null;
  const canPermanentlyDelete =
    recoverableGroup && !blockOwned && roleSatisfies(access.role, "admin");

  let database = ownDatabase;
  if (args.databaseId) {
    const [requested] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.id, args.databaseId))
      .limit(1);
    if (!requested || !(await resolveDocumentAccess(requested.documentId)))
      unavailable();
    if (
      args.databaseDocumentId &&
      args.databaseDocumentId !== requested.documentId
    )
      unavailable();
    if (requested.documentId !== doc.id) {
      const [membership] = await db
        .select({ id: schema.contentDatabaseItems.id })
        .from(schema.contentDatabaseItems)
        .where(
          and(
            eq(schema.contentDatabaseItems.databaseId, requested.id),
            eq(schema.contentDatabaseItems.documentId, doc.id),
          ),
        )
        .limit(1);
      if (!membership) unavailable();
    }
    database = requested;
  }

  const properties: {
    id: string;
    name: string;
    type: string;
    value: unknown;
    available: boolean;
  }[] = [];
  if (database) {
    const definitions = await db
      .select()
      .from(schema.documentPropertyDefinitions)
      .where(eq(schema.documentPropertyDefinitions.databaseId, database.id))
      .orderBy(asc(schema.documentPropertyDefinitions.position));
    const values = await db
      .select()
      .from(schema.documentPropertyValues)
      .where(
        and(
          eq(schema.documentPropertyValues.documentId, doc.id),
          eq(schema.documentPropertyValues.ownerEmail, doc.ownerEmail),
        ),
      );
    const blocks = await db
      .select()
      .from(schema.documentBlockFieldContents)
      .where(
        and(
          eq(schema.documentBlockFieldContents.documentId, doc.id),
          eq(schema.documentBlockFieldContents.ownerEmail, doc.ownerEmail),
        ),
      );
    for (const definition of definitions) {
      const stored = values.find((value) => value.propertyId === definition.id);
      let value: unknown = stored ? JSON.parse(stored.valueJson) : null;
      const available =
        definition.type !== "formula" && definition.type !== "rollup";
      if (!available) value = null;
      if (definition.type === "relation") {
        const parsed = z
          .union([z.string(), z.array(z.string()), z.null()])
          .safeParse(value);
        if (!parsed.success)
          fail("Stored relationship is unreadable", {
            errorCode: "invalid_stored_relationship",
            statusCode: 409,
          });
        const ids =
          typeof parsed.data === "string" ? [parsed.data] : (parsed.data ?? []);
        value = [];
        for (const id of ids) {
          if (typeof id === "string" && (await resolveDocumentAccess(id)))
            (value as string[]).push(id);
        }
      }
      if (definition.type === "blocks")
        value =
          database.primaryBlocksPropertyId === definition.id
            ? doc.content
            : (blocks.find((block) => block.propertyId === definition.id)
                ?.content ?? null);
      properties.push({
        id: definition.id,
        name: definition.name,
        type: definition.type,
        value,
        available,
      });
    }
  }

  const comments = await db
    .select({
      id: schema.documentComments.id,
      content: schema.documentComments.content,
      quotedText: schema.documentComments.quotedText,
      authorName: schema.documentComments.authorName,
      authorEmail: schema.documentComments.authorEmail,
      createdAt: schema.documentComments.createdAt,
      resolved: schema.documentComments.resolved,
    })
    .from(schema.documentComments)
    .where(
      and(
        eq(schema.documentComments.documentId, doc.id),
        eq(schema.documentComments.ownerEmail, doc.ownerEmail),
        commentsCursor
          ? or(
              gt(schema.documentComments.createdAt, commentsCursor.createdAt),
              and(
                eq(schema.documentComments.createdAt, commentsCursor.createdAt),
                gt(schema.documentComments.id, commentsCursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(
      asc(schema.documentComments.createdAt),
      asc(schema.documentComments.id),
    )
    .limit(101);
  return {
    id: doc.id,
    title: doc.title,
    content: doc.content,
    description: doc.description,
    trashedAt: doc.trashedAt ?? ownDatabase?.deletedAt ?? null,
    kind: ownDatabase ? ("database" as const) : ("page" as const),
    accessRole: access.role,
    canRestore,
    canPermanentlyDelete,
    legacyRestoreDatabaseId,
    trashedBy: doc.trashedBy ?? null,
    trashOrigin: doc.trashOrigin ?? null,
    database: database
      ? {
          id: database.id,
          documentId: database.documentId,
          title: database.title,
        }
      : null,
    properties,
    comments: comments.slice(0, 100),
    hasMoreComments: comments.length > 100,
    nextCommentsCursor:
      comments.length > 100
        ? Buffer.from(
            JSON.stringify({
              createdAt: comments[99].createdAt,
              id: comments[99].id,
            }),
          ).toString("base64url")
        : null,
  };
}

export type TrashedDocumentPreview = Awaited<
  ReturnType<typeof readTrashedDocument>
>;

export default defineAction({
  description:
    "Read an authorized trashed Page or Database without editing, hydrating sources, or joining collaboration. Optional database context requires independent access. Returns stored properties and a cursor-paginated page of 100 comments; use the existing document History actions for versions. Excludes computed formulas/rollups.",
  schema: z.object({
    documentId: z
      .string()
      .min(1)
      .describe("Stable ID of the trashed Page or Database backing Page."),
    databaseId: z
      .string()
      .optional()
      .describe("Exact authorized database for membership-local properties."),
    databaseDocumentId: z
      .string()
      .optional()
      .describe("Backing Page ID matching databaseId, when provided."),
    commentsCursor: z
      .string()
      .optional()
      .describe("Opaque nextCommentsCursor from the previous comment page."),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: readTrashedDocument,
});
