import { useT } from "@agent-native/core/client/i18n";
import * as SliderPrimitive from "@radix-ui/react-slider";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import type { ElementInfo } from "../types";
import { commitStylePatch } from "./field-primitives";
import {
  exposureFilterUrl,
  exposureFromFilter,
  withoutExposureFilter,
} from "./image-exposure-filter";
import { SectionIconButton } from "./inspector-controls";
import {
  InspectorGrid,
  InspectorGridCell,
  InspectorPaintRow,
} from "./inspector-grid";
import type {
  StyleChangeHandler,
  StylesChangeHandler,
} from "./style-change-types";

export type ImageScaleMode = "fill" | "fit" | "crop";

/** Marks Crop, which renders as a frozen Fill: CSS cannot stretch a crop. */
export const IMAGE_SCALE_MARKER = "--an-image-scale";

/**
 * Figma's scale modes on an `<img>`. Switching to Crop keeps the region Fill
 * showed (measured in Figma); it never stretches the image to the box.
 */
export function imageScaleModePatch(
  mode: ImageScaleMode,
): Record<string, string> {
  return {
    objectFit: mode === "fit" ? "contain" : "cover",
    [IMAGE_SCALE_MARKER]: mode === "crop" ? "crop" : "none",
  };
}

export function imageScaleModeFromStyles(
  styles: Record<string, string>,
): ImageScaleMode {
  if (styles.objectFit === "contain") return "fit";
  if (styles[IMAGE_SCALE_MARKER]?.trim() === "crop") return "crop";
  if (styles.objectFit === "cover") return "fill";
  return "fill";
}

export interface ImageAdjustments {
  /** Paint opacity, 0..100, as Figma's fill row shows it. */
  opacity: number;
  exposure: number;
  contrast: number;
  saturation: number;
}

/**
 * Figma slider value (-100..100) to CSS filter amount, fitted to pixels
 * sampled from Figma exports; Figma's contrast is much weaker than CSS's.
 */
const ADJUSTMENT_STOPS: Record<
  "contrast" | "saturation",
  { fn: string; stops: Array<[number, number]> }
> = {
  contrast: {
    fn: "contrast",
    stops: [
      [-100, 0.82],
      [-50, 0.92],
      [0, 1],
      [50, 1.06],
      [100, 1.1],
    ],
  },
  saturation: {
    fn: "saturate",
    stops: [
      [-100, 0],
      [-50, 0.35],
      [0, 1],
      [50, 1.15],
      [100, 2.5],
    ],
  },
};

function interpolate(
  stops: Array<[number, number]>,
  x: number,
  from: 0 | 1,
): number {
  const to = from === 0 ? 1 : 0;
  for (let index = 1; index < stops.length; index++) {
    const a = stops[index - 1]!;
    const b = stops[index]!;
    if (x <= b[from] || index === stops.length - 1) {
      const ratio = (x - a[from]) / (b[from] - a[from]);
      const clamped = Math.min(1, Math.max(0, ratio));
      return a[to] + (b[to] - a[to]) * clamped;
    }
  }
  return x;
}

const round = (value: number, places: number) =>
  Math.round(value * 10 ** places) / 10 ** places;

export function imageAdjustmentsFromFilter(
  filter: string | undefined,
): ImageAdjustments {
  const read = (key: keyof typeof ADJUSTMENT_STOPS) => {
    const { fn, stops } = ADJUSTMENT_STOPS[key];
    const match = filter?.match(new RegExp(`${fn}\\(\\s*([\\d.]+)(%?)\\s*\\)`));
    if (!match) return 0;
    const amount = Number(match[1]) / (match[2] ? 100 : 1);
    return Math.round(interpolate(stops, amount, 1));
  };
  const opacity = filter?.match(/\bopacity\(\s*([\d.]+)(%?)\s*\)/);
  return {
    opacity: opacity
      ? Math.round(Number(opacity[1]) * (opacity[2] ? 1 : 100))
      : 100,
    exposure: exposureFromFilter(filter),
    contrast: read("contrast"),
    saturation: read("saturation"),
  };
}

