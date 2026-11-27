import { writeClipboardText } from "@agent-native/toolkit/clipboard";
import { Button } from "@agent-native/toolkit/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@agent-native/toolkit/ui/popover";
import { cn } from "@agent-native/toolkit/utils";
import { IconCheck, IconLink, IconPlus, IconX } from "@tabler/icons-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";

import { FilterRuleEditor } from "./FilterEditors.js";
import {
  FILTER_POPOVER_CLASS,
  FilterAddPopover,
  FilterGroupBlock,
  FilterModeSwitch,
  FilterPinnedOptions,
  pinnedValueLabel,
  type FilterControlProps,
} from "./FilterRows.js";
import {
  addFilterRule,
  completeFilterRules,
  createFilterState,
  findFilterField,
  findFilterRule,
  isDefaultFilterState,
  isFilterRuleComplete,
  incompleteFilterRuleIds,
  pruneFilterGroup,
  removeFilterItem,
  setFilterMode,
  setPinnedFilter,
  updateFilterRule,
  type FilterField,
  type FilterGroup,
  type FilterRule,
  type FilterState,
} from "./model.js";
import { useFilterText, type FilterText } from "./text.js";
import { useHeldWhilePressed } from "./use-held-while-pressed.js";

const CHIP_CLASS =
  "inline-flex h-7 min-w-0 max-w-full items-center rounded-md border bg-background text-sm shadow-xs";

const CHIP_BUTTON_CLASS =
  "flex h-full min-w-0 max-w-[16rem] items-center gap-1.5 px-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring";

function ChipIcon({ icon }: { icon: ReactNode }) {
  if (!icon) return null;
  return (
    <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-3.5">
      {icon}
    </span>
  );
}

function PinnedChip({
  field,
  state,
  onChange,
  counts,
  text,
}: {
  field: FilterField<never>;
  state: FilterState;
  onChange: (next: FilterState) => void;
  counts: FilterControlProps["counts"];
  text: FilterText;
}) {
  const label = text.t("agentChat.filters.fieldValue", {
    field: text.fieldLabel(field),
    value: pinnedValueLabel(field, state, text),
  });
  return (
    <span className={CHIP_CLASS}>
      <Popover modal>
        <PopoverTrigger asChild>
          <button
            type="button"
            title={label}
            className={cn(CHIP_BUTTON_CLASS, "rounded-md")}
          >
            <ChipIcon icon={field.icon} />
            <span className="truncate">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className={cn(FILTER_POPOVER_CLASS, "p-1")}
        >
          <FilterPinnedOptions
            field={field}
            state={state}
            counts={counts}
            text={text}
            onChange={(value) =>
              onChange(setPinnedFilter(state, field.id, value))
            }
          />
        </PopoverContent>
      </Popover>
    </span>
  );
}

function RuleChip({
  rule,
  field,
  fields,
  state,
  onChange,
  counts,
  text,
}: FilterControlProps & {
  rule: FilterRule;
  field: FilterField<never>;
  text: FilterText;
}) {
  const [open, setOpen] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const complete = isFilterRuleComplete(rule, field);
  const label = complete
    ? text.ruleLabel(field, rule)
    : text.t("agentChat.filters.fieldValue", {
        field: text.fieldLabel(field),
        value: text.t("agentChat.filters.chooseValue"),
      });
  return (
    <span className={cn(CHIP_CLASS, !complete && "border-dashed")}>
      <Popover
        modal
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) return;
          const current = findFilterRule(stateRef.current, rule.id);
          if (current && !isFilterRuleComplete(current, field)) {
            onChange(removeFilterItem(stateRef.current, rule.id));
          }
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title={label}
            className={cn(CHIP_BUTTON_CLASS, "rounded-s-md")}
          >
            <ChipIcon icon={field.icon} />
            <span
              className={cn("truncate", !complete && "text-muted-foreground")}
            >
              {label}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className={FILTER_POPOVER_CLASS}
        >
          <FilterRuleEditor
            field={field}
            rule={findFilterRule(stateRef.current, rule.id) ?? rule}
            counts={counts}
            text={text}
            onChange={(patch) => {
              const next = updateFilterRule(
                stateRef.current,
                rule.id,
                patch,
                fields,
              );
              stateRef.current = next;
              onChange(next);
            }}
            onDone={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={text.t("agentChat.filters.removeChip", { label })}
        onClick={() => onChange(removeFilterItem(state, rule.id))}
        className="flex h-full shrink-0 items-center rounded-e-md px-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconX className="size-3.5" />
      </button>
    </span>
  );
}

function groupLabel(
  group: FilterGroup,
  fields: readonly FilterField<never>[],
  text: FilterText,
): string {
  const labels = group.rules.flatMap((member): string[] => {
    if (member.kind === "group") {
      return completeFilterRules(member, fields).length > 0
        ? [groupLabel(member, fields, text)]
        : [];
    }
    const field = findFilterField(fields, member.field);
    return field && isFilterRuleComplete(member, field)
      ? [text.ruleLabel(field, member)]
      : [];
  });
  return text.t("agentChat.filters.groupChip", {
    rules: text.formatList(labels, {
      type: group.mode === "or" ? "disjunction" : "conjunction",
    }),
  });
}

