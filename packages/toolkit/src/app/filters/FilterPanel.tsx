import { useIsMobile } from "@agent-native/toolkit/hooks";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@agent-native/toolkit/ui/sheet";
import { cn } from "@agent-native/toolkit/utils";
import { IconFilter, IconPlus } from "@tabler/icons-react";
import {
  useRef,
  useState,
  type ComponentProps,
  type ReactElement,
} from "react";

import {
  FilterAddPopover,
  FilterGroupBlock,
  FilterModeSentence,
  FilterPinnedOptions,
  FilterRuleRow,
  type FilterControlProps,
  type FilterNouns,
} from "./FilterRows.js";
import {
  activeFilterRuleCount,
  addFilterGroup,
  addFilterRule,
  createFilterGroup,
  createFilterState,
  hasIncompleteFilterRules,
  isDefaultFilterState,
  incompleteFilterRuleIds,
  pruneFilterState,
  setFilterMode,
  setPinnedFilter,
} from "./model.js";
import { useFilterText, type FilterText } from "./text.js";
import { useHeldWhilePressed } from "./use-held-while-pressed.js";

export interface FilterPanelProps extends FilterControlProps {
  nouns: FilterNouns;
}

function FilterPanelBody({
  fields,
  state,
  onChange,
  counts,
  nestedGroups,
  groupMode,
  nouns,
  text,
}: FilterPanelProps & { text: FilterText }) {
  const pinnedFields = fields.filter((field) => field.pinned);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="text-sm">
        <FilterModeSentence
          sentence="agentChat.filters.matchSentence"
          values={{ items: nouns.items }}
          mode={state.mode}
          text={text}
          onChange={(mode) => onChange(setFilterMode(state, mode))}
        />
      </div>
      {pinnedFields.map((field) => (
        <section key={field.id} className="flex min-w-0 flex-col gap-1">
          <h3 className="text-xs font-medium text-muted-foreground">
            {field.label}
          </h3>
          <FilterPinnedOptions
            field={field}
            state={state}
            counts={counts}
            text={text}
            onChange={(value) =>
              onChange(setPinnedFilter(state, field.id, value))
            }
          />
        </section>
      ))}
      <div className="flex min-w-0 flex-col gap-2">
        {state.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {text.t("agentChat.filters.noRules")}
          </p>
        ) : (
          state.items.map((item, index) => (
            <div key={item.id} className="flex min-w-0 flex-col gap-1">
              {index > 0 ? (
                <span className="text-xs font-medium text-muted-foreground">
                  {text.t(
                    state.mode === "or"
                      ? "agentChat.filters.or"
                      : "agentChat.filters.and",
                  )}
                </span>
              ) : null}
              {item.kind === "rule" ? (
                <FilterRuleRow
                  rule={item}
                  fields={fields}
                  state={state}
                  onChange={onChange}
                  counts={counts}
                  text={text}
                />
              ) : (
                <FilterGroupBlock
                  group={item}
                  fields={fields}
                  state={state}
                  onChange={onChange}
                  counts={counts}
                  nestedGroups={nestedGroups}
                  groupMode={groupMode}
                  text={text}
                />
              )}
            </div>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <FilterAddPopover
          fields={fields}
          counts={counts}
          text={text}
          onAdd={(rule) => onChange(addFilterRule(state, rule))}
        >
          <Button type="button" variant="ghost" size="sm" className="h-8">
            <IconPlus />
            {text.t("agentChat.filters.addRule")}
          </Button>
        </FilterAddPopover>
        <FilterAddPopover
          fields={fields}
          counts={counts}
          text={text}
          onAdd={(rule) =>
            onChange(
              addFilterGroup(state, createFilterGroup([rule], groupMode)),
            )
          }
        >
          <Button type="button" variant="ghost" size="sm" className="h-8">
            <IconPlus />
            {text.t("agentChat.filters.addGroup")}
          </Button>
        </FilterAddPopover>
      </div>
    </div>
  );
}

export function FilterPanel(props: FilterPanelProps) {
  const text = useFilterText();
  const counts = useHeldWhilePressed(props.counts);
  return <FilterPanelBody {...props} counts={counts} text={text} />;
}

export function FilterCountButton({
  active,
  className,
  ...props
}: ComponentProps<typeof Button> & { active: number }) {
  const text = useFilterText();
  const isMobile = useIsMobile();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      {...props}
      className={cn("h-8 shrink-0 gap-1.5", className)}
    >
      <IconFilter />
      <span className={cn(isMobile && "sr-only")}>
        {text.t("agentChat.filters.filter")}
      </span>
      {active > 0 ? (
        <>
          <span
            aria-hidden="true"
            className="min-w-4 rounded-full bg-primary px-1 text-center text-[11px] leading-4 tabular-nums text-primary-foreground"
          >
            {text.formatNumber(active)}
          </span>
          <span className="sr-only">
            {text.t("agentChat.filters.activeRules", {
              number: text.formatNumber(active),
            })}
          </span>
        </>
      ) : null}
    </Button>
  );
}

export interface FilterButtonProps extends FilterPanelProps {
  onClear?: () => void;
  /** Whether the panel offers Clear; by default, whenever a filter is set. */
  clearable?: boolean | undefined;
  className?: string;
  /** Which edge of the trigger the panel lines up with on wider screens. */
  align?: "start" | "end" | undefined;
  /** A button to open the panel with, in place of the kit's Filter button. */
  children?: ReactElement | undefined;
}

export function FilterButton({
  fields,
  state,
  onChange,
  counts,
  nestedGroups,
  groupMode,
  nouns,
  onClear,
  clearable,
  className,
  align = "start",
  children,
}: FilterButtonProps) {
  const text = useFilterText();
  const isMobile = useIsMobile();
  const shownCounts = useHeldWhilePressed(counts);
  const [open, setOpen] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const unfinishedAtOpen = useRef<ReadonlySet<string>>(new Set());
  const active = activeFilterRuleCount(state, fields);
  const canClear = clearable ?? !isDefaultFilterState(state, fields);
  const matching = shownCounts?.matching;
  const changeOpen = (next: boolean) => {
    setOpen(next);
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
  const handleChange = (next: typeof state) => {
    stateRef.current = next;
    onChange(next);
  };
  const clear = () => {
    handleChange(createFilterState(fields));
    onClear?.();
  };
  const trigger = children ?? (
    <FilterCountButton active={active} className={className} />
  );
  const body = (
    <FilterPanelBody
      fields={fields}
      state={state}
      onChange={handleChange}
      counts={shownCounts}
      nestedGroups={nestedGroups}
      groupMode={groupMode}
      nouns={nouns}
      text={text}
    />
  );
  const matchLine =
    matching === undefined || !nouns.matchCount ? null : (
      <span
        aria-live="polite"
        className="min-w-0 truncate text-sm text-muted-foreground"
      >
        {nouns.matchCount(matching)}
      </span>
    );
  const clearButton = canClear ? (
    <Button type="button" variant="ghost" size="sm" onClick={clear}>
      {text.t("agentChat.filters.clear")}
    </Button>
  ) : null;

  if (isMobile) {
    return (
      <Sheet open={open} onOpenChange={changeOpen}>
        <SheetTrigger asChild>{trigger}</SheetTrigger>
        <SheetContent
          side="bottom"
          aria-describedby={undefined}
          className="flex max-h-[90dvh] w-full max-w-full flex-col gap-0 overflow-hidden p-0"
        >
          <SheetHeader className="gap-0.5 border-b px-4 py-3 pe-12 text-start">
            <SheetTitle>{text.t("agentChat.filters.filter")}</SheetTitle>
            {matchLine}
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain p-4">
            {body}
          </div>
          <SheetFooter className="flex-row items-center gap-2 border-t p-3">
            {clearButton}
            <Button
              type="button"
              className="h-11 min-w-0 flex-1"
              onClick={() => changeOpen(false)}
            >
              <span className="truncate">
                {matching === undefined || !nouns.showCount
                  ? text.t("agentChat.filters.done")
                  : nouns.showCount(matching)}
              </span>
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <Popover modal open={open} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align={align}
        collisionPadding={8}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-[min(34rem,calc(100vw-1rem))] flex-col overflow-hidden p-0"
      >
        <div className="max-h-[min(32rem,70vh)] min-h-0 overflow-y-auto overflow-x-hidden p-3">
          {body}
        </div>
        <div className="flex min-w-0 items-center gap-2 border-t px-3 py-2">
          {matchLine}
          <div className="ms-auto flex shrink-0 items-center gap-1">
            {clearButton}
            <Button type="button" size="sm" onClick={() => changeOpen(false)}>
              {text.t("agentChat.filters.done")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
