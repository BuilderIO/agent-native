import { useIsMobile } from "@agent-native/toolkit/hooks";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@agent-native/toolkit/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@agent-native/toolkit/ui/tooltip";
import { cn } from "@agent-native/toolkit/utils";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS as DragCss } from "@dnd-kit/utilities";
import {
  IconArrowBarToRight,
  IconBoxMultiple,
  IconChevronDown,
  IconChevronUp,
  IconCopy,
  IconDots,
  IconGripVertical,
  IconLayoutList,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import {
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";

import {
  FilterFieldPicker,
  FilterOperatorSelect,
  FilterRuleEditor,
} from "./FilterEditors.js";
import { FilterCountButton } from "./FilterPanel.js";
import { FilterPinnedOptions, pinnedValueLabel } from "./FilterRows.js";
import {
  duplicateFilterLine,
  FILTER_GROUP_LEVELS,
  filterJoinIsWhole,
  filterLineJoin,
  filterLineParent,
  groupFilterLineWith,
  joinFilterLine,
  moveFilterLine,
  takeFilterLineOut,
  ungroupFilterLine,
  type FilterLinePlace,
} from "./lines.js";
import {
  activeFilterRuleCount,
  addFilterGroup,
  addFilterRule,
  createFilterGroup,
  createFilterRule,
  createFilterState,
  filterOperatorTakesValue,
  findFilterField,
  findFilterRule,
  hasIncompleteFilterRules,
  incompleteFilterRuleIds,
  isDefaultFilterState,
  isFilterRuleComplete,
  isPinnedFilterDefault,
  pruneFilterState,
  removeFilterItem,
  setPinnedFilter,
  updateFilterRule,
  type FilterCounts,
  type FilterField,
  type FilterGroup,
  type FilterItem,
  type FilterMode,
  type FilterRule,
  type FilterState,
} from "./model.js";
import { useFilterText, type FilterText } from "./text.js";
import { useHeldWhilePressed } from "./use-held-while-pressed.js";

const TOP = "filter-top";
const END = "filter-end:";
const GLOW_MS = 1600;

export interface FilterMenuProps {
  fields: readonly FilterField<never>[];
  state: FilterState;
  onChange: (next: FilterState) => void;
  counts?: FilterCounts | undefined;
  /** Classes for an option's tag in a line, such as the option's color. */
  optionClass?:
    | ((fieldId: string, optionId: string) => string | undefined)
    | undefined;
  /** Shown beside the heading, such as how many items the filters leave. */
  summary?: string | undefined;
  /** Shown in place of the lines while there are none. */
  empty?: string | undefined;
  /** What hovering the button shows while the menu is closed. */
  hint?: ReactNode;
  /** Opens the menu on this line's editor; a new `at` opens it again. */
  openLine?: { id: string; at: number } | null | undefined;
  onClear?: (() => void) | undefined;
  /** A button to open the menu with, in place of the kit's Filter button. */
  children?: ReactElement | undefined;
}

export function FilterMenu({
  fields,
  state,
  onChange,
  counts,
  optionClass,
  summary,
  empty,
  hint,
  openLine,
  onClear,
  children,
}: FilterMenuProps) {
  const text = useFilterText();
  const isMobile = useIsMobile();
  const shownCounts = useHeldWhilePressed(counts);
  const [open, setOpen] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);
  const [startOpenId, setStartOpenId] = useState<string | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const unfinishedAtOpen = useRef<ReadonlySet<string>>(new Set());
  const handledOpenLine = useRef<number | null>(null);
  useEffect(() => {
    if (!openLine || handledOpenLine.current === openLine.at) return;
    handledOpenLine.current = openLine.at;
    unfinishedAtOpen.current = incompleteFilterRuleIds(
      stateRef.current,
      fields,
    );
    setStartOpenId(openLine.id);
    setOpen(true);
  }, [openLine, fields]);
  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (!next) setStartOpenId(null);
    if (next) {
      unfinishedAtOpen.current = incompleteFilterRuleIds(
        stateRef.current,
        fields,
      );
      return;
    }
    if (hasIncompleteFilterRules(stateRef.current, fields)) {
      const pruned = pruneFilterState(
        stateRef.current,
        fields,
        unfinishedAtOpen.current,
      );
      if (
        incompleteFilterRuleIds(pruned, fields).size !==
        incompleteFilterRuleIds(stateRef.current, fields).size
      ) {
        onChange(pruned);
      }
    }
  };
  const body = (
    <FilterLinesPanel
      fields={fields}
      state={state}
      stateRef={stateRef}
      onChange={(next) => {
        stateRef.current = next;
        onChange(next);
      }}
      counts={shownCounts}
      optionClass={optionClass}
      summary={summary}
      empty={empty}
      onClear={onClear}
      unfinishedAtOpen={unfinishedAtOpen}
      startOpenId={startOpenId}
      inSheet={isMobile}
    />
  );
  const button = children ?? (
    <FilterCountButton active={activeFilterRuleCount(state, fields)} />
  );
  const opener = isMobile ? (
    <SheetTrigger asChild>{button}</SheetTrigger>
  ) : (
    <PopoverTrigger asChild>{button}</PopoverTrigger>
  );
  const trigger = (
    <Tooltip
      open={Boolean(hint) && hintOpen && !open}
      onOpenChange={setHintOpen}
    >
      <TooltipTrigger asChild>{opener}</TooltipTrigger>
      {hint ? (
        <TooltipContent side="bottom" align="end" className="max-w-80">
          {hint}
        </TooltipContent>
      ) : null}
    </Tooltip>
  );

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={changeOpen}>
        {trigger}
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="flex max-h-[90dvh] w-full max-w-full flex-col gap-0 overflow-hidden p-0"
        >
          <SheetHeader className="sr-only">
            <SheetTitle>{menuText(text, "title")}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
            {body}
          </div>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover modal open={open} onOpenChange={changeOpen}>
      {trigger}
      <PopoverContent
        align="end"
        collisionPadding={8}
        className="flex max-h-[min(36rem,var(--radix-popover-content-available-height))] w-[min(34rem,calc(100vw-1rem))] flex-col overflow-hidden p-0"
      >
        <div className="min-h-0 overflow-y-auto overflow-x-hidden">{body}</div>
      </PopoverContent>
    </Popover>
  );
}

