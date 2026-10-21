import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import {
  canDrop,
  type MapKind,
  type SourceKind,
} from "@/lib/workflow-editor/drop-paths";

/** A path or template field, as the drag controller sees it when a drop lands. */
export interface MapTarget {
  kind: MapKind;
  value: string;
  onChange: (next: string) => void;
}

/** What a drag carries: the words on its pill, the path it writes, and the kind of value at that path. */
export interface MapSource {
  label: string;
  path: string;
  kind: SourceKind;
}

/**
 * Provided by the details modal around its panes. Without it no field is a drop
 * target and no grip shows.
 */
export interface MapDragContextValue {
  /** False for a read-only modal: no grips, and no drag can start. */
  canDrag: boolean;
  /** The source being dragged, or null when no drag is in progress. */
  source: MapSource | null;
  /** The id of the target under the pointer while dragging. Only a target that accepts the source is ever under it. */
  overId: string | null;
  startDrag: (event: ReactMouseEvent, source: MapSource) => void;
  /** Returns the function that removes the target again. */
  register: (id: string, target: RefObject<MapTarget>) => () => void;
}

export const MapDragContext = createContext<MapDragContextValue | null>(null);

/** Attributes for a drop target's element: the id the controller finds under the pointer, and the highlight. */
export interface MapTargetProps {
  "data-map-target"?: string;
  className?: string;
}

/**
 * Makes a path or template field a drop target. The field's element carries the
 * id. While a drag is in progress it is highlighted, unless it refuses the
 * dragged value: a refused field shows no highlight at all.
 */
export function useMapTarget(
  kind: MapKind,
  value: string,
  onChange: (next: string) => void,
): MapTargetProps {
  const drag = useContext(MapDragContext);
  const register = drag?.register;
  const id = useId();
  const latest = useRef<MapTarget>({ kind, value, onChange });
  useEffect(() => {
    latest.current = { kind, value, onChange };
  });
  useEffect(() => register?.(id, latest), [register, id]);

  if (!drag) return {};
  if (!drag.source) return { "data-map-target": id };
  if (drag.overId === id) {
    return {
      "data-map-target": id,
      className: "ring-2 ring-success bg-success/10",
    };
  }
  return {
    "data-map-target": id,
    className: canDrop(kind, drag.source.kind)
      ? "ring-2 ring-ring/40"
      : undefined,
  };
}
