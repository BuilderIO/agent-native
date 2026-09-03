import type { FieldConfig, FieldType } from "@/hooks/use-custom-fields";

import { CurrencyConfigControl } from "./CurrencyConfigControl";
import { NumberConfigControl } from "./NumberConfigControl";
import { PercentConfigControl } from "./PercentConfigControl";
import { SelectConfigControl } from "./SelectConfigControl";

export function FieldConfigControl({
  type,
  config,
  onChange,
  disabled = false,
}: {
  type: FieldType;
  config: FieldConfig;
  onChange: (config: FieldConfig) => void;
  disabled?: boolean;
}) {
  switch (type) {
    case "number":
      return (
        <NumberConfigControl
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "percent":
      return (
        <PercentConfigControl
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "currency":
      return (
        <CurrencyConfigControl
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case "single_select":
    case "multi_select":
      return (
        <SelectConfigControl
          config={config}
          onChange={onChange}
          disabled={disabled}
        />
      );
    default:
      return null;
  }
}