interface PanelProps {
  fields: readonly FilterField<never>[];
  state: FilterState;
  stateRef: { current: FilterState };
  onChange: (next: FilterState) => void;
  counts: FilterCounts | undefined;
  optionClass: FilterMenuProps["optionClass"];
  summary: string | undefined;
  empty: string | undefined;
  onClear: FilterMenuProps["onClear"];
  unfinishedAtOpen: { current: ReadonlySet<string> };
  startOpenId: string | null;
  inSheet: boolean;
}

interface LineEdits {
  fields: readonly FilterField<never>[];
  state: FilterState;
  text: FilterText;
  counts: FilterCounts | undefined;
  optionClass: FilterMenuProps["optionClass"];
  openId: string | null;
  setOpenId: (id: string | null) => void;
  glowId: string | null;
  flashId: string | null;
  overId: string | null;
  activeListId: string | null;
  update: (next: FilterState) => void;
  patchRule: (
    id: string,
    patch: Parameters<typeof updateFilterRule>[2],
  ) => void;
  join: (id: string, mode: FilterMode) => void;
  remove: (id: string) => void;
  duplicate: (id: string) => void;
  takeOut: (id: string) => void;
  ungroup: (id: string) => void;
  groupWith: (id: string, field: FilterField<never>) => void;
  addTo: (groupId: string, field: FilterField<never>) => void;
  lineName: (item: FilterItem) => string;
}

