import { defineAction } from "@agent-native/core/action";
import {
  accessFilter,
  assertAccess,
  roleSatisfies,
} from "@agent-native/core/sharing";
import { and, asc, eq, inArray, isNull, notExists, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import type { SidebarCommandsResponse } from "../shared/sidebar-commands.js";

function nativePageFilters(db: ReturnType<typeof getDb>) {
  const document = schema.documents;
  const nativeSource = and(
    or(isNull(document.sourceMode), eq(document.sourceMode, "database")),
    isNull(document.sourceKind),
    isNull(document.sourcePath),
    isNull(document.sourceRootPath),
    notExists(
      db
        .select({ id: schema.documentSyncLinks.documentId })
        .from(schema.documentSyncLinks)
        .where(eq(schema.documentSyncLinks.documentId, document.id)),
    ),
    notExists(
      db
        .select({ id: schema.contentDatabaseSourceRows.id })
        .from(schema.contentDatabaseSourceRows)
        .where(eq(schema.contentDatabaseSourceRows.documentId, document.id)),
    ),
  );
  const pageType = and(
    notExists(
      db
        .select({ id: schema.contentDatabases.id })
        .from(schema.contentDatabases)
        .where(eq(schema.contentDatabases.documentId, document.id)),
    ),
    notExists(
      db
        .select({ id: schema.contentSpaceCatalogItems.id })
        .from(schema.contentSpaceCatalogItems)
        .where(eq(schema.contentSpaceCatalogItems.documentId, document.id)),
    ),
  );
  return { nativeSource, pageType };
}

export default defineAction({
  description:
    "Read authorized native Page rename and move eligibility and optionally complete same-section move destinations.",
  schema: z.object({
    documentId: z
      .string()
      .min(1)
      .describe("Page whose sidebar commands are being opened"),
    includeDestinations: z
      .union([z.boolean(), z.enum(["true", "false"])])
      .transform((value) => value === true || value === "true")
      .default(false)
      .describe(
        "Include the complete list of authorized native Page move destinations",
      ),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({
    documentId,
    includeDestinations,
  }): Promise<SidebarCommandsResponse> => {
    const access = await assertAccess(
      "document",
      documentId,
      "viewer",
      undefined,
      { skipResourceBody: true },
    );
    const db = getDb();
    const [document] = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        ownerEmail: schema.documents.ownerEmail,
        spaceId: schema.documents.spaceId,
        parentId: schema.documents.parentId,
        orgId: schema.documents.orgId,
        visibility: schema.documents.visibility,
        trashedAt: schema.documents.trashedAt,
      })
      .from(schema.documents)
      .where(eq(schema.documents.id, documentId));
    if (!document) throw new Error("Document no longer exists");
    const result: SidebarCommandsResponse = {
      documentId,
      title: document.title,
      writeReason: null,
      canMoveToRoot: false,
      destinations: [],
    };
    if (!roleSatisfies(access.role, "editor") || document.trashedAt !== null) {
      result.writeReason = "readOnly";
      return result;
    }
    const { nativeSource, pageType } = nativePageFilters(db);
    const [nativeRows, pageRows] = await Promise.all([
      db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(eq(schema.documents.id, documentId), nativeSource)),
      db
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(and(eq(schema.documents.id, documentId), pageType)),
    ]);
    if (nativeRows.length === 0 || pageRows.length === 0) {
      result.writeReason =
        nativeRows.length === 0 ? "sourceUnsupported" : "typeUnsupported";
      return result;
    }
    result.canMoveToRoot = document.parentId !== null;
    if (!includeDestinations) return result;

    // Match move-document's descendant walk even across inaccessible intermediate
    // pages. Only opaque IDs enter this internal traversal; titles stay scoped.
    const descendants = new Set([documentId]);
    let frontier = [documentId];
    while (frontier.length > 0) {
      const next: string[] = [];
      for (let offset = 0; offset < frontier.length; offset += 200) {
        const children = await db
          .select({ id: schema.documents.id })
          .from(schema.documents)
          .where(
            and(
              eq(schema.documents.ownerEmail, document.ownerEmail),
              inArray(
                schema.documents.parentId,
                frontier.slice(offset, offset + 200),
              ),
            ),
          );
        for (const child of children) {
          if (!descendants.has(child.id)) {
            descendants.add(child.id);
            next.push(child.id);
          }
        }
      }
      frontier = next;
    }
    const candidates = await db
      .select({
        id: schema.documents.id,
        title: schema.documents.title,
        parentId: schema.documents.parentId,
      })
      .from(schema.documents)
      .where(
        and(
          accessFilter(
            schema.documents,
            schema.documentShares,
            undefined,
            "editor",
          ),
          eq(schema.documents.ownerEmail, document.ownerEmail),
          document.spaceId === null
            ? isNull(schema.documents.spaceId)
            : eq(schema.documents.spaceId, document.spaceId),
          document.orgId === null
            ? isNull(schema.documents.orgId)
            : eq(schema.documents.orgId, document.orgId),
          eq(schema.documents.visibility, document.visibility),
          isNull(schema.documents.trashedAt),
          nativeSource,
          pageType,
        ),
      )
      .orderBy(asc(schema.documents.title), asc(schema.documents.id));
    result.destinations = candidates.filter(
      (candidate) => !descendants.has(candidate.id),
    );
    return result;
  },
});
