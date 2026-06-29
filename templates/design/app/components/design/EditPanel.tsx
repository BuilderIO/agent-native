import { useT } from "@agent-native/core/client";
import type { TweakDefinition } from "@shared/api";
import {
  alphaToOpacity,
  parseCssColor,
  rgbaToCss,
  rgbaToHex,
  withColorOpacity,
} from "@shared/color-utils";
import {
  IconAlignCenter,
  IconAlignJustified,
  IconAlignLeft,
  IconAlignRight,
  IconArrowAutofitHeight,
  IconArrowAutofitWidth,
  IconBackground,
  IconBlur,
  IconBorderStyle,
  IconBrush,
  IconChevronDown,
  IconCode,
  IconComponents,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconLayoutDistributeHorizontal,
  IconLayoutGrid,
  IconSlice,
  IconLayoutAlignBottom,
  IconLayoutAlignCenter,
  IconLayoutAlignLeft,
  IconLayoutAlignMiddle,
  IconLayoutAlignRight,
  IconLayoutAlignTop,
  IconLetterCase,
  IconLetterSpacing,
  IconLineHeight,
  IconLink,
  IconMaximize,
  IconMinus,
  IconPalette,
  IconPhoto,
  IconPlus,
  IconShadow,
  IconSquare,
  IconTypography,
  IconUnlink,
  IconVector,
} from "@tabler/icons-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  DesignExtensionsPanel,
  type DesignExtensionSlotContext,
} from "./DesignExtensionsPanel";
import {
  AutoLayoutMatrix,
  ConstraintsWidget,
  ExportSettingsPanel,
  FigmaColorPicker,
  ScrubInput,
  SizingField,
  type AlignmentMatrixValue,
  type AutoLayoutMatrixValue,
  type AutoLayoutSizing,
  type AutoLayoutSizingAxis,
  type ConstraintsValue,
  type ExportSettingsValue,
  type FigmaFillRow,
  type FigmaFillRowPatch,
  type FigmaGradientStop,
  type FigmaGradientStopPatch,
  type FigmaGradientType,
} from "./inspector";
import type { FigmaPaintType } from "./inspector/FigmaColorPicker";
import { TweaksPanelContent } from "./TweaksPanel";
import type { ElementInfo } from "./types";

export type InspectorTab = "design" | "tweaks" | "extensions";

interface EditPanelProps {
  selectedElement: ElementInfo | null;
  pageStyles?: Record<string, string>;
  zoom?: number;
  headerTrailing?: ReactNode;
  width?: number;
  activeTab?: InspectorTab;
  onActiveTabChange?: (tab: InspectorTab) => void;
  tweaks?: TweakDefinition[];
  tweakValues?: Record<string, string | number | boolean>;
  extensionContext?: DesignExtensionSlotContext;
  onTweakChange?: (id: string, value: string | number | boolean) => void;
  onRequestTweaks?: (anchor: HTMLElement) => void;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
  onExport?: (settings: ExportSettingsValue) => void;
  exporting?: boolean;
}

/**
 * Normalize a CSS length-ish value typed by the user. If the input is bare
 * digits (e.g. "32" or "32.5"), append the default unit so it parses as a
 * valid CSS length. Lets users type "32" and get the expected "32px" when
 * the field is committed.
 */