/** Rewrites only the adjustment functions, keeping blur and other filters. */
export function imageAdjustmentFilter(
  filter: string | undefined,
  adjustments: ImageAdjustments,
): string {
  const kept = withoutExposureFilter(filter && filter !== "none" ? filter : "")
    .replace(/\b(?:contrast|saturate|opacity)\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const curves = (
    Object.keys(ADJUSTMENT_STOPS) as Array<keyof typeof ADJUSTMENT_STOPS>
  )
    .filter((key) => adjustments[key] !== 0)
    .map((key) => {
      const { fn, stops } = ADJUSTMENT_STOPS[key];
      return `${fn}(${round(interpolate(stops, adjustments[key], 0), 3)})`;
    });
  const exposure = adjustments.exposure
    ? exposureFilterUrl(adjustments.exposure)
    : "";
  const opacity =
    adjustments.opacity < 100 ? `opacity(${adjustments.opacity / 100})` : "";
  return (
    [kept, exposure, ...curves, opacity].filter(Boolean).join(" ") || "none"
  );
}

function clampPercent(value: number, min: number, max: number): number {
  return Math.round(Math.min(max, Math.max(min, value)));
}

function NumberField({
  label,
  value,
  min,
  max,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const parsed = Number.parseFloat(draft.replace(/%$/, ""));
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    onCommit(clampPercent(parsed, min, max));
  };
  return (
    <input
      aria-label={label}
      inputMode="numeric"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(String(value));
          event.currentTarget.blur();
        }
      }}
      className={cn(
        "min-w-0 bg-transparent text-right tabular-nums !text-[11px] outline-none",
        className,
      )}
    />
  );
}

