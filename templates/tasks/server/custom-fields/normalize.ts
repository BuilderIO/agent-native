/**
 * Canonicalize validated configs for storage (select option ids and sort order).
 * Shape validation lives in schema.ts; domain rules in validate.ts.
 */
import type {
  FieldConfig,
  FieldDefinition,
  FieldType,
  SelectConfigInput,
  SelectOption,
  SelectOptionInput,
  FieldConfigInput,
  FieldValue,
  FieldValueInput,
} from "./types.js";

const SORT_GAP = 1000;

export function isEmptyFieldValue(value: FieldValueInput): boolean {
  return (
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function normalizeFieldTitle(title: string): string {
  return title.trim();
}

export function normalizeFieldConfigInput<T extends FieldType>(
  type: T,
  config?: FieldConfigInput<T>,
): FieldConfigInput<T> {
  if (type === "text" || type === "rich_text" || type === "date") {
    return {} as FieldConfigInput<T>;
  }

  const input = (config ?? {}) as FieldConfigInput<T>;

  if (type === "number") {
    const numberConfig = input as FieldConfigInput<"number">;
    return {
      precision: numberConfig.precision ?? 0,
      ...(numberConfig.positiveOnly !== undefined
        ? { positiveOnly: numberConfig.positiveOnly }
        : {}),
    } as FieldConfigInput<T>;
  }

  if (type === "percent") {
    const percentConfig = input as FieldConfigInput<"percent">;
    return {
      precision: percentConfig.precision ?? 0,
    } as FieldConfigInput<T>;
  }

  if (type === "currency") {
    const currencyConfig = input as FieldConfigInput<"currency">;
    return {
      symbol:
        currencyConfig.symbol === undefined
          ? "$"
          : currencyConfig.symbol.trim(),
      precision: currencyConfig.precision ?? 2,
    } as FieldConfigInput<T>;
  }

  const selectConfig = input as SelectConfigInput;
  return {
    options: (selectConfig.options ?? []).map((option) => {
      const id = option.id?.trim();
      return {
        ...(id ? { id } : {}),
        name: option.name.trim(),
        ...(option.color !== undefined ? { color: option.color } : {}),
        ...(option.sortOrder !== undefined
          ? { sortOrder: option.sortOrder }
          : {}),
      };
    }),
  } as FieldConfigInput<T>;
}

function optionIdFor(optionName: string) {
  return `opt_${
    optionName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || crypto.randomUUID()
  }`;
}

function canonicalizeSelectOptions(options: SelectOptionInput[]): SelectOption[] {
  const names = new Set<string>();
  const ids = new Set<string>();
  return options
    .map((option, index) => {
      const name = option.name.trim();
      const key = name.toLowerCase();
      if (names.has(key)) {
        throw new Error(`Select option "${name}" is duplicated.`);
      }
      names.add(key);
      const providedId = option.id?.trim();
      const baseId = providedId || optionIdFor(name);
      let optionId = baseId;
      let suffix = 2;
      while (ids.has(optionId)) {
        if (providedId) {
          throw new Error(`Select option id "${providedId}" is duplicated.`);
        }
        optionId = `${baseId}_${suffix}`;
        suffix += 1;
      }
      ids.add(optionId);
      return {
        id: optionId,
        name,
        color: option.color,
        sortOrder: option.sortOrder ?? index * SORT_GAP,
      } satisfies SelectOption;
    })
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function canonicalizeFieldConfig<T extends FieldType>(
  type: T,
  config: FieldConfigInput<T>,
): FieldConfig {
  if (type === "single_select" || type === "multi_select") {
    const selectConfig = config as SelectConfigInput;
    return { options: canonicalizeSelectOptions(selectConfig.options) };
  }

  return config as FieldConfig;
}

export function normalizeFieldValue(
  field: FieldDefinition,
  value: FieldValueInput,
): FieldValue {
  switch (field.type) {
    case "text":
    case "rich_text":
    case "date":
    case "number":
    case "percent":
    case "currency":
    case "single_select":
      return value as FieldValue;
    case "multi_select": {
      const allowedIds = field.config.options.map((option) => option.id);
      const unique = [...new Set(value as string[])];
      return allowedIds.filter((optionId) => unique.includes(optionId));
    }
  }
}
