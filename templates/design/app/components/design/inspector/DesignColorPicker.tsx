import {
  alphaToOpacity,
  parseCssColor,
  parseCssColorExtended,
  rgbaToCss,
  rgbaToHex,
  rgbaToHsl,
  hslToRgba,
  opacityToAlpha,
  withColorOpacity,
  type HslaColor,
  type RgbaColor,
} from "@shared/color-utils";
import type { ShaderDescriptor } from "@shared/shader-presets";
import {
  IconChevronDown,
  IconCircleOff as IconNoneFill,
  IconColorPicker,
  IconDroplet as IconShaderFill,
  IconGrain as IconNoiseFill,
  IconGridPattern as IconPatternFill,
  IconPhoto as IconImageFill,
  IconSquareFilled as IconSolid,
  IconVideo as IconVideoFill,
} from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type KeyboardEvent,
  type PointerEvent,
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
  GlslShaderPanel,
  type GlslShaderPanelContext,
} from "./GlslShaderPanel";
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
import { ShaderFillsPanel } from "./ShaderFillsPanel";

export type DesignColorMode = "hex" | "rgb" | "hsl" | "hsb";
export type DesignGradientType = "linear" | "radial" | "angular" | "diamond";
export type DesignFillType = "solid" | "gradient" | "image";
export type DesignPaintType =
  | "solid"
  | "linear"
  | "radial"
  | "angular"
  | "diamond"
  | "image"
  | "video"
  | "shader"
  | "noise"
  | "pattern"
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
  shaderContext?: {
    designId?: string;
    fileId?: string;
    nodeId?: string;
    selector?: string;
  };
  glslShaderContext?: GlslShaderPanelContext;
  onShaderChange?: (descriptor: ShaderDescriptor, css: string) => void;
  labels?: Partial<DesignColorPickerLabels>;
  allowDesignHistoryHotkeys?: boolean;
  onDesignHistoryHotkey?: () => void;
  disabled?: boolean;
  className?: string;
  trigger?: ReactNode;
}

interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

const FALLBACK_COLOR: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };

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

// Keep transparency tiles light on both light and dark editor surfaces.
// guard:allow-raw-color — fixed light checkerboard tile keeps transparency visible.
const CHECKER_A = "#e5e5e5";
// guard:allow-raw-color — fixed light checkerboard tile keeps transparency visible.
const CHECKER_B = "#ffffff";
const CHECKERBOARD_IMAGE = `conic-gradient(${CHECKER_A} 25%, ${CHECKER_B} 0 50%, ${CHECKER_A} 0 75%, ${CHECKER_B} 0)`;

function IconLinearGradient({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <linearGradient id="lg-ico" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
        </linearGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill="url(#lg-ico)"
        stroke="currentColor"
        strokeOpacity="0.5"
      />
    </svg>
  );
}

function IconRadialGradient({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <radialGradient id="rg-ico" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill="url(#rg-ico)"
        stroke="currentColor"
        strokeOpacity="0.5"
      />
    </svg>
  );
}

function IconAngularGradient({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <linearGradient id="ag-ico" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill="url(#ag-ico)"
        stroke="currentColor"
        strokeOpacity="0.5"
      />
      <line
        x1="12"
        y1="4"
        x2="12"
        y2="20"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeDasharray="2 2"
      />
      <line
        x1="4"
        y1="12"
        x2="20"
        y2="12"
        stroke="currentColor"
        strokeOpacity="0.4"
        strokeDasharray="2 2"
      />
    </svg>
  );
}

function IconDiamondGradient({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <radialGradient
          id="dg-ico"
          cx="50%"
          cy="50%"
          r="50%"
          gradientTransform="scale(1, 1)"
        >
          <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <polygon
        points="12,4 20,12 12,20 4,12"
        fill="url(#dg-ico)"
        stroke="currentColor"
        strokeOpacity="0.5"
      />
    </svg>
  );
}

const PAINT_TYPES: Array<{
  type: DesignPaintType;
  label: string;
  Icon: ElementType<{ className?: string }>;
}> = [
  { type: "solid", label: "Solid", Icon: IconSolid }, // i18n-ignore paint type label
  { type: "linear", label: "Linear", Icon: IconLinearGradient }, // i18n-ignore paint type label
  { type: "radial", label: "Radial", Icon: IconRadialGradient }, // i18n-ignore paint type label
  { type: "angular", label: "Angular", Icon: IconAngularGradient }, // i18n-ignore paint type label
  { type: "diamond", label: "Diamond", Icon: IconDiamondGradient }, // i18n-ignore paint type label
  { type: "image", label: "Image", Icon: IconImageFill }, // i18n-ignore paint type label
  { type: "video", label: "Video", Icon: IconVideoFill }, // i18n-ignore paint type label
  { type: "shader", label: "Shader", Icon: IconShaderFill }, // i18n-ignore paint type label
  { type: "noise", label: "Noise", Icon: IconNoiseFill }, // i18n-ignore paint type label
  { type: "pattern", label: "Pattern", Icon: IconPatternFill }, // i18n-ignore paint type label
  { type: "none", label: "None", Icon: IconNoneFill }, // i18n-ignore paint type label
];

const GRADIENT_TYPES = new Set<DesignPaintType>([
  "linear",
  "radial",
  "angular",
  "diamond",
]);

const NOISE_FALLBACK_CSS =
  "repeating-conic-gradient(#0000 0% 25%, #00000010 0% 50%) 0 0 / 6px 6px, #8a8a8a";
const PATTERN_FALLBACK_CSS =
  "repeating-linear-gradient(45deg, #00000014 0 6px, #ffffff14 6px 12px), #9aa0a6";
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
    return null;
  }
}

