import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import { Children, useEffect, useRef, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";

import type { StyleChangeMeta } from "../EditPanel";
import {
  DesignColorPicker,
  imageFillToBackgroundStyles,
  type DesignGradientType,
  type ImageFillValue,
} from "../inspector";
import type { DesignPaintType } from "../inspector/DesignColorPicker";
import type { GlslShaderPanelContext } from "../inspector/GlslShaderPanel";
import {
  buildGradientLayer,
  defaultGradientStops,
  fillLayerId,
  fillLayerIndex,
  imageFillChangePatch,
  joinCssLayers,
  parseGradientLayer,
  SOLID_FILL_ID,
  solidToGradientPatch,
  splitCssLayers,
} from "./fill-gradient-helpers";
import {
  InspectorActionRail,
  InspectorGrid,
  InspectorGridCell,
} from "./inspector-grid";
import { colorHasVisibleAlpha, cssColorOrFallback } from "./position-helpers";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";

export function normalizeLengthValue(
  raw: string,
  defaultUnit: string,
): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^-?(\d+(\.\d+)?|\.\d+)$/.test(trimmed))
    return `${trimmed}${defaultUnit}`;
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    const ok =
      CSS.supports("width", trimmed) ||
      CSS.supports("font-size", trimmed) ||
      CSS.supports("flex-basis", trimmed);
    return ok ? trimmed : null;
  }
  return trimmed;
}

const DEFAULT_PAINT_COLOR = "#000000"; // guard:allow-raw-color — valid initial value for an empty solid-paint editor

export function propInputKeyRequiresBlurGuard(key: string): boolean {
  return key === "Enter" || key === "Escape";
}

export function PropInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  defaultUnit,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  defaultUnit?: string;
}) {
  const [draft, setDraft] = useState(value);
  const mixed = isMixedValue(value);
  const skipNextBlurCommitRef = useRef(false);
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    if (isMixedValue(draft)) return;
    if (defaultUnit === undefined) {
      if (draft !== value) onChange(draft);
      return;
    }
    const next = normalizeLengthValue(draft, defaultUnit);
    if (next === null) {
      setDraft(value);
      return;
    }
    if (next !== draft) setDraft(next);
    if (next !== value) onChange(next);
  };

  return (
    <InspectorGrid>
      <InspectorGridCell span={10} className="flex items-center">
        <FieldLabel>{label}</FieldLabel>
      </InspectorGridCell>
      <InspectorGridCell span={18}>
        <Input
          type={type}
          value={draft}
          onFocus={(e) => {
            focusedRef.current = true;
            if (mixed) e.currentTarget.select();
          }}
          onChange={(e) => {
            setDraft(e.target.value);
            if (defaultUnit === undefined) onChange(e.target.value);
          }}
          onBlur={() => {
            focusedRef.current = false;
            if (skipNextBlurCommitRef.current) {
              skipNextBlurCommitRef.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
              skipNextBlurCommitRef.current = propInputKeyRequiresBlurGuard(
                e.key,
              );
              (e.currentTarget as HTMLInputElement).blur();
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setDraft(value);
              skipNextBlurCommitRef.current = propInputKeyRequiresBlurGuard(
                e.key,
              );
              (e.currentTarget as HTMLInputElement).blur();
            }
          }}
          placeholder={placeholder}
          className="h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] md:!text-[11px]"
        />
      </InspectorGridCell>
    </InspectorGrid>
  );
}

