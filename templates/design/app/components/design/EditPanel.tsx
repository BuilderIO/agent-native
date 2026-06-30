import {
  useActionMutation,
  useActionQuery,
  useT,
} from "@agent-native/core/client";
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
  IconArrowRight,
  IconBackground,
  IconBlur,
  IconBorderStyle,
  IconBrush,
  IconCode,
  IconComponents,
  IconDeviceDesktop,
  IconExternalLink,
  IconDroplet,
  IconEye,
  IconEyeOff,
  IconFlipHorizontal,
  IconFlipVertical,
  IconFrame,
  IconLayoutDistributeHorizontal,
  IconLayoutGrid,
  IconLoader2,
  IconShieldCheck,
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
  IconLock,
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
import { useQueryClient } from "@tanstack/react-query";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Switch } from "@/components/ui/switch";
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
  DesignColorPicker,
  ScrubInput,
  SizingField,
  type AlignmentMatrixValue,
  type AutoLayoutMatrixValue,
  type AutoLayoutSizing,
  type AutoLayoutSizingAxis,
  type ConstraintsValue,
  type ExportSettingsValue,
  imageFillToBackgroundStyles,
  type DesignFillRow,
  type DesignFillRowPatch,
  type DesignGradientStop,
  type DesignGradientStopPatch,
  type DesignGradientType,
  type ImageFillValue,
} from "./inspector";
import { IconLayoutSettings } from "./inspector/design-icons";
import type { DesignPaintType } from "./inspector/DesignColorPicker";
import { ReviewPanel } from "./ReviewPanel";
import type { ReviewPanelProps } from "./ReviewPanel";
import { StatesPanel } from "./StatesPanel";
import type { StatesPanelProps } from "./StatesPanel";
import { TokensPanel } from "./TokensPanel";
import { TweaksPanelContent } from "./TweaksPanel";
import type { ElementInfo } from "./types";

export type InspectorTab = "design" | "tweaks" | "extensions";

/**
 * Sub-tab within the Tweaks area: "tokens" = TokensPanel face (CSS-var
 * editing through the Tweaks loop); "tweaks" = raw TweakDefinition controls.
 * Defaults to "tokens" when a designId is provided, otherwise "tweaks".
 */
type TweaksSubTab = "tokens" | "tweaks";

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
  onExport?: (settings: ExportSettingsValue[]) => void;
  exporting?: boolean;
  readOnly?: boolean;
  // -------------------------------------------------------------------------
  // Design Studio panels (§6.2, §6.4, §6.5)
  // Pass `designId` to unlock Tokens, States, and Review sections.
  // -------------------------------------------------------------------------
  /** The active design's id — required to mount Tokens / States / Review. */
  designId?: string;
  /**
   * Called after a token edit is applied so the parent can push the resolved
   * CSS-var map into the iframe via the tweak-values postMessage.
   */
  onTokensApplied?: (resolvedCssVars: Record<string, string>) => void;
  /** Props forwarded to the StatesPanel (§6.4). Requires `designId`. */
  statesPanelProps?: Omit<StatesPanelProps, "designId">;
  /** Props forwarded to the ReviewPanel (§6.5). */
  reviewPanelProps?: Omit<ReviewPanelProps, "className">;
  // -------------------------------------------------------------------------
  // Component section (§6.1)
  // When a component instance is selected, pass its node id here to unlock
  // the contextual Component section at the top of the Design tab.
  // -------------------------------------------------------------------------
  /**
   * The `data-agent-native-node-id` of the currently-selected component root
   * element.  When provided (along with `designId`), a Component section is
   * shown at the top of the Design tab with name, source path, prop controls,
   * and an Edit component action.
   */
  componentNodeId?: string;
  /**
   * Source capabilities for the current design.  Used to gate the Edit
   * component / jump-to-source affordances.  When absent all writes default
   * to disabled (inline / Alpine tier behaviour).
   */
  sourceCapabilities?: string[];
  // -------------------------------------------------------------------------
  // Selection header quick actions ("Create component" + "Inspect code")
  // -------------------------------------------------------------------------
  /**
   * Promote the current selection into a reusable component. Receives the
   * (already-normalized-by-the-action) component name the user typed. When
   * omitted the "Create component" button is disabled.
   */
  onCreateComponent?: (name: string) => void;
  /** Suggested default name for the create-component dialog. */
  defaultComponentName?: string;
  /** Code-inspection data for the "Inspect code" popover. */
  inspectCode?: InspectCodeData;
}

/**
 * Data backing the "Inspect code" popover. The parent resolves the selected
 * node's HTML and (for real-app sources) its source file location.
 */
export interface InspectCodeData {
  /** Outer HTML of the selected element (inline / Alpine source). */
  html?: string | null;
  /**
   * Resolved source file for real-app sources (localhost / fusion), when the
   * resolveNodeToFile capability is available.
   */
  sourceLocation?: {
    /** Absolute path on disk — used to build the vscode:// deep link. */
    absolutePath: string;
    line?: number;
    column?: number;
    /** Optional snippet to show above the Open-in-VS-Code button. */
    snippet?: string;
  } | null;
}

/**
 * Normalize a CSS length-ish value typed by the user. If the input is bare
 * digits (e.g. "32" or "32.5"), append the default unit so it parses as a
 * valid CSS length. Lets users type "32" and get the expected "32px" when
 * the field is committed.
 */