function GroupChip({
  group,
  fields,
  state,
  onChange,
  counts,
  nestedGroups,
  groupMode,
  text,
  onOpenChange,
}: FilterControlProps & {
  group: FilterGroup;
  text: FilterText;
  onOpenChange: (open: boolean) => void;
}) {
  const stateRef = useRef(state);
  stateRef.current = state;
  const unfinishedAtOpen = useRef<ReadonlySet<string>>(new Set());
  const label = groupLabel(group, fields, text);
  return (
    <span className={CHIP_CLASS}>
      <Popover
        modal
        onOpenChange={(next) => {
          onOpenChange(next);
          if (next) {
            unfinishedAtOpen.current = incompleteFilterRuleIds(
              stateRef.current,
              fields,
            );
            return;
          }
          onChange(
            pruneFilterGroup(
              stateRef.current,
              group.id,
              fields,
              unfinishedAtOpen.current,
            ),
          );
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            title={label}
            className={cn(CHIP_BUTTON_CLASS, "max-w-[20rem] rounded-s-md")}
          >
            <span className="truncate">{label}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={8}
          className="max-h-[var(--radix-popover-content-available-height)] w-[min(32rem,calc(100vw-1rem))] overflow-y-auto p-2"
        >
          <FilterGroupBlock
            group={group}
            fields={fields}
            state={state}
            onChange={(next) => {
              stateRef.current = next;
              onChange(next);
            }}
            counts={counts}
            nestedGroups={nestedGroups}
            groupMode={groupMode}
            text={text}
          />
        </PopoverContent>
      </Popover>
      <button
        type="button"
        aria-label={text.t("agentChat.filters.removeChip", { label })}
        onClick={() => onChange(removeFilterItem(state, group.id))}
        className="flex h-full shrink-0 items-center rounded-e-md px-1.5 text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconX className="size-3.5" />
      </button>
    </span>
  );
}

function CopyLinkButton({
  text,
  getLink,
}: {
  text: FilterText;
  getLink: () => string;
}) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (status === "idle") return;
    const timer = window.setTimeout(() => setStatus("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [status]);
  const label =
    status === "copied"
      ? text.t("agentChat.filters.linkCopied")
      : status === "failed"
        ? text.t("agentChat.filters.copyFailed")
        : text.t("agentChat.filters.copyLink");
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 shrink-0 text-muted-foreground"
      onClick={() => {
        void writeClipboardText(getLink()).then((copied) =>
          setStatus(copied ? "copied" : "failed"),
        );
      }}
    >
      {status === "copied" ? <IconCheck /> : <IconLink />}
      <span aria-live="polite">{label}</span>
    </Button>
  );
}

export interface FilterBarProps extends FilterControlProps {
  onClear?: () => void;
  /** Whether the bar offers Clear; by default, whenever a filter is set. */
  clearable?: boolean | undefined;
  copyLink?: boolean | (() => string);
  className?: string;
  children?: ReactNode;
}

export function FilterBar({
  fields,
  state,
  onChange,
  counts,
  nestedGroups,
  groupMode,
  onClear,
  clearable,
  copyLink,
  className,
  children,
}: FilterBarProps) {
  const text = useFilterText();
  const shownCounts = useHeldWhilePressed(counts);
  const pinnedFields = fields.filter((field) => field.pinned);
  const canClear =
    clearable ?? (state.mode === "or" || !isDefaultFilterState(state, fields));
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const items = state.items.filter((item) =>
    item.kind === "group"
      ? item.id === openGroupId || completeFilterRules(item, fields).length > 0
      : findFilterField(fields, item.field) !== undefined,
  );
  return (
    <div
      role="toolbar"
      aria-label={text.t("agentChat.filters.toolbar")}
      className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}
    >
      {pinnedFields.map((field) => (
        <PinnedChip
          key={field.id}
          field={field}
          state={state}
          onChange={onChange}
          counts={shownCounts}
          text={text}
        />
      ))}
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index > 0 ? (
            <FilterModeSwitch
              mode={state.mode}
              wording="joiner"
              text={text}
              onChange={(mode) => onChange(setFilterMode(state, mode))}
            />
          ) : null}
          {item.kind === "group" ? (
            <GroupChip
              group={item}
              fields={fields}
              state={state}
              onChange={onChange}
              counts={shownCounts}
              nestedGroups={nestedGroups}
              groupMode={groupMode}
              text={text}
              onOpenChange={(open) => setOpenGroupId(open ? item.id : null)}
            />
          ) : (
            <RuleChipFor
              rule={item}
              fields={fields}
              state={state}
              onChange={onChange}
              counts={shownCounts}
              text={text}
            />
          )}
        </Fragment>
      ))}
      <FilterAddPopover
        fields={fields}
        counts={shownCounts}
        text={text}
        onAdd={(rule) => onChange(addFilterRule(state, rule))}
        modal
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-muted-foreground"
        >
          <IconPlus />
          {text.t("agentChat.filters.filter")}
        </Button>
      </FilterAddPopover>
      {canClear ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 text-muted-foreground"
          onClick={() => {
            onChange(createFilterState(fields));
            onClear?.();
          }}
        >
          {text.t("agentChat.filters.clear")}
        </Button>
      ) : null}
      {copyLink ? (
        <CopyLinkButton
          text={text}
          getLink={
            typeof copyLink === "function"
              ? copyLink
              : () => window.location.href
          }
        />
      ) : null}
      {children}
    </div>
  );
}

function RuleChipFor({
  rule,
  ...props
}: FilterControlProps & { rule: FilterRule; text: FilterText }) {
  const field = findFilterField(props.fields, rule.field);
  if (!field) return null;
  return <RuleChip rule={rule} field={field} {...props} />;
}