export function DesignColorPicker({
  value,
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
  shaderContext,
  glslShaderContext,
  onShaderChange,
  labels,
  allowDesignHistoryHotkeys = false,
  onDesignHistoryHotkey,
  disabled = false,
  className,
  trigger,
}: DesignColorPickerProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const color = useMemo(
    () => parseCssColorExtended(value) ?? FALLBACK_COLOR,
    [value],
  );
  const hsv = rgbaToHsv(color);

  const effectiveOpacity = opacity ?? alphaToOpacity(color.a);
  const blendModeValue = BLEND_MODE_OPTIONS.some(
    (option) => option.value === blendMode,
  )
    ? blendMode
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

  const [mode, setMode] = useState<DesignColorMode>("hex");
  const [hexDraft, setHexDraft] = useState(() => toDisplayHex(color));
  const hexDraftRef = useRef(hexDraft);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = controlledOpen ?? uncontrolledOpen;
  const documentColorsAtOpenRef = useRef(documentColors);
  if (!open) documentColorsAtOpenRef.current = documentColors;
  const shownDocumentColors = documentColorsAtOpenRef.current;
  const handleOpenChange = (nextOpen: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(nextOpen);
    onControlledOpenChange?.(nextOpen);
  };
  const closeFromTooltipEscape = () => handleOpenChange(false);
  const [picking, setPicking] = useState(false);
  const skipNextHexBlurCommitRef = useRef(false);
  const lastHueRef = useRef<number>(0);

  const [view, setView] = useState<"picker" | "shader">("picker");

  const [localPaintType, setLocalPaintType] = useState<DesignPaintType | null>(
    null,
  );

  const [localGradient, setLocalGradient] = useState<GradientValue | null>(
    null,
  );
  const [selectedStopId, setSelectedStopId] = useState<string>("");
  const [imageFill, setImageFill] = useState<ImageFillValue>(
    () => parsedImageFill ?? { url: "", fit: "fill" },
  );
  const [shaderDescriptor, setShaderDescriptor] =
    useState<ShaderDescriptor | null>(null);

  const visiblePaintTypes = supportedPaintTypes
    ? PAINT_TYPES.filter((entry) => supportedPaintTypes.includes(entry.type))
    : PAINT_TYPES;
  const isPaintTypeSupported = (type: DesignPaintType) =>
    !supportedPaintTypes || supportedPaintTypes.includes(type);

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
    onChangeComplete?.(lastEmittedValueRef.current);
  };

  const emitColor = (
    nextColor: RgbaColor,
    nextOpacity = effectiveOpacity,
    phase: "preview" | "commit" = "preview",
  ) => {
    const next = rgbaToCss(withColorOpacity(nextColor, nextOpacity));
    lastEmittedValueRef.current = next;
    if (phase === "commit" && onChangeComplete) onChangeComplete(next);
    else onChange(next);
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
    const reverted = toDisplayHex(activeGradient ? fieldColor : color);
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
    if (activeGradient) {
      const hexIncludesAlpha = hasHexAlpha(currentDraft);
      emitStopColor(
        hexIncludesAlpha ? parsed : { ...parsed, a: fieldColor.a },
        "commit",
      );
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
    lastEmittedValueRef.current = rgbaToCss(
      withColorOpacity(color, nextOpacity),
    );
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

  const fieldColor: RgbaColor = activeGradient
    ? (parseCssColorExtended(selectedStop?.color ?? "#000000") ??
      FALLBACK_COLOR)
    : color;
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

  const selectedStopColor = selectedStop?.color;
  useEffect(() => {
    if (!activeGradient || !selectedStopColor) return;
    const parsed = parseCssColorExtended(selectedStopColor);
    if (parsed) {
      const next = toDisplayHex(parsed);
      hexDraftRef.current = next;
      setHexDraft(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopColor, effectiveSelectedStopId]);

  const emitStopColor = (
    nextColor: RgbaColor,
    phase: "preview" | "commit" = "preview",
  ) => {
    if (!activeGradient || !selectedStop) return;
    emitGradient(
      {
        ...activeGradient,
        stops: activeGradient.stops.map((stop) =>
          stop.id === selectedStop.id
            ? { ...stop, color: rgbaToCss(nextColor) }
            : stop,
        ),
      },
      phase,
    );
  };

  const emitFieldColor = (next: RgbaColor) => {
    if (activeGradient) emitStopColor({ ...next, a: fieldColor.a });
    else emitColor(next);
  };
  const emitFieldHsl = (next: HslaColor) => {
    if (activeGradient) emitStopColor(hslToRgba({ ...next, a: fieldColor.a }));
    else emitColorFromHsl(next);
  };
  const emitFieldHsv = (next: HsvaColor) => {
    if (activeGradient) emitStopColor(hsvToRgba({ ...next, a: fieldColor.a }));
    else emitColorFromHsv(next);
  };

  const emitImageFill = (next: ImageFillValue) => {
    setImageFill(next);
    if (onImageFillChange) {
      onImageFillChange(next);
      return;
    }
    emitPaintValue(imageFillToCss(next));
    notifyChangeComplete();
  };

  const previewShader = (descriptor: ShaderDescriptor, css: string) => {
    setShaderDescriptor(descriptor);
    emitPaintValue(css);
  };

  const commitShader = (descriptor: ShaderDescriptor, css: string) => {
    setShaderDescriptor(descriptor);
    onShaderChange?.(descriptor, css);
    emitPaintValue(css);
    notifyChangeComplete();
  };

  const setPaintType = (nextType: DesignPaintType) => {
    if (disabled) return;
    if (!isPaintTypeSupported(nextType)) return;

    if (nextType === "shader") {
      setLocalPaintType("shader");
      setView("shader");
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
      if (onImageFillChange && nextImageFill.url) {
        onImageFillChange(nextImageFill);
        return;
      }
      emitPaintValue(
        nextImageFill.url ? imageFillToCss(nextImageFill) : "transparent",
      );
      notifyChangeComplete();
      return;
    }
    if (nextType === "video") {
      emitPaintValue("transparent");
      notifyChangeComplete();
      return;
    }
    if (nextType === "noise") {
      emitPaintValue(NOISE_FALLBACK_CSS);
      notifyChangeComplete();
      return;
    }
    if (nextType === "pattern") {
      emitPaintValue(PATTERN_FALLBACK_CSS);
      notifyChangeComplete();
      return;
    }
  };

  const pickScreenColor = async () => {
    if (!hasEyeDropperSupport() || disabled) return;
    setPicking(true);
    try {
      const hex = await beginEyedropperPick();
      if (hex) {
        if (activeGradient) {
          const parsed = parseCssColor(hex);
          if (parsed) emitStopColor({ ...parsed, a: fieldColor.a });
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

  function renderValueInputs() {
    if (mode === "hex") {
      return (
        <Input
          value={hexDraft}
          disabled={disabled}
          aria-label={copy.hex}
          spellCheck={false}
          className="h-6 min-w-0 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] tabular-nums uppercase md:!text-[11px]"
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
      );
    }
    if (mode === "rgb") {
      return (
        <div className="flex gap-1">
          {(["r", "g", "b"] as const).map((ch) => (
            <ScrubbyNumberInput
              key={ch}
              aria-label={ch.toUpperCase()}
              value={fieldColor[ch]}
              min={0}
              max={255}
              disabled={disabled}
              onChange={(next) => emitFieldColor({ ...fieldColor, [ch]: next })}
              onCommit={notifyChangeComplete}
            />
          ))}
        </div>
      );
    }
    if (mode === "hsl") {
      return (
        <div className="flex gap-1">
          <ScrubbyNumberInput
            aria-label={copy.hue}
            value={fieldHsl.h}
            min={0}
            max={360}
            disabled={disabled}
            onChange={(h) => emitFieldHsl({ ...fieldHsl, h })}
            onCommit={notifyChangeComplete}
          />
          <ScrubbyNumberInput
            aria-label={copy.saturation}
            value={fieldHsl.s}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(s) => emitFieldHsl({ ...fieldHsl, s })}
            onCommit={notifyChangeComplete}
          />
          <ScrubbyNumberInput
            aria-label={copy.lightness}
            value={fieldHsl.l}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(l) => emitFieldHsl({ ...fieldHsl, l })}
            onCommit={notifyChangeComplete}
          />
        </div>
      );
    }
    return (
      <div className="flex gap-1">
        <ScrubbyNumberInput
          aria-label={copy.hue}
          value={fieldHsv.h}
          min={0}
          max={360}
          disabled={disabled}
          onChange={(h) => emitFieldHsv({ ...fieldHsv, h })}
          onCommit={notifyChangeComplete}
        />
        <ScrubbyNumberInput
          aria-label={copy.saturation}
          value={fieldHsv.s}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(s) => emitFieldHsv({ ...fieldHsv, s })}
          onCommit={notifyChangeComplete}
        />
        <ScrubbyNumberInput
          aria-label={copy.brightness}
          value={fieldHsv.v}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(v) => emitFieldHsv({ ...fieldHsv, v })}
          onCommit={notifyChangeComplete}
        />
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover open={open} onOpenChange={handleOpenChange}>
        {trigger ? (
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        ) : (
          <PopoverAnchor asChild>
            <div
              className={cn(
                "flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] shadow-none",
                "hover:bg-[var(--design-editor-panel-raised-bg)]",
                disabled && "pointer-events-none opacity-50",
              )}
            >
              {effectivePaintType === "solid" ? (
                <>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={copy.trigger}
                      className="size-4 shrink-0 rounded-[3px] border border-border/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      style={triggerSwatchStyle(value, color)}
                    />
                  </PopoverTrigger>
                  <InlinePaintField
                    ariaLabel={copy.rowHex}
                    value={toDisplayHex(color)}
                    disabled={disabled}
                    className="min-w-0 flex-1 uppercase"
                    parse={(draft) => {
                      const hex = expandHexShorthand(draft.trim());
                      return parseCssColor(`#${hex.replace(/^#/, "")}`)
                        ? hex
                        : null;
                    }}
                    onCommit={(hex) => {
                      const parsed = parseCssColor(`#${hex.replace(/^#/, "")}`);
                      if (!parsed) return;
                      const nextOpacity = hasHexAlpha(hex)
                        ? alphaToOpacity(parsed.a)
                        : effectiveOpacity;
                      if (hasHexAlpha(hex) && onOpacityChange)
                        onOpacityChange(nextOpacity);
                      emitColor(parsed, nextOpacity, "commit");
                    }}
                  />
                  <InlinePaintField
                    ariaLabel={copy.rowOpacity}
                    value={String(effectiveOpacity)}
                    disabled={disabled}
                    className="w-7 shrink-0 text-right"
                    parse={(draft) => {
                      const next = Number.parseFloat(draft.replace(/%$/, ""));
                      return Number.isFinite(next)
                        ? String(Math.round(Math.min(100, Math.max(0, next))))
                        : null;
                    }}
                    onCommit={(next) => {
                      const nextOpacity = Number(next);
                      if (onOpacityChange) onOpacityChange(nextOpacity);
                      emitColor(color, nextOpacity, "commit");
                    }}
                  />
                  <span className="-ml-1 tabular-nums text-muted-foreground !text-[11px]">
                    %
                  </span>
                </>
              ) : (
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-label={copy.trigger}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left focus-visible:outline-none"
                  >
                    <span
                      className="size-4 shrink-0 rounded-[3px] border border-border/60"
                      style={triggerSwatchStyle(value, color)}
                    />
                    <span className="min-w-0 flex-1 truncate tabular-nums !text-[11px]">
                      {triggerLabel(effectivePaintType, color)}
                    </span>
                    <span className="tabular-nums text-muted-foreground !text-[11px]">
                      {effectiveOpacity}%
                    </span>
                  </button>
                </PopoverTrigger>
              )}
            </div>
          </PopoverAnchor>
        )}

        {/* design popover: ~240px wide, uniform 12px padding, tight controls */}
        <PopoverContent
          side="left"
          align="start"
          sideOffset={8}
          className="z-[10000] w-[252px] p-0 shadow-xl"
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
          }}
          onFocusOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          tabIndex={-1}
        >
          <div className="rounded-md bg-popover text-popover-foreground">
            {view === "shader" && glslShaderContext ? (
              <GlslShaderPanel
                mode="fill"
                context={glslShaderContext}
                disabled={disabled}
                onBack={() => {
                  setView("picker");
                  if (effectivePaintType === "shader") setPaintType("solid");
                }}
              />
            ) : view === "shader" ? (
              <ShaderFillsPanel
                descriptor={shaderDescriptor ?? undefined}
                applyContext={shaderContext}
                disabled={disabled}
                onApply={previewShader}
                onCommit={commitShader}
                onBack={() => {
                  setView("picker");
                  if (effectivePaintType === "shader") {
                    if (!shaderDescriptor) setPaintType("solid");
                  }
                }}
              />
            ) : (
              <>
                {/* ── Paint-type icon row (design-editor, full-width tabs) ─── */}
                {/* Up to 11 types, split across two rows (first row capped at
                    6 columns). When `supportedPaintTypes` restricts the set
                    (e.g. solid-only for strokes), only the allowed tabs
                    render — never a tab that would silently discard its
                    write. Each icon is a clearly-hittable 36×32px target with
                    a distinct active accent so the selected mode is
                    immediately obvious. */}
                {visiblePaintTypes.length > 1 && (
                  <div className="border-b border-border/70 px-2 pt-2 pb-1.5">
                    {(() => {
                      const firstRowCount = Math.min(
                        6,
                        visiblePaintTypes.length,
                      );
                      const firstRow = visiblePaintTypes.slice(
                        0,
                        firstRowCount,
                      );
                      const secondRow = visiblePaintTypes.slice(firstRowCount);
                      const renderTab = ({
                        type,
                        label,
                        Icon,
                      }: (typeof visiblePaintTypes)[number]) => {
                        const isActive = effectivePaintType === type;
                        return (
                          <Tooltip key={type}>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                aria-label={label}
                                aria-pressed={isActive}
                                disabled={disabled}
                                onClick={() => setPaintType(type)}
                                className={cn(
                                  "flex h-8 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded transition-[color,background-color,transform] duration-150",
                                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                  "active:scale-95",
                                  isActive
                                    ? "bg-accent text-accent-foreground ring-1 ring-primary/60"
                                    : "text-muted-foreground hover:bg-[var(--design-editor-control-bg)] hover:text-foreground",
                                  disabled && "pointer-events-none opacity-40",
                                )}
                              >
                                <Icon className="size-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent
                              side="bottom"
                              className="z-[10010] text-[10px]"
                              onEscapeKeyDown={closeFromTooltipEscape}
                            >
                              {label}
                            </TooltipContent>
                          </Tooltip>
                        );
                      };
                      return (
                        <>
                          <div
                            className={cn(
                              "grid gap-1",
                              secondRow.length > 0 && "mb-1",
                            )}
                            style={{
                              gridTemplateColumns: `repeat(${firstRowCount}, minmax(0, 1fr))`,
                            }}
                          >
                            {firstRow.map(renderTab)}
                          </div>
                          {secondRow.length > 0 && (
                            <div
                              className="grid gap-1"
                              style={{
                                gridTemplateColumns: `repeat(${secondRow.length}, minmax(0, 1fr))`,
                              }}
                            >
                              {secondRow.map(renderTab)}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {/* Active-type label — shows which mode is selected */}
                    <p className="mt-1 text-center text-[10px] font-medium text-muted-foreground">
                      {PAINT_TYPES.find((p) => p.type === effectivePaintType)
                        ?.label ?? effectivePaintType}
                    </p>
                  </div>
                )}

                {/* ── Image fill controls ─────────────────────────────────── */}
                {effectivePaintType === "image" && (
                  <div>
                    <ImageFillControls
                      value={imageFill}
                      disabled={disabled}
                      onChange={emitImageFill}
                    />
                  </div>
                )}

                {/* ── Video fill: source field ────────────────────────────── */}
                {effectivePaintType === "video" && (
                  <div className="px-3 py-2">
                    <p className="mb-1.5 text-[10px] text-muted-foreground">
                      {
                        "Paste a video URL to use as the fill." /* i18n-ignore */
                      }
                    </p>
                    <Input
                      defaultValue=""
                      disabled={disabled}
                      placeholder={"Video URL (mp4, webm)" /* i18n-ignore */}
                      aria-label={"Video URL" /* i18n-ignore */}
                      spellCheck={false}
                      className="h-6 w-full rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] md:!text-[11px]"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          const url = e.currentTarget.value.trim();
                          if (url) {
                            emitPaintValue(
                              `url("${url}") center / cover no-repeat`,
                            );
                            notifyChangeComplete();
                          }
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const url = e.currentTarget.value.trim();
                        if (url) {
                          emitPaintValue(
                            `url("${url}") center / cover no-repeat`,
                          );
                          notifyChangeComplete();
                        }
                      }}
                    />
                  </div>
                )}

                {/* ── Gradient editor (linear / radial / angular / diamond) ── */}
                {activeGradient && (
                  <div>
                    <GradientEditor
                      value={activeGradient}
                      selectedStopId={effectiveSelectedStopId}
                      disabled={disabled}
                      onSelectStop={setSelectedStopId}
                      onChange={emitGradient}
                      onCommit={notifyChangeComplete}
                    />
                  </div>
                )}

                {/* ── 2D Saturation/Brightness field ──────────────────────── */}
                {/* Hidden for non-color fills (image/video/noise/pattern). */}
                {(effectivePaintType === "solid" ||
                  effectivePaintType === "none" ||
                  activeGradient) && (
                  <div className="border-t border-border/70">
                    <SaturationBrightnessField
                      hsv={fieldHsv}
                      label={copy.saturationBrightness}
                      disabled={disabled}
                      onChange={(nextHsv) => {
                        if (activeGradient) {
                          emitStopColor(
                            hsvToRgba({
                              ...nextHsv,
                              a: fieldColor.a,
                            }),
                          );
                        } else {
                          emitColorFromHsv(nextHsv);
                        }
                      }}
                      onCommit={notifyChangeComplete}
                    />
                  </div>
                )}

                {/* ── Eyedropper + Hue slider / Swatch + Alpha slider ─────── */}
                {/* Color sliders only apply to color-based fills. */}
                {(effectivePaintType === "solid" ||
                  effectivePaintType === "none" ||
                  activeGradient) && (
                  <div className="mt-2.5 px-3">
                    <div className="grid grid-cols-[1.5rem_1fr] items-center gap-x-2">
                      {/* Eyedropper centered across the two slider rows via row-span-2 */}
                      <div className="row-span-2 flex items-center justify-center">
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
                                "flex size-6 cursor-pointer items-center justify-center rounded-sm transition-colors",
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
                          <TooltipContent
                            className="z-[10010]"
                            onEscapeKeyDown={closeFromTooltipEscape}
                          >
                            {
                              hasEyeDropper
                                ? "Pick color" // i18n-ignore browser eyedropper label
                                : "Not supported in this browser" // i18n-ignore browser eyedropper disabled label
                            }
                          </TooltipContent>
                        </Tooltip>
                      </div>

                      {/* Hue track */}
                      <ColorTrack
                        label={copy.hue}
                        value={fieldHsv.h}
                        min={0}
                        max={360}
                        disabled={disabled}
                        backgroundImage="linear-gradient(90deg, #ff0000, #ffff00, #00ff00, #00ffff, #0000ff, #ff00ff, #ff0000)"
                        onChange={(next) => {
                          const h = next === 360 ? 0 : next;
                          lastHueRef.current = h;
                          if (activeGradient) {
                            emitStopColor(
                              hsvToRgba({
                                ...fieldHsv,
                                h,
                                a: fieldColor.a,
                              }),
                            );
                          } else {
                            emitColorFromHsv({ ...hsv, h });
                          }
                        }}
                        onCommit={notifyChangeComplete}
                      />

                      {/* Current-color swatch left of alpha (matches the design editor's layout) */}
                      <div className="flex items-center gap-2">
                        <span
                          className="size-[18px] shrink-0 rounded-[3px] border border-border/60"
                          style={swatchStyle(rgbaToCss(fieldColor))}
                        />
                        {/* Alpha track fills remaining width */}
                        <div className="flex-1">
                          <ColorTrack
                            label={copy.opacity}
                            value={
                              activeGradient
                                ? alphaToOpacity(fieldColor.a)
                                : effectiveOpacity
                            }
                            min={0}
                            max={100}
                            disabled={disabled}
                            backgroundImage={alphaTrackBackground(fieldColor)}
                            backgroundColor={CHECKER_B}
                            backgroundSize="100% 100%, 8px 8px"
                            backgroundPosition="0 0, 0 0"
                            onChange={(next) => {
                              if (activeGradient) {
                                emitStopColor({
                                  ...fieldColor,
                                  a: opacityToAlpha(next),
                                });
                              } else {
                                setOpacity(next);
                              }
                            }}
                            onCommit={notifyChangeComplete}
                            onCancel={
                              onChangeCancel
                                ? () =>
                                    onChangeCancel(lastEmittedValueRef.current)
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── Value row: [Hex ▾] [value input(s)] [opacity %] ─────── */}
                {(effectivePaintType === "solid" ||
                  effectivePaintType === "none" ||
                  activeGradient) && (
                  <div className="mt-2.5 px-3 pb-3">
                    <div className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-1">
                      {/* Model pill — bare text+chevron, no border or bg box (design-editor) */}
                      <ColorModelPill
                        value={mode}
                        disabled={disabled}
                        onChange={(v) => setMode(v as DesignColorMode)}
                      />

                      {/* Value field(s) — adapts to mode */}
                      {renderValueInputs()}

                      {/* Opacity % field */}
                      <div className="flex h-6 overflow-hidden rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)]">
                        <ScrubbyNumberInput
                          aria-label={copy.opacity}
                          value={
                            activeGradient
                              ? alphaToOpacity(fieldColor.a)
                              : effectiveOpacity
                          }
                          min={0}
                          max={100}
                          disabled={disabled}
                          onChange={(next) => {
                            if (activeGradient) {
                              emitStopColor({
                                ...fieldColor,
                                a: opacityToAlpha(next),
                              });
                            } else {
                              setOpacity(next);
                            }
                          }}
                          onCommit={notifyChangeComplete}
                          className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-1 !text-[11px] tabular-nums shadow-none focus-visible:ring-0"
                          compact
                        />
                        <span className="flex w-4 shrink-0 items-center justify-center border-l border-border/60 text-[10px] text-muted-foreground">
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {showBlendMode && onBlendModeChange && (
                  <div className="border-t border-border/70 px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 !text-[11px] text-muted-foreground">
                        {copy.blendMode}
                      </span>
                      <Select
                        value={blendModeValue}
                        disabled={disabled}
                        onValueChange={onBlendModeChange}
                      >
                        <SelectTrigger
                          aria-label={copy.blendMode}
                          className="h-6 min-w-0 flex-1 rounded-md border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-1.5 !text-[11px] shadow-none focus:ring-1 focus:ring-[var(--design-editor-accent-color)]"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BLEND_MODE_OPTIONS.map((option) => (
                            <SelectItem
                              key={option.value}
                              value={option.value}
                              className="!text-[11px]"
                            >
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* ── Document colors ──────────────────────────────────────── */}
                {/* Renders the palette of colors already used in the design.
                    When `documentColors` is provided, those swatches are shown;
                    otherwise falls back to the single current color so the
                    section is never empty. */}
                <div className="border-t border-border/70 px-3 py-2.5">
                  {/* Source label — matches the design editor layout */}
                  <div className="mb-2 flex h-6 w-full items-center justify-between px-0.5 !text-[11px] text-muted-foreground">
                    {"Document colors" /* i18n-ignore design picker source */}
                  </div>

                  {/* Swatch grid: document palette when available, else current color */}
                  <div className="grid grid-cols-8 gap-1">
                    {(shownDocumentColors && shownDocumentColors.length > 0
                      ? shownDocumentColors
                      : [rgbaToCss(color)]
                    ).map((docColor) => {
                      const currentHex = rgbaToHex(
                        parseCssColorExtended(docColor) ?? color,
                      );
                      const isActive =
                        rgbaToHex(color) === currentHex && !activeGradient;
                      return (
                        <Tooltip key={docColor}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={disabled}
                              aria-label={currentHex}
                              aria-pressed={isActive}
                              className={cn(
                                "size-5 rounded-sm border transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                isActive
                                  ? "border-primary ring-1 ring-primary"
                                  : "border-border/60",
                              )}
                              style={swatchStyle(docColor)}
                              onClick={() => {
                                const parsed =
                                  parseCssColorExtended(docColor) ?? color;
                                if (activeGradient) emitStopColor(parsed);
                                else emitColor(parsed);
                                notifyChangeComplete();
                              }}
                            />
                          </TooltipTrigger>
                          <TooltipContent
                            className="z-[10010]"
                            onEscapeKeyDown={closeFromTooltipEscape}
                          >
                            {currentHex}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                </div>
              </>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

const COLOR_MODES: Array<{ value: DesignColorMode; label: string }> = [
  { value: "hex", label: "Hex" }, // i18n-ignore color mode
  { value: "rgb", label: "RGB" }, // i18n-ignore color mode
  { value: "hsl", label: "HSL" }, // i18n-ignore color mode
  { value: "hsb", label: "HSB" }, // i18n-ignore color mode
];

function ColorModelPill({
  value,
  disabled,
  onChange,
}: {
  value: DesignColorMode;
  disabled: boolean;
  onChange: (mode: DesignColorMode) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const label =
    COLOR_MODES.find((m) => m.value === value)?.label ?? value.toUpperCase();

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
        className={cn(
          "flex h-6 w-[4.5rem] items-center gap-0.5 rounded px-1.5",
          "design-sidebar-section-title text-foreground",
          "bg-transparent border-0 shadow-none",
          "hover:bg-[var(--design-editor-control-bg)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          "transition-colors",
          disabled && "pointer-events-none opacity-50",
        )}
      >
        <span className="flex-1 text-left">{label}</span>
        <IconChevronDown className="size-3 shrink-0 text-muted-foreground" />
      </button>

      {menuOpen && (
        <div
          role="listbox"
          aria-label="Color model" // i18n-ignore aria label
          className={cn(
            "absolute left-0 top-full z-[10001] mt-0.5 min-w-[4.5rem]",
            "rounded-md border border-border bg-popover shadow-lg",
            "overflow-hidden py-0.5",
          )}
        >
          {COLOR_MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              role="option"
              aria-selected={m.value === value}
              onClick={() => {
                onChange(m.value);
                setMenuOpen(false);
              }}
              className={cn(
                "flex w-full items-center px-2 py-1 !text-[11px]",
                "hover:bg-accent hover:text-accent-foreground",
                "focus-visible:outline-none focus-visible:bg-accent",
                m.value === value
                  ? "font-semibold text-foreground"
                  : "font-normal text-foreground/80",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SaturationBrightnessField({
  hsv,
  label,
  disabled,
  onChange,
  onCommit,
}: {
  hsv: HsvaColor;
  label: string;
  disabled: boolean;
  onChange: (color: HsvaColor) => void;
  onCommit?: () => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<PointerGestureState>(POINTER_GESTURE_IDLE);
  const hueColor = rgbaToCss(hsvToRgba({ h: hsv.h, s: 100, v: 100, a: 1 }));

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = fieldRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nextSaturation = ((event.clientX - rect.left) / rect.width) * 100;
    const nextBrightness =
      100 - ((event.clientY - rect.top) / rect.height) * 100;
    onChange({
      ...hsv,
      s: clamp(nextSaturation, 0, 100),
      v: clamp(nextBrightness, 0, 100),
    });
  };

  const stepWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s + step, 0, 100) });
      onCommit?.();
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s - step, 0, 100) });
      onCommit?.();
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v + step, 0, 100) });
      onCommit?.();
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v - step, 0, 100) });
      onCommit?.();
    }
  };

  return (
    <div
      ref={fieldRef}
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.focus();
        draggingRef.current = startPointerGesture();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || disabled) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (ended.shouldCommit) onCommit?.();
      }}
      onPointerCancel={() => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (ended.shouldCommit) onCommit?.();
      }}
      onKeyDown={stepWithKeyboard}
      className={cn(
        "relative h-48 w-full touch-none cursor-crosshair overflow-hidden outline-none",
        "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{
        backgroundImage: `linear-gradient(to top, #000 0%, transparent 100%), linear-gradient(to right, #fff 0%, ${hueColor} 100%)`,
      }}
    >
      {/* Handle: size-4, white ring, consistent foreground shadow */}
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]"
        style={{
          left: `${hsv.s}%`,
          top: `${100 - hsv.v}%`,
        }}
      />
    </div>
  );
}

function ColorTrack({
  label,
  value,
  min,
  max,
  disabled,
  backgroundImage,
  backgroundColor,
  backgroundSize,
  backgroundPosition,
  onChange,
  onCommit,
  onCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  backgroundImage: string;
  backgroundColor?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  onChange: (value: number) => void;
  onCancel?: () => void;
  onCommit?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<PointerGestureState>(POINTER_GESTURE_IDLE);
  const gestureStartValueRef = useRef(value);
  const percent = ((value - min) / (max - min)) * 100;

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const next = min + ((event.clientX - rect.left) / rect.width) * (max - min);
    onChange(clamp(next, min, max));
  };

  const stepWithKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = event.shiftKey ? 10 : 1;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      onChange(clamp(value + step, min, max));
      onCommit?.();
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clamp(value - step, min, max));
      onCommit?.();
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
      onCommit?.();
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
      onCommit?.();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      draggingRef.current &&
      onCancel &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      !event.shiftKey &&
      event.key.toLowerCase() === "z"
    ) {
      event.preventDefault();
      event.stopPropagation();
      draggingRef.current = POINTER_GESTURE_IDLE;
      onChange(gestureStartValueRef.current);
      onCancel();
      return;
    }
    stepWithKeyboard(event);
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-disabled={disabled}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.focus();
        gestureStartValueRef.current = value;
        draggingRef.current = startPointerGesture();
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || disabled) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        if (ended.shouldCommit) onCommit?.();
      }}
      onPointerCancel={() => {
        const ended = endPointerGesture(draggingRef.current);
        draggingRef.current = ended.state;
        if (ended.shouldCommit) onCommit?.();
      }}
      className={cn(
        "relative h-3.5 touch-none cursor-pointer rounded-full border border-border/60 outline-none",
        "ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{
        backgroundImage,
        backgroundColor,
        backgroundSize,
        backgroundPosition,
      }}
    >
      {/* Thumb overhangs the track slightly, matching the design editor */}
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]"
        style={{ left: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  );
}

function ScrubbyNumberInput({
  "aria-label": ariaLabel,
  value,
  min,
  max,
  disabled,
  onChange,
  onCommit,
  className,
  compact = false,
}: {
  "aria-label": string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
  onCommit?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<string>(() => String(value));
  const draftRef = useRef(draft);
  const skipBlurRef = useRef(false);
  const scrubRef = useRef<ScrubGestureState>(SCRUB_GESTURE_IDLE);

  useEffect(() => {
    const nextDraft = String(value);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [value]);

  const commit = () => {
    const parsed = parseNumericDraft(draftRef.current);
    if (parsed === null) {
      const reverted = String(value);
      draftRef.current = reverted;
      setDraft(reverted);
      return;
    }
    onChange(clamp(parsed, min, max));
    onCommit?.();
  };

  return (
    <input
      type="number"
      aria-label={ariaLabel}
      value={draft}
      min={min}
      max={max}
      disabled={disabled}
      className={cn(
        "h-6 w-full touch-none rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-center !text-[11px] tabular-nums",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        compact && "border-0 shadow-none focus-visible:ring-0",
        className,
      )}
      onChange={(e) => {
        draftRef.current = e.target.value;
        setDraft(e.target.value);
      }}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          skipBlurRef.current = true;
          e.currentTarget.blur();
        }
        if (e.key === "Escape") {
          const reverted = String(value);
          draftRef.current = reverted;
          setDraft(reverted);
          skipBlurRef.current = true;
          e.currentTarget.blur();
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const parsed = Number(draftRef.current);
          const base = Number.isFinite(parsed) ? parsed : value;
          onChange(clamp(base + step, min, max));
          onCommit?.();
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const parsed = Number(draftRef.current);
          const base = Number.isFinite(parsed) ? parsed : value;
          onChange(clamp(base - step, min, max));
          onCommit?.();
        }
      }}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false;
          return;
        }
        commit();
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        scrubRef.current = startScrubGesture(e.clientX, value);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (disabled || !scrubRef.current.active) return;
        const deltaX = e.clientX - scrubRef.current.startX;
        if (!scrubRef.current.dragging) {
          if (Math.abs(deltaX) < SCRUB_DRAG_THRESHOLD_PX) return;
          scrubRef.current = { ...scrubRef.current, dragging: true };
          window.getSelection?.()?.removeAllRanges();
        }
        e.preventDefault();
        onChange(
          computeScrubbedValue(
            scrubRef.current.startValue,
            deltaX,
            min,
            max,
            e.shiftKey,
          ),
        );
      }}
      onPointerUp={(e) => {
        const wasDragging = scrubRef.current.dragging;
        scrubRef.current = SCRUB_GESTURE_IDLE;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (wasDragging) {
          onCommit?.();
          skipBlurRef.current = true;
          e.currentTarget.blur();
        }
      }}
      onPointerCancel={(e) => {
        const wasDragging = scrubRef.current.dragging;
        scrubRef.current = SCRUB_GESTURE_IDLE;
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (wasDragging) onCommit?.();
      }}
    />
  );
}