function FilterLinesPanel({
  fields,
  state,
  stateRef,
  onChange,
  counts,
  optionClass,
  summary,
  empty,
  onClear,
  unfinishedAtOpen,
  startOpenId,
  inSheet,
}: PanelProps) {
  const text = useFilterText();
  const m = (key: string, values?: Record<string, unknown>) =>
    text.t(`agentChat.filters.menu.${key}`, values);
  const [openId, setOpenIdState] = useState<string | null>(startOpenId);
  const [glowId, setGlowId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [overId, setOverId] = useState<string | null>(null);
  const [activeListId, setActiveListId] = useState<string | null>(null);
  const blocked = useRef<ReadonlySet<string>>(new Set());
  const rootRef = useRef<HTMLDivElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (run: () => void, ms: number) => {
    timers.current.push(setTimeout(run, ms));
  };

  const announce = (message: string) => {
    setAnnouncement("");
    later(() => setAnnouncement(message), 20);
  };
  const glow = (id: string) => {
    setGlowId(id);
    later(
      () => setGlowId((current) => (current === id ? null : current)),
      GLOW_MS,
    );
  };
  const flash = (id: string) => {
    setFlashId(id);
    later(
      () => setFlashId((current) => (current === id ? null : current)),
      GLOW_MS,
    );
  };
  const focusIn = (selector: string) => {
    later(() => {
      const target = rootRef.current?.querySelector<HTMLElement>(selector);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: "nearest" });
    }, 40);
  };

  const update = (next: FilterState) => {
    if (next !== stateRef.current) onChange(next);
  };

  const withoutLine = (current: FilterState, id: string) => {
    const parent = filterLineParent(current, id);
    const next = removeFilterItem(current, id);
    return parent && parent.rules.length === 2
      ? ungroupFilterLine(next, parent.id)
      : next;
  };

  const setOpenId = (id: string | null) => {
    const closing = openId;
    setOpenIdState(id);
    if (!closing || closing === id) return;
    const current = stateRef.current;
    const rule = findFilterRule(current, closing);
    const field = rule ? findFilterField(fields, rule.field) : undefined;
    if (
      rule &&
      !isFilterRuleComplete(rule, field) &&
      !unfinishedAtOpen.current.has(rule.id)
    ) {
      update(withoutLine(current, rule.id));
    }
  };

  const lineName = (item: FilterItem) => {
    if (item.kind === "group") return m("theGroup");
    const field = findFilterField(fields, item.field);
    return field ? text.ruleLabel(field, item) : item.field;
  };

  const focusJoin = (next: FilterState, id: string) => {
    let target = id;
    while (filterLineJoin(next, target) === undefined) {
      const parent = filterLineParent(next, target);
      if (!parent) return;
      target = parent.id;
    }
    focusIn(`[data-filter-join="${CSS.escape(target)}"]`);
  };

  const edits: LineEdits = {
    fields,
    state,
    text,
    counts,
    optionClass,
    openId,
    setOpenId,
    glowId,
    flashId,
    overId,
    activeListId,
    update,
    lineName,
    patchRule: (id, patch) =>
      update(updateFilterRule(stateRef.current, id, patch, fields)),
    join: (id, mode) => {
      const current = stateRef.current;
      const result = joinFilterLine(current, id, mode);
      if (result.state === current) return;
      update(result.state);
      const before = filterLineParent(current, id)?.id;
      const after = filterLineParent(result.state, id)?.id;
      if (after && after !== before) glow(after);
      const word = joinWord(text, mode);
      announce(
        result.whole
          ? m("nowWordWhole", {
              word,
              scope: m(
                filterLineParent(current, id) ? "wholeGroup" : "everyLine",
              ),
            })
          : m("nowWord", { word }),
      );
      focusJoin(result.state, id);
    },
    remove: (id) => {
      const item = findItem(stateRef.current, id);
      if (!item) return;
      if (openId === id) setOpenIdState(null);
      update(withoutLine(stateRef.current, id));
      announce(m("removed", { line: lineName(item) }));
      focusIn("[data-filter-add]");
    },
    duplicate: (id) => {
      const result = duplicateFilterLine(stateRef.current, id);
      if (!result.id) return;
      update(result.state);
      glow(result.id);
      announce(m("duplicated"));
      focusIn(
        `[data-filter-line="${CSS.escape(result.id)}"] [data-filter-text]`,
      );
    },
    takeOut: (id) => {
      const next = takeFilterLineOut(stateRef.current, id);
      if (next === stateRef.current) return;
      update(next);
      flash(id);
      announce(m("takenOut"));
      focusJoin(next, id);
    },
    ungroup: (id) => {
      update(ungroupFilterLine(stateRef.current, id));
      announce(m("ungrouped"));
      focusIn("[data-filter-add]");
    },
    groupWith: (id, field) => {
      const rule = createFilterRule(field);
      const next = groupFilterLineWith(stateRef.current, id, rule);
      if (next === stateRef.current) return;
      update(next);
      const box = filterLineParent(next, id);
      if (box) glow(box.id);
      setOpenIdState(rule.id);
    },
    addTo: (groupId, field) => {
      const rule = createFilterRule(field);
      update(addFilterRule(stateRef.current, rule, groupId));
      setOpenIdState(rule.id);
    },
  };

  const lineThatTakesAnother = (field: FilterField<never>) => {
    const current = stateRef.current;
    if (current.mode !== "and" || field.type !== "choice") return undefined;
    return current.items.find(
      (item): item is FilterRule =>
        item.kind === "rule" &&
        item.field === field.id &&
        filterOperatorTakesValue(item.operator),
    );
  };
  const addLine = (field: FilterField<never>) => {
    const existing = lineThatTakesAnother(field);
    if (existing) {
      setOpenId(existing.id);
      flash(existing.id);
      announce(m("already", { field: field.label }));
      return;
    }
    const rule = createFilterRule(field);
    update(addFilterRule(stateRef.current, rule));
    setOpenId(rule.id);
  };
  const addValue = (
    field: FilterField<never>,
    value: string[],
    operator: FilterRule["operator"],
  ) => {
    const existing = lineThatTakesAnother(field);
    if (existing && existing.operator === operator) {
      const merged = [...new Set([...existing.value, ...value])];
      update(
        updateFilterRule(
          stateRef.current,
          existing.id,
          { value: merged },
          fields,
        ),
      );
      flash(existing.id);
      announce(m("already", { field: field.label }));
      return;
    }
    update(
      addFilterRule(stateRef.current, createFilterRule(field, value, operator)),
    );
  };
  const addGroup = (field: FilterField<never>) => {
    const rule = createFilterRule(field);
    const current = stateRef.current;
    const group = createFilterGroup([rule], flipMode(current.mode));
    const next = addFilterGroup(current, group);
    if (next === current) return;
    update(next);
    glow(group.id);
    setOpenId(rule.id);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const collisions: CollisionDetection = (args) => {
    const droppableContainers = args.droppableContainers.filter(
      (container) => !blocked.current.has(String(container.id)),
    );
    const within = pointerWithin({ ...args, droppableContainers });
    if (within.length > 0) {
      const area = (id: string | number) => {
        const rect = args.droppableRects.get(id);
        return rect ? rect.width * rect.height : Number.POSITIVE_INFINITY;
      };
      return [...within].sort((a, b) => area(a.id) - area(b.id)).slice(0, 1);
    }
    return closestCenter({ ...args, droppableContainers });
  };
  const nameOf = (id: string | number) => {
    const item = findItem(stateRef.current, String(id));
    return item ? lineName(item) : "";
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => m("dragStart", { line: nameOf(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? m("dragOver", {
            line: nameOf(active.id),
            place: placeName(over.id),
          })
        : undefined,
    onDragEnd: ({ active }) => m("dragEnd", { line: nameOf(active.id) }),
    onDragCancel: ({ active }) => m("dragCancel", { line: nameOf(active.id) }),
  };
  const placeName = (id: string | number) => {
    const key = String(id);
    if (key.startsWith(END)) {
      return key === `${END}${TOP}` ? m("dragEndOfList") : m("dragEndOfGroup");
    }
    return m("dragBefore", { line: nameOf(key) });
  };
  const onDragStart = ({ active }: DragStartEvent) => {
    setOpenIdState(null);
    const id = String(active.id);
    const item = findItem(stateRef.current, id);
    const inside = new Set<string>();
    if (item?.kind === "group") {
      const walk = (group: FilterGroup) => {
        inside.add(`${END}${group.id}`);
        for (const member of group.rules) {
          inside.add(member.id);
          if (member.kind === "group") walk(member);
        }
      };
      walk(item);
    }
    blocked.current = inside;
    setActiveListId(filterLineParent(stateRef.current, id)?.id ?? TOP);
  };
  const onDragOver = ({ over }: DragOverEvent) => {
    setOverId(over ? String(over.id) : null);
  };
  const endDrag = () => {
    blocked.current = new Set();
    setOverId(null);
    setActiveListId(null);
  };
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    endDrag();
    if (!over) return;
    const id = String(active.id);
    const target = String(over.id);
    if (target === id) return;
    const current = stateRef.current;
    let place: FilterLinePlace;
    if (target.startsWith(END)) {
      const groupId = target.slice(END.length);
      place = {
        groupId: groupId === TOP ? undefined : groupId,
        index: Number.MAX_SAFE_INTEGER,
      };
    } else {
      const parent = filterLineParent(current, target);
      const list = parent ? parent.rules : current.items;
      place = {
        groupId: parent?.id,
        index: list.findIndex((item) => item.id === target),
      };
    }
    const next = moveFilterLine(current, id, place);
    if (next === current) {
      announce(m("cantMoveThere"));
      return;
    }
    update(next);
    flash(id);
    const box = filterLineParent(next, id);
    if (box && box.id !== filterLineParent(current, id)?.id) glow(box.id);
  };

  const top: FilterGroup = {
    kind: "group",
    id: TOP,
    mode: state.mode,
    rules: state.items,
  };
  const hasLines = state.items.length > 0;
  const pinnedFields = fields.filter((field) => field.pinned);

  return (
    <section
      ref={rootRef}
      aria-label={menuText(text, "title")}
      className="flex min-w-0 flex-col gap-1 p-2"
      onKeyDown={(event) => {
        if (event.key === "Escape" && openId) {
          event.stopPropagation();
          event.preventDefault();
          const id = openId;
          setOpenId(null);
          focusIn(`[data-filter-line="${CSS.escape(id)}"] [data-filter-text]`);
        }
      }}
    >
      <header
        className={cn(
          "flex min-w-0 items-baseline gap-2 px-1.5 pt-1",
          inSheet && "pe-10",
        )}
      >
        <h2 className="text-sm font-semibold">{menuText(text, "title")}</h2>
        {summary ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {summary}
          </span>
        ) : null}
        {hasLines || !isDefaultFilterState(state, fields) ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ms-auto h-7 shrink-0 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setOpenIdState(null);
              update(createFilterState(fields));
              onClear?.();
              announce(m("cleared"));
              focusIn("[data-filter-add]");
            }}
          >
            {m("clear")}
          </Button>
        ) : null}
      </header>
      {pinnedFields.map((field) => (
        <section key={field.id} className="flex min-w-0 flex-col gap-0.5 pb-1">
          <h3 className="px-1.5 pt-1 text-xs font-medium text-muted-foreground">
            {field.label}
          </h3>
          <FilterPinnedOptions
            field={field}
            state={state}
            counts={counts}
            text={text}
            onChange={(value) =>
              update(setPinnedFilter(stateRef.current, field.id, value))
            }
          />
        </section>
      ))}
      {hasLines ? (
        <DndContext
          sensors={sensors}
          collisionDetection={collisions}
          accessibility={{ announcements }}
          onDragStart={onDragStart}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={endDrag}
        >
          <FilterLines group={top} level={0} edits={edits} />
          <EndDrop groupId={TOP} edits={edits} className="min-h-1" />
        </DndContext>
      ) : (
        <p className="px-1.5 py-2 text-sm text-muted-foreground">
          {empty ?? m("none")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <FieldPickButton
          fields={fields}
          text={text}
          includeValues
          onPickField={addLine}
          onPickValue={(field, candidate) =>
            addValue(field, candidate.value, candidate.operator)
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-filter-add=""
            className="h-8 px-2 text-muted-foreground"
          >
            <IconPlus className="size-4" />
            {m("addFilter")}
          </Button>
        </FieldPickButton>
        {hasLines ? (
          <FieldPickButton fields={fields} text={text} onPickField={addGroup}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
            >
              <IconPlus className="size-4" />
              {m("addGroup")}
            </Button>
          </FieldPickButton>
        ) : null}
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </section>
  );
}

function flipMode(mode: FilterMode): FilterMode {
  return mode === "and" ? "or" : "and";
}

function findItem(state: FilterState, id: string): FilterItem | undefined {
  const walk = (items: readonly FilterItem[]): FilterItem | undefined => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.kind === "group") {
        const found = walk(item.rules);
        if (found) return found;
      }
    }
    return undefined;
  };
  return walk(state.items);
}

