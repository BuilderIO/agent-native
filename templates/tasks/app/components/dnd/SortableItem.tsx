import type { DraggableAttributes } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties, ReactNode } from "react";
import type { KeyboardEventHandler, PointerEventHandler } from "react";

import { isBlockDragActive } from "@/components/dnd/reorder-moving-items";

type DragListeners = {
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
};

export type SortableItemRenderProps = {
  setNodeRef: (element: HTMLElement | null) => void;
  style: CSSProperties;
  isDragging: boolean;
  hideForBlockDrag: boolean;
  attributes: DraggableAttributes;
  listeners: DragListeners | undefined;
};

/**
 * Inert props for rendering a row outside a sortable context — e.g. the drag
 * overlay, which mounts the real row for its preview but must not register a
 * second sortable node or apply drag transforms.
 */
export const INERT_SORTABLE_PROPS: SortableItemRenderProps = {
  setNodeRef: () => {},
  style: {},
  isDragging: false,
  hideForBlockDrag: false,
  attributes: {} as DraggableAttributes,
  listeners: undefined,
};

interface SortableItemProps {
  id: string;
  activeId: string | null;
  movingIds: Set<string>;
  children: (props: SortableItemRenderProps) => ReactNode;
}

export function SortableItem({
  id,
  activeId,
  movingIds,
  children,
}: SortableItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const hideForBlockDrag =
    isBlockDragActive(activeId, movingIds) && movingIds.has(id);

  return children({
    setNodeRef,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
    },
    isDragging,
    hideForBlockDrag,
    attributes,
    listeners,
  });
}
