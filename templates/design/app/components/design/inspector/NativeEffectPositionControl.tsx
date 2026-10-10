import { useT } from "@agent-native/core/client/i18n";
import {
  MAX_NATIVE_POSITION_MAGNITUDE,
  type NativePositionValue,
  type NativePositionUnit,
} from "@shared/native-effect-position";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  NATIVE_POSITION_ANCHORS,
  changeNativePositionUnit,
  nativePositionAnchor,
  nativePositionAxisDisplay,
  updateNativePositionAxis,
} from "./native-position-controls";
import { NativeNumericScrub } from "./NativeNumericScrub";
import type { ScrubInputChangeMeta } from "./ScrubInput";

const UNITS: readonly NativePositionUnit[] = ["uv", "percent", "px"];
export function NativeEffectPositionControl({
  label,
  value,
  disabled,
  onChange,
}: {
  label: string;
  value: NativePositionValue;
  disabled: boolean;
  onChange: (
    value: NativePositionValue,
    phase: ScrubInputChangeMeta["phase"],
  ) => void;
}) {
  const t = useT();
  const unitLabel = (unit: NativePositionUnit) =>
    t(
      unit === "uv"
        ? "editPanel.shaders.nativePositionFraction"
        : unit === "percent"
          ? "editPanel.shaders.nativePositionPercent"
          : "editPanel.shaders.nativePositionPixels",
    );
  return (
    <div className="grid gap-1">
      <label className="flex h-7 items-center justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <Select
          value={nativePositionAnchor(value)}
          disabled={disabled}
          onValueChange={(next) => onChange(next, "commit")}
        >
          <SelectTrigger
            className="h-6 w-28 !text-[11px]"
            aria-label={t("editPanel.shaders.nativePositionAnchorFor", {
              label,
            })}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="custom" disabled>
              {t("editPanel.shaders.nativePositionCustom")}
            </SelectItem>
            {NATIVE_POSITION_ANCHORS.map((anchor) => (
              <SelectItem key={anchor.value} value={anchor.value}>
                {t(`editPanel.shaders.${anchor.key}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      {(["x", "y"] as const).map((axis) => {
        const displayed = nativePositionAxisDisplay(value, axis);
        const axisLabel = t("editPanel.shaders.nativePositionAxisFor", {
          label,
          axis: axis.toUpperCase(),
        });
        return (
          <div key={axis} className="flex items-center gap-1">
            <NativeNumericScrub
              label={axisLabel}
              value={displayed.value}
              min={-MAX_NATIVE_POSITION_MAGNITUDE}
              max={MAX_NATIVE_POSITION_MAGNITUDE}
              step={displayed.unit === "uv" ? 0.01 : 0.1}
              precision={displayed.unit === "uv" ? 3 : 2}
              unit={
                displayed.unit === "percent"
                  ? "%"
                  : displayed.unit === "px"
                    ? "px"
                    : undefined
              }
              disabled={disabled}
              onChange={(number, meta) =>
                onChange(
                  updateNativePositionAxis(value, axis, {
                    value: number,
                    unit: displayed.unit,
                  }),
                  meta.phase,
                )
              }
              labelClassName="w-20"
              inputClassName="h-6"
            />
            <Select
              value={displayed.unit}
              disabled={disabled}
              onValueChange={(next) => {
                if (!UNITS.includes(next as NativePositionUnit))
                  throw new TypeError("Position unit is invalid.");
                onChange(
                  changeNativePositionUnit(
                    value,
                    axis,
                    next as NativePositionUnit,
                  ),
                  "commit",
                );
              }}
            >
              <SelectTrigger
                className="h-6 w-20 shrink-0 !text-[11px]"
                aria-label={t("editPanel.shaders.nativePositionUnitFor", {
                  label: axisLabel,
                })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UNITS.map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {unitLabel(unit)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );
      })}
    </div>
  );
}
