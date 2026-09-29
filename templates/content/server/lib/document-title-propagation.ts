import {
  getRequestOrgId,
  getRequestUserEmail,
} from "@agent-native/core/server/request-context";
import { accessFilter } from "@agent-native/core/sharing";
import { and, eq, inArray, or } from "drizzle-orm";

import { listContentOrganizationMemberships } from "../../actions/_content-space-access.js";
import { getDb, schema } from "../db/index.js";

export async function propagateDocumentTitle(args: {
  db: ReturnType<typeof getDb>;
  documentId: string;
  title: string;
  updatedAt: string;
}): Promise<void> {
  const userEmail = getRequestUserEmail();
  const memberships = userEmail
    ? await listContentOrganizationMemberships(userEmail)
    : [];
  const orgIds = new Set([
    ...memberships.map((membership) => membership.orgId),
    ...(getRequestOrgId() ? [getRequestOrgId()!] : []),
  ]);
  const documentEditorAccess = or(
    ...[
      { userEmail: userEmail ?? undefined },
      ...[...orgIds].map((orgId) => ({
        userEmail: userEmail ?? undefined,
        orgId,
      })),
    ].map((context) =>
      accessFilter(schema.documents, schema.documentShares, context, "editor"),
    ),
  )!;
  const [database] = await args.db
    .select({
      id: schema.contentDatabases.id,
      spaceId: schema.contentDatabases.spaceId,
      systemRole: schema.contentDatabases.systemRole,
    })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, args.documentId));
  if (!database) return;

  const title =
    database.systemRole === "files"
      ? args.title.trim() || "Untitled"
      : args.title;
  await args.db
    .update(schema.contentDatabases)
    .set({ title, updatedAt: args.updatedAt })
    .where(eq(schema.contentDatabases.id, database.id));
  if (database.systemRole !== "files" || !database.spaceId) return;

  await args.db
    .update(schema.documents)
    .set({ title, updatedAt: args.updatedAt })
    .where(and(eq(schema.documents.id, args.documentId), documentEditorAccess));
  await args.db
    .update(schema.contentSpaces)
    .set({ name: title, updatedAt: args.updatedAt })
    .where(eq(schema.contentSpaces.id, database.spaceId));
  const catalogReferences = await args.db
    .select({ documentId: schema.contentSpaceCatalogItems.documentId })
    .from(schema.contentSpaceCatalogItems)
    .where(eq(schema.contentSpaceCatalogItems.spaceId, database.spaceId));
  if (catalogReferences.length === 0) return;

  await args.db
    .update(schema.documents)
    .set({ title, updatedAt: args.updatedAt })
    .where(
      and(
        inArray(
          schema.documents.id,
          catalogReferences.map((reference) => reference.documentId),
        ),
        documentEditorAccess,
      ),
    );
}
