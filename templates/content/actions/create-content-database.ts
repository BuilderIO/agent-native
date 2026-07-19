import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import {
  accessFilter,
  assertAccess,
  currentAccess,
  ForbiddenError,
  type ShareRole,
} from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseResponse,
  CreateDatabaseRequest,
} from "../shared/api.js";
import { ensureDocumentFilesMembership } from "./_content-files.js";
import { resolveContentSpaceAccess } from "./_content-space-access.js";
import {
  organizationContentSpaceId,
  provisionContentSpaces,
} from "./_content-spaces.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { documentsPositionScope, withPositionLock } from "./_position-utils.js";
import { nanoid, seedDefaultBlocksField } from "./_property-utils.js";

const createContentDatabaseSchema = z.object({
  documentId: z
    .string()
    .optional()
    .describe("Existing document to convert into a database page"),
  spaceId: z
    .string()
    .optional()
    .describe("Content space for a new top-level database"),
  parentId: z
    .string()
    .nullish()
    .describe("Parent document for a new database page"),
  title: z.string().optional().describe("Database title"),
  description: z
    .string()
    .optional()
    .describe("Stable guidance describing what belongs in this database"),
});

export default defineAction({
  description:
    "Create a Notion-style content database, optionally converting an existing document into the database page.",
  schema: createContentDatabaseSchema,
  mcpApp: {
    compactCatalog: true,
    resource: embedApp({
      title: "Open database",
      description: "Open the database page in the Content app.",
      iframeTitle: "Agent-Native Content",
      openLabel: "Open in Content",
      height: 900,
    }),
  },
  run: async (args) => {
    const result = await createContentDatabaseCore(args);
    await writeAppState("refresh-signal", { ts: Date.now() });
    return result;
  },
  link: ({ result }) => {
    const documentId = (result as { database?: { documentId?: string } } | null)
      ?.database?.documentId;
    if (!documentId) return null;
    return {
      url: buildDeepLink({
        app: "content",
        view: "editor",
        params: { documentId },
      }),
      label: "Open database",
      view: "editor",
    };
  },
});

export async function createContentDatabaseCore(
  args: CreateDatabaseRequest,
  options: { db?: any } = {},
): Promise<ContentDatabaseResponse> {
  const db = options.db ?? getDb();
  const resolvedSpaceId = await resolveContentDatabaseSpace(args, db);
  let databaseId: string | null = null;
  if (options.db) {
    databaseId = await createContentDatabaseRecord(args, {
      db,
      spaceId: resolvedSpaceId,
    });
  } else {
    await db.transaction(async (tx: any) => {
      databaseId = await createContentDatabaseRecord(args, {
        db: tx,
        spaceId: resolvedSpaceId,
      });
    });
  }
  if (!databaseId) throw new Error("Content database was not created");
  return getContentDatabaseResponse(databaseId);
}

async function healLegacyDocumentSpace(db: any, resource: any) {
  const provisioned = await provisionContentSpaces(db, resource.ownerEmail);
  const spaceId = resource.orgId
    ? organizationContentSpaceId(resource.orgId)
    : provisioned.personalSpaceId;
  const [space] = await db
    .select({ id: schema.contentSpaces.id })
    .from(schema.contentSpaces)
    .where(eq(schema.contentSpaces.id, spaceId));
  if (!space) {
    throw new Error(`Unable to resolve a Content space for "${resource.id}"`);
  }
  const now = new Date().toISOString();
  await db
    .update(schema.documents)
    .set({ spaceId, updatedAt: now })
    .where(eq(schema.documents.id, resource.id));
  await ensureDocumentFilesMembership(db, resource.id, now);
  return spaceId;
}

export async function resolveContentDatabaseSpace(
  args: CreateDatabaseRequest,
  db: any,
): Promise<string> {
  if (args.documentId) {
    const access = await assertAccess("document", args.documentId, "editor");
    const spaceId =
      (access.resource.spaceId as string | null) ??
      (await healLegacyDocumentSpace(db, access.resource));
    if (args.spaceId && args.spaceId !== spaceId) {
      throw new Error(
        "A converted database must keep its document Content space",
      );
    }
    return spaceId;
  }
  if (args.parentId) {
    const access = await assertAccess("document", args.parentId, "editor");
    const spaceId =
      (access.resource.spaceId as string | null) ??
      (await healLegacyDocumentSpace(db, access.resource));
    if (args.spaceId && args.spaceId !== spaceId) {
      throw new Error("Nested databases must use their parent Content space");
    }
    return spaceId;
  }
  const userEmail = getRequestUserEmail();
  if (!userEmail) throw new Error("no authenticated user");
  const provisioned = await provisionContentSpaces(db, userEmail);
  const spaceId = args.spaceId ?? provisioned.personalSpaceId;
  await resolveContentSpaceAccess(spaceId, "editor");
  return spaceId;
}

async function assertDocumentEditorAccess(db: any, documentId: string) {
  const [document] = await db
    .select()
    .from(schema.documents)
    .where(
      and(
        eq(schema.documents.id, documentId),
        accessFilter(
          schema.documents,
          schema.documentShares,
          currentAccess(),
          "editor",
        ),
      ),
    );
  if (!document) {
    throw new ForbiddenError(`No editor access to document ${documentId}`);
  }
  return document;
}