function normalizeLengthValue(raw: string, defaultUnit: string): string | null {
  const trimmed = raw.trim();
  // Empty / invalid input returns null so the caller reverts the field instead
  // of committing an empty or garbage CSS value (e.g. fontSize:"" or
  // flexBasis:"abc") to the element's inline style.
  if (!trimmed) return null;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return `${trimmed}${defaultUnit}`;
  // Validate free-form CSS so junk text never reaches the style. Fall back to
  // accepting the value when CSS.supports is unavailable (SSR/tests) to keep
  // prior behavior in non-DOM environments.
  if (typeof CSS !== "undefined" && typeof CSS.supports === "function") {
    const ok =
      CSS.supports("width", trimmed) ||
      CSS.supports("font-size", trimmed) ||
      CSS.supports("flex-basis", trimmed);
    return ok ? trimmed : null;
  }
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
    if (defaultUnit === undefined) {
      if (draft !== value) onChange(draft);
      return;
    }
    const next = normalizeLengthValue(draft, defaultUnit);
    if (next === null) {
      // Invalid or empty — revert the field to the last committed value.
      setDraft(value);
      return;
    }
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

/** Compact color input: label + design-editor picker popover. */
function ColorInput({
  label,
  value,
  onChange,
  backgroundImage,
  onBackgroundImageChange,
  onImageFillChange,
  blendMode,
  onBlendModeChange,
  supportsLayeredFills = false,
  documentColors,
  pickerKey,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  backgroundImage?: string;
  onBackgroundImageChange?: (value: string) => void;
  onImageFillChange?: (value: ImageFillValue) => void;
  blendMode?: string;
  onBlendModeChange?: (value: string) => void;
  supportsLayeredFills?: boolean;
  /** Hex strings already in use on the page — forwarded to the color picker swatch grid. */
  documentColors?: string[];
  pickerKey?: string;
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

  const handleFillChange = (id: string, patch: DesignFillRowPatch) => {
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
        gradient.prefix,
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
      ? (type: DesignGradientType) => {
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(type, activeGradient.stops),
          );
        }
      : undefined;

  const handleGradientStopChange =
    activeGradient && activeGradientIndex !== null
      ? (id: string, patch: DesignGradientStopPatch) => {
          const nextStops = activeGradient.stops.map((stop) =>
            stop.id === id ? { ...stop, ...patch } : stop,
          );
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(
              activeGradient.type,
              nextStops,
              activeGradient.prefix,
            ),
          );
        }
      : undefined;

  const handleAddGradientStop = onBackgroundImageChange
    ? () => {
        if (activeGradient && activeGradientIndex !== null) {
          const nextStop: DesignGradientStop = {
            id: `stop-${activeGradient.stops.length}`,
            color: draft || "#000000",
            position: 50,
            opacity: 100,
          };
          replaceBackgroundLayer(
            activeGradientIndex,
            buildGradientLayer(
              activeGradient.type,
              [...activeGradient.stops, nextStop],
              activeGradient.prefix,
            ),
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
            buildGradientLayer(
              activeGradient.type,
              nextStops,
              activeGradient.prefix,
            ),
          );
          setSelectedStopId(nextStops[0]?.id);
        }
      : undefined;

  const selectedPaintType: DesignPaintType =
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
  const handlePaintTypeChange = (type: DesignPaintType) => {
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
    const nextType: DesignGradientType = type;
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
    <DesignColorPicker
      key={pickerKey}
      label={label}
      value={pickerValue}
      onChange={setNext}
      onPaintValueChange={
        supportsLayeredFills ? handlePaintValueChange : undefined
      }
      onImageFillChange={onImageFillChange}
      blendMode={blendMode}
      onBlendModeChange={onBlendModeChange}
      showBlendMode={Boolean(onBlendModeChange)}
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
  type: DesignGradientType;
  prefix?: string;
  stops: DesignGradientStop[];
}

const DEFAULT_EXPORT_SETTINGS: ExportSettingsValue = {
  scale: 1,
  format: "png",
  suffix: "",
};

function elementIdentityKey(element: ElementInfo): string {
  return [
    element.sourceId ?? element.id ?? element.selector ?? element.tagName,
    Math.round(element.boundingRect.x),
    Math.round(element.boundingRect.y),
    Math.round(element.boundingRect.width),
    Math.round(element.boundingRect.height),
  ].join(":");
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
): DesignFillRow[] {
  const solid = parseCssColor(colorValue);
  const rows: DesignFillRow[] = [
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

function averageGradientOpacity(stops: DesignGradientStop[]): number {
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

export function parseGradientLayer(layer: string): ParsedGradientLayer | null {
  const match = layer.trim().match(/^(linear|radial|conic)-gradient\((.*)\)$/i);
  if (!match) return null;

  const parts = splitCssLayers(match[2] || "");
  const type = gradientTypeFromCss(match[1] || "", layer);
  const firstStop = parseGradientStop(parts[0] || "", 0, parts.length);
  const prefix = firstStop ? undefined : parts[0]?.trim();
  const stopParts = firstStop ? parts : parts.slice(1);
  const stops = stopParts
    .map((part, index) => parseGradientStop(part, index, stopParts.length))
    .filter((stop): stop is DesignGradientStop => Boolean(stop));

  if (!stops.length) return null;
  return { type, prefix, stops };
}

function parseGradientStop(
  part: string,
  index: number,
  total: number,
): DesignGradientStop | null {
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
  const functionName = trimmed.match(/^[a-z][a-z0-9-]*\(/i);
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
): DesignGradientType {
  if (functionName.toLowerCase() === "conic") return "angular";
  // Recognize both diamond serializations — EditPanel's "closest-corner" and
  // GradientEditor's "ellipse closest-side" — so a diamond authored in either
  // place round-trips as diamond instead of flipping to radial.
  if (/closest-corner/i.test(layer) || /ellipse\s+closest-side/i.test(layer))
    return "diamond";
  if (functionName.toLowerCase() === "radial") return "radial";
  return "linear";
}

function gradientLabel(type: DesignGradientType): string {
  if (type === "radial") {
    return "Radial gradient"; // i18n-ignore design inspector paint row
  }
  if (type === "angular") {
    return "Angular gradient"; // i18n-ignore design inspector paint row
  }
  if (type === "diamond") {
    return "Diamond gradient"; // i18n-ignore design inspector paint row
  }
  return "Linear gradient"; // i18n-ignore design inspector paint row
}

function defaultGradientPrefix(type: DesignGradientType): string {
  if (type === "radial") return "circle at 50% 50%";
  if (type === "angular") return "from 0deg at 50% 50%";
  if (type === "diamond") return "closest-corner at 50% 50%";
  return "90deg";
}

export function buildGradientLayer(
  type: DesignGradientType,
  stops: DesignGradientStop[],
  prefix = defaultGradientPrefix(type),
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

  if (type === "radial" || type === "diamond") {
    return `radial-gradient(${prefix}, ${stopList})`;
  }
  if (type === "angular") return `conic-gradient(${prefix}, ${stopList})`;
  return `linear-gradient(${prefix}, ${stopList})`;
}

function defaultGradientStops(colorValue: string): DesignGradientStop[] {
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

function defaultGradientLayer(type: DesignGradientType, colorValue: string) {
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

/**
 * design-editor inspector section. Matches the design editor "Design" panel chrome:
 *   - NO left collapse chevron (the design editor uses none).
 *   - A thin divider line above each section.
 *   - A bold left-aligned title.
 *   - Right-aligned action icons (add layer, toggles, styles, etc.).
 *
 * The title is still clickable to collapse the body (design sections collapse
 * on title click) but renders no chevron glyph, just the same way.
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

function DesignSpacingControl({
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

type TextResizeMode = "auto-width" | "auto-height" | "fixed";

function cleanFontFamilyName(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function splitFontFamilyList(value: string | undefined): string[] {
  const raw = value?.trim();
  if (!raw) return [];

  const families: string[] = [];
  let token = "";
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i];
    if ((char === '"' || char === "'") && raw[i - 1] !== "\\") {
      if (quote === char) quote = null;
      else if (!quote) quote = char;
      token += char;
      continue;
    }
    if (char === "," && !quote) {
      const cleaned = cleanFontFamilyName(token);
      if (cleaned) families.push(cleaned);
      token = "";
      continue;
    }
    token += char;
  }

  const cleaned = cleanFontFamilyName(token);
  if (cleaned) families.push(cleaned);
  return families;
}

function normalizeFontFamilyName(value: string): string {
  return cleanFontFamilyName(value).replace(/\s+/g, " ").toLowerCase();
}

function normalizeFontFamilyStack(value: string): string {
  return splitFontFamilyList(value).map(normalizeFontFamilyName).join(",");
}

function displayFontFamilyName(value: string | undefined): string {
  const first = splitFontFamilyList(value)[0];
  if (!first) return "Sans Serif"; // i18n-ignore design generic font label

  const normalized = normalizeFontFamilyName(first);
  if (normalized === "sans-serif") {
    return "Sans Serif"; // i18n-ignore design generic font label
  }
  if (normalized === "serif") return "Serif"; // i18n-ignore design generic font label
  if (normalized === "monospace") {
    return "Monospace"; // i18n-ignore design generic font label
  }
  if (normalized === "system-ui" || normalized === "-apple-system") {
    return "System UI"; // i18n-ignore design generic font label
  }
  if (normalized === "blinkmacsystemfont") {
    return "Apple System"; // i18n-ignore design generic font label
  }
  return first;
}

function resolveFontFamilySelectValue(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "sans-serif";

  const normalizedStack = normalizeFontFamilyStack(raw);
  const exactOption = FONT_FAMILY_OPTIONS.find(
    (option) => normalizeFontFamilyStack(option.value) === normalizedStack,
  );
  if (exactOption) return exactOption.value;

  const firstFamily = normalizeFontFamilyName(
    splitFontFamilyList(raw)[0] ?? "",
  );
  const firstFamilyOption = FONT_FAMILY_OPTIONS.find(
    (option) =>
      normalizeFontFamilyName(splitFontFamilyList(option.value)[0] ?? "") ===
      firstFamily,
  );
  return firstFamilyOption?.value ?? raw;
}

const ALIGN_SELF_OPTIONS = [
  { value: "auto", key: "auto" },
  { value: "flex-start", key: "start" },
  { value: "center", key: "center" },
  { value: "flex-end", key: "end" },
  { value: "stretch", key: "stretch" },
  { value: "baseline", key: "baseline" },
] as const;
// "center" stroke position is omitted: CSS has no native single-property
// centered stroke; choosing it in the UI caused a confusing revert to "inside"
// on next render. Inside (border) and outside (outline) are fully supported.
const STROKE_POSITION_OPTIONS = [
  { value: "inside", key: "inside" },
  { value: "outside", key: "outside" },
] as const;
const BLEND_MODE_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Color dodge" }, // i18n-ignore design blend mode label
  { value: "color-burn", label: "Color burn" }, // i18n-ignore design blend mode label
  { value: "hard-light", label: "Hard light" }, // i18n-ignore design blend mode label
  { value: "soft-light", label: "Soft light" }, // i18n-ignore design blend mode label
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

/**
 * Resolve a CSS line-height value to a unitless ratio for display/editing.
 * When the browser returns a px-computed value (e.g. "19.2px" for line-height
 * 1.2 on a 16px font), divide by the font-size to recover the unitless ratio.
 * Falls back to 1.2 when the value cannot be parsed.
 */
function resolveLineHeight(
  lineHeight: string | undefined,
  fontSize: string | undefined,
): number {
  const lh = lineHeight?.trim() || "";
  if (!lh || lh === "normal") return 1.2;
  if (lh.endsWith("px")) {
    const lhPx = parseFloat(lh);
    const fsPx = parseFloat(fontSize || "");
    if (Number.isFinite(lhPx) && Number.isFinite(fsPx) && fsPx > 0) {
      return Math.round((lhPx / fsPx) * 100) / 100;
    }
  }
  const numeric = parseFloat(lh);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 1.2;
}

// Matches a 2D rotate()/rotateZ() with any CSS angle unit (not rotateX/Y/3d).
const ROTATE_FN_PATTERN =
  /rotate[Zz]?\(\s*([+-]?[\d.]+(?:e[+-]?\d+)?)(deg|rad|turn|grad)?\s*\)/i;

function parseRotationValue(transform: string | undefined): number {
  if (!transform || transform === "none") return 0;
  const match = transform.match(ROTATE_FN_PATTERN);
  if (match) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      const unit = (match[2] || "deg").toLowerCase();
      const deg =
        unit === "rad"
          ? value * (180 / Math.PI)
          : unit === "turn"
            ? value * 360
            : unit === "grad"
              ? value * 0.9
              : value;
      return Math.round(deg * 10) / 10;
    }
  }
  // Fallback for rotate3d()/matrix()/skew composites: read the 2D rotation
  // component off the resolved matrix so the panel doesn't report 0.
  if (typeof DOMMatrixReadOnly !== "undefined") {
    try {
      const m = new DOMMatrixReadOnly(transform);
      return Math.round(((Math.atan2(m.b, m.a) * 180) / Math.PI) * 10) / 10;
    } catch {
      // Unparseable transform — fall through to 0.
    }
  }
  return 0;
}

/**
 * Parse a CSS `scale` property value (e.g. "-1 1", "1", "none") into two
 * numeric components [scaleX, scaleY]. Defaults both axes to 1 when absent
 * or unparseable, matching the CSS initial value.
 */
function parseScaleValue(value: string | undefined): [number, number] {
  if (!value || value === "none") return [1, 1];
  const parts = value.trim().split(/\s+/);
  const x = Number(parts[0]);
  const y = parts.length > 1 ? Number(parts[1]) : x;
  return [Number.isFinite(x) ? x : 1, Number.isFinite(y) ? y : 1];
}

function mergeRotationValue(transform: string | undefined, degrees: number) {
  const nextRotate = `rotate(${Math.round(degrees * 10) / 10}deg)`;
  if (!transform || transform === "none") return nextRotate;
  // Replace an existing rotate()/rotateZ() in ANY unit so we don't append a
  // second rotate() (which would compound, e.g. "rotate(0.5turn) rotate(30deg)").
  if (ROTATE_FN_PATTERN.test(transform)) {
    return transform.replace(ROTATE_FN_PATTERN, nextRotate);
  }
  return `${transform} ${nextRotate}`;
}

/**
 * Replace or remove a translateX/translateY function within an existing
 * transform string while preserving all other transform functions (rotate,
 * scale, skew, etc.). Pass `null` as `value` to strip the function.
 */
function mergeTranslateFunction(
  transform: string | undefined,
  axis: "X" | "Y",
  value: string | null,
): string {
  const pattern =
    axis === "X" ? /translateX\([^)]*\)/g : /translateY\([^)]*\)/g;
  const base = (!transform || transform === "none" ? "" : transform)
    .replace(pattern, "")
    .trim();
  if (value === null) return base || "none";
  const fn = `translate${axis}(${value})`;
  return base ? `${fn} ${base}` : fn;
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
  ariaLabel,
  tooltipLabel,
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
  ariaLabel?: string;
  tooltipLabel?: string;
}) {
  return (
    <ScrubInput
      label={label}
      ariaLabel={ariaLabel}
      tooltipLabel={tooltipLabel}
      icon={hideIcon ? null : undefined}
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
 * Block-level container tags that act the same way frames. Selecting any of
 * these shows the Auto layout section (in an "add" state when not yet flex),
 * mirroring the editor pattern where any frame/container exposes auto-layout controls.
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
 * children show the full Auto layout section the same way does.
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
 * Per-axis sizing availability following the design editor's contextual rules:
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

/**
 * Return the element's geometric dimension on the given axis in CSS pixels.
 *
 * `getComputedStyle().width/height` always resolves to a computed px value
 * (even for `width: auto` the browser returns e.g. "200px"). For rotated
 * elements this is the pre-rotation CSS box size — what Figma shows in the
 * inspector — while `getBoundingClientRect().width/height` would be the
 * axis-aligned bounding box which is inflated by the rotation.
 *
 * Falls back to the bounding-rect dimension only when the computed style is
 * missing or unparseable (e.g. the bridge hasn't populated it yet).
 */
function cssElementSize(
  element: ElementInfo,
  axis: AutoLayoutSizingAxis,
): number {
  const isHorizontal = axis === "horizontal";
  const cssValue = isHorizontal
    ? element.computedStyles.width
    : element.computedStyles.height;
  const parsed = parseFloat(cssValue || "");
  const fallback = isHorizontal
    ? element.boundingRect.width
    : element.boundingRect.height;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  // Use CSS computed dimension (pre-rotation box size) as the seed for "fixed"
  // sizing so a rotated element is locked to its actual CSS width/height rather
  // than the inflated axis-aligned bounding rect.
  const resolvedSize = Math.max(1, Math.round(cssElementSize(element, axis)));
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

/**
 * Small modal that prompts for a component name, then promotes the current
 * selection into a reusable component via `onSubmit`.
 */
function CreateComponentDialog({
  open,
  onOpenChange,
  defaultName,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(defaultName);

  // Reset the field to the freshest default each time the dialog opens.
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const commit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSubmit(trimmed);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {"Create component" /* i18n-ignore design inspector action */}
          </DialogTitle>
          <DialogDescription>
            {
              "Name this element so it becomes a reusable component. The agent can then extract props and replace repeated instances." /* i18n-ignore design inspector copy */
            }
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label
            htmlFor="create-component-name"
            className="text-[11px] font-medium text-muted-foreground"
          >
            {"Component name" /* i18n-ignore design inspector label */}
          </Label>
          <Input
            id="create-component-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
            }}
            placeholder={
              "PrimaryButton" /* i18n-ignore design inspector placeholder */
            }
          />
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {"Cancel" /* i18n-ignore design inspector action */}
          </Button>
          <Button type="button" onClick={commit} disabled={!name.trim()}>
            {"Create" /* i18n-ignore design inspector action */}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Build a `vscode://file/...` deep link for an absolute path + position. */
function vscodeDeepLink(
  absolutePath: string,
  line?: number,
  column?: number,
): string {
  const base = `vscode://file/${absolutePath}`;
  if (line == null) return base;
  return column == null ? `${base}:${line}` : `${base}:${line}:${column}`;
}

/**
 * Extract the *opening tag* from an element's outer HTML for an at-a-glance
 * summary (e.g. `<main class="hero" data-x="y">`). Self-closing tags keep
 * their `/>`. Returns `null` when no tag can be parsed.
 *
 * Pure — exported for tests.
 */
export function openingTagOf(html: string | null | undefined): string | null {
  if (!html) return null;
  const trimmed = html.trimStart();
  // Match the first `<tag ...>` (greedy up to the first unquoted `>`), allowing
  // quoted attribute values to contain `>`.
  const match = /^<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>])*?)\/?>/.exec(
    trimmed,
  );
  if (!match) return null;
  return match[0];
}

/**
 * Collapse long attribute values in an opening tag so the at-a-glance summary
 * stays readable. Values longer than `max` chars are truncated with an
 * ellipsis (the surrounding quotes are preserved).
 *
 * Pure — exported for tests.
 */
export function truncateOpeningTag(openTag: string, max = 32): string {
  return openTag.replace(
    /("|')((?:\\.|(?!\1)[^\\])*)\1/g,
    (full, quote, value) => {
      if (typeof value !== "string" || value.length <= max) return full;
      return `${quote}${value.slice(0, max - 1)}…${quote}`;
    },
  );
}

/**
 * Parse the top-level `key: value` pairs from an Alpine `x-data` object literal
 * (e.g. `{ variant: 'outline', size: 'lg', disabled: false }`).
 *
 * Best-effort: only handles a flat object of simple string / boolean / number
 * literals — exactly the shape used for component variant + state props. Nested
 * objects, methods, and computed expressions are ignored. Returns `null` when
 * the value is not a recognizable flat object literal.
 *
 * Pure — exported for tests.
 */
export function parseAlpineDataObject(
  xData: string | null | undefined,
): Record<string, string> | null {
  if (!xData) return null;
  const trimmed = xData.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return {};

  const out: Record<string, string> = {};
  // Split on top-level commas only (no nesting / quotes inside values here).
  const pairRe =
    /(?:^|,)\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*('[^']*'|"[^"]*"|true|false|-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  let matched = false;
  while ((m = pairRe.exec(inner)) !== null) {
    matched = true;
    const key = m[1] ?? m[2] ?? m[3];
    let raw = m[4]!;
    // Unwrap quotes for string literals; keep booleans / numbers verbatim.
    if (
      (raw.startsWith("'") && raw.endsWith("'")) ||
      (raw.startsWith('"') && raw.endsWith('"'))
    ) {
      raw = raw.slice(1, -1);
    }
    if (key) out[key] = raw;
  }
  // If there was content but nothing parsed, the shape is too complex to edit
  // safely — bail so the caller falls back to attribute-based prop edits.
  if (!matched) return null;
  return out;
}

/**
 * Re-serialize a flat Alpine data object back into an `x-data` literal,
 * preserving boolean / number literals unquoted and single-quoting strings.
 *
 * Pure — exported for tests.
 */
export function serializeAlpineDataObject(obj: Record<string, string>): string {
  const parts = Object.entries(obj).map(([key, value]) => {
    const isBoolean = value === "true" || value === "false";
    const isNumber = /^-?\d+(\.\d+)?$/.test(value);
    const literal =
      isBoolean || isNumber ? value : `'${value.replace(/'/g, "\\'")}'`;
    return `${key}: ${literal}`;
  });
  return parts.length ? `{ ${parts.join(", ")} }` : "{}";
}

/** A boolean-ish prop value (`"true"` / `"false"`), case-insensitive. */
export function isBooleanPropValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === "true" || v === "false";
}

/**
 * Popover anchored to the "Inspect code" button showing the selected node's
 * code.  Inline/Alpine sources show the element's outer HTML with a Copy
 * button; real-app sources additionally render an "Open in VS Code" button.
 *
 * TODO: replace the read-only <pre> with an inline Monaco editor for richer
 * (editable) code inspection once the editor bundle is wired into the inspector.
 */
function InspectCodePopover({
  trigger,
  data,
}: {
  trigger: ReactNode;
  data: InspectCodeData;
}) {
  const [copied, setCopied] = useState(false);
  const html = data.html ?? "";
  const source = data.sourceLocation ?? null;
  const snippet = source?.snippet || html;
  // At-a-glance opening tag (tag name + attributes), truncated for readability.
  const openingTag = (() => {
    const raw = openingTagOf(html);
    return raw ? truncateOpeningTag(raw) : null;
  })();

  const handleCopy = () => {
    if (!snippet) return;
    void navigator.clipboard
      ?.writeText(snippet)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {
        /* clipboard may be unavailable; ignore */
      });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-2 text-[11px]">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
            {"Inspect code" /* i18n-ignore design inspector label */}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={handleCopy}
            disabled={!snippet}
          >
            {
              copied
                ? "Copied" /* i18n-ignore design inspector action */
                : "Copy" /* i18n-ignore design inspector action */
            }
          </Button>
        </div>

        {/* At-a-glance opening tag (tag name + attributes) above the full HTML. */}
        {openingTag && (
          <code
            className="block truncate rounded bg-[var(--design-editor-control-bg)] px-2 py-1 font-mono text-[10px] text-foreground"
            title={openingTag}
          >
            {openingTag}
          </code>
        )}

        {source && (
          <div
            className="flex items-center gap-1 rounded bg-[var(--design-editor-control-bg)] px-2 py-1"
            title={source.absolutePath}
          >
            <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {source.absolutePath}
              {source.line != null ? `:${source.line}` : ""}
            </span>
          </div>
        )}

        {snippet ? (
          <pre className="max-h-64 overflow-auto rounded bg-[var(--design-editor-control-bg)] p-2 font-mono text-[10px] leading-relaxed text-foreground">
            <code>{snippet}</code>
          </pre>
        ) : (
          <p className="px-1 py-2 text-muted-foreground">
            {
              "No source available for this element." /* i18n-ignore design inspector empty */
            }
          </p>
        )}

        {source && (
          <a
            href={vscodeDeepLink(
              source.absolutePath,
              source.line,
              source.column,
            )}
            className="block"
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-full gap-1.5 text-[11px]"
            >
              <IconExternalLink className="size-3.5" />
              {"Open in VS Code" /* i18n-ignore design inspector action */}
            </Button>
          </a>
        )}
      </PopoverContent>
    </Popover>
  );
}

function elementTypeIcon(element: ElementInfo) {
  const tag = element.tagName || "element";
  if (TEXT_TAGS.has(tag)) return IconTypography;
  if (tag === "img" || tag === "video" || tag === "picture") return IconPhoto;
  if (tag === "svg" || tag === "path") return IconVector;
  if (tag === "button" || tag === "a") return IconComponents;
  return IconFrame;
}

function SelectionHeader({
  element,
  onCreateComponent,
  inspectCodePopover,
}: {
  element: ElementInfo | null;
  /** Promote the current selection into a reusable component. Omit/undefined to disable. */
  onCreateComponent?: () => void;
  /**
   * Render prop for the "Inspect code" affordance. Receives the trigger button
   * so the parent can anchor a Popover to it; returns the full popover element.
   * When omitted the button renders disabled.
   */
  inspectCodePopover?: (trigger: ReactNode) => ReactNode;
}) {
  if (!element) return null;

  const title = inspectorObjectTitle(element);
  const TypeIcon = elementTypeIcon(element);

  const inspectTrigger = (
    <SectionIconButton
      label={"Inspect code" /* i18n-ignore design inspector action */}
      disabled={!inspectCodePopover}
    >
      <IconCode className="size-3.5" />
    </SectionIconButton>
  );

  return (
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-2 border-b border-border/90 px-3">
      {/* Node-type label. Rename lives in the layers panel and device sizing
          lives elsewhere, so this is a plain non-interactive label. */}
      <div className="flex min-w-0 items-center gap-1.5 text-left text-[13px] font-semibold text-foreground">
        <TypeIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{title}</span>
      </div>
      {/* Right-aligned quick actions: create-component + dev inspect (</>) */}
      <div className="flex shrink-0 items-center gap-0.5">
        <SectionIconButton
          label={"Create component" /* i18n-ignore design inspector action */}
          disabled={!onCreateComponent}
          onClick={onCreateComponent}
        >
          <IconComponents className="size-3.5" />
        </SectionIconButton>
        {inspectCodePopover
          ? inspectCodePopover(inspectTrigger)
          : inspectTrigger}
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
    <div className="flex min-h-8 shrink-0 items-center justify-between gap-1 border-b border-border/90 px-2 py-1">
      <Tabs
        value={activeTab}
        onValueChange={(value) => onActiveTabChange(value as InspectorTab)}
      >
        <TabsList className="h-7 justify-start gap-0.5 rounded-none bg-transparent p-0">
          <TabsTrigger
            value="design"
            className="h-6 rounded-md px-1.5 text-[11px] font-semibold text-muted-foreground shadow-none transition-colors hover:text-foreground data-[state=active]:bg-[var(--design-editor-panel-raised-bg)] data-[state=active]:text-foreground data-[state=active]:shadow-none"
          >
            {"Design" /* i18n-ignore design inspector tab */}
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
 * Section-header toggle icon (the design editor's right-aligned section actions, e.g. the
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
    <div className="flex w-fit max-w-full min-w-0 overflow-hidden rounded-md bg-[var(--design-editor-control-bg)]">
      {children}
    </div>
  );
}

function TextResizeControls({
  resizeMode,
  onResizeModeChange,
}: {
  resizeMode: TextResizeMode;
  onResizeModeChange: (mode: TextResizeMode) => void;
}) {
  const t = useT();

  return (
    <InspectorSegment>
      <InspectorIconButton
        label={t("editPanel.textResize.autoWidth")}
        active={resizeMode === "auto-width"}
        onClick={() => onResizeModeChange("auto-width")}
      >
        <IconArrowAutofitWidth className="size-3.5" />
      </InspectorIconButton>
      <InspectorIconButton
        label={t("editPanel.textResize.autoHeight")}
        active={resizeMode === "auto-height"}
        onClick={() => onResizeModeChange("auto-height")}
      >
        <IconArrowAutofitHeight className="size-3.5" />
      </InspectorIconButton>
      <InspectorIconButton
        label={t("editPanel.textResize.fixed")}
        active={resizeMode === "fixed"}
        onClick={() => onResizeModeChange("fixed")}
      >
        <IconSquare className="size-3.5" />
      </InspectorIconButton>
    </InspectorSegment>
  );
}

function TypographyDetailsPopover({
  resizeMode,
  onResizeModeChange,
}: {
  resizeMode: TextResizeMode;
  onResizeModeChange: (mode: TextResizeMode) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={"Typography details" /* i18n-ignore design action */}
          aria-pressed={open}
          className={cn(
            "h-6 min-w-6 cursor-pointer rounded-md text-muted-foreground hover:bg-[var(--design-editor-panel-raised-bg)] hover:text-foreground",
            open &&
              "bg-[var(--design-editor-accent-color)]/20 text-[var(--design-editor-accent-color)] hover:text-[var(--design-editor-accent-color)]",
          )}
        >
          <IconLayoutSettings className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="end"
        sideOffset={8}
        className="z-[100010] w-[360px] rounded-xl border-[var(--design-editor-control-border)] bg-[var(--design-editor-panel-bg)] p-0 text-foreground shadow-2xl"
      >
        <div className="flex items-center gap-1 border-b border-[var(--design-editor-control-border)] p-2.5">
          <div className="flex rounded-md bg-[var(--design-editor-control-bg)] p-0.5">
            <span className="rounded bg-[var(--design-editor-panel-raised-bg)] px-2.5 py-1 text-[11px] font-semibold text-foreground">
              {"Basics" /* i18n-ignore design typography details tab */}
            </span>
            <span className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {"Details" /* i18n-ignore design typography details tab */}
            </span>
            <span className="px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
              {"Variable" /* i18n-ignore design typography details tab */}
            </span>
          </div>
        </div>
        <div className="space-y-3 p-4 text-[11px]">
          <div className="flex h-20 items-center justify-center rounded-md bg-[var(--design-editor-control-bg)] text-[18px] text-muted-foreground/80">
            {"Preview" /* i18n-ignore design typography details preview */}
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="text-[11px] font-medium text-muted-foreground">
              {"Text box" /* i18n-ignore design typography details label */}
            </span>
            <TextResizeControls
              resizeMode={resizeMode}
              onResizeModeChange={onResizeModeChange}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
    label: t(`editPanel.labels.${option.key}`),
  }));
  const prefix = kind === "border" ? "border" : "outline";
  const position = kind === "border" ? "inside" : "outside";

  const movePosition = (next: string) => {
    if (next === position) return;
    const nextPrefix = next === "outside" ? "outline" : "border";
    onStyleChange(`${nextPrefix}Color`, color);
    onStyleChange(`${nextPrefix}Width`, width || "1px");
    // Preserve the original border-style so a hidden stroke (style:none, kept
    // visible as a row because width>0) stays hidden when its position moves
    // between inside/outside. Only default to solid when there's no style at all.
    onStyleChange(`${nextPrefix}Style`, styleValue || "solid");
    onRemove();
  };

  return (
    <div className="space-y-1.5">
      {/* design stroke row: [swatch+hex trigger (flex-1)] [eye] [remove] */}
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
      {/* design stroke geometry: position + weight side by side */}
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
    tokens.find((token) => parseCssColor(token) || token === "transparent") ??
    // Preserve a color we don't parse into RGBA (currentColor, var(--x), or any
    // unrecognized keyword): the color is the non-inset token that doesn't look
    // like a numeric length. Without this, tweaking x/y/blur would reset it to
    // the hardcoded default below.
    tokens.find((token) => token !== "inset" && !/^[-+]?[\d.]/.test(token)) ??
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
        `${layer.inset ? Math.round(layer.spread) : Math.max(0, Math.round(layer.spread))}px`,
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
      {/* design effect row: [swatch+label+x,y,blur trigger (flex-1)] [remove] */}
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
              onChange={(value) =>
                onChange({ spread: layer.inset ? value : Math.max(0, value) })
              }
              unit="px"
              min={layer.inset ? undefined : 0}
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
  onStylesChange,
}: {
  styles: Record<string, string>;
  onStyleChange: (property: string, value: string) => void;
  onStylesChange?: (styles: Record<string, string>) => void;
}) {
  const t = useT();
  const baseFontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontFamily = resolveFontFamilySelectValue(styles.fontFamily);
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.some(
    (option) => option.value === fontFamily,
  )
    ? baseFontFamilyOptions
    : [
        {
          value: fontFamily,
          label: displayFontFamilyName(styles.fontFamily || fontFamily),
        },
        ...baseFontFamilyOptions,
      ];

  return (
    <div>
      <PanelSection title={t("editPanel.sections.page")}>
        <ColorInput
          label={t("editPanel.labels.background")}
          value={styles.backgroundColor || ""}
          onChange={(v) => onStyleChange("backgroundColor", v)}
          backgroundImage={styles.backgroundImage || ""}
          onBackgroundImageChange={(v) => onStyleChange("backgroundImage", v)}
          onImageFillChange={(value) =>
            commitStylePatch(
              imageFillToBackgroundStyles(value),
              onStyleChange,
              onStylesChange,
            )
          }
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
  const baseFontFamilyOptions = FONT_FAMILY_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontFamilies.${option.key}`),
  }));
  const fontFamily = resolveFontFamilySelectValue(styles.fontFamily);
  const fontFamilyOptions = FONT_FAMILY_OPTIONS.some(
    (option) => option.value === fontFamily,
  )
    ? baseFontFamilyOptions
    : [
        {
          value: fontFamily,
          label: displayFontFamilyName(styles.fontFamily || fontFamily),
        },
        ...baseFontFamilyOptions,
      ];
  const fontWeightOptions = FONT_WEIGHT_OPTIONS.map((option) => ({
    value: option.value,
    label: t(`editPanel.fontWeights.${option.key}`),
  }));
  const textAlign = styles.textAlign || "left";

  // M1 · Text resizing mode (auto-width / auto-height / fixed). the design editor's text
  // nodes always expose this segment. Infer the current mode from the live CSS:
  // auto-width hugs both axes (width:auto + no wrapping), auto-height hugs the
  // height only (fixed width, content wraps), fixed pins both width and height.
  const widthIsAuto =
    !styles.width || styles.width === "auto" || styles.width === "max-content";
  const heightIsAuto = !styles.height || styles.height === "auto";
  const noWrap = styles.whiteSpace === "nowrap";
  const resizeMode: TextResizeMode =
    widthIsAuto && noWrap
      ? "auto-width"
      : !heightIsAuto && !widthIsAuto
        ? "fixed"
        : "auto-height";
  const currentWidth = styles.width && !widthIsAuto ? styles.width : "200px";
  const currentHeight = styles.height && !heightIsAuto ? styles.height : "48px";
  const setResizeMode = (mode: TextResizeMode) => {
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
  // containers (display:flex) the design editor maps this to `justifyContent`; for normal
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
      {/* Row 1: font family full-width.
          Wrapped in a height-constrained div so the SelectTrigger button's
          hit-target is exactly h-6 (24 px) and cannot visually or physically
          overlap the weight/size row below (bug: trigger extended ~12 px into
          the next row, causing clicks meant for the size input to open this
          dropdown instead). */}
      <div className="h-6 overflow-hidden">
        <Select
          value={fontFamily}
          onValueChange={(v) => onStyleChange("fontFamily", v)}
        >
          <SelectTrigger
            aria-label={t("editPanel.labels.font")}
            className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
          >
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
      </div>

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

      {/* Row 3: line-height + letter-spacing with design-editor leading icons */}
      <div className="grid grid-cols-2 gap-1.5">
        <ScrubInput
          label={t("editPanel.labels.lineHeight")}
          ariaLabel={t("editPanel.labels.lineHeight")}
          icon={IconLineHeight}
          value={resolveLineHeight(styles.lineHeight, styles.fontSize)}
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
      <div className="flex items-center gap-1.5">
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
            label={"Align top" /* i18n-ignore design vertical text align */}
            active={verticalAlign === "top"}
            onClick={() => setVerticalAlign("top")}
          >
            <IconLayoutAlignTop className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={"Align middle" /* i18n-ignore design vertical text align */}
            active={verticalAlign === "middle"}
            onClick={() => setVerticalAlign("middle")}
          >
            <IconLayoutAlignMiddle className="size-3.5" />
          </InspectorIconButton>
          <InspectorIconButton
            label={"Align bottom" /* i18n-ignore design vertical text align */}
            active={verticalAlign === "bottom"}
            onClick={() => setVerticalAlign("bottom")}
          >
            <IconLayoutAlignBottom className="size-3.5" />
          </InspectorIconButton>
        </InspectorSegment>
        <div className="ml-auto shrink-0">
          <TypographyDetailsPopover
            resizeMode={resizeMode}
            onResizeModeChange={setResizeMode}
          />
        </div>
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
  const mainGapAxis =
    flexDirection === "horizontal" ? "horizontal" : "vertical";
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
      horizontal: cssElementSize(element, "horizontal"),
      vertical: cssElementSize(element, "vertical"),
    },
    // Forward the raw CSS display so the matrix can render the correct Flow
    // state (normal flow for block/grid, flex for flex/inline-flex). Added as an
    // optional contract field consumed by AutoLayoutMatrix; harmless when the
    // matrix ignores it.
    ...({ display } as Partial<AutoLayoutMatrixValue>),
    spaceBetween: styles.justifyContent === "space-between",
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
          const avg = Math.round(
            (padding.top + padding.right + padding.bottom + padding.left) / 4,
          );
          onStyleChange("paddingTop", `${avg}px`);
          onStyleChange("paddingRight", `${avg}px`);
          onStyleChange("paddingBottom", `${avg}px`);
          onStyleChange("paddingLeft", `${avg}px`);
        }}
        onClipContentChange={(clipContent) =>
          onStyleChange("overflow", clipContent ? "hidden" : "visible")
        }
        onDistribute={(axis) => {
          if (axis === mainGapAxis) {
            onStyleChange("justifyContent", "space-between");
          } else if (autoLayoutValue.wrap === "wrap") {
            onStyleChange("alignContent", "space-between");
          }
        }}
        onGapModeChange={(gapMode, axis) => {
          if (axis !== mainGapAxis) return;
          ensureFlex();
          onStyleChange(
            "justifyContent",
            gapMode === "auto" ? "space-between" : "flex-start",
          );
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
        onChildSizeChange={(axis, px) =>
          onStyleChange(axis === "horizontal" ? "width" : "height", `${px}px`)
        }
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
  // design W/H sizing block instead.
  if (!isContainer) {
    return (
      <PanelSection title={t("editPanel.sections.layout")}>
        {/* design-editor single-row-per-axis: [W | value | Fixed/Hug/Fill ▾] with
            the full sizing menu (modes + min/max + variable) per axis. */}
        <div className="grid grid-cols-2 items-start gap-1.5">
          <SizingField
            axis="W"
            sizingAxis="horizontal"
            value={inferElementSizing(element, "horizontal")}
            resolvedSize={cssElementSize(element, "horizontal")}
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
            onSizeChange={(px) => onStyleChange("width", `${px}px`)}
            onMinMaxChange={(axis, kind, val) =>
              commitElementMinMax(axis, kind, val, onStyleChange)
            }
          />
          <SizingField
            axis="H"
            sizingAxis="vertical"
            value={inferElementSizing(element, "vertical")}
            resolvedSize={cssElementSize(element, "vertical")}
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
            onSizeChange={(px) => onStyleChange("height", `${px}px`)}
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
  // default, or flex when it uses flexbox. the design editor never makes you "add" auto
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
 * design layout-guide section. Shown for frame/container
 * elements. Renders an overlay column/row guide by applying a non-destructive
 * `backgroundImage` repeating gradient layer tagged so it can be toggled off
 * without disturbing real fills.
 */
const LAYOUT_GUIDE_MARKER = "/* an-layout-guide */";

function hasLayoutGuide(styles: Record<string, string>): boolean {
  return Boolean(styles.backgroundImage?.includes(LAYOUT_GUIDE_MARKER));
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
    // 12-column overlay guide — the design editor's default columns layout grid.
    // The LAYOUT_GUIDE_MARKER comment is embedded so hasLayoutGuide and removeGuide
    // can detect/remove it without touching unrelated repeating-linear-gradient fills.
    const guide = `repeating-linear-gradient(to right, color-mix(in srgb, var(--design-editor-accent-color) 22%, transparent) 0 1px, transparent 1px calc(100% / 12)) ${LAYOUT_GUIDE_MARKER}`;
    const existing = compactCssValue(styles.backgroundImage, "");
    onStyleChange(
      "backgroundImage",
      existing ? `${guide}, ${existing}` : guide,
    );
  };

  const removeGuide = () => {
    const layers = splitCssLayers(styles.backgroundImage || "").filter(
      (layer) => !layer.includes(LAYOUT_GUIDE_MARKER),
    );
    onStyleChange(
      "backgroundImage",
      layers.length ? joinCssLayers(layers) : "none",
    );
  };

  return (
    <PanelSection
      title={"Layout guide" /* i18n-ignore design inspector label */}
      defaultCollapsed
      actions={
        <SectionIconButton
          label={
            active
              ? "Remove layout guide" /* i18n-ignore design inspector action */
              : "Add layout guide" /* i18n-ignore design inspector action */
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
            {"Columns" /* i18n-ignore design inspector label */}
          </span>
          <span className="shrink-0 tabular-nums">12</span>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          {"No layout guides" /* i18n-ignore design inspector empty state */}
        </p>
      )}
    </PanelSection>
  );
}

/**
 * Togglable export preview thumbnail (the design editor shows a small preview of the export
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
  // Reflect the active packing in the alignment segments (the design editor highlights the
  // current alignment). For a flex container the main axis is justifyContent.
  const alignH = justifyToHorizontal(styles.justifyContent);
  const alignV = alignToVertical(styles.alignItems);
  const constraintsValue: ConstraintsValue = {
    horizontal:
      // Check scale before left+right: "scale" writes width:100% and clears
      // left/right to auto, but legacy data may have 0px values that are truthy.
      styles.width === "100%"
        ? "scale"
        : styles.left && styles.right
          ? "left-right"
          : styles.right
            ? "right"
            : styles.transform?.includes("translateX(-50%)")
              ? "center"
              : "left",
    vertical:
      styles.height === "100%"
        ? "scale"
        : styles.top && styles.bottom
          ? "top-bottom"
          : styles.bottom
            ? "bottom"
            : styles.transform?.includes("translateY(-50%)")
              ? "center"
              : "top",
  };

  const handleConstraintsChange = useCallback(
    (value: ConstraintsValue) => {
      onStyleChange("position", "absolute");

      // Compute the desired translateX/Y for each axis independently, then
      // compose both into a single transform write so the two axes don't
      // overwrite each other when both change simultaneously.
      const txValue = value.horizontal === "center" ? "-50%" : null;
      const tyValue = value.vertical === "center" ? "-50%" : null;
      // Start from the current transform, apply X, then apply Y on top.
      const transformAfterX = mergeTranslateFunction(
        styles.transform,
        "X",
        txValue,
      );
      const transformAfterXY = mergeTranslateFunction(
        transformAfterX,
        "Y",
        tyValue,
      );

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
      } else {
        // scale: use auto (not 0px) so the left && right truthiness check
        // in the reader does not misidentify this as "left-right".
        onStyleChange("left", "auto");
        onStyleChange("right", "auto");
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
      } else {
        // scale
        onStyleChange("top", "auto");
        onStyleChange("bottom", "auto");
        onStyleChange("height", "100%");
      }

      // Write the composed transform once, after both axes are resolved.
      onStyleChange("transform", transformAfterXY);
    },
    [
      element.boundingRect.x,
      element.boundingRect.y,
      onStyleChange,
      styles.left,
      styles.top,
      styles.transform,
    ],
  );

  return (
    <PanelSection
      title={t("editPanel.sections.positionLayout")}
      actions={
        <SectionIconToggle
          label={"Absolute position" /* i18n-ignore design inspector action */}
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
          {"Alignment" /* i18n-ignore design inspector label */}
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
            ariaLabel="X-position"
            tooltipLabel="X-position"
            value={styles.left || ""}
            placeholder={element.boundingRect.x}
            inputClassName="h-6"
            onChange={(v) => onStyleChange("left", `${Math.round(v)}px`)}
          />
          <ScrubStyleInput
            label="Y"
            ariaLabel="Y-position"
            tooltipLabel="Y-position"
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
              onClick={() => {
                const [sx, sy] = parseScaleValue(styles.scale);
                onStyleChange("scale", `${sx === -1 ? 1 : -1} ${sy}`);
              }}
            >
              <IconFlipHorizontal className="size-4" />
            </InspectorIconButton>
            <InspectorIconButton
              label={t("editPanel.labels.flipVertical")}
              onClick={() => {
                const [sx, sy] = parseScaleValue(styles.scale);
                onStyleChange("scale", `${sx} ${sy === -1 ? 1 : -1}`);
              }}
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
  // visible again restores the exact original value (the design editor never loses color).
  // Keyed by a stable selected-element identity so anonymous same-tag elements
  // don't share stash slots.
  const [hiddenFillStash, setHiddenFillStash] = useState<
    Record<string, string>
  >({});
  // Same non-destructive idea for background gradient/image layers: stash the
  // exact layer string on hide so per-stop opacity survives a hide→show toggle
  // instead of being flattened to all-0 then all-100.
  const [hiddenLayerStash, setHiddenLayerStash] = useState<
    Record<string, string>
  >({});
  const stashKey = `${elementIdentityKey(element)}:${fillProperty}`;
  const isHidden = !colorHasVisibleAlpha(fillValue);
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
          {/* design color-styles affordance (grid icon) to the left of "+". */}
          <SectionIconButton
            label={"Styles" /* i18n-ignore design inspector action */}
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
            /* design row: [swatch+hex trigger (flex-1)] [eye] [remove] */
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
                  pickerKey={[
                    element.sourceId ??
                      element.id ??
                      element.selector ??
                      element.tagName,
                    fillProperty,
                  ].join(":")}
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
                const layerStashKey = `${elementIdentityKey(element)}:layer:${index}`;
                const stashedLayer = hiddenLayerStash[layerStashKey];
                const hiddenImagePlaceholder = Boolean(
                  stashedLayer && gradient && opacity <= 0,
                );
                const label = gradient
                  ? hiddenImagePlaceholder
                    ? `${"Image" /* i18n-ignore design inspector paint row */} ${
                        index + 1
                      }`
                    : `${gradientLabel(gradient.type)} ${index + 1}`
                  : `${"Image" /* i18n-ignore design inspector paint row */} ${
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
                  /* design row: [swatch+label+opacity% trigger (flex-1)] [eye] [remove] */
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
                        <DesignColorPicker
                          value={gradient?.stops[0]?.color ?? layer}
                          onPaintValueChange={replaceLayer}
                          onChange={(nextColor) => {
                            if (!gradient) return;
                            const firstStop = gradient.stops[0];
                            if (!firstStop) return;
                            replaceLayer(
                              buildGradientLayer(
                                gradient.type,
                                [
                                  { ...firstStop, color: nextColor },
                                  ...gradient.stops.slice(1),
                                ],
                                gradient.prefix,
                              ),
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
                        if (opacity <= 0) {
                          // Show: restore the exact pre-hide layer if stashed,
                          // otherwise fall back to forcing every stop opaque.
                          const stashed = hiddenLayerStash[layerStashKey];
                          if (stashed !== undefined) {
                            replaceLayer(stashed);
                            setHiddenLayerStash((prev) => {
                              const next = { ...prev };
                              delete next[layerStashKey];
                              return next;
                            });
                          } else if (gradient) {
                            replaceLayer(
                              buildGradientLayer(
                                gradient.type,
                                gradient.stops.map((stop) => ({
                                  ...stop,
                                  opacity: 100,
                                })),
                                gradient.prefix,
                              ),
                            );
                          }
                          return;
                        }
                        if (!gradient) {
                          setHiddenLayerStash((prev) => ({
                            ...prev,
                            [layerStashKey]: layer,
                          }));
                          replaceLayer(
                            buildGradientLayer("linear", [
                              {
                                id: "stop-0",
                                color: "rgba(0, 0, 0, 0)",
                                position: 0,
                                opacity: 0,
                              },
                              {
                                id: "stop-1",
                                color: "rgba(0, 0, 0, 0)",
                                position: 100,
                                opacity: 0,
                              },
                            ]),
                          );
                        } else {
                          // Hide: stash the current layer (with its real per-stop
                          // opacities) before zeroing every stop's alpha.
                          setHiddenLayerStash((prev) => ({
                            ...prev,
                            [layerStashKey]: layer,
                          }));
                          replaceLayer(
                            buildGradientLayer(
                              gradient.type,
                              gradient.stops.map((stop) => ({
                                ...stop,
                                opacity: 0,
                              })),
                              gradient.prefix,
                            ),
                          );
                        }
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
  // Render the row whenever a stroke has been configured (non-zero width),
  // even when its style is "none" (hidden). This mirrors Figma's behavior where
  // hidden stroke rows remain present so the user can re-show them via the eye icon.
  const borderExists = cssLengthNumber(styles.borderWidth) > 0;
  const outlineExists = cssLengthNumber(styles.outlineWidth) > 0;

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
      {borderExists ? (
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
      {outlineExists ? (
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
          {/* Opacity / blend-mode affordance — matches the design editor's pill icon */}
          <SectionIconButton
            label={
              "Opacity & blend mode" /* i18n-ignore design inspector action */
            }
          >
            <IconSlice className="size-3.5" />
          </SectionIconButton>
          {/* Visibility toggle */}
          <SectionIconToggle
            label={
              hidden
                ? "Show" /* i18n-ignore design inspector action */
                : "Hide" /* i18n-ignore design inspector action */
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
          {/* Styles / fill library affordance — matches the design editor's droplet icon */}
          <SectionIconButton
            label={"Styles" /* i18n-ignore design inspector action */}
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
  // M5 · Background (backdrop) blur is a distinct design effect type, backed by
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
              {"Background blur" /* i18n-ignore design effect type */}
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
        /* design effect row for layer blur: flat row matching shadow rows */
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
              onChange={(value) => {
                const blurFn = `blur(${Math.max(0, Math.round(value))}px)`;
                const existing = styles.filter || "";
                const next = existing.includes("blur(")
                  ? existing.replace(/blur\([^)]*\)/, blurFn)
                  : blurFn;
                onStyleChange("filter", next);
              }}
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
                  {"Background blur" /* i18n-ignore design effect type */}
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

/** Uppercase 6-char hex (no #) for a CSS color, matching the design editor's row readout. */
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
  // M6 · the design editor's Selection colors collapses to a single "Show selection colors"
  // affordance, expanding to one editable [swatch · hex · opacity] row per
  // unique color — matching the Fill row grammar instead of a swatch strip.
  const [expanded, setExpanded] = useState(false);
  const colors = selectionColorValues(element);
  if (!colors.length) return null;

  return (
    <PanelSection
      title={"Selection colors" /* i18n-ignore design inspector label */}
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
                  <DesignColorPicker
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
            {"Show selection colors" /* i18n-ignore design inspector label */}
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

// ─── Make it real — inline upgrade card (§3, §6.6) ──────────────────────────

/**
 * Payload shape returned by `connect-builder-app`.  Only the fields used by
 * the card UI are typed here; the action may return additional fields.
 */
interface ConnectBuilderAppResult {
  connected: boolean;
  builderEnabled: boolean;
  connectUrl: string;
  appHost: string;
  branchProjectId?: string;
  cta: {
    kind: "connect-builder" | "configure-project";
    label: string;
    description: string;
    primaryAction: string;
    connectUrl: string;
  } | null;
  message: string;
}

/**
 * Inline "Make it real" upgrade card.
 *
 * Rendered wherever a real-app-only control is reached on an inline design
 * (Component source jump, token write-back, live captures, etc.).  Queries
 * `connect-builder-app` to determine the current connection state, then
 * offers the appropriate CTA:
 *
 *   - Not connected → "Connect Builder.io" button (opens connectUrl)
 *   - Connected, no project → "Open Builder settings" (configure project ID)
 *   - Fully enabled → "Make it real" button (calls migrate-inline-design-to-app)
 *
 * The card is progressively disclosed: it only mounts when a gated control is
 * actually reached, so it never appears for users who are already on a real-app
 * source (`localhost` / `fusion`) or whose `sourceCapabilities` already include
 * the needed capability.
 *
 * Matches the design-editor panel chrome: dashed-border, accent tint, small
 * text at 10px — same idiom as the existing `ctaRequired` block in
 * ComponentSection.
 */
function MakeItRealCard({
  designId,
  featureLabel,
}: {
  /** The active design id — required to call connect-builder-app. */
  designId: string;
  /**
   * Short human-readable label for the gated feature (e.g. "token write-back",
   * "component source jump", "live captures"). Shown in the card body so the
   * user understands exactly what they're unlocking.
   */
  featureLabel: string;
}) {
  const { data, isLoading } = useActionQuery<ConnectBuilderAppResult>(
    "connect-builder-app",
    { designId },
  );

  const migrateMutation = useActionMutation("migrate-inline-design-to-app");

  // While fetching status, show a muted placeholder that matches the card
  // height so the inspector doesn't jump when the data arrives.
  if (isLoading || !data) {
    return (
      <div className="rounded-md border border-dashed border-[var(--design-editor-accent-color)]/20 bg-[var(--design-editor-accent-color)]/3 px-2.5 py-2">
        <div className="h-3 w-32 animate-pulse rounded bg-muted/40" />
      </div>
    );
  }

  // Determine which CTA to show.
  const cta = data.cta;

  // Already fully enabled — no CTA needed (caller should already have gated
  // this component away, but guard here for safety).
  if (!cta) return null;

  const isPending = migrateMutation.isPending;
  const migrateError = migrateMutation.error;

  // "Make it real" primary action: open the connect URL or migrate.
  const handlePrimary = () => {
    if (cta.kind === "connect-builder") {
      // Open the Builder OAuth connect flow in a new tab.  The user completes
      // it there and comes back; the card will re-query on next render.
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
    if (cta.kind === "configure-project") {
      window.open(cta.connectUrl, "_blank", "noopener,noreferrer");
      return;
    }
  };

  const handleMigrate = () => {
    migrateMutation.mutate({ designId });
  };

  // Migration result — show branch link.
  const migrateResult = migrateMutation.data as
    | {
        status: "processing";
        branchName?: string;
        url?: string;
        message?: string;
      }
    | undefined;

  if (migrateResult?.status === "processing" && migrateResult.url) {
    return (
      <div className="rounded-md border border-[var(--design-editor-accent-color)]/30 bg-[var(--design-editor-accent-color)]/8 px-2.5 py-2 space-y-1.5">
        <p className="text-[10px] font-semibold text-[var(--design-editor-accent-color)]">
          {"Builder is working on it" /* i18n-ignore make-it-real card */}
        </p>
        <p className="text-[10px] leading-snug text-muted-foreground">
          {migrateResult.message ??
            `Branch "${migrateResult.branchName}" is being generated.`}
        </p>
        <a
          href={migrateResult.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--design-editor-accent-color)] hover:underline"
        >
          {"Open in Builder" /* i18n-ignore make-it-real card */}
          <IconExternalLink className="size-2.5" />
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-dashed border-[var(--design-editor-accent-color)]/30 bg-[var(--design-editor-accent-color)]/5 px-2.5 py-2 space-y-1.5">
      {/* Header */}
      <p className="text-[10px] font-semibold text-foreground">
        {"Make this a real app" /* i18n-ignore make-it-real card */}
      </p>

      {/* Body */}
      <p className="text-[10px] leading-snug text-muted-foreground">
        {cta.description}
        {featureLabel ? (
          <>
            {" "}
            <span className="italic">{featureLabel}</span>
            {" requires a real-app source."}
          </>
        ) : null}
      </p>

      {/* Error */}
      {migrateError ? (
        <p className="text-[10px] text-destructive">
          {migrateError instanceof Error
            ? migrateError.message
            : "Migration failed. Please try again."}
        </p>
      ) : null}

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button
          type="button"
          onClick={handlePrimary}
          className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium bg-[var(--design-editor-accent-color)] text-white hover:opacity-90 transition-opacity"
        >
          {cta.primaryAction}
          <IconArrowRight className="size-2.5" />
        </button>

        {/* When Builder is fully connected, also offer direct migration */}
        {data.connected && data.builderEnabled && (
          <button
            type="button"
            onClick={handleMigrate}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:cursor-wait disabled:opacity-60"
          >
            {isPending ? (
              <>
                <IconLoader2 className="size-2.5 animate-spin" />
                {"Migrating…" /* i18n-ignore make-it-real card */}
              </>
            ) : (
              <>{"Generate React app" /* i18n-ignore make-it-real card */}</>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Component section (§6.1) ─────────────────────────────────────────────────

/**
 * Shape returned by `get-component-details`.  Only the fields the UI needs are
 * typed here; the action may return additional fields.
 */
interface ComponentDetailsResult {
  name: string;
  sourceType: string;
  observedProps: Array<{ name: string; value: string }>;
  persistedVariants: Record<string, string[]>;
  sourceLocation?: { filePath: string; exportName?: string } | null;
  /** Component instance shape, including the Alpine `x-data` expression. */
  instance?: {
    alpineData?: string | null;
    nodeId?: string;
    selector?: string;
  } | null;
  capabilities: {
    canResolveToFile: boolean;
    hasFullIndex: boolean;
    canEditProps: boolean;
    ctaRequired: boolean;
    ctaMessage?: string;
  };
}

/**
 * Contextual COMPONENT section rendered inside the Design tab when the
 * selected element is a component instance (carries
 * `data-agent-native-component`).
 *
 * Shows: component name, source path (when capability available), observed
 * prop values, variant/size/state controls from `get-component-details`, and
 * an "Edit component source" action.  Real-app features are gated by the
 * capabilities returned by the action; Alpine gets a lightweight read-only
 * view plus a Connect-Builder CTA.
 *
 * Matches the workbench artboard spec in DESIGN-STUDIO-PLAN.md §6.1.
 */
function ComponentSection({
  designId,
  nodeId,
  sourceCapabilities = [],
}: {
  designId: string;
  nodeId: string;
  /** Capability names advertised by the current source. */
  sourceCapabilities?: string[];
}) {
  const queryClient = useQueryClient();
  const detailsKey = ["action", "get-component-details", { designId, nodeId }];

  const { data, isLoading, error } = useActionQuery<ComponentDetailsResult>(
    "get-component-details",
    { designId, nodeId },
  );

  const openSourceMutation = useActionMutation("open-component-source");
  const applyPropMutation = useActionMutation("apply-component-prop-edit");

  // Persist a single prop change through apply-component-prop-edit. The canvas
  // re-renders from the freshly written design content (get-design refetch),
  // so no postMessage into the iframe is needed. The get-component-details
  // cache is optimistically patched so the control reflects the new value
  // immediately, then reconciled with the server on settle.
  const persistPropEdit = (
    edit:
      | { kind: "alpineData"; value: string }
      | { kind: "attribute"; attribute: string; value: string },
    optimistic: (prev: ComponentDetailsResult) => ComponentDetailsResult,
  ) => {
    queryClient.setQueryData<ComponentDetailsResult>(detailsKey, (prev) =>
      prev ? optimistic(prev) : prev,
    );
    applyPropMutation.mutate(
      { designId, nodeId, edit },
      {
        onSettled: () => {
          // Re-render the canvas from the new content and re-read the props.
          void queryClient.invalidateQueries({
            queryKey: ["action", "get-design"],
          });
          void queryClient.invalidateQueries({ queryKey: detailsKey });
        },
      },
    );
  };

  // While loading, show a compact skeleton that matches the section width.
  if (isLoading) {
    return (
      <section className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0">
        <div className="flex min-h-9 items-center gap-2 px-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/50" />
        </div>
        <div className="space-y-1.5 px-3 pb-3 pt-0.5">
          <div className="h-5 w-full animate-pulse rounded bg-muted/40" />
          <div className="h-5 w-3/4 animate-pulse rounded bg-muted/40" />
        </div>
      </section>
    );
  }

  // Hard error (node not found, no access, etc.) — collapse silently so
  // the rest of the inspector is not disrupted.
  if (error || !data) return null;

  const {
    name,
    sourceType,
    sourceLocation,
    observedProps,
    persistedVariants,
    instance,
    capabilities,
  } = data;

  // ── Editable prop model ───────────────────────────────────────────────────
  // Inline/Alpine designs persist through apply-component-prop-edit. Two write
  // surfaces:
  //   • x-data keys      → kind "alpineData" (rewrites the whole object)
  //   • data-prop-* attrs → kind "attribute"  (data-agent-native-prop-<kebab>)
  // Real-app sources keep the deeper source-prop controls gated as-is, so for
  // non-inline sources the controls are read-only here.
  const isInline = sourceType === "inline";
  const editingEnabled = isInline; // gated; real-app stays read-only for now
  const alpineData = parseAlpineDataObject(instance?.alpineData);

  // Each editable row: name + current value + how it persists + its options.
  type PropRow = {
    name: string;
    value: string;
    /** Variant/enum options when the prop is a known group. */
    options?: string[];
    /** Persist surface for this prop. */
    surface: "alpineData" | "attribute";
  };

  const rows: PropRow[] = [];
  const seen = new Set<string>();

  // 1) Alpine x-data keys come first — they drive the live variant/state.
  if (alpineData) {
    for (const [key, value] of Object.entries(alpineData)) {
      rows.push({
        name: key,
        value,
        options: persistedVariants[key],
        surface: "alpineData",
      });
      seen.add(key);
    }
  }

  // 2) data-agent-native-prop-* attributes not already covered by x-data.
  for (const prop of observedProps) {
    if (seen.has(prop.name)) continue;
    rows.push({
      name: prop.name,
      value: prop.value,
      options: persistedVariants[prop.name],
      surface: "attribute",
    });
    seen.add(prop.name);
  }

  // 3) persistedVariant groups with no observed value yet (default to first).
  for (const [group, options] of Object.entries(persistedVariants)) {
    if (seen.has(group)) continue;
    rows.push({
      name: group,
      value: options[0] ?? "",
      options,
      surface: alpineData ? "alpineData" : "attribute",
    });
    seen.add(group);
  }

  const hasRows = rows.length > 0;

  // Build the apply-component-prop-edit payload + optimistic cache patch for a
  // single prop change.
  const commitProp = (row: PropRow, nextValue: string) => {
    if (!editingEnabled || nextValue === row.value) return;

    if (row.surface === "alpineData") {
      const nextData = { ...(alpineData ?? {}), [row.name]: nextValue };
      const serialized = serializeAlpineDataObject(nextData);
      persistPropEdit({ kind: "alpineData", value: serialized }, (prev) => ({
        ...prev,
        instance: { ...(prev.instance ?? {}), alpineData: serialized },
        observedProps: prev.observedProps.map((p) =>
          p.name === row.name ? { ...p, value: nextValue } : p,
        ),
      }));
    } else {
      // camelCase prop name → data-agent-native-prop-<kebab>
      const kebab = row.name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      persistPropEdit(
        {
          kind: "attribute",
          attribute: `data-agent-native-prop-${kebab}`,
          value: nextValue,
        },
        (prev) => {
          const exists = prev.observedProps.some((p) => p.name === row.name);
          return {
            ...prev,
            observedProps: exists
              ? prev.observedProps.map((p) =>
                  p.name === row.name ? { ...p, value: nextValue } : p,
                )
              : [...prev.observedProps, { name: row.name, value: nextValue }],
          };
        },
      );
    }
  };

  // ── Capability gates ──
  const canJumpToSource =
    capabilities.canResolveToFile &&
    Boolean(sourceLocation?.filePath) &&
    sourceCapabilities.includes("resolveNodeToFile");

  // ── Source chip text ──
  const sourceChip = sourceLocation?.exportName
    ? `${sourceLocation.exportName} — ${sourceLocation.filePath}`
    : (sourceLocation?.filePath ?? null);

  return (
    <section
      className="shrink-0 border-t border-[var(--design-editor-control-border)] first:border-t-0"
      data-testid="component-section"
    >
      {/* ── Section header ── */}
      <div className="flex min-h-9 items-center gap-2 px-3">
        {/* Accent diamond matching the workbench artboard component rows */}
        <span
          className="size-2 shrink-0 rotate-45 rounded-[2px] bg-[var(--design-editor-accent-color)]"
          aria-hidden="true"
        />
        <h3 className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
          {name}
        </h3>
        {/* Jump-to-source action */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 rounded-md text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              disabled={!canJumpToSource}
              aria-label={
                "Edit component source" /* i18n-ignore design inspector action */
              }
              onClick={() => {
                openSourceMutation.mutate({ designId, nodeId });
              }}
            >
              <IconExternalLink className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {
              canJumpToSource
                ? "Edit component source" /* i18n-ignore design inspector action */
                : (capabilities.ctaMessage ??
                  "Connect Builder to jump to component source") /* i18n-ignore design inspector tooltip */
            }
          </TooltipContent>
        </Tooltip>
      </div>

      {/* ── Body ── */}
      <div className="space-y-1.5 px-3 pb-3 pt-0.5 text-[11px]">
        {/* Source path chip */}
        {sourceChip && (
          <div
            className="flex items-center gap-1 rounded bg-[var(--design-editor-control-bg)] px-2 py-1"
            title={sourceChip}
          >
            <IconCode className="size-3 shrink-0 text-muted-foreground/60" />
            <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-muted-foreground">
              {sourceChip}
            </span>
          </div>
        )}

        {/* Typed prop controls. Inline/Alpine designs are editable and persist
            through apply-component-prop-edit; real-app sources are read-only
            until the deeper source-prop controls land. */}
        {hasRows && (
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
              {"Props" /* i18n-ignore design inspector label */}
            </p>
            {rows.map((row) => {
              const hasOptions = (row.options?.length ?? 0) > 0;
              const isBoolean = !hasOptions && isBooleanPropValue(row.value);
              return (
                <div key={row.name} className="flex items-center gap-1.5">
                  <Label className="w-[64px] shrink-0 truncate text-[11px] font-medium capitalize text-muted-foreground">
                    {row.name}
                  </Label>
                  {hasOptions ? (
                    // Dropdown for variant / enum groups.
                    <Select
                      value={row.value || row.options![0] || ""}
                      onValueChange={(v) => commitProp(row, v)}
                      disabled={!editingEnabled}
                    >
                      <SelectTrigger className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {row.options!.map((opt) => (
                          <SelectItem
                            key={opt}
                            value={opt}
                            className="text-[11px]"
                          >
                            {opt}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isBoolean ? (
                    // Toggle for boolean props.
                    <div className="flex min-w-0 flex-1 items-center">
                      <Switch
                        checked={row.value.trim().toLowerCase() === "true"}
                        onCheckedChange={(checked) =>
                          commitProp(row, checked ? "true" : "false")
                        }
                        disabled={!editingEnabled}
                        className="h-4 w-7 [&>span]:size-3 [&>span]:data-[state=checked]:translate-x-3"
                        aria-label={
                          row.name /* i18n-ignore dynamic prop name */
                        }
                      />
                    </div>
                  ) : (
                    // Text input for string props (e.g. a label).
                    <Input
                      defaultValue={row.value}
                      key={`${row.name}:${row.value}`}
                      disabled={!editingEnabled}
                      onBlur={(e) => commitProp(row, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.blur();
                        }
                      }}
                      className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Connect-Builder CTA (inline, only when real-app features are gated) */}
        {capabilities.ctaRequired && (
          <MakeItRealCard
            designId={designId}
            featureLabel="component source jump and full prop controls"
          />
        )}
      </div>
    </section>
  );
}

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
  readOnly = false,
  designId,
  onTokensApplied,
  statesPanelProps,
  reviewPanelProps,
  componentNodeId,
  sourceCapabilities = [],
  onCreateComponent,
  defaultComponentName = "Component",
  inspectCode,
}: EditPanelProps) {
  const t = useT();
  const [createComponentOpen, setCreateComponentOpen] = useState(false);
  const [exportSettings, setExportSettings] = useState<ExportSettingsValue>(
    DEFAULT_EXPORT_SETTINGS,
  );
  const [showExportPreview, setShowExportPreview] = useState(false);
  // Sub-tab within the Tweaks area: "tokens" (TokensPanel face) or "tweaks"
  // (raw TweakDefinition controls). Always default to the existing "tweaks"
  // controls so opening Tweaks lands on the user's TweakDefinition controls
  // (and the + affordance) rather than auto-firing token indexing. "Tokens"
  // remains available as a sub-tab the user can click when designId is set.
  const [tweaksSubTab, setTweaksSubTab] = useState<TweaksSubTab>("tweaks");

  const selectedElementKey = selectedElement
    ? elementIdentityKey(selectedElement)
    : "none";
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
  // The "Add Tweaks" (+) flow lives only on the "tweaks" sub-tab. Switch to it
  // before opening the prompt so the + button and the newly added control are
  // visible (avoids leaving the user on the Tokens sub-tab where + isn't shown).
  const handleRequestTweaks = useCallback(
    (anchor: HTMLElement) => {
      setTweaksSubTab("tweaks");
      onRequestTweaks?.(anchor);
    },
    [onRequestTweaks],
  );

  useEffect(() => {
    setExportSettings(DEFAULT_EXPORT_SETTINGS);
    setShowExportPreview(false);
  }, [selectedElementKey]);

  // Scroll guard: suppress the click that fires immediately after a scroll
  // gesture ends (rubber-band or normal scroll). Using onScroll instead of
  // onPointerDown avoids side-effects like Radix DismissableLayer detecting a
  // "pointerdown outside" and closing open popovers — which, during an
  // over-scroll bounce, could briefly un-shield the canvas and allow a stray
  // pointer event to deselect the selected canvas element (R3 regression).
  const scrolledRecentlyRef = useRef(false);
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (readOnly) {
    return (
      <div
        className={cn(
          "shrink-0 bg-[var(--design-editor-panel-bg)]",
          "flex h-full min-h-0 flex-col overflow-hidden",
        )}
        style={{ width }}
      >
        <div className="flex min-h-8 shrink-0 items-center border-b border-border/90 px-3">
          <h2 className="min-w-0 truncate text-[12px] font-semibold text-foreground">
            {t("editPanel.properties")}
          </h2>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center px-5">
          <div
            className="max-w-[188px] text-center"
            aria-live="polite"
            aria-busy="true"
          >
            <div className="mx-auto mb-3 flex size-9 items-center justify-center rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-muted-foreground/60">
              <IconLock className="size-4" aria-hidden="true" />
            </div>
            <h3 className="text-[12px] font-semibold leading-snug text-foreground">
              {t("designEditor.inspectorLockedTitle")}
            </h3>
            <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground/70">
              {t("designEditor.inspectorLockedDescription")}
            </p>
          </div>
        </div>
      </div>
    );
  }

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
          <SelectionHeader
            element={selectedElement}
            onCreateComponent={
              onCreateComponent && selectedElement
                ? () => setCreateComponentOpen(true)
                : undefined
            }
            inspectCodePopover={
              inspectCode && selectedElement
                ? (trigger) => (
                    <InspectCodePopover trigger={trigger} data={inspectCode} />
                  )
                : undefined
            }
          />
          {onCreateComponent && (
            <CreateComponentDialog
              open={createComponentOpen}
              onOpenChange={setCreateComponentOpen}
              defaultName={defaultComponentName}
              onSubmit={onCreateComponent}
            />
          )}

          <div
            className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
            onScroll={() => {
              // Mark that a scroll just happened so the click that some
              // browsers fire at the end of a scroll gesture (or after an
              // overscroll/rubber-band bounce) is suppressed. Crucially this
              // runs on the scroll event — NOT on pointerdown — so it never
              // triggers Radix's DismissableLayer "outside pointerdown"
              // detection, which would close open inspector popovers and, once
              // the shield is removed, allow a stray canvas pointer event to
              // deselect the selected element (the R3 overscroll regression).
              scrolledRecentlyRef.current = true;
              if (scrollTimerRef.current !== null) {
                clearTimeout(scrollTimerRef.current);
              }
              scrollTimerRef.current = setTimeout(() => {
                scrolledRecentlyRef.current = false;
                scrollTimerRef.current = null;
              }, 300);
            }}
            onClickCapture={(e) => {
              // Suppress spurious clicks (e.g. color-picker opening) that
              // fire immediately after a scroll gesture ends. The 300ms
              // window from the last scroll event covers both the synchronous
              // scroll-end click and the delayed synthetic click that mobile
              // browsers generate after a touch-scroll ends.
              if (!scrolledRecentlyRef.current) return;
              scrolledRecentlyRef.current = false;
              if (scrollTimerRef.current !== null) {
                clearTimeout(scrollTimerRef.current);
                scrollTimerRef.current = null;
              }
              e.stopPropagation();
              e.preventDefault();
            }}
            onKeyDown={(e) => {
              // Trap Tab within the inspector panel so it never focuses the
              // canvas iframe. When the canvas iframe gains focus it forwards
              // a synthetic Tab keydown to the parent window, which is picked
              // up by the design-editor hotkey handler as "cycle file" and
              // causes apparent deselection / overview-mode switch (bug: Tab
              // in a numeric field deselected the canvas element).
              if (e.key !== "Tab") return;
              const panel = e.currentTarget;
              const focusable = Array.from(
                panel.querySelectorAll<HTMLElement>(
                  'input, button, select, textarea, [tabindex]:not([tabindex="-1"])',
                ),
              ).filter(
                (el) =>
                  !el.hasAttribute("disabled") &&
                  el.tabIndex !== -1 &&
                  !el.closest('[aria-hidden="true"]'),
              );
              if (focusable.length === 0) return;
              e.preventDefault();
              const current = document.activeElement as HTMLElement | null;
              const idx = current ? focusable.indexOf(current) : -1;
              const next = e.shiftKey
                ? focusable[(idx - 1 + focusable.length) % focusable.length]
                : focusable[(idx + 1) % focusable.length];
              next?.focus();
            }}
          >
            {/* §6.1 Component section — shown at the top when a component
                instance is selected. Requires designId + componentNodeId. */}
            {designId && componentNodeId && (
              <ComponentSection
                designId={designId}
                nodeId={componentNodeId}
                sourceCapabilities={sourceCapabilities}
              />
            )}

            {!selectedElement && (
              <PageProperties
                styles={pageStyles}
                onStyleChange={onStyleChange}
                onStylesChange={onStylesChange}
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
                        ? "Hide preview" /* i18n-ignore design inspector action */
                        : "Show preview" /* i18n-ignore design inspector action */
                    }
                    active={showExportPreview}
                    onClick={() => setShowExportPreview((shown) => !shown)}
                  >
                    <IconPhoto className="size-3.5" />
                  </SectionIconToggle>
                }
              >
                <ExportSettingsPanel
                  key={selectedElementKey}
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

            {/* §6.4 States & Responsive — contextual section in Design tab.
                Collapsed by default so existing Design content is not buried.
                Only mounts when designId is provided so there is something to
                load; without it the panel would fire an action with no id. */}
            {designId && statesPanelProps ? (
              <PanelSection
                title={"States" /* i18n-ignore design inspector section */}
                defaultCollapsed
                actions={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        aria-label={
                          "Breakpoints & states" /* i18n-ignore design inspector action */
                        }
                      >
                        <IconDeviceDesktop className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {
                        "Breakpoints & states" /* i18n-ignore design inspector action */
                      }
                    </TooltipContent>
                  </Tooltip>
                }
              >
                <StatesPanel designId={designId} {...statesPanelProps} />
                {/* §6.4 / §6.6 — live captures (real running-app data, route
                    props, API responses) are a real-app capability. When
                    canCapture is false (inline source) surface a compact
                    "Make it real" CTA so the user knows it's one step away. */}
                {!statesPanelProps.canCapture && (
                  <MakeItRealCard
                    designId={designId}
                    featureLabel="live data captures and real-app states"
                  />
                )}
              </PanelSection>
            ) : null}

            {/* §6.5 Review — contextual section in Design tab.
                Collapsed by default. Renders when reviewPanelProps is provided,
                no designId check needed since ReviewPanel is statically fed. */}
            {reviewPanelProps ? (
              <PanelSection
                title={"Review" /* i18n-ignore design inspector section */}
                defaultCollapsed
                actions={
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-6 rounded-md text-muted-foreground hover:text-foreground"
                        aria-label={
                          "Accessibility & visual diff" /* i18n-ignore design inspector action */
                        }
                      >
                        <IconShieldCheck className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {
                        "Accessibility & visual diff" /* i18n-ignore design inspector action */
                      }
                    </TooltipContent>
                  </Tooltip>
                }
              >
                {/* ReviewPanel manages its own scroll; no extra wrapper needed. */}
                <ReviewPanel {...reviewPanelProps} />
              </PanelSection>
            ) : null}
          </div>
        </>
      ) : activeTab === "tweaks" ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Tweaks tab header: when designId is present show a Tokens | Tweaks
              sub-tab switcher so the TokensPanel is the first-class face of
              this area per §6.2. When there is no designId only the raw tweaks
              title is shown (original behaviour). */}
          {designId ? (
            <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border/90 px-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 rounded-md px-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
                  tweaksSubTab === "tokens" &&
                    "bg-[var(--design-editor-panel-raised-bg)] text-foreground",
                )}
                onClick={() => setTweaksSubTab("tokens")}
              >
                <IconPalette className="mr-1 size-3" />
                {"Tokens" /* i18n-ignore design inspector sub-tab */}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  "h-6 rounded-md px-2 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground",
                  tweaksSubTab === "tweaks" &&
                    "bg-[var(--design-editor-panel-raised-bg)] text-foreground",
                )}
                onClick={() => setTweaksSubTab("tweaks")}
              >
                {t("designEditor.tweaks")}
              </Button>
            </div>
          ) : (
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
                      onClick={(event) =>
                        handleRequestTweaks(event.currentTarget)
                      }
                    >
                      <IconPlus className="size-3.5" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t("designEditor.addTweaks")}</TooltipContent>
                </Tooltip>
              ) : null}
            </div>
          )}

          <div className="design-inspector-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {designId && tweaksSubTab === "tokens" ? (
              /* §6.2 Tokens face — first-class view of the Tweaks area.
                 TokensPanel calls apply-design-token-edit which routes through
                 the Tweaks loop (designs.data.tweakSelections persist). */
              <>
                <TokensPanel
                  designId={designId}
                  onTokensApplied={onTokensApplied}
                />
                {/* §5 / §6.6 — token write-back to source is a real-app
                    capability. On inline sources (sourceCapabilities lacks
                    "writeFile") show a compact "Make it real" CTA after the
                    token list so the user knows write-back is one step away. */}
                {!sourceCapabilities.includes("writeFile") && (
                  <div className="px-3 pb-3 pt-1">
                    <MakeItRealCard
                      designId={designId}
                      featureLabel="token write-back to source files"
                    />
                  </div>
                )}
              </>
            ) : (
              /* Raw TweakDefinition controls — shown when no designId, or when
                 the user switches to the Tweaks sub-tab. */
              <>
                {designId && onRequestTweaks ? (
                  /* When in sub-tab mode, show the add-tweaks action in the
                     scrollable content area above the raw controls. */
                  <div className="flex items-center justify-end px-3 pt-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
                          aria-label={t("designEditor.addTweaks")}
                          onClick={(event) =>
                            handleRequestTweaks(event.currentTarget)
                          }
                        >
                          <IconPlus className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("designEditor.addTweaks")}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : null}
                <TweaksPanelContent
                  tweaks={tweaks}
                  values={tweakValues}
                  onChange={handleTweakChange}
                  onRequestTweaks={!designId ? handleRequestTweaks : undefined}
                  className="px-3 py-3"
                />
              </>
            )}
          </div>
        </div>
      ) : extensionContext ? (
        <DesignExtensionsPanel context={extensionContext} />
      ) : null}
    </div>
  );
}
