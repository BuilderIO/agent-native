import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  sortableKeyboardCoordinates,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

export interface SidebarReorderItem {
  id: string;
  label: string;
  parentId: string | null;
}

export interface SidebarReorderLabels {
  drag: (label: string) => string;
  moveUp: string;
  moveDown: string;
  moveTo: string;
  moveToPosition: (position: number) => string;
}

interface SidebarReorderContextValue {
  items: SidebarReorderItem[];
  activeId: string | null;
  overId: string | null;
  dragBounds: { minY: number; maxY: number } | null;
  registerItemNode: (itemId: string, node: HTMLElement | null) => void;
  onReorder: (
    itemIds: string[],
    moved: { itemId: string; position: number },
  ) => void;
}

const SidebarReorderContext = createContext<SidebarReorderContextValue | null>(
  null,
);
const DRAG_RELEASE_CLICK_WINDOW_MS = 60;

export function isSidebarDragReleaseClick(
  event: Pick<MouseEvent, "button" | "detail" | "target">,
  itemId: string,
) {
  if (event.button !== 0 || event.detail !== 1) return false;
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const row = target.closest<HTMLElement>("[data-sidebar-reorder-item-id]");
  return row?.dataset.sidebarReorderItemId === itemId;
}

export function isPointerSidebarDrag(activatorEvent: Event) {
  return (
    typeof PointerEvent !== "undefined" &&
    activatorEvent instanceof PointerEvent
  );
}

export function reorderedSidebarItemIds(
  items: SidebarReorderItem[],
  activeId: string,
  overId: string,
) {
  const activeIndex = items.findIndex((item) => item.id === activeId);
  const overIndex = items.findIndex((item) => item.id === overId);
  if (activeIndex < 0 || overIndex < 0 || activeIndex === overIndex) {
    return items.map((item) => item.id);
  }
  if (items[activeIndex].parentId !== items[overIndex].parentId) {
    return items.map((item) => item.id);
  }
  const siblingIndexes = items.flatMap((item, index) =>
    item.parentId === items[activeIndex].parentId ? [index] : [],
  );
  const activeSiblingIndex = siblingIndexes.indexOf(activeIndex);
  const overSiblingIndex = siblingIndexes.indexOf(overIndex);
  const reorderedSiblings = arrayMove(
    siblingIndexes.map((index) => items[index]),
    activeSiblingIndex,
    overSiblingIndex,
  );
  const nextItems = [...items];
  siblingIndexes.forEach((index, siblingIndex) => {
    nextItems[index] = reorderedSiblings[siblingIndex];
  });
  return nextItems.map((item) => item.id);
}

export type SidebarDropOutcome =
  | { kind: "claimed" }
  | { kind: "reorder"; itemIds: string[]; position: number }
  | { kind: "none" };

/**
 * `claimDrop` is asked first, before reordering is even computed. A page and a
 * collection are frequently siblings, so a reorder-first order resolves that
 * drop as an ordinary sibling swap and the page is never adopted.
 */
export function resolveSidebarDrop(
  items: SidebarReorderItem[],
  activeId: string,
  overId: string,
  claimDrop?: (activeId: string, overId: string) => boolean,
): SidebarDropOutcome {
  if (claimDrop?.(activeId, overId)) return { kind: "claimed" };
  const currentIds = items.map((item) => item.id);
  const itemIds = reorderedSidebarItemIds(items, activeId, overId);
  if (!itemIds.some((id, index) => id !== currentIds[index])) {
    return { kind: "none" };
  }
  return { kind: "reorder", itemIds, position: itemIds.indexOf(activeId) };
}

export function sidebarReorderAnnouncement(
  items: SidebarReorderItem[],
  itemId: string,
  overId: string | null,
  labels: SidebarReorderLabels,
) {
  const item = items.find((candidate) => candidate.id === itemId);
  if (!item) return undefined;
  const siblings = items.filter(
    (candidate) => candidate.parentId === item.parentId,
  );
  const over = siblings.find((candidate) => candidate.id === overId);
  const position = Math.max(0, siblings.indexOf(over ?? item));
  return `${labels.drag(item.label)}. ${labels.moveToPosition(position + 1)}.`;
}

