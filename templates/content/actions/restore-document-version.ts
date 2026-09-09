import { ActionContractError } from "@agent-native/core";
import { defineAction } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { bodyRevisionForContent } from "../server/lib/document-body-revision.js";
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import { propagateDocumentTitle } from "../server/lib/document-title-propagation.js";
import { nextDocumentUpdatedAt } from "../server/lib/document-updated-at.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import { reconcileInlineDatabasesForDocumentWithDb } from "./_content-database-lifecycle.js";
import { lockContentDatabaseMutation } from "./_content-database-mutation-lock.js";
import {
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import { lockLiveDocuments } from "./_document-lifecycle.js";
import { assertDocumentMutationAccess } from "./_document-mutation-access.js";

function isLinkedLocalSource(
  documentId: string,
  source: {
    sourceMode?: string | null;
    sourceKind?: string | null;
    sourcePath?: string | null;
  },
) {
  return (
    source.sourceMode === "local-files" &&
    source.sourceKind !== "folder" &&
    Boolean(source.sourcePath) &&
    !documentId.startsWith("local-file:") &&
    !documentId.startsWith("local-folder:")
  );
}

function linkedLocalRestoreUnsupported(): never {
  throw new ActionContractError(
    "History restore is unavailable for linked local files because the source file cannot join the atomic Content restore transaction.",
    {
      errorCode: "DOCUMENT_RESTORE_SOURCE_UNSUPPORTED",
      statusCode: 409,
    },
  );
}

export default defineAction({
  description:
    "Restore a document to a saved version, snapshotting the current state first.",
  schema: z.object({
    documentId: z.string().optional().describe("Document ID"),
    versionId: z.string().optional().describe("Version ID"),
    expectedUpdatedAt: z
      .string()
      .min(1)
      .describe("Current document updatedAt observed before choosing restore"),
  }),
  run: async (args, ctx) => {
    if (!args.documentId) throw new Error("--documentId is required");
    if (!args.versionId) throw new Error("--versionId is required");
    const documentId = args.documentId;
    const versionId = args.versionId;

    const access = await assertAccess("document", documentId, "editor");
    const ownerEmail = access.resource.ownerEmail as string;
    const source = access.resource as {
      sourceMode?: string | null;
      sourceKind?: string | null;
      sourcePath?: string | null;
    };
    if (isLinkedLocalSource(documentId, source))
      linkedLocalRestoreUnsupported();
    const db = getDb();
    let softDeletedDatabaseIds: string[] = [];
    const updated = await db.transaction(async (rawTx) => {
      const tx = rawTx as unknown as ReturnType<typeof getDb>;
      const databases = await tx
        .select({
          id: schema.contentDatabases.id,
          spaceId: schema.contentDatabases.spaceId,
          systemRole: schema.contentDatabases.systemRole,
        })
        .from(schema.contentDatabases)
        .where(
          or(
            eq(schema.contentDatabases.documentId, documentId),
            eq(schema.contentDatabases.ownerDocumentId, documentId),
          ),
        );
      for (const databaseId of databases
        .map((database) => database.id)
        .sort()) {
        await lockContentDatabaseMutation(tx, databaseId);
      }
      const spaceIds = databases.flatMap((database) =>
        database.systemRole === "files" && database.spaceId
          ? [database.spaceId]
          : [],
      );
      const references =
        spaceIds.length > 0
          ? await tx
              .select({
                documentId: schema.contentSpaceCatalogItems.documentId,
              })
              .from(schema.contentSpaceCatalogItems)
              .where(inArray(schema.contentSpaceCatalogItems.spaceId, spaceIds))
          : [];
      const primaryBlocksFields = await lockPrimaryBlocksFields(tx, documentId);
      const lockedDocuments = await lockLiveDocuments(tx, [
        documentId,
        ...references.map(
          (reference: { documentId: string }) => reference.documentId,
        ),
      ]);
      await assertDocumentMutationAccess(tx, [documentId], "editor");
      const current = lockedDocuments.find(
        (document) => document.id === documentId,
      )!;
      if (isLinkedLocalSource(documentId, current)) {
        linkedLocalRestoreUnsupported();
      }
      if (current.updatedAt !== args.expectedUpdatedAt) {
        throw new ActionContractError(
          "The document changed after this restore was prepared.",
          {
            errorCode: "DOCUMENT_RESTORE_CONFLICT",
            statusCode: 409,
            details: {
              expectedUpdatedAt: args.expectedUpdatedAt,
              currentUpdatedAt: current.updatedAt,
            },
          },
        );
      }
      const [version] = await tx
        .select()
        .from(schema.documentVersions)
        .where(
          and(
            eq(schema.documentVersions.id, versionId),
            eq(schema.documentVersions.documentId, documentId),
            eq(schema.documentVersions.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (!version) {
        throw new ActionContractError("Document checkpoint not found.", {
          errorCode: "DOCUMENT_CHECKPOINT_NOT_FOUND",
          statusCode: 404,
        });
      }
      if (
        current.title === version.title &&
        current.content === version.content
      ) {
        return current;
      }
      const now = nextDocumentUpdatedAt(current.updatedAt);
      const applied = await tx
        .update(schema.documents)
        .set({
          title: version.title,
          content: version.content,
          bodyRevision: bodyRevisionForContent(version.content),
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.ownerEmail, ownerEmail),
            eq(schema.documents.updatedAt, args.expectedUpdatedAt),
          ),
        )
        .returning();
      if (applied.length !== 1) {
        throw new ActionContractError(
          "The document changed while the restore was committing.",
          {
            errorCode: "DOCUMENT_RESTORE_CONFLICT",
            statusCode: 409,
          },
        );
      }
      if (current.title !== version.title) {
        await propagateDocumentTitle({
          db: tx as unknown as ReturnType<typeof getDb>,
          documentId,
          title: version.title,
          updatedAt: now,
        });
      }
      for (const field of primaryBlocksFields) {
        await persistBlocksFieldIdentity({
          db: tx as unknown as ReturnType<typeof getDb>,
          ownerEmail: field.ownerEmail,
          documentId,
          propertyId: field.propertyId,
          previousMarkdown: current.content,
          markdown: version.content,
          now,
        });
      }
      if (current.content !== version.content) {
        softDeletedDatabaseIds =
          await reconcileInlineDatabasesForDocumentWithDb({
            db: tx as unknown as ReturnType<typeof getDb>,
            documentId,
            content: version.content,
            ownerEmail,
            now,
          });
      }
      const [restored] = await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1);
      if (!restored) {
        throw new ActionContractError("Document not found after restore.", {
          errorCode: "DOCUMENT_NOT_FOUND",
          statusCode: 404,
        });
      }
      await recordDocumentHistoryTransition({
        db: tx as unknown as ReturnType<typeof getDb>,
        ownerEmail,
        documentId,
        before: { title: current.title, content: current.content },
        after: { title: restored.title, content: restored.content },
        cause: { ctx, operation: "restore-document-version" },
        now,
      });
      return restored;
    });

    try {
      await writeAppState("refresh-signal", { ts: Date.now() });
    } catch (error) {
      console.error(
        "restore-document-version: refresh signal publish failed after commit",
        error,
      );
    }

    return {
      id: updated.id,
      parentId: updated.parentId,
      title: updated.title,
      content: updated.content,
      icon: updated.icon,
      position: updated.position,
      isFavorite: parseDocumentFavorite(updated.isFavorite),
      hideFromSearch: parseDocumentHideFromSearch(updated.hideFromSearch),
      visibility: updated.visibility,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      revision: documentRevisionToken(updated.bodyRevision, updated.content),
      bodyRevision: updated.bodyRevision,
      contentHash: documentContentHash(updated.content),
      softDeletedDatabaseIds,
    };
  },
});
