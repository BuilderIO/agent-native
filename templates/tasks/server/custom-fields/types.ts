export type FieldDefinitionBase = {
  id: string;
  title: string;
  sortOrder: number;
  ownerEmail: string;
  createdAt: string;
  updatedAt: string;
};

/* Configs: */

export type NumericFieldConfig = {
  precision?: number;
  positiveOnly?: boolean;
};
export type CurrencyFieldConfig = { symbol: string; precision?: number };

export const SELECT_COLOR_TOKENS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "gray",
] as const;
export type SelectColorToken = (typeof SELECT_COLOR_TOKENS)[number];

export type SelectOption = {
  id: string;
  name: string;
  color?: SelectColorToken;
  sortOrder: number;
};
export type SelectFieldConfig = { options: SelectOption[] };

export type EmptyFieldConfig = Record<string, never>;

export const FIELD_TYPES = [
  "text",
  "rich_text",
  "number",
  "percent",
  "currency",
  "single_select",
  "multi_select",
  "date",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export type EmptyConfigInput = EmptyFieldConfig;
export type SelectOptionInput = {
  id?: string;
  name: string;
  color?: SelectColorToken;
  sortOrder?: number;
};
export type SelectConfigInput = { options: SelectOptionInput[] };
export type NumericConfigInput = NumericFieldConfig;
export type PercentConfigInput = { precision?: number };
export type CurrencyConfigInput = {
  symbol?: string;
  precision?: number;
};

export type FieldConfigInputMap = {
  text: EmptyFieldConfig;
  rich_text: EmptyFieldConfig;
  date: EmptyFieldConfig;
  number: NumericConfigInput;
  percent: PercentConfigInput;
  currency: CurrencyConfigInput;
  single_select: SelectConfigInput;
  multi_select: SelectConfigInput;
};

export type FieldConfigInput<T extends FieldType = FieldType> =
  FieldConfigInputMap[T];

/* Field Definition: */

export type FieldDefinition = FieldDefinitionBase &
  (
    | { type: "text"; config: EmptyFieldConfig }
    | { type: "rich_text"; config: EmptyFieldConfig }
    | { type: "date"; config: EmptyFieldConfig }
    | { type: "number"; config: NumericFieldConfig }
    | { type: "percent"; config: NumericFieldConfig }
    | { type: "currency"; config: CurrencyFieldConfig }
    | { type: "single_select"; config: SelectFieldConfig }
    | { type: "multi_select"; config: SelectFieldConfig }
  );

export type FieldConfig = FieldDefinition["config"];

export type FieldValue = string | number | string[];
export type FieldValueInput = FieldValue | null;