function normalizeLengthValue(raw: string, defaultUnit: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}${defaultUnit}`;
  return trimmed;
}

/** Compact input row: label + text input.
 *
 * For CSS length fields (font-size, padding, width, etc.) pass `defaultUnit`
 * so the change is committed on blur/Enter and a bare number auto-appends the
 * unit. Without that, intermediate keystrokes apply invalid CSS — typing "32"
 * for a font-size silently fails because "32" alone isn't a valid length, and
 * it never reaches "32px" because every keystroke re-applies the broken
 * value.
 */
function PropInput({
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

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (defaultUnit === undefined) return;
    const next = normalizeLengthValue(draft, defaultUnit);
    if (next !== draft) setDraft(next);
    if (next !== value) onChange(next);
  };

  return (
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Input
        type={type}
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          // For length fields, defer the live update until blur/Enter so that
          // invalid intermediate strings ("3", "32", "32p") don't get applied
          // and discarded by the browser. Free-text fields (without
          // defaultUnit) keep the responsive live-update behavior.
          if (defaultUnit === undefined) onChange(e.target.value);
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
      />
    </div>
  );
}

/** Compact color input: label + Figma-style picker popover. */
function ColorInput({
  label,
  value,
  onChange,
  backgroundImage,
  onBackgroundImageChange,
  blendMode,
  onBlendModeChange,
  supportsLayeredFills = false,
  documentColors,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  backgroundImage?: string;
  onBackgroundImageChange?: (value: string) => void;
  blendMode?: string;
  onBlendModeChange?: (value: string) => void;
  supportsLayeredFills?: boolean;
  /** Hex strings already in use on the page — forwarded to the color picker swatch grid. */
  documentColors?: string[];
}) {
  const [draft, setDraft] = useState(value);
  const [selectedFillId, setSelectedFillId] = useState(SOLID_FILL_ID);
  const [selectedStopId, setSelectedStopId] = useState<string | undefined>();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const backgroundLayers = splitCssLayers(backgroundImage || "");
  const selectedLayerIndex = fillLayerIndex(selectedFillId);
  const selectedGradient =
    selectedLayerIndex !== null
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
  const activeGradient =
    activeGradientIndex !== null
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

  const setNext = (next: string) => {
    setDraft(next);
    onChange(next);
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

  const fillRows = supportsLayeredFills
    ? buildFillRows(
        draft || value || "#000000",
        backgroundLayers,
        selectedFillId,
      )
    : undefined;

  const handleFillChange = (id: string, patch: FigmaFillRowPatch) => {
    if (id === SOLID_FILL_ID) {
      if (patch.value !== undefined) setNext(patch.value);
      if (patch.opacity !== undefined) {
        const parsed = parseCssColor(patch.value ?? draft);
        if (parsed) setNext(rgbaToCss(withColorOpacity(parsed, patch.opacity)));
      }
      return;
    }

    const index = fillLayerIndex(id);
    if (index === null || !onBackgroundImageChange) return;
    const currentLayer = backgroundLayers[index] || "";
    if (patch.value !== undefined) {
      replaceBackgroundLayer(index, patch.value);
      return;
    }
    if (patch.opacity === undefined) return;
    const gradient = parseGradientLayer(currentLayer);
    if (!gradient) return;
    replaceBackgroundLayer(
      index,
      buildGradientLayer(
        gradient.type,
        gradient.stops.map((stop) => ({
          ...stop,
          opacity: patch.opacity,
        })),
      ),
    );
  };

  const handleAddFill = onBackgroundImageChange
    ? () => {
        const nextLayers = [
          defaultGradientLayer("linear", draft || value || "#000000"),
          ...backgroundLayers,
        ];
        onBackgroundImageChange(joinCssLayers(nextLayers));
        setSelectedFillId(fillLayerId(0));
        setSelectedStopId("stop-0");
      }
    : undefined;

  const handleRemoveFill = onBackgroundImageChange
    ? (id: string) => {
        const index = fillLayerIndex(id);
        if (index === null) return;
        removeBackgroundLayer(index);
      }
    : undefined;

  const handleGradientTypeChange =
    activeGradient && activeGradientIndex !== null
      ? (type: FigmaGradientType) => {
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(type, activeGradient.stops),
          );
        }
      : undefined;

  const handleGradientStopChange =
    activeGradient && activeGradientIndex !== null
      ? (id: string, patch: FigmaGradientStopPatch) => {
          const nextStops = activeGradient.stops.map((stop) =>
            stop.id === id ? { ...stop, ...patch } : stop,
          );
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(activeGradient.type, nextStops),
          );
        }
      : undefined;

  const handleAddGradientStop = onBackgroundImageChange
    ? () => {
        if (activeGradient && activeGradientIndex !== null) {
          const nextStop: FigmaGradientStop = {
            id: `stop-${activeGradient.stops.length}`,
            color: draft || "#000000",
            position: 50,
            opacity: 100,
          };
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(activeGradient.type, [
              ...activeGradient.stops,
              nextStop,
            ]),
          );
          setSelectedStopId(nextStop.id);
          return;
        }

        onBackgroundImageChange(
          joinCssLayers([
            defaultGradientLayer("linear", draft || value || "#000000"),
            ...backgroundLayers,
          ]),
        );
        setSelectedFillId(fillLayerId(0));
        setSelectedStopId("stop-0");
      }
    : undefined;

  const handleRemoveGradientStop =
    activeGradient && activeGradientIndex !== null
      ? (id: string) => {
          if (activeGradient.stops.length <= 2) return;
          const nextStops = activeGradient.stops.filter(
            (stop) => stop.id !== id,
          );
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(activeGradient.type, nextStops),
          );
          setSelectedStopId(nextStops[0]?.id);
        }
      : undefined;

  const selectedPaintType: FigmaPaintType =
    selectedFillId !== SOLID_FILL_ID
      ? selectedGradient
        ? selectedGradient.type
        : "image"
      : colorHasVisibleAlpha(draft || value)
        ? "solid"
        : "none";
  const pickerValue =
    selectedLayerIndex !== null
      ? (backgroundLayers[selectedLayerIndex] ?? draft ?? value ?? "#000000")
      : draft || "#000000";

  const handlePaintTypeChange = (type: FigmaPaintType) => {
    const selectedLayer = fillLayerIndex(selectedFillId);
    if (type === "solid") {
      if (selectedLayer !== null) removeBackgroundLayer(selectedLayer);
      setSelectedFillId(SOLID_FILL_ID);
      setNext(cssColorOrFallback(draft || value, "#000000"));
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
    if (!onBackgroundImageChange) return;

    if (
      type !== "linear" &&
      type !== "radial" &&
      type !== "angular" &&
      type !== "diamond"
    ) {
      return;
    }
    const nextType: FigmaGradientType = type;
    const layerIndex = selectedLayer ?? activeGradientIndex;
    if (layerIndex !== null) {
      const currentGradient = parseGradientLayer(
        backgroundLayers[layerIndex] || "",
      );
      const stops =
        currentGradient?.stops ?? defaultGradientStops(draft || value);
      replaceBackgroundLayer(layerIndex, buildGradientLayer(nextType, stops));
      setSelectedFillId(fillLayerId(layerIndex));
      setSelectedStopId(stops[0]?.id);
      return;
    }

    onBackgroundImageChange(
      joinCssLayers([
        defaultGradientLayer(nextType, draft || value || "#000000"),
        ...backgroundLayers,
      ]),
    );
    setSelectedFillId(fillLayerId(0));
    setSelectedStopId("stop-0");
  };

  return (
    <FigmaColorPicker
      label={label}
      value={pickerValue}
      onChange={setNext}
      onPaintValueChange={
        supportsLayeredFills ? handlePaintValueChange : undefined
      }
      blendMode={blendMode}
      onBlendModeChange={onBlendModeChange}
      showBlendMode={supportsLayeredFills}
      fillRows={fillRows}
      selectedFillId={selectedFillId}
      onFillSelect={supportsLayeredFills ? setSelectedFillId : undefined}
      onFillChange={supportsLayeredFills ? handleFillChange : undefined}
      onAddFill={supportsLayeredFills ? handleAddFill : undefined}
      onRemoveFill={supportsLayeredFills ? handleRemoveFill : undefined}
      paintType={selectedPaintType}
      onPaintTypeChange={handlePaintTypeChange}
      gradientType={activeGradient?.type}
      onGradientTypeChange={handleGradientTypeChange}
      gradientStops={activeGradient?.stops}
      selectedStopId={selectedStopId}
      onGradientStopSelect={setSelectedStopId}
      onGradientStopChange={handleGradientStopChange}
      onAddGradientStop={
        supportsLayeredFills ? handleAddGradientStop : undefined
      }
      onRemoveGradientStop={handleRemoveGradientStop}
      documentColors={documentColors}
    />
  );
}

const SOLID_FILL_ID = "solid";
const FILL_LAYER_PREFIX = "layer:";

interface ParsedGradientLayer {
  type: FigmaGradientType;
  stops: FigmaGradientStop[];
}

function fillLayerId(index: number): string {
  return `${FILL_LAYER_PREFIX}${index}`;
}

function fillLayerIndex(id: string): number | null {
  if (!id.startsWith(FILL_LAYER_PREFIX)) return null;
  const index = Number(id.slice(FILL_LAYER_PREFIX.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

function buildFillRows(
  colorValue: string,
  backgroundLayers: string[],
  selectedFillId: string,
): FigmaFillRow[] {
  const solid = parseCssColor(colorValue);
  const rows: FigmaFillRow[] = [
    {
      id: SOLID_FILL_ID,
      label: "Solid", // i18n-ignore inspector fallback label
      type: "solid",
      value: colorValue,
      swatch: colorValue,
      opacity: solid ? alphaToOpacity(solid.a) : 100,
      selected: selectedFillId === SOLID_FILL_ID,
    },
  ];

  backgroundLayers.forEach((layer, index) => {
    const gradient = parseGradientLayer(layer);
    rows.push({
      id: fillLayerId(index),
      label: gradient
        ? `Gradient ${index + 1}` // i18n-ignore inspector fallback label
        : `Image ${index + 1}`, // i18n-ignore inspector fallback label
      type: gradient ? "gradient" : "image",
      value: layer,
      swatch: layer,
      opacity: gradient ? averageGradientOpacity(gradient.stops) : 100,
      selected: selectedFillId === fillLayerId(index),
    });
  });

  return rows;
}

function averageGradientOpacity(stops: FigmaGradientStop[]): number {
  if (!stops.length) return 100;
  const total = stops.reduce((sum, stop) => {
    const parsed = parseCssColor(stop.color);
    return sum + (stop.opacity ?? (parsed ? alphaToOpacity(parsed.a) : 100));
  }, 0);
  return Math.round(total / stops.length);
}

function splitCssLayers(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "none") return [];
  const layers: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      const layer = trimmed.slice(start, index).trim();
      if (layer) layers.push(layer);
      start = index + 1;
    }
  }

  const finalLayer = trimmed.slice(start).trim();
  if (finalLayer) layers.push(finalLayer);
  return layers;
}

function joinCssLayers(layers: string[]): string {
  const cleaned = layers.map((layer) => layer.trim()).filter(Boolean);
  return cleaned.length ? cleaned.join(", ") : "none";
}

function parseGradientLayer(layer: string): ParsedGradientLayer | null {
  const match = layer.trim().match(/^(linear|radial|conic)-gradient\((.*)\)$/i);
  if (!match) return null;

  const parts = splitCssLayers(match[2] || "");
  const type = gradientTypeFromCss(match[1] || "", layer);
  const firstStop = parseGradientStop(parts[0] || "", 0, parts.length);
  const stopParts = firstStop ? parts : parts.slice(1);
  const stops = stopParts
    .map((part, index) => parseGradientStop(part, index, stopParts.length))
    .filter((stop): stop is FigmaGradientStop => Boolean(stop));

  if (!stops.length) return null;
  return { type, stops };
}

function parseGradientStop(
  part: string,
  index: number,
  total: number,
): FigmaGradientStop | null {
  const color = readLeadingColor(part);
  if (!color) return null;
  const parsed = parseCssColor(color.value);
  const remaining = part.slice(color.raw.length);
  const positionMatch = remaining.match(/(-?\d+(?:\.\d+)?)%/);
  const position = positionMatch
    ? clampNumber(Number(positionMatch[1]), 0, 100)
    : total <= 1
      ? 0
      : Math.round((index / (total - 1)) * 100);

  return {
    id: `stop-${index}`,
    color: parsed ? rgbaToCss(parsed) : color.value,
    position,
    opacity: parsed ? alphaToOpacity(parsed.a) : 100,
  };
}

function readLeadingColor(part: string): { raw: string; value: string } | null {
  const trimmed = part.trim();
  const hex = trimmed.match(/^#[0-9a-f]{3,8}\b/i);
  if (hex) return { raw: hex[0], value: hex[0] };
  const transparent = trimmed.match(/^transparent\b/i);
  if (transparent) {
    return { raw: transparent[0], value: "rgba(0, 0, 0, 0)" };
  }
  const functionName = trimmed.match(/^(rgb|rgba|hsl|hsla)\(/i);
  if (!functionName) return null;
  let depth = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === "(") depth += 1;
    if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        const raw = trimmed.slice(0, index + 1);
        return { raw, value: raw };
      }
    }
  }
  return null;
}

function gradientTypeFromCss(
  functionName: string,
  layer: string,
): FigmaGradientType {
  if (functionName.toLowerCase() === "conic") return "angular";
  if (/closest-corner/i.test(layer)) return "diamond";
  if (functionName.toLowerCase() === "radial") return "radial";
  return "linear";
}

function gradientLabel(type: FigmaGradientType): string {
  if (type === "radial") {
    return "Radial gradient"; // i18n-ignore Figma inspector paint row
  }
  if (type === "angular") {
    return "Angular gradient"; // i18n-ignore Figma inspector paint row
  }
  if (type === "diamond") {
    return "Diamond gradient"; // i18n-ignore Figma inspector paint row
  }
  return "Linear gradient"; // i18n-ignore Figma inspector paint row
}

function buildGradientLayer(
  type: FigmaGradientType,
  stops: FigmaGradientStop[],
): string {
  const stopList = [...stops]
    .sort((a, b) => a.position - b.position)
    .map((stop) => {
      const parsed = parseCssColor(stop.color);
      const opacity = stop.opacity ?? (parsed ? alphaToOpacity(parsed.a) : 100);
      const color = parsed
        ? rgbaToCss(withColorOpacity(parsed, opacity))
        : stop.color;
      return `${color} ${clampNumber(stop.position, 0, 100)}%`;
    })
    .join(", ");

  if (type === "radial") {
    return `radial-gradient(circle at 50% 50%, ${stopList})`;
  }
  if (type === "angular") {
    return `conic-gradient(from 0deg at 50% 50%, ${stopList})`;
  }
  if (type === "diamond") {
    return `radial-gradient(closest-corner at 50% 50%, ${stopList})`;
  }
  return `linear-gradient(90deg, ${stopList})`;
}

function defaultGradientStops(colorValue: string): FigmaGradientStop[] {
  const parsed =
    parseCssColor(cssColorOrFallback(colorValue, "#000000")) ??
    parseCssColor("#000000");
  const start = parsed ? rgbaToCss(withColorOpacity(parsed, 100)) : "#000000";
  const end = parsed
    ? rgbaToCss(withColorOpacity(parsed, 0))
    : "rgba(0, 0, 0, 0)";

  return [
    { id: "stop-0", color: start, position: 0, opacity: 100 },
    { id: "stop-1", color: end, position: 100, opacity: 0 },
  ];
}

function defaultGradientLayer(type: FigmaGradientType, colorValue: string) {
  return buildGradientLayer(type, defaultGradientStops(colorValue));
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

/** Select dropdown */
function PropSelect({
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
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="text-[11px]"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/** Slider with label and value display */
function PropSlider({
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
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={min}
        max={max}
        step={step}
        className="flex-1"
      />
      <span className="w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {value}
        {unit}
      </span>
    </div>
  );
}

const EmptyScrubIcon = () => null;

/**
 * Figma-style inspector section. Matches Figma's real "Design" panel chrome:
 *   - NO left collapse chevron (Figma has none).
 *   - A thin divider line above each section.
 *   - A bold left-aligned title.
 *   - Right-aligned action icons (add layer, toggles, styles, etc.).
 *
 * The title is still clickable to collapse the body (Figma collapses sections
 * on title click) but renders no chevron glyph, just like Figma.
 */
function PanelSection({
  title,
  actions,
  children,
  defaultCollapsed = false,
}: {
  title: string;
  actions?: ReactNode;
  children?: ReactNode;
  defaultCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);

  return (
    <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
      <div className="flex min-h-9 items-center gap-2 px-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 cursor-pointer items-center bg-transparent text-left"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
        >
          <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
            {title}
          </h3>
        </button>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>
      {!collapsed && children ? (
        <div className="space-y-1.5 px-3 pb-3 pt-0.5 text-[11px]">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Label className="w-[64px] shrink-0 text-[11px] font-medium text-muted-foreground">
      {children}
    </Label>
  );
}

function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium text-muted-foreground">{children}</p>
  );
}

function FigmaSpacingControl({
  label,
  values,
  onChange,
}: {
  label: string;
  values: { top: string; right: string; bottom: string; left: string };
  onChange: (side: string, value: string) => void;
}) {
  const t = useT();
  const [linked, setLinked] = useState(() => sidesAreLinked(values));
  const numeric = {
    top: parseNumericValue(values.top || "0"),
    right: parseNumericValue(values.right || "0"),
    bottom: parseNumericValue(values.bottom || "0"),
    left: parseNumericValue(values.left || "0"),
  };
  const linkedValue = Math.round(
    (numeric.top + numeric.right + numeric.bottom + numeric.left) / 4,
  );
  const setSide = (
    side: "Top" | "Right" | "Bottom" | "Left",
    value: number,
  ) => {
    onChange(side, `${Math.round(value)}px`);
  };
  const setAll = (value: number) => {
    (["Top", "Right", "Bottom", "Left"] as const).forEach((side) =>
      setSide(side, value),
    );
  };
  const linkedLabel = linked
    ? t("editPanel.labels.unlinkSides")
    : t("editPanel.labels.linkSides");

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-1.5">
        <Label className="text-[11px] font-medium text-muted-foreground">
          {label}
        </Label>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground"
              onClick={() => setLinked((current) => !current)}
              aria-label={linkedLabel}
            >
              {linked ? (
                <IconLink className="size-3.5" />
              ) : (
                <IconUnlink className="size-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{linkedLabel}</TooltipContent>
        </Tooltip>
      </div>
      {linked ? (
        <ScrubInput
          label={t("editPanel.labels.allSides")}
          value={linkedValue}
          onChange={setAll}
          unit="px"
          min={0}
          precision={1}
          labelClassName="w-16"
          inputClassName="h-6"
        />
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <ScrubInput
            label={t("editPanel.sidePlaceholders.top")}
            value={numeric.top}
            onChange={(value) => setSide("Top", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.right")}
            value={numeric.right}
            onChange={(value) => setSide("Right", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.bottom")}
            value={numeric.bottom}
            onChange={(value) => setSide("Bottom", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
          <ScrubInput
            label={t("editPanel.sidePlaceholders.left")}
            value={numeric.left}
            onChange={(value) => setSide("Left", value)}
            unit="px"
            min={0}
            precision={1}
            inputClassName="h-6"
          />
        </div>
      )}
    </div>
  );
}

function sidesAreLinked(values: {
  top: string;
  right: string;
  bottom: string;
  left: string;
}) {
  return (
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.right || "0") &&
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.bottom || "0") &&
    parseNumericValue(values.top || "0") ===
      parseNumericValue(values.left || "0")
  );
}

const FONT_FAMILY_OPTIONS = [
  { value: "inherit", key: "inherit" },
  { value: "sans-serif", key: "sansSerif" },
  { value: "serif", key: "serif" },
  { value: "monospace", key: "monospace" },
  { value: "'Inter', sans-serif", key: "inter" },
  { value: "'Poppins', sans-serif", key: "poppins" },
  { value: "'Playfair Display', serif", key: "playfairDisplay" },
  { value: "'JetBrains Mono', monospace", key: "jetBrainsMono" },
] as const;

const FONT_WEIGHT_OPTIONS = [
  { value: "100", key: "thin" },
  { value: "200", key: "extraLight" },
  { value: "300", key: "light" },
  { value: "400", key: "regular" },
  { value: "500", key: "medium" },
  { value: "600", key: "semiBold" },
  { value: "700", key: "bold" },
  { value: "800", key: "extraBold" },
  { value: "900", key: "black" },
] as const;

const ALIGN_SELF_OPTIONS = [
  { value: "auto", key: "auto" },
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "stretch", key: "stretch" },
  { value: "baseline", key: "baseline" },
] as const;
const STROKE_POSITION_OPTIONS = [
  { value: "inside", key: "inside" },
  { value: "center", key: "center" },
  { value: "outside", key: "outside" },
] as const;
const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color dodge" }, // i18n-ignore Figma blend mode label
  { value: "color-burn", label: "Color burn" }, // i18n-ignore Figma blend mode label
  { value: "hard-light", label: "Hard light" }, // i18n-ignore Figma blend mode label
  { value: "soft-light", label: "Soft light" }, // i18n-ignore Figma blend mode label
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Color" },
  { value: "luminosity", label: "Luminosity" },
] as const;

function parseNumericValue(value: string): number {
  return parseFloat(value) || 0;
}

function parseRotationValue(transform: string | undefined): number {
  const match = transform?.match(/rotate\((-?\d+(?:\.\d+)?)deg\)/);
  return match ? Number(match[1]) : 0;
}

function mergeRotationValue(transform: string | undefined, degrees: number) {
  const nextRotate = `rotate(${Math.round(degrees * 10) / 10}deg)`;
  if (!transform || transform === "none") return nextRotate;
  if (/rotate\((-?\d+(?:\.\d+)?)deg\)/.test(transform)) {
    return transform.replace(/rotate\((-?\d+(?:\.\d+)?)deg\)/, nextRotate);
  }
  return `${transform} ${nextRotate}`;
}

function ScrubStyleInput({
  label,
  value,
  placeholder,
  onChange,
  unit = "px",
  min,
  max,
  step = 1,
  labelClassName,
  inputClassName,
  hideIcon = true,
}: {
  label: string;
  value: string;
  placeholder?: number;
  onChange: (value: number) => void;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  labelClassName?: string;
  inputClassName?: string;
  hideIcon?: boolean;
}) {
  return (
    <ScrubInput
      label={label}
      icon={hideIcon ? EmptyScrubIcon : undefined}
      value={value ? parseNumericValue(value) : (placeholder ?? 0)}
      onChange={onChange}
      unit={unit}
      min={min}
      max={max}
      step={step}
      precision={1}
      className="gap-0"
      labelClassName={cn(
        "h-6 w-7 justify-center gap-0 rounded-l-md border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[11px] tabular-nums",
        labelClassName,
      )}
      inputClassName={cn(
        "h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]",
        inputClassName,
      )}
    />
  );
}

function commitStylePatch(
  styles: Record<string, string>,
  onStyleChange: (property: string, value: string) => void,
  onStylesChange?: (styles: Record<string, string>) => void,
) {
  if (onStylesChange) {
    onStylesChange(styles);
    return;
  }
  Object.entries(styles).forEach(([property, value]) => {
    onStyleChange(property, value);
  });
}

function optionValue<T extends readonly { value: string }[]>(
  options: T,
  value: string | undefined,
  fallback: T[number]["value"],
) {
  return options.some((option) => option.value === value) ? value! : fallback;
}

function cssLengthNumber(value: string | undefined, fallback = 0): number {
  const parsed = parseFloat(value || "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cssColorOrFallback(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized === "transparent" ||
    normalized === "rgba(0, 0, 0, 0)"
  ) {
    return fallback;
  }
  return normalized;
}

function strokeIsVisible(width: string | undefined, style: string | undefined) {
  return cssLengthNumber(width) > 0 && style !== "none";
}

function swatchStyle(value: string | undefined) {
  return {
    background:
      value && value !== "none"
        ? value
        : "linear-gradient(135deg, hsl(var(--muted)) 0 45%, hsl(var(--border)) 45% 55%, hsl(var(--muted)) 55% 100%)",
  };
}

function compactCssValue(value: string | undefined, fallback: string) {
  const normalized = value?.trim();
  if (!normalized || normalized === "none") return fallback;
  return normalized;
}

function colorHasVisibleAlpha(value: string | undefined): boolean {
  const parsed = parseCssColor(value || "");
  if (!parsed) return Boolean(value && value !== "transparent");
  return parsed.a > 0;
}

function inspectorObjectTitle(element: ElementInfo): string {
  const tag = element.tagName || "element";
  if (TEXT_TAGS.has(tag)) return "Text";
  if (tag === "section") return "Section";
  if (tag === "img" || tag === "video" || tag === "picture") return "Image";
  if (tag === "button" || tag === "a") return "Button";
  if (tag === "svg" || tag === "path") return "Vector";
  if (element.isFlexContainer || tag === "div" || tag === "main") {
    return "Frame";
  }
  return tag.charAt(0).toUpperCase() + tag.slice(1);
}

function displayLabel(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized || normalized === "normal") return "flow";
  return normalized;
}

function justifyToHorizontal(
  value: string | undefined,
): AlignmentMatrixValue["horizontal"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end" || value === "right") {
    return "right";
  }
  return "left";
}

function alignToVertical(
  value: string | undefined,
): AlignmentMatrixValue["vertical"] {
  if (value === "center") return "middle";
  if (value === "flex-end" || value === "end" || value === "bottom") {
    return "bottom";
  }
  return "top";
}

function horizontalToJustify(
  value: AlignmentMatrixValue["horizontal"],
): string {
  if (value === "center") return "center";
  if (value === "right") return "flex-end";
  return "flex-start";
}

function verticalToAlign(value: AlignmentMatrixValue["vertical"]): string {
  if (value === "middle") return "center";
  if (value === "bottom") return "flex-end";
  return "flex-start";
}

function autoLayoutAlignmentFromStyles(
  styles: Record<string, string>,
  direction: AutoLayoutMatrixValue["direction"],
): AlignmentMatrixValue {
  if (direction === "vertical") {
    return {
      horizontal: justifyToHorizontal(styles.alignItems),
      vertical: alignToVertical(styles.justifyContent),
    };
  }
  return {
    horizontal: justifyToHorizontal(styles.justifyContent),
    vertical: alignToVertical(styles.alignItems),
  };
}

/**
 * Block-level container tags that act like Figma frames. Selecting any of
 * these shows the Auto layout section (in an "add" state when not yet flex),
 * mirroring Figma where any frame/container exposes auto-layout controls.
 */
const CONTAINER_TAGS = new Set([
  "div",
  "section",
  "main",
  "header",
  "footer",
  "nav",
  "article",
  "aside",
  "form",
  "ul",
  "ol",
  "figure",
  "fieldset",
  "details",
  "dialog",
  "blockquote",
  "table",
  "tbody",
  "thead",
  "tr",
]);

/** Leaf tags that never get auto-layout (text, media, vectors, controls). */
const LEAF_TAGS = new Set([
  "img",
  "video",
  "picture",
  "audio",
  "canvas",
  "svg",
  "path",
  "input",
  "textarea",
  "select",
  "br",
  "hr",
  "iframe",
]);

/**
 * Whether the element should expose the Auto layout section. True for anything
 * already laid out with flexbox, or any block-level container tag that isn't a
 * known leaf/text element. This is what makes a plain frame/container with
 * children show the full Auto layout section like Figma does.
 */
function isContainerElement(element: ElementInfo): boolean {
  if (element.isFlexContainer) return true;
  const tag = (element.tagName || "").toLowerCase();
  if (TEXT_TAGS.has(tag) || LEAF_TAGS.has(tag)) return false;
  return CONTAINER_TAGS.has(tag);
}

function isParentFlex(element: ElementInfo): boolean {
  return (
    element.isFlexChild ||
    Boolean(element.parentDisplay?.toLowerCase().includes("flex"))
  );
}

function isParentGrid(element: ElementInfo): boolean {
  return Boolean(element.parentDisplay?.toLowerCase().includes("grid"));
}

function parentFlexDirection(element: ElementInfo): AutoLayoutSizingAxis {
  return element.parentLayout?.flexDirection?.includes("column")
    ? "vertical"
    : "horizontal";
}

function isTextElement(element: ElementInfo): boolean {
  return TEXT_TAGS.has((element.tagName || "").toLowerCase());
}

/**
 * Per-axis sizing availability following Figma's contextual rules:
 *   - Fixed: always.
 *   - Hug contents: only CONTAINERS (flex/container frames) and TEXT can hug
 *     their content. Leaves like img/svg/input cannot.
 *   - Fill container: only when the element is a CHILD of a flex/grid (auto
 *     layout) parent, OR a block-flow child (which fills via width:100%).
 * Hug applies to width and height independently; the same set is offered on
 * both axes here and the per-axis CSS in `commitElementSizing` resolves the
 * exact behavior (main-axis grow vs cross-axis stretch).
 */
function availableSizingForElement(
  element: ElementInfo,
): Partial<Record<AutoLayoutSizingAxis, AutoLayoutSizing[]>> {
  const canHug = isContainerElement(element) || isTextElement(element);
  const isFlexChildEl = isParentFlex(element) || isParentGrid(element);
  // Block-flow children can still "fill" via width:100% on the horizontal axis.
  const isBlockChild = Boolean(element.parentDisplay) && !isFlexChildEl;

  const buildAxis = (axis: AutoLayoutSizingAxis): AutoLayoutSizing[] => {
    const options: AutoLayoutSizing[] = ["fixed"];
    if (canHug) options.push("hug");
    // Fill: flex/grid child on either axis; block child only fills width.
    if (isFlexChildEl || (isBlockChild && axis === "horizontal")) {
      options.push("fill");
    }
    return options;
  };

  return {
    horizontal: buildAxis("horizontal"),
    vertical: buildAxis("vertical"),
  };
}

/** Read the currently-set min/max constraints (px) for a sizing axis. */
function readElementMinMax(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): { min: number | null; max: number | null } {
  const styles = element.computedStyles;
  const minRaw = axis === "horizontal" ? styles.minWidth : styles.minHeight;
  const maxRaw = axis === "horizontal" ? styles.maxWidth : styles.maxHeight;
  return {
    min: parseConstraintLength(minRaw),
    max: parseConstraintLength(maxRaw),
  };
}

/**
 * Parse a min/max CSS length into a px number, or null when unset. Browser
 * computed values are "0px"/"none" for the defaults — both read as "not set"
 * so we don't surface a constraint sub-row the user never added.
 */
function parseConstraintLength(value: string | undefined): number | null {
  const normalized = value?.trim().toLowerCase();
  if (
    !normalized ||
    normalized === "none" ||
    normalized === "auto" ||
    normalized === "0px" ||
    normalized === "0"
  ) {
    return null;
  }
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Commit a single min/max constraint (px) or clear it when value is null. */
function commitElementMinMax(
  axis: AutoLayoutSizingAxis,
  kind: "min" | "max",
  value: number | null,
  onStyleChange: (property: string, value: string) => void,
) {
  const isHorizontal = axis === "horizontal";
  const property =
    kind === "min"
      ? isHorizontal
        ? "minWidth"
        : "minHeight"
      : isHorizontal
        ? "maxWidth"
        : "maxHeight";
  if (value == null) {
    // Clearing: min → 0 (CSS initial), max → none (CSS initial).
    onStyleChange(property, kind === "min" ? "0px" : "none");
    return;
  }
  onStyleChange(property, `${Math.max(0, Math.round(value))}px`);
}

function inferElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): AutoLayoutSizing {
  const styles = element.computedStyles;
  const size = axis === "horizontal" ? styles.width : styles.height;
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const isCrossFlexAxis = isFlex && parentDirection !== axis;
  const alignSelf = (styles.alignSelf || "").toLowerCase();

  if (
    size === "100%" ||
    (isMainFlexAxis && Number.parseFloat(styles.flexGrow || "0") > 0) ||
    (isCrossFlexAxis && alignSelf === "stretch")
  ) {
    return "fill";
  }
  if (size === "auto" || size === "fit-content" || size === "max-content") {
    return "hug";
  }
  return "fixed";
}

function commitElementSizing(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
  sizing: AutoLayoutSizing,
  onStyleChange: (property: string, value: string) => void,
  onStylesChange?: (styles: Record<string, string>) => void,
) {
  const isHorizontal = axis === "horizontal";
  const sizeProperty = isHorizontal ? "width" : "height";
  const resolvedSize = Math.max(
    1,
    Math.round(
      isHorizontal ? element.boundingRect.width : element.boundingRect.height,
    ),
  );
  const parentDirection = parentFlexDirection(element);
  const isFlex = isParentFlex(element);
  const isGrid = isParentGrid(element);
  const isMainFlexAxis = isFlex && parentDirection === axis;
  const patch: Record<string, string> = {};

  if (sizing === "fixed") {
    // Fixed → explicit px dimension. Reset any grow/stretch on the flex
    // main-axis so the pixel value sticks.
    patch[sizeProperty] = `${resolvedSize}px`;
    if (isMainFlexAxis) {
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    }
  } else if (sizing === "hug") {
    // Hug contents → shrink to fit children/content.
    patch[sizeProperty] = "fit-content";
    if (isMainFlexAxis) {
      // A flex container hugging on its main axis uses flex-basis:auto + no
      // stretch (spec: "flex-basis: auto + no stretch").
      patch.flexGrow = "0";
      patch.flexShrink = "0";
      patch.flexBasis = "auto";
    }
  } else {
    // Fill container.
    if (isMainFlexAxis) {
      // Parent main axis → grow into available space: flex: 1 0 0.
      patch.flexGrow = "1";
      patch.flexShrink = "0";
      patch.flexBasis = "0";
      // Clear any explicit dimension so flex-basis governs.
      patch[sizeProperty] = "auto";
    } else if (isFlex) {
      // Parent cross axis → stretch to the parent's cross size.
      patch.alignSelf = "stretch";
      patch[sizeProperty] = "auto";
    } else if (isGrid) {
      patch[isHorizontal ? "justifySelf" : "alignSelf"] = "stretch";
      patch[sizeProperty] = "auto";
    } else {
      // Child of a non-flex (block) parent → fill width with 100%.
      patch[sizeProperty] = "100%";
    }
  }

  commitStylePatch(patch, onStyleChange, onStylesChange);
}

function elementTypeIcon(element: ElementInfo) {
  const tag = element.tagName || "element";
  if (TEXT_TAGS.has(tag)) return IconTypography;
  if (tag === "img" || tag === "video" || tag === "picture") return IconPhoto;
  if (tag === "svg" || tag === "path") return IconVector;
  if (tag === "button" || tag === "a") return IconComponents;
  return IconFrame;
}

function SelectionHeader({ element }: { element: ElementInfo | null }) {
  if (!element) return null;

  const title = inspectorObjectTitle(element);
  const TypeIcon = elementTypeIcon(element);

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
      {/* M3 · Node-type label + rename/type dropdown affordance (▾) */}
      <button
        type="button"
        className="flex min-w-0 items-center gap-1.5 bg-transparent text-left text-[13px] font-semibold text-foreground"
      >
        <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{title}</span>
        <IconChevronDown className="size-2.5 shrink-0 text-muted-foreground" />
      </button>
      {/* M3 · Right-aligned quick actions: create-component + dev inspect (</>) */}
      <div className="flex shrink-0 items-center gap-0.5">
        <SectionIconButton
          label={"Create component" /* i18n-ignore Figma inspector action */}
        >
          <IconComponents className="size-3.5" />
        </SectionIconButton>
        <SectionIconButton
          label={"Inspect code" /* i18n-ignore Figma inspector action */}
        >
          <IconCode className="size-3.5" />
        </SectionIconButton>
      </div>
    </div>
  );
}

function InspectorTabsHeader({
  activeTab,
  onActiveTabChange,
  trailing,
}: {
  activeTab: InspectorTab;
  onActiveTabChange: (tab: InspectorTab) => void;
  trailing?: ReactNode;
}) {
  const t = useT();

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-1 border-b border-border/90 px-2">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as InspectorTab)}
      >
        <TabsList className="h-7 justify-start gap-0.5 rounded-none bg-transparent p-0">
          <TabsTrigger
            value="design"
            className="h-6 rounded-md px-1.5 text-[11px] font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {"Design" /* i18n-ignore Figma inspector tab */}
          </TabsTrigger>
          <TabsTrigger
            value="tweaks"
            className="h-6 rounded-md px-1.5 text-[11px] font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t("designEditor.tweaks")}
          </TabsTrigger>
          <TabsTrigger
            value="extensions"
            className="h-6 rounded-md px-1.5 text-[11px] font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {t("designEditor.extensions")}
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {trailing ? <div className="shrink-0">{trailing}</div> : null}
    </div>
  );
}

function SectionIconButton({
  label,
  onClick,
  children,
  disabled = false,
  className,
}: {
  label: string;
  onClick?: () => void;
  children: ReactNode;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed",
            className,
          )}
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * Section-header toggle icon (Figma's right-aligned section actions, e.g. the
 * auto-layout ⊞ toggle). Highlights with the accent color when active.
 */
function SectionIconToggle({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={active}
          onClick={onClick}
          className={cn(
            "size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground",
            active &&
              "bg-[var(--design-editor-accent-color)]/15 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
          )}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InspectorIconButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "h-6 min-w-6 cursor-pointer rounded-none border-r border-border/50 text-muted-foreground first:rounded-l-md last:rounded-r-md last:border-r-0 hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground disabled:cursor-not-allowed",
            active &&
              "bg-[var(--design-editor-panel-bg)] text-[var(--design-editor-accent-color)] shadow-[inset_0_0_0_1px_var(--design-editor-control-border)]",
          )}
          onClick={onClick}
          aria-label={label}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function InspectorSegment({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
      {children}
    </div>
  );
}

function CornerRadiusControl({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const independentCornersLabel = t("editPanel.labels.independentCorners");
  const radius = cssLengthNumber(styles.borderRadius || "0");
  const corners = {
    topLeft: cssLengthNumber(styles.borderTopLeftRadius || styles.borderRadius),
    topRight: cssLengthNumber(
      styles.borderTopRightRadius || styles.borderRadius,
    ),
    bottomRight: cssLengthNumber(
      styles.borderBottomRightRadius || styles.borderRadius,
    ),
    bottomLeft: cssLengthNumber(
      styles.borderBottomLeftRadius || styles.borderRadius,
    ),
  };

  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-1.5">
      <ScrubInput
        label={t("editPanel.labels.cornerRadius")}
        value={radius}
        onChange={(value) =>
          onStyleChange("borderRadius", `${Math.max(0, Math.round(value))}px`)
        }
        unit="px"
        min={0}
        precision={1}
        labelClassName="w-24"
        inputClassName="h-6"
      />
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="size-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]"
                aria-label={independentCornersLabel}
              >
                <IconMaximize className="size-3.5" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{independentCornersLabel}</TooltipContent>
        </Tooltip>
        <PopoverContent
          side="left"
          align="start"
          sideOffset={8}
          className="w-64 p-3"
        >
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">
              {independentCornersLabel}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <ScrubInput
                label={t("editPanel.labels.topLeft")}
                value={corners.topLeft}
                onChange={(value) =>
                  onStyleChange(
                    "borderTopLeftRadius",
                    `${Math.max(0, Math.round(value))}px`,
                  )
                }
                unit="px"
                min={0}
                precision={1}
                inputClassName="h-6"
              />
              <ScrubInput
                label={t("editPanel.labels.topRight")}
                value={corners.topRight}
                onChange={(value) =>
                  onStyleChange(
                    "borderTopRightRadius",
                    `${Math.max(0, Math.round(value))}px`,
                  )
                }
                unit="px"
                min={0}
                precision={1}
                inputClassName="h-6"
              />
              <ScrubInput
                label={t("editPanel.labels.bottomLeft")}
                value={corners.bottomLeft}
                onChange={(value) =>
                  onStyleChange(
                    "borderBottomLeftRadius",
                    `${Math.max(0, Math.round(value))}px`,
                  )
                }
                unit="px"
                min={0}
                precision={1}
                inputClassName="h-6"
              />
              <ScrubInput
                label={t("editPanel.labels.bottomRight")}
                value={corners.bottomRight}
                onChange={(value) =>
                  onStyleChange(
                    "borderBottomRightRadius",
                    `${Math.max(0, Math.round(value))}px`,
                  )
                }
                unit="px"
                min={0}
                precision={1}
                inputClassName="h-6"
              />
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

type StrokeLayerKind = "border" | "outline";

function StrokeLayerControl({
  kind,
  visible,
  color,
  width,
  styleValue,
  onStyleChange,
  onRemove,
}: {
  kind: StrokeLayerKind;
  visible: boolean;
  color: string;
  width: string;
  styleValue: string;
  onStyleChange: (property: string, value: string) => void;
  onRemove: () => void;
}) {
  const t = useT();
  const strokePositionOptions = STROKE_POSITION_OPTIONS.map((option) => ({
    value: option.value,
    label:
      option.key === "center"
        ? t("editPanel.textAligns.center")
        : t(`editPanel.labels.${option.key}`),
  }));
  const prefix = kind === "border" ? "border" : "outline";
  const position = kind === "border" ? "inside" : "outside";

  const movePosition = (next: string) => {
    if (next === position) return;
    const nextPrefix = next === "outside" ? "outline" : "border";
    onStyleChange(`${nextPrefix}Color`, color);
    onStyleChange(`${nextPrefix}Width`, width || "1px");
    onStyleChange(
      `${nextPrefix}Style`,
      styleValue === "none" ? "solid" : styleValue,
    );
    onRemove();
  };

  return (
    <div className="space-y-1.5">
      {/* Figma stroke row: [swatch+hex trigger (flex-1)] [eye] [remove] */}
      <div className="group flex items-center gap-1.5">
        <div className="min-w-0 flex-1">
          <ColorInput
            label=""
            value={cssColorOrFallback(color, "#000000")}
            onChange={(value) => onStyleChange(`${prefix}Color`, value)}
          />
        </div>
        <SectionIconButton
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          label={
            visible
              ? t("editPanel.labels.hideLayer")
              : t("editPanel.labels.showLayer")
          }
          onClick={() => {
            if (visible) {
              onStyleChange(`${prefix}Style`, "none");
              return;
            }
            onStyleChange(`${prefix}Style`, "solid");
            onStyleChange(
              `${prefix}Width`,
              width === "0px" ? "1px" : width || "1px",
            );
          }}
        >
          {visible ? (
            <IconEye className="size-3.5" />
          ) : (
            <IconEyeOff className="size-3.5" />
          )}
        </SectionIconButton>
        <SectionIconButton
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          label={t("editPanel.labels.removeLayer")}
          onClick={onRemove}
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
      </div>
      {/* Figma stroke geometry: position + weight side by side */}
      <div className="grid grid-cols-2 gap-1.5">
        <Select value={position} onValueChange={movePosition}>
          <SelectTrigger className="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {strokePositionOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="text-[11px]"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScrubInput
          label={t("editPanel.labels.weight")}
          ariaLabel={t("editPanel.labels.weight")}
          icon={IconBorderStyle}
          value={cssLengthNumber(width)}
          onChange={(value) =>
            onStyleChange(
              `${prefix}Width`,
              `${Math.max(0, Math.round(value))}px`,
            )
          }
          unit="px"
          min={0}
          precision={1}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>
    </div>
  );
}

interface ShadowLayer {
  id: string;
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
  inset: boolean;
}

function defaultDropShadowLayer(index: number): ShadowLayer {
  return {
    id: `shadow-${index}`,
    x: 0,
    y: 4,
    blur: 12,
    spread: 0,
    color: "rgba(0, 0, 0, 0.25)",
    inset: false,
  };
}

function parseShadowLayers(value: string | undefined): ShadowLayer[] {
  return splitCssLayers(value || "")
    .filter((layer) => layer && layer !== "none")
    .map((layer, index) => parseShadowLayer(layer, index));
}

function parseShadowLayer(layer: string, index: number): ShadowLayer {
  const tokens = splitCssTokens(layer);
  const inset = tokens.includes("inset");
  const colorToken =
    tokens.find((token) => parseCssColor(token) || token === "transparent") ||
    "rgba(0, 0, 0, 0.25)";
  const numericTokens = tokens
    .filter((token) => token !== "inset" && token !== colorToken)
    .map((token) => parseFloat(token))
    .filter((value) => Number.isFinite(value));

  return {
    id: `shadow-${index}`,
    x: numericTokens[0] ?? 0,
    y: numericTokens[1] ?? 4,
    blur: numericTokens[2] ?? 12,
    spread: numericTokens[3] ?? 0,
    color: colorToken,
    inset,
  };
}

function splitCssTokens(value: string): string[] {
  const tokens: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      const token = value.slice(start, index).trim();
      if (token) tokens.push(token);
      start = index + 1;
    }
  }
  const finalToken = value.slice(start).trim();
  if (finalToken) tokens.push(finalToken);
  return tokens;
}

function serializeShadowLayers(layers: ShadowLayer[]) {
  if (!layers.length) return "none";
  return layers
    .map((layer) =>
      [
        layer.inset ? "inset" : "",
        `${Math.round(layer.x)}px`,
        `${Math.round(layer.y)}px`,
        `${Math.max(0, Math.round(layer.blur))}px`,
        `${Math.max(0, Math.round(layer.spread))}px`,
        layer.color,
      ]
        .filter(Boolean)
        .join(" "),
    )
    .join(", ");
}

function readBlurFilter(value: string | undefined): number {
  const match = value?.match(/blur\((-?\d+(?:\.\d+)?)px\)/);
  return match ? Math.max(0, Number(match[1])) : 0;
}

function ShadowEffectRow({
  layer,
  index,
  onChange,
  onRemove,
}: {
  layer: ShadowLayer;
  index: number;
  onChange: (patch: Partial<ShadowLayer>) => void;
  onRemove: () => void;
}) {
  const t = useT();
  return (
    <Popover>
      {/* Figma effect row: [swatch+label+x,y,blur trigger (flex-1)] [remove] */}
      <div className="group flex items-center gap-1.5">
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
          >
            <span
              className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
              style={swatchStyle(layer.color)}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground">
              {index === 0
                ? t("editPanel.labels.dropShadow")
                : `${t("editPanel.labels.dropShadow")} ${index + 1}`}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(layer.x)}, {Math.round(layer.y)},{" "}
              {Math.round(layer.blur)}
            </span>
          </button>
        </PopoverTrigger>
        <SectionIconButton
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
          label={t("editPanel.labels.removeLayer")}
          onClick={onRemove}
        >
          <IconMinus className="size-3.5" />
        </SectionIconButton>
      </div>
      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-72 p-3"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-foreground">
              {t("editPanel.labels.dropShadow")}
            </p>
            <button
              type="button"
              className={cn(
                "rounded border px-2 py-1 text-[11px]",
                layer.inset
                  ? "border-[var(--design-editor-accent-color)] bg-[var(--design-editor-selection-color)] text-foreground"
                  : "border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground",
              )}
              onClick={() => onChange({ inset: !layer.inset })}
            >
              {t("editPanel.labels.innerShadow")}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <ScrubInput
              label="X"
              value={layer.x}
              onChange={(value) => onChange({ x: value })}
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label="Y"
              value={layer.y}
              onChange={(value) => onChange({ y: value })}
              unit="px"
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label={t("editPanel.labels.blur")}
              value={layer.blur}
              onChange={(value) => onChange({ blur: Math.max(0, value) })}
              unit="px"
              min={0}
              precision={1}
              inputClassName="h-6"
            />
            <ScrubInput
              label={t("editPanel.labels.spread")}
              value={layer.spread}
              onChange={(value) => onChange({ spread: Math.max(0, value) })}
              unit="px"
              min={0}
              precision={1}
              inputClassName="h-6"
            />
          </div>
          <ColorInput
            label={t("editPanel.labels.color")}
            value={cssColorOrFallback(layer.color, "rgba(0, 0, 0, 0.25)")}
            onChange={(value) => onChange({ color: value })}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Page-level properties when nothing is selected */
function PageProperties({
  styles,
  onStyleChange,
}: {
  styles: Record<string, string>;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontFamily = FONT_FAMILY_OPTIONS.some(
    (option) => option.value === styles.fontFamily,
  )
    ? styles.fontFamily
    : "sans-serif";

  return (
    <div>
      <PanelSection title={t("editPanel.sections.page")}>
        <ColorInput
          label={t("editPanel.labels.background")}
          value={styles.backgroundColor || ""}
          onChange={(v) => onStyleChange("backgroundColor", v)}
          backgroundImage={styles.backgroundImage || ""}
          onBackgroundImageChange={(v) => onStyleChange("backgroundImage", v)}
          blendMode={styles.backgroundBlendMode || "normal"}
          onBlendModeChange={(v) => onStyleChange("backgroundBlendMode", v)}
          supportsLayeredFills
        />
        <PropSelect
          label={t("editPanel.labels.font")}
          value={fontFamily}
          onChange={(v) => onStyleChange("fontFamily", v)}
          options={fontFamilyOptions}
        />
        <PropInput
          label={t("editPanel.labels.baseSize")}
          value={styles.fontSize || "16px"}
          onChange={(v) => onStyleChange("fontSize", v)}
          placeholder="16px"
          defaultUnit="px"
        />
      </PanelSection>
    </div>
  );
}

/** Text element properties */
function TypographyProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontWeightOptions = FONT_WEIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontWeights.${option.key}`),
  }));
  const textAlign = styles.textAlign || "left";

  // M1 · Text resizing mode (auto-width / auto-height / fixed). Figma's text
  // nodes always expose this segment. Infer the current mode from the live CSS:
  // auto-width hugs both axes (width:auto + no wrapping), auto-height hugs the
  // height only (fixed width, content wraps), fixed pins both width and height.
  const widthIsAuto =
    !styles.width || styles.width === "auto" || styles.width === "max-content";
  const heightIsAuto = !styles.height || styles.height === "auto";
  const noWrap = styles.whiteSpace === "nowrap";
  const resizeMode: "auto-width" | "auto-height" | "fixed" =
    widthIsAuto && noWrap
      ? "auto-width"
      : !heightIsAuto && !widthIsAuto
        ? "fixed"
        : "auto-height";
  const currentWidth = styles.width && !widthIsAuto ? styles.width : "200px";
  const currentHeight = styles.height && !heightIsAuto ? styles.height : "48px";
  const setResizeMode = (mode: "auto-width" | "auto-height" | "fixed") => {
    if (mode === "auto-width") {
      onStyleChange("width", "auto");
      onStyleChange("height", "auto");
      onStyleChange("whiteSpace", "nowrap");
    } else if (mode === "auto-height") {
      onStyleChange("width", currentWidth);
      onStyleChange("height", "auto");
      onStyleChange("whiteSpace", "normal");
    } else {
      onStyleChange("width", currentWidth);
      onStyleChange("height", currentHeight);
      onStyleChange("whiteSpace", "normal");
    }
  };

  // M2 · Vertical text alignment (top / middle / bottom). For auto-layout text
  // containers (display:flex) Figma maps this to `justifyContent`; for normal
  // text we fall back to `verticalAlign`, which is what an inline/grid text box
  // honors. Read whichever the element currently expresses.
  const display = (styles.display || "").toLowerCase();
  const isFlexText = display.includes("flex");
  const verticalAlign = isFlexText
    ? styles.justifyContent === "center"
      ? "middle"
      : styles.justifyContent === "flex-end"
        ? "bottom"
        : "top"
    : styles.verticalAlign === "middle"
      ? "middle"
      : styles.verticalAlign === "bottom"
        ? "bottom"
        : "top";
  const setVerticalAlign = (mode: "top" | "middle" | "bottom") => {
    if (isFlexText) {
      onStyleChange(
        "justifyContent",
        mode === "middle"
          ? "center"
          : mode === "bottom"
            ? "flex-end"
            : "flex-start",
      );
    } else {
      onStyleChange("verticalAlign", mode);
    }
  };

  return (
    <PanelSection title={t("editPanel.sections.typography")}>
      {/* Row 0: text resizing (auto-width / auto-height / fixed) */}
      <InspectorSegment>
        <InspectorIconButton
          label={"Auto width" /* i18n-ignore Figma text-resize mode */}
          active={resizeMode === "auto-width"}
          onClick={() => setResizeMode("auto-width")}
        >
          <IconArrowAutofitWidth className="size-3.5" />
        </InspectorIconButton>
        <InspectorIconButton
          label={"Auto height" /* i18n-ignore Figma text-resize mode */}
          active={resizeMode === "auto-height"}
          onClick={() => setResizeMode("auto-height")}
        >
          <IconArrowAutofitHeight className="size-3.5" />
        </InspectorIconButton>
        <InspectorIconButton
          label={"Fixed size" /* i18n-ignore Figma text-resize mode */}
          active={resizeMode === "fixed"}
          onClick={() => setResizeMode("fixed")}
        >
          <IconSquare className="size-3.5" />
        </InspectorIconButton>
      </InspectorSegment>

      {/* Row 1: font family full-width */}
      <Select
        value={styles.fontFamily || "sans-serif"}
        onValueChange={(v) => onStyleChange("fontFamily", v)}
      >
        <SelectTrigger className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {fontFamilyOptions.map((opt) => (
            <SelectItem
              key={opt.value}
              value={opt.value}
              className="text-[11px]"
            >
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Row 2: weight + size side by side */}
      <div className="grid grid-cols-2 gap-1.5">
        <Select
          value={styles.fontWeight || "400"}
          onValueChange={(v) => onStyleChange("fontWeight", v)}
        >
          <SelectTrigger className="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {fontWeightOptions.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="text-[11px]"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ScrubInput
          label={t("editPanel.labels.size")}
          ariaLabel={t("editPanel.labels.size")}
          icon={IconLetterCase}
          value={styles.fontSize ? parseNumericValue(styles.fontSize) : 16}
          onChange={(value) =>
            onStyleChange("fontSize", `${Math.max(1, Math.round(value))}px`)
          }
          unit="px"
          min={1}
          precision={1}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>

      {/* Row 3: line-height + letter-spacing with Figma-style leading icons */}
      <div className="grid grid-cols-2 gap-1.5">
        <ScrubInput
          label={t("editPanel.labels.lineHeight")}
          ariaLabel={t("editPanel.labels.lineHeight")}
          icon={IconLineHeight}
          value={parseNumericValue(styles.lineHeight || "1.2")}
          onChange={(value) =>
            onStyleChange("lineHeight", String(Math.max(0.1, value)))
          }
          min={0.1}
          step={0.1}
          precision={2}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
        <ScrubInput
          label={t("editPanel.labels.tracking")}
          ariaLabel={t("editPanel.labels.tracking")}
          icon={IconLetterSpacing}
          value={
            styles.letterSpacing ? parseNumericValue(styles.letterSpacing) : 0
          }
          onChange={(value) => onStyleChange("letterSpacing", `${value}px`)}
          unit="px"
          precision={1}
          className="gap-0"
          labelClassName="h-6 w-6 justify-center gap-0 rounded-l-md border border-r-0 border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-[11px] [&>span]:hidden"
          inputClassName="h-6 rounded-l-none rounded-r-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
        />
      </div>

      {/* Row 4: horizontal + vertical text alignment */}
      <div className="grid grid-cols-2 gap-1.5">
        <InspectorSegment>
          <InspectorIconButton
            label={t("editPanel.textAligns.left")}
            active={textAlign === "left" || textAlign === "start"}
            onClick={() => onStyleChange("textAlign", "left")}
          >
            <IconAlignLeft className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={t("editPanel.textAligns.center")}
            active={textAlign === "center"}
            onClick={() => onStyleChange("textAlign", "center")}
          >
            <IconAlignCenter className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={t("editPanel.textAligns.right")}
            active={textAlign === "right" || textAlign === "end"}
            onClick={() => onStyleChange("textAlign", "right")}
          >
            <IconAlignRight className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={t("editPanel.textAligns.justify")}
            active={textAlign === "justify"}
            onClick={() => onStyleChange("textAlign", "justify")}
          >
            <IconAlignJustified className="size-3.5" />
          </InspectorIconButton>
        </InspectorSegment>
        <InspectorSegment>
          <InspectorIconButton
            label={"Align top" /* i18n-ignore Figma vertical text align */}
            active={verticalAlign === "top"}
            onClick={() => setVerticalAlign("top")}
          >
            <IconLayoutAlignTop className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={"Align middle" /* i18n-ignore Figma vertical text align */}
            active={verticalAlign === "middle"}
            onClick={() => setVerticalAlign("middle")}
          >
            <IconLayoutAlignMiddle className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={"Align bottom" /* i18n-ignore Figma vertical text align */}
            active={verticalAlign === "bottom"}
            onClick={() => setVerticalAlign("bottom")}
          >
            <IconLayoutAlignBottom className="size-3.5" />
          </InspectorIconButton>
        </InspectorSegment>
      </div>
    </PanelSection>
  );
}

/** Flex container properties */
function FlexContainerControls({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  // The element's CURRENT layout flow as authored in code, read from its own
  // computed `display`: block/flow-root/grid/etc. = "normal flow",
  // flex/inline-flex = auto layout. We forward it so the AutoLayoutMatrix Flow
  // control can show the right state (normal vs horizontal/vertical/wrap)
  // instead of an empty "add" affordance.
  const display = (styles.display || "").toLowerCase();
  const isFlex = display.includes("flex");
  const flexDirection: AutoLayoutMatrixValue["direction"] =
    styles.flexDirection?.includes("column") ? "vertical" : "horizontal";
  // When the element is in normal flow (not flex yet), picking any flow option
  // must first turn it into a flex container; otherwise setting flex-direction
  // alone is a no-op against a block element.
  const ensureFlex = () => {
    if (!isFlex) onStyleChange("display", "flex");
  };
  const padding = {
    top: parseNumericValue(styles.paddingTop || "0"),
    right: parseNumericValue(styles.paddingRight || "0"),
    bottom: parseNumericValue(styles.paddingBottom || "0"),
    left: parseNumericValue(styles.paddingLeft || "0"),
  };
  const allPaddingEqual =
    padding.top === padding.right &&
    padding.top === padding.bottom &&
    padding.top === padding.left;
  const [paddingLinked, setPaddingLinked] = useState(allPaddingEqual);

  useEffect(() => {
    if (!allPaddingEqual && paddingLinked) setPaddingLinked(false);
  }, [allPaddingEqual, paddingLinked]);

  const autoLayoutValue: AutoLayoutMatrixValue = {
    direction: flexDirection,
    wrap: styles.flexWrap === "wrap" ? "wrap" : "nowrap",
    alignment: autoLayoutAlignmentFromStyles(styles, flexDirection),
    gap: parseNumericValue(styles.gap || "0"),
    padding,
    paddingLinked,
    childSizing: {
      horizontal: inferElementSizing(element, "horizontal"),
      vertical: inferElementSizing(element, "vertical"),
    },
    childMinMax: {
      horizontal: readElementMinMax(element, "horizontal"),
      vertical: readElementMinMax(element, "vertical"),
    },
    clipContent: styles.overflow === "hidden",
    resolvedSize: {
      horizontal: element.boundingRect.width,
      vertical: element.boundingRect.height,
    },
    // Forward the raw CSS display so the matrix can render the correct Flow
    // state (normal flow for block/grid, flex for flex/inline-flex). Added as an
    // optional contract field consumed by AutoLayoutMatrix; harmless when the
    // matrix ignores it.
    ...({ display } as Partial<AutoLayoutMatrixValue>),
  };

  return (
    <div className="space-y-2">
      <AutoLayoutMatrix
        value={autoLayoutValue}
        onDirectionChange={(direction) => {
          ensureFlex();
          onStyleChange(
            "flexDirection",
            direction === "vertical" ? "column" : "row",
          );
        }}
        onWrapChange={(wrap) => {
          ensureFlex();
          onStyleChange("flexWrap", wrap);
        }}
        onAlignmentChange={(alignment) => {
          if (autoLayoutValue.direction === "vertical") {
            onStyleChange(
              "alignItems",
              horizontalToJustify(alignment.horizontal),
            );
            onStyleChange(
              "justifyContent",
              verticalToAlign(alignment.vertical),
            );
            return;
          }
          onStyleChange(
            "justifyContent",
            horizontalToJustify(alignment.horizontal),
          );
          onStyleChange("alignItems", verticalToAlign(alignment.vertical));
        }}
        onGapChange={(gap) => onStyleChange("gap", `${gap}px`)}
        onPaddingChange={(nextPadding) => {
          onStyleChange("paddingTop", `${nextPadding.top}px`);
          onStyleChange("paddingRight", `${nextPadding.right}px`);
          onStyleChange("paddingBottom", `${nextPadding.bottom}px`);
          onStyleChange("paddingLeft", `${nextPadding.left}px`);
        }}
        onPaddingLinkedChange={(linked) => {
          setPaddingLinked(linked);
          if (!linked) return;
          onStyleChange("paddingTop", `${padding.top}px`);
          onStyleChange("paddingRight", `${padding.top}px`);
          onStyleChange("paddingBottom", `${padding.top}px`);
          onStyleChange("paddingLeft", `${padding.top}px`);
        }}
        onClipContentChange={(clipContent) =>
          onStyleChange("overflow", clipContent ? "hidden" : "visible")
        }
        onDistribute={(axis) => {
          const mainAxis =
            autoLayoutValue.direction === "horizontal"
              ? "horizontal"
              : "vertical";
          if (axis === mainAxis) {
            onStyleChange("justifyContent", "space-between");
          } else if (autoLayoutValue.wrap === "wrap") {
            onStyleChange("alignContent", "space-between");
          }
        }}
        availableChildSizing={availableSizingForElement(element)}
        onChildSizingChange={(axis, sizing) => {
          commitElementSizing(
            element,
            axis,
            sizing,
            onStyleChange,
            onStylesChange,
          );
        }}
        onChildMinMaxChange={(axis, kind, val) =>
          commitElementMinMax(axis, kind, val, onStyleChange)
        }
      />
    </div>
  );
}

function FlexChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const alignSelfOptions = ALIGN_SELF_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignSelfOptions.${option.key}`),
  }));

  return (
    <div className="space-y-2">
      <SubsectionLabel>{t("editPanel.layoutContext.child")}</SubsectionLabel>
      <PropInput
        label={t("editPanel.labels.flexGrow")}
        value={styles.flexGrow || ""}
        onChange={(v) => onStyleChange("flexGrow", v)}
        placeholder="0"
      />
      <PropInput
        label={t("editPanel.labels.flexShrink")}
        value={styles.flexShrink || ""}
        onChange={(v) => onStyleChange("flexShrink", v)}
        placeholder="1"
      />
      <PropInput
        label={t("editPanel.labels.flexBasis")}
        value={styles.flexBasis || ""}
        onChange={(v) => onStyleChange("flexBasis", v)}
        placeholder="auto"
        defaultUnit="px"
      />
      <PropInput
        label={t("editPanel.labels.order")}
        value={styles.order || ""}
        onChange={(v) => onStyleChange("order", v)}
        placeholder="0"
      />
      <PropSelect
        label={t("editPanel.labels.alignSelf")}
        value={optionValue(ALIGN_SELF_OPTIONS, styles.alignSelf, "auto")}
        onChange={(v) => onStyleChange("alignSelf", v)}
        options={alignSelfOptions}
      />
    </div>
  );
}

function GridChildControls({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const alignSelfOptions = ALIGN_SELF_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.alignSelfOptions.${option.key}`),
  }));

  return (
    <div className="space-y-2">
      <SubsectionLabel>
        {t("editPanel.layoutContext.gridChild")}
      </SubsectionLabel>
      <PropInput
        label={t("editPanel.labels.gridColumn")}
        value={styles.gridColumn || ""}
        onChange={(v) => onStyleChange("gridColumn", v)}
        placeholder="auto"
      />
      <PropInput
        label={t("editPanel.labels.gridRow")}
        value={styles.gridRow || ""}
        onChange={(v) => onStyleChange("gridRow", v)}
        placeholder="auto"
      />
      <PropSelect
        label={t("editPanel.labels.alignSelf")}
        value={optionValue(ALIGN_SELF_OPTIONS, styles.alignSelf, "auto")}
        onChange={(v) => onStyleChange("alignSelf", v)}
        options={alignSelfOptions}
      />
    </div>
  );
}

