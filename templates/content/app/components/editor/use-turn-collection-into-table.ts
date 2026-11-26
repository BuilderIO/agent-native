import { callAction } from "@agent-native/core/client/hooks";
import { useT } from "@agent-native/core/client/i18n";
import type { InlineDatabaseData } from "@shared/inline-database-block";
import { parseRegistryBlockData } from "@shared/nfm-registry";
import { TABLE_COLLECTION_MAX_COLUMNS } from "@shared/table-collection-seed";
import type { Editor } from "@tiptap/react";
import { useCallback } from "react";
import { toast } from "sonner";

import { defaultDatabaseExportPropertyIds } from "./database/DatabaseExportDialog";
import { shownInlineCollectionView } from "./database/inline-collection-views";
import { LOCAL_FILE_USER_EDIT_META } from "./extensions/LocalMdxComponentNode";
import {
  collectionTableContent,
  findInlineCollection,
  replaceBlockAsOneUndoStep,
} from "./table-collection";
import type { TableAt } from "./table-commands";

type CollectionTableRead =
  | { fits: true; properties: string[]; rows: string[][] }
  | { fits: false; rowCount: number };

async function inlineCollectionData(block: TableAt) {
  const raw = block.node.attrs.__raw;
  const parsed =
    typeof raw === "string" && raw ? await parseRegistryBlockData(raw) : null;
  return parsed?.type === "inline-database"
    ? (parsed.data as InlineDatabaseData)
    : null;
}

export function useTurnCollectionIntoTable(editor: Editor) {
  const t = useT();

  const turn = useCallback(
    async (block: TableAt) => {
      const ownerBlockId = block.node.attrs.blockId;
      const toastId = toast.loading(t("editor.turningIntoTable"));
      try {
        const data = await inlineCollectionData(block);
        if (!data?.databaseDocumentId || typeof ownerBlockId !== "string") {
          throw new Error(t("empty.genericError"));
        }
        const view = shownInlineCollectionView(data.databaseDocumentId);
        if (!view) throw new Error(t("editor.collectionStillLoading"));
        const propertyIds = defaultDatabaseExportPropertyIds(view.properties);
        const read =
          propertyIds.length < TABLE_COLLECTION_MAX_COLUMNS
            ? await callAction<CollectionTableRead>(
                "read-collection-table",
                {
                  documentId: data.databaseDocumentId,
                  viewId: view.viewId,
                  tableQuery: view.query,
                  propertyIds,
                },
                { method: "POST" },
              )
            : null;
        if (!read?.fits) {
          toast.error(t("editor.collectionTooBigForTable"), { id: toastId });
          return;
        }
        const current = findInlineCollection(editor.state.doc, ownerBlockId);
        if (!current?.node.eq(block.node)) {
          throw new Error(t("editor.collectionChangedWhileTurning"));
        }
        replaceBlockAsOneUndoStep(
          editor.view,
          current,
          editor.schema.nodeFromJSON(
            collectionTableContent(
              [t("database.name"), ...read.properties],
              read.rows,
            ),
          ),
          LOCAL_FILE_USER_EDIT_META,
        );
        toast.success(t("editor.turnedIntoTable"), { id: toastId });
      } catch (error) {
        toast.error(t("editor.failedToTurnIntoTable"), {
          id: toastId,
          description:
            error instanceof Error ? error.message : t("empty.genericError"),
        });
      }
    },
    [editor, t],
  );
  return useCallback((block: TableAt) => void turn(block), [turn]);
}
