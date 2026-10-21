import { IconGripVertical } from "@tabler/icons-react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  MapDragContext,
  type MapDragContextValue,
  type MapSource,
  type MapTarget,
} from "@/components/workflow-canvas/inspector/map-target";
import { cn } from "@/lib/utils";
import {
  canDrop,
  mappedValue,
  type SourceKind,
} from "@/lib/workflow-editor/drop-paths";

import { useWorkflowStrings } from "../workflow-strings";

/** A press must move this far before it becomes a drag, so a click on a row stays a click. */
const DRAG_THRESHOLD_PX = 10;
/** Over nothing, the pill trails the pointer by this much. */
const TRAIL_PX = 12;
/** Over a target, the pill sits this far inside the target's top-left corner. */
const SNAP_PX = 3;

const FIRST_MAP_KEY = "factory.workflow.nodeData.mappedFirstField";

/** Whether this is the first drop ever made in this browser. With storage blocked the hint stays hidden. */
function isFirstMapEver(): boolean {
  try {
    if (window.localStorage.getItem(FIRST_MAP_KEY) !== null) return false;
    window.localStorage.setItem(FIRST_MAP_KEY, "1");
    return true;
  } catch {
    // coercion-ok: the one-time hint is a convenience; without storage it stays hidden rather than repeating.
    return false;
  }
}

/** The pill's words: the path without the `item.` every item path starts with. */
function labelOf(path: string): string {
  return path.replace(/^item\./, "");
}

/** One mouse press on a grip, from the button going down until it is released or cancelled. */
interface Press {
  source: MapSource;
  startX: number;
  startY: number;
  pointerX: number;
  pointerY: number;
  active: boolean;
  overId: string | null;
  cursor: string;
  finish: () => void;
}

/**
 * Drag-to-map for the details modal. A press on a grip becomes a drag once the
 * pointer has moved, and a release over a path or template field writes the
 * grip's path into it. Escape, or a release anywhere else, cancels.
 */
