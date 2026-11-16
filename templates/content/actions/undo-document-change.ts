import { createHash } from "node:crypto";

import { ActionContractError } from "@agent-native/core";
import { defineAction, type ActionRunContext } from "@agent-native/core/action";
import { assertAccess } from "@agent-native/core/sharing";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { requireDocumentRequestActor } from "../server/lib/document-attribution.js";
import { documentChangeResource } from "../server/lib/document-change-resource.js";
import {
  latestHistoryEntryChange,
  listHistoryEntryChanges,
} from "../server/lib/document-history-changes.js";
import { documentHistoryGrouping } from "../server/lib/document-history.js";
import { firstRow } from "../server/lib/first-row.js";
import {
  revertBodyEdit,
  type KeptBackBlocks,
} from "../server/live-copy/rebase.js";
import type { DocumentHistoryChange } from "../shared/document-history.js";
import { assertEditableDocument } from "./_document-edit-mutation.js";
import {
  documentStateResult,
  documentStateResultSchema,
  isDocumentRestoreConflict,
  restoreDocumentState,
  type DocumentStateTarget,
} from "./_document-state-restore.js";

const UNDO_OPERATION = "undo-document-change";
// An entry this long is a person's whole session; restore a checkpoint instead.
const MAX_UNDO_CHANGES = 100;
// A page someone keeps typing in, or an entry its agent is still adding to,
// can move on between the undo's read and its write; each attempt reads both
// again.
const MAX_UNDO_ATTEMPTS = 3;

type DocumentRow = typeof schema.documents.$inferSelect;
type ContentDb = ReturnType<typeof getDb>;

// Thrown inside the write when an undo with the same key got there first.
class UndoAlreadyMade extends Error {}

// Starts the undo over, as a page that moved on does.
function entryMovedOn(): never {
  throw new ActionContractError(
    "A change joined this History entry while it was being undone. Try again.",
    { errorCode: "DOCUMENT_RESTORE_CONFLICT", statusCode: 409 },
  );
}

function undoUnavailable(message: string, statusCode = 409): never {
  throw new ActionContractError(message, {
    errorCode: "DOCUMENT_UNDO_UNAVAILABLE",
    statusCode,
  });
}

/**
 * The page with an entry's changes taken back, newest first, each against
 * the page as the later ones left it. A title the entry set goes back unless
 * it was renamed since.
 */
function undoChanges(
  changes: readonly DocumentHistoryChange[],
  page: Pick<DocumentRow, "title" | "content">,
): DocumentStateTarget & { keptBack: KeptBackBlocks[] } {
  let { title, content } = page;
  const keptBack: KeptBackBlocks[] = [];
  for (const { before, after } of [...changes].reverse()) {
    const reverted = revertBodyEdit(after.content, before.content, content);
    if (!reverted) {
      undoUnavailable(
        "Part of this page is written in a form the undo can't merge without losing it. Restore a checkpoint instead, or make the change by hand.",
      );
    }
    content = reverted.content;
    keptBack.unshift(...reverted.keptBack);
    if (title === after.title) title = before.title;
  }
  const checkpoint = changes.find(
    ({ before }) => before.title === title && before.content === content,
  )?.before;
  return {
    title,
    content,
    keptBack,
    ...(checkpoint ? { checkpointId: checkpoint.checkpointId } : {}),
  };
}

// The undo's own History entry, named by the caller's key, so a retry finds
// the undo it already made.
function undoGroupId(
  ctx: ActionRunContext | undefined,
  args: { documentId: string; groupId: string; idempotencyKey: string },
) {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        requireDocumentRequestActor(ctx).toLowerCase(),
        ctx?.orgId ?? "",
        args.documentId,
        args.groupId,
        args.idempotencyKey,
      ]),
    )
    .digest("hex");
  return `undo:${digest.slice(0, 32)}`;
}

const undoDocumentChangeSchema = z.object({
  documentId: z.string().min(1).describe("Document ID"),
  groupId: z
    .string()
    .min(1)
    .describe(
      "The History entry to undo: an id from list-document-history, or the historyGroupId an edit-document receipt returns",
    ),
  idempotencyKey: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Caller-generated key; a retry with the same key and entry returns the first undo, and the page as it is now, instead of undoing again. An undo that changed nothing records no entry, so a retry of it runs again",
    ),
});

const undoDocumentChangeOutputSchema = z.object({
  ...documentStateResultSchema.shape,
  documentId: z.string(),
  groupId: z.string(),
  outcome: z.enum([
    "undone",
    "partly-undone",
    "nothing-undone",
    "already-undone",
    "replayed",
  ]),
  undoGroupId: z
    .string()
    .optional()
    .describe("The undo's own History entry, when the undo changed the page"),
  keptBack: z
    .array(
      z.object({
        changedTo: z
          .string()
          .describe("The blocks as the undone entry left them, in Markdown"),
        changedFrom: z
          .string()
          .describe("The blocks as they read before it, in Markdown"),
      }),
    )
    .optional()
    .describe(
      "Blocks a later change touched, which the undo left as they are; absent on a replay",
    ),
  idempotency: z.object({
    key: z.string(),
    result: z.enum(["applied", "replayed"]),
  }),
});

