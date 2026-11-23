import { useT } from "@agent-native/core/client/i18n";
import type { Transaction } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
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
  findInlineCollection,
  followTable,
  replaceBlockAsOneUndoStep,
  seedFitsCollection,
  tableCollectionSeed,
  tableFitsCollection,
} from "./table-collection";
import type { TableAt } from "./table-commands";

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
      let replaced = false;
      try {
        const result = await create({
          hostDocumentId: documentId,
          title: t("editor.untitledDatabase"),
          newDocumentId,
          ownerBlockId,
          table: seed,
        });
        editor.off("transaction", follow);
        const current = followed.find(editor.state);
        if (!current) throw new Error(t("editor.tableChangedWhileTurning"));
        const block = editor.schema.nodeFromJSON(
          inlineDatabaseBlockContent(result.block),
        );
        replaceBlockAsOneUndoStep(
          editor.view,
          current,
          block,
          LOCAL_FILE_USER_EDIT_META,
        );
        replaced = true;
        await waitForEditorUpdateFrame();
        const content = bodyAfterInsert(editor, ownerBlockId, bodyIsLiveCopy);
        if (content === null || !(await persist(content))) {
          throw new Error(t("empty.genericError"));
        }
        toast.success(t("editor.turnedIntoCollection"), { id: toastId });
      } catch (error) {
        if (replaced) {
          const collection = findInlineCollection(
            editor.state.doc,
            ownerBlockId,
          );
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
        await trash({ id: newDocumentId }).catch(() => undefined);
        toast.error(t("editor.failedToTurnIntoCollection"), {
          id: toastId,
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
      } finally {
        editor.off("transaction", follow);
      }
    },
    [bodyIsLiveCopy, create, documentId, editor, persist, t, trash],
  );
  return useCallback((table: TableAt) => void turn(table), [turn]);
}
