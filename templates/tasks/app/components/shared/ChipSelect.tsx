import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { IconChevronDown, IconGripVertical, IconX } from "@tabler/icons-react";
import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ChipSelectOption = {
  id: string;
  label: string;
};

type ChipSelectProps = {
  label: string;
  options: ChipSelectOption[];
  selectedIds: string[];
  onSelectedIdsChange: (ids: string[]) => void;
  disabled?: boolean;
  limit?: number;
  addButtonLabel?: string;
  emptyLabel?: string;
  sortable?: boolean;
};

function ChipSelectChip({
  option,
  disabled,
  sortable,
  onRemove,
}: {
  option: ChipSelectOption;
  disabled: boolean;
  sortable: boolean;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: option.id, disabled: disabled || !sortable });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "inline-flex h-8 max-w-56 items-center gap-1.5 rounded-md border border-transparent bg-secondary px-2 text-sm font-medium text-secondary-foreground transition-colors",
        sortable && !disabled && "cursor-pointer",
        isDragging && "opacity-60 ring-1 ring-ring",
      )}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...(sortable ? attributes : undefined)}
      {...(sortable ? listeners : undefined)}
    >
      {sortable ? (
        <IconGripVertical className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      <span className="min-w-0 truncate">{option.label}</span>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        disabled={disabled}
        aria-label={`Remove ${option.label}`}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          onRemove();
        }}
        className="ml-0.5 size-5 shrink-0 rounded-sm text-muted-foreground hover:bg-background hover:text-foreground [&_svg]:size-3.5"
      >
        <IconX />
      </Button>
    </div>
  );
}

export function ChipSelect({
  label,
  options,
  selectedIds,
  onSelectedIdsChange,
  disabled = false,
  limit,
  addButtonLabel = "Add",
  emptyLabel = "None selected",
  sortable = true,
}: ChipSelectProps) {
  const optionsById = useMemo(
    () => new Map(options.map((option) => [option.id, option])),
    [options],
  );
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedOptions = useMemo(
    () =>
      selectedIds
        .map((id) => optionsById.get(id))
        .filter((option): option is ChipSelectOption => Boolean(option)),
    [optionsById, selectedIds],
  );
  const availableOptions = useMemo(
    () => options.filter((option) => !selectedIdSet.has(option.id)),
    [options, selectedIdSet],
  );
  const atLimit = limit !== undefined && selectedOptions.length >= limit;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  function addOption(option: ChipSelectOption) {
    if (atLimit) return;
    onSelectedIdsChange([...selectedIds, option.id]);
  }

  function removeOption(option: ChipSelectOption) {
    onSelectedIdsChange(selectedIds.filter((id) => id !== option.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (disabled || !sortable || !over || active.id === over.id) return;

    const activeId = String(active.id);
    const overId = String(over.id);
    const oldIndex = selectedOptions.findIndex(
      (option) => option.id === activeId,
    );
    const newIndex = selectedOptions.findIndex(
      (option) => option.id === overId,
    );
    if (oldIndex < 0 || newIndex < 0) return;

    onSelectedIdsChange(
      arrayMove(selectedOptions, oldIndex, newIndex).map((option) => option.id),
    );
  }

  const chips = (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      {selectedOptions.map((option) => (
        <ChipSelectChip
          key={option.id}
          option={option}
          disabled={disabled}
          sortable={sortable}
          onRemove={() => removeOption(option)}
        />
      ))}
    </div>
  );

  return (
    <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <Label className="text-sm font-medium">{label}</Label>
        {limit !== undefined ? (
          <span className="text-xs text-muted-foreground">
            {selectedOptions.length}/{limit}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {selectedOptions.length === 0 ? (
          <span className="text-sm text-muted-foreground">{emptyLabel}</span>
        ) : sortable ? (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={selectedOptions.map((option) => option.id)}
              strategy={horizontalListSortingStrategy}
            >
              {chips}
            </SortableContext>
          </DndContext>
        ) : (
          chips
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={disabled || availableOptions.length === 0 || atLimit}
              className="h-8 gap-1.5 px-2"
            >
              {addButtonLabel}
              <IconChevronDown className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {availableOptions.map((option) => (
              <DropdownMenuItem
                key={option.id}
                disabled={disabled}
                onSelect={() => addOption(option)}
              >
                <span className="min-w-0 truncate">{option.label}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
