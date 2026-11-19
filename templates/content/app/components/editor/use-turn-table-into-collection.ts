import { useT } from "@agent-native/core/client/i18n";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { NodeSelection } from "@tiptap/pm/state";
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
  findUnchangedTable,
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
      const toastId = toast.loading(t("editor.turningIntoCollection"));
      const newDocumentId = crypto.randomUUID();
      const ownerBlockId = `inline-database-${crypto.randomUUID()}`;
      let created = false;
      let replaced = false;
      try {
        const result = await create({
          hostDocumentId: documentId,
          title: t("editor.untitledDatabase"),
          newDocumentId,
          ownerBlockId,
          table: tableCollectionSeed(table.node),
        });
        created = true;
        const current = findUnchangedTable(editor.state.doc, table);
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
        editor.view.dispatch(
          tr.setMeta(LOCAL_FILE_USER_EDIT_META, true).scrollIntoView(),
        );
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
        if (created) {
          try {
            await trash({ id: newDocumentId });
          } catch (trashError) {
            errors.push(trashError);
          }
        }
        toast.error(t("editor.failedToTurnIntoCollection"), {
          id: toastId,
          description: errors
            .map((value) =>
              value instanceof Error ? value.message : t("empty.genericError"),
            )
            .join("; "),
        });
      }
    },
    [bodyIsLiveCopy, create, documentId, editor, persist, t, trash],
  );
  return useCallback((table: TableAt) => void turn(table), [turn]);
}
