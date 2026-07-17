import { defineAction } from "@agent-native/core";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import {
  listContentOrganizationMemberships,
  normalizeContentSpaceEmail,
} from "./_content-space-access.js";
import {
  personalContentSpaceId,
  systemIdsForContentSpace,
} from "./_content-spaces.js";

export default defineAction({
  description:
    "List Content spaces that are already provisioned and currently authorized for the signed-in user.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => {
    const userEmail = getRequestUserEmail();
    if (!userEmail) throw new Error("no authenticated user");
    const email = normalizeContentSpaceEmail(userEmail);
    const db = getDb();
    const personalSpaceId = personalContentSpaceId(email);
    const catalogIds = systemIdsForContentSpace(personalSpaceId, "workspaces");
    const memberships = await listContentOrganizationMemberships(email);
    const roleByOrgId = new Map(
      memberships.map((membership) => [
        membership.orgId,
        membership.role === "owner"
          ? "owner"
          : membership.role === "admin"
            ? "editor"
            : "viewer",
      ]),
    );
    const rows = await db
      .select({
        mapping: schema.contentSpaceCatalogItems,
        space: schema.contentSpaces,
        item: schema.contentDatabaseItems,
      })
      .from(schema.contentSpaceCatalogItems)
      .innerJoin(
        schema.contentSpaces,
        eq(schema.contentSpaces.id, schema.contentSpaceCatalogItems.spaceId),
      )
      .innerJoin(
        schema.contentDatabaseItems,
        eq(
          schema.contentDatabaseItems.id,
          schema.contentSpaceCatalogItems.databaseItemId,
        ),
      )
      .where(
        and(
          eq(schema.contentSpaceCatalogItems.ownerEmail, email),
          eq(
            schema.contentSpaceCatalogItems.catalogDatabaseId,
            catalogIds.databaseId,
          ),
          isNull(schema.contentSpaces.archivedAt),
        ),
      );
    const filesDatabaseIds = rows.map((row) => row.space.filesDatabaseId);
    const filesDatabases = filesDatabaseIds.length
      ? await db
          .select({
            id: schema.contentDatabases.id,
            documentId: schema.contentDatabases.documentId,
          })
          .from(schema.contentDatabases)
          .where(inArray(schema.contentDatabases.id, filesDatabaseIds))
      : [];
    const filesDocumentIdByDatabaseId = new Map(
      filesDatabases.map((database) => [database.id, database.documentId]),
    );
    const spaces = [] as Array<{
      id: string;
      name: string;
      kind: string;
      filesDatabaseId: string;
      filesDocumentId: string;
      orgId: string | null;
      role: string;
      catalogItemId: string;
      catalogDocumentId: string;
    }>;
    for (const row of rows) {
      if (
        row.item.databaseId !== catalogIds.databaseId ||
        row.item.documentId !== row.mapping.documentId
      )
        continue;
      const role = row.space.orgId
        ? roleByOrgId.get(row.space.orgId)
        : row.space.ownerEmail.toLowerCase() === email
          ? "owner"
          : undefined;
      if (!role) continue;
      const filesDocumentId = filesDocumentIdByDatabaseId.get(
        row.space.filesDatabaseId,
      );
      if (!filesDocumentId) continue;
      spaces.push({
        id: row.space.id,
        name: row.space.name,
        kind: row.space.kind,
        filesDatabaseId: row.space.filesDatabaseId,
        filesDocumentId,
        orgId: row.space.orgId,
        role,
        catalogItemId: row.mapping.databaseItemId,
        catalogDocumentId: row.mapping.documentId,
      });
    }
    return { catalogDatabaseId: catalogIds.databaseId, spaces };
  },
});
