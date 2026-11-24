import { Button } from "@agent-native/toolkit/ui/button";
import { Checkbox } from "@agent-native/toolkit/ui/checkbox";
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
import { cn } from "@agent-native/toolkit/utils";
import {
  IconChevronDown,
  IconChevronLeft,
  IconPlus,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState, type ReactNode } from "react";

import {
  FilterFieldPicker,
  FilterOperatorSelect,
  FilterRuleEditor,
} from "./FilterEditors.js";
import {
  addFilterGroup,
  addFilterRule,
  createFilterGroup,
  createFilterRule,
  filterOperatorTakesValue,
  findFilterField,
  findFilterRule,
  isFilterRuleComplete,
  patchFilterRule,
  pinnedFilterCoversAll,
  pinnedFilterValue,
  removeFilterItem,
  setFilterMode,
  updateFilterRule,
  type FilterCounts,
  type FilterField,
  type FilterGroup,
  type FilterMode,
  type FilterRule,
  type FilterState,
} from "./model.js";
import type { FilterText } from "./text.js";

export interface FilterNouns {
  items: string;
  /** Shown with `counts.matching`; leave it out when the app passes no counts. */
  matchCount?: ((count: number) => string) | undefined;
  /** The phone sheet's done button with `counts.matching`. */
  showCount?: ((count: number) => string) | undefined;
}

export interface FilterControlProps {
  fields: readonly FilterField<never>[];
  state: FilterState;
  onChange: (next: FilterState) => void;
  counts?: FilterCounts | undefined;
  /** Lets a group hold groups of its own, one level down, as Content's saved views do. */
  nestedGroups?: boolean | undefined;
  /** How a group added from these controls starts matching its rules; `"or"` unless set. */
  groupMode?: FilterMode | undefined;
}

export const FILTER_POPOVER_CLASS =
  "flex max-h-[var(--radix-popover-content-available-height)] w-[min(20rem,calc(100vw-1rem))] flex-col overflow-y-auto overflow-x-hidden p-0";

export function FilterModeSwitch({
  mode,
  wording,
  text,
  onChange,
}: {
  mode: FilterMode;
  wording: "joiner" | "quantifier";
  text: FilterText;
  onChange: (mode: FilterMode) => void;
}) {
  const label =
    wording === "joiner"
      ? text.t(mode === "or" ? "agentChat.filters.or" : "agentChat.filters.and")
      : text.t(
          mode === "or"
            ? "agentChat.filters.modeAny"
            : "agentChat.filters.modeAll",
        );
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={text.t("agentChat.filters.switchMode")}
          className="h-6 shrink-0 gap-0.5 px-1.5 text-xs font-medium text-muted-foreground"
        >
          {label}
          <IconChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8}>
        <DropdownMenuRadioGroup
          value={mode}
          onValueChange={(value) => {
            if (value === "and" || value === "or") onChange(value);
          }}
        >
          <DropdownMenuRadioItem value="and">
            {text.t("agentChat.filters.modeAllDescription")}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="or">
            {text.t("agentChat.filters.modeAnyDescription")}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const MODE_SLOT = "\u0000mode\u0000";

export function FilterModeSentence({
  sentence,
  values,
  mode,
  text,
  onChange,
}: {
  sentence:
    | "agentChat.filters.matchSentence"
    | "agentChat.filters.groupSentence";
  values?: Record<string, string>;
  mode: FilterMode;
  text: FilterText;
  onChange: (mode: FilterMode) => void;
}) {
  const [before = "", after = ""] = text
    .t(sentence, { ...values, mode: MODE_SLOT })
    .split(MODE_SLOT)
    .map((part) => part.trim());
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      {before === "" ? null : <span>{before}</span>}
      <FilterModeSwitch
        mode={mode}
        wording="quantifier"
        text={text}
        onChange={onChange}
      />
      {after === "" ? null : <span>{after}</span>}
    </div>
  );
}

