import { useRef, useState, type DragEvent } from "react";

/** Dragged payload type; text dragged out of an editor never carries it. */
export const CELL_DRAG_TYPE = "application/x-analytics-notebook-cell";

export type CellDropPlacement = "before" | "after" | "inside";

export interface CellDropTarget {
  cellId: string;
  placement: CellDropPlacement;
}

function carriesCell(event: DragEvent): boolean {
  return Array.from(event.dataTransfer.types).includes(CELL_DRAG_TYPE);
}

function placementAt(
  event: DragEvent<HTMLElement>,
  section: boolean,
): CellDropPlacement {
  const box = event.currentTarget.getBoundingClientRect();
  const offset = event.clientY - box.top;
  if (section && offset >= box.height / 4 && offset <= (box.height * 3) / 4)
    return "inside";
  return offset < box.height / 2 ? "before" : "after";
}

/**
 * Grip props for one cell: only the grip starts a drag, so the SQL editor's
 * own text selection and text dragging are left alone.
 */
export function useCellDragSource(cellId: string) {
  const [dragging, setDragging] = useState(false);
  return {
    dragging,
    gripProps: {
      draggable: true as const,
      onDragStart: (event: DragEvent<HTMLElement>) => {
        event.stopPropagation();
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(CELL_DRAG_TYPE, cellId);
        const cell = event.currentTarget.closest("[data-notebook-cell]");
        if (cell != null) event.dataTransfer.setDragImage(cell, 0, 0);
        setDragging(true);
      },
      onDragEnd: () => setDragging(false),
    },
  };
}

/**
 * Drop props for one cell. `onDrop` is absent while the notebook cannot move
 * cells (read-only, saving, running), and then nothing accepts a drag.
 */
export function useCellDropTarget(
  onDrop:
    | ((draggedCellId: string, placement: CellDropPlacement) => void)
    | undefined,
  target: "relative" | "section" | "inside" = "relative",
) {
  const [placement, setPlacement] = useState<CellDropPlacement | null>(null);
  const depth = useRef(0);
  const reset = () => {
    depth.current = 0;
    setPlacement(null);
  };
  const placementFor = (event: DragEvent<HTMLElement>) =>
    target === "inside" ? target : placementAt(event, target === "section");
  if (onDrop == null) return { placement: null, dropProps: {} };
  return {
    placement,
    dropProps: {
      onDragEnter: (event: DragEvent<HTMLElement>) => {
        if (carriesCell(event)) depth.current += 1;
      },
      onDragOver: (event: DragEvent<HTMLElement>) => {
        if (!carriesCell(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setPlacement(placementFor(event));
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        if (!carriesCell(event)) return;
        depth.current -= 1;
        if (depth.current <= 0) reset();
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        if (!carriesCell(event)) return;
        event.preventDefault();
        const draggedCellId = event.dataTransfer.getData(CELL_DRAG_TYPE);
        event.stopPropagation();
        const at = placementFor(event);
        reset();
        if (draggedCellId !== "") onDrop(draggedCellId, at);
      },
    },
  };
}