export type PointerGestureState = boolean;

export const POINTER_GESTURE_IDLE: PointerGestureState = false;

export function startPointerGesture(): PointerGestureState {
  return true;
}

export function endPointerGesture(state: PointerGestureState): {
  state: PointerGestureState;
  shouldCommit: boolean;
} {
  return { state: POINTER_GESTURE_IDLE, shouldCommit: state };
}

const SCRUB_DRAG_THRESHOLD_PX = 3;
const SCRUB_PIXELS_PER_STEP = 4;

export interface ScrubGestureState {
  active: boolean;
  dragging: boolean;
  startX: number;
  startValue: number;
}

export const SCRUB_GESTURE_IDLE: ScrubGestureState = {
  active: false,
  dragging: false,
  startX: 0,
  startValue: 0,
};

export function startScrubGesture(
  startX: number,
  startValue: number,
): ScrubGestureState {
  return { active: true, dragging: false, startX, startValue };
}

export function computeScrubbedValue(
  startValue: number,
  deltaX: number,
  min: number,
  max: number,
  shiftKey: boolean,
): number {
  const rate = shiftKey ? 10 : 1;
  const delta = Math.round(deltaX / SCRUB_PIXELS_PER_STEP) * rate;
  return clamp(startValue + delta, min, max);
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

function InlinePaintField({
  ariaLabel,
  value,
  disabled,
  className,
  parse,
  onCommit,
}: {
  ariaLabel: string;
  value: string;
  disabled: boolean;
  className?: string;
  parse: (draft: string) => string | null;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const focusedRef = useRef(false);
  const skipBlurCommitRef = useRef(false);
  useEffect(() => {
    if (!focusedRef.current) setDraft(value);
  }, [value]);
  const commit = () => {
    const next = parse(draft);
    if (next === null || next.toUpperCase() === value.toUpperCase()) {
      setDraft(value);
      return;
    }
    setDraft(next.toUpperCase());
    onCommit(next);
  };
  return (
    <input
      type="text"
      aria-label={ariaLabel}
      value={draft}
      disabled={disabled}
      spellCheck={false}
      autoComplete="off"
      className={cn(
        "h-full min-w-0 bg-transparent p-0 tabular-nums !text-[11px] outline-none",
        className,
      )}
      onFocus={(event) => {
        focusedRef.current = true;
        event.currentTarget.select();
      }}
      onChange={(event) => setDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
          skipBlurCommitRef.current = true;
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          setDraft(value);
          skipBlurCommitRef.current = true;
          event.currentTarget.blur();
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (skipBlurCommitRef.current) {
          skipBlurCommitRef.current = false;
          return;
        }
        commit();
      }}
    />
  );
}

function toCssColor(color: RgbaColor): string {
  return rgbaToCss(color);
}

function toDisplayHex(color: RgbaColor): string {
  return rgbaToHex(color).replace(/^#/, "").toUpperCase();
}

function triggerLabel(type: DesignPaintType, color: RgbaColor): string {
  if (type === "solid") return toDisplayHex(color);
  if (type === "none") return "None";
  if (type === "image") return "Image";
  if (type === "video") return "Video";
  if (type === "shader") return "Shader";
  if (type === "noise") return "Noise";
  if (type === "pattern") return "Pattern";
  return `${type[0].toUpperCase()}${type.slice(1)}`;
}

function triggerSwatchStyle(
  value: string,
  color: RgbaColor,
): {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
} {
  const lower = value.trim().toLowerCase();
  if (!lower || lower === "transparent") {
    return {
      backgroundImage: CHECKERBOARD_IMAGE,
      backgroundColor: CHECKER_B,
      backgroundSize: "8px 8px",
    };
  }
  if (lower.includes("gradient(") || lower.startsWith("url(")) {
    return swatchStyle(value);
  }
  return swatchStyle(rgbaToCss(color));
}

function looksLikeImageOrGradient(value: string): boolean {
  const lower = value.trim().toLowerCase();
  return lower.includes("gradient(") || lower.startsWith("url(");
}

function swatchStyle(value: string): {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
} {
  const parsed = parseCssColorExtended(value);
  if (parsed && parsed.a < 1) {
    return {
      backgroundImage: `linear-gradient(${rgbaToCss(parsed)}, ${rgbaToCss(parsed)}), ${CHECKERBOARD_IMAGE}`,
      backgroundColor: CHECKER_B,
      backgroundSize: "100% 100%, 8px 8px",
      backgroundPosition: "0 0, 0 0",
    };
  }
  if (parsed) return { backgroundColor: rgbaToCss(parsed) };
  if (value && looksLikeImageOrGradient(value)) {
    return { backgroundImage: value };
  }
  return {
    backgroundImage: CHECKERBOARD_IMAGE,
    backgroundColor: CHECKER_B,
    backgroundSize: "8px 8px",
  };
}

function alphaTrackBackground(color: RgbaColor): string {
  // guard:allow-raw-color — dynamic alpha gradient must use the selected RGB values.
  return `linear-gradient(90deg, rgba(${color.r}, ${color.g}, ${color.b}, 0), rgba(${color.r}, ${color.g}, ${color.b}, 1)), ${CHECKERBOARD_IMAGE}`;
}

export function rgbaToHsv(color: RgbaColor): HsvaColor {
  const r = clampFloat(color.r / 255, 0, 1);
  const g = clampFloat(color.g / 255, 0, 1);
  const b = clampFloat(color.b / 255, 0, 1);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  let h = 0;
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6;
    else if (max === g) h = (b - r) / delta + 2;
    else h = (r - g) / delta + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  return {
    h: Math.round(h),
    s: max === 0 ? 0 : Math.round((delta / max) * 100),
    v: Math.round(max * 100),
    a: color.a,
  };
}

export function hsvToRgba(color: HsvaColor): RgbaColor {
  const h = ((color.h % 360) + 360) % 360;
  const s = clampFloat(color.s, 0, 100) / 100;
  const v = clampFloat(color.v, 0, 100) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - chroma;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [chroma, x, 0];
  else if (h < 120) [r, g, b] = [x, chroma, 0];
  else if (h < 180) [r, g, b] = [0, chroma, x];
  else if (h < 240) [r, g, b] = [0, x, chroma];
  else if (h < 300) [r, g, b] = [x, 0, chroma];
  else [r, g, b] = [chroma, 0, x];

  return {
    r: clamp(Math.round((r + m) * 255), 0, 255),
    g: clamp(Math.round((g + m) * 255), 0, 255),
    b: clamp(Math.round((b + m) * 255), 0, 255),
    a: clampFloat(color.a, 0, 1),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clampFloat(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function hasHexAlpha(value: string): boolean {
  return /^#?(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(value.trim());
}

export function parseNumericDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function expandHexShorthand(value: string): string {
  const trimmed = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]$/i.test(trimmed)) return trimmed.repeat(6);
  if (/^[0-9a-f]{2}$/i.test(trimmed)) return trimmed.repeat(3);
  if (/^[0-9a-f]{3}$/i.test(trimmed)) {
    return Array.from(trimmed)
      .map((digit) => digit.repeat(2))
      .join("");
  }
  return trimmed;
}