function menuText(text: FilterText, key: string) {
  return text.t(`agentChat.filters.menu.${key}`);
}

function joinWord(text: FilterText, mode: FilterMode) {
  return text.t(
    mode === "or" ? "agentChat.filters.or" : "agentChat.filters.and",
  );
}

function FilterLines({
  group,
  level,
  edits,
}: {
  group: FilterGroup;
  level: number;
  edits: LineEdits;
}) {
  return (
    <SortableContext
      id={group.id}
      items={group.rules.map((item) => item.id)}
      strategy={verticalListSortingStrategy}
    >
      <ul className="flex min-w-0 flex-col gap-0.5">
        {group.rules.map((item, index) => (
          <FilterLine
            key={item.id}
            item={item}
            group={group}
            index={index}
            level={level}
            edits={edits}
          />
        ))}
      </ul>
    </SortableContext>
  );
}

function openerFor(group: FilterGroup, text: FilterText) {
  if (group.mode === "or") return menuText(text, "either");
  return menuText(text, group.rules.length > 2 ? "allOf" : "both");
}

function FilterLine({
  item,
  group,
  index,
  level,
  edits,
}: {
  item: FilterItem;
  group: FilterGroup;
  index: number;
  level: number;
  edits: LineEdits;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });
  const handleHidden = level > 0 && index === 0 && !isDragging;
  const name = edits.lineName(item);
  const dropMark =
    edits.overId === item.id &&
    edits.activeListId !== null &&
    edits.activeListId !== group.id;
  const handle = (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      aria-label={edits.text.t("agentChat.filters.menu.dragHandle", {
        line: name,
      })}
      tabIndex={handleHidden ? -1 : 0}
      aria-hidden={handleHidden ? true : undefined}
      className={cn(
        "flex h-8 w-5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted-foreground/70 hover:bg-muted hover:text-foreground active:cursor-grabbing",
        handleHidden && "invisible",
      )}
    >
      <IconGripVertical className="size-3.5" />
    </button>
  );
  const joiner =
    index === 0 ? (
      <span className="flex h-8 w-16 shrink-0 items-center px-2 text-sm text-muted-foreground">
        {level === 0
          ? menuText(edits.text, "where")
          : openerFor(group, edits.text)}
      </span>
    ) : (
      <JoinMenu item={item} group={group} level={level} edits={edits} />
    );

  return (
    <li
      ref={setNodeRef}
      data-filter-line={item.id}
      style={{ transform: DragCss.Transform.toString(transform), transition }}
      className={cn(
        "relative min-w-0 rounded-md",
        isDragging && "z-10 bg-popover shadow-md",
        dropMark &&
          "before:absolute before:inset-x-1 before:-top-0.5 before:h-0.5 before:rounded-full before:bg-primary",
        edits.flashId === item.id && "bg-primary/10 transition-colors",
      )}
    >
      {item.kind === "rule" ? (
        <FilterRuleLine
          rule={item}
          handle={handle}
          joiner={joiner}
          edits={edits}
          level={level}
          name={name}
        />
      ) : (
        <FilterBox
          group={item}
          handle={handle}
          joiner={joiner}
          level={level}
          edits={edits}
        />
      )}
    </li>
  );
}