export function ColorInput({
  label,
  value,
  onChange,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
  onSolidToGradientChange,
  backgroundImage,
  backgroundSize,
  backgroundRepeat,
  backgroundPosition,
  onBackgroundImageChange,
  onImageFillChange,
  onImageFillLayerChange,
  blendMode,
  onBlendModeChange,
  supportsLayeredFills = false,
  singlePaint = false,
  allowDesignHistoryHotkeys = false,
  onChangeCancel,
  documentColors,
  supportedPaintTypes,
  pickerKey,
  glslShaderContext,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string, meta?: StyleChangeMeta) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSolidToGradientChange?: (
    patch: Record<
      | "backgroundColor"
      | "backgroundImage"
      | "backgroundSize"
      | "backgroundRepeat"
      | "backgroundPosition",
      string
    >,
  ) => void;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
  onBackgroundImageChange?: (value: string) => void;
  onImageFillChange?: (value: ImageFillValue) => void;
  onImageFillLayerChange?: (
    patch: Record<
      | "backgroundImage"
      | "backgroundSize"
      | "backgroundRepeat"
      | "backgroundPosition",
      string
    >,
  ) => void;
  blendMode?: string;
  onBlendModeChange?: (value: string) => void;
  supportsLayeredFills?: boolean;
  singlePaint?: boolean;
  allowDesignHistoryHotkeys?: boolean;
  onChangeCancel?: (value: string) => void;
  documentColors?: string[];
  supportedPaintTypes?: DesignPaintType[];
  pickerKey?: string;
  disabled?: boolean;
  glslShaderContext?: GlslShaderPanelContext;
}) {
  const [draft, setDraft] = useState(value);
  const [selectedFillId, setSelectedFillId] = useState(SOLID_FILL_ID);
  const [selectedStopId, setSelectedStopId] = useState<string | undefined>();
  const pendingGestureRef = useRef(false);

  useEffect(() => {
    if (pendingGestureRef.current) return;
    setDraft(value);
  }, [value]);

  const backgroundLayers = singlePaint
    ? []
    : splitCssLayers(backgroundImage || "");
  const backgroundSizeLayers = splitCssLayers(backgroundSize || "");
  const backgroundRepeatLayers = splitCssLayers(backgroundRepeat || "");
  const backgroundPositionLayers = splitCssLayers(backgroundPosition || "");
  const selectedLayerIndex = singlePaint
    ? null
    : fillLayerIndex(selectedFillId);
  const singlePaintGradient = singlePaint ? parseGradientLayer(value) : null;
  const selectedGradient = singlePaint
    ? singlePaintGradient
    : selectedLayerIndex !== null
      ? parseGradientLayer(backgroundLayers[selectedLayerIndex] || "")
      : null;
  const fallbackGradientIndex = backgroundLayers.findIndex((layer) =>
    Boolean(parseGradientLayer(layer)),
  );
  const activeGradientIndex =
    selectedGradient && selectedLayerIndex !== null
      ? selectedLayerIndex
      : fallbackGradientIndex >= 0
        ? fallbackGradientIndex
        : null;
  const activeGradient = singlePaint
    ? singlePaintGradient
    : activeGradientIndex !== null
      ? parseGradientLayer(backgroundLayers[activeGradientIndex] || "")
      : null;
  const activeStopIds =
    activeGradient?.stops.map((stop) => stop.id).join("|") ?? "";

  useEffect(() => {
    if (
      selectedFillId !== SOLID_FILL_ID &&
      (selectedLayerIndex === null ||
        selectedLayerIndex >= backgroundLayers.length)
    ) {
      setSelectedFillId(SOLID_FILL_ID);
    }
  }, [backgroundLayers.length, selectedFillId, selectedLayerIndex]);

  useEffect(() => {
    if (!activeStopIds) {
      if (selectedStopId) setSelectedStopId(undefined);
      return;
    }
    const stopIds = activeStopIds.split("|").filter(Boolean);
    if (!selectedStopId || !stopIds.includes(selectedStopId)) {
      setSelectedStopId(stopIds[0]);
    }
  }, [activeStopIds, selectedStopId]);

  const setNext = (next: string, phase: "preview" | "commit" = "commit") => {
    if (!supportsLayeredFills && !singlePaint && !parseCssColor(next)) return;
    pendingGestureRef.current = phase === "preview";
    setDraft(next);
    onChange(next, { phase });
  };

  const replaceBackgroundLayer = (index: number, nextLayer: string) => {
    if (!onBackgroundImageChange) return;
    const nextLayers = [...backgroundLayers];
    nextLayers[index] = nextLayer;
    onBackgroundImageChange(joinCssLayers(nextLayers));
  };

  const removeBackgroundLayer = (index: number) => {
    if (!onBackgroundImageChange) return;
    const nextLayers = backgroundLayers.filter(
      (_, layerIndex) => layerIndex !== index,
    );
    onBackgroundImageChange(joinCssLayers(nextLayers));
    setSelectedFillId(SOLID_FILL_ID);
  };

  const handlePaintValueChange = (nextValue: string) => {
    if (singlePaint) {
      setNext(nextValue, "preview");
      return;
    }
    if (!supportsLayeredFills || !onBackgroundImageChange) {
      setNext(nextValue);
      return;
    }

    const selectedLayer = fillLayerIndex(selectedFillId);
    if (selectedLayer !== null) {
      replaceBackgroundLayer(selectedLayer, nextValue);
      const gradient = parseGradientLayer(nextValue);
      if (gradient) setSelectedStopId(gradient.stops[0]?.id);
      return;
    }

    onBackgroundImageChange(joinCssLayers([nextValue, ...backgroundLayers]));
    setSelectedFillId(fillLayerId(0));
    const gradient = parseGradientLayer(nextValue);
    setSelectedStopId(gradient?.stops[0]?.id);
  };

  const handleImageFillChange = onImageFillLayerChange
    ? (nextImage: ImageFillValue) => {
        const styles = imageFillToBackgroundStyles(nextImage);
        const layerIndex = fillLayerIndex(selectedFillId);
        onImageFillLayerChange(
          imageFillChangePatch(
            {
              backgroundImage: backgroundLayers,
              backgroundSize: backgroundSizeLayers,
              backgroundRepeat: backgroundRepeatLayers,
              backgroundPosition: backgroundPositionLayers,
            },
            layerIndex,
            styles,
          ),
        );
        if (layerIndex === null) setSelectedFillId(fillLayerId(0));
      }
    : onImageFillChange;

  const handleGradientTypeChange =
    activeGradient && activeGradientIndex !== null
      ? (type: DesignGradientType) => {
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(
              type,
              activeGradient.stops,
              undefined,
              activeGradient.opacity,
            ),
          );
        }
      : undefined;

  const selectedPaintType: DesignPaintType = singlePaint
    ? (singlePaintGradient?.type ??
      (colorHasVisibleAlpha(draft || value) ? "solid" : "none"))
    : selectedFillId !== SOLID_FILL_ID
      ? selectedGradient
        ? selectedGradient.type
        : "image"
      : colorHasVisibleAlpha(draft || value)
        ? "solid"
        : "none";
  const pickerValue = singlePaint
    ? singlePaintGradient
      ? value
      : draft || value || DEFAULT_PAINT_COLOR
    : selectedLayerIndex !== null
      ? (backgroundLayers[selectedLayerIndex] ??
        draft ??
        value ??
        DEFAULT_PAINT_COLOR)
      : draft || DEFAULT_PAINT_COLOR;
  const selectedBackgroundLayerValue = (layers: string[]): string | undefined =>
    selectedLayerIndex !== null ? layers[selectedLayerIndex] : undefined;
  const handlePaintTypeChange = (type: DesignPaintType) => {
    const selectedLayer = fillLayerIndex(selectedFillId);
    if (type === "solid") {
      const selectedLayerIsSynthetic =
        selectedLayer !== null && selectedLayer >= backgroundLayers.length;
      const removedGradient = parseGradientLayer(
        selectedLayer !== null && !selectedLayerIsSynthetic
          ? backgroundLayers[selectedLayer] || ""
          : value,
      );
      if (selectedLayer !== null && !selectedLayerIsSynthetic) {
        removeBackgroundLayer(selectedLayer);
      }
      setSelectedFillId(SOLID_FILL_ID);
      const firstStopColor = removedGradient?.stops[0]?.color;
      const parsedStop = firstStopColor ? parseCssColor(firstStopColor) : null;
      setNext(
        cssColorOrFallback(
          parsedStop
            ? rgbaToCss(
                withColorOpacity(
                  parsedStop,
                  parsedStop.a * (removedGradient?.opacity ?? 100),
                ),
              )
            : firstStopColor || draft || value,
          "#000000",
        ),
      );
      return;
    }
    if (type === "none") {
      if (selectedLayer !== null) {
        removeBackgroundLayer(selectedLayer);
        return;
      }
      setNext("transparent");
      return;
    }
    if (!onBackgroundImageChange && !onSolidToGradientChange) return;

    if (
      type !== "linear" &&
      type !== "radial" &&
      type !== "angular" &&
      type !== "diamond"
    ) {
      return;
    }
    const nextType: DesignGradientType = type;
    if (singlePaint) {
      if (singlePaintGradient) {
        setNext(
          buildGradientLayer(
            nextType,
            singlePaintGradient.stops,
            undefined,
            singlePaintGradient.opacity,
          ),
        );
        return;
      }
      const patch = solidToGradientPatch(
        draft || value || DEFAULT_PAINT_COLOR,
        {
          backgroundImage: [],
          backgroundSize: [],
          backgroundRepeat: [],
          backgroundPosition: [],
        },
        nextType,
      );
      if (onSolidToGradientChange) onSolidToGradientChange(patch);
      else setNext(patch.backgroundImage);
      return;
    }
    if (selectedLayer !== null) {
      const currentGradient = parseGradientLayer(
        backgroundLayers[selectedLayer] || "",
      );
      const stops =
        currentGradient?.stops ?? defaultGradientStops(draft || value);
      replaceBackgroundLayer(
        selectedLayer,
        buildGradientLayer(
          nextType,
          stops,
          undefined,
          currentGradient?.opacity,
        ),
      );
      setSelectedFillId(fillLayerId(selectedLayer));
      setSelectedStopId(stops[0]?.id);
      return;
    }

    const patch = solidToGradientPatch(
      draft || value || "#000000",
      {
        backgroundImage: backgroundLayers,
        backgroundSize: backgroundSizeLayers,
        backgroundRepeat: backgroundRepeatLayers,
        backgroundPosition: backgroundPositionLayers,
      },
      nextType,
    );
    if (onSolidToGradientChange) {
      onSolidToGradientChange(patch);
    } else {
      if (!onBackgroundImageChange) return;
      onBackgroundImageChange(patch.backgroundImage);
      setNext(patch.backgroundColor);
    }
    if (!singlePaint) setSelectedFillId(fillLayerId(backgroundLayers.length));
    setSelectedStopId("stop-0");
  };

  if (isMixedValue(value)) {
    return (
      <button
        type="button"
        className="flex h-6 w-full items-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left !text-[11px] text-muted-foreground"
        onClick={() => onChange("#000000")}
      >
        {MIXED_VALUE}
      </button>
    );
  }

  return (
    <DesignColorPicker
      key={pickerKey}
      open={controlledOpen}
      onOpenChange={onControlledOpenChange}
      label={label}
      value={pickerValue}
      onChange={(v) => setNext(v, "preview")}
      onChangeComplete={(v) => setNext(v, "commit")}
      onChangeCancel={
        onChangeCancel
          ? (v) => {
              pendingGestureRef.current = false;
              setDraft(v);
              onChangeCancel(v);
            }
          : undefined
      }
      onPaintValueChange={
        supportsLayeredFills ? handlePaintValueChange : undefined
      }
      onImageFillChange={handleImageFillChange}
      backgroundImage={selectedBackgroundLayerValue(backgroundLayers)}
      backgroundSize={selectedBackgroundLayerValue(backgroundSizeLayers)}
      backgroundRepeat={selectedBackgroundLayerValue(backgroundRepeatLayers)}
      backgroundPosition={selectedBackgroundLayerValue(
        backgroundPositionLayers,
      )}
      blendMode={blendMode}
      onBlendModeChange={onBlendModeChange}
      showBlendMode={Boolean(onBlendModeChange)}
      paintType={selectedPaintType}
      onPaintTypeChange={handlePaintTypeChange}
      gradientType={activeGradient?.type}
      onGradientTypeChange={handleGradientTypeChange}
      documentColors={documentColors}
      supportedPaintTypes={supportedPaintTypes}
      glslShaderContext={glslShaderContext}
      allowDesignHistoryHotkeys={allowDesignHistoryHotkeys}
      disabled={disabled}
    />
  );
}

