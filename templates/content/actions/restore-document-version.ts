import { ActionContractError } from "@agent-native/core";
import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, currentAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDocumentRequestActor } from "../server/lib/document-attribution.js";
import { lockLegacyBodyWrites } from "../server/lib/document-body-revision.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import { recordDocumentHistoryTransition } from "../server/lib/document-history.js";
import {
  lockDocumentMetadataDatabase,
  nextDocumentMetadataUpdatedAt,
} from "../server/lib/document-metadata-updated-at.js";
import {
  propagatedPageTitle,
  propagateDocumentTitle,
} from "../server/lib/document-title-propagation.js";
import { nextDocumentUpdatedAt } from "../server/lib/document-updated-at.js";
import {
  parseDocumentFavorite,
  parseDocumentHideFromSearch,
} from "../server/lib/documents.js";
import { isLiveBodyWriterPage } from "../server/lib/live-body-writer.js";
import { syncPrivateCalloutReferences } from "../server/lib/private-icon-references.js";
import { CONTENT_LIVE_COPY_EDITS } from "../server/live-copy/binding.js";
import { drizzleOverExec } from "../server/live-copy/exec-db.js";
import { persistedContentBodyCommit } from "../server/live-copy/persist.js";
import {
  editContentLiveCopy,
  liveCopyBaseChanged,
  liveCopyWriteLeftPath,
  unrepresentableBodyError,
} from "../server/live-copy/write.js";
import {
  lockPrimaryBlocksFields,
  persistBlocksFieldIdentity,
} from "./_blocks-field-identity.js";
import { reconcileInlineDatabasesForDocumentWithDb } from "./_content-database-lifecycle.js";
import { listContentOrganizationMemberships } from "./_content-space-access.js";
import {
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import {
  assertOpenEditorTitlesSaved,
  flushOpenDocumentEditorToSql,
  saveOpenEditorTitles,
} from "./_document-flush.js";

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

function restoreConflict(
  message: string,
  details?: Record<string, unknown>,
): never {
  throw new ActionContractError(message, {
    errorCode: "DOCUMENT_RESTORE_CONFLICT",
    statusCode: 409,
    ...(details ? { details } : {}),
  });
}

type DocumentRow = typeof schema.documents.$inferSelect;

async function titleOrganizationIds(): Promise<string[]> {
  const requestUserEmail = getRequestUserEmail();
  return requestUserEmail
    ? (await listContentOrganizationMemberships(requestUserEmail)).map(
        (membership) => membership.orgId,
      )
    : [];
}

/**
 * A version restore on a switched page, through its live copy, so open tabs
 * get the restored body instead of writing their own copy back over it. A
 * changed body takes the version's title in its commit and History row, as
 * the page's backing collection leaves it; a title change still has to
 * reach that collection, and when the body reads the same once canonical,
 * it is this restore's only change.
 * Undefined when the page left its live copy before anything committed; the
 * caller takes the legacy path.
 */
async function restoreThroughLiveCopy(args: {
  ctx: ActionRunContext | undefined;
  documentId: string;
  versionId: string;
  ownerEmail: string;
  current: DocumentRow;
}): Promise<
  { document: DocumentRow; softDeletedDatabaseIds: string[] } | undefined
> {
  const { ctx, documentId, versionId, ownerEmail, current } = args;
  const [version] = await getDb()
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
  // The body commit records its title in History before the title reaches
  // the backing collection, so it records the title that collection leaves.
  // guard:allow-unscoped — the caller asserted editor access to this page.
  const [backing] = await getDb()
    .select({
      id: schema.contentDatabases.id,
      systemRole: schema.contentDatabases.systemRole,
      spaceId: schema.contentDatabases.spaceId,
    })
    .from(schema.contentDatabases)
    .where(eq(schema.contentDatabases.documentId, documentId))
    .orderBy(asc(schema.contentDatabases.id))
    .limit(1);
  const title = propagatedPageTitle(version.title, backing);
  if (current.title === title && current.content === version.content) {
    return { document: current, softDeletedDatabaseIds: [] };
  }
  const organizationIds =
    current.title !== title ? await titleOrganizationIds() : [];
  const cause = { ctx, operation: "restore-document-version" };
  let result:
    | { document: DocumentRow; softDeletedDatabaseIds: string[] }
    | undefined;
  try {
    await editContentLiveCopy(documentId, {
      cause: {
        ...cause,
        title,
        calloutSource: { kind: "version", versionId },
      },
      edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: { content: version.content, expected: current.content },
      persist: async (tx) => {
        await assertAccess("document", documentId, "editor", {
          ...currentAccess(),
          transaction: tx,
        });
        const db = drizzleOverExec(tx);
        const committed = persistedContentBodyCommit(tx);
        // A commit can change the live copy and derive the same body; it
        // records no History row, so the title records its own.
        const bodyRecorded =
          committed !== undefined && committed.before !== committed.after;
        // guard:allow-unscoped — reads the page row this transaction locked.
        const [row] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId));
        if (!row) {
          throw new ActionContractError("Document not found.", {
            errorCode: "DOCUMENT_NOT_FOUND",
            statusCode: 404,
          });
        }
        if (
          (committed?.beforeUpdatedAt ?? row.updatedAt) !== current.updatedAt
        ) {
          restoreConflict(
            "The document changed while the restore was committing.",
          );
        }
        if (current.title !== title) {
          const lockedDatabaseId = await lockDocumentMetadataDatabase({
            db,
            documentId,
            ownerEmail,
          });
          if (lockedDatabaseId !== (backing?.id ?? null)) {
            restoreConflict(
              "The document's backing collection changed while the restore was committing.",
            );
          }
          const now = await nextDocumentMetadataUpdatedAt({
            db,
            documentId,
            ownerEmail,
            currentUpdatedAt: row.updatedAt,
            lockedDatabaseId,
          });
          // guard:allow-unscoped — writes the page row this transaction locked.
          await db
            .update(schema.documents)
            .set({ title, updatedAt: now })
            .where(eq(schema.documents.id, documentId));
          await propagateDocumentTitle({
            db,
            documentId,
            title,
            updatedAt: now,
            organizationIds,
            databaseId: lockedDatabaseId,
          });
          if (!bodyRecorded) {
            await recordDocumentHistoryTransition({
              db,
              ownerEmail,
              documentId,
              before: { title: row.title, content: row.content },
              after: { title, content: row.content },
              cause,
              now,
            });
          }
        }
        // guard:allow-unscoped — reads the page row this transaction locked.
        const [restored] = await db
          .select()
          .from(schema.documents)
          .where(eq(schema.documents.id, documentId));
        result = {
          document: restored!,
          softDeletedDatabaseIds: committed?.softDeletedDatabaseIds ?? [],
        };
      },
    });
  } catch (error) {
    if (liveCopyWriteLeftPath(error)) return undefined;
    if (liveCopyBaseChanged(error)) {
      restoreConflict("The document changed after this restore was prepared.");
    }
    throw unrepresentableBodyError(error) ?? error;
  }
  if (!result) {
    // guard:allow-bare-error — invariant: persist sets the result before its transaction commits.
    throw new Error(
      `The live-copy restore of page ${documentId} committed without its result.`,
    );
  }
  return result;
}