function JoinMenu({
  item,
  group,
  level,
  edits,
}: {
  item: FilterItem;
  group: FilterGroup;
  level: number;
  edits: LineEdits;
}) {
  const word = group.mode;
  const other = flipMode(word);
  const whole = filterJoinIsWhole(edits.state, item.id, other);
  const wordText = (mode: FilterMode) => joinWord(edits.text, mode);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-filter-join={item.id}
          aria-label={edits.text.t("agentChat.filters.menu.joinLabel", {
            word: wordText(word),
            line: edits.lineName(item),
          })}
          className="h-8 w-16 shrink-0 justify-between gap-0.5 px-2 font-normal"
        >
          {wordText(word)}
          <IconChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8} className="w-52">
        <DropdownMenuRadioGroup
          value={word}
          onValueChange={(value) => {
            if (value === "and" || value === "or") edits.join(item.id, value);
          }}
        >
          {(["and", "or"] as const).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode}>
              <span className="flex min-w-0 flex-col">
                <span>{wordText(mode)}</span>
                {mode === other && whole ? (
                  <span className="text-xs text-muted-foreground">
                    {menuText(
                      edits.text,
                      level > 0 ? "wholeGroup" : "everyLine",
                    )}
                  </span>
                ) : null}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterRuleLine({
  rule,
  handle,
  joiner,
  edits,
  level,
  name,
}: {
  rule: FilterRule;
  handle: ReactNode;
  joiner: ReactNode;
  edits: LineEdits;
  level: number;
  name: string;
}) {
  const field = findFilterField(edits.fields, rule.field);
  if (!field) return null;
  const open = edits.openId === rule.id;
  const takesValue =
    field.type === "boolean" || filterOperatorTakesValue(rule.operator);
  const close = () => edits.setOpenId(null);
  const removeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={edits.text.t("agentChat.filters.menu.removeLine", {
        line: name,
      })}
      className="size-8 shrink-0 text-muted-foreground"
      onClick={() => edits.remove(rule.id)}
    >
      <IconX className="size-4" />
    </Button>
  );
  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex min-w-0 items-start gap-1">
        {handle}
        {joiner}
        {open ? (
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
            <FieldPickButton
              fields={edits.fields}
              text={edits.text}
              onPickField={(next) =>
                edits.patchRule(rule.id, { field: next.id })
              }
            >
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 min-w-0 max-w-[11rem] justify-start gap-1.5 font-medium"
              >
                <span className="truncate">{field.label}</span>
                <IconChevronDown className="ms-auto size-3.5 text-muted-foreground" />
              </Button>
            </FieldPickButton>
            {field.type === "boolean" ? null : (
              <FilterOperatorSelect
                field={field}
                operator={rule.operator}
                valueCount={rule.value.length}
                text={edits.text}
                onChange={(operator) => edits.patchRule(rule.id, { operator })}
              />
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-filter-text=""
              aria-label={menuText(edits.text, "closeLine")}
              aria-expanded
              className="ms-auto size-8 text-muted-foreground"
              onClick={close}
            >
              <IconChevronUp className="size-4" />
            </Button>
          </div>
        ) : (
          <>
            <button
              type="button"
              data-filter-text=""
              aria-expanded={false}
              onClick={() => edits.setOpenId(rule.id)}
              className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-0.5 rounded-md px-1.5 py-1 text-start text-sm hover:bg-muted"
            >
              <RuleSentence rule={rule} field={field} edits={edits} />
            </button>
            <LineMoreMenu rule={rule} level={level} edits={edits} name={name} />
          </>
        )}
        {removeButton}
      </div>
      {open && takesValue ? (
        <div className="ms-[5.5rem] me-9 mt-1 overflow-hidden rounded-md border bg-background">
          <FilterRuleEditor
            field={field}
            rule={findFilterRule(edits.state, rule.id) ?? rule}
            counts={edits.counts}
            text={edits.text}
            showOperator={false}
            onChange={(patch) => edits.patchRule(rule.id, patch)}
            onDone={close}
          />
        </div>
      ) : null}
    </div>
  );
}