function AdjustmentSlider({
  label,
  value,
  onChange,
  onCommit,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}) {
  const position = (value + 100) / 2;
  return (
    <InspectorGrid className="items-center">
      <InspectorGridCell span={10}>
        <span className="truncate !text-[11px] text-muted-foreground">
          {label}
        </span>
      </InspectorGridCell>
      <InspectorGridCell span={18} className="flex items-center">
        {/* Figma's adjustment slider: a neutral pill, the knob at the centre
            for zero, and an accent fill from the centre once it moves. */}
        <SliderPrimitive.Root
          value={[value]}
          min={-100}
          max={100}
          step={1}
          onValueChange={([next]) => onChange(next ?? 0)}
          onValueCommit={([next]) => onCommit(next ?? 0)}
          className="relative flex h-4 w-full touch-none select-none items-center"
        >
          <SliderPrimitive.Track className="relative h-4 w-full grow overflow-hidden rounded-full border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]">
            {value !== 0 ? (
              <>
                <span
                  className="absolute inset-y-0 rounded-full bg-[var(--design-editor-accent-color)]"
                  style={{
                    left: `${Math.min(50, position)}%`,
                    width: `${Math.abs(position - 50)}%`,
                  }}
                />
                <span className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background" />
              </>
            ) : null}
          </SliderPrimitive.Track>
          <SliderPrimitive.Thumb
            aria-label={label}
            className={
              /* guard:allow-raw-color — Figma's neutral adjustment knob stays white in both themes. */
              "flex size-4 items-center justify-center rounded-full border border-black/10 bg-white shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            }
          >
            {value !== 0 ? (
              <span className="size-1.5 rounded-full bg-[var(--design-editor-accent-color)]" />
            ) : null}
          </SliderPrimitive.Thumb>
        </SliderPrimitive.Root>
      </InspectorGridCell>
    </InspectorGrid>
  );
}

export function ImageElementFill({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: StyleChangeHandler;
  onStylesChange?: StylesChangeHandler;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const mode = imageScaleModeFromStyles(styles);
  const filter = styles.filter;
  const [adjustments, setAdjustments] = useState(() =>
    imageAdjustmentsFromFilter(filter),
  );
  useEffect(() => setAdjustments(imageAdjustmentsFromFilter(filter)), [filter]);
  const labels: Record<ImageScaleMode, string> = {
    fill: t("editPanel.labels.imageScaleFill"),
    fit: t("editPanel.labels.imageScaleFit"),
    crop: t("editPanel.labels.imageScaleCrop"),
  };
  const adjust = (
    key: keyof ImageAdjustments,
    value: number,
    phase: "preview" | "commit",
  ) => {
    const next = { ...adjustments, [key]: value };
    setAdjustments(next);
    onStyleChange("filter", imageAdjustmentFilter(filter, next), { phase });
  };
  const hidden = adjustments.opacity === 0;
  const thumbnail = element.imageSource ? (
    <img
      src={element.imageSource}
      alt=""
      className="size-4 shrink-0 rounded-[3px] border border-border/60 object-cover"
    />
  ) : (
    <span className="size-4 shrink-0 rounded-[3px] border border-border/60" />
  );
  const sliders: Array<[Exclude<keyof ImageAdjustments, "opacity">, string]> = [
    ["exposure", t("editPanel.labels.imageExposure")],
    ["contrast", t("editPanel.labels.imageContrast")],
    ["saturation", t("editPanel.labels.imageSaturation")],
  ];
  return (
    <InspectorPaintRow>
      <InspectorGridCell span={20}>
        <Popover>
          <div className="flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]">
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("editPanel.labels.imageAdjustments")}
                className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
              >
                {thumbnail}
                <span className="min-w-0 flex-1 truncate">
                  {t("editPanel.labels.image")}
                </span>
              </button>
            </PopoverTrigger>
            <NumberField
              label={t("editPanel.labels.opacity")}
              value={adjustments.opacity}
              min={0}
              max={100}
              onCommit={(value) => adjust("opacity", value, "commit")}
              className="w-7 shrink-0"
            />
            <span className="-ml-1 tabular-nums text-muted-foreground">%</span>
          </div>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            className="w-[252px] p-0 shadow-xl"
            data-design-chrome-region="right-panel"
            // The scale-mode menu portals outside this popover; picking from it
            // must not read as a click outside that closes the popover first.
            onInteractOutside={(event) => {
              const target = event.target as Element | null;
              if (target?.closest?.('[role="listbox"]')) event.preventDefault();
            }}
            onFocusOutside={(event) => event.preventDefault()}
          >
            <div className="border-b border-border/70 px-3 py-2 !text-[11px] font-medium">
              {t("editPanel.labels.image")}
            </div>
            <div className="space-y-2 p-3">
              <Select
                value={mode}
                onValueChange={(next) =>
                  commitStylePatch(
                    imageScaleModePatch(next as ImageScaleMode),
                    onStyleChange,
                    onStylesChange,
                  )
                }
              >
                <SelectTrigger
                  aria-label={t("editPanel.labels.imageScaleMode")}
                  className="h-6 w-24 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(labels) as ImageScaleMode[]).map((key) => (
                    <SelectItem key={key} value={key} className="!text-[11px]">
                      {labels[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {element.imageSource ? (
                <img
                  src={element.imageSource}
                  alt=""
                  className={cn(
                    "h-[120px] w-full rounded-md border border-border/60 bg-[var(--design-editor-control-bg)]",
                    mode === "fit" ? "object-contain" : "object-cover",
                  )}
                  style={{
                    filter: filter && filter !== "none" ? filter : undefined,
                  }}
                />
              ) : null}
              {sliders.map(([key, label]) => (
                <AdjustmentSlider
                  key={key}
                  label={label}
                  value={adjustments[key]}
                  onChange={(value) => adjust(key, value, "preview")}
                  onCommit={(value) => adjust(key, value, "commit")}
                />
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </InspectorGridCell>
      <InspectorGridCell span={4} className="flex justify-center">
        <SectionIconButton
          label={
            hidden
              ? t("editPanel.labels.showLayer")
              : t("editPanel.labels.hideLayer")
          }
          onClick={() => adjust("opacity", hidden ? 100 : 0, "commit")}
          activateOnPointerDown
        >
          {hidden ? (
            <IconEyeOff className="size-3.5" />
          ) : (
            <IconEye className="size-3.5" />
          )}
        </SectionIconButton>
      </InspectorGridCell>
    </InspectorPaintRow>
  );
}