export function PropSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <InspectorGrid>
      <InspectorGridCell span={10} className="flex items-center">
        <FieldLabel>{label}</FieldLabel>
      </InspectorGridCell>
      <InspectorGridCell span={18}>
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger
            aria-label={label}
            className="h-6 w-full min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="!text-[11px]"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </InspectorGridCell>
    </InspectorGrid>
  );
}

export function PropSlider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  unit = "",
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  return (
    <InspectorGrid>
      <InspectorGridCell span={10} className="flex items-center">
        <FieldLabel>{label}</FieldLabel>
      </InspectorGridCell>
      <InspectorGridCell span={14} className="flex items-center">
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          min={min}
          max={max}
          step={step}
          className="w-full"
        />
      </InspectorGridCell>
      <InspectorGridCell span={4} className="flex items-center justify-center">
        <span className="text-right !text-[11px] tabular-nums text-muted-foreground">
          {value}
          {unit}
        </span>
      </InspectorGridCell>
    </InspectorGrid>
  );
}

export {
  INSPECTOR_GRID_COLUMNS,
  INSPECTOR_GRID_ACTION_GUTTER_SPAN,
  INSPECTOR_GRID_ACTION_PAIR_SPAN,
  INSPECTOR_GRID_ACTION_SPAN,
  INSPECTOR_GRID_PAIR_GUTTER_SPAN,
  INSPECTOR_GRID_PAIR_SPAN,
  INSPECTOR_GRID_ROW_PX,
  INSPECTOR_GRID_UNIT_PX,
  InspectorActionPairGrid,
  InspectorActionRail,
  InspectorGrid,
  InspectorGridCell,
} from "./inspector-grid";

