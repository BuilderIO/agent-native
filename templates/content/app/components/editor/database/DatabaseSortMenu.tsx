import {
  FilterFieldPicker,
  useFilterText,
  type FilterField,
} from "@agent-native/toolkit/app/filters";
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
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DragCss } from "@dnd-kit/utilities";
import type { DocumentProperty } from "@shared/api";
import {
  IconArrowsSort,
  IconChevronDown,
  IconFileText,
  IconGripVertical,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState, type ReactElement, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { TYPE_ICONS } from "../DocumentProperties";
import { ContentTableToolbarButton } from "./ContentTable";
import {
  databaseSortDirectionLabel,
  databaseSortPropertyType,
} from "./sort-direction";
import { dbText } from "./text";
import type { DatabaseSort } from "./types";

const NAME_KEY = "name";

function sortFields(
  properties: readonly DocumentProperty[],
): FilterField<never>[] {
  return [
    {
      id: NAME_KEY,
      label: "Name",
      type: "text",
      icon: <IconFileText className="size-4" />,
    },
    ...properties.map((property): FilterField<never> => {
      const Icon = TYPE_ICONS[property.definition.type];
      return {
        id: property.definition.id,
        label: property.definition.name,
        type: "text",
        icon: <Icon className="size-4" />,
      };
    }),
  ];
}

function sortIds(sorts: readonly DatabaseSort[]) {
  return sorts.map((sort, index) =>
    sorts.findIndex((other) => other.key === sort.key) === index
      ? sort.key
      : `${sort.key}#${index}`,
  );
}

export function SortMenu({
  properties,
  sorts,
  onSortsChange,
  hint,
}: {
  properties: DocumentProperty[];
  sorts: DatabaseSort[];
  onSortsChange: (sorts: DatabaseSort[]) => void;
  hint?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const text = useFilterText();
  const fields = useMemo(() => sortFields(properties), [properties]);
  const ids = sortIds(sorts);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const add = (field: FilterField<never>) =>
    onSortsChange([
      ...sorts,
      { key: field.id, label: field.label, direction: "asc" },
    ]);
  const patch = (index: number, next: Partial<DatabaseSort>) =>
    onSortsChange(
      sorts.map((sort, sortIndex) =>
        sortIndex === index ? { ...sort, ...next } : sort,
      ),
    );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onSortsChange(arrayMove(sorts, from, to));
  };

  const button = (
    <ContentTableToolbarButton
      label="Sort"
      title={hint ? undefined : "Sort"}
      active={sorts.length > 0 || open}
      count={sorts.length || undefined}
      aria-label={sorts.length > 0 ? `${sorts.length} active sorts` : "Sort"}
    >
      <IconArrowsSort className="size-3.5" />
    </ContentTableToolbarButton>
  );

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      {hint ? (
        <Tooltip open={hintOpen && !open} onOpenChange={setHintOpen}>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>{button}</PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" align="end" className="max-w-80">
            {hint}
          </TooltipContent>
        </Tooltip>
      ) : (
        <PopoverTrigger asChild>{button}</PopoverTrigger>
      )}
      <PopoverContent
        align="end"
        collisionPadding={8}
        className={cn(
          "flex max-h-[min(32rem,var(--radix-popover-content-available-height))] flex-col overflow-y-auto overflow-x-hidden p-0",
          sorts.length === 0
            ? "w-[min(20rem,calc(100vw-1rem))]"
            : "w-[min(27rem,calc(100vw-1rem))]",
        )}
      >
        {sorts.length === 0 ? (
          <FilterFieldPicker
            fields={fields}
            text={text}
            includeValues={false}
            onPickField={add}
          />
        ) : (
          <section
            aria-label={dbText("sort")}
            className="flex min-w-0 flex-col gap-1 p-2"
          >
            <header className="flex min-w-0 items-baseline gap-2 px-1.5 pt-1">
              <h2 className="text-sm font-semibold">{dbText("sort")}</h2>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ms-auto h-7 shrink-0 px-2 text-xs text-muted-foreground"
                onClick={() => onSortsChange([])}
              >
                {dbText("clearSorts")}
              </Button>
            </header>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={onDragEnd}
            >
              <SortableContext
                items={ids}
                strategy={verticalListSortingStrategy}
              >
                <ul className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-1">
                  {sorts.map((sort, index) => (
                    <SortLine
                      key={ids[index]}
                      id={ids[index] ?? sort.key}
                      sort={sort}
                      properties={properties}
                      fields={fields}
                      onPick={(field) =>
                        patch(index, { key: field.id, label: field.label })
                      }
                      onToggle={() =>
                        patch(index, {
                          direction: sort.direction === "asc" ? "desc" : "asc",
                        })
                      }
                      onRemove={() =>
                        onSortsChange(
                          sorts.filter((_, sortIndex) => sortIndex !== index),
                        )
                      }
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
            <div className="flex items-center">
              <PropertyPickButton
                fields={fields.filter(
                  (field) => !sorts.some((sort) => sort.key === field.id),
                )}
                onPick={add}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                >
                  <IconPlus className="size-4" />
                  {dbText("addSort")}
                </Button>
              </PropertyPickButton>
            </div>
          </section>
        )}
      </PopoverContent>
    </Popover>
  );
}

function SortLine({
  id,
  sort,
  properties,
  fields,
  onPick,
  onToggle,
  onRemove,
}: {
  id: string;
  sort: DatabaseSort;
  properties: DocumentProperty[];
  fields: readonly FilterField<never>[];
  onPick: (field: FilterField<never>) => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const field = fields.find((candidate) => candidate.id === sort.key);
  return (
    <li
      ref={setNodeRef}
      style={{ transform: DragCss.Transform.toString(transform), transition }}
      className={cn(
        "col-span-full grid min-w-0 grid-cols-subgrid items-center rounded-md",
        isDragging && "relative z-10 bg-popover shadow-md",
      )}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        aria-label={dbText("sortDragHandle", { sort: sort.label })}
        className="flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing"
      >
        <IconGripVertical className="size-3.5" />
      </button>
      <PropertyPickButton fields={fields} onPick={onPick}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 min-w-0 justify-start gap-1.5 font-normal"
        >
          <span className="flex shrink-0 text-muted-foreground">
            {field?.icon}
          </span>
          <span className="truncate">{sort.label}</span>
          <IconChevronDown className="ms-auto size-3.5 text-muted-foreground" />
        </Button>
      </PropertyPickButton>
      <button
        type="button"
        className="flex h-8 items-center justify-center whitespace-nowrap rounded px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onToggle}
      >
        {databaseSortDirectionLabel(
          sort.direction,
          sort.key,
          databaseSortPropertyType(sort.key, properties),
        )}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={dbText("removeSortLine", { sort: sort.label })}
        className="size-8 shrink-0 text-muted-foreground"
        onClick={onRemove}
      >
        <IconX className="size-4" />
      </Button>
    </li>
  );
}

function PropertyPickButton({
  fields,
  onPick,
  children,
}: {
  fields: readonly FilterField<never>[];
  onPick: (field: FilterField<never>) => void;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const text = useFilterText();
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-1rem))] flex-col overflow-y-auto overflow-x-hidden p-0"
      >
        <FilterFieldPicker
          fields={fields}
          text={text}
          includeValues={false}
          onPickField={(field) => {
            setOpen(false);
            onPick(field);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function DatabaseSortWords({
  sorts,
  properties,
}: {
  sorts: readonly DatabaseSort[];
  properties: DocumentProperty[];
}) {
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="font-semibold">{dbText("sortedBy")}</span>
      <ol className="flex list-decimal flex-col gap-0.5 ps-4">
        {sorts.map((sort, index) => (
          <li key={`${index}:${sort.key}`}>
            {sort.label},{" "}
            {databaseSortDirectionLabel(
              sort.direction,
              sort.key,
              databaseSortPropertyType(sort.key, properties),
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