function RuleSentence({
  rule,
  field,
  edits,
}: {
  rule: FilterRule;
  field: FilterField<never>;
  edits: LineEdits;
}) {
  const { text } = edits;
  const label = <span className="font-medium">{field.label}</span>;
  if (field.type === "boolean") {
    return (
      <>
        {label}
        <span className="text-muted-foreground">
          {text.valueLabel(field, rule)}
        </span>
      </>
    );
  }
  const operator = (
    <span className="text-muted-foreground">
      {text.operatorLabel(field, rule.operator, Math.max(rule.value.length, 1))}
    </span>
  );
  if (!filterOperatorTakesValue(rule.operator)) {
    return (
      <>
        {label}
        {operator}
      </>
    );
  }
  const complete = isFilterRuleComplete(rule, field);
  const options = field.options && complete ? rule.value : null;
  return (
    <>
      {label}
      {operator}
      {!complete ? (
        <span className="text-muted-foreground">…</span>
      ) : options ? (
        options.map((id) => (
          <span
            key={id}
            className={cn(
              "inline-flex max-w-full items-center rounded px-1.5 py-0.5 text-xs font-medium",
              edits.optionClass?.(field.id, id) ?? "bg-muted text-foreground",
            )}
          >
            <span className="truncate">{text.optionLabel(field, id)}</span>
          </span>
        ))
      ) : (
        <span className="font-medium">{text.valueLabel(field, rule)}</span>
      )}
    </>
  );
}

