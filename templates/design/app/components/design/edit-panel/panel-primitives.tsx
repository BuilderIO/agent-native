import {
  parseCssColor,
  rgbaToCss,
  withColorOpacity,
} from "@shared/color-utils";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
  type DesignFillRowPatch,
  type DesignGradientStop,
  type DesignGradientStopPatch,
  type DesignGradientType,
  type ImageFillValue,
} from "../inspector";
import type { DesignPaintType } from "../inspector/DesignColorPicker";
import type { GlslShaderPanelContext } from "../inspector/GlslShaderPanel";
import {
  buildFillRows,
  buildGradientLayer,
  defaultGradientLayer,
  defaultGradientStops,
  fillLayerId,
  fillLayerIndex,
  joinCssLayers,
  parseGradientLayer,
  SOLID_FILL_ID,
  splitCssLayers,
} from "./fill-gradient-helpers";
import { colorHasVisibleAlpha, cssColorOrFallback } from "./position-helpers";
import { isMixedValue, MIXED_VALUE } from "./selection-helpers";

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
  // Escape reverts and blurs; the blur handler must then skip its commit or it
  // would re-commit the stale draft closure (mirrors ScrubInput's Escape path).
  const skipNextBlurCommitRef = useRef(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (isMixedValue(draft)) return;
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
        onFocus={(e) => {
          if (mixed) e.currentTarget.select();
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          // For length fields, defer the live update until blur/Enter so that
          // invalid intermediate strings ("3", "32", "32p") don't get applied
          // and discarded by the browser. Free-text fields (without
          // defaultUnit) keep the responsive live-update behavior.
          if (defaultUnit === undefined) onChange(e.target.value);
        }}
        onBlur={() => {
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
            (e.currentTarget as HTMLInputElement).blur();
            return;
          }
          if (e.key === "Escape") {
            e.preventDefault();
            // Revert the draft to the last committed value and blur, matching
            // ScrubInput's Escape behavior.
            setDraft(value);
            skipNextBlurCommitRef.current = true;
            (e.currentTarget as HTMLInputElement).blur();
          }
        }}
        placeholder={placeholder}
        className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus-visible:ring-1 focus-visible:ring-[var(--design-editor-accent-color)] md:!text-[11px]"
      />
    </div>
  );
}

