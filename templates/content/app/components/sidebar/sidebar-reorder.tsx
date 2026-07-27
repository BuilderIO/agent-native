import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
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
  IconChevronDown,
  IconChevronUp,
  IconGripVertical,
  IconListNumbers,
} from "@tabler/icons-react";
import {
  createContext,
  useContext,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu";
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
  onReorder: (
    itemIds: string[],
    moved: { itemId: string; position: number },
  ) => void;
}

const SidebarReorderContext = createContext<SidebarReorderContextValue | null>(
  null,
);

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

export function SidebarReorderProvider({
  items,
  labels,
  onReorder,
  children,
}: {
  items: SidebarReorderItem[];
  labels: SidebarReorderLabels;
  onReorder: (
    itemIds: string[],
    moved: { itemId: string; position: number },
  ) => void;
  children: ReactNode;
}) {
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

  function handleDragEnd(event: DragEndEvent) {
    const overId = event.over?.id;
    if (!overId) return;
    const currentIds = items.map((item) => item.id);
    const nextIds = reorderedSidebarItemIds(
      items,
      String(event.active.id),
      String(overId),
    );
    if (nextIds.some((id, index) => id !== currentIds[index])) {
      const itemId = String(event.active.id);
      onReorder(nextIds, { itemId, position: nextIds.indexOf(itemId) });
    }
  }

  return (
    <SidebarReorderContext.Provider value={{ items, onReorder }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
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

  function moveToSibling(target: SidebarReorderItem | undefined) {
    if (!context || !target) return;
    const nextIds = reorderedSidebarItemIds(context.items, itemId, target.id);
    context.onReorder(nextIds, {
      itemId,
      position: nextIds.indexOf(itemId),
    });
  }

  return {
    setNodeRef: sortable.setNodeRef,
    style: {
      transform: CSS.Transform.toString(sortable.transform),
      transition: sortable.transition,
      opacity: sortable.isDragging ? 0.55 : undefined,
    } satisfies CSSProperties,
    attributes: sortable.attributes,
    listeners: sortable.listeners,
    isDragging: sortable.isDragging,
    siblings,
    siblingIndex,
    moveUp: () => moveToSibling(siblings[siblingIndex - 1]),
    moveDown: () => moveToSibling(siblings[siblingIndex + 1]),
    moveTo: (position: number) => moveToSibling(siblings[position]),
  };
}

export function SidebarDragHandle({
  label,
  reorder,
  className,
}: {
  label: string;
  reorder: ReturnType<typeof useSidebarReorderItem>;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex size-6 cursor-grab touch-none items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing",
        className,
      )}
      aria-label={label}
      {...reorder.attributes}
      {...reorder.listeners}
    >
      <IconGripVertical className="size-3.5" />
    </button>
  );
}

export function SidebarReorderMenuItems({
  reorder,
  labels,
}: {
  reorder: ReturnType<typeof useSidebarReorderItem>;
  labels: SidebarReorderLabels;
}) {
  return (
    <>
      <DropdownMenuItem
        disabled={reorder.siblingIndex <= 0}
        onSelect={reorder.moveUp}
      >
        <IconChevronUp className="me-2 size-4" />
        {labels.moveUp}
      </DropdownMenuItem>
      <DropdownMenuItem
        disabled={reorder.siblingIndex >= reorder.siblings.length - 1}
        onSelect={reorder.moveDown}
      >
        <IconChevronDown className="me-2 size-4" />
        {labels.moveDown}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <IconListNumbers className="me-2 size-4" />
          {labels.moveTo}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {reorder.siblings.map((sibling, position) => (
            <DropdownMenuItem
              key={sibling.id}
              disabled={position === reorder.siblingIndex}
              onSelect={() => reorder.moveTo(position)}
            >
              {labels.moveToPosition(position + 1)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}