function LayoutContextProperties({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
}) {
  const t = useT();
  const flexChild = isParentFlex(element);
  const gridChild = isParentGrid(element);
  const availableSizing = availableSizingForElement(element);
  const isContainer = isContainerElement(element);

  const childControls = (
    <>
      {flexChild ? (
        <div className="border-t border-border/70 pt-2">
          <FlexChildControls element={element} onStyleChange={onStyleChange} />
        </div>
      ) : null}
      {gridChild ? (
        <div className="border-t border-border/70 pt-2">
          <GridChildControls element={element} onStyleChange={onStyleChange} />
        </div>
      ) : null}
    </>
  );

  // Leaf elements (text, img, svg, etc.) never get auto layout — show the plain
  // Figma W/H sizing block instead.
  if (!isContainer) {
    return (
      <PanelSection title={t("editPanel.sections.layout")}>
        {/* Figma-style single-row-per-axis: [W | value | Fixed/Hug/Fill ▾] with
            the full sizing menu (modes + min/max + variable) per axis. */}
        <div className="grid grid-cols-2 items-start gap-1.5">
          <SizingField
            axis="W"
            sizingAxis="horizontal"
            value={inferElementSizing(element, "horizontal")}
            resolvedSize={element.boundingRect.width}
            minMax={readElementMinMax(element, "horizontal")}
            options={availableSizing.horizontal ?? ["fixed"]}
            disabled={false}
            onChange={(mode) =>
              commitElementSizing(
                element,
                "horizontal",
                mode,
                onStyleChange,
                onStylesChange,
              )
            }
            onMinMaxChange={(axis, kind, val) =>
              commitElementMinMax(axis, kind, val, onStyleChange)
            }
          />
          <SizingField
            axis="H"
            sizingAxis="vertical"
            value={inferElementSizing(element, "vertical")}
            resolvedSize={element.boundingRect.height}
            minMax={readElementMinMax(element, "vertical")}
            options={availableSizing.vertical ?? ["fixed"]}
            disabled={false}
            onChange={(mode) =>
              commitElementSizing(
                element,
                "vertical",
                mode,
                onStyleChange,
                onStylesChange,
              )
            }
            onMinMaxChange={(axis, kind, val) =>
              commitElementMinMax(axis, kind, val, onStyleChange)
            }
          />
        </div>
        {childControls}
      </PanelSection>
    );
  }

  // Any container element ALREADY has a layout in code — normal flow (block) by
  // default, or flex when it uses flexbox. Figma never makes you "add" auto
  // layout for a frame, so we always render the full layout controls and let
  // the Flow control reflect/switch the element's current `display`. Choosing a
  // horizontal/vertical/wrap/grid flow applies `display:flex`; choosing the
  // normal-flow option resets to `display:block`.
  return (
    <PanelSection title={t("editPanel.sections.autoLayout")}>
      <FlexContainerControls
        element={element}
        onStyleChange={onStyleChange}
        onStylesChange={onStylesChange}
      />
      {childControls}
    </PanelSection>
  );
}

