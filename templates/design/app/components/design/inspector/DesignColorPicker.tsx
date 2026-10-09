import { useT } from "@agent-native/core/client/i18n";
import {
  formatDisplayP3Css,
  formatOklchCss,
  OKLCH_ACHROMATIC_CHROMA,
  rgbaToLinearSrgb,
  type Vec3,
} from "@shared/color-spaces";
import {
  alphaToOpacity,
  isWideGamutNotation,
  normalizeCssColor,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  rgbaToHsl,
  hslToRgba,
  opacityToAlpha,
  withColorOpacity,
  type HslaColor,
  type RgbaColor,
} from "@shared/color-utils";
import {
  contrastTargets,
  fixContrast,
  rgbToHex,
  textContrastRatio,
  type ContrastFix,
} from "@shared/wcag-contrast";
import { IconColorPicker, IconGridDots } from "@tabler/icons-react";
import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverAnchor,
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import {
  ContrastBar,
  ContrastOverlay,
  useTextBackground,
  type DesignColorContrast,
} from "./color-picker-contrast";
import {
  computeContrastMap,
  readContrast,
} from "./color-picker-contrast-model";
import {
  ColorTrack,
  SaturationBrightnessField,
  ScrubbyNumberInput,
} from "./color-picker-controls";
import { InlinePaintField } from "./color-picker-fields";
import {
  FillFieldChevron,
  FillFieldFace,
  FillFieldSwatch,
  FillFieldText,
} from "./color-picker-fill-field";
import { ColorLibraries } from "./color-picker-libraries";
import {
  gamutFallbacks,
  linearFromWideSquare,
  modeForValue,
  modeNotation,
  oklchCells,
  oklchOf,
  p3Cells,
  displayP3Of,
  hueTrackBackground,
  readWideColor,
  rewriteAlpha,
  wideHueColor,
  wideSquareHsv,
  withOklchCell,
  withP3Cell,
  writeColor,
} from "./color-picker-model";
import type {
  NestedColorRequest,
  RenderNestedColorPicker,
} from "./color-picker-nested";
import { PaintRow, type PaintRowEntry } from "./color-picker-paint-row";
import {
  BLEND_MODE_OPTIONS,
  GRADIENT_KINDS,
  GRADIENT_TYPES,
  NO_FILL_PAINT,
  PAINT_ROW_TYPES,
} from "./color-picker-paint-types";
import {
  ColorCompareSwatch,
  ColorModeSelect,
  ColorPickerHeader,
  CopyValueButton,
  DocumentColors,
  type ColorPickerTab,
} from "./color-picker-sections";
import {
  ShaderPane,
  type ShaderPaneController,
} from "./color-picker-shader-pane";
import {
  alphaTrackBackground,
  alphaTrackBackgroundFor,
  CHECKER_B,
  looksLikeImageOrGradient,
  toCssColor,
  triggerSwatchStyle,
} from "./color-picker-swatch";
import {
  findToken,
  parseVarReference,
  resolveVarColor,
  tokenVarCss,
  type DesignColorToken,
  type DesignColorTokens,
} from "./color-picker-tokens";
import {
  expandHexShorthand,
  hasHexAlpha,
  hsvToRgba,
  rgbaToHsv,
  toDisplayHex,
  type DesignColorMode,
  type HsvaColor,
} from "./color-picker-utils";
import {
  fillPaintName,
  readFillField,
  showsOpacity,
} from "./fill-field-reading";
import type { GlslShaderPanelContext } from "./GlslShaderPanel";
import {
  GradientEditor,
  defaultGradient,
  gradientToCss,
  parseGradientCss,
  type GradientKind,
  type GradientValue,
} from "./GradientEditor";
import {
  ImageFillControls,
  imageFillToCss,
  parseImageFillCss,
  type ImageFillValue,
} from "./ImageFillControls";

export {
  computeScrubbedValue,
  endPointerGesture,
  POINTER_GESTURE_IDLE,
  SCRUB_GESTURE_IDLE,
  startPointerGesture,
  startScrubGesture,
  type PointerGestureState,
  type ScrubGestureState,
} from "./color-picker-controls";
export {
  expandHexShorthand,
  hasHexAlpha,
  hsvToRgba,
  parseNumericDraft,
  rgbaToHsv,
  type DesignColorMode,
} from "./color-picker-utils";
export type DesignGradientType = "linear" | "radial" | "angular" | "diamond";
export type DesignFillType = "solid" | "gradient" | "image";
export type DesignPaintType =
  | "solid"
  | "linear"
  | "radial"
  | "angular"
  | "diamond"
  | "image"
  | "shader"
  | "none";

export interface DesignFillRow {
  id: string;
  label: string;
  value: string;
  type: DesignFillType;
  opacity?: number;
  swatch?: string;
  selected?: boolean;
}

export interface DesignFillRowPatch {
  value?: string;
  opacity?: number;
}

export interface DesignGradientStop {
  id: string;
  color: string;
  position: number;
  opacity?: number;
  label?: string;
}

export interface DesignGradientStopPatch {
  color?: string;
  position?: number;
  opacity?: number;
}

export interface DesignColorPickerLabels {
  trigger: string;
  hex: string;
  rowHex: string;
  rowOpacity: string;
  red: string;
  green: string;
  blue: string;
  hue: string;
  saturation: string;
  saturationBrightness: string;
  lightness: string;
  brightness: string;
  opacity: string;
  blendMode: string;
  fills: string;
  addFill: string;
  removeFill: string;
  gradientType: string;
  gradientStops: string;
  addStop: string;
  removeStop: string;
  stopPosition: string;
  linear: string;
  radial: string;
  angular: string;
  diamond: string;
}

