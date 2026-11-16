import { ActionContractError } from "@agent-native/core";
import type { ActionRunContext } from "@agent-native/core/action";
import { writeAppState } from "@agent-native/core/application-state";
import { getDbExec } from "@agent-native/core/db";
import { getRequestUserEmail } from "@agent-native/core/server/request-context";
import { assertAccess, currentAccess } from "@agent-native/core/sharing";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDocumentRequestActor } from "../server/lib/document-attribution.js";
import { lockLegacyBodyWrites } from "../server/lib/document-body-revision.js";
import {
  recordDocumentHistoryTransition,
  type DocumentHistoryGrouping,
} from "../server/lib/document-history.js";
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
import { firstRow } from "../server/lib/first-row.js";
import { isLiveBodyWriterPage } from "../server/lib/live-body-writer.js";
import { syncPrivateBodyReferences } from "../server/lib/private-icon-references.js";
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
import { assertAgentsMayEditPageText } from "./_document-agent-lock.js";
import {
  assertEditableDocument,
  documentContentHash,
  documentRevisionToken,
} from "./_document-edit-mutation.js";
import {
  flushOpenDocumentEditorToSql,
  saveOpenEditorTitles,
  type OpenEditorTitleFlush,
} from "./_document-flush.js";
import { lockDocumentForSave } from "./_document-save-locks.js";
import { assertSourceAllowsPageEdit } from "./_document-source.js";

type ContentDb = ReturnType<typeof getDb>;
type DocumentRow = typeof schema.documents.$inferSelect;

/** The page state a restore writes. */
export interface DocumentStateTarget {
  title: string;
  content: string;
  /**
   * The History checkpoint whose body this is, when it is one: an editor
   * who doesn't own its private callout icons may restore them from there.
   */
  checkpointId?: string;
}

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

export function isDocumentRestoreConflict(error: unknown): boolean {
  return (
    error instanceof ActionContractError &&
    error.errorCode === "DOCUMENT_RESTORE_CONFLICT"
  );
}

async function titleOrganizationIds(): Promise<string[]> {
  const requestUserEmail = getRequestUserEmail();
  return requestUserEmail
    ? (await listContentOrganizationMemberships(requestUserEmail)).map(
        (membership) => membership.orgId,
      )
    : [];
}

interface RestoreCause {
  ctx: ActionRunContext | undefined;
  operation: string;
  historyGrouping?: DocumentHistoryGrouping;
}

function historyCause(cause: RestoreCause) {
  return {
    ...(cause.ctx ? { ctx: cause.ctx } : {}),
    operation: cause.operation,
    ...cause.historyGrouping,
  };
}

/**
 * A restore on a switched page, through its live copy, so open tabs get the
 * restored body instead of writing their own copy back over it. A changed
 * body takes the target's title in its commit and History row, as the page's
 * backing collection leaves it; a title change still has to reach that
 * collection, and when the body reads the same once canonical, it is this
 * restore's only change.
 * Undefined when the page left its live copy before anything committed; the
 * caller takes the legacy path.
 */
async function restoreThroughLiveCopy(args: {
  cause: RestoreCause;
  documentId: string;
  ownerEmail: string;
  current: DocumentRow;
  target: (current: DocumentRow, db: ContentDb) => Promise<DocumentStateTarget>;
}): Promise<
  { document: DocumentRow; softDeletedDatabaseIds: string[] } | undefined
> {
  const { cause, documentId, ownerEmail, current } = args;
  const target = await args.target(current, getDb());
  // The body commit records its title in History before the title reaches
  // the backing collection, so it records the title that collection leaves.
  // guard:allow-unscoped — the caller asserted editor access to this page.
  const backing = firstRow(
    await getDb()
      .select({
        id: schema.contentDatabases.id,
        systemRole: schema.contentDatabases.systemRole,
        spaceId: schema.contentDatabases.spaceId,
      })
      .from(schema.contentDatabases)
      .where(eq(schema.contentDatabases.documentId, documentId))
      .orderBy(asc(schema.contentDatabases.id))
      .limit(1),
  );
  const title = propagatedPageTitle(target.title, backing);
  if (current.title === title && current.content === target.content) {
    return { document: current, softDeletedDatabaseIds: [] };
  }
  const organizationIds =
    current.title !== title ? await titleOrganizationIds() : [];
  let result:
    | { document: DocumentRow; softDeletedDatabaseIds: string[] }
    | undefined;
  try {
    await editContentLiveCopy(documentId, {
      cause: {
        ctx: cause.ctx,
        operation: cause.operation,
        ...(cause.historyGrouping
          ? { historyGrouping: cause.historyGrouping }
          : {}),
        title,
        ...(target.checkpointId
          ? {
              calloutSource: {
                kind: "version" as const,
                versionId: target.checkpointId,
              },
            }
          : {}),
      },
      edit: CONTENT_LIVE_COPY_EDITS.replaceBody,
      input: { content: target.content, expected: current.content },
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
        const row = firstRow(
          await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, documentId)),
        );
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
              cause: historyCause(cause),
              now,
            });
          }
        }
        // guard:allow-unscoped — reads the page row this transaction locked.
        const restored = firstRow(
          await db
            .select()
            .from(schema.documents)
            .where(eq(schema.documents.id, documentId)),
        );
        if (!restored) {
          throw new ActionContractError("Document not found.", {
            errorCode: "DOCUMENT_NOT_FOUND",
            statusCode: 404,
          });
        }
        result = {
          document: restored,
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

async function publishRestoreRefresh(operation: string) {
  try {
    await writeAppState("refresh-signal", { ts: Date.now() });
  } catch (error) {
    console.error(
      `${operation}: refresh signal publish failed after commit`,
      error,
    );
  }
}

/** The page as a History write leaves it, for the editor to show. */
export const documentStateResultSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string(),
  content: z.string(),
  icon: z.string().nullable(),
  position: z.number(),
  isFavorite: z.boolean(),
  hideFromSearch: z.boolean(),
  visibility: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  revision: z.string(),
  bodyRevision: z.number(),
  contentHash: z.string(),
  softDeletedDatabaseIds: z
    .array(z.string())
    .describe("Inline collections the write moved to Trash with their blocks"),
});

