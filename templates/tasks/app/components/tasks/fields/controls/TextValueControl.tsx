import { Input } from "@/components/ui/input";
import type { FieldValue } from "@/hooks/use-custom-fields";

export function TextValueControl({
  value,
  disabled,
  onChange,
}: {
  value: FieldValue | null;
  disabled: boolean;
  onChange: (value: FieldValue | null) => void;
}) {
  return (
    <Input
      value={typeof value === "string" ? value : ""}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value || null)}
    />
  );
}