async function publishRestoreRefresh() {
  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.error(
      "restore-document-version: refresh signal publish failed after commit",
      error,
    );
  }
}

function restoreResult(updated: DocumentRow, softDeletedDatabaseIds: string[]) {
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
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args, ctx) => {
    const actor = requireDocumentRequestActor(ctx);
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
    const readCurrent = async () => {
      const [current] = await db
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (!current) {
        throw new ActionContractError("Document not found.", {
          errorCode: "DOCUMENT_NOT_FOUND",
          statusCode: 404,
        });
      }
      return current;
    };
    if (await isLiveBodyWriterPage(documentId)) {
      const prepared = await readCurrent();
      if (prepared.updatedAt !== args.expectedUpdatedAt) {
        restoreConflict(
          "The document changed after this restore was prepared.",
          {
            expectedUpdatedAt: args.expectedUpdatedAt,
            currentUpdatedAt: prepared.updatedAt,
          },
        );
      }
      // History records the page as it stands before the restore, and an
      // open editor may not have saved the title yet; its body is already in
      // the live copy.
      const flushed = await saveOpenEditorTitles([documentId]);
      const titleFlush = flushed && assertOpenEditorTitlesSaved(flushed);
      const current = await readCurrent();
      const restored = await restoreThroughLiveCopy({
        ctx,
        documentId,
        versionId,
        ownerEmail,
        current,
      });
      if (restored) {
        await publishRestoreRefresh();
        return {
          ...restoreResult(restored.document, restored.softDeletedDatabaseIds),
          ...(titleFlush ? { titleFlush } : {}),
        };
      }
    }
    const [versionForScope] = await db
      .select({ title: schema.documentVersions.title })
      .from(schema.documentVersions)
      .where(
        and(
          eq(schema.documentVersions.id, versionId),
          eq(schema.documentVersions.documentId, documentId),
          eq(schema.documentVersions.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    const [beforeFlush] = await db
      .select({ updatedAt: schema.documents.updatedAt })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!beforeFlush) {
      throw new ActionContractError("Document not found.", {
        errorCode: "DOCUMENT_NOT_FOUND",
        statusCode: 404,
      });
    }
    if (beforeFlush.updatedAt !== args.expectedUpdatedAt) {
      restoreConflict("The document changed after this restore was prepared.", {
        expectedUpdatedAt: args.expectedUpdatedAt,
        currentUpdatedAt: beforeFlush.updatedAt,
      });
    }
    await flushOpenDocumentEditorToSql({ documentId, ownerEmail });
    const [afterFlush] = await db
      .select({
        title: schema.documents.title,
        updatedAt: schema.documents.updatedAt,
      })
      .from(schema.documents)
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, ownerEmail),
        ),
      )
      .limit(1);
    if (!afterFlush) {
      throw new ActionContractError("Document not found.", {
        errorCode: "DOCUMENT_NOT_FOUND",
        statusCode: 404,
      });
    }
    const expectedUpdatedAt = afterFlush.updatedAt;
    const organizationIds =
      versionForScope && versionForScope.title !== afterFlush.title
        ? await titleOrganizationIds()
        : [];
    let softDeletedDatabaseIds: string[] = [];
    const updated = await db.transaction(async (rawTx) => {
      const tx = rawTx as any;
      const lockedDatabaseId = await lockDocumentMetadataDatabase({
        db: tx as unknown as ReturnType<typeof getDb>,
        documentId,
        ownerEmail,
      });
      await tx
        .select({ id: schema.documents.id })
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )
        .for("update");
      const [current] = await tx
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      if (!current) {
        throw new ActionContractError("Document not found.", {
          errorCode: "DOCUMENT_NOT_FOUND",
          statusCode: 404,
        });
      }
      if (isLinkedLocalSource(documentId, current)) {
        linkedLocalRestoreUnsupported();
      }
      if (current.updatedAt !== expectedUpdatedAt) {
        restoreConflict(
          "The document changed after this restore was prepared.",
          {
            expectedUpdatedAt,
            currentUpdatedAt: current.updatedAt,
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
      const legacy = await lockLegacyBodyWrites(tx, [documentId], {
        operation: "restore-document-version",
        routed: true,
        content: version.content,
      });
      const now =
        current.title !== version.title
          ? await nextDocumentMetadataUpdatedAt({
              db: tx as unknown as ReturnType<typeof getDb>,
              documentId,
              ownerEmail,
              currentUpdatedAt: current.updatedAt,
              lockedDatabaseId,
            })
          : nextDocumentUpdatedAt(current.updatedAt);
      const primaryBlocksFields = await lockPrimaryBlocksFields(
        tx as unknown as ReturnType<typeof getDb>,
        documentId,
      );
      const applied = await tx
        .update(schema.documents)
        .set({
          title: version.title,
          content: version.content,
          bodyRevision: legacy.bodyRevision(version.content),
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
        restoreConflict(
          "The document changed while the restore was committing.",
        );
      }
      await syncPrivateCalloutReferences(
        tx as unknown as ReturnType<typeof getDb>,
        {
          documentId,
          before: current.content,
          after: version.content,
          userEmail: actor,
          ownerEmail,
          orgId: current.orgId,
          source: { kind: "version", versionId },
        },
      );
      if (current.title !== version.title) {
        await propagateDocumentTitle({
          db: tx as unknown as ReturnType<typeof getDb>,
          documentId,
          title: version.title,
          updatedAt: now,
          organizationIds,
          databaseId: lockedDatabaseId,
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

    await publishRestoreRefresh();
    return restoreResult(updated, softDeletedDatabaseIds);
  },
});
