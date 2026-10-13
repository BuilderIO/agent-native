import { useT } from "@agent-native/core/client/i18n";
import type { ContentTrashItem } from "@shared/content-trash";
import { IconRestore, IconTrashX } from "@tabler/icons-react";
import type { Ref } from "react";

import { ContentTableSelectionBar } from "@/components/editor/database/ContentTable";
import { Button } from "@/components/ui/button";
import {
  type ContentTrashSelection,
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
    selectedItems.length === 1 &&
    selectedItems[0]?.canRestore;

  return (
    <ContentTableSelectionBar
      label={
        selection.mode === "matching"
          ? t("trash.allMatchingSelected")
          : t("trash.selected", { count: selectedCount ?? 0 })
      }
    >
      {selection.mode === "loaded" ? (
        <Button size="sm" variant="ghost" onClick={onSelectMatching}>
          {t("trash.selectAllMatching")}
        </Button>
      ) : null}
      {canRestore ? (
        <Button
          size="sm"
          variant="outline"
          disabled={pendingRestore}
          onClick={onRestore}
        >
          <IconRestore size={15} />
          {t("trash.restore")}
        </Button>
      ) : (
        <span className="px-1 text-xs text-muted-foreground">
          {t("trash.bulkRestoreUnsupported")}
        </span>
      )}
      <Button ref={deleteRef} size="sm" variant="ghost" onClick={onDelete}>
        <IconTrashX size={15} />
        {t("trash.deletePermanently")}
      </Button>
      <Button size="sm" variant="ghost" onClick={onClear}>
        {t("trash.cancel")}
      </Button>
    </ContentTableSelectionBar>
  );
}
