import { useT } from "@agent-native/core/client/i18n";
import type {
  EffectColor,
  EffectDefinition,
  EffectValue,
  EffectTextureRef,
  NativePositionValue,
} from "@shared/native-effects";
import {
  IconArrowDown,
  IconArrowUp,
  IconMinus,
  IconPlus,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";

import {
  nativeCatalogOptionKey,
  nativeCatalogPropertyKey,
} from "./native-catalog-display";
import { nativeOrderedNumericBounds } from "./native-ordered-numeric-bounds";
import { NativeEffectColorControl } from "./NativeEffectColorControl";
import { NativeEffectPositionControl } from "./NativeEffectPositionControl";
import { NativeEffectTextureControl } from "./NativeEffectTextureControl";
import { NativeNumericScrub } from "./NativeNumericScrub";
export { NativeNumericScrub, nativeNumericDraft } from "./NativeNumericScrub";
import { type ScrubInputChangeMeta } from "./ScrubInput";

type Phase = ScrubInputChangeMeta["phase"];

export function nativeEffectValuesEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((value, index) => nativeEffectValuesEqual(value, b[index]))
    );
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every(
      (key) =>
        Object.prototype.hasOwnProperty.call(right, key) &&
        nativeEffectValuesEqual(left[key], right[key]),
    )
  );
}

export function nativeVisibleProperties(
  definition: EffectDefinition,
  values: Record<string, EffectValue>,
  advancedOpen: boolean,
) {
  return Object.entries(definition.properties).filter(
    ([, property]) =>
      (!property.visibleWhen ||
        (values[property.visibleWhen.property] ??
          definition.properties[property.visibleWhen.property]?.default) ===
          property.visibleWhen.equals) &&
      (advancedOpen || !property.advanced),
  );
}

export function nativeNumericPrecision(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  return Math.min(
    6,
    (step.toFixed(6).split(".")[1] ?? "").replace(/0+$/, "").length,
  );
}

export function nativeDisplayedNumber(value: number, scale = 1): number {
  return Number((value * scale).toPrecision(12));
}

export function nativeStoredNumber(value: number, scale = 1): number {
  return Number((value / scale).toPrecision(12));
}