/**
 * Figma "Layout grid" / layout-guide section. Shown for frame/container
 * elements. Renders an overlay column/row guide by applying a non-destructive
 * `backgroundImage` repeating gradient layer tagged so it can be toggled off
 * without disturbing real fills.
 */
const LAYOUT_GUIDE_MARKER = "/* an-layout-guide */";

function hasLayoutGuide(styles: Record<string, string>): boolean {
  return Boolean(styles.backgroundImage?.includes("repeating-linear-gradient"));
}

function LayoutGuideProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const styles = element.computedStyles;
  const active = hasLayoutGuide(styles);

  const addGuide = () => {
    // 12-column overlay guide — Figma's default columns layout grid.
    const guide =
      "repeating-linear-gradient(to right, color-mix(in srgb, var(--design-editor-accent-color) 22%, transparent) 0 1px, transparent 1px calc(100% / 12))";
    const existing = compactCssValue(styles.backgroundImage, "");
    onStyleChange(
      "backgroundImage",
      existing ? `${guide}, ${existing}` : guide,
    );
  };

  const removeGuide = () => {
    const layers = splitCssLayers(styles.backgroundImage || "").filter(
      (layer) => !layer.includes("repeating-linear-gradient"),
    );
    onStyleChange(
      "backgroundImage",
      layers.length ? joinCssLayers(layers) : "none",
    );
  };

  return (
    <PanelSection
      title={"Layout guide" /* i18n-ignore Figma inspector label */}
      defaultCollapsed
      actions={
        <SectionIconButton
          label={
            active
              ? "Remove layout guide" /* i18n-ignore Figma inspector action */
              : "Add layout guide" /* i18n-ignore Figma inspector action */
          }
          onClick={active ? removeGuide : addGuide}
        >
          {active ? (
            <IconMinus className="size-3.5" />
          ) : (
            <IconPlus className="size-3.5" />
          )}
        </SectionIconButton>
      }
    >
      {active ? (
        <div className="flex items-center gap-2 rounded-md bg-[var(--design-editor-control-bg)] px-2 py-1.5 text-[11px] text-muted-foreground">
          <IconLayoutGrid className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-foreground">
            {"Columns" /* i18n-ignore Figma inspector label */}
          </span>
          <span className="shrink-0 tabular-nums">12</span>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {"No layout guides" /* i18n-ignore Figma inspector empty state */}
        </p>
      )}
    </PanelSection>
  );
}

