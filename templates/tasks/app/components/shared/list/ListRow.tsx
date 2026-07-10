import {
  type AnimationEvent,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from "react";

import { getSortableDragProps } from "@/components/dnd/sortable-drag-props";
import type { SortableItemRenderProps } from "@/components/dnd/SortableItem";
import { SortableListItemShell } from "@/components/shared/list/SortableListItemShell";
import type { ListIdentifiable } from "@/components/shared/list/types";
import { getListRowSelectionUi } from "@/components/shared/selection/get-list-row-selection-ui";
import type { ListSelection } from "@/components/shared/selection/use-list-selection";
import { cn } from "@/lib/utils";

export type { ListIdentifiable } from "@/components/shared/list/types";

export type ListRowDrag = {
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  titleDragProps?: HTMLAttributes<HTMLButtonElement>;
  isDragging: boolean;
};

export type ListRowRowSelection = {
  selectionMode: boolean;
  selected: boolean;
  selectRow: (event: MouseEvent<Element>) => void;
};

export type ListRowRenderArgs = {
  rowDrag: ListRowDrag;
  rowSelection: ListRowRowSelection;
};

export type ListRowDataAttributes = Record<`data-${string}`, string>;

export interface ListRowProps<T extends ListIdentifiable> {
  sortable: SortableItemRenderProps;
  item: T;
  itemLabel: string;
  selection?: ListSelection<T>;
  highlighted?: boolean;
  onActivate?: () => void;
  onAnimationEnd?: (event: AnimationEvent<HTMLDivElement>) => void;
  dataAttributes?: ListRowDataAttributes;
  className?: string;
  children: (args: ListRowRenderArgs) => ReactNode;
}

function isInteractiveTarget(
  target: EventTarget | null,
  currentTarget: HTMLElement,
) {
  const interactive = (target as HTMLElement | null)?.closest(
    'button, input, textarea, select, a, [role="button"], [data-radix-collection-item]',
  );
  return Boolean(interactive && interactive !== currentTarget);
}

export function ListRow<T extends ListIdentifiable>({
  sortable,
  item,
  itemLabel,
  selection,
  highlighted = false,
  onActivate,
  onAnimationEnd,
  dataAttributes,
  className,
  children,
}: ListRowProps<T>) {
  const selectionMode = selection?.state.selectionMode ?? false;
  const selected =
    selection?.state.selectedItems.some((entry) => entry.id === item.id) ??
    false;
  const selectedItemsCount = selection?.state.selectedItems.length ?? 0;
  const activateEnabled = Boolean(onActivate) && !selectionMode;

  function selectRow(event: MouseEvent<Element>) {
    selection?.actions.selectRow(item.id, event);
  }

  const rowDragEnabled = !selectionMode;
  const gripDragEnabled = !selectionMode || selectedItemsCount > 0;
  const { dragHandleProps, rowDragProps, titleDragProps } =
    getSortableDragProps(sortable.attributes, sortable.listeners);
  const isDragging = sortable.isDragging;
  const gatedRowDragProps = rowDragEnabled ? rowDragProps : undefined;
  const renderArgs: ListRowRenderArgs = {
    rowDrag: {
      dragHandleProps: gripDragEnabled ? dragHandleProps : undefined,
      titleDragProps: rowDragEnabled ? titleDragProps : undefined,
      isDragging,
    },
    rowSelection: {
      selectionMode,
      selected,
      selectRow,
    },
  };

  const selectionUi = getListRowSelectionUi({
    selectionMode,
    selected,
    itemLabel,
    onRowSelect: selection ? selectRow : undefined,
  });

  function handleRowClick(event: MouseEvent<HTMLDivElement>) {
    selectionUi.onClick?.(event);
    if (event.defaultPrevented) return;
    if (
      activateEnabled &&
      !isInteractiveTarget(event.target, event.currentTarget)
    ) {
      onActivate?.();
    }
  }

  function handleRowKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!activateEnabled || event.defaultPrevented) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    onActivate?.();
  }

  return (
    <SortableListItemShell
      setNodeRef={sortable.setNodeRef}
      style={sortable.style}
      isDragging={sortable.isDragging}
      hideForBlockDrag={sortable.hideForBlockDrag}
    >
      <div
        {...dataAttributes}
        {...gatedRowDragProps}
        role={activateEnabled ? "button" : selectionUi.role}
        tabIndex={activateEnabled ? 0 : undefined}
        aria-selected={selectionUi["aria-selected"]}
        aria-label={selectionUi["aria-label"]}
        onClick={handleRowClick}
        onKeyDown={handleRowKeyDown}
        onAnimationEnd={onAnimationEnd}
        className={cn(
          "group flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2",
          gatedRowDragProps && "cursor-pointer",
          selectionUi.className,
          highlighted &&
            !selectionMode &&
            "border-ring shadow-[inset_0_0_0_2px_hsl(var(--ring))]",
          isDragging && "shadow-md ring-1 ring-border",
          className,
        )}
        data-list-row-id={item.id}
      >
        {children(renderArgs)}
      </div>
    </SortableListItemShell>
  );
}