export function constrainedSidebarTransform<
  Transform extends { x: number; y: number },
>(
  transform: Transform,
  isDragging: boolean,
  bounds: { minY: number; maxY: number } | null,
) {
  return {
    ...transform,
    x: 0,
    y:
      isDragging && bounds
        ? Math.min(Math.max(transform.y, bounds.minY), bounds.maxY)
        : transform.y,
  };
}

export function SidebarReorderProvider({
  items,
  labels,
  onReorder,
  onDropInto,
  children,
}: {
  items: SidebarReorderItem[];
  labels: SidebarReorderLabels;
  onReorder: (
    itemIds: string[],
    moved: { itemId: string; position: number },
  ) => void;
  /**
   * Offered every drop before reordering. Return true to claim it. A page and
   * a collection are often siblings, so a reorder-first check would resolve
   * that drop as a valid sibling swap and the page would never be adopted.
   */
  onDropInto?: (activeItemId: string, overItemId: string) => boolean;
  children: ReactNode;
}) {
  const itemNodes = useRef(new Map<string, HTMLElement>());
  const suppressedClickItemId = useRef<string | null>(null);
  const suppressedClickTimer = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dragBounds, setDragBounds] = useState<{
    minY: number;
    maxY: number;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      sidebarReorderAnnouncement(items, String(active.id), null, labels),
    onDragOver: ({ active, over }) =>
      sidebarReorderAnnouncement(
        items,
        String(active.id),
        over ? String(over.id) : null,
        labels,
      ),
    onDragEnd: ({ active, over }) =>
      sidebarReorderAnnouncement(
        items,
        String(active.id),
        over ? String(over.id) : null,
        labels,
      ),
    onDragCancel: ({ active }) =>
      sidebarReorderAnnouncement(items, String(active.id), null, labels),
  };

  useEffect(() => {
    function preventDraggedLinkNavigation(event: MouseEvent) {
      const itemId = suppressedClickItemId.current;
      if (!itemId || !isSidebarDragReleaseClick(event, itemId)) return;

      event.preventDefault();
      suppressedClickItemId.current = null;
    }

    document.addEventListener("click", preventDraggedLinkNavigation, true);
    return () => {
      document.removeEventListener("click", preventDraggedLinkNavigation, true);
      if (suppressedClickTimer.current) {
        clearTimeout(suppressedClickTimer.current);
      }
    };
  }, []);

  function registerItemNode(itemId: string, node: HTMLElement | null) {
    if (node) itemNodes.current.set(itemId, node);
    else itemNodes.current.delete(itemId);
  }

  function handleDragStart(event: DragStartEvent) {
    const itemId = String(event.active.id);
    const item = items.find((candidate) => candidate.id === itemId);
    const activeNode = itemNodes.current.get(itemId);
    if (!item || !activeNode) return;

    const activeRect = activeNode.getBoundingClientRect();
    const siblingRects = items
      .filter((candidate) => candidate.parentId === item.parentId)
      .flatMap((candidate) => {
        const node = itemNodes.current.get(candidate.id);
        return node ? [node.getBoundingClientRect()] : [];
      });
    setActiveId(itemId);
    setOverId(itemId);
    setDragBounds({
      minY:
        Math.min(...siblingRects.map((rect) => rect.top), activeRect.top) -
        activeRect.top,
      maxY:
        Math.max(
          ...siblingRects.map((rect) => rect.bottom),
          activeRect.bottom,
        ) - activeRect.bottom,
    });
  }

  function handleDragOver(event: DragOverEvent) {
    setOverId(event.over ? String(event.over.id) : null);
  }

  function clearDragState() {
    setActiveId(null);
    setOverId(null);
    setDragBounds(null);
  }

  function suppressReleaseClick(itemId: string) {
    suppressedClickItemId.current = itemId;
    if (suppressedClickTimer.current) {
      clearTimeout(suppressedClickTimer.current);
    }
    suppressedClickTimer.current = setTimeout(() => {
      if (suppressedClickItemId.current === itemId) {
        suppressedClickItemId.current = null;
      }
      suppressedClickTimer.current = null;
    }, DRAG_RELEASE_CLICK_WINDOW_MS);
  }

  function handleDragEnd(event: DragEndEvent) {
    const itemId = String(event.active.id);
    if (isPointerSidebarDrag(event.activatorEvent)) {
      suppressReleaseClick(itemId);
    }
    const overId = event.over?.id;
    if (overId) {
      const outcome = resolveSidebarDrop(
        items,
        itemId,
        String(overId),
        onDropInto,
      );
      if (outcome.kind === "reorder") {
        onReorder(outcome.itemIds, { itemId, position: outcome.position });
      }
    }
    clearDragState();
  }

  return (
    <SidebarReorderContext.Provider
      value={{
        items,
        activeId,
        overId,
        dragBounds,
        registerItemNode,
        onReorder,
      }}
    >
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        autoScroll={false}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={clearDragState}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: `${labels.moveTo}. ${labels.moveUp}. ${labels.moveDown}.`,
          },
        }}
      >
        <SortableContext
          items={items.map((item) => item.id)}
          strategy={verticalListSortingStrategy}
        >
          {children}
        </SortableContext>
      </DndContext>
    </SidebarReorderContext.Provider>
  );
}

