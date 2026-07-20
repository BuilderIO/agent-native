import { useT } from "@agent-native/core/client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  type FieldConfigControlProps,
  precisionFromConfig,
  symbolFromConfig,
} from "./utils";

export function CurrencyConfigControl({
  config,
  onChange,
  disabled = false,
}: FieldConfigControlProps) {
  const t = useT();
  return (
    <div className="grid gap-3 sm:grid-cols-[96px_1fr]">
      <div className="grid gap-2">
        <Label>{t("fieldEditor.symbolLabel")}</Label>
        <Input
          maxLength={8}
          disabled={disabled}
          value={symbolFromConfig(config)}
          onChange={(event) =>
            onChange({
              symbol: event.currentTarget.value,
              precision: precisionFromConfig(config) || 2,
            })
          }
        />
      </div>
      <div className="grid gap-2">
        <Label>{t("fieldEditor.precisionLabel")}</Label>
        <Input
          type="number"
          min={0}
          max={6}
          disabled={disabled}
          value={precisionFromConfig(config) || 2}
          onChange={(event) =>
            onChange({
              symbol: symbolFromConfig(config),
              precision: Number(event.currentTarget.value || 0),
            })
          }
        />
      </div>
    </div>
  );
}
