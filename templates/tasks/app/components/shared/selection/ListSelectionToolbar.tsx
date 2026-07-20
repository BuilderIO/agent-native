import { useT } from "@agent-native/core/client";
import { IconTrash, IconX } from "@tabler/icons-react";
import { type ReactNode } from "react";

import { type ListSelectionActions } from "@/components/shared/selection/use-list-selection";
import { Button } from "@/components/ui/button";

interface ListSelectionToolbarProps {
  ariaLabel: string;
  emptySelectionHint: string;
  visibleCount: number;
  selectedCount: number;
  allVisibleSelected: boolean;
  toolbarDisabled: boolean;
  selectionActions: ListSelectionActions;
  onOpenBulkDelete: () => void;
  children?: ReactNode;
}

export function ListSelectionToolbar({
  ariaLabel,
  emptySelectionHint,
  visibleCount,
  selectedCount,
  allVisibleSelected,
  toolbarDisabled,
  selectionActions,
  onOpenBulkDelete,
  children,
}: ListSelectionToolbarProps) {
  const t = useT();
  const statusText =
    selectedCount === 0
      ? emptySelectionHint
      : selectedCount > 1
        ? t("selection.selectedCountReorder", { count: selectedCount })
        : t("selection.selectedCount", { count: selectedCount });

  return (
    <div
      className="flex h-12 items-center gap-2 px-1"
      role="toolbar"
      aria-label={ariaLabel}
    >
      <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
        {statusText}
      </p>
      <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-xs"
          disabled={toolbarDisabled || visibleCount === 0}
          onClick={selectionActions.selectAll}
        >
          {allVisibleSelected
            ? t("selection.clearAll")
            : t("selection.selectAll")}
        </Button>
        {children}
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs text-destructive hover:text-destructive"
          disabled={selectedCount === 0 || toolbarDisabled}
          aria-label={t("common.delete")}
          onClick={onOpenBulkDelete}
        >
          <IconTrash className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t("common.delete")}</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={toolbarDisabled}
          onClick={selectionActions.clearSelection}
          aria-label={t("selection.exitSelectionMode")}
        >
          <IconX className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
