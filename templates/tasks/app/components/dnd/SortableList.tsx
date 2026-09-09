import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  getDragOverlayItem,
  isBlockDragActive,
  reorderMovingItems,
} from "@/components/dnd/reorder-moving-items";
import {
  SortableItem,
  type SortableItemRenderProps,
} from "@/components/dnd/SortableItem";

export interface SortableListRenderItemProps<T extends { id: string }> {
  item: T;
  sortable: SortableItemRenderProps;
}

export interface SortableListRenderOverlayProps<T extends { id: string }> {
  item: T;
  blockDragCount?: number;
}

export interface SortableListProps<T extends { id: string }> {
  items: T[];
  movingIds: Set<string>;
  onReorder: (nextItems: T[]) => void;
  renderItem: (props: SortableListRenderItemProps<T>) => ReactNode;
  renderOverlay?: (props: SortableListRenderOverlayProps<T>) => ReactNode;
  listClassName?: string;
}

export function SortableList<T extends { id: string }>({
  items,
  movingIds,
  onReorder,
  renderItem,
  renderOverlay,
  listClassName = "space-y-2 pb-6",
}: SortableListProps<T>) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const orderedIds = items.map((item) => item.id);
  const blockDragActive = isBlockDragActive(activeId, movingIds);
  const overlayItem = getDragOverlayItem(items, activeId, movingIds);
  const blockDragCount = blockDragActive ? movingIds.size : undefined;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragCancel() {
    setActiveId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const nextItems = reorderMovingItems(
      items,
      String(active.id),
      String(over.id),
      movingIds,
    );
    const unchanged =
      nextItems.length === items.length &&
      nextItems.every((item, index) => item.id === items[index]?.id);
    if (unchanged) return;

    onReorder(nextItems);
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <SortableContext
        items={orderedIds}
        strategy={verticalListSortingStrategy}
      >
        <div className={listClassName}>
          {items.map((item) => (
            <SortableItem
              key={item.id}
              id={item.id}
              activeId={activeId}
              movingIds={movingIds}
            >
              {(sortable) => renderItem({ item, sortable })}
            </SortableItem>
          ))}
        </div>
      </SortableContext>
      {renderOverlay && typeof document !== "undefined"
        ? createPortal(
            <DragOverlay dropAnimation={null} zIndex={1000}>
              {overlayItem ? (
                <div aria-hidden="true" className="w-full">
                  {renderOverlay({ item: overlayItem, blockDragCount })}
                </div>
              ) : null}
            </DragOverlay>,
            document.body,
          )
        : null}
    </DndContext>
  );
}