export function documentStateResult(
  updated: DocumentRow,
  softDeletedDatabaseIds: string[] = [],
) {
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

export type DocumentStateRestoreResult = ReturnType<
  typeof documentStateResult
> & {
  titleFlush?: OpenEditorTitleFlush;
};

/**
 * Writes a page back to a state from its History, snapshotting the current
 * state first, when the page still reads as it did at `expectedUpdatedAt`.
 * `target` reads the state to write from the page as it stands; the restore
 * asks again under its locks, where the page reads the same. A page that
 * changed in between is a `DOCUMENT_RESTORE_CONFLICT`, and nothing is written.
 */
export async function restoreDocumentState(args: {
  ctx: ActionRunContext | undefined;
  documentId: string;
  expectedUpdatedAt: string;
  operation: string;
  historyGrouping?: DocumentHistoryGrouping;
  target: (current: DocumentRow, db: ContentDb) => Promise<DocumentStateTarget>;
}): Promise<DocumentStateRestoreResult> {
  const { ctx, documentId } = args;
  const cause: RestoreCause = {
    ctx,
    operation: args.operation,
    ...(args.historyGrouping ? { historyGrouping: args.historyGrouping } : {}),
  };
  const actor = requireDocumentRequestActor(ctx);
  const access = await assertAccess("document", documentId, "editor");
  const ownerEmail = access.resource.ownerEmail as string;
  const source = access.resource as {
    sourceMode?: string | null;
    sourceKind?: string | null;
    sourcePath?: string | null;
  };
  if (isLinkedLocalSource(documentId, source)) linkedLocalRestoreUnsupported();
  assertSourceAllowsPageEdit(access.resource);
  assertAgentsMayEditPageText(access.resource, ctx);
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
    assertEditableDocument(current);
    return current;
  };
  let titleFlush: OpenEditorTitleFlush | undefined;
  // The page as the caller prepared the restore, or as the title save the
  // restore asked for left it. Main's path below must not read that save
  // as a conflicting edit when the page leaves its live copy first.
  let preparedUpdatedAt = args.expectedUpdatedAt;
  if (await isLiveBodyWriterPage(documentId)) {
    let current = await readCurrent();
    if (current.updatedAt !== args.expectedUpdatedAt) {
      restoreConflict("The document changed after this restore was prepared.", {
        expectedUpdatedAt: args.expectedUpdatedAt,
        currentUpdatedAt: current.updatedAt,
      });
    }
    // History records the page as it stands before the restore, and an
    // open editor may not have saved its title yet. Its body is already in
    // the live copy. The save it asks for moves the page on, which is no
    // conflict.
    titleFlush = await saveOpenEditorTitles([documentId]);
    if (titleFlush) {
      const prepared = current;
      const confirmedTitle = titleFlush.pages.find(
        (page) => page.documentId === documentId,
      )?.confirmedTitle;
      current = await readCurrent();
      // Only the title save may have moved the page on. Anything else that
      // landed while the editors saved is an edit this restore wasn't
      // prepared from.
      if (
        current.content !== prepared.content ||
        current.bodyRevision !== prepared.bodyRevision ||
        (confirmedTitle !== undefined && current.title !== confirmedTitle)
      ) {
        restoreConflict(
          "The document changed after this restore was prepared.",
          {
            expectedUpdatedAt: args.expectedUpdatedAt,
            currentUpdatedAt: current.updatedAt,
          },
        );
      }
      preparedUpdatedAt = current.updatedAt;
    }
    const restored = await restoreThroughLiveCopy({
      cause,
      documentId,
      ownerEmail,
      current,
      target: args.target,
    });
    if (restored) {
      await publishRestoreRefresh(args.operation);
      return {
        ...documentStateResult(
          restored.document,
          restored.softDeletedDatabaseIds,
        ),
        ...(titleFlush ? { titleFlush } : {}),
      };
    }
  }
  const [beforeFlush] = await db
    .select({
      trashedAt: schema.documents.trashedAt,
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
  assertEditableDocument(beforeFlush);
  if (beforeFlush.updatedAt !== preparedUpdatedAt) {
    restoreConflict("The document changed after this restore was prepared.", {
      expectedUpdatedAt: preparedUpdatedAt,
      currentUpdatedAt: beforeFlush.updatedAt,
    });
  }
  const flushed = await flushOpenDocumentEditorToSql({
    documentId,
    ownerEmail,
  });
  // The page can go back to its live copy after the check above, and then
  // this flush has its editors save their titles instead.
  if (flushed.status === "live_copy" && flushed.titleFlush) {
    titleFlush = flushed.titleFlush;
  }
  const afterFlush = await readCurrent();
  const expectedUpdatedAt = afterFlush.updatedAt;
  const organizationIds =
    (await args.target(afterFlush, db)).title !== afterFlush.title
      ? await titleOrganizationIds()
      : [];
  let softDeletedDatabaseIds: string[] = [];
  const updated = await db.transaction(async (rawTx) => {
    const tx = rawTx as unknown as ContentDb;
    const {
      databaseId: lockedDatabaseId,
      lockedDatabaseIds,
      lockedMembershipIds,
    } = await lockDocumentForSave(tx, {
      documentId,
      ownerEmail,
      body: true,
    });
    // Access was checked before the editor flush, which can wait seconds.
    await assertAccess("document", documentId, "editor", {
      ...currentAccess(),
      transaction: getDbExec(),
    });
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
    assertEditableDocument(current);
    if (isLinkedLocalSource(documentId, current)) {
      linkedLocalRestoreUnsupported();
    }
    assertSourceAllowsPageEdit(current);
    assertAgentsMayEditPageText(current, ctx);
    if (current.updatedAt !== expectedUpdatedAt) {
      restoreConflict("The document changed after this restore was prepared.", {
        expectedUpdatedAt,
        currentUpdatedAt: current.updatedAt,
      });
    }
    const target = await args.target(current, tx);
    if (current.title === target.title && current.content === target.content) {
      return current;
    }
    const legacy = await lockLegacyBodyWrites(tx, [documentId], {
      operation: args.operation,
      routed: true,
      content: target.content,
    });
    const now =
      current.title !== target.title
        ? await nextDocumentMetadataUpdatedAt({
            db: tx,
            documentId,
            ownerEmail,
            currentUpdatedAt: current.updatedAt,
            lockedDatabaseId,
          })
        : nextDocumentUpdatedAt(current.updatedAt);
    const primaryBlocksFields = await lockPrimaryBlocksFields(tx, documentId, {
      heldMembershipIds: lockedMembershipIds,
    });
    const applied = await tx
      .update(schema.documents)
      .set({
        title: target.title,
        content: target.content,
        bodyRevision: legacy.bodyRevision(target.content),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.documents.id, documentId),
          eq(schema.documents.ownerEmail, ownerEmail),
          eq(schema.documents.updatedAt, expectedUpdatedAt),
        ),
      )
      .returning();
    if (applied.length !== 1) {
      restoreConflict("The document changed while the restore was committing.");
    }
    await syncPrivateBodyReferences(tx, {
      documentId,
      before: current.content,
      after: target.content,
      userEmail: actor,
      ownerEmail,
      orgId: current.orgId,
      ...(target.checkpointId
        ? {
            source: {
              kind: "version" as const,
              versionId: target.checkpointId,
            },
          }
        : {}),
    });
    if (current.title !== target.title) {
      await propagateDocumentTitle({
        db: tx,
        documentId,
        title: target.title,
        updatedAt: now,
        organizationIds,
        databaseId: lockedDatabaseId,
      });
    }
    for (const field of primaryBlocksFields) {
      await persistBlocksFieldIdentity({
        db: tx,
        ownerEmail: field.ownerEmail,
        documentId,
        propertyId: field.propertyId,
        previousMarkdown: current.content,
        markdown: target.content,
        now,
      });
    }
    if (current.content !== target.content) {
      softDeletedDatabaseIds = await reconcileInlineDatabasesForDocumentWithDb({
        db: tx,
        documentId,
        content: target.content,
        ownerEmail,
        now,
        lockedDatabaseIds,
      });
    }
    const restored = firstRow(
      await tx
        .select()
        .from(schema.documents)
        .where(eq(schema.documents.id, documentId))
        .limit(1),
    );
    if (!restored) {
      throw new ActionContractError("Document not found after restore.", {
        errorCode: "DOCUMENT_NOT_FOUND",
        statusCode: 404,
      });
    }
    await recordDocumentHistoryTransition({
      db: tx,
      ownerEmail,
      documentId,
      before: { title: current.title, content: current.content },
      after: { title: restored.title, content: restored.content },
      cause: historyCause(cause),
      now,
    });
    return restored;
  });

  await publishRestoreRefresh(args.operation);
  return {
    ...documentStateResult(updated, softDeletedDatabaseIds),
    ...(titleFlush ? { titleFlush } : {}),
  };
}