export function NativeEffectControls({
  definition,
  values,
  mixedNames,
  disabled,
  onValueChange,
  designId,
  fileId,
}: {
  definition: EffectDefinition;
  values: Record<string, EffectValue>;
  mixedNames?: ReadonlySet<string>;
  disabled: boolean;
  onValueChange: (name: string, value: EffectValue, phase: Phase) => void;
  designId?: string;
  fileId?: string;
}) {
  const t = useT();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const propertyLabel = (fallback: string): string => {
    const key = nativeCatalogPropertyKey(definition, fallback);
    return key ? t(key) : fallback;
  };
  const optionLabel = (option: string): string => {
    const key = nativeCatalogOptionKey(definition, option);
    return key ? t(key) : option;
  };
  const available = nativeVisibleProperties(definition, values, true);
  const visible = nativeVisibleProperties(definition, values, advancedOpen);
  return (
    <div className="grid gap-2">
      {visible.map(([name, property], index) => {
        const current = values[name] ?? property.default;
        const label = propertyLabel(property.label);
        const control = (() => {
          if (property.type === "float" || property.type === "int") {
            const bounds = nativeOrderedNumericBounds(definition, name, values);
            const scale = property.displayScale ?? 1;
            const step =
              (property.step ?? (property.type === "int" ? 1 : 0.01)) * scale;
            const displayed = nativeDisplayedNumber(current as number, scale);
            return (
              <div key={name} className="grid gap-1">
                <NativeNumericScrub
                  label={label}
                  value={displayed}
                  min={
                    bounds.min === undefined
                      ? undefined
                      : nativeDisplayedNumber(bounds.min, scale)
                  }
                  max={
                    bounds.max === undefined
                      ? undefined
                      : nativeDisplayedNumber(bounds.max, scale)
                  }
                  step={step}
                  precision={nativeNumericPrecision(step)}
                  unit={property.unit}
                  disabled={disabled}
                  onChange={(value, meta) =>
                    onValueChange(
                      name,
                      nativeStoredNumber(value, scale),
                      meta.phase,
                    )
                  }
                  labelClassName="w-20"
                  inputClassName="h-6"
                />
                {bounds.min !== undefined && bounds.max !== undefined && (
                  <Slider
                    value={[displayed]}
                    min={nativeDisplayedNumber(bounds.min, scale)}
                    max={nativeDisplayedNumber(bounds.max, scale)}
                    step={step}
                    aria-label={label}
                    disabled={disabled}
                    onValueChange={([value]) =>
                      onValueChange(
                        name,
                        nativeStoredNumber(value ?? displayed, scale),
                        "preview",
                      )
                    }
                    onValueCommit={([value]) =>
                      onValueChange(
                        name,
                        nativeStoredNumber(value ?? displayed, scale),
                        "commit",
                      )
                    }
                  />
                )}
              </div>
            );
          }
          if (property.type === "bool") {
            return (
              <label
                key={name}
                className="flex h-7 items-center justify-between gap-2 text-xs"
              >
                <span className="truncate">{label}</span>
                <Switch
                  checked={current as boolean}
                  disabled={disabled}
                  onCheckedChange={(checked) =>
                    onValueChange(name, checked, "commit")
                  }
                />
              </label>
            );
          }
          if (property.type === "enum") {
            return (
              <label
                key={name}
                className="flex items-center justify-between gap-2 text-xs"
              >
                <span className="truncate">{label}</span>
                <Select
                  value={current as string}
                  disabled={disabled}
                  onValueChange={(value) =>
                    onValueChange(name, value, "commit")
                  }
                >
                  <SelectTrigger className="h-6 w-28 !text-[11px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {property.options.map((option) => (
                      <SelectItem key={option} value={option}>
                        {optionLabel(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            );
          }
          if (property.type === "color") {
            const color = current as EffectColor;
            return (
              <NativeEffectColorControl
                key={name}
                label={label}
                value={color}
                disabled={disabled}
                onChange={(next, phase) => onValueChange(name, next, phase)}
              />
            );
          }
          if (property.type === "vec2") {
            const pair = current as [number, number];
            const scale = property.displayScale ?? 1;
            return (
              <div key={name} className="grid gap-1">
                {([0, 1] as const).map((axis) => (
                  <NativeNumericScrub
                    key={axis}
                    label={`${label} ${axis === 0 ? "X" : "Y"}`}
                    value={nativeDisplayedNumber(pair[axis], scale)}
                    min={
                      property.min === undefined
                        ? undefined
                        : nativeDisplayedNumber(property.min, scale)
                    }
                    max={
                      property.max === undefined
                        ? undefined
                        : nativeDisplayedNumber(property.max, scale)
                    }
                    step={(property.step ?? 0.01) * scale}
                    unit={property.unit}
                    disabled={disabled}
                    onChange={(value, meta) => {
                      const next: [number, number] = [...pair];
                      next[axis] = nativeStoredNumber(value, scale);
                      onValueChange(name, next, meta.phase);
                    }}
                    labelClassName="w-20"
                    inputClassName="h-6"
                  />
                ))}
              </div>
            );
          }
          if (property.type === "position") {
            return (
              <NativeEffectPositionControl
                key={name}
                label={label}
                value={current as NativePositionValue}
                disabled={disabled}
                onChange={(next, phase) => onValueChange(name, next, phase)}
              />
            );
          }
          if (property.type === "texture") {
            return (
              <NativeEffectTextureControl
                designId={designId}
                fileId={fileId}
                label={label}
                value={current as EffectTextureRef | null}
                disabled={disabled}
                onChange={(next) => onValueChange(name, next, "commit")}
              />
            );
          }
          if (property.type !== "color-array") return null;
          const colors = current as EffectColor[];
          const maxCount = property.maxCount;
          const defaultColors = property.default;
          return (
            <div key={name} className="grid gap-1">
              <span className="text-xs">{label}</span>
              {colors.map((color, index) => (
                <div key={index} className="flex items-center gap-1">
                  <NativeEffectColorControl
                    label={`${label} ${index + 1}`}
                    value={color}
                    disabled={disabled}
                    onChange={(nextColor, phase) => {
                      const next = [...colors];
                      next[index] = nextColor;
                      onValueChange(name, next, phase);
                    }}
                  />
                  {([-1, 1] as const).map((direction) => (
                    <button
                      key={direction}
                      type="button"
                      aria-label={t(
                        direction === -1
                          ? "editPanel.shaders.nativeMoveColorUp"
                          : "editPanel.shaders.nativeMoveColorDown",
                        { label, index: index + 1 },
                      )}
                      disabled={
                        disabled ||
                        index + direction < 0 ||
                        index + direction >= colors.length
                      }
                      onClick={() => {
                        const next = [...colors];
                        const destination = index + direction;
                        [next[index], next[destination]] = [
                          next[destination]!,
                          next[index]!,
                        ];
                        onValueChange(name, next, "commit");
                      }}
                      className="flex size-5 shrink-0 items-center justify-center text-muted-foreground disabled:opacity-30"
                    >
                      {direction === -1 ? (
                        <IconArrowUp className="size-3" />
                      ) : (
                        <IconArrowDown className="size-3" />
                      )}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label={t("editPanel.shaders.nativeRemoveColor", {
                      label,
                      index: index + 1,
                    })}
                    disabled={disabled}
                    onClick={() =>
                      onValueChange(
                        name,
                        colors.filter((_, at) => at !== index),
                        "commit",
                      )
                    }
                  >
                    <IconMinus className="size-3.5" />
                  </button>
                </div>
              ))}
              {colors.length < maxCount && (
                <button
                  type="button"
                  aria-label={t("editPanel.shaders.nativeAddColor", { label })}
                  disabled={disabled}
                  onClick={() =>
                    onValueChange(
                      name,
                      [
                        ...colors,
                        colors[colors.length - 1] ??
                          defaultColors[0] ?? {
                            space: "srgb",
                            components: [1, 1, 1],
                            alpha: 1,
                          },
                      ],
                      "commit",
                    )
                  }
                  className="flex h-6 items-center gap-1 text-xs text-muted-foreground"
                >
                  <IconPlus className="size-3.5" />
                  {label}
                </button>
              )}
            </div>
          );
        })();
        return (
          <div key={name} className="min-w-0">
            {property.group &&
              property.group !== visible[index - 1]?.[1].group && (
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {property.group}
                </p>
              )}
            <div className="flex min-w-0 items-start gap-1">
              <div className="min-w-0 flex-1">{control}</div>
              <button
                type="button"
                aria-label={t("editPanel.shaders.nativeResetProperty", {
                  label,
                })}
                title={t("editPanel.shaders.nativeResetProperty", { label })}
                disabled={
                  disabled || nativeEffectValuesEqual(current, property.default)
                }
                onClick={() => onValueChange(name, property.default, "commit")}
                className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground disabled:opacity-30"
              >
                <IconRefresh className="size-3" />
              </button>
            </div>
            {mixedNames?.has(name) && (
              <span className="text-xs text-muted-foreground" role="status">
                {t("editPanel.shaders.nativeMixedValues")}
              </span>
            )}
          </div>
        );
      })}
      {available.some(([, property]) => property.advanced) && (
        <button
          type="button"
          className="text-left text-xs text-muted-foreground"
          onClick={() => setAdvancedOpen((open) => !open)}
        >
          {t(
            advancedOpen
              ? "editPanel.shaders.nativeHideAdvanced"
              : "editPanel.shaders.nativeShowAdvanced",
          )}
        </button>
      )}
    </div>
  );
}