export function PanelSection({
  title,
  actions,
  children,
  onEmptyTitleClick,
  emptyTitleActionLabel,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  onEmptyTitleClick?: () => void;
  emptyTitleActionLabel?: string;
}) {
  const hasContent = Children.toArray(children).length > 0;
  const heading = (
    <h3
      aria-label={title}
      className="design-sidebar-section-title min-w-0 flex-1 truncate text-foreground"
    >
      {onEmptyTitleClick && !hasContent ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={emptyTitleActionLabel ?? title}
          className="h-full w-full min-w-0 justify-start rounded-none bg-transparent p-0 text-left text-inherit shadow-none hover:bg-transparent"
          onClick={onEmptyTitleClick}
        >
          {title}
        </Button>
      ) : (
        title
      )}
    </h3>
  );

  return (
    <section
      data-design-inspector-section
      className="design-sidebar-section shrink-0"
    >
      <div data-design-inspector-section-header className="px-2">
        <InspectorGrid
          className="min-h-[var(--design-section-height)] items-center"
          layout={actions ? "header-actions" : "columns"}
        >
          <InspectorGridCell span={actions ? 20 : 28}>
            <div className="flex min-w-0 items-center">{heading}</div>
          </InspectorGridCell>
          {actions ? (
            <InspectorGridCell span={8}>
              <InspectorActionRail>{actions}</InspectorActionRail>
            </InspectorGridCell>
          ) : null}
        </InspectorGrid>
      </div>
      {hasContent ? (
        <div
          data-design-inspector-section-content
          className="design-sidebar-control-text design-sidebar-section-content"
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Label className="design-sidebar-field-label min-w-0 truncate text-muted-foreground">
      {children}
    </Label>
  );
}

export function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="design-sidebar-field-label text-muted-foreground">
      {children}
    </p>
  );
}
