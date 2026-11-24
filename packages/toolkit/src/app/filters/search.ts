import {
  FILTER_NOBODY,
  filterDatePresets,
  filterOperatorsFor,
  type FilterField,
  type FilterOperator,
} from "./model.js";

export interface FilterValueCandidate {
  value: string[];
  operator: FilterOperator;
  label: string;
}

export interface FilterCandidateLabels {
  nobody: string;
  checked: (field: FilterField<never>) => string;
  unchecked: (field: FilterField<never>) => string;
  datePreset: (operator: FilterOperator, value: string) => string;
}

export type FilterSearchResult<Field extends FilterField<never>> =
  | { kind: "field"; field: Field }
  | { kind: "value"; field: Field; candidate: FilterValueCandidate };

export function matchesFilterQuery(label: string, query: string) {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const haystack = label.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function filterValueCandidates(
  field: FilterField<never>,
  labels: FilterCandidateLabels,
): FilterValueCandidate[] {
  const operators = filterOperatorsFor(field);
  return typeValueCandidates(field, labels).filter((candidate) =>
    operators.includes(candidate.operator),
  );
}

function typeValueCandidates(
  field: FilterField<never>,
  labels: FilterCandidateLabels,
): FilterValueCandidate[] {
  switch (field.type) {
    case "choice":
    case "person": {
      const options = (field.options ?? []).map((option) => ({
        value: [option.id],
        operator: "equals" as const,
        label: option.label,
      }));
      return field.type === "person"
        ? [
            {
              value: [FILTER_NOBODY],
              operator: "equals",
              label: labels.nobody,
            },
            ...options,
          ]
        : options;
    }
    case "multi":
      return (field.options ?? []).map((option) => ({
        value: [option.id],
        operator: "contains",
        label: option.label,
      }));
    case "boolean":
      return [
        { value: [], operator: "is_checked", label: labels.checked(field) },
        { value: [], operator: "is_unchecked", label: labels.unchecked(field) },
      ];
    case "date":
      return filterDatePresets(field).map((preset) => ({
        value: [preset.value],
        operator: preset.operator,
        label: labels.datePreset(preset.operator, preset.value),
      }));
    case "text":
    case "number":
      return [];
  }
}

export function searchFilterFields<Field extends FilterField<never>>(
  fields: readonly Field[],
  query: string,
  labels: FilterCandidateLabels,
): FilterSearchResult<Field>[] {
  const searchable = fields.filter((field) => !field.pinned);
  if (query.trim() === "") {
    return searchable.map((field) => ({ kind: "field", field }));
  }
  const matchingFields: FilterSearchResult<Field>[] = searchable
    .filter((field) => matchesFilterQuery(field.label, query))
    .map((field) => ({ kind: "field", field }));
  const severalWords = query.trim().split(/\s+/).length > 1;
  const matchingValues: FilterSearchResult<Field>[] = [];
  for (const field of searchable) {
    for (const candidate of filterValueCandidates(field, labels)) {
      if (
        matchesFilterQuery(candidate.label, query) ||
        (severalWords &&
          matchesFilterQuery(`${field.label} ${candidate.label}`, query))
      ) {
        matchingValues.push({ kind: "value", field, candidate });
      }
    }
  }
  return [...matchingFields, ...matchingValues];
}