/**
 * Togglable export preview thumbnail (Figma shows a small preview of the export
 * frame above the export rows). Renders a proportional placeholder reflecting
 * the selected element's aspect ratio, fill, radius and dimensions.
 */
function ExportPreview({ element }: { element: ElementInfo | null }) {
  const rect = element?.boundingRect;
  const width = rect?.width ?? 0;
  const height = rect?.height ?? 0;
  const aspect = width > 0 && height > 0 ? width / height : 1;
  const styles = element?.computedStyles ?? {};
  const fill = cssColorOrFallback(
    styles.backgroundColor || styles.color,
    "var(--design-editor-control-bg)",
  );
  const radius = Math.min(8, cssLengthNumber(styles.borderRadius || "0"));

  return (
    <div className="mt-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] p-3">
      <div
        className="mx-auto flex max-h-28 items-center justify-center"
        style={{
          aspectRatio: aspect,
          width: aspect >= 1 ? "100%" : "auto",
          height: aspect < 1 ? "7rem" : "auto",
        }}
      >
        <div
          className="size-full border border-[var(--design-editor-control-border)] shadow-sm"
          style={{ background: fill, borderRadius: radius }}
        />
      </div>
      <p className="mt-2 text-center text-[10px] tabular-nums text-muted-foreground">
        {Math.round(width)} × {Math.round(height)}
      </p>
    </div>
  );
}