/** Compact color input: label + design-editor picker popover. */
export function ColorInput({
  label,
  value,
  onChange,
  backgroundImage,
  backgroundSize,
  backgroundRepeat,
  backgroundPosition,
  onBackgroundImageChange,
  onImageFillChange,
  blendMode,
  onBlendModeChange,
  supportsLayeredFills = false,
  documentColors,
  supportedPaintTypes,
  pickerKey,
  glslShaderContext,
}: {
  label: string;
  value: string;
  onChange: (value: string, meta?: StyleChangeMeta) => void;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
  onBackgroundImageChange?: (value: string) => void;
  onImageFillChange?: (value: ImageFillValue) => void;
  blendMode?: string;
  onBlendModeChange?: (value: string) => void;
  supportsLayeredFills?: boolean;
  /** Hex strings already in use on the page — forwarded to the color picker swatch grid. */
  documentColors?: string[];
  /**
   * Restricts which paint-type tabs the popover renders. Omit for the full
   * set (solid + gradients + image + …). Pass `["solid"]` for properties
   * with no clean gradient/image equivalent (e.g. CSS border/outline
   * strokes) so the tab is hidden instead of clickable-but-discarded.
   */
  supportedPaintTypes?: DesignPaintType[];
  pickerKey?: string;
  /**
   * Persistence context for the code-backed GLSL Shader paint type. When
   * provided, the picker's Shader tab opens the GlslShaderPanel (Created by
   * you / Create new (AI) / Presets) which persists real GLSL source into
   * the screen HTML. Omit to fall back to the legacy shader presets panel.
   */
  glslShaderContext?: GlslShaderPanelContext;
}) {
  const [draft, setDraft] = useState(value);
  const [selectedFillId, setSelectedFillId] = useState(SOLID_FILL_ID);
  const [selectedStopId, setSelectedStopId] = useState<string | undefined>();

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const backgroundLayers = splitCssLayers(backgroundImage || "");
  const backgroundSizeLayers = splitCssLayers(backgroundSize || "");
  const backgroundRepeatLayers = splitCssLayers(backgroundRepeat || "");
  const backgroundPositionLayers = splitCssLayers(backgroundPosition || "");
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

  // PF12: `phase` defaults to "commit" so every discrete/one-shot caller
  // (swatch clicks, paint-type switches, hex commit, fill-row edits) keeps
  // committing immediately as before. Only the raw per-tick `onChange` wired
  // to DesignColorPicker below passes "preview" explicitly — the picker's own
  // `onChangeComplete` re-invokes setNext with the same final value tagged
  // "commit" once the gesture ends (see the DesignColorPicker render below).
  const setNext = (next: string, phase: "preview" | "commit" = "commit") => {
    // Guard rail for callers that don't wire onBackgroundImageChange (i.e.
    // supportsLayeredFills is false, e.g. the text-fill "color" row): the
    // picker manages gradient/image paint-type selection as *local* UI state
    // independent of props (see DesignColorPicker's localPaintType), so a
    // user can still open the Gradient/Image tab there even when this
    // ColorInput never offered layered fills. When that happens,
    // emitPaintValue falls back to this onChange with a full gradient/url()
    // CSS string, which is invalid for a plain color property (color /
    // backgroundColor) and gets silently dropped by the browser — but not
    // before clobbering the last-known-good value in this component's own
    // state. Reject anything that doesn't parse as a plain solid color in
    // that case instead of forwarding it.
    if (!supportsLayeredFills && !parseCssColor(next)) return;
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
  const selectedBackgroundLayerValue = (layers: string[]): string | undefined =>
    selectedLayerIndex !== null ? layers[selectedLayerIndex] : undefined;
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
      label={label}
      value={pickerValue}
      // PF12: `onChange` fires on every SV/hue/alpha drag tick — tag those as
      // "preview" so the caller can skip the expensive source commit and only
      // update the live iframe preview. `onChangeComplete` fires exactly once
      // per gesture (drag-end, hex commit, keyboard nudge, swatch click,
      // paint-type switch) with the same final value, tagged "commit" so the
      // authoritative source write always happens exactly once.
      onChange={(v) => setNext(v, "preview")}
      onChangeComplete={(v) => setNext(v, "commit")}
      onPaintValueChange={
        supportsLayeredFills ? handlePaintValueChange : undefined
      }
      onImageFillChange={onImageFillChange}
      backgroundImage={selectedBackgroundLayerValue(backgroundLayers)}
      backgroundSize={selectedBackgroundLayerValue(backgroundSizeLayers)}
      backgroundRepeat={selectedBackgroundLayerValue(backgroundRepeatLayers)}
      backgroundPosition={selectedBackgroundLayerValue(
        backgroundPositionLayers,
      )}
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
      supportedPaintTypes={supportedPaintTypes}
      glslShaderContext={glslShaderContext}
    />
  );
}

/** Select dropdown */
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
    <div className="flex items-center gap-1.5">
      <FieldLabel>{label}</FieldLabel>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]">
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
    </div>
  );
}

/** Slider with label and value display */
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
      <span className="w-12 text-right !text-[11px] tabular-nums text-muted-foreground">
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
export function PanelSection({
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
          <h3 className="min-w-0 flex-1 truncate !text-[11px] font-semibold text-foreground">
            {title}
          </h3>
        </button>
        {actions ? (
          <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
        ) : null}
      </div>
      {!collapsed && children ? (
        <div className="space-y-1.5 px-3 pb-3 pt-0.5 !text-[11px]">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <Label className="w-[64px] shrink-0 !text-[11px] font-medium text-muted-foreground">
      {children}
    </Label>
  );
}

export function SubsectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="!text-[11px] font-medium text-muted-foreground">{children}</p>
  );
}
