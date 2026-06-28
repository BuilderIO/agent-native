import {
  alphaToOpacity,
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  rgbaToHsl,
  hslToRgba,
  opacityToAlpha,
  withColorOpacity,
  type HslaColor,
  type RgbaColor,
} from "@shared/color-utils";
import { IconColorSwatch, IconPlus, IconTrash } from "@tabler/icons-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export interface FigmaGradientStop {
  id: string;
  color: string;
  position: number;
  opacity?: number;
  label?: string;
}

export interface FigmaGradientStopPatch {
  color?: string;
  position?: number;
  opacity?: number;
}

export interface FigmaColorPickerLabels {
  trigger: string;
  hex: string;
  red: string;
  green: string;
  blue: string;
  hue: string;
  saturation: string;
  lightness: string;
  opacity: string;
  gradientStops: string;
  addStop: string;
  removeStop: string;
  stopPosition: string;
}

export interface FigmaColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  gradientStops?: FigmaGradientStop[];
  selectedStopId?: string;
  onGradientStopSelect?: (id: string) => void;
  onGradientStopChange?: (id: string, patch: FigmaGradientStopPatch) => void;
  onAddGradientStop?: () => void;
  onRemoveGradientStop?: (id: string) => void;
  labels?: Partial<FigmaColorPickerLabels>;
  disabled?: boolean;
  className?: string;
}

const FALLBACK_COLOR: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };

const DEFAULT_LABELS: FigmaColorPickerLabels = {
  trigger: "Open color picker", // i18n-ignore fallback component label
  hex: "Hex", // i18n-ignore fallback component label
  red: "R", // i18n-ignore fallback component label
  green: "G", // i18n-ignore fallback component label
  blue: "B", // i18n-ignore fallback component label
  hue: "H", // i18n-ignore fallback component label
  saturation: "S", // i18n-ignore fallback component label
  lightness: "L", // i18n-ignore fallback component label
  opacity: "Opacity", // i18n-ignore fallback component label
  gradientStops: "Gradient stops", // i18n-ignore fallback component label
  addStop: "Add stop", // i18n-ignore fallback component label
  removeStop: "Remove stop", // i18n-ignore fallback component label
  stopPosition: "Position", // i18n-ignore fallback component label
};

