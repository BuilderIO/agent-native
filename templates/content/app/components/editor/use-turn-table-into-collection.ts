import { useT } from "@agent-native/core/client/i18n";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { yUndoPluginKey } from "@tiptap/y-tiptap";
import { useCallback } from "react";
import { toast } from "sonner";

import { useCreateInlineContentDatabase } from "@/hooks/use-content-database";
import { useDeleteDocument } from "@/hooks/use-documents";

import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import {
  bodyAfterInsert,
  inlineDatabaseBlockContent,
  waitForEditorUpdateFrame,
} from "./SlashCommandMenu";
import {
  followTable,
  seedFitsCollection,
  tableCollectionSeed,
  tableFitsCollection,
} from "./table-collection";
import type { TableAt } from "./table-commands";

function findInlineCollection(editor: Editor, ownerBlockId: string) {
  let found: { node: ProseMirrorNode; pos: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (found) return false;
    if (
      node.type.name === "registryBlock" &&
      node.attrs.blockType === "inline-database" &&
      node.attrs.blockId === ownerBlockId
    ) {
      found = { node, pos };
    }
    return !found;
  });
  return found as { node: ProseMirrorNode; pos: number } | null;
}

export function useTurnTableIntoCollection({
  editor,
  documentId,
  bodyIsLiveCopy,
  persist,
}: {
  editor: Editor;
  documentId: string | null | undefined;
  bodyIsLiveCopy: boolean;
  persist: (markdown: string) => Promise<boolean>;
}) {
  const t = useT();
  const createInlineDatabase = useCreateInlineContentDatabase(
    documentId ?? null,
  );
  const deleteDocument = useDeleteDocument();
  const { mutateAsync: create } = createInlineDatabase;
  const { mutateAsync: trash } = deleteDocument;

  const turn = useCallback(
    async (table: TableAt) => {
      if (!documentId) return;
      if (!tableFitsCollection(table.node)) {
        toast.error(t("editor.tableTooBigForCollection"));
        return;
      }
      const seed = tableCollectionSeed(table.node);
      if (!seedFitsCollection(seed)) {
        toast.error(t("editor.tableTextTooLongForCollection"));
        return;
      }
      const toastId = toast.loading(t("editor.turningIntoCollection"));
      const newDocumentId = crypto.randomUUID();
      const ownerBlockId = `inline-database-${crypto.randomUUID()}`;
      const followed = followTable(editor.state, table);
      const follow = ({ transaction }: { transaction: Transaction }) =>
        followed.map(transaction);
      editor.on("transaction", follow);
      let created = false;
      let replaced = false;
      try {
        const result = await create({
          hostDocumentId: documentId,
          title: t("editor.untitledDatabase"),
          newDocumentId,
          ownerBlockId,
          table: seed,
        });
        created = true;
        editor.off("transaction", follow);
        const current = followed.find(editor.state);
        if (!current) throw new Error(t("editor.tableChangedWhileTurning"));
        const block = editor.schema.nodeFromJSON(
          inlineDatabaseBlockContent(result.block),
        );
        const tr = editor.state.tr.replaceWith(
          current.pos,
          current.pos + current.node.nodeSize,
          block,
        );
        tr.setSelection(NodeSelection.create(tr.doc, current.pos));
        const undoManager = yUndoPluginKey.getState(editor.state)?.undoManager;
        undoManager?.stopCapturing();
        editor.view.dispatch(
          closeHistory(tr)
            .setMeta(LOCAL_FILE_USER_EDIT_META, true)
            .scrollIntoView(),
        );
        undoManager?.stopCapturing();
        replaced = true;
        await waitForEditorUpdateFrame();
        const content = bodyAfterInsert(editor, ownerBlockId, bodyIsLiveCopy);
        if (content === null || !(await persist(content))) {
          throw new Error(t("empty.genericError"));
        }
        toast.success(t("editor.turnedIntoCollection"), { id: toastId });
      } catch (error) {
        const errors: unknown[] = [error];
        if (replaced) {
          const collection = findInlineCollection(editor, ownerBlockId);
          if (collection) {
            editor.view.dispatch(
              editor.state.tr
                .replaceWith(
                  collection.pos,
                  collection.pos + collection.node.nodeSize,
                  table.node,
                )
                .setMeta(LOCAL_FILE_USER_EDIT_META, true),
            );
          }
        }
        try {
          await trash({ id: newDocumentId });
        } catch (trashError) {
          if (created) errors.push(trashError);
        }
        toast.error(t("editor.failedToTurnIntoCollection"), {
          id: toastId,
          description: errors
            .map((value) =>
              value instanceof Error ? value.message : t("empty.genericError"),
            )
            .join("; "),
        });
      } finally {
        editor.off("transaction", follow);
      }
    },
    [bodyIsLiveCopy, create, documentId, editor, persist, t, trash],
  );
  return useCallback((table: TableAt) => void turn(table), [turn]);
}