export function FilterAddPopover({
  fields,
  counts,
  text,
  onAdd,
  modal,
  children,
}: {
  fields: readonly FilterField<never>[];
  counts?: FilterCounts | undefined;
  text: FilterText;
  onAdd: (rule: FilterRule) => void;
  modal?: boolean | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<FilterRule | null>(null);
  const draftRef = useRef<FilterRule | null>(null);
  const chosenRef = useRef(false);
  const updateDraft = (next: FilterRule | null, chosen = false) => {
    draftRef.current = next;
    chosenRef.current = chosen;
    setDraft(next);
  };
  const finish = (rule: FilterRule | null, chosen: boolean) => {
    if (
      chosen &&
      rule &&
      isFilterRuleComplete(rule, findFilterField(fields, rule.field))
    ) {
      onAdd(rule);
    }
    updateDraft(null);
    setOpen(false);
  };
  const draftField = draft ? findFilterField(fields, draft.field) : undefined;
  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(next) => {
        if (next) setOpen(true);
        else finish(draftRef.current, chosenRef.current);
      }}
    >
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className={FILTER_POPOVER_CLASS}
        onEscapeKeyDown={(event) => {
          if (!draftRef.current) return;
          event.preventDefault();
          updateDraft(null);
        }}
      >
        {draft && draftField ? (
          <div className="flex min-h-0 min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-1 border-b px-1 py-1">
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={text.t("agentChat.filters.back")}
                onClick={() => updateDraft(null)}
              >
                <IconChevronLeft />
              </Button>
              <span
                className="min-w-0 truncate text-xs font-medium text-muted-foreground"
                title={draftField.label}
              >
                {draftField.label}
              </span>
            </div>
            <FilterRuleEditor
              field={draftField}
              rule={draft}
              counts={counts}
              text={text}
              onChange={(patch) => {
                const current = draftRef.current;
                if (current)
                  updateDraft(patchFilterRule(current, patch, fields), true);
              }}
              onDone={() => finish(draftRef.current, chosenRef.current)}
            />
          </div>
        ) : (
          <FilterFieldPicker
            fields={fields}
            text={text}
            onPickField={(field) => updateDraft(createFilterRule(field))}
            onPickValue={(field, candidate) =>
              finish(
                createFilterRule(field, candidate.value, candidate.operator),
                true,
              )
            }
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterPinnedOptions({
  field,
  state,
  counts,
  text,
  onChange,
}: {
  field: FilterField<never>;
  state: FilterState;
  counts?: FilterCounts | undefined;
  text: FilterText;
  onChange: (value: string[]) => void;
}) {
  const value = pinnedFilterValue(state, field);
  const options = field.options ?? [];
  return (
    <div role="group" aria-label={field.label} className="flex flex-col">
      {options.map((option) => {
        const checked = value.includes(option.id);
        const count = counts?.option(field.id, option.id);
        return (
          <label
            key={option.id}
            className="flex min-w-0 cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            <Checkbox
              checked={checked}
              disabled={checked && value.length === 1}
              onCheckedChange={(next) => {
                const selected = new Set(value);
                if (next === true) selected.add(option.id);
                else selected.delete(option.id);
                onChange(
                  options
                    .map((candidate) => candidate.id)
                    .filter((id) => selected.has(id)),
                );
              }}
            />
            {option.icon ? (
              <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-4">
                {option.icon}
              </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate" title={option.label}>
              {option.label}
            </span>
            {count === undefined ? null : (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {text.formatNumber(count)}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

export function pinnedValueLabel(
  field: FilterField<never>,
  state: FilterState,
  text: FilterText,
) {
  const value = pinnedFilterValue(state, field);
  if (field.pinned?.allLabel && pinnedFilterCoversAll(value, field)) {
    return field.pinned.allLabel;
  }
  return text.optionList(field, value);
}

function FilterValueButton({
  field,
  rule,
  state,
  fields,
  counts,
  text,
  onChange,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  state: FilterState;
  fields: readonly FilterField<never>[];
  counts?: FilterCounts | undefined;
  text: FilterText;
  onChange: (next: FilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const complete = isFilterRuleComplete(rule, field);
  const label = complete
    ? text.valueLabel(field, rule)
    : text.t("agentChat.filters.chooseValue");
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={label}
          className={cn(
            "h-8 min-w-0 flex-1 justify-start font-normal",
            !complete && "text-muted-foreground",
          )}
        >
          <span className="truncate">{label}</span>
        </Button>
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
          showOperator={false}
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
  );
}

function FilterFieldButton({
  field,
  rule,
  state,
  fields,
  text,
  onChange,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  state: FilterState;
  fields: readonly FilterField<never>[];
  text: FilterText;
  onChange: (next: FilterState) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={field.label}
          className="h-8 min-w-0 max-w-[11rem] shrink justify-start gap-1.5 font-normal"
        >
          {field.icon ? (
            <span className="flex shrink-0 items-center text-muted-foreground">
              {field.icon}
            </span>
          ) : null}
          <span className="truncate">{field.label}</span>
          <IconChevronDown className="ms-auto size-3.5 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        collisionPadding={8}
        className={FILTER_POPOVER_CLASS}
      >
        <FilterFieldPicker
          fields={fields}
          text={text}
          includeValues={false}
          onPickField={(next) => {
            onChange(
              updateFilterRule(state, rule.id, { field: next.id }, fields),
            );
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export function FilterRuleRow({
  rule,
  fields,
  state,
  onChange,
  counts,
  text,
}: FilterControlProps & { rule: FilterRule; text: FilterText }) {
  const field = findFilterField(fields, rule.field);
  if (!field) return null;
  const showsValue =
    field.type === "boolean" || filterOperatorTakesValue(rule.operator);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap">
      <FilterFieldButton
        field={field}
        rule={rule}
        state={state}
        fields={fields}
        text={text}
        onChange={onChange}
      />
      {field.type === "boolean" ? null : (
        <FilterOperatorSelect
          field={field}
          operator={rule.operator}
          valueCount={rule.value.length}
          text={text}
          onChange={(operator) =>
            onChange(updateFilterRule(state, rule.id, { operator }, fields))
          }
        />
      )}
      {showsValue ? (
        <FilterValueButton
          field={field}
          rule={rule}
          state={state}
          fields={fields}
          counts={counts}
          text={text}
          onChange={onChange}
        />
      ) : (
        <span className="flex-1" />
      )}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={text.t("agentChat.filters.removeRule")}
        onClick={() => onChange(removeFilterItem(state, rule.id))}
        className="shrink-0 text-muted-foreground"
      >
        <IconX />
      </Button>
    </div>
  );
}

export function FilterGroupBlock({
  group,
  fields,
  state,
  onChange,
  counts,
  nestedGroups,
  groupMode,
  nested = false,
  text,
}: FilterControlProps & {
  group: FilterGroup;
  nested?: boolean;
  text: FilterText;
}) {
  const canAddGroup = nestedGroups === true && !nested;
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-md border p-2",
        nested ? "bg-background" : "bg-muted/30",
      )}
    >
      <div className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        <FilterModeSentence
          sentence="agentChat.filters.groupSentence"
          mode={group.mode}
          text={text}
          onChange={(mode) => onChange(setFilterMode(state, mode, group.id))}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={text.t("agentChat.filters.removeGroup")}
          onClick={() => onChange(removeFilterItem(state, group.id))}
          className="ms-auto"
        >
          <IconX />
        </Button>
      </div>
      {group.rules.map((member) =>
        member.kind === "rule" ? (
          <FilterRuleRow
            key={member.id}
            rule={member}
            fields={fields}
            state={state}
            onChange={onChange}
            counts={counts}
            text={text}
          />
        ) : (
          <FilterGroupBlock
            key={member.id}
            group={member}
            fields={fields}
            state={state}
            onChange={onChange}
            counts={counts}
            groupMode={groupMode}
            nested
            text={text}
          />
        ),
      )}
      <div className="flex flex-wrap items-center gap-1">
        <FilterAddPopover
          fields={fields}
          counts={counts}
          text={text}
          onAdd={(rule) => onChange(addFilterRule(state, rule, group.id))}
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
          >
            <IconPlus />
            {text.t("agentChat.filters.addRule")}
          </Button>
        </FilterAddPopover>
        {canAddGroup ? (
          <FilterAddPopover
            fields={fields}
            counts={counts}
            text={text}
            onAdd={(rule) =>
              onChange(
                addFilterGroup(
                  state,
                  createFilterGroup([rule], groupMode),
                  group.id,
                ),
              )
            }
          >
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
            >
              <IconPlus />
              {text.t("agentChat.filters.addGroup")}
            </Button>
          </FilterAddPopover>
        ) : null}
      </div>
    </div>
  );
}
