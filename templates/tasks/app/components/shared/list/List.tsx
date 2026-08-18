import { useMemo, type ReactNode } from "react";

import { SortableList } from "@/components/dnd/SortableList";
import type {
  SortableListRenderItemProps,
  SortableListRenderOverlayProps,
} from "@/components/dnd/SortableList";
import type { ListIdentifiable } from "@/components/shared/list/types";
import type { ListSelection } from "@/components/shared/selection/use-list-selection";

/**
 * Generic sortable list shell.
 *
 * Composers own scroll layout, loading, empty states, and row UI; `List` wires
 * dnd-kit reordering, listbox ARIA when bulk selection is active, and block-drag
 * for selected items.
 */
export interface ListProps<T extends ListIdentifiable> {
  items: T[];
  ariaLabel: string;
  onReorder: (nextItems: T[]) => void;
  renderItem: (props: SortableListRenderItemProps<T>) => ReactNode;
  renderOverlay?: (props: SortableListRenderOverlayProps<T>) => ReactNode;
  selection?: ListSelection<T>;
  selectionEnabled?: boolean;
  listClassName?: string;
}

export function List<T extends ListIdentifiable>({
  items,
  ariaLabel,
  onReorder,
  renderItem,
  renderOverlay,
  selection,
  selectionEnabled = true,
  listClassName,
}: ListProps<T>) {
  const selectionActive =
    selectionEnabled && (selection?.state.selectionMode ?? false);
  const movingIds = useMemo(() => {
    if (!selectionEnabled || !selection) return new Set<string>();
    return new Set(selection.state.selectedItems.map((item) => item.id));
  }, [selection, selectionEnabled]);

  return (
    <div
      role={selectionActive ? "listbox" : "region"}
      aria-label={ariaLabel}
      aria-multiselectable={selectionActive ? true : undefined}
      tabIndex={selectionActive ? 0 : undefined}
    >
      <SortableList
        items={items}
        movingIds={movingIds}
        onReorder={onReorder}
        renderItem={renderItem}
        renderOverlay={renderOverlay}
        listClassName={listClassName}
      />
    </div>
  );
}