export function FigmaColorPicker({
  value,
  onChange,
  label,
  opacity,
  onOpacityChange,
  gradientStops = [],
  selectedStopId,
  onGradientStopSelect,
  onGradientStopChange,
  onAddGradientStop,
  onRemoveGradientStop,
  labels,
  disabled = false,
  className,
}: FigmaColorPickerProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const color = parseCssColor(value) ?? FALLBACK_COLOR;
  const hsl = rgbaToHsl(color);
  const effectiveOpacity = opacity ?? alphaToOpacity(color.a);
  const [hexDraft, setHexDraft] = useState(() => rgbaToHex(color));
  const skipNextHexBlurCommitRef = useRef(false);

  useEffect(() => {
    setHexDraft(rgbaToHex(color));
  }, [color.b, color.g, color.r]);

  const emitColor = (nextColor: RgbaColor, nextOpacity = effectiveOpacity) => {
    onChange(rgbaToCss(withColorOpacity(nextColor, nextOpacity)));
  };

  const commitHex = () => {
    const parsed = parseCssColor(hexDraft);
    if (!parsed) {
      setHexDraft(rgbaToHex(color));
      return;
    }
    const hexIncludesAlpha = hasHexAlpha(hexDraft);
    const nextOpacity = hexIncludesAlpha
      ? alphaToOpacity(parsed.a)
      : effectiveOpacity;
    if (hexIncludesAlpha && onOpacityChange) onOpacityChange(nextOpacity);
    emitColor(parsed, nextOpacity);
  };

  const setOpacity = (nextOpacity: number) => {
    if (onOpacityChange) onOpacityChange(nextOpacity);
    else onChange(rgbaToCss(withColorOpacity(color, nextOpacity)));
  };

  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <Label className="text-xs text-muted-foreground">{label}</Label>
      )}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            aria-label={copy.trigger}
            className="h-8 w-full justify-start px-2 text-xs"
          >
            <span
              className="size-5 rounded border border-border"
              style={{ backgroundColor: rgbaToCss(color) }}
            />
            <span className="min-w-0 flex-1 truncate text-left tabular-nums">
              {rgbaToHex(color)}
            </span>
            <span className="text-muted-foreground tabular-nums">
              {effectiveOpacity}%
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="color"
                aria-label={copy.trigger}
                value={rgbaToHex(color)}
                disabled={disabled}
                onChange={(event) => {
                  const parsed = parseCssColor(event.target.value);
                  if (parsed) emitColor(parsed);
                }}
                className="size-9 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-0"
              />
              <Field label={copy.hex} className="flex-1">
                <Input
                  value={hexDraft}
                  disabled={disabled}
                  onChange={(event) => setHexDraft(event.target.value)}
                  onBlur={() => {
                    if (skipNextHexBlurCommitRef.current) {
                      skipNextHexBlurCommitRef.current = false;
                      return;
                    }
                    commitHex();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitHex();
                      skipNextHexBlurCommitRef.current = true;
                      event.currentTarget.blur();
                    }
                  }}
                  className="h-8 text-xs tabular-nums"
                />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <NumberField
                label={copy.red}
                value={color.r}
                min={0}
                max={255}
                disabled={disabled}
                onChange={(next) => emitColor({ ...color, r: next })}
              />
              <NumberField
                label={copy.green}
                value={color.g}
                min={0}
                max={255}
                disabled={disabled}
                onChange={(next) => emitColor({ ...color, g: next })}
              />
              <NumberField
                label={copy.blue}
                value={color.b}
                min={0}
                max={255}
                disabled={disabled}
                onChange={(next) => emitColor({ ...color, b: next })}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <NumberField
                label={copy.hue}
                value={hsl.h}
                min={0}
                max={360}
                disabled={disabled}
                onChange={(next) => emitColorFromHsl({ ...hsl, h: next })}
              />
              <NumberField
                label={copy.saturation}
                value={hsl.s}
                min={0}
                max={100}
                disabled={disabled}
                onChange={(next) => emitColorFromHsl({ ...hsl, s: next })}
              />
              <NumberField
                label={copy.lightness}
                value={hsl.l}
                min={0}
                max={100}
                disabled={disabled}
                onChange={(next) => emitColorFromHsl({ ...hsl, l: next })}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">
                  {copy.opacity}
                </Label>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {effectiveOpacity}%
                </span>
              </div>
              <Slider
                value={[effectiveOpacity]}
                min={0}
                max={100}
                step={1}
                disabled={disabled}
                onValueChange={([next]) => setOpacity(next)}
              />
            </div>

            {(gradientStops.length > 0 || onAddGradientStop) && (
              <div className="space-y-2 border-t border-border pt-3">
                <div className="flex items-center justify-between gap-2">
                  <Label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <IconColorSwatch className="size-3.5" />
                    {copy.gradientStops}
                  </Label>
                  {onAddGradientStop && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={copy.addStop}
                      title={copy.addStop}
                      onClick={onAddGradientStop}
                      className="size-7"
                    >
                      <IconPlus className="size-4" />
                    </Button>
                  )}
                </div>
                <div className="space-y-1.5">
                  {gradientStops.map((stop) => (
                    <GradientStopRow
                      key={stop.id}
                      stop={stop}
                      selected={stop.id === selectedStopId}
                      labels={copy}
                      disabled={disabled}
                      onSelect={onGradientStopSelect}
                      onChange={onGradientStopChange}
                      onRemove={onRemoveGradientStop}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );

  function emitColorFromHsl(nextHsl: HslaColor) {
    emitColor(hslToRgba({ ...nextHsl, a: opacityToAlpha(effectiveOpacity) }));
  }
}

function NumberField({
  label,
  value,
  min,
  max,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <Field label={label}>
      <Input
        type="number"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(event) => {
          onChange(clamp(Number(event.target.value), min, max));
        }}
        className="h-8 text-xs tabular-nums"
      />
    </Field>
  );
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-[11px] text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function GradientStopRow({
  stop,
  selected,
  labels,
  disabled,
  onSelect,
  onChange,
  onRemove,
}: {
  stop: FigmaGradientStop;
  selected: boolean;
  labels: FigmaColorPickerLabels;
  disabled: boolean;
  onSelect?: (id: string) => void;
  onChange?: (id: string, patch: FigmaGradientStopPatch) => void;
  onRemove?: (id: string) => void;
}) {
  const stopColor = parseCssColor(stop.color) ?? FALLBACK_COLOR;
  const stopOpacity = stop.opacity ?? alphaToOpacity(stopColor.a);

  return (
    <div
      className={cn(
        "grid grid-cols-[auto_1fr_4.5rem_auto] items-center gap-2 rounded-md border border-transparent p-1",
        selected && "border-primary/40 bg-primary/5",
      )}
    >
      <button
        type="button"
        disabled={disabled || !onSelect}
        aria-label={stop.label ?? `${labels.gradientStops} ${stop.position}%`}
        onClick={() => onSelect?.(stop.id)}
        className="size-6 rounded border border-border"
        style={{ backgroundColor: rgbaToCss(stopColor) }}
      />
      <div className="min-w-0">
        <input
          type="color"
          aria-label={stop.label ?? labels.hex}
          value={rgbaToHex(stopColor)}
          disabled={disabled || !onChange}
          onChange={(event) => {
            const parsed = parseCssColor(event.target.value);
            if (parsed) onChange?.(stop.id, { color: rgbaToCss(parsed) });
          }}
          className="h-7 w-full cursor-pointer rounded border border-border bg-transparent p-0"
        />
      </div>
      <Input
        type="number"
        min={0}
        max={100}
        value={stop.position}
        disabled={disabled || !onChange}
        aria-label={labels.stopPosition}
        onChange={(event) =>
          onChange?.(stop.id, {
            position: clamp(Number(event.target.value), 0, 100),
          })
        }
        className="h-7 text-xs tabular-nums"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled || !onRemove}
        aria-label={labels.removeStop}
        title={labels.removeStop}
        onClick={() => onRemove?.(stop.id)}
        className="size-7"
      >
        <IconTrash className="size-3.5" />
      </Button>
      <div className="col-span-4">
        <Slider
          value={[stopOpacity]}
          min={0}
          max={100}
          step={1}
          disabled={disabled || !onChange}
          onValueChange={([next]) => onChange?.(stop.id, { opacity: next })}
        />
      </div>
    </div>
  );
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function hasHexAlpha(value: string): boolean {
  return /^#(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(value.trim());
}