export function useSidebarReorderItem(itemId: string) {
  const context = useContext(SidebarReorderContext);
  const sortable = useSortable({ id: itemId, disabled: !context });
  const item = context?.items.find((candidate) => candidate.id === itemId);
  const siblings = item
    ? (context?.items.filter(
        (candidate) => candidate.parentId === item.parentId,
      ) ?? [])
    : [];
  const siblingIndex = siblings.findIndex(
    (candidate) => candidate.id === itemId,
  );
  const activeSiblingIndex = siblings.findIndex(
    (candidate) => candidate.id === context?.activeId,
  );
  const transform = sortable.transform
    ? constrainedSidebarTransform(
        sortable.transform,
        sortable.isDragging,
        context?.dragBounds ?? null,
      )
    : null;
  const dropIndicator: "before" | "after" | null =
    context?.activeId &&
    context.activeId !== itemId &&
    context.overId === itemId &&
    activeSiblingIndex >= 0
      ? activeSiblingIndex < siblingIndex
        ? "after"
        : "before"
      : null;

  function moveToSibling(target: SidebarReorderItem | undefined) {
    if (!context || !target) return;
    const nextIds = reorderedSidebarItemIds(context.items, itemId, target.id);
    context.onReorder(nextIds, {
      itemId,
      position: nextIds.indexOf(itemId),
    });
  }

  return {
    setNodeRef: (node: HTMLElement | null) => {
      sortable.setNodeRef(node);
      context?.registerItemNode(itemId, node);
    },
    style: {
      transform: CSS.Transform.toString(transform),
      transition: sortable.transition,
      opacity: sortable.isDragging ? 0.55 : undefined,
    } satisfies CSSProperties,
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    itemId,
    isDragging: sortable.isDragging,
    dropIndicator,
    siblings,
    siblingIndex,
    moveUp: () => moveToSibling(siblings[siblingIndex - 1]),
    moveDown: () => moveToSibling(siblings[siblingIndex + 1]),
    moveTo: (position: number) => moveToSibling(siblings[position]),
  };
}

export function SidebarDropIndicator({
  placement,
  className,
}: {
  placement: "before" | "after" | null;
  className?: string;
}) {
  if (!placement) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-x-1 z-20 h-0.5 rounded-full bg-foreground",
        placement === "before" ? "-top-px" : "-bottom-px",
        className,
      )}
    />
  );
}