export interface DesignColorPickerProps {
  value: string;
  onChange: (value: string) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onChangeComplete?: (value: string) => void;
  onChangeCancel?: (value: string) => void;
  onPaintValueChange?: (value: string) => void;
  onImageFillChange?: (value: ImageFillValue) => void;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundRepeat?: string;
  backgroundPosition?: string;
  label?: string;
  opacity?: number;
  onOpacityChange?: (opacity: number) => void;
  blendMode?: string;
  onBlendModeChange?: (mode: string) => void;
  showBlendMode?: boolean;
  fillRows?: DesignFillRow[];
  selectedFillId?: string;
  onFillSelect?: (id: string) => void;
  onFillChange?: (id: string, patch: DesignFillRowPatch) => void;
  onAddFill?: () => void;
  onRemoveFill?: (id: string) => void;
  paintType?: DesignPaintType;
  onPaintTypeChange?: (type: DesignPaintType) => boolean | void;
  gradientType?: DesignGradientType;
  onGradientTypeChange?: (type: DesignGradientType) => void;
  gradientStops?: DesignGradientStop[];
  selectedStopId?: string;
  onGradientStopSelect?: (id: string) => void;
  onGradientStopChange?: (id: string, patch: DesignGradientStopPatch) => void;
  onAddGradientStop?: () => void;
  onRemoveGradientStop?: (id: string) => void;
  documentColors?: string[];
  supportedPaintTypes?: DesignPaintType[];
  glslShaderContext?: GlslShaderPanelContext;
  labels?: Partial<DesignColorPickerLabels>;
  allowDesignHistoryHotkeys?: boolean;
  onDesignHistoryHotkey?: () => void;
  disabled?: boolean;
  className?: string;
  trigger?: ReactNode;
  /** Which side of the trigger the popover opens on. The inspector is on the right, so it opens left. */
  side?: "left" | "right";
  /**
   * The design's color tokens. They fill the Libraries pane and let a fill
   * written as `var(--token)` show the color it stands for.
   */
  tokens?: DesignColorTokens;
  /**
   * Binds the fill to a token. The `Custom | Libraries` header shows only when
   * this is provided, so a picker for a token's own color leaves it out.
   */
  onPickToken?: (token: DesignColorToken) => void;
  /**
   * The custom property the fill is bound to when `value` is its resolved
   * color. The picker opens on Libraries with that token marked.
   */
  boundToken?: string;
  /** Called while the picker is open, or its value is a `var()`, so the owner can load `tokens`. */
  onRequestTokens?: () => void;
  /**
   * Contrast for a text layer's fill. The paint row gets a Contrast toggle
   * that shows only while the paint is solid.
   */
  contrast?: DesignColorContrast;
  /**
   * Opens beside this element, with no trigger of its own: the second picker a
   * gradient stop or a shader color opens beside the panel.
   */
  anchorElement?: HTMLElement | null;
  /** Escape puts back the color the picker opened with, then closes it. */
  restoreOnEscape?: boolean;
  /**
   * The color as written in the design, when it is not the one `value` holds:
   * `value` is what the browser computed, so an HSL color or a color name only
   * survives here. The Fill field reads it as written.
   */
  authoredValue?: string;
  /** The Shader paint's name in the Fill field: the shader on the element. */
  paintLabel?: string;
  /**
   * The color goes to something that reads only opaque sRGB, such as a shader
   * uniform: no opacity and no Display P3 or OKLCH, rather than a color the
   * consumer would flatten without saying so.
   */
  opaqueSrgb?: boolean;
}

interface PreviousColor {
  css: string;
  /** The token the fill was bound to, so restoring it binds it again. */
  boundVar: string | undefined;
  /** It was a token that could not be resolved, so there is no color to restore. */
  unresolved: boolean;
}

const UNRESOLVED_TOKEN_COPY = {
  loading: "editPanel.colorPicker.tokenLoading",
  failed: "editPanel.colorPicker.tokensFailed",
  missing: "editPanel.colorPicker.tokenMissing",
  "not-a-color": "editPanel.colorPicker.tokenNotColor",
  cycle: "editPanel.colorPicker.tokenCycle",
} as const;

const FALLBACK_COLOR: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };

/** The nested picker edits one color, so it has no paint row. */
const SOLID_ONLY: DesignPaintType[] = ["solid"];

const DEFAULT_LABELS: DesignColorPickerLabels = {
  trigger: "Open color picker", // i18n-ignore fallback component label
  hex: "Hex", // i18n-ignore fallback component label
  rowHex: "Color", // i18n-ignore fallback component label
  rowOpacity: "Paint opacity", // i18n-ignore fallback component label
  red: "R", // i18n-ignore fallback component label
  green: "G", // i18n-ignore fallback component label
  blue: "B", // i18n-ignore fallback component label
  hue: "H", // i18n-ignore fallback component label
  saturation: "S", // i18n-ignore fallback component label
  saturationBrightness: "Saturation and brightness", // i18n-ignore fallback component label
  lightness: "L", // i18n-ignore fallback component label
  brightness: "B", // i18n-ignore fallback component label
  opacity: "Opacity", // i18n-ignore fallback component label
  blendMode: "Blend", // i18n-ignore fallback component label
  fills: "Fills", // i18n-ignore fallback component label
  addFill: "Add fill", // i18n-ignore fallback component label
  removeFill: "Remove fill", // i18n-ignore fallback component label
  gradientType: "Type", // i18n-ignore fallback component label
  gradientStops: "Gradient stops", // i18n-ignore fallback component label
  addStop: "Add stop", // i18n-ignore fallback component label
  removeStop: "Remove stop", // i18n-ignore fallback component label
  stopPosition: "Position", // i18n-ignore fallback component label
  linear: "Linear", // i18n-ignore fallback component label
  radial: "Radial", // i18n-ignore fallback component label
  angular: "Angular", // i18n-ignore fallback component label
  diamond: "Diamond", // i18n-ignore fallback component label
};

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function hasEyeDropperSupport(): boolean {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

export async function beginEyedropperPick(): Promise<string | null> {
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor })
    .EyeDropper;
  if (!EyeDropper) return null;
  try {
    const result = await new EyeDropper().open();
    return result.sRGBHex ?? null;
  } catch {
    // Browser cancels (Escape / click-away) reject the promise — treat as a
    // no-op pick rather than an error.
    return null;
  }
}

