import type {
  FieldConfig,
  FieldType,
  SelectOption,
} from "@/hooks/use-custom-fields";

export type FieldConfigControlProps = {
  config: FieldConfig;
  onChange: (config: FieldConfig) => void;
  disabled?: boolean;
};

export function precisionFromConfig(config: FieldConfig) {
  return "precision" in config && typeof config.precision === "number"
    ? config.precision
    : 0;
}

export function positiveOnlyFromConfig(config: FieldConfig) {
  return "positiveOnly" in config && config.positiveOnly === true;
}

export function symbolFromConfig(config: FieldConfig) {
  return "symbol" in config && typeof config.symbol === "string"
    ? config.symbol
    : "$";
}

export function withSortedOptions(options: SelectOption[]) {
  return options.map((option, index) => ({
    ...option,
    sortOrder: index * 1000,
  }));
}

export function optionsFromConfig(config: FieldConfig): SelectOption[] {
  return "options" in config ? config.options : [];
}

export function defaultConfigForType(type: FieldType): FieldConfig {
  if (type === "currency") return { symbol: "$", precision: 2 };
  if (type === "number" || type === "percent") return { precision: 0 };
  if (type === "single_select" || type === "multi_select") {
    return { options: [] };
  }
  return {};
}

export function normalizedInitialConfig(type: FieldType, config?: FieldConfig) {
  if (config) return config;
  return defaultConfigForType(type);
}
