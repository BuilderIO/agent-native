import { useT } from "@agent-native/core/client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  type FieldConfigControlProps,
  positiveOnlyFromConfig,
  precisionFromConfig,
} from "./utils";

export function NumberConfigControl({
  config,
  onChange,
  disabled = false,
}: FieldConfigControlProps) {
  const t = useT();
  return (
    <div className="grid gap-3">
      <div className="grid gap-2">
        <Label>{t("fieldEditor.precisionLabel")}</Label>
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
      <div className="grid gap-2">
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={positiveOnlyFromConfig(config)}
            disabled={disabled}
            onCheckedChange={(checked) =>
              onChange({
                ...config,
                positiveOnly: checked === true,
              })
            }
          />
          {t("fieldEditor.positiveOnlyLabel")}
        </label>
      </div>
    </div>
  );
}