/** Position, size, and spacing properties */
function PositionLayoutProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const constrainedPosition =
    styles.position === "absolute" || styles.position === "fixed";
  // Reflect the active packing in the alignment segments (Figma highlights the
  // current alignment). For a flex container the main axis is justifyContent.
  const alignH = justifyToHorizontal(styles.justifyContent);
  const alignV = alignToVertical(styles.alignItems);
  const constraintsValue: ConstraintsValue = {
    horizontal:
      styles.left && styles.right
        ? "left-right"
        : styles.right
          ? "right"
          : styles.transform?.includes("translateX(-50%)")
            ? "center"
            : styles.width === "100%"
              ? "scale"
              : "left",
    vertical:
      styles.top && styles.bottom
        ? "top-bottom"
        : styles.bottom
          ? "bottom"
          : styles.transform?.includes("translateY(-50%)")
            ? "center"
            : styles.height === "100%"
              ? "scale"
              : "top",
  };

  const handleConstraintsChange = useCallback(
    (value: ConstraintsValue) => {
      onStyleChange("position", "absolute");
      if (value.horizontal === "left") {
        onStyleChange(
          "left",
          styles.left || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "auto");
      } else if (value.horizontal === "right") {
        onStyleChange("right", "0px");
        onStyleChange("left", "auto");
      } else if (value.horizontal === "left-right") {
        onStyleChange(
          "left",
          styles.left || `${Math.round(element.boundingRect.x)}px`,
        );
        onStyleChange("right", "0px");
      } else if (value.horizontal === "center") {
        onStyleChange("left", "50%");
        onStyleChange("right", "auto");
        onStyleChange("transform", "translateX(-50%)");
      } else {
        onStyleChange("left", "0px");
        onStyleChange("right", "0px");
        onStyleChange("width", "100%");
      }

      if (value.vertical === "top") {
        onStyleChange(
          "top",
          styles.top || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "auto");
      } else if (value.vertical === "bottom") {
        onStyleChange("bottom", "0px");
        onStyleChange("top", "auto");
      } else if (value.vertical === "top-bottom") {
        onStyleChange(
          "top",
          styles.top || `${Math.round(element.boundingRect.y)}px`,
        );
        onStyleChange("bottom", "0px");
      } else if (value.vertical === "center") {
        onStyleChange("top", "50%");
        onStyleChange("bottom", "auto");
        onStyleChange("transform", "translateY(-50%)");
      } else {
        onStyleChange("top", "0px");
        onStyleChange("bottom", "0px");
        onStyleChange("height", "100%");
      }
    },
    [
      element.boundingRect.x,
      element.boundingRect.y,
      onStyleChange,
      styles.left,
      styles.top,
    ],
  );

  return (
    <PanelSection
      title={t("editPanel.sections.positionLayout")}
      actions={
        <SectionIconToggle
          label={"Absolute position" /* i18n-ignore Figma inspector action */}
          active={constrainedPosition}
          onClick={() =>
            onStyleChange(
              "position",
              constrainedPosition ? "relative" : "absolute",
            )
          }
        >
          <IconLayoutDistributeHorizontal className="size-3.5" />
        </SectionIconToggle>
      }
    >
      <div className="space-y-1.5">
        <SubsectionLabel>
          {"Alignment" /* i18n-ignore Figma inspector label */}
        </SubsectionLabel>
        <div className="flex items-center gap-3">
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.textAligns.left")}
              active={alignH === "left"}
              onClick={() => onStyleChange("justifyContent", "flex-start")}
            >
              <IconLayoutAlignLeft className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.textAligns.center")}
              active={alignH === "center"}
              onClick={() => onStyleChange("justifyContent", "center")}
            >
              <IconLayoutAlignCenter className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.textAligns.right")}
              active={alignH === "right"}
              onClick={() => onStyleChange("justifyContent", "flex-end")}
            >
              <IconLayoutAlignRight className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.start")}
              active={alignV === "top"}
              onClick={() => onStyleChange("alignItems", "flex-start")}
            >
              <IconLayoutAlignTop className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.center")}
              active={alignV === "middle"}
              onClick={() => onStyleChange("alignItems", "center")}
            >
              <IconLayoutAlignMiddle className="size-3.5" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.alignSelfOptions.end")}
              active={alignV === "bottom"}
              onClick={() => onStyleChange("alignItems", "flex-end")}
            >
              <IconLayoutAlignBottom className="size-3.5" />
            </InspectorIconButton>
          </InspectorSegment>
        </div>
      </div>

      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.position")}</SubsectionLabel>
        <div className="grid grid-cols-2 gap-2">
          <ScrubStyleInput
            label="X"
            value={styles.left || ""}
            placeholder={element.boundingRect.x}
            inputClassName="h-6"
            onChange={(v) => onStyleChange("left", `${Math.round(v)}px`)}
          />
          <ScrubStyleInput
            label="Y"
            value={styles.top || ""}
            placeholder={element.boundingRect.y}
            inputClassName="h-6"
            onChange={(v) => onStyleChange("top", `${Math.round(v)}px`)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <SubsectionLabel>{t("editPanel.labels.rotation")}</SubsectionLabel>
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <ScrubStyleInput
              label="R"
              value={`${parseRotationValue(styles.transform)}deg`}
              unit="deg"
              inputClassName="h-6"
              onChange={(v) =>
                onStyleChange(
                  "transform",
                  mergeRotationValue(styles.transform, v),
                )
              }
            />
          </div>
          <InspectorSegment>
            <InspectorIconButton
              label={t("editPanel.labels.flipHorizontal")}
              onClick={() => onStyleChange("scale", "-1 1")}
            >
              <IconFlipHorizontal className="size-4" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.labels.flipVertical")}
              onClick={() => onStyleChange("scale", "1 -1")}
            >
              <IconFlipVertical className="size-4" />
            </InspectorIconButton>
          </InspectorSegment>
        </div>
      </div>

      {constrainedPosition ? (
        <ConstraintsWidget
          value={constraintsValue}
          onChange={handleConstraintsChange}
        />
      ) : null}
    </PanelSection>
  );
}