export default defineAction({
  searchHints: [
    "undo an agent edit",
    "take back a change",
    "undo one agent change",
  ],
  description:
    "Undo one History entry on a page, such as one agent's edits, keeping every change made since. Each block the entry changed goes back to how it read before, unless a later change touched it: those stay as they are and are listed in keptBack. Find the entry with list-document-history, or take the historyGroupId an edit-document receipt returns, and pass a caller-generated idempotencyKey. The undo is a History entry of its own, undoGroupId, so it can be undone too.",
  mcpTool: true,
  mcpApp: { structuredContent: true },
  mcpAnnotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  schema: undoDocumentChangeSchema,
  outputSchema: undoDocumentChangeOutputSchema,
  changeResource: (input) => documentChangeResource(input.documentId),
  run: async (args, ctx) => {
    const { documentId } = args;
    const access = await assertAccess("document", documentId, "editor");
    const ownerEmail = access.resource.ownerEmail as string;
    const db = getDb();
    const readPage = async () => {
      const [page] = await db
        .select()
        .from(schema.documents)
        .where(
          and(
            eq(schema.documents.id, documentId),
            eq(schema.documents.ownerEmail, ownerEmail),
          ),
        )
        .limit(1);
      assertEditableDocument(page);
      return page;
    };
    const undoEntry = undoGroupId(ctx, args);
    const base = {
      documentId,
      groupId: args.groupId,
    };
    const undoMade = async (reader: ContentDb) =>
      !!firstRow(
        await reader
          .select({ id: schema.documentVersions.id })
          .from(schema.documentVersions)
          .where(
            and(
              eq(schema.documentVersions.ownerEmail, ownerEmail),
              eq(schema.documentVersions.documentId, documentId),
              eq(schema.documentVersions.groupId, undoEntry),
            ),
          )
          .limit(1),
      );
    const replayed = async () => ({
      ...base,
      outcome: "replayed" as const,
      undoGroupId: undoEntry,
      ...documentStateResult(await readPage()),
      idempotency: { key: args.idempotencyKey, result: "replayed" as const },
    });
    const entry = { ownerEmail, documentId, groupId: args.groupId };
    const readChanges = async () => {
      const { changes, hasMore } = await listHistoryEntryChanges({
        db,
        ...entry,
        limit: MAX_UNDO_CHANGES,
      });
      if (hasMore) {
        undoUnavailable(
          "This History entry holds too many changes to undo in one step. Restore one of its checkpoints instead.",
        );
      }
      if (!changes.length) {
        undoUnavailable(
          'This History entry has no change to undo. An entry of kind "legacy", from before History recorded each change, has none; restore one of its checkpoints instead.',
          404,
        );
      }
      return changes;
    };
    if (await undoMade(db)) return replayed();
    const historyGrouping = {
      ...documentHistoryGrouping({
        ...(ctx ? { ctx } : {}),
        operation: UNDO_OPERATION,
      }),
      groupId: undoEntry,
    };
    for (let attempt = 1; ; attempt += 1) {
      const page = await readPage();
      const changes = await readChanges();
      // The undo as the restore last prepared it, from the page it read.
      const prepared = { page, undone: undoChanges(changes, page) };
      const unchanged = () =>
        prepared.undone.title === prepared.page.title &&
        prepared.undone.content === prepared.page.content;
      if (!unchanged()) {
        try {
          const restored = await restoreDocumentState({
            ctx,
            documentId,
            expectedUpdatedAt: page.updatedAt,
            operation: UNDO_OPERATION,
            historyGrouping,
            target: async (current, writer) => {
              // Each write calls this just before writing, the legacy one
              // under the page's lock, so an undo with the same key that
              // landed first is found here instead of written twice.
              if (await undoMade(writer)) throw new UndoAlreadyMade();
              // An agent still at work can add a change to the entry after
              // the undo read it.
              if (
                (await latestHistoryEntryChange({ db: writer, ...entry })) !==
                changes[changes.length - 1]?.after.checkpointId
              )
                entryMovedOn();
              prepared.page = current;
              prepared.undone = undoChanges(changes, current);
              return prepared.undone;
            },
          });
          const { keptBack } = prepared.undone;
          // Which open editors confirmed their title is the restore's to report.
          const { titleFlush, ...restoredPage } = restored;
          return {
            ...base,
            outcome: unchanged()
              ? keptBack.length
                ? ("nothing-undone" as const)
                : ("already-undone" as const)
              : keptBack.length
                ? ("partly-undone" as const)
                : ("undone" as const),
            ...(unchanged() ? {} : { undoGroupId: undoEntry }),
            keptBack,
            ...restoredPage,
            idempotency: {
              key: args.idempotencyKey,
              result: "applied" as const,
            },
          };
        } catch (error) {
          if (error instanceof UndoAlreadyMade) return replayed();
          if (attempt < MAX_UNDO_ATTEMPTS && isDocumentRestoreConflict(error))
            continue;
          throw error;
        }
      }
      // The page may read as undone because an undo with the same key just
      // landed.
      if (await undoMade(db)) return replayed();
      const { keptBack } = prepared.undone;
      return {
        ...base,
        outcome: keptBack.length
          ? ("nothing-undone" as const)
          : ("already-undone" as const),
        keptBack,
        ...documentStateResult(page),
        idempotency: { key: args.idempotencyKey, result: "applied" as const },
      };
    }
  },
});
