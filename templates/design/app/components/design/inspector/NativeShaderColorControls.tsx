import { useT } from "@agent-native/core/client/i18n";
import {
  formatDisplayP3Css,
  gamutOf,
  linearSrgbToDisplayP3,
  linearToSrgbTriple,
  mapToGamut,
  parseWideColor,
} from "@shared/color-spaces";
import { parseCssColorExtended, rgbaToCss } from "@shared/color-utils";
import type {
  EffectColor,
  EffectColorStop,
  EffectProperty,
} from "@shared/native-effects";
import { useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { ColorValueField, OpacityValueField } from "./color-picker-fields";
import type { RenderNestedColorPicker } from "./color-picker-nested";
import { swatchStyle } from "./color-picker-swatch";
import { GradientEditor, type GradientValue } from "./GradientEditor";

type ColorProperty = Extract<
  EffectProperty,
  { type: "color" | "color-array" | "color-ramp" }
>;
type ColorValue = EffectColor | EffectColor[] | EffectColorStop[];

export interface NativeShaderColorControlsProps {
  label: string;
  property: ColorProperty;
  value: ColorValue;
  disabled: boolean;
  onChange: (value: ColorValue) => void;
  onCommit?: (value: ColorValue) => void;
  renderColorPicker?: RenderNestedColorPicker;
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function nativeEffectColorToCss(color: EffectColor): string {
  const channels = color.components.map(clampUnit) as [number, number, number];
  return color.space === "display-p3"
    ? formatDisplayP3Css(channels, color.alpha)
    : rgbaToCss({
        r: Math.round(channels[0] * 255),
        g: Math.round(channels[1] * 255),
        b: Math.round(channels[2] * 255),
        a: color.alpha,
      });
}

export function nativeEffectColorFromCss(
  css: string,
  previous: EffectColor,
): EffectColor | null {
  const wide = parseWideColor(css);
  if (wide?.kind === "ok") {
    if (wide.color.notation === "display-p3") {
      return {
        space: "display-p3",
        components: wide.color.p3,
        alpha: clampUnit(wide.color.alpha),
      };
    }
    if (wide.color.notation === "srgb") {
      return {
        space: "srgb",
        components: wide.color.srgb,
        alpha: clampUnit(wide.color.alpha),
      };
    }
    const gamut = gamutOf(wide.color.linear);
    if (gamut === "srgb") {
      return {
        space: "srgb",
        components: linearToSrgbTriple(wide.color.linear).map(clampUnit) as [
          number,
          number,
          number,
        ],
        alpha: clampUnit(wide.color.alpha),
      };
    }
    return {
      space: "display-p3",
      components: linearSrgbToDisplayP3(
        mapToGamut(wide.color.linear, "p3"),
      ).map(clampUnit) as [number, number, number],
      alpha: clampUnit(wide.color.alpha),
    };
  }
  const rgba = parseCssColorExtended(css);
  if (!rgba) return null;
  return {
    ...previous,
    space: "srgb",
    components: [rgba.r / 255, rgba.g / 255, rgba.b / 255],
    alpha: clampUnit(rgba.a),
  };
}

const FIELD =
  "flex h-7 min-w-0 items-center rounded-md bg-[var(--design-editor-control-bg)]";

export function NativeShaderColorControls({
  label,
  property,
  value,
  disabled,
  onChange,
  onCommit,
  renderColorPicker,
}: NativeShaderColorControlsProps) {
  const t = useT();
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const [selectedStopIdState, setSelectedStopId] = useState<string | null>(
    null,
  );
  const editorStopIdsRef = useRef<string[]>([]);
  const stopIdCounterRef = useRef(0);
  const latestColorsRef = useRef<EffectColor[]>([]);
  const latestRampRef = useRef<EffectColorStop[]>([]);

  if (property.type === "color") {
    const color = Array.isArray(value) ? value[0] : value;
    if (!color || Array.isArray(color) || "position" in color) return null;
    const css = nativeEffectColorToCss(color);
    const apply = (nextCss: string, commit = false) => {
      const next = nativeEffectColorFromCss(nextCss, color);
      if (!next) return;
      onChange(next);
      if (commit) onCommit?.(next);
    };
    return (
      <>
        <div className={cn(FIELD, "gap-2 px-1.5")}>
          <button
            type="button"
            aria-label={t("editPanel.colorPicker.editStopColor")}
            disabled={disabled || !renderColorPicker}
            onClick={(event) => setPickerAnchor(event.currentTarget)}
            className="size-4 shrink-0 rounded-[3px] border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
            style={swatchStyle(css)}
          />
          <ColorValueField
            css={css}
            ariaLabel={t("editPanel.colorPicker.stopColor")}
            disabled={disabled}
            className="flex-1"
            onCommit={(next) => apply(next, true)}
          />
          <OpacityValueField
            css={css}
            ariaLabel={t("editPanel.colorPicker.stopOpacity")}
            disabled={disabled}
            className="w-8 shrink-0 text-right"
            onCommit={(next) => apply(next, true)}
          />
          <span className="-ml-1 shrink-0 pr-1.5 !text-[11px] text-muted-foreground">
            {"%" /* i18n-ignore */}
          </span>
        </div>
        {pickerAnchor
          ? renderColorPicker?.({
              anchor: pickerAnchor,
              css,
              onChange: (next) => apply(next),
              onCommit: (next) => apply(next, true),
              onClose: () => setPickerAnchor(null),
            })
          : null}
      </>
    );
  }

  if (property.type === "color-ramp") {
    const stopsValue = Array.isArray(value) ? (value as EffectColorStop[]) : [];
    const orderedValue = [...stopsValue].sort(
      (a, b) => a.position - b.position,
    );
    latestRampRef.current = orderedValue;
    const stopIds = editorStopIdsRef.current.slice(0, orderedValue.length);
    while (stopIds.length < orderedValue.length) {
      stopIdCounterRef.current += 1;
      stopIds.push("native-ramp-" + stopIdCounterRef.current);
    }
    editorStopIdsRef.current = stopIds;
    const stops = orderedValue.map((stop, index) => ({
      id: stopIds[index]!,
      color: nativeEffectColorToCss(stop.color),
      position: stop.position * 100,
    }));
    const originalColorsById = new Map(
      stops.map((stop, index) => [stop.id, orderedValue[index]!.color]),
    );
    const selectedStopId =
      selectedStopIdState && stopIds.includes(selectedStopIdState)
        ? selectedStopIdState
        : (stopIds[0] ?? "ramp-empty");
    const gradientValue: GradientValue = { kind: "linear", angle: 0, stops };

    return (
      <GradientEditor
        value={gradientValue}
        selectedStopId={selectedStopId}
        onSelectStop={(id) => {
          if (editorStopIdsRef.current.includes(id)) setSelectedStopId(id);
        }}
        stopsOnly
        minStops={1}
        maxStops={property.maxCount}
        disabled={disabled}
        renderColorPicker={renderColorPicker}
        onChange={(next) => {
          const ordered = [...next.stops].sort(
            (a, b) => a.position - b.position,
          );
          const ids: string[] = [];
          const updated = ordered.map((stop, index) => {
            ids.push(stop.id);
            const previous = originalColorsById.get(stop.id);
            if (previous && stop.color === nativeEffectColorToCss(previous)) {
              return { position: stop.position / 100, color: previous };
            }
            const colorReference =
              previous ?? property.default[property.default.length - 1]?.color;
            if (!colorReference)
              throw new Error("ramp-color-reference-missing");
            const color = nativeEffectColorFromCss(stop.color, colorReference);
            if (!color) throw new Error("ramp-color-invalid");
            return { position: stop.position / 100, color };
          });
          editorStopIdsRef.current = ids;
          latestRampRef.current = updated;
          onChange(updated);
        }}
        onCommit={() => onCommit?.(latestRampRef.current)}
      />
    );
  }

  const colors = Array.isArray(value) ? (value as EffectColor[]) : [];
  latestColorsRef.current = colors;
  const stopIds = editorStopIdsRef.current.slice(0, colors.length);
  while (stopIds.length < colors.length) {
    stopIdCounterRef.current += 1;
    stopIds.push("native-palette-" + stopIdCounterRef.current);
  }
  editorStopIdsRef.current = stopIds;
  const stops = colors.map((color, index) => ({
    id: stopIds[index]!,
    color: nativeEffectColorToCss(color),
    position: (index / Math.max(1, colors.length - 1)) * 100,
  }));
  const selectedStopId =
    selectedStopIdState && stopIds.includes(selectedStopIdState)
      ? selectedStopIdState
      : (stopIds[0] ?? "palette-empty");
  const gradientValue: GradientValue = {
    kind: "linear",
    angle: 0,
    stops,
  };

  return (
    <GradientEditor
      value={gradientValue}
      selectedStopId={selectedStopId}
      onSelectStop={(id) => {
        if (editorStopIdsRef.current.includes(id)) setSelectedStopId(id);
      }}
      paletteMode
      minStops={1}
      maxStops={property.maxCount}
      disabled={disabled}
      renderColorPicker={renderColorPicker}
      onChange={(next) => {
        editorStopIdsRef.current = next.stops.map((stop) => stop.id);
        const ordered = [...next.stops].sort((a, b) => a.position - b.position);
        const fallback =
          colors[colors.length - 1] ??
          property.default[property.default.length - 1];
        const updated = ordered.map((stop, index) => {
          const previous = colors[index] ?? fallback;
          if (!previous) throw new Error("palette-color-reference-missing");
          const parsed = nativeEffectColorFromCss(stop.color, previous);
          if (!parsed) throw new Error("palette-color-invalid");
          return parsed;
        });
        latestColorsRef.current = updated;
        onChange(updated);
      }}
      onCommit={() => onCommit?.(latestColorsRef.current)}
    />
  );
}
