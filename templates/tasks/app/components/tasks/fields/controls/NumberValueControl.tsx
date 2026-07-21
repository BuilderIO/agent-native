import { Input } from "@/components/ui/input";
import type { FieldValue, TaskFieldValue } from "@/hooks/use-custom-fields";

function numericPrecision(
  field: TaskFieldValue & { type: "number" | "percent" | "currency" },
) {
  switch (field.type) {
    case "number":
    case "percent":
      return field.config.precision ?? 0;
    case "currency":
      return field.config.precision ?? 2;
  }
}

export function NumberValueControl({
  field,
  value,
  disabled,
  onChange,
}: {
  field: TaskFieldValue & { type: "number" | "percent" | "currency" };
  value: FieldValue | null;
  disabled: boolean;
  onChange: (value: FieldValue | null) => void;
}) {
  const min =
    field.type === "number" && field.config.positiveOnly ? 0 : undefined;
  const precision = numericPrecision(field);
  const step = precision === 0 ? 1 : 1 / 10 ** precision;

  return (
    <Input
      type="number"
      min={min}
      step={step}
      value={typeof value === "number" ? String(value) : ""}
      disabled={disabled}
      onChange={(event) => {
        const next = event.currentTarget.value;
        if (next === "") {
          onChange(null);
          return;
        }
        let parsed = Number(next);
        if (precision === 0) {
          parsed = Math.trunc(parsed);
        }
        if (field.type === "number" && field.config.positiveOnly) {
          parsed = Math.max(0, parsed);
        }
        onChange(parsed);
      }}
    />
  );
}
