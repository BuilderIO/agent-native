import { Button } from "@agent-native/toolkit/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@agent-native/toolkit/ui/dropdown-menu";
import { Input } from "@agent-native/toolkit/ui/input";
import { cn } from "@agent-native/toolkit/utils";
import { IconChevronDown } from "@tabler/icons-react";
import { useState } from "react";

import { FilterListbox, type FilterListboxItem } from "./FilterListbox.js";
import {
  FILTER_DATE_RANGE_MAX_COUNT,
  FILTER_DATE_UNITS,
  FILTER_NOBODY,
  FILTER_RELATIVE_DAYS,
  filterDateRangeToken,
  filterOperatorsAcceptedFor,
  filterOperatorsFor,
  filterOperatorTakesManyValues,
  filterOperatorTakesValue,
  isFilterOperator,
  isFilterRelativeDay,
  parseFilterDateRange,
  resolveFilterDateBound,
  type FilterCounts,
  type FilterDateUnit,
  type FilterField,
  type FilterOperator,
  type FilterRule,
  type FilterRulePatch,
} from "./model.js";
import {
  filterValueCandidates,
  matchesFilterQuery,
  searchFilterFields,
  type FilterCandidateLabels,
  type FilterValueCandidate,
} from "./search.js";
import type { FilterText } from "./text.js";

export function filterCandidateLabels(text: FilterText): FilterCandidateLabels {
  return {
    nobody: text.t("agentChat.filters.nobody"),
    checked: (field) => text.booleanLabel(field, true),
    unchecked: (field) => text.booleanLabel(field, false),
    datePreset: (operator, value) =>
      operator === "is_within" ? text.rangeLabel(value) : text.dayLabel(value),
  };
}

function countDetail(
  counts: FilterCounts | undefined,
  text: FilterText,
  fieldId: string,
  optionId: string,
) {
  const count = counts?.option(fieldId, optionId);
  return count === undefined ? undefined : text.formatNumber(count);
}