export function DesignColorPicker({
  value: rawValue,
  onChange,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
  onChangeComplete,
  onChangeCancel,
  onPaintValueChange,
  onImageFillChange,
  backgroundImage,
  backgroundSize,
  backgroundRepeat,
  backgroundPosition,
  label: _label,
  opacity,
  onOpacityChange,
  blendMode,
  onBlendModeChange,
  showBlendMode = false,
  paintType,
  onPaintTypeChange,
  gradientType,
  onGradientTypeChange,
  documentColors,
  supportedPaintTypes,
  glslShaderContext,
  labels,
  allowDesignHistoryHotkeys = false,
  onDesignHistoryHotkey,
  disabled = false,
  className,
  trigger,
  side = "left",
  tokens,
  onPickToken,
  boundToken,
  onRequestTokens,
  contrast,
  anchorElement,
  restoreOnEscape = false,
  authoredValue,
  paintLabel,
  opaqueSrgb = false,
}: DesignColorPickerProps) {
  const t = useT();
  const copy = { ...DEFAULT_LABELS, ...labels };
  // A fill bound to a token arrives as `var(--token)`, which is no color the
  // editor can read. Everything below works on the color it stands for; a
  // token that cannot be resolved stays unresolved and is never drawn as one.
  const tokenResolution = resolveVarColor(rawValue, tokens);
  const value =
    tokenResolution?.kind === "color" ? tokenResolution.css : rawValue;
  const unresolvedToken =
    tokenResolution?.kind === "unresolved" ? tokenResolution : null;
  const boundVar = parseVarReference(rawValue)?.name ?? boundToken;
  const color = useMemo(
    () => parseCssColorExtended(value) ?? FALLBACK_COLOR,
    [value],
  );
  const hsv = rgbaToHsv(color);

  const effectiveOpacity = opacity ?? alphaToOpacity(color.a);
  const blendModeValue: string = BLEND_MODE_OPTIONS.some(
    (option) => option.value === blendMode,
  )
    ? (blendMode ?? "normal")
    : "normal";
  const parsedImageFill = useMemo(
    () =>
      backgroundImage !== undefined ||
      backgroundSize !== undefined ||
      backgroundRepeat !== undefined ||
      backgroundPosition !== undefined
        ? parseImageFillCss({
            backgroundImage: backgroundImage ?? value,
            backgroundSize,
            backgroundRepeat,
            backgroundPosition,
          })
        : parseImageFillCss(value),
    [
      backgroundImage,
      backgroundPosition,
      backgroundRepeat,
      backgroundSize,
      value,
    ],
  );

  const [mode, setMode] = useState<DesignColorMode>(() =>
    modeForValue(value, "hex"),
  );
  // null until the user picks a pane: a fill bound to a token opens on Libraries.
  const [pickedTab, setPickedTab] = useState<ColorPickerTab | null>(null);
  const [hexDraft, setHexDraft] = useState(() => toDisplayHex(color));
  const hexDraftRef = useRef(hexDraft);
  const anchorRef = useMemo(
    () => (anchorElement ? { current: anchorElement } : undefined),
    [anchorElement],
  );
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const needsTokens =
    open || parseVarReference(rawValue) !== null || boundToken !== undefined;
  useEffect(() => {
    if (needsTokens) onRequestTokens?.();
  }, [needsTokens, onRequestTokens]);
  useEffect(() => {
    if (!open) setPickedTab(null);
  }, [open]);
  const documentColorsAtOpenRef = useRef(documentColors);
  if (!open) documentColorsAtOpenRef.current = documentColors;
  const shownDocumentColors = documentColorsAtOpenRef.current;
  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onControlledOpenChange?.(nextOpen);
  };
  const closeFromTooltipEscape = () => {
    if (restoreOnEscape) restorePrevious();
    handleOpenChange(false);
  };
  const [picking, setPicking] = useState(false);
  const skipNextHexBlurCommitRef = useRef(false);
  const lastHueRef = useRef<number>(0);
  const lastWideHueRef = useRef<number>(0);
  const lastOklchHueRef = useRef<number>(0);

  // The paint type picked while the picker is open, ahead of the fill catching
  // up. It does not outlive the open picker: a fill that changed meanwhile (the
  // agent gave it a shader, an undo) must open on what it is now.
  const [localPaintType, setLocalPaintType] = useState<DesignPaintType | null>(
    null,
  );
  useEffect(() => {
    if (!open) setLocalPaintType(null);
  }, [open]);

  const [localGradient, setLocalGradient] = useState<GradientValue | null>(
    null,
  );
  const [selectedStopId, setSelectedStopId] = useState<string>("");
  const [imageFill, setImageFill] = useState<ImageFillValue>(
    () => parsedImageFill ?? { url: "", fit: "fill" },
  );

  // The mounted Shader pane's way to take the shader off the element. The
  // pane reads the screen's shaders, so a picker that never shows it does not.
  const shaderPaneRef = useRef<ShaderPaneController | null>(null);

  const isPaintTypeSupported = (type: DesignPaintType) =>
    (type !== "shader" || glslShaderContext !== undefined) &&
    (!supportedPaintTypes || supportedPaintTypes.includes(type));

  const rawEffectivePaintType: DesignPaintType =
    localPaintType ?? paintType ?? inferPaintType(value, effectiveOpacity);
  const effectivePaintType: DesignPaintType = isPaintTypeSupported(
    rawEffectivePaintType,
  )
    ? rawEffectivePaintType
    : "solid";

  const parsedGradient = useMemo(
    () => parseGradientCss(value, gradientType ?? "linear"),
    [gradientType, value],
  );
  const fallbackGradient = useMemo(
    () =>
      GRADIENT_TYPES.has(effectivePaintType)
        ? defaultGradient(
            effectivePaintType as GradientKind,
            toCssColor(color) || "#000000",
          )
        : null,
    [color, effectivePaintType],
  );
  const activeGradient: GradientValue | null = GRADIENT_TYPES.has(
    effectivePaintType,
  )
    ? (localGradient ?? parsedGradient ?? fallbackGradient)
    : null;

  useEffect(() => {
    const nextHex = toDisplayHex(color);
    hexDraftRef.current = nextHex;
    setHexDraft(nextHex);
  }, [color]);

  useEffect(() => {
    if (!parsedImageFill) return;
    setImageFill((current) =>
      current.url === parsedImageFill.url && current.fit === parsedImageFill.fit
        ? current
        : parsedImageFill,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedImageFill?.url, parsedImageFill?.fit]);

  const lastEmittedValueRef = useRef(value);

  const notifyChangeComplete = () => {
    const last = lastEmittedValueRef.current;
    // `onPaintValueChange` owns gradient and image writes; the callback for a
    // solid color must never be handed their CSS as if it were one.
    if (onPaintValueChange && looksLikeImageOrGradient(last)) return;
    onChangeComplete?.(last);
  };

  const emitCssValue = (
    css: string,
    phase: "preview" | "commit" = "preview",
  ) => {
    lastEmittedValueRef.current = css;
    if (phase === "commit" && onChangeComplete) onChangeComplete(css);
    else onChange(css);
  };

  const emitColor = (
    nextColor: RgbaColor,
    nextOpacity = effectiveOpacity,
    phase: "preview" | "commit" = "preview",
  ) => {
    emitCssValue(rgbaToCss(withColorOpacity(nextColor, nextOpacity)), phase);
  };

  const emitPaintValue = (
    nextValue: string,
    phase: "preview" | "commit" = "preview",
  ) => {
    lastEmittedValueRef.current = nextValue;
    if (onPaintValueChange) onPaintValueChange(nextValue);
    else if (phase === "commit" && onChangeComplete)
      onChangeComplete(nextValue);
    else onChange(nextValue);
  };

  const emitColorFromHsv = (nextHsv: HsvaColor) => {
    emitColor(hsvToRgba({ ...nextHsv, a: opacityToAlpha(effectiveOpacity) }));
  };

  const emitColorFromHsl = (nextHsl: HslaColor) => {
    emitColor(hslToRgba({ ...nextHsl, a: opacityToAlpha(effectiveOpacity) }));
  };

  const revertHexDraft = () => {
    const reverted = toDisplayHex(color);
    hexDraftRef.current = reverted;
    setHexDraft(reverted);
  };

  const commitHex = () => {
    const currentDraft = expandHexShorthand(hexDraftRef.current);
    const parsed = parseCssColor(`#${currentDraft.replace(/^#/, "")}`);
    if (!parsed) {
      revertHexDraft();
      return;
    }
    const hexIncludesAlpha = hasHexAlpha(currentDraft);
    const nextOpacity = hexIncludesAlpha
      ? alphaToOpacity(parsed.a)
      : effectiveOpacity;
    if (hexIncludesAlpha && onOpacityChange) onOpacityChange(nextOpacity);
    emitColor(parsed, nextOpacity, "commit");
  };

  const setOpacity = (nextOpacity: number) => {
    lastEmittedValueRef.current =
      rewriteAlpha(
        mode,
        value,
        opacityToAlpha(nextOpacity),
        lastOklchHueRef.current,
      ) ?? rgbaToCss(withColorOpacity(color, nextOpacity));
    if (onOpacityChange) onOpacityChange(nextOpacity);
    else onChange(lastEmittedValueRef.current);
  };

  const emitGradient = (
    next: GradientValue,
    phase: "preview" | "commit" = "preview",
  ) => {
    setLocalGradient(next);
    if (onGradientTypeChange && next.kind !== gradientType) {
      onGradientTypeChange(next.kind as DesignGradientType);
    }
    emitPaintValue(gradientToCss(next), phase);
  };

  const selectedStop =
    activeGradient?.stops.find((s) => s.id === selectedStopId) ??
    activeGradient?.stops[0];
  const effectiveSelectedStopId = selectedStop?.id ?? "";

  // What the value cells, square and tracks edit. A color is carried
  // unclamped, so one outside sRGB stays itself.
  const fieldColor: RgbaColor = color;
  const fieldCss = value;
  const fieldWide = readWideColor(fieldCss);
  const fieldLinear: Vec3 = fieldWide?.linear ?? rgbaToLinearSrgb(fieldColor);
  const fieldAlpha = opacityToAlpha(effectiveOpacity);
  const wideMode = modeNotation(mode) !== "srgb";
  const rawWideHsv = wideSquareHsv(fieldLinear, lastWideHueRef.current);
  const oklch = oklchOf(fieldLinear, fieldWide, lastOklchHueRef.current);
  useEffect(() => {
    if (rawWideHsv.s > 0 && rawWideHsv.v > 0) {
      lastWideHueRef.current = rawWideHsv.h;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawWideHsv.h, rawWideHsv.s, rawWideHsv.v]);
  useEffect(() => {
    if (oklch.c > OKLCH_ACHROMATIC_CHROMA) lastOklchHueRef.current = oklch.h;
  }, [oklch.c, oklch.h]);
  const fieldCssRef = useRef(fieldCss);
  fieldCssRef.current = fieldCss;
  // Previous: what the fill was when editing began. Tracks the value while
  // closed, then holds still, like the document colors above.
  const currentAsPrevious: PreviousColor = {
    css: fieldCss,
    boundVar,
    unresolved: unresolvedToken !== null,
  };
  const previousRef = useRef(currentAsPrevious);
  if (!open) previousRef.current = currentAsPrevious;
  const previous = previousRef.current;
  // A picker opens in the notation its color was written in.
  useEffect(() => {
    if (open) {
      setMode((current) => modeForValue(fieldCssRef.current, current));
    }
  }, [open]);
  // The color in the mode's notation: what the mode would write for it.
  const fieldModeCss =
    rewriteAlpha(mode, fieldCss, fieldAlpha, lastOklchHueRef.current) ??
    rgbaToCss(fieldColor);
  const rawFieldHsv = rgbaToHsv(fieldColor);
  useEffect(() => {
    if (rawFieldHsv.s > 0 && rawFieldHsv.v > 0) {
      lastHueRef.current = rawFieldHsv.h;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawFieldHsv.h, rawFieldHsv.s, rawFieldHsv.v]);
  const fieldHsv: HsvaColor =
    rawFieldHsv.s === 0
      ? { ...rawFieldHsv, h: lastHueRef.current }
      : rawFieldHsv;
  const fieldHsl = rgbaToHsl(fieldColor);

  /** Writes a color the mode wrote itself to the fill. */
  const emitModeCss = (css: string, phase: "preview" | "commit" = "preview") =>
    emitCssValue(css, phase);

  /** Writes a color in the mode's notation. */
  const emitLinear = (
    linear: Vec3,
    phase: "preview" | "commit" = "preview",
    nextMode: DesignColorMode = mode,
  ) =>
    emitModeCss(
      writeColor(nextMode, linear, fieldAlpha, lastOklchHueRef.current),
      phase,
    );

  const changeMode = (nextMode: DesignColorMode) => {
    if (nextMode === mode) return;
    setMode(nextMode);
    // Hex, RGB, HSL and HSB write the same CSS. Crossing into or out of Display
    // P3 or OKLCH rewrites the color in the new notation; going to an sRGB mode
    // maps a wider color into sRGB, and that result is what the design holds.
    if (modeNotation(nextMode) === modeNotation(mode)) return;
    emitLinear(fieldLinear, "commit", nextMode);
  };

  const pickDocumentColor = (css: string) => {
    const picked = readWideColor(css);
    const parsed = picked ? null : parseCssColorExtended(css);
    if (!picked && !parsed) return;
    const nextMode = picked ? modeForValue(css, mode) : mode;
    if (nextMode !== mode) setMode(nextMode);
    if (modeNotation(nextMode) === "srgb" && parsed) {
      emitColor(parsed);
    } else {
      emitModeCss(
        rewriteAlpha(nextMode, css, fieldAlpha, lastOklchHueRef.current) ?? css,
      );
    }
    notifyChangeComplete();
  };

  /** Puts back what the fill, or the picked stop, was when the picker opened. */
  const restorePrevious = () => {
    if (previous.unresolved) return;
    const token = previous.boundVar
      ? findToken(tokens, previous.boundVar)
      : null;
    if (token && onPickToken) {
      if (boundVar !== token.cssVar) onPickToken(token);
      return;
    }
    if (previous.css === fieldCss && boundVar === previous.boundVar) return;
    emitModeCss(previous.css);
    notifyChangeComplete();
  };

  const pickToken = (token: DesignColorToken) => {
    onPickToken?.(token);
    handleOpenChange(false);
  };

  const emitFieldColor = (next: RgbaColor) => emitColor(next);
  const emitFieldHsl = (next: HslaColor) => emitColorFromHsl(next);
  const emitFieldHsv = (next: HsvaColor) => emitColorFromHsv(next);

  const emitImageFill = (next: ImageFillValue) => {
    setImageFill(next);
    if (onImageFillChange) {
      onImageFillChange(next);
      return;
    }
    emitPaintValue(imageFillToCss(next));
    notifyChangeComplete();
  };

  const setPaintType = (nextType: DesignPaintType) => {
    if (disabled) return;
    if (!isPaintTypeSupported(nextType)) return;

    // A shader is painted beside the fill's color, not instead of it, so
    // leaving the Shader paint takes it off the element first.
    const shaderPane = shaderPaneRef.current;
    if (
      effectivePaintType === "shader" &&
      nextType !== "shader" &&
      shaderPane?.hasShader()
    ) {
      void shaderPane.remove().then((removed) => {
        if (removed) applyPaintType(nextType);
      });
      return;
    }
    applyPaintType(nextType);
  };

  const applyPaintType = (nextType: DesignPaintType) => {
    if (nextType === "shader") {
      setLocalPaintType("shader");
      return;
    }

    if (onPaintTypeChange) {
      setLocalPaintType(nextType);
      if (onPaintTypeChange(nextType) !== false) return;
    }

    setLocalPaintType(nextType);

    if (nextType === "none") {
      lastEmittedValueRef.current = "transparent";
      onChange("transparent");
      notifyChangeComplete();
      return;
    }
    if (nextType === "solid") {
      emitColor(color, effectiveOpacity > 0 ? effectiveOpacity : 100);
      notifyChangeComplete();
      return;
    }
    if (GRADIENT_TYPES.has(nextType)) {
      const base =
        activeGradient ??
        defaultGradient(
          nextType as GradientKind,
          toCssColor(color) || "#000000",
        );
      const next: GradientValue = { ...base, kind: nextType as GradientKind };
      setSelectedStopId(next.stops[0]?.id ?? "");
      emitGradient(next);
      notifyChangeComplete();
      return;
    }
    if (nextType === "image") {
      const nextImageFill = parsedImageFill ?? imageFill;
      if (!nextImageFill.url) return;
      if (onImageFillChange) {
        onImageFillChange(nextImageFill);
        return;
      }
      emitPaintValue(imageFillToCss(nextImageFill));
      notifyChangeComplete();
      return;
    }
  };

  const pickScreenColor = async () => {
    if (!hasEyeDropperSupport() || disabled) return;
    setPicking(true);
    try {
      // The browser eyedropper reads sRGB, so a pick is an sRGB color; in a
      // wide mode it is written in that mode's notation.
      const hex = await beginEyedropperPick();
      if (hex) {
        const parsed = parseCssColor(hex);
        if (wideMode && parsed) {
          emitLinear(rgbaToLinearSrgb(parsed));
        } else {
          lastEmittedValueRef.current = hex;
          onChange(hex);
        }
        notifyChangeComplete();
      }
    } finally {
      setPicking(false);
    }
  };

  const hasEyeDropper = hasEyeDropperSupport();
  const newIsUnresolved = unresolvedToken !== null;

  const showColorControls =
    effectivePaintType === "solid" || effectivePaintType === "none";
  const fieldOpacity = effectiveOpacity;
  const emitFieldOpacity = setOpacity;

  const squareHsv: HsvaColor = wideMode
    ? {
        h: rawWideHsv.h,
        s: Math.round(rawWideHsv.s * 100),
        v: Math.round(rawWideHsv.v * 100),
        a: fieldAlpha,
      }
    : fieldHsv;

  // ── Contrast: a text layer's solid fill, against what is behind it ───────
  const [contrastOn, setContrastOn] = useState(false);
  const contrastToggleVisible =
    contrast !== undefined && effectivePaintType === "solid";
  const contrastActive = contrastToggleVisible && contrastOn;
  const textBackground = useTextBackground(contrast, open && contrastActive);
  const contrastReading =
    contrastActive && contrast
      ? readContrast({
          large: contrast.large,
          background: textBackground,
          linear: fieldLinear,
          alpha: fieldAlpha,
        })
      : null;
  const readyContrast =
    contrastReading?.kind === "ready" ? contrastReading : null;
  const [backgroundR, backgroundG, backgroundB] = readyContrast
    ? [
        readyContrast.background.r,
        readyContrast.background.g,
        readyContrast.background.b,
      ]
    : [undefined, undefined, undefined];
  const aaTarget = readyContrast?.targets.aa;
  const deferredSquareHue = useDeferredValue(squareHsv.h);
  const contrastMap = useMemo(() => {
    if (
      backgroundR === undefined ||
      backgroundG === undefined ||
      backgroundB === undefined ||
      aaTarget === undefined
    ) {
      return null;
    }
    const background = { r: backgroundR, g: backgroundG, b: backgroundB };
    const colorAt = wideMode
      ? (s: number, v: number) =>
          linearFromWideSquare({ h: deferredSquareHue, s, v })
      : (s: number, v: number) =>
          rgbaToLinearSrgb(
            hsvToRgba({ h: deferredSquareHue, s: s * 100, v: v * 100, a: 1 }),
          );
    return computeContrastMap(
      (s, v) =>
        textContrastRatio(colorAt(s, v), fieldAlpha, background) < aaTarget,
    );
  }, [
    aaTarget,
    backgroundB,
    backgroundG,
    backgroundR,
    deferredSquareHue,
    fieldAlpha,
    wideMode,
  ]);

  /** The color as it reads back once written in this mode, or null if it cannot be written. */
  const settleWritten = (candidate: Vec3): Vec3 | null => {
    const css = writeColor(
      mode,
      candidate,
      fieldAlpha,
      lastOklchHueRef.current,
    );
    const wide = readWideColor(css);
    if (wide) return wide.linear;
    const parsed = parseCssColor(css);
    return parsed ? rgbaToLinearSrgb(parsed) : null;
  };
  const previewContrastFix = (target: number): ContrastFix =>
    readyContrast
      ? fixContrast({
          linear: fieldLinear,
          alpha: fieldAlpha,
          background: readyContrast.background,
          target,
          hueHint: lastOklchHueRef.current,
          settle: settleWritten,
        })
      : { kind: "unreachable" };
  const applyContrastFix = (target: number) => {
    const fix = previewContrastFix(target);
    if (fix.kind === "fixed") emitLinear(fix.linear, "commit");
  };
  const askAgentToFixContrast = () => {
    if (!contrast) return;
    contrast.onAskAgent({
      ratio: readyContrast?.ratio ?? null,
      targetRatio: contrastTargets(contrast.large ?? false).aa,
      large: contrast.large,
      background: readyContrast ? rgbToHex(readyContrast.background) : null,
      foreground: fieldModeCss,
    });
    handleOpenChange(false);
  };

  // The value cells share the 248px column: 64 · 64 · 64 · 32 with 8px gaps.
  function renderValueInputs() {
    if (mode === "hex") {
      return (
        <div className="relative col-span-3 min-w-0">
          <span className="pointer-events-none absolute inset-y-0 start-2 flex items-center !text-[11px] text-muted-foreground">
            #
          </span>
          <Input
            value={hexDraft}
            disabled={disabled}
            aria-label={copy.hex}
            spellCheck={false}
            className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] ps-5 pe-2 !text-[11px] tabular-nums uppercase md:!text-[11px]"
            onChange={(e) => {
              hexDraftRef.current = e.target.value;
              setHexDraft(e.target.value);
            }}
            onFocus={(e) => e.target.select()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitHex();
                skipNextHexBlurCommitRef.current = true;
                e.currentTarget.blur();
              }
              if (e.key === "Escape") {
                revertHexDraft();
                skipNextHexBlurCommitRef.current = true;
                e.currentTarget.blur();
              }
            }}
            onBlur={() => {
              if (skipNextHexBlurCommitRef.current) {
                skipNextHexBlurCommitRef.current = false;
                return;
              }
              commitHex();
            }}
          />
        </div>
      );
    }
    if (mode === "p3" || mode === "oklch") {
      const p3 = displayP3Of(fieldLinear, fieldWide);
      const cells = mode === "p3" ? p3Cells(p3) : oklchCells(oklch);
      return (
        <>
          {cells.map((cell, index) => (
            <ScrubbyNumberInput
              key={cell.key}
              aria-label={cell.label}
              prefix={cell.label}
              value={cell.value}
              min={cell.min}
              max={cell.max}
              step={cell.step}
              decimals={cell.decimals}
              disabled={disabled}
              onChange={(next) =>
                emitModeCss(
                  mode === "p3"
                    ? formatDisplayP3Css(
                        withP3Cell(p3, index, next),
                        fieldAlpha,
                      )
                    : formatOklchCss(
                        withOklchCell(oklch, cell.key, next),
                        fieldAlpha,
                      ),
                )
              }
              onCommit={notifyChangeComplete}
            />
          ))}
        </>
      );
    }
    if (mode === "rgb") {
      return (
        <>
          {(["r", "g", "b"] as const).map((ch) => (
            <ScrubbyNumberInput
              key={ch}
              aria-label={ch.toUpperCase()}
              prefix={ch.toUpperCase()}
              value={fieldColor[ch]}
              min={0}
              max={255}
              disabled={disabled}
              onChange={(next) => emitFieldColor({ ...fieldColor, [ch]: next })}
              onCommit={notifyChangeComplete}
            />
          ))}
        </>
      );
    }
    if (mode === "hsl") {
      return (
        <>
          <ScrubbyNumberInput
            aria-label={copy.hue}
            prefix={copy.hue}
            value={fieldHsl.h}
            min={0}
            max={360}
            disabled={disabled}
            onChange={(h) => emitFieldHsl({ ...fieldHsl, h })}
            onCommit={notifyChangeComplete}
          />
          <ScrubbyNumberInput
            aria-label={copy.saturation}
            prefix={copy.saturation}
            value={fieldHsl.s}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(s) => emitFieldHsl({ ...fieldHsl, s })}
            onCommit={notifyChangeComplete}
          />
          <ScrubbyNumberInput
            aria-label={copy.lightness}
            prefix={copy.lightness}
            value={fieldHsl.l}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(l) => emitFieldHsl({ ...fieldHsl, l })}
            onCommit={notifyChangeComplete}
          />
        </>
      );
    }
    return (
      <>
        <ScrubbyNumberInput
          aria-label={copy.hue}
          prefix={copy.hue}
          value={fieldHsv.h}
          min={0}
          max={360}
          disabled={disabled}
          onChange={(h) => emitFieldHsv({ ...fieldHsv, h })}
          onCommit={notifyChangeComplete}
        />
        <ScrubbyNumberInput
          aria-label={copy.saturation}
          prefix={copy.saturation}
          value={fieldHsv.s}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(s) => emitFieldHsv({ ...fieldHsv, s })}
          onCommit={notifyChangeComplete}
        />
        <ScrubbyNumberInput
          aria-label={copy.brightness}
          prefix={copy.brightness}
          value={fieldHsv.v}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(v) => emitFieldHsv({ ...fieldHsv, v })}
          onCommit={notifyChangeComplete}
        />
      </>
    );
  }

  /**
   * The 40px paint row: Solid, Gradient, Image and Shader on the left (and No
   * fill, where the caller allows it), Blend and Contrast on the right.
   */
  function renderPaintRow() {
    const paints: PaintRowEntry[] = [];
    for (const entry of PAINT_ROW_TYPES) {
      const supported = entry.types.filter(isPaintTypeSupported);
      if (supported.length === 0) continue;
      const active = supported.includes(effectivePaintType);
      paints.push({
        id: entry.id,
        label: entry.label,
        Icon: entry.Icon,
        active,
        onSelect: () => {
          if (!active) setPaintType(supported[0]!);
        },
      });
    }
    if (isPaintTypeSupported(NO_FILL_PAINT.type)) {
      const active = effectivePaintType === NO_FILL_PAINT.type;
      paints.push({
        id: NO_FILL_PAINT.type,
        label: NO_FILL_PAINT.label,
        Icon: NO_FILL_PAINT.Icon,
        active,
        onSelect: () => {
          if (!active) setPaintType(NO_FILL_PAINT.type);
        },
      });
    }
    const blend =
      showBlendMode && onBlendModeChange
        ? {
            label: copy.blendMode,
            value: blendModeValue,
            onChange: onBlendModeChange,
          }
        : undefined;
    const contrastToggle = contrastToggleVisible
      ? {
          label: t("editPanel.colorPicker.contrast"),
          pressed: contrastOn,
          onToggle: () => setContrastOn((current) => !current),
        }
      : undefined;
    if (paints.length <= 1 && !blend && !contrastToggle) return null;
    return (
      <PaintRow
        paints={paints}
        blend={blend}
        contrast={contrastToggle}
        disabled={disabled}
        onTooltipEscape={closeFromTooltipEscape}
      />
    );
  }

  /** One select for the four gradient kinds, as Mode is one select for color. */
  function renderGradientType() {
    const kinds = GRADIENT_KINDS.filter(isPaintTypeSupported);
    if (!activeGradient || kinds.length <= 1) return null;
    return (
      <Select
        value={effectivePaintType}
        disabled={disabled}
        onValueChange={(next) => setPaintType(next as DesignPaintType)}
      >
        <SelectTrigger
          aria-label={copy.gradientType}
          className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {kinds.map((kind) => (
            <SelectItem key={kind} value={kind} className="!text-[11px]">
              {copy[kind]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  /**
   * The second picker, beside the panel and level with the row whose swatch
   * was clicked. It is a sibling popover rendered inside this one's React
   * tree, so a click in it is not a click outside the panel, and Escape
   * closes it before it closes the panel.
   */
  const renderNestedColorPicker: RenderNestedColorPicker = (
    request: NestedColorRequest,
  ) => (
    <DesignColorPicker
      open
      anchorElement={request.anchor}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) request.onClose();
      }}
      value={request.css}
      paintType="solid"
      supportedPaintTypes={SOLID_ONLY}
      onChange={request.onChange}
      onChangeComplete={request.onCommit}
      documentColors={shownDocumentColors}
      side={side}
      restoreOnEscape
      opaqueSrgb={request.opaqueSrgb}
      allowDesignHistoryHotkeys={allowDesignHistoryHotkeys}
      onDesignHistoryHotkey={onDesignHistoryHotkey}
      disabled={disabled}
      labels={labels}
    />
  );

  /** The ratio chip and level above the square, in contrast mode. */
  function renderContrastBar() {
    if (!contrastReading || !showColorControls) return null;
    return (
      <ContrastBar
        reading={contrastReading}
        foreground={fieldModeCss}
        disabled={disabled}
        previewFix={previewContrastFix}
        onFix={applyContrastFix}
        onAskAgent={askAgentToFixContrast}
      />
    );
  }

  /** The 248px saturation/brightness square. Hidden for image fills. */
  function renderColorSquare() {
    if (!showColorControls) return null;
    return (
      <div className="px-3 pt-3">
        <SaturationBrightnessField
          hsv={squareHsv}
          hueColor={wideMode ? wideHueColor(squareHsv.h) : undefined}
          label={copy.saturationBrightness}
          disabled={disabled}
          overlay={
            contrastMap ? <ContrastOverlay map={contrastMap} /> : undefined
          }
          onChange={(nextHsv) => {
            if (wideMode) {
              emitLinear(
                linearFromWideSquare({
                  h: nextHsv.h,
                  s: nextHsv.s / 100,
                  v: nextHsv.v / 100,
                }),
              );
            } else {
              emitColorFromHsv(nextHsv);
            }
          }}
          onCommit={notifyChangeComplete}
        />
      </div>
    );
  }

  /** Eyedropper · hue and opacity tracks · the New and Previous swatch, on one 24 · 1fr · 40 grid. */
  function renderColorSliders() {
    if (!showColorControls) return null;
    const fallbacks = newIsUnresolved ? null : gamutFallbacks(fieldLinear);
    const gamutNotes = fallbacks
      ? [
          t("editPanel.colorPicker.outsideSrgb", { hex: fallbacks.srgbHex }),
          ...(fallbacks.p3Css
            ? [t("editPanel.colorPicker.outsideP3", { css: fallbacks.p3Css })]
            : []),
        ]
      : [];
    return (
      <div className="mt-3 grid grid-cols-[1.5rem_1fr_2.5rem] items-center gap-2 px-3">
        <div className="col-start-1 row-span-2 row-start-1 flex items-center justify-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={
                  "Pick color" /* i18n-ignore browser eyedropper label */
                }
                disabled={disabled || !hasEyeDropper}
                onClick={() => void pickScreenColor()}
                className={cn(
                  "flex size-6 cursor-pointer items-center justify-center rounded-md transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  picking
                    ? "bg-primary/10 text-primary ring-1 ring-primary/50"
                    : "text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                  (disabled || !hasEyeDropper) &&
                    "pointer-events-none opacity-40",
                )}
              >
                <IconColorPicker className="size-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent onEscapeKeyDown={closeFromTooltipEscape}>
              {
                hasEyeDropper
                  ? "Pick color" // i18n-ignore browser eyedropper label
                  : "Not supported in this browser" // i18n-ignore browser eyedropper disabled label
              }
            </TooltipContent>
          </Tooltip>
        </div>

        <div className="col-start-2 row-start-1">
          <ColorTrack
            label={copy.hue}
            value={
              mode === "oklch"
                ? oklch.h
                : mode === "p3"
                  ? rawWideHsv.h
                  : fieldHsv.h
            }
            min={0}
            max={360}
            disabled={disabled}
            backgroundImage={hueTrackBackground(mode)}
            onChange={(next) => {
              const h = next === 360 ? 0 : next;
              if (mode === "oklch") {
                lastOklchHueRef.current = h;
                emitModeCss(formatOklchCss({ ...oklch, h }, fieldAlpha));
                return;
              }
              if (mode === "p3") {
                lastWideHueRef.current = h;
                emitLinear(
                  linearFromWideSquare({
                    h,
                    s: rawWideHsv.s,
                    v: rawWideHsv.v,
                  }),
                );
                return;
              }
              lastHueRef.current = h;
              emitColorFromHsv({ ...hsv, h });
            }}
            onCommit={notifyChangeComplete}
          />
        </div>

        {!opaqueSrgb && (
          <div className="col-start-2 row-start-2">
            <ColorTrack
              label={copy.opacity}
              value={fieldOpacity}
              min={0}
              max={100}
              disabled={disabled}
              backgroundImage={
                isWideGamutNotation(fieldModeCss)
                  ? alphaTrackBackgroundFor(
                      rewriteAlpha(mode, fieldCss, 0) ?? fieldModeCss,
                      rewriteAlpha(mode, fieldCss, 1) ?? fieldModeCss,
                    )
                  : alphaTrackBackground(fieldColor)
              }
              backgroundColor={CHECKER_B}
              backgroundSize="100% 100%, 8px 8px"
              backgroundPosition="0 0, 0 0"
              onChange={emitFieldOpacity}
              onCommit={notifyChangeComplete}
              onCancel={
                onChangeCancel
                  ? () => onChangeCancel(lastEmittedValueRef.current)
                  : undefined
              }
            />
          </div>
        )}

        <ColorCompareSwatch
          newCss={fieldModeCss}
          newUnresolved={newIsUnresolved}
          previousCss={previous.css}
          previousUnresolved={previous.unresolved}
          gamutNotes={gamutNotes}
          disabled={disabled}
          onRestore={restorePrevious}
          onTooltipEscape={closeFromTooltipEscape}
        />
      </div>
    );
  }

  /** `[Mode ▾] [Opacity]` over the mode's value cells and the copy button. */
  function renderColorValues() {
    if (!showColorControls) return null;
    return (
      <div className="mt-3 grid grid-cols-[1fr_1fr_1fr_2rem] items-center gap-2 px-3 pb-3">
        <div
          className={cn("min-w-0", opaqueSrgb ? "col-span-4" : "col-span-2")}
        >
          <ColorModeSelect
            value={mode}
            disabled={disabled}
            wideGamut={!opaqueSrgb}
            onChange={changeMode}
          />
        </div>
        {!opaqueSrgb && (
          <div className="col-span-2 min-w-0">
            <ScrubbyNumberInput
              aria-label={copy.opacity}
              prefix={<IconGridDots className="size-3.5" />}
              suffix="%"
              value={fieldOpacity}
              min={0}
              max={100}
              disabled={disabled}
              onChange={emitFieldOpacity}
              onCommit={notifyChangeComplete}
            />
          </div>
        )}
        {renderValueInputs()}
        <CopyValueButton
          text={fieldModeCss}
          disabled={disabled}
          onTooltipEscape={closeFromTooltipEscape}
        />
      </div>
    );
  }

  /** Colors already used in the design; the current color when there are none. */
  function renderDocumentColors() {
    return (
      <DocumentColors
        colors={
          shownDocumentColors && shownDocumentColors.length > 0
            ? shownDocumentColors
            : [normalizeCssColor(value) ?? rgbaToCss(color)]
        }
        currentCss={value}
        currentIsActive
        disabled={disabled}
        onTooltipEscape={closeFromTooltipEscape}
        onPick={pickDocumentColor}
      />
    );
  }

  function renderCustomPane() {
    return (
      <>
        {renderPaintRow()}

        {effectivePaintType === "image" && (
          <ImageFillControls
            value={imageFill}
            disabled={disabled}
            onChange={emitImageFill}
          />
        )}

        {activeGradient && (
          <GradientEditor
            value={activeGradient}
            selectedStopId={effectiveSelectedStopId}
            disabled={disabled}
            typeControl={renderGradientType()}
            renderColorPicker={renderNestedColorPicker}
            onSelectStop={setSelectedStopId}
            onChange={emitGradient}
            onCommit={notifyChangeComplete}
          />
        )}

        {effectivePaintType === "shader" && glslShaderContext && (
          <ShaderPane
            context={glslShaderContext}
            disabled={disabled}
            controllerRef={shaderPaneRef}
            renderColorPicker={renderNestedColorPicker}
            onRemoved={() => applyPaintType("solid")}
          />
        )}

        {renderContrastBar()}
        {renderColorSquare()}
        {renderColorSliders()}
        {renderColorValues()}
        {showColorControls && renderDocumentColors()}
      </>
    );
  }

  const unresolvedTitle = unresolvedToken
    ? t(UNRESOLVED_TOKEN_COPY[unresolvedToken.reason], {
        name: unresolvedToken.name,
      })
    : undefined;
  const fieldTokenName =
    effectivePaintType === "solid" && boundVar
      ? (findToken(tokens, boundVar)?.name ?? boundVar)
      : null;
  const fieldReading = readFillField({
    paint: GRADIENT_TYPES.has(effectivePaintType)
      ? "gradient"
      : effectivePaintType === "solid"
        ? "solid"
        : effectivePaintType === "image"
          ? "image"
          : effectivePaintType === "shader"
            ? "shader"
            : "none",
    paintName: fillPaintName(effectivePaintType, copy, paintLabel),
    value,
    authored: authoredValue,
    token: fieldTokenName
      ? { name: fieldTokenName, unresolved: unresolvedToken !== null }
      : null,
  });
  const shownOpacity = showsOpacity(fieldReading, effectiveOpacity)
    ? effectiveOpacity
    : null;
  const fieldIsTyped =
    fieldReading.kind === "hex" ||
    fieldReading.kind === "css" ||
    fieldReading.kind === "wide";
  const fieldTitle =
    unresolvedTitle ??
    (fieldReading.kind === "wide"
      ? value
      : fieldReading.kind === "css"
        ? (authoredValue ?? value)
        : fieldTokenName && boundVar
          ? tokenVarCss(boundVar)
          : undefined);

  /**
   * Writes what was typed into the Fill field: hex and rgb as a color with its
   * opacity, anything else (Display P3, OKLCH, a name, an HSL color) as typed.
   */
  const commitFieldText = (css: string) => {
    if (!/^(?:#|rgba?\()/i.test(css)) {
      emitCssValue(css, "commit");
      return;
    }
    const parsed = parseCssColor(css);
    if (!parsed) return;
    const nextOpacity = alphaToOpacity(parsed.a);
    if (nextOpacity !== effectiveOpacity && onOpacityChange) {
      onOpacityChange(nextOpacity);
    }
    emitColor(parsed, nextOpacity, "commit");
  };

  // The header stays through every paint type, so switching to a gradient does
  // not move the picker's contents; picking a token there makes the fill that
  // token's solid color. A bound fill opens on Libraries, but only while it is
  // solid: a gradient picked from it opens on its own controls.
  const showHeader = onPickToken !== undefined;
  const activeTab: ColorPickerTab = showHeader
    ? (pickedTab ??
      (boundVar && effectivePaintType === "solid" ? "libraries" : "custom"))
    : "custom";

  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {anchorRef ? (
          <PopoverAnchor virtualRef={anchorRef} />
        ) : trigger ? (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        ) : (
          <PopoverAnchor asChild>
            <div
              className={cn(
                "flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] pl-1.5 pr-0 !text-[11px] shadow-none",
                "hover:bg-[var(--design-editor-panel-raised-bg)]",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              {fieldIsTyped ? (
                <>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={copy.trigger}
                      title={fieldTitle}
                      className="size-3.5 shrink-0 rounded-[3px] border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={triggerSwatchStyle(value, color)}
                    />
                  </PopoverTrigger>
                  <FillFieldText
                    reading={fieldReading}
                    alpha={opacityToAlpha(effectiveOpacity)}
                    ariaLabel={copy.rowHex}
                    disabled={disabled}
                    onCommit={commitFieldText}
                  />
                  {shownOpacity !== null && (
                    <>
                      <InlinePaintField
                        ariaLabel={copy.rowOpacity}
                        value={String(shownOpacity)}
                        disabled={disabled}
                        className="w-7 shrink-0 text-right"
                        parse={(draft) => {
                          const next = Number.parseFloat(
                            draft.replace(/%$/, ""),
                          );
                          return Number.isFinite(next)
                            ? String(
                                Math.round(Math.min(100, Math.max(0, next))),
                              )
                            : null;
                        }}
                        onCommit={(next) => {
                          const nextOpacity = Number(next);
                          if (onOpacityChange) onOpacityChange(nextOpacity);
                          emitCssValue(
                            rewriteAlpha(
                              mode,
                              value,
                              opacityToAlpha(nextOpacity),
                              lastOklchHueRef.current,
                            ) ??
                              rgbaToCss(withColorOpacity(color, nextOpacity)),
                            "commit",
                          );
                        }}
                      />
                      <span className="-ml-1 tabular-nums text-muted-foreground !text-[11px]">
                        %
                      </span>
                    </>
                  )}
                  {/* The chevron opens the picker like the swatch does. It is
                      not a second trigger: Radix treats only one element as
                      the trigger, and a press on it would read as outside. */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden="true"
                    disabled={disabled}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => handleOpenChange(!open)}
                    className="-ml-1.5 flex h-full w-3.5 shrink-0 items-center justify-center focus-visible:outline-none"
                  >
                    <FillFieldChevron />
                  </button>
                </>
              ) : (
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={copy.trigger}
                    title={fieldTitle}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
                  >
                    <FillFieldFace
                      reading={fieldReading}
                      swatch={
                        <FillFieldSwatch
                          style={triggerSwatchStyle(value, color)}
                          unresolved={unresolvedToken !== null}
                        />
                      }
                      opacity={shownOpacity}
                      mixedLabel=""
                    />
                  </button>
                </PopoverTrigger>
              )}
            </div>
          </PopoverAnchor>
        )}

        {/* 272px: 12px padding around one 248px column, on the 8pt grid. The
            border is an inset ring so it takes no layout space. */}
        <PopoverContent
          side={side}
          align="start"
          sideOffset={8}
          className="max-h-[var(--radix-popover-content-available-height)] w-[272px] overflow-y-auto border-0 p-0 shadow-xl ring-1 ring-inset ring-border"
          data-design-chrome-region="right-panel"
          data-design-history-hotkeys={
            allowDesignHistoryHotkeys ? "true" : undefined
          }
          onKeyDown={(event) => {
            if (
              (event.metaKey || event.ctrlKey) &&
              !event.altKey &&
              (event.key.toLowerCase() === "z" ||
                event.key.toLowerCase() === "y")
            ) {
              onDesignHistoryHotkey?.();
            }
            // The editor's delete hotkey listens on window and takes these as
            // aimed at the selected canvas layer. In the picker they are for
            // what it holds (a gradient pin, a text field), never the layer.
            if (event.key === "Backspace" || event.key === "Delete") {
              event.stopPropagation();
            }
          }}
          onFocusOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={restoreOnEscape ? restorePrevious : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          tabIndex={-1}
        >
          <div className="rounded-md bg-popover text-popover-foreground">
            {showHeader && (
              <ColorPickerHeader tab={activeTab} onTabChange={setPickedTab} />
            )}
            {activeTab === "libraries" ? (
              <ColorLibraries
                tokens={tokens}
                activeVar={boundVar}
                disabled={disabled}
                onPick={pickToken}
              />
            ) : (
              renderCustomPane()
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

export function inferPaintType(
  value: string,
  opacity: number,
): DesignPaintType {
  const lower = value.trim().toLowerCase();
  if (lower.includes("gradient(")) {
    if (
      lower.startsWith("radial-gradient") ||
      lower.startsWith("repeating-radial-gradient")
    ) {
      if (/closest-corner/.test(lower) || /ellipse\s+closest-side/.test(lower))
        return "diamond";
      return "radial";
    }
    if (
      lower.startsWith("conic-gradient") ||
      lower.startsWith("repeating-conic-gradient")
    )
      return "angular";
    return "linear";
  }
  if (lower.startsWith("url(")) return "image";
  const parsed = parseCssColorExtended(value);
  if (opacity <= 0 || parsed?.a === 0 || value.trim() === "transparent") {
    return "none";
  }
  return "solid";
}

export const GRADIENT_PAINT_TYPES: ReadonlySet<DesignPaintType> = new Set([
  "linear",
  "radial",
  "angular",
  "diamond",
]);

export function resolveActivePaint(
  paintType: DesignPaintType | undefined,
  localPaintType: DesignPaintType | null,
  value: string,
  opacity: number,
): {
  effectivePaintType: DesignPaintType;
  showGradientEditor: boolean;
  showImageControls: boolean;
  showShaderPanel: boolean;
} {
  const effectivePaintType: DesignPaintType =
    localPaintType ?? paintType ?? inferPaintType(value, opacity);
  return {
    effectivePaintType,
    showGradientEditor: GRADIENT_PAINT_TYPES.has(effectivePaintType),
    showImageControls: effectivePaintType === "image",
    showShaderPanel: effectivePaintType === "shader",
  };
}
