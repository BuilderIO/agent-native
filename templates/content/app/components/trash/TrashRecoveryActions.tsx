import { useT } from "@agent-native/core/client/i18n";
import type { ContentTrashItem } from "@shared/content-trash";
import { IconArrowBackUp, IconTrashX } from "@tabler/icons-react";
import type { Ref } from "react";

import { ContentTableSelectionBar } from "@/components/editor/database/ContentTable";
import { Button } from "@/components/ui/button";
import {
  type ContentTrashSelection,
  trashRestoreTargets,
  trashSelectionCount,
} from "@/hooks/use-content-trash";

export function TrashRecoveryActions({
  selection,
  selectedItems,
  pendingRestore,
  onRestore,
  onSelectMatching,
  onClear,
  onDelete,
  deleteRef,
}: {
  selection: ContentTrashSelection;
  selectedItems: ContentTrashItem[];
  pendingRestore: boolean;
  onRestore: () => void;
  onSelectMatching: () => void;
  onClear: () => void;
  onDelete: () => void;
  deleteRef?: Ref<HTMLButtonElement>;
}) {
  const t = useT();
  const selectedCount = trashSelectionCount(selection);
  const canRestore =
    selection.mode === "loaded" &&
    trashRestoreTargets(selectedItems).length > 0;

  return (
    <ContentTableSelectionBar
      label={
        selection.mode === "matching"
          ? t("trash.allMatchingSelected")
          : t("trash.selected", { count: selectedCount ?? 0 })
      }
    >
      {selection.mode === "loaded" ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={onSelectMatching}
        >
          {t("trash.selectAllMatching")}
        </Button>
      ) : null}
      {canRestore ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          disabled={pendingRestore}
          onClick={onRestore}
        >
          <IconArrowBackUp className="size-3.5" />
          {t("trash.restore")}
        </Button>
      ) : null}
      <Button
        ref={deleteRef}
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={onDelete}
      >
        <IconTrashX className="size-3.5" />
        {t("trash.deletePermanently")}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={onClear}
      >
        {t("trash.cancel")}
      </Button>
    </ContentTableSelectionBar>
  );
}
