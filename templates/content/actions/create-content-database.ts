import { defineAction, embedApp } from "@agent-native/core";
import { writeAppState } from "@agent-native/core/application-state";
import { buildDeepLink } from "@agent-native/core/server";
import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { assertAccess, type ShareRole } from "@agent-native/core/sharing";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type {
  ContentDatabaseResponse,
  CreateDatabaseRequest,
} from "../shared/api.js";
import { getContentDatabaseResponse } from "./_database-utils.js";
import { nanoid, seedDefaultBlocksField } from "./_property-utils.js";

const createContentDatabaseSchema = z.object({
  documentId: z
    .string()
    .optional()
    .describe("Existing document to convert into a database page"),
  parentId: z
    .string()
    .nullish()
    .describe("Parent document for a new database page"),
  title: z.string().optional().describe("Database title"),
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
  const databaseId = await createContentDatabaseRecord(args, options);
  return getContentDatabaseResponse(databaseId);
}

export async function createContentDatabaseRecord(
  args: CreateDatabaseRequest,
  options: { db?: any } = {},
): Promise<string> {
  const db = options.db ?? getDb();
  const now = new Date().toISOString();
  let title = args.title?.trim() || "";

  let documentId = args.documentId;
  let ownerEmail = getRequestUserEmail();
  if (!ownerEmail) throw new Error("no authenticated user");
  let orgId = getRequestOrgId() ?? null;
  let inheritedShares: Array<{
    principalType: "user" | "org";
    principalId: string;
    role: ShareRole;
  }> = [];

  if (documentId) {
    const access = await assertAccess("document", documentId, "editor");
    const document = access.resource;
    ownerEmail = document.ownerEmail as string;
    orgId = (document.orgId as string | null) ?? null;
    title = databaseTitleForPage(title, document.title);

    const [existing] = await db
      .select()
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, documentId));
    if (existing) return existing.id;

    if (title && title !== document.title && !document.title.trim()) {
      await db
        .update(schema.documents)
        .set({ title, updatedAt: now })
        .where(eq(schema.documents.id, documentId));
    }
  } else {
    title = databaseTitleForPage(title);
    const parentId = args.parentId || null;
    let visibility: "private" | "org" | "public" = "private";
    let hideFromSearch = 0;

    if (parentId) {
      const parentAccess = await assertAccess("document", parentId, "editor");
      const parent = parentAccess.resource;
      ownerEmail = parent.ownerEmail as string;
      orgId = (parent.orgId as string | null) ?? null;
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
    }

    const [maxPos] = await db
      .select({ max: sql<number>`COALESCE(MAX(position), -1)` })
      .from(schema.documents)
      .where(
        parentId
          ? and(
              eq(schema.documents.ownerEmail, ownerEmail),
              eq(schema.documents.parentId, parentId),
            )
          : and(
              eq(schema.documents.ownerEmail, ownerEmail),
              sql`parent_id IS NULL`,
            ),
      );

    documentId = nanoid();
    await db.insert(schema.documents).values({
      id: documentId,
      ownerEmail,
      orgId,
      parentId,
      title,
      content: "",
      icon: null,
      position: (maxPos?.max ?? -1) + 1,
      isFavorite: 0,
      hideFromSearch,
      visibility,
      createdAt: now,
      updatedAt: now,
    });

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

  return databaseId;
}

export function databaseTitleForPage(
  requestedTitle?: string | null,
  pageTitle?: string | null,
) {
  return requestedTitle?.trim() || pageTitle?.trim() || "Untitled database";
}