function FilterBox({
  group,
  handle,
  joiner,
  level,
  edits,
}: {
  group: FilterGroup;
  handle: ReactNode;
  joiner: ReactNode;
  level: number;
  edits: LineEdits;
}) {
  return (
    <div
      role="group"
      aria-label={menuText(
        edits.text,
        group.mode === "or" ? "boxEither" : "boxAll",
      )}
      className={cn(
        "flex min-w-0 items-start gap-1 rounded-md border p-0.5 transition-shadow",
        level === 0 ? "bg-muted/30" : "bg-background",
        edits.glowId === group.id && "ring-2 ring-primary/40",
      )}
    >
      {handle}
      {joiner}
      <div className="flex min-w-0 flex-1 flex-col">
        <FilterLines group={group} level={level + 1} edits={edits} />
        <div className="flex min-w-0 items-center">
          <EndDrop groupId={group.id} edits={edits} className="flex-1">
            <FieldPickButton
              fields={edits.fields}
              text={edits.text}
              onPickField={(field) => edits.addTo(group.id, field)}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ms-[5.5rem] h-8 px-2 text-muted-foreground"
              >
                <IconPlus className="size-4" />
                {menuText(edits.text, "addToGroup")}
              </Button>
            </FieldPickButton>
          </EndDrop>
          <BoxMoreMenu group={group} edits={edits} />
        </div>
      </div>
    </div>
  );
}

