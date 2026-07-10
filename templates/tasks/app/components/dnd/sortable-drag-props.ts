import type { DraggableAttributes } from "@dnd-kit/core";
import type {
  HTMLAttributes,
  KeyboardEventHandler,
  PointerEvent,
  PointerEventHandler,
} from "react";

type DragListeners = {
  onPointerDown?: PointerEventHandler<HTMLElement>;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
};

function sharedSortableProps(
  attributes: DraggableAttributes,
  listeners: DragListeners | undefined,
): HTMLAttributes<HTMLElement> {
  return {
    ...attributes,
    ...(listeners?.onKeyDown
      ? {
          onKeyDown:
            listeners.onKeyDown as KeyboardEventHandler<HTMLElement>,
        }
      : {}),
  };
}

/** Map dnd-kit sortable listeners onto common drag surfaces (grip, row, title). */
export function getSortableDragProps(
  attributes: DraggableAttributes,
  listeners: DragListeners | undefined,
) {
  const shared = sharedSortableProps(attributes, listeners);
  const pointerDown = listeners?.onPointerDown;

  return {
    dragHandleProps: {
      ...shared,
      ...(pointerDown
        ? {
            onPointerDown:
              pointerDown as PointerEventHandler<HTMLButtonElement>,
          }
        : {}),
    },
    rowDragProps: pointerDown
      ? {
          onPointerDown:
            pointerDown as PointerEventHandler<HTMLDivElement>,
        }
      : undefined,
    titleDragProps: pointerDown
      ? {
          onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
            pointerDown(event);
            event.stopPropagation();
          },
        }
      : undefined,
  };
}