export async function createContentDatabaseRecord(
  args: CreateDatabaseRequest,
  options: {
    db?: any;
    spaceId?: string;
    resolveSpaceAccess?: typeof resolveContentSpaceAccess;
  } = {},
): Promise<string> {
  const db = options.db ?? getDb();
  const now = new Date().toISOString();
  let title = args.title?.trim() || "";

  let documentId = args.documentId;
  let ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  let orgId = getRequestOrgId() ?? null;
  let spaceId = options.spaceId ?? null;
  let inheritedShares: Array<{
    principalType: "user" | "org";
    principalId: string;
    role: ShareRole;
  }> = [];

  if (documentId) {
    const document = await assertDocumentEditorAccess(db, documentId);
    ownerEmail = document.ownerEmail as string;
    orgId = (document.orgId as string | null) ?? null;
    spaceId = (document.spaceId as string | null) ?? spaceId;
    if (!spaceId) {
      throw new Error(`Document "${documentId}" has no Content space`);
    }
    if (args.spaceId && args.spaceId !== spaceId) {
      throw new Error(
        "A converted database must keep its document Content space",
      );
    }
    title = databaseTitleForPage(title, document.title);

    const [existing] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, documentId));
    if (existing) {
      if (existing.spaceId !== spaceId) {
        await db
          .update(schema.contentDatabases)
          .set({ spaceId, updatedAt: now })
          .where(eq(schema.contentDatabases.id, existing.id));
      }
      await ensureDocumentFilesMembership(db, documentId, now, {
        userEmail: getRequestUserEmail(),
        orgId: orgId ?? undefined,
      });
      return existing.id;
    }

    if (title && title !== document.title && !document.title.trim()) {
      await db
        .update(schema.documents)
        .set({ title, updatedAt: now })
        .where(eq(schema.documents.id, documentId));
    }
    if (args.description !== undefined) {
      await db
        .update(schema.documents)
        .set({ description: args.description.trim(), updatedAt: now })
        .where(eq(schema.documents.id, documentId));
    }
  } else {
    title = databaseTitleForPage(title);
    const parentId = args.parentId || null;
    let visibility: "private" | "org" | "public" = "private";
    let hideFromSearch = 0;

    if (parentId) {
      const parent = await assertDocumentEditorAccess(db, parentId);
      ownerEmail = parent.ownerEmail as string;
      orgId = (parent.orgId as string | null) ?? null;
      spaceId = (parent.spaceId as string | null) ?? spaceId;
      if (!spaceId) {
        throw new Error(`Parent document "${parentId}" has no Content space`);
      }
      if (args.spaceId && args.spaceId !== spaceId) {
        throw new Error("Nested databases must use their parent Content space");
      }
      visibility = parent.visibility ?? "private";
      hideFromSearch = parent.hideFromSearch ?? 0;
      inheritedShares = await db
        .select({
          principalType: schema.documentShares.principalType,
          principalId: schema.documentShares.principalId,
          role: schema.documentShares.role,
        })
        .from(schema.documentShares)
        .where(eq(schema.documentShares.resourceId, parentId));
    } else {
      if (!spaceId) {
        throw new Error(
          "A top-level database requires a resolved Content space",
        );
      }
      const spaceAccess = await (
        options.resolveSpaceAccess ?? resolveContentSpaceAccess
      )(spaceId, "editor", { db });
      if (spaceAccess.space.id !== spaceId) {
        throw new Error("Resolved Content space does not match the request");
      }
      ownerEmail = getRequestUserEmail() ?? ownerEmail;
      orgId = spaceAccess.space.orgId;
      visibility = orgId ? "org" : "private";
    }

    documentId = nanoid();
    // Snapshot as a const so the closure below keeps TypeScript's
    // non-undefined narrowing from the guard above (`let` bindings lose
    // narrowing across a closure boundary).
    const resolvedOwnerEmail = ownerEmail;
    await withPositionLock(
      documentsPositionScope(resolvedOwnerEmail, parentId),
      async () => {
        const [maxPos] = await db
          .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
          .from(schema.documents)
          .where(
            parentId
              ? and(
                  eq(schema.documents.ownerEmail, resolvedOwnerEmail),
                  eq(schema.documents.parentId, parentId),
                )
              : and(
                  eq(schema.documents.ownerEmail, resolvedOwnerEmail),
                  sql`parent_id IS NULL`,
                ),
          );

        await db.insert(schema.documents).values({
          id: documentId!,
          spaceId,
          ownerEmail: resolvedOwnerEmail,
          orgId,
          parentId,
          title,
          content: "",
          description: args.description?.trim() ?? "",
          icon: null,
          position: (maxPos?.max ?? -1) + 1,
          isFavorite: 0,
          hideFromSearch,
          visibility,
          createdAt: now,
          updatedAt: now,
        });
      },
    );

    if (inheritedShares.length > 0) {
      await db.insert(schema.documentShares).values(
        inheritedShares.map((share) => ({
          id: nanoid(),
          resourceId: documentId!,
          principalType: share.principalType,
          principalId: share.principalId,
          role: share.role,
          createdBy: getRequestUserEmail() ?? ownerEmail ?? "",
          createdAt: now,
        })),
      );
    }
  }

  const databaseId = nanoid();
  await db.insert(schema.contentDatabases).values({
    id: databaseId,
    spaceId,
    ownerEmail,
    orgId,
    documentId,
    title,
    createdAt: now,
    updatedAt: now,
  });

  // Every database is seeded with one primary "Content" Blocks field, backed
  // by `documents.content`, so each row's body is a first-class property.
  await seedDefaultBlocksField({ databaseId, ownerEmail, orgId, now, db });
  await ensureDocumentFilesMembership(db, documentId, now, {
    userEmail: getRequestUserEmail(),
    orgId: orgId ?? undefined,
  });

  return databaseId;
}

export function databaseTitleForPage(
  requestedTitle?: string | null,
  pageTitle?: string | null,
) {
  return requestedTitle?.trim() || pageTitle?.trim() || "Untitled database";
}
