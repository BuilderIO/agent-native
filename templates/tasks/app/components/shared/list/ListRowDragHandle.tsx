import { useT } from "@agent-native/core/client";
import { IconGripVertical } from "@tabler/icons-react";

import type {
  ListRowDrag,
  ListRowRowSelection,
} from "@/components/shared/list/ListRow";
import { cn } from "@/lib/utils";

interface ListRowDragHandleProps {
  rowDrag: ListRowDrag;
  rowSelection: ListRowRowSelection;
  displayTitle: string;
  disabled?: boolean;
}

export function ListRowDragHandle({
  rowDrag,
  rowSelection,
  displayTitle,
  disabled = false,
}: ListRowDragHandleProps) {
  const t = useT();
  const { dragHandleProps, isDragging } = rowDrag;
  const { selectionMode } = rowSelection;

  if (!dragHandleProps) return null;

  return (
    <button
      type="button"
      {...dragHandleProps}
      disabled={disabled}
      aria-label={t("common.reorderAriaLabel", { title: displayTitle })}
      onClick={(event) => {
        if (selectionMode) {
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => {
        dragHandleProps.onPointerDown?.(event);
        if (selectionMode) {
          event.stopPropagation();
        }
      }}
      className={cn(
        "flex size-8 shrink-0 cursor-grab items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50",
        isDragging && "cursor-grabbing",
      )}
    >
      <IconGripVertical className="size-4" />
    </button>
  );
}
