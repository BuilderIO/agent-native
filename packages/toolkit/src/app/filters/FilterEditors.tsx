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
  FILTER_NOBODY,
  filterOperatorsFor,
  filterOperatorTakesManyValues,
  filterOperatorTakesValue,
  isFilterOperator,
  resolveFilterDateBound,
  type FilterCounts,
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
  const items: FilterListboxItem[] = (["is_checked", "is_unchecked"] as const)
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
  return (
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
  const exactOperators =
    rule.operator === "does_not_equal"
      ? [...EXACT_DATE_OPERATORS, rule.operator]
      : EXACT_DATE_OPERATORS;
  const [exactOperator, setExactOperator] = useState<FilterOperator>(
    exactOperators.includes(rule.operator) ? rule.operator : "equals",
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
    exactDays.map((value) => value !== "" && !DAY_VALUE.test(value)),
  );
  const between = exactOperator === "between";
  const exactValue = between ? exactDays : exactDays.slice(0, 1);
  const candidates: FilterValueCandidate[] = [
    ...filterValueCandidates(field, filterCandidateLabels(text)),
    ...(field.alwaysSet
      ? []
      : (["is_empty", "is_not_empty"] as const).map((operator) => ({
          operator,
          value: [],
          label: text.operatorLabel(field, operator),
        }))),
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
          <Button type="submit" size="sm" disabled={!exactValid}>
            {text.t("agentChat.filters.apply")}
          </Button>
        </form>
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
        <div className="flex min-w-0 flex-col">
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
