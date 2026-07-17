import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { type FieldConfigControlProps, precisionFromConfig } from "./utils";

export function PercentConfigControl({
  config,
  onChange,
  disabled = false,
}: FieldConfigControlProps) {
  return (
    <div className="grid gap-2">
      <Label>Precision</Label>
      <Input
        type="number"
        min={0}
        max={6}
        disabled={disabled}
        value={precisionFromConfig(config)}
        onChange={(event) => {
          const precision = Number(event.currentTarget.value || 0);
          onChange({
            ...config,
            precision,
          });
        }}
      />
    </div>
  );
}