function EndDrop({
  groupId,
  edits,
  className,
  children,
}: {
  groupId: string;
  edits: LineEdits;
  className?: string;
  children?: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${END}${groupId}` });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "relative min-w-0 rounded-md",
        isOver &&
          edits.activeListId !== null &&
          "before:absolute before:inset-x-1 before:top-0 before:h-0.5 before:rounded-full before:bg-primary",
        className,
      )}
    >
      {children}
    </div>
  );
}

function MenuItemButton({
  icon,
  onClick,
  children,
}: {
  icon: ReactNode;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm outline-none hover:bg-accent focus-visible:bg-accent [&_svg]:size-4 [&_svg]:text-muted-foreground"
    >
      {icon}
      {children}
    </button>
  );
}

function LineMoreMenu({
  rule,
  level,
  edits,
  name,
}: {
  rule: FilterRule;
  level: number;
  edits: LineEdits;
  name: string;
}) {
  const [step, setStep] = useState<"menu" | "group" | null>(null);
  const field = findFilterField(edits.fields, rule.field);
  const canGroup =
    level < FILTER_GROUP_LEVELS && isFilterRuleComplete(rule, field);
  const close = () => setStep(null);
  return (
    <Popover
      open={step !== null}
      onOpenChange={(next) => setStep(next ? "menu" : null)}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={edits.text.t("agentChat.filters.menu.moreFor", {
            line: name,
          })}
          className="size-8 shrink-0 text-muted-foreground"
        >
          <IconDots className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={8}
        className={cn("p-1", step === "group" ? "w-72 p-0" : "w-52")}
      >
        {step === "group" ? (
          <div className="flex min-w-0 flex-col">
            <p className="border-b px-3 py-2 text-xs text-muted-foreground">
              {edits.text.t("agentChat.filters.menu.groupWith", {
                line: name,
              })}
            </p>
            <FilterFieldPicker
              fields={edits.fields}
              text={edits.text}
              includeValues={false}
              onPickField={(next) => {
                close();
                edits.groupWith(rule.id, next);
              }}
            />
          </div>
        ) : (
          <div role="menu" className="flex flex-col">
            {canGroup ? (
              <MenuItemButton
                icon={<IconBoxMultiple />}
                onClick={() => setStep("group")}
              >
                {menuText(edits.text, "turnIntoGroup")}
              </MenuItemButton>
            ) : null}
            {level > 0 ? (
              <MenuItemButton
                icon={<IconArrowBarToRight />}
                onClick={() => {
                  close();
                  edits.takeOut(rule.id);
                }}
              >
                {menuText(edits.text, "takeOut")}
              </MenuItemButton>
            ) : null}
            <MenuItemButton
              icon={<IconCopy />}
              onClick={() => {
                close();
                edits.duplicate(rule.id);
              }}
            >
              {menuText(edits.text, "duplicate")}
            </MenuItemButton>
            <MenuItemButton
              icon={<IconX />}
              onClick={() => {
                close();
                edits.remove(rule.id);
              }}
            >
              {menuText(edits.text, "remove")}
            </MenuItemButton>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function BoxMoreMenu({
  group,
  edits,
}: {
  group: FilterGroup;
  edits: LineEdits;
}) {
  const [open, setOpen] = useState(false);
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={menuText(edits.text, "moreForGroup")}
          className="size-8 shrink-0 text-muted-foreground"
        >
          <IconDots className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" collisionPadding={8} className="w-52 p-1">
        <div role="menu" className="flex flex-col">
          <MenuItemButton
            icon={<IconLayoutList />}
            onClick={run(() => edits.ungroup(group.id))}
          >
            {menuText(edits.text, "ungroup")}
          </MenuItemButton>
          <MenuItemButton
            icon={<IconCopy />}
            onClick={run(() => edits.duplicate(group.id))}
          >
            {menuText(edits.text, "duplicate")}
          </MenuItemButton>
          <MenuItemButton
            icon={<IconX />}
            onClick={run(() => edits.remove(group.id))}
          >
            {menuText(edits.text, "removeGroup")}
          </MenuItemButton>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function FieldPickButton({
  fields,
  text,
  includeValues = false,
  onPickField,
  onPickValue,
  children,
}: {
  fields: readonly FilterField<never>[];
  text: FilterText;
  includeValues?: boolean;
  onPickField: (field: FilterField<never>) => void;
  onPickValue?: Parameters<typeof FilterFieldPicker>[0]["onPickValue"];
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
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
          includeValues={includeValues}
          onPickField={(field) => {
            setOpen(false);
            onPickField(field);
          }}
          onPickValue={(field, candidate) => {
            setOpen(false);
            onPickValue?.(field, candidate);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface FilterMenuWordsProps {
  fields: readonly FilterField<never>[];
  state: FilterState;
  heading?: string | undefined;
}

export function FilterMenuWords({
  fields,
  state,
  heading,
}: FilterMenuWordsProps) {
  const text = useFilterText();
  const lines: { id: string; word: string; depth: number; text: string }[] =
    fields
      .filter((field) => field.pinned && !isPinnedFilterDefault(state, field))
      .map((field) => ({
        id: `pinned:${field.id}`,
        word: "",
        depth: 0,
        text: text.t("agentChat.filters.fieldValue", {
          field: text.fieldLabel(field),
          value: pinnedValueLabel(field, state, text),
        }),
      }));
  const walk = (group: FilterGroup, depth: number, lead: string) => {
    group.rules.forEach((item, index) => {
      const word =
        index > 0
          ? joinWord(text, group.mode)
          : `${lead}${depth > 0 ? openerFor(group, text) : ""}`.trim();
      if (item.kind === "group") {
        walk(item, depth + 1, `${word} `);
        return;
      }
      const field = findFilterField(fields, item.field);
      if (!field || !isFilterRuleComplete(item, field)) return;
      lines.push({
        id: item.id,
        word,
        depth: index > 0 ? depth : Math.max(0, depth - 1),
        text: text.ruleLabel(field, item),
      });
    });
  };
  walk({ kind: "group", id: TOP, mode: state.mode, rules: state.items }, 0, "");
  return (
    <div className="flex flex-col gap-1 text-xs">
      {heading ? <span className="font-semibold">{heading}</span> : null}
      <ul className="flex flex-col gap-0.5">
        {lines.map((line) => (
          <li key={line.id} style={{ paddingInlineStart: line.depth * 12 }}>
            {line.word ? (
              <span className="opacity-70">{line.word} </span>
            ) : null}
            {line.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