function FillProperties({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const isTextElement = TEXT_TAGS.has(element.tagName);
  const fillProperty = isTextElement ? "color" : "backgroundColor";
  const fillValue = isTextElement
    ? styles.color || ""
    : styles.backgroundColor || "";
  const backgroundLayers = isTextElement
    ? []
    : splitCssLayers(styles.backgroundImage || "");
  const hasBackgroundLayer = !isTextElement && backgroundLayers.length > 0;
  const hasVisibleFill =
    isTextElement || colorHasVisibleAlpha(fillValue) || hasBackgroundLayer;

  // Non-destructive fill hide: stash the color before hiding so toggling
  // visible again restores the exact original value (Figma never loses color).
  // Keyed by `${element.id ?? tagName}:${fillProperty}` so separate elements
  // don't share stash slots.
  const [hiddenFillStash, setHiddenFillStash] = useState<
    Record<string, string>
  >({});
  const stashKey = `${element.id ?? element.tagName}:${fillProperty}`;
  const isHidden = fillValue === "transparent" || fillValue === "";
  const handleFillVisibilityToggle = () => {
    if (isHidden) {
      // Restore the stashed color, or fall back to a sensible default.
      const restored =
        hiddenFillStash[stashKey] ?? (isTextElement ? "#000000" : "#ffffff");
      onStyleChange(fillProperty, restored);
      setHiddenFillStash((prev) => {
        const next = { ...prev };
        delete next[stashKey];
        return next;
      });
    } else {
      // Stash the current color before going transparent.
      setHiddenFillStash((prev) => ({ ...prev, [stashKey]: fillValue }));
      onStyleChange(fillProperty, "transparent");
    }
  };

  // Document colors: unique hex strings from all CSS color properties on the
  // selected element, collected via the existing selectionColorValues helper.
  const docColorHexes = selectionColorValues(element)
    .map((c) => {
      const parsed = parseCssColor(c.value);
      return parsed ? rgbaToHex(parsed) : null;
    })
    .filter((h): h is string => Boolean(h));
  // Deduplicate (selectionColorValues already dedupes by raw CSS value, but
  // hex normalisation may collapse additional entries e.g. rgb vs #hex).
  const seenHex = new Set<string>();
  const documentColors = docColorHexes.filter((h) => {
    const key = h.toUpperCase();
    if (seenHex.has(key)) return false;
    seenHex.add(key);
    return true;
  });

  return (
    <PanelSection
      title={t("editPanel.sections.fill")}
      actions={
        <>
          {/* Figma color-styles affordance (grid icon) to the left of "+". */}
          <SectionIconButton
            label={"Styles" /* i18n-ignore Figma inspector action */}
          >
            <IconLayoutGrid className="size-3.5" />
          </SectionIconButton>
          <SectionIconButton
            label={t("editPanel.labels.addLayer")}
            onClick={() => {
              if (isTextElement) {
                onStyleChange(
                  "color",
                  cssColorOrFallback(styles.color, "#000000"),
                );
                return;
              }
              if (!colorHasVisibleAlpha(styles.backgroundColor)) {
                onStyleChange(
                  "backgroundColor",
                  cssColorOrFallback(styles.backgroundColor, "#ffffff"),
                );
                return;
              }
              const current = compactCssValue(styles.backgroundImage, "");
              const nextLayer = defaultGradientLayer(
                "linear",
                styles.backgroundColor || "#ffffff",
              );
              onStyleChange(
                "backgroundImage",
                current ? `${nextLayer}, ${current}` : nextLayer,
              );
            }}
          >
            <IconPlus className="size-3.5" />
          </SectionIconButton>
        </>
      }
    >
      {hasVisibleFill ? (
        <div className="space-y-1.5">
          {isTextElement || colorHasVisibleAlpha(fillValue) ? (
            /* Figma row: [swatch+hex trigger (flex-1)] [eye] [remove] */
            <div className="group flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <ColorInput
                  label=""
                  value={fillValue}
                  onChange={(v) => onStyleChange(fillProperty, v)}
                  backgroundImage=""
                  blendMode={
                    isTextElement
                      ? undefined
                      : styles.backgroundBlendMode || "normal"
                  }
                  onBlendModeChange={
                    isTextElement
                      ? undefined
                      : (v) => onStyleChange("backgroundBlendMode", v)
                  }
                  documentColors={documentColors}
                />
              </div>
              <SectionIconButton
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                label={
                  isHidden
                    ? t("editPanel.labels.showLayer")
                    : t("editPanel.labels.hideLayer")
                }
                onClick={handleFillVisibilityToggle}
              >
                {isHidden ? (
                  <IconEyeOff className="size-3.5" />
                ) : (
                  <IconEye className="size-3.5" />
                )}
              </SectionIconButton>
              <SectionIconButton
                className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                label={t("editPanel.labels.removeLayer")}
                onClick={() => {
                  if (isTextElement) {
                    onStyleChange(fillProperty, "transparent");
                    return;
                  }
                  if (onStylesChange) {
                    onStylesChange({
                      backgroundColor: "transparent",
                      backgroundImage: "none",
                    });
                  } else {
                    onStyleChange(fillProperty, "transparent");
                  }
                }}
              >
                <IconMinus className="size-3.5" />
              </SectionIconButton>
            </div>
          ) : null}
          {!isTextElement
            ? backgroundLayers.map((layer, index) => {
                const gradient = parseGradientLayer(layer);
                const opacity = gradient
                  ? averageGradientOpacity(gradient.stops)
                  : 100;
                const label = gradient
                  ? `${gradientLabel(gradient.type)} ${index + 1}`
                  : `${"Image" /* i18n-ignore Figma inspector paint row */} ${
                      index + 1
                    }`;
                const replaceLayer = (nextLayer: string) => {
                  const nextLayers = [...backgroundLayers];
                  nextLayers[index] = nextLayer;
                  onStyleChange("backgroundImage", joinCssLayers(nextLayers));
                };
                const removeLayer = () => {
                  onStyleChange(
                    "backgroundImage",
                    joinCssLayers(
                      backgroundLayers.filter(
                        (_, layerIndex) => layerIndex !== index,
                      ),
                    ),
                  );
                };

                return (
                  /* Figma row: [swatch+label+opacity% trigger (flex-1)] [eye] [remove] */
                  <div
                    key={`${layer}-${index}`}
                    className="group flex items-center gap-1.5"
                  >
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
                        >
                          <span
                            className="size-4 shrink-0 rounded-sm border border-[var(--design-editor-control-border)]"
                            style={swatchStyle(layer)}
                          />
                          <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                            {label}
                          </span>
                          <span className="shrink-0 tabular-nums text-muted-foreground">
                            {opacity}%
                          </span>
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        side="left"
                        align="start"
                        sideOffset={8}
                        className="w-80 p-0"
                      >
                        <FigmaColorPicker
                          value={gradient?.stops[0]?.color ?? layer}
                          onPaintValueChange={replaceLayer}
                          onChange={(nextColor) => {
                            if (!gradient) return;
                            const firstStop = gradient.stops[0];
                            if (!firstStop) return;
                            replaceLayer(
                              buildGradientLayer(gradient.type, [
                                { ...firstStop, color: nextColor },
                                ...gradient.stops.slice(1),
                              ]),
                            );
                          }}
                          paintType={gradient?.type ?? "image"}
                          gradientType={gradient?.type}
                          onGradientTypeChange={(type) => {
                            if (!gradient) return;
                            replaceLayer(
                              buildGradientLayer(type, gradient.stops),
                            );
                          }}
                          fillRows={[
                            {
                              id: `layer-${index}`,
                              label,
                              value: layer,
                              type: gradient ? "gradient" : "image",
                              selected: true,
                              swatch: layer,
                            },
                          ]}
                          selectedFillId={`layer-${index}`}
                        />
                      </PopoverContent>
                    </Popover>
                    <SectionIconButton
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                      label={
                        opacity <= 0
                          ? t("editPanel.labels.showLayer")
                          : t("editPanel.labels.hideLayer")
                      }
                      onClick={() => {
                        if (!gradient) return;
                        replaceLayer(
                          buildGradientLayer(
                            gradient.type,
                            gradient.stops.map((stop) => ({
                              ...stop,
                              opacity: opacity <= 0 ? 100 : 0,
                            })),
                          ),
                        );
                      }}
                    >
                      {opacity <= 0 ? (
                        <IconEyeOff className="size-3.5" />
                      ) : (
                        <IconEye className="size-3.5" />
                      )}
                    </SectionIconButton>
                    <SectionIconButton
                      className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
                      label={t("editPanel.labels.removeLayer")}
                      onClick={removeLayer}
                    >
                      <IconMinus className="size-3.5" />
                    </SectionIconButton>
                  </div>
                );
              })
            : null}
        </div>
      ) : null}
    </PanelSection>
  );
}

function StrokeProperties({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const borderVisible = strokeIsVisible(styles.borderWidth, styles.borderStyle);
  const outlineVisible = strokeIsVisible(
    styles.outlineWidth,
    styles.outlineStyle,
  );

  return (
    <PanelSection
      title={t("editPanel.sections.stroke")}
      actions={
        <SectionIconButton
          label={t("editPanel.labels.addLayer")}
          onClick={() => {
            if (!borderVisible) {
              const borderColor = cssColorOrFallback(
                styles.borderColor || styles.color,
                "#000000",
              );
              commitStylePatch(
                {
                  borderWidth: "1px",
                  borderStyle: "solid",
                  borderColor,
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            if (outlineVisible) {
              const outlineWidth = `${
                Math.max(1, cssLengthNumber(styles.outlineWidth, 1)) + 1
              }px`;
              const outlineStyle =
                styles.outlineStyle === "none"
                  ? "solid"
                  : styles.outlineStyle || "solid";
              const outlineColor = cssColorOrFallback(
                styles.outlineColor || styles.borderColor,
                "#000000",
              );
              commitStylePatch(
                {
                  outlineWidth,
                  outlineStyle,
                  outlineColor,
                  outlineOffset: styles.outlineOffset || "0px",
                },
                onStyleChange,
                onStylesChange,
              );
              return;
            }
            commitStylePatch(
              {
                outlineWidth: "1px",
                outlineStyle: "solid",
                outlineColor: cssColorOrFallback(styles.borderColor, "#000000"),
                outlineOffset: "0px",
              },
              onStyleChange,
              onStylesChange,
            );
          }}
        >
          <IconPlus className="size-3.5" />
        </SectionIconButton>
      }
    >
      {borderVisible ? (
        <StrokeLayerControl
          kind="border"
          visible={borderVisible}
          color={styles.borderColor || "#000000"}
          width={styles.borderWidth || "0px"}
          styleValue={styles.borderStyle || "none"}
          onStyleChange={onStyleChange}
          onRemove={() => {
            if (onStylesChange) {
              onStylesChange({ borderWidth: "0px", borderStyle: "none" });
            } else {
              onStyleChange("borderWidth", "0px");
            }
          }}
        />
      ) : null}
      {outlineVisible ? (
        <StrokeLayerControl
          kind="outline"
          visible={outlineVisible}
          color={styles.outlineColor || styles.borderColor || "#000000"}
          width={styles.outlineWidth || "0px"}
          styleValue={styles.outlineStyle || "solid"}
          onStyleChange={onStyleChange}
          onRemove={() => {
            if (onStylesChange) {
              onStylesChange({ outlineWidth: "0px", outlineStyle: "none" });
            } else {
              onStyleChange("outlineWidth", "0px");
            }
          }}
        />
      ) : null}
    </PanelSection>
  );
}

function AppearanceProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const hidden =
    styles.visibility === "hidden" ||
    styles.display === "none" ||
    parseNumericValue(styles.opacity || "1") === 0;
  return (
    <PanelSection
      title={t("root.commandAppearance")}
      actions={
        <>
          {/* Opacity / blend-mode affordance — matches Figma's pill icon */}
          <SectionIconButton
            label={
              "Opacity & blend mode" /* i18n-ignore Figma inspector action */
            }
          >
            <IconSlice className="size-3.5" />
          </SectionIconButton>
          {/* Visibility toggle */}
          <SectionIconToggle
            label={
              hidden
                ? "Show" /* i18n-ignore Figma inspector action */
                : "Hide" /* i18n-ignore Figma inspector action */
            }
            active={hidden}
            onClick={() =>
              onStyleChange("visibility", hidden ? "visible" : "hidden")
            }
          >
            {hidden ? (
              <IconEyeOff className="size-3.5" />
            ) : (
              <IconEye className="size-3.5" />
            )}
          </SectionIconToggle>
          {/* Styles / fill library affordance — matches Figma's droplet icon */}
          <SectionIconButton
            label={"Styles" /* i18n-ignore Figma inspector action */}
          >
            <IconDroplet className="size-3.5" />
          </SectionIconButton>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <ScrubInput
          label={t("editPanel.labels.opacity")}
          value={parseNumericValue(styles.opacity || "1") * 100}
          onChange={(v) => onStyleChange("opacity", String(v / 100))}
          min={0}
          max={100}
          step={1}
          unit="%"
          precision={1}
          labelClassName="w-0 overflow-hidden"
          inputClassName="h-6 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] shadow-none"
        />
        {/* M9: blend mode compact — inline select next to opacity, no separate labeled row */}
        <Select
          value={optionValue(
            BLEND_MODE_OPTIONS,
            styles.mixBlendMode || "normal",
            "normal",
          )}
          onValueChange={(value) => onStyleChange("mixBlendMode", value)}
        >
          <SelectTrigger className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {BLEND_MODE_OPTIONS.map((opt) => (
              <SelectItem
                key={opt.value}
                value={opt.value}
                className="text-[11px]"
              >
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* M7: use CornerRadiusControl (with independent-corners toggle) instead of bare ScrubInput */}
      <CornerRadiusControl styles={styles} onStyleChange={onStyleChange} />
    </PanelSection>
  );
}

function EffectsProperties({
  element,
  onStyleChange,
  onStylesChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
}) {
  const t = useT();
  const styles = element.computedStyles;
  const blurValue = readBlurFilter(styles.filter);
  // M5 · Background (backdrop) blur is a distinct Figma effect type, backed by
  // CSS `backdrop-filter: blur()` (vs layer blur's `filter: blur()`).
  const backdropBlurValue = readBlurFilter(
    styles.backdropFilter || styles.webkitBackdropFilter,
  );
  const shadowLayers = parseShadowLayers(styles.boxShadow);
  const setShadowLayers = (layers: ShadowLayer[]) => {
    const boxShadow = serializeShadowLayers(layers);
    if (onStylesChange) onStylesChange({ boxShadow });
    else onStyleChange("boxShadow", boxShadow);
  };
  const addDropShadow = () =>
    setShadowLayers([
      ...shadowLayers,
      defaultDropShadowLayer(shadowLayers.length),
    ]);
  const addLayerBlur = () => onStyleChange("filter", "blur(4px)");
  const addBackgroundBlur = () => onStyleChange("backdropFilter", "blur(8px)");

  return (
    <PanelSection
      title={t("editPanel.sections.effects")}
      actions={
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 cursor-pointer rounded-md text-muted-foreground hover:text-foreground"
              aria-label={t("editPanel.labels.addLayer")}
            >
              <IconPlus className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            <DropdownMenuItem
              className="gap-2 text-[11px]"
              onSelect={addDropShadow}
            >
              <IconShadow className="size-3.5" />
              {t("editPanel.labels.dropShadow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-[11px]"
              onSelect={addLayerBlur}
            >
              <IconBlur className="size-3.5" />
              {t("editPanel.labels.layerBlur")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2 text-[11px]"
              onSelect={addBackgroundBlur}
            >
              <IconBackground className="size-3.5" />
              {"Background blur" /* i18n-ignore Figma effect type */}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      {shadowLayers.length ? (
        <div className="space-y-1.5">
          {shadowLayers.map((layer, index) => (
            <ShadowEffectRow
              key={layer.id}
              layer={layer}
              index={index}
              onChange={(patch) => {
                const next = shadowLayers.map((candidate) =>
                  candidate.id === layer.id
                    ? { ...candidate, ...patch }
                    : candidate,
                );
                setShadowLayers(next);
              }}
              onRemove={() =>
                setShadowLayers(
                  shadowLayers.filter((candidate) => candidate.id !== layer.id),
                )
              }
            />
          ))}
        </div>
      ) : null}
      {blurValue > 0 ? (
        /* Figma effect row for layer blur: flat row matching shadow rows */
        <Popover>
          <div className="group flex items-center gap-1.5">
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {t("editPanel.labels.layerBlur")}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Math.round(blurValue)}px
                </span>
              </button>
            </PopoverTrigger>
            <SectionIconButton
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
              label={t("editPanel.labels.removeLayer")}
              onClick={() => onStyleChange("filter", "none")}
              disabled={!styles.filter || styles.filter === "none"}
            >
              <IconMinus className="size-3.5" />
            </SectionIconButton>
          </div>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            className="w-56 p-3"
          >
            <ScrubInput
              label={t("editPanel.labels.blur")}
              value={blurValue}
              onChange={(value) =>
                onStyleChange(
                  "filter",
                  `blur(${Math.max(0, Math.round(value))}px)`,
                )
              }
              unit="px"
              min={0}
              precision={1}
              labelClassName="w-16"
              inputClassName="h-6"
            />
          </PopoverContent>
        </Popover>
      ) : null}
      {backdropBlurValue > 0 ? (
        /* M5 · Background (backdrop) blur effect row — mirrors the layer-blur row */
        <Popover>
          <div className="group flex items-center gap-1.5">
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-left text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)]"
              >
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">
                  {"Background blur" /* i18n-ignore Figma effect type */}
                </span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {Math.round(backdropBlurValue)}px
                </span>
              </button>
            </PopoverTrigger>
            <SectionIconButton
              className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100"
              label={t("editPanel.labels.removeLayer")}
              onClick={() => onStyleChange("backdropFilter", "none")}
              disabled={
                !styles.backdropFilter || styles.backdropFilter === "none"
              }
            >
              <IconMinus className="size-3.5" />
            </SectionIconButton>
          </div>
          <PopoverContent
            side="left"
            align="start"
            sideOffset={8}
            className="w-56 p-3"
          >
            <ScrubInput
              label={t("editPanel.labels.blur")}
              value={backdropBlurValue}
              onChange={(value) =>
                onStyleChange(
                  "backdropFilter",
                  `blur(${Math.max(0, Math.round(value))}px)`,
                )
              }
              unit="px"
              min={0}
              precision={1}
              labelClassName="w-16"
              inputClassName="h-6"
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </PanelSection>
  );
}

interface SelectionColorValue {
  property: string;
  value: string;
}

function selectionColorValues(element: ElementInfo): SelectionColorValue[] {
  const styles = element.computedStyles;
  const rawValues: SelectionColorValue[] = [
    { property: "color", value: styles.color },
    { property: "backgroundColor", value: styles.backgroundColor },
    { property: "borderColor", value: styles.borderColor },
    { property: "outlineColor", value: styles.outlineColor },
  ];
  const seen = new Set<string>();
  return rawValues
    .map((color) => ({ ...color, value: color.value?.trim() }))
    .filter((color): color is SelectionColorValue => Boolean(color.value))
    .filter(
      (color) =>
        color.value !== "transparent" && color.value !== "rgba(0, 0, 0, 0)",
    )
    .filter((color) => {
      const key = color.value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Uppercase 6-char hex (no #) for a CSS color, matching Figma's row readout. */
function selectionDisplayHex(value: string): string {
  const parsed = parseCssColor(value);
  if (!parsed) return value.replace(/^#/, "").toUpperCase();
  return rgbaToHex(parsed).replace(/^#/, "").toUpperCase();
}

function SelectionColorsProperties({
  element,
  onStyleChange,
}: {
  element: ElementInfo;
  onStyleChange: (property: string, value: string) => void;
}) {
  // M6 · Figma's Selection colors collapses to a single "Show selection colors"
  // affordance, expanding to one editable [swatch · hex · opacity] row per
  // unique color — matching the Fill row grammar instead of a swatch strip.
  const [expanded, setExpanded] = useState(false);
  const colors = selectionColorValues(element);
  if (!colors.length) return null;

  return (
    <PanelSection
      title={"Selection colors" /* i18n-ignore Figma inspector label */}
    >
      {expanded ? (
        <div className="space-y-1.5">
          {colors.map((color, index) => {
            const parsed = parseCssColor(color.value);
            const opacity = parsed ? alphaToOpacity(parsed.a) : 100;
            return (
              <Popover key={`${color.value}-${index}`}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-[11px] hover:bg-[var(--design-editor-panel-raised-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
                    aria-label={color.value}
                  >
                    <span
                      className="size-4 shrink-0 rounded-[3px] border border-border/60"
                      style={swatchStyle(color.value)}
                    />
                    <span className="min-w-0 flex-1 truncate text-left uppercase tabular-nums">
                      {selectionDisplayHex(color.value)}
                    </span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {opacity}%
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="left"
                  align="start"
                  sideOffset={8}
                  className="w-80 p-0"
                >
                  <FigmaColorPicker
                    value={cssColorOrFallback(color.value, "#000000")}
                    onChange={(value) => onStyleChange(color.property, value)}
                  />
                </PopoverContent>
              </Popover>
            );
          })}
        </div>
      ) : (
        <button
          type="button"
          className="flex h-6 w-full items-center justify-between gap-2 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 text-left text-[11px] text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          <span className="truncate">
            {"Show selection colors" /* i18n-ignore Figma inspector label */}
          </span>
          <div className="flex shrink-0 items-center -space-x-1">
            {colors.slice(0, 3).map((color, index) => (
              <span
                key={`${color.value}-${index}`}
                className="size-3.5 rounded-sm border border-[var(--design-editor-panel-bg)]"
                style={swatchStyle(color.value)}
              />
            ))}
          </div>
        </button>
      )}
    </PanelSection>
  );
}

const TEXT_TAGS = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "span",
  "a",
  "strong",
  "em",
  "label",
  "li",
]);

export function EditPanel({
  selectedElement,
  pageStyles = {},
  headerTrailing,
  width = 256,
  activeTab = "design",
  onActiveTabChange,
  tweaks = [],
  tweakValues = {},
  extensionContext,
  onTweakChange,
  onRequestTweaks,
  onStyleChange,
  onStylesChange,
  onExport,
  exporting = false,
}: EditPanelProps) {
  const t = useT();
  const [exportSettings, setExportSettings] = useState<ExportSettingsValue>({
    scale: 1,
    format: "png",
    suffix: "",
  });
  const [showExportPreview, setShowExportPreview] = useState(false);
  const isTextElement = selectedElement
    ? TEXT_TAGS.has(selectedElement.tagName)
    : false;
  const handleActiveTabChange = useCallback(
    (tab: InspectorTab) => onActiveTabChange?.(tab),
    [onActiveTabChange],
  );
  const handleTweakChange = useCallback(
    (tweakId: string, value: string | number | boolean) => {
      onTweakChange?.(tweakId, value);
    },
    [onTweakChange],
  );

  return (
    <div
      className={cn(
        "shrink-0 bg-[var(--design-editor-panel-bg)]",
        "flex h-full min-h-0 flex-col overflow-hidden",
      )}
      style={{ width }}
    >
      <InspectorTabsHeader
        activeTab={activeTab}
        onActiveTabChange={handleActiveTabChange}
        trailing={headerTrailing}
      />

      {activeTab === "design" ? (
        <>
          <SelectionHeader element={selectedElement} />

          <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {!selectedElement && (
              <PageProperties
                styles={pageStyles}
                onStyleChange={onStyleChange}
              />
            )}

            {selectedElement && (
              <>
                <PositionLayoutProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                />
                <LayoutContextProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                />
                <AppearanceProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                />
                {isTextElement ? (
                  <TypographyProperties
                    element={selectedElement}
                    onStyleChange={onStyleChange}
                  />
                ) : null}
                <FillProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                />
                <StrokeProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                />
                <EffectsProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                  onStylesChange={onStylesChange}
                />
                <SelectionColorsProperties
                  element={selectedElement}
                  onStyleChange={onStyleChange}
                />
                {isContainerElement(selectedElement) ? (
                  <LayoutGuideProperties
                    element={selectedElement}
                    onStyleChange={onStyleChange}
                  />
                ) : null}
              </>
            )}
            {onExport ? (
              <PanelSection
                title={t("editPanel.sections.export")}
                actions={
                  <SectionIconToggle
                    label={
                      showExportPreview
                        ? "Hide preview" /* i18n-ignore Figma inspector action */
                        : "Show preview" /* i18n-ignore Figma inspector action */
                    }
                    active={showExportPreview}
                    onClick={() => setShowExportPreview((shown) => !shown)}
                  >
                    <IconPhoto className="size-3.5" />
                  </SectionIconToggle>
                }
              >
                <ExportSettingsPanel
                  value={exportSettings}
                  formats={["png", "svg"]}
                  exporting={exporting}
                  onChange={(patch) =>
                    setExportSettings((current) => ({ ...current, ...patch }))
                  }
                  onExport={onExport}
                />
                {showExportPreview ? (
                  <ExportPreview element={selectedElement} />
                ) : null}
              </PanelSection>
            ) : null}
          </div>
        </>
      ) : activeTab === "tweaks" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
            <h3 className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
              {t("designEditor.tweaks")}
            </h3>
            {onRequestTweaks ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                    aria-label={t("designEditor.addTweaks")}
                    onClick={(event) => onRequestTweaks(event.currentTarget)}
                  >
                    <IconPlus className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t("designEditor.addTweaks")}</TooltipContent>
              </Tooltip>
            ) : null}
          </div>
          <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <TweaksPanelContent
              tweaks={tweaks}
              values={tweakValues}
              onChange={handleTweakChange}
              onRequestTweaks={onRequestTweaks}
              className="px-3 py-3"
            />
          </div>
        </div>
      ) : extensionContext ? (
        <DesignExtensionsPanel context={extensionContext} />
      ) : null}
    </div>
  );
}