export function FilterOperatorSelect({
  field,
  operator,
  operators = filterOperatorsFor(field),
  valueCount,
  text,
  onChange,
  className,
}: {
  field: FilterField<never>;
  operator: FilterOperator;
  operators?: readonly FilterOperator[];
  valueCount: number;
  text: FilterText;
  onChange: (operator: FilterOperator) => void;
  className?: string;
}) {
  const shown = operators.includes(operator)
    ? operators
    : [...operators, operator];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 min-w-0 shrink-0 gap-1 px-2 font-normal text-muted-foreground",
            className,
          )}
        >
          <span className="truncate">
            {text.operatorLabel(field, operator, valueCount)}
          </span>
          <IconChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8}>
        <DropdownMenuRadioGroup
          value={operator}
          onValueChange={(value) => {
            if (isFilterOperator(value)) onChange(value);
          }}
        >
          {shown.map((candidate) => (
            <DropdownMenuRadioItem key={candidate} value={candidate}>
              {text.operatorLabel(field, candidate, Math.max(valueCount, 1))}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function FilterValuePicker({
  field,
  rule,
  counts,
  text,
  onChange,
  onDone,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  counts?: FilterCounts | undefined;
  text: FilterText;
  onChange: (value: string[]) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const multiple = filterOperatorTakesManyValues(field, rule.operator);
  const options = [
    ...(field.type === "person"
      ? [{ id: FILTER_NOBODY, label: text.t("agentChat.filters.nobody") }]
      : []),
    ...(field.options ?? []),
  ];
  const items: FilterListboxItem[] = options
    .filter((option) => matchesFilterQuery(option.label, query))
    .map((option) => ({
      key: option.id,
      label: option.label,
      icon: "icon" in option ? option.icon : undefined,
      checked: multiple ? rule.value.includes(option.id) : undefined,
      detail: countDetail(counts, text, field.id, option.id),
    }));
  const trimmed = query.trim();
  const empty =
    trimmed === ""
      ? text.t("agentChat.filters.noOptions")
      : field.valueNoun
        ? text.t("agentChat.filters.noValueMatchNoun", {
            noun: field.valueNoun.one,
            nouns: field.valueNoun.other,
            query: trimmed,
          })
        : text.t("agentChat.filters.noValueMatch", { query: trimmed });
  return (
    <FilterListbox
      label={text.fieldLabel(field)}
      placeholder={text.t("agentChat.filters.search")}
      query={query}
      onQueryChange={setQuery}
      items={items}
      empty={empty}
      multiple={multiple}
      onPick={(item, via) => {
        if (!multiple) {
          onChange([item.key]);
          onDone();
          return;
        }
        onChange(
          rule.value.includes(item.key)
            ? rule.value.filter((value) => value !== item.key)
            : [...rule.value, item.key],
        );
        if (via === "enter") onDone();
      }}
    />
  );
}

export function FilterBooleanPicker({
  field,
  rule,
  text,
  onChange,
  onDone,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  text: FilterText;
  onChange: (operator: FilterOperator) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const listed = filterOperatorsFor(field);
  const items: FilterListboxItem[] = (["is_checked", "is_unchecked"] as const)
    .filter((operator) => listed.includes(operator))
    .map((operator) => ({
      key: operator,
      label: text.booleanLabel(field, operator === "is_checked"),
      checked: rule.operator === operator,
    }))
    .filter((item) => matchesFilterQuery(item.label, query));
  return (
    <FilterListbox
      label={text.fieldLabel(field)}
      placeholder={text.t("agentChat.filters.search")}
      query={query}
      onQueryChange={setQuery}
      items={items}
      empty={text.t("agentChat.filters.noValueMatch", { query: query.trim() })}
      onPick={(item) => {
        if (isFilterOperator(item.key)) onChange(item.key);
        onDone();
      }}
    />
  );
}

const EXACT_DATE_OPERATORS: readonly FilterOperator[] = [
  "equals",
  "before",
  "after",
  "on_or_before",
  "on_or_after",
  "between",
];

const DAY_VALUE = /^\d{4}-\d{2}-\d{2}$/;

const EXACT_DAY = "exact";

function FilterDateInput({
  value,
  label,
  asText,
  text,
  onChange,
}: {
  value: string;
  label: string;
  asText: boolean;
  text: FilterText;
  onChange: (value: string) => void;
}) {
  const day = value.trim();
  const relative = isFilterRelativeDay(day);
  const shown = relative
    ? text.dayLabel(day)
    : text.t("agentChat.filters.exactDate");
  return (
    <div
      role="group"
      aria-label={label}
      className="flex min-w-0 basis-full items-center gap-1"
    >
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-w-0 shrink-0 gap-1 text-muted-foreground"
            aria-label={
              shown === label
                ? undefined
                : text.t("agentChat.filters.fieldValue", {
                    field: label,
                    value: shown,
                  })
            }
          >
            <span className="truncate">{shown}</span>
            <IconChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" collisionPadding={8}>
          <DropdownMenuRadioGroup
            value={relative ? day : EXACT_DAY}
            onValueChange={(next) => onChange(next === EXACT_DAY ? "" : next)}
          >
            <DropdownMenuRadioItem value={EXACT_DAY}>
              {text.t("agentChat.filters.exactDate")}
            </DropdownMenuRadioItem>
            {FILTER_RELATIVE_DAYS.map((day) => (
              <DropdownMenuRadioItem key={day} value={day}>
                {text.dayLabel(day)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {relative ? null : (
        <Input
          type={asText ? "text" : "date"}
          value={value}
          aria-label={label}
          placeholder={
            asText ? text.t("agentChat.filters.dateTimeFormat") : undefined
          }
          onChange={(event) => onChange(event.target.value)}
          size="sm"
          className="min-w-0 flex-1"
        />
      )}
    </div>
  );
}

function FilterChoiceMenu<Choice extends string>({
  choices,
  selected,
  label,
  onSelect,
}: {
  choices: readonly Choice[];
  selected: Choice;
  label: (choice: Choice) => string;
  onSelect: (choice: Choice) => void;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-w-0 shrink-0 gap-1 text-muted-foreground"
        >
          <span className="truncate">{label(selected)}</span>
          <IconChevronDown className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" collisionPadding={8}>
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(value) => {
            const choice = choices.find((candidate) => candidate === value);
            if (choice) onSelect(choice);
          }}
        >
          {choices.map((choice) => (
            <DropdownMenuRadioItem key={choice} value={choice}>
              {label(choice)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FilterDateRangeForm({
  field,
  rule,
  text,
  onApply,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  text: FilterText;
  onApply: (token: string) => void;
}) {
  const fieldDirections: readonly ("past" | "next")[] =
    field.dates === "past"
      ? ["past"]
      : field.dates === "future"
        ? ["next"]
        : ["past", "next"];
  const saved =
    rule.operator === "is_within"
      ? parseFilterDateRange(rule.value.at(0) ?? "")
      : null;
  const savedDirection =
    saved && saved.direction !== "this" ? saved.direction : null;
  const directions =
    savedDirection && !fieldDirections.includes(savedDirection)
      ? [...fieldDirections, savedDirection]
      : fieldDirections;
  const [direction, setDirection] = useState<"past" | "next">(
    savedDirection ?? directions.at(0) ?? "past",
  );
  const [count, setCount] = useState(
    saved && saved.direction !== "this" ? String(saved.count) : "7",
  );
  const [unit, setUnit] = useState<FilterDateUnit>(
    saved && saved.direction !== "this" ? saved.unit : "day",
  );
  const typed = Number(count);
  const valid =
    Number.isInteger(typed) &&
    typed >= 1 &&
    typed <= FILTER_DATE_RANGE_MAX_COUNT;
  const directionLabel = (choice: "past" | "next") =>
    text.t(`agentChat.filters.date.direction.${choice}`);
  return (
    <form
      className="flex flex-wrap items-center gap-1.5 border-t p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!valid) return;
        onApply(filterDateRangeToken({ direction, count: typed, unit }));
      }}
    >
      <span className="w-full text-xs font-medium text-muted-foreground">
        {text.t("agentChat.filters.relativeRange")}
      </span>
      {directions.length > 1 ? (
        <FilterChoiceMenu
          choices={directions}
          selected={direction}
          label={directionLabel}
          onSelect={setDirection}
        />
      ) : (
        <span className="px-2 text-sm text-muted-foreground">
          {directionLabel(direction)}
        </span>
      )}
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        max={FILTER_DATE_RANGE_MAX_COUNT}
        step={1}
        value={count}
        aria-label={text.t("agentChat.filters.enterNumber")}
        aria-invalid={!valid}
        onChange={(event) => setCount(event.target.value)}
        size="sm"
        className="w-16 shrink-0"
      />
      <FilterChoiceMenu
        choices={FILTER_DATE_UNITS}
        selected={unit}
        label={(choice) => text.unitName(valid ? typed : 2, choice)}
        onSelect={setUnit}
      />
      <Button type="submit" size="sm" className="ms-auto" disabled={!valid}>
        {text.t("agentChat.filters.apply")}
      </Button>
    </form>
  );
}

export function FilterDateEditor({
  field,
  rule,
  text,
  onChange,
  onDone,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  text: FilterText;
  onChange: (patch: FilterRulePatch) => void;
  onDone: () => void;
}) {
  const [query, setQuery] = useState("");
  const listed = filterOperatorsFor(field);
  const listedExact = EXACT_DATE_OPERATORS.filter((operator) =>
    listed.includes(operator),
  );
  const exactOperators =
    rule.operator === "does_not_equal" &&
    filterOperatorsAcceptedFor(field).includes(rule.operator)
      ? [...listedExact, rule.operator]
      : listedExact;
  const [exactOperator, setExactOperator] = useState<FilterOperator>(
    exactOperators.includes(rule.operator)
      ? rule.operator
      : (exactOperators.at(0) ?? "equals"),
  );
  const readable = (value: string | undefined = "") =>
    resolveFilterDateBound(value, "2000-01-01", { times: field.times })
      ? value
      : "";
  const [exactDays, setExactDays] = useState<[string, string]>(() =>
    rule.operator === "is_within"
      ? ["", ""]
      : [readable(rule.value.at(0)), readable(rule.value.at(1))],
  );
  const [asText] = useState(() =>
    exactDays.map(
      (value) =>
        value !== "" &&
        !DAY_VALUE.test(value) &&
        !isFilterRelativeDay(value.trim()),
    ),
  );
  const between = exactOperator === "between";
  const exactValue = between ? exactDays : exactDays.slice(0, 1);
  const candidates: FilterValueCandidate[] = [
    ...filterValueCandidates(field, filterCandidateLabels(text)),
    ...(["is_empty", "is_not_empty"] as const)
      .filter((operator) => listed.includes(operator))
      .map((operator) => ({
        operator,
        value: [],
        label: text.operatorLabel(field, operator),
      })),
  ];
  const items: FilterListboxItem[] = candidates
    .filter((candidate) => matchesFilterQuery(candidate.label, query))
    .map((candidate) => ({
      key: `${candidate.operator}:${candidate.value.join(",")}`,
      label: candidate.label,
      checked:
        candidate.operator === rule.operator &&
        candidate.value.join(",") === rule.value.join(","),
    }));
  const exactValid = exactValue.every(
    (value) =>
      resolveFilterDateBound(value, "2000-01-01", { times: field.times }) !==
      null,
  );
  const applyExact = () => {
    if (!exactValid) return;
    onChange({
      operator: exactOperator,
      value: exactValue.map((value) => value.trim()),
    });
    onDone();
  };
  const setExactDay = (index: 0 | 1, value: string) =>
    setExactDays((days) => (index === 0 ? [value, days[1]] : [days[0], value]));
  return (
    <FilterListbox
      label={text.fieldLabel(field)}
      placeholder={text.t("agentChat.filters.search")}
      query={query}
      onQueryChange={setQuery}
      items={items}
      empty={text.t("agentChat.filters.noValueMatch", { query: query.trim() })}
      onPick={(item) => {
        const candidate = candidates.find(
          (entry) => `${entry.operator}:${entry.value.join(",")}` === item.key,
        );
        if (!candidate) return;
        onChange({ operator: candidate.operator, value: candidate.value });
        onDone();
      }}
      footer={
        <>
          {exactOperators.length === 0 ? null : (
            <form
              className="flex flex-wrap items-center gap-1.5 border-t p-2"
              onSubmit={(event) => {
                event.preventDefault();
                applyExact();
              }}
            >
              <span className="w-full text-xs font-medium text-muted-foreground">
                {text.t("agentChat.filters.exactDate")}
              </span>
              <FilterOperatorSelect
                field={field}
                operator={exactOperator}
                operators={exactOperators}
                valueCount={1}
                text={text}
                onChange={setExactOperator}
              />
              <FilterDateInput
                value={exactDays[0]}
                label={text.t(
                  between
                    ? "agentChat.filters.startDate"
                    : "agentChat.filters.exactDate",
                )}
                asText={asText[0] === true}
                text={text}
                onChange={(value) => setExactDay(0, value)}
              />
              {between ? (
                <FilterDateInput
                  value={exactDays[1]}
                  label={text.t("agentChat.filters.endDate")}
                  asText={asText[1] === true}
                  text={text}
                  onChange={(value) => setExactDay(1, value)}
                />
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="ms-auto"
                disabled={!exactValid}
              >
                {text.t("agentChat.filters.apply")}
              </Button>
            </form>
          )}
          {listed.includes("is_within") ? (
            <FilterDateRangeForm
              field={field}
              rule={rule}
              text={text}
              onApply={(token) => {
                onChange({ operator: "is_within", value: [token] });
                onDone();
              }}
            />
          ) : null}
        </>
      }
    />
  );
}

export function FilterInputEditor({
  field,
  rule,
  text,
  showOperator,
  onChange,
  onDone,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  text: FilterText;
  showOperator: boolean;
  onChange: (patch: FilterRulePatch) => void;
  onDone: () => void;
}) {
  const [draft, setDraft] = useState(rule.value.at(0) ?? "");
  const takesValue = filterOperatorTakesValue(rule.operator);
  const trimmed = draft.trim();
  const valid =
    trimmed !== "" &&
    (field.type !== "number" || Number.isFinite(Number(trimmed)));
  return (
    <form
      className="flex flex-col gap-2 p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (!takesValue) {
          onDone();
          return;
        }
        if (!valid) return;
        onChange({ value: [trimmed] });
        onDone();
      }}
    >
      {showOperator ? (
        <FilterOperatorSelect
          field={field}
          operator={rule.operator}
          valueCount={1}
          text={text}
          onChange={(operator) => onChange({ operator })}
          className="self-start"
        />
      ) : null}
      {takesValue ? (
        <div className="flex items-center gap-1.5">
          <Input
            autoFocus
            type={field.type === "number" ? "number" : "text"}
            inputMode={field.type === "number" ? "decimal" : undefined}
            value={draft}
            placeholder={
              field.type === "number"
                ? text.t("agentChat.filters.enterNumber")
                : text.t("agentChat.filters.typeValue")
            }
            aria-label={text.fieldLabel(field)}
            onChange={(event) => setDraft(event.target.value)}
            className="h-8 min-w-0 flex-1"
          />
          <Button type="submit" size="sm" disabled={!valid}>
            {text.t("agentChat.filters.apply")}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

export function FilterRuleEditor({
  field,
  rule,
  counts,
  text,
  showOperator = true,
  onChange,
  onDone,
}: {
  field: FilterField<never>;
  rule: FilterRule;
  counts?: FilterCounts | undefined;
  text: FilterText;
  showOperator?: boolean | undefined;
  onChange: (patch: FilterRulePatch) => void;
  onDone: () => void;
}) {
  switch (field.type) {
    case "choice":
    case "person":
    case "multi": {
      const operators = filterOperatorsFor(field);
      return (
        <div className="flex min-h-0 min-w-0 flex-col">
          {showOperator && operators.length > 1 ? (
            <div className="border-b p-1">
              <FilterOperatorSelect
                field={field}
                operator={rule.operator}
                valueCount={rule.value.length}
                text={text}
                onChange={(operator) => onChange({ operator })}
              />
            </div>
          ) : null}
          {filterOperatorTakesValue(rule.operator) ? (
            <FilterValuePicker
              field={field}
              rule={rule}
              counts={counts}
              text={text}
              onChange={(value) => onChange({ value })}
              onDone={onDone}
            />
          ) : null}
        </div>
      );
    }
    case "boolean":
      return (
        <FilterBooleanPicker
          field={field}
          rule={rule}
          text={text}
          onChange={(operator) => onChange({ operator, value: [] })}
          onDone={onDone}
        />
      );
    case "date":
      return (
        <FilterDateEditor
          field={field}
          rule={rule}
          text={text}
          onChange={onChange}
          onDone={onDone}
        />
      );
    case "text":
    case "number":
      return (
        <FilterInputEditor
          field={field}
          rule={rule}
          text={text}
          showOperator={showOperator}
          onChange={onChange}
          onDone={onDone}
        />
      );
  }
}

export function FilterFieldPicker<Field extends FilterField<never>>({
  fields,
  text,
  includeValues = true,
  onPickField,
  onPickValue,
}: {
  fields: readonly Field[];
  text: FilterText;
  includeValues?: boolean;
  onPickField: (field: Field) => void;
  onPickValue?: (field: Field, candidate: FilterValueCandidate) => void;
}) {
  const [query, setQuery] = useState("");
  const results = searchFilterFields(
    fields,
    query,
    filterCandidateLabels(text),
  ).filter((result) => includeValues || result.kind === "field");
  const searching = query.trim() !== "";
  const items: FilterListboxItem[] = results.map((result) =>
    result.kind === "field"
      ? {
          key: `field:${result.field.id}`,
          label: result.field.label,
          icon: result.field.icon,
          section: searching ? text.t("agentChat.filters.fields") : undefined,
        }
      : {
          key: `value:${result.field.id}:${result.candidate.operator}:${result.candidate.value.join(",")}`,
          label: text.t("agentChat.filters.fieldValue", {
            field: text.fieldLabel(result.field),
            value: result.candidate.label,
          }),
          icon: result.field.icon,
          section: text.t("agentChat.filters.values"),
        },
  );
  return (
    <FilterListbox
      label={text.t("agentChat.filters.pickField")}
      placeholder={
        includeValues
          ? text.t("agentChat.filters.searchFieldsAndValues")
          : text.t("agentChat.filters.search")
      }
      query={query}
      onQueryChange={setQuery}
      items={items}
      empty={text.t("agentChat.filters.noFieldMatch", { query: query.trim() })}
      onPick={(item) => {
        const index = items.indexOf(item);
        const result = index >= 0 ? results.at(index) : undefined;
        if (!result) return;
        if (result.kind === "field") onPickField(result.field);
        else onPickValue?.(result.field, result.candidate);
      }}
    />
  );
}
