import { UserInputError } from "../errors.js";
import {
  SELECT_COLOR_TOKENS,
  type FieldConfigInput,
  type FieldDefinition,
  type FieldType,
  type FieldValue,
  type FieldValueInput,
  type SelectConfigInput,
} from "./types.js";

export function validateFieldTitle(title: string): void {
  if (!title.trim()) throw new UserInputError("Field title is required.");
}

function validatePrecision(precision: number | undefined): void {
  if (precision === undefined) return;
  if (!Number.isInteger(precision) || precision < 0 || precision > 6) {
    throw new UserInputError("precision must be an integer between 0 and 6.");
  }
}

function validateSelectColor(color: string | undefined): void {
  if (color === undefined) return;
  if (!(SELECT_COLOR_TOKENS as readonly string[]).includes(color)) {
    throw new UserInputError("Select option color is invalid.");
  }
}

function validateSelectConfig(config: SelectConfigInput): void {
  for (const [index, option] of (config.options ?? []).entries()) {
    if (!option.name.trim()) {
      throw new UserInputError(`Select option #${index + 1} name is required.`);
    }
    if (option.id?.trim() === "") {
      throw new UserInputError(
        `Select option #${index + 1} id cannot be empty.`,
      );
    }
    const sortOrder = option.sortOrder;
    if (
      sortOrder !== undefined &&
      (!Number.isInteger(sortOrder) || sortOrder < 0)
    ) {
      throw new UserInputError(
        `Select option #${index + 1} sortOrder must be a non-negative integer.`,
      );
    }
    validateSelectColor(option.color);
  }
}

export function validateFieldConfig<T extends FieldType>(
  type: T,
  config?: FieldConfigInput<T>,
): void {
  if (type === "text" || type === "rich_text" || type === "date") {
    return;
  }

  const input = (config ?? {}) as FieldConfigInput<T>;

  if (type === "number") {
    const numberConfig = input as FieldConfigInput<"number">;
    validatePrecision(numberConfig.precision);
    if (
      numberConfig.positiveOnly !== undefined &&
      typeof numberConfig.positiveOnly !== "boolean"
    ) {
      throw new UserInputError("positiveOnly must be a boolean.");
    }
    return;
  }

  if (type === "percent") {
    validatePrecision((input as FieldConfigInput<"percent">).precision);
    return;
  }

  if (type === "currency") {
    const currencyConfig = input as FieldConfigInput<"currency">;
    if (currencyConfig.symbol !== undefined) {
      const symbol = currencyConfig.symbol.trim();
      if (!symbol) throw new UserInputError("Currency symbol is required.");
      if (symbol.length > 8) {
        throw new UserInputError(
          "Currency symbol must be at most 8 characters.",
        );
      }
    }
    validatePrecision(currencyConfig.precision);
    return;
  }

  validateSelectConfig(input as SelectConfigInput);
}

function assertPrecision(value: number, precision: number): void {
  const factor = 10 ** precision;
  const scaled = value * factor;
  const tolerance = Number.EPSILON * Math.max(1, Math.abs(scaled)) * 100;
  if (Math.abs(scaled - Math.round(scaled)) > tolerance) {
    throw new UserInputError(
      precision === 0
        ? "Value must be a whole number."
        : `Value must have at most ${precision} decimal places.`,
    );
  }
}

function validateNumericValue(
  value: number,
  precision: number,
  options?: { positiveOnly?: boolean },
): void {
  if (!Number.isFinite(value)) {
    throw new UserInputError("Invalid number value.");
  }
  assertPrecision(value, precision);
  if (options?.positiveOnly && value < 0) {
    throw new UserInputError("Value must be zero or positive.");
  }
}

function validateIsoDate(value: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UserInputError("Invalid date value.");
  }
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new UserInputError("Invalid date value.");
  }
}

function validateSelectValue(
  field: Extract<FieldDefinition, { type: "single_select" | "multi_select" }>,
  value: FieldValue,
): void {
  const allowed = new Set(field.config.options.map((option) => option.id));

  if (field.type === "single_select") {
    if (!allowed.has(value as string)) {
      throw new UserInputError("Select value is not a valid option.");
    }
    return;
  }

  const unique = [...new Set(value as string[])];
  for (const optionId of unique) {
    if (!allowed.has(optionId)) {
      throw new UserInputError("Select value is not a valid option.");
    }
  }
}

export function validateFieldValue(
  field: FieldDefinition,
  value: FieldValueInput,
): void {
  switch (field.type) {
    case "text":
    case "rich_text":
      if (typeof value !== "string") {
        throw new UserInputError("Invalid text value.");
      }
      return;
    case "number":
      if (typeof value !== "number") {
        throw new UserInputError("Invalid number value.");
      }
      validateNumericValue(value, field.config.precision ?? 0, {
        positiveOnly: field.config.positiveOnly,
      });
      return;
    case "percent":
      if (typeof value !== "number") {
        throw new UserInputError("Invalid number value.");
      }
      validateNumericValue(value, field.config.precision ?? 0);
      return;
    case "currency":
      if (typeof value !== "number") {
        throw new UserInputError("Invalid number value.");
      }
      validateNumericValue(value, field.config.precision ?? 2);
      return;
    case "date":
      if (typeof value !== "string") {
        throw new UserInputError("Invalid date value.");
      }
      validateIsoDate(value);
      return;
    case "single_select":
      if (typeof value !== "string") {
        throw new UserInputError("Invalid select value.");
      }
      validateSelectValue(field, value);
      return;
    case "multi_select":
      if (!Array.isArray(value)) {
        throw new UserInputError("Invalid select value.");
      }
      validateSelectValue(field, value);
  }
}