export function MapDragProvider({
  readOnly,
  onMapped,
  children,
}: {
  readOnly: boolean;
  /** A drop changed a field, so the modal's issue marks show, as they do once a field is left. */
  onMapped: () => void;
  children: ReactNode;
}) {
  const ws = useWorkflowStrings();
  const [drag, setDrag] = useState<MapSource | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [targets] = useState(() => new Map<string, RefObject<MapTarget>>());
  const press = useRef<Press | null>(null);
  const pill = useRef<HTMLSpanElement>(null);

  const place = useCallback((x: number, y: number) => {
    if (pill.current) {
      pill.current.style.transform = `translate(${x}px, ${y}px)`;
    }
  }, []);

  // The pill mounts on the move that starts the drag, so its first position is set after the render.
  useLayoutEffect(() => {
    const current = press.current;
    if (drag && current) {
      place(current.pointerX + TRAIL_PX, current.pointerY + TRAIL_PX);
    }
  }, [drag, place]);

  // A modal that closes mid-drag must not leave its window listeners behind.
  useEffect(() => () => press.current?.finish(), []);

  const register = useCallback(
    (id: string, target: RefObject<MapTarget>) => {
      targets.set(id, target);
      return () => {
        targets.delete(id);
      };
    },
    [targets],
  );

  const startDrag = useCallback(
    (event: ReactMouseEvent, source: MapSource) => {
      if (readOnly || event.button !== 0 || press.current) return;
      // Focus and text selection stay where they are until the drag really starts.
      event.preventDefault();
      const current: Press = {
        source,
        startX: event.clientX,
        startY: event.clientY,
        pointerX: event.clientX,
        pointerY: event.clientY,
        active: false,
        overId: null,
        cursor: "",
        finish,
      };
      press.current = current;

      function finish() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("keydown", onKey, true);
        press.current = null;
        if (current.active) document.body.style.cursor = current.cursor;
        setDrag(null);
        setOverId(null);
      }

      // A field that refuses this value is not a target at all: no snap, no highlight, no drop.
      function targetAt(x: number, y: number) {
        const element = document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-map-target]");
        const id = element?.dataset.mapTarget;
        const target = id ? targets.get(id)?.current : undefined;
        if (!element || !id || !target) return null;
        return canDrop(target.kind, current.source.kind)
          ? { id, element }
          : null;
      }

      function onMove(move: MouseEvent) {
        current.pointerX = move.clientX;
        current.pointerY = move.clientY;
        // No button left: the release happened where no listener heard it.
        if (move.buttons === 0) {
          finish();
          return;
        }
        if (!current.active) {
          const moved = Math.hypot(
            move.clientX - current.startX,
            move.clientY - current.startY,
          );
          if (moved < DRAG_THRESHOLD_PX) return;
          current.active = true;
          current.cursor = document.body.style.cursor;
          document.body.style.cursor = "grabbing";
          (document.activeElement as HTMLElement | null)?.blur();
          setDrag(current.source);
          return;
        }
        const hit = targetAt(move.clientX, move.clientY);
        const over = hit?.id ?? null;
        if (over !== current.overId) {
          current.overId = over;
          setOverId(over);
        }
        if (hit) {
          const box = hit.element.getBoundingClientRect();
          place(box.left + SNAP_PX, box.top + SNAP_PX);
        } else {
          place(move.clientX + TRAIL_PX, move.clientY + TRAIL_PX);
        }
      }

      function onUp(release: MouseEvent) {
        if (current.active) {
          const hit = targetAt(release.clientX, release.clientY);
          const target = hit ? targets.get(hit.id)?.current : undefined;
          if (target) {
            target.onChange(
              mappedValue(target.kind, target.value, current.source.path),
            );
            onMapped();
            if (isFirstMapEver()) toast.success(ws.nodeData.mappedFirstField);
          }
        }
        finish();
      }

      function onKey(key: KeyboardEvent) {
        // Escape ends a drag and must not reach the modal, which would close on it.
        if (key.key !== "Escape" || !current.active) return;
        key.preventDefault();
        key.stopPropagation();
        finish();
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("keydown", onKey, true);
    },
    [onMapped, readOnly, targets, ws],
  );

  const value = useMemo<MapDragContextValue>(
    () => ({
      canDrag: !readOnly,
      source: drag,
      overId,
      startDrag,
      register,
    }),
    [drag, overId, readOnly, register, startDrag],
  );

  return (
    <MapDragContext.Provider value={value}>
      {children}
      {drag
        ? createPortal(
            <span
              ref={pill}
              aria-hidden
              className={cn(
                "pointer-events-none fixed left-0 top-0 z-[450] inline-flex h-6 max-w-64 items-center whitespace-nowrap rounded-sm px-2 text-xs font-medium shadow-md ring-1",
                overId === null
                  ? "bg-accent text-accent-foreground ring-ring/40"
                  : "bg-success/15 text-success ring-success/40",
              )}
            >
              {drag.label}
            </span>,
            document.body,
          )
        : null}
    </MapDragContext.Provider>
  );
}

/**
 * The grip that starts a drag from a field. It shows on the row's hover, and
 * it is left out where the modal takes no drops.
 */
export function MapGrip({ path, kind }: { path: string; kind: SourceKind }) {
  const drag = useContext(MapDragContext);
  const ws = useWorkflowStrings();
  if (!drag?.canDrag) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={ws.nodeData.dragHint}
          className="shrink-0 cursor-grab opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 motion-reduce:transition-none"
          onMouseDown={(event) =>
            drag.startDrag(event, { label: labelOf(path), path, kind })
          }
        >
          <IconGripVertical />
        </Button>
      </TooltipTrigger>
      <TooltipContent>{ws.nodeData.dragHint}</TooltipContent>
    </Tooltip>
  );
}
