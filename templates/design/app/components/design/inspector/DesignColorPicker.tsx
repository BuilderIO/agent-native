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
import type { ShaderDescriptor } from "@shared/shader-presets";
import { IconChevronDown, IconColorPicker } from "@tabler/icons-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { Input } from "@/components/ui/input";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
import { ShaderFillsPanel, shaderDescriptorToCss } from "./ShaderFillsPanel";

// ─── Public types ──────────────────────────────────────────────────────────────

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

// These interfaces remain so EditPanel's prop types don't break, even though
// the popover no longer renders the fills/gradient-stops list.
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
  // Accepted but unused in the popover — list management lives in the sidebar.
  fillRows?: DesignFillRow[];
  selectedFillId?: string;
  onFillSelect?: (id: string) => void;
  onFillChange?: (id: string, patch: DesignFillRowPatch) => void;
  onAddFill?: () => void;
  onRemoveFill?: (id: string) => void;
  paintType?: DesignPaintType;
  onPaintTypeChange?: (type: DesignPaintType) => void;
  gradientType?: DesignGradientType;
  onGradientTypeChange?: (type: DesignGradientType) => void;
  // Accepted but unused in the popover — gradient stop handles belong on canvas.
  gradientStops?: DesignGradientStop[];
  selectedStopId?: string;
  onGradientStopSelect?: (id: string) => void;
  onGradientStopChange?: (id: string, patch: DesignGradientStopPatch) => void;
  onAddGradientStop?: () => void;
  onRemoveGradientStop?: (id: string) => void;
  /**
   * Colors already present in the document (e.g. unique hex values collected
   * from the current selection or page). Rendered as a swatch grid under the
   * "Document colors" heading — click any swatch to apply it. Deduplicated and
   * limited in the caller; the component renders whatever is passed.
   */
  documentColors?: string[];
  /**
   * Optional design context forwarded to the apply-shader action when a shader
   * fill is selected, so the agent can write real shader code for the target.
   */
  shaderContext?: {
    designId?: string;
    fileId?: string;
    nodeId?: string;
    selector?: string;
  };
  /** Notified when a shader fill is applied/tuned (descriptor + CSS fallback). */
  onShaderChange?: (descriptor: ShaderDescriptor, css: string) => void;
  labels?: Partial<DesignColorPickerLabels>;
  disabled?: boolean;
  className?: string;
}

// ─── Internal types ────────────────────────────────────────────────────────────

interface HsvaColor {
  h: number;
  s: number;
  v: number;
  a: number;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const FALLBACK_COLOR: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };

// ─── Extended CSS color parser ──────────────────────────────────────────────────
//
// `parseCssColor` from color-utils handles hex, comma-separated rgb/rgba, and
// hsl/hsla. Browsers increasingly emit modern CSS Level 4 formats from
// getComputedStyle: space-separated `rgb(R G B)`, `rgb(R G B / A)`, and
// opaque formats like `oklch(...)` or `color(display-p3 ...)`.
//
// This local wrapper extends the parser to cover those cases so that colors
// arriving from the canvas's computed-style bridge are always usable.

const MODERN_RGB_PATTERN =
  /^rgba?\(\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)(?:\s*\/\s*([0-9.]+%?))?\s*\)$/i;

/** Canvas element reused across calls for DOM-based color resolution. */
let _resolverCanvas: HTMLCanvasElement | null = null;
let _resolverCtx: CanvasRenderingContext2D | null = null;

/**
 * Parses a CSS color string into RgbaColor, extending the base parser with:
 *   - Modern space-separated `rgb(R G B)` / `rgb(R G B / A)` syntax
 *   - Opaque formats (oklch, color, etc.) resolved via a hidden canvas
 *
 * Falls back to null if the value is unparseable and the DOM is unavailable.
 */
function parseCssColorExtended(value: string): RgbaColor | null {
  // 1. Try the standard parser first (handles hex, comma rgb/rgba, hsl/hsla).
  const standard = parseCssColor(value);
  if (standard) return standard;

  const trimmed = value.trim();
  if (!trimmed || trimmed === "transparent" || trimmed === "none") return null;

  // 2. Modern space-separated rgb/rgba — CSS Level 4.
  const modernRgb = trimmed.match(MODERN_RGB_PATTERN);
  if (modernRgb) {
    const parseAlphaLocal = (v: string | undefined): number => {
      if (!v) return 1;
      if (v.endsWith("%"))
        return Math.max(0, Math.min(1, Number(v.slice(0, -1)) / 100));
      return Math.max(0, Math.min(1, Number(v)));
    };
    return {
      r: Math.round(Math.max(0, Math.min(255, Number(modernRgb[1])))),
      g: Math.round(Math.max(0, Math.min(255, Number(modernRgb[2])))),
      b: Math.round(Math.max(0, Math.min(255, Number(modernRgb[3])))),
      a: parseAlphaLocal(modernRgb[4]),
    };
  }

  // 3. DOM-based resolver for oklch, color(display-p3 ...), hsl (modern), etc.
  //    Uses a hidden 1×1 canvas to resolve any valid CSS color to rgb().
  if (typeof document === "undefined") return null;
  try {
    if (!_resolverCanvas) {
      _resolverCanvas = document.createElement("canvas");
      _resolverCanvas.width = 1;
      _resolverCanvas.height = 1;
    }
    if (!_resolverCtx) {
      _resolverCtx = _resolverCanvas.getContext("2d", {
        willReadFrequently: true,
      });
    }
    const ctx = _resolverCtx;
    if (!ctx) return null;
    // Detect invalid color values: save fillStyle before and after assignment.
    // If the browser rejects the value, fillStyle won't change.
    const prev = ctx.fillStyle;
    ctx.fillStyle = trimmed;
    const next = ctx.fillStyle; // browser normalises to rgb/hex on accept
    // If the value was rejected, fillStyle stays at the previous value.
    if (next === prev) return null;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return { r, g, b, a: a / 255 };
  } catch {
    return null;
  }
}

const DEFAULT_LABELS: DesignColorPickerLabels = {
  trigger: "Open color picker", // i18n-ignore fallback component label
  hex: "Hex", // i18n-ignore fallback component label
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

// checkerboard: explicit light/dark tiles for legibility.
const CHECKER_A = "#d4d4d4";
const CHECKER_B = "#a3a3a3";
const CHECKERBOARD_IMAGE = `linear-gradient(45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(-45deg, ${CHECKER_A} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${CHECKER_A} 75%), linear-gradient(-45deg, transparent 75%, ${CHECKER_A} 75%)`;

// ─── Paint-type icon SVGs (Tabler style, distinct per type) ────────────────────

function IconSolid({ className }: { className?: string }) {
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
      <rect
        x="4"
        y="4"
        width="16"
        height="16"
        rx="2"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}

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

function IconImageFill({ className }: { className?: string }) {
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
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="m3 16 5-5 4 4 3-3 6 6" />
      <circle cx="8.5" cy="8.5" r="1.5" />
    </svg>
  );
}

function IconVideoFill({ className }: { className?: string }) {
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
      {/* Frame border */}
      <rect x="3" y="5" width="18" height="14" rx="2" />
      {/* Play triangle — filled, no stroke for clarity at small size */}
      <polygon points="10,9 10,15 16,12" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconNoneFill({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="9" />
      <line x1="5.636" y1="5.636" x2="18.364" y2="18.364" />
    </svg>
  );
}

function IconShaderFill({ className }: { className?: string }) {
  // Droplet — the design editor uses a teardrop for shader/blur-type fills.
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
        <linearGradient id="shader-ico" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.9" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <path
        d="M12 3c3.5 4 6 7 6 10a6 6 0 0 1-12 0c0-3 2.5-6 6-10z"
        fill="url(#shader-ico)"
        stroke="currentColor"
        strokeOpacity="0.7"
      />
    </svg>
  );
}

function IconNoiseFill({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      className={className}
    >
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeOpacity="0.6"
      />
      {[
        [7, 7],
        [11, 6.5],
        [15, 8],
        [8, 10.5],
        [13, 11],
        [16.5, 11.5],
        [6.5, 13],
        [10, 14],
        [14, 13.5],
        [9, 16.5],
        [13, 16.5],
        [16, 15.5],
      ].map(([cx, cy], index) => (
        <circle key={index} cx={cx} cy={cy} r="0.9" />
      ))}
    </svg>
  );
}

function IconPatternFill({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="3.5" y="3.5" width="17" height="17" rx="2" strokeOpacity="0.6" />
      <path d="M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17" strokeOpacity="0.85" />
    </svg>
  );
}

// ─── Paint type definitions (only supported types rendered) ────────────────────

const PAINT_TYPES: Array<{
  type: DesignPaintType;
  label: string;
  Icon: (props: { className?: string }) => JSX.Element;
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

// Alias used internally before the exported constant is defined below.
// Both point at the same member set — keep reads using this name so the
// component body compiles even though the exported constant is declared
// at the bottom of the file (hoisting doesn't apply to const).
const GRADIENT_TYPES = new Set<DesignPaintType>([
  "linear",
  "radial",
  "angular",
  "diamond",
]);

// Static fallback fills for the "functional but minimal" paint types so the
// element fill always reflects the selected mode even without bespoke editors.
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

// ─── Main component ────────────────────────────────────────────────────────────

export function DesignColorPicker({
  value,
  onChange,
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
  fillRows: _fillRows,
  selectedFillId: _selectedFillId,
  onFillSelect: _onFillSelect,
  onFillChange: _onFillChange,
  onAddFill: _onAddFill,
  onRemoveFill: _onRemoveFill,
  paintType,
  onPaintTypeChange,
  gradientType,
  onGradientTypeChange,
  gradientStops: _gradientStops,
  selectedStopId: _selectedStopId,
  onGradientStopSelect: _onGradientStopSelect,
  onGradientStopChange: _onGradientStopChange,
  onAddGradientStop: _onAddGradientStop,
  onRemoveGradientStop: _onRemoveGradientStop,
  documentColors,
  shaderContext,
  onShaderChange,
  labels,
  disabled = false,
  className,
}: DesignColorPickerProps) {
  const copy = { ...DEFAULT_LABELS, ...labels };
  const color = parseCssColorExtended(value) ?? FALLBACK_COLOR;
  const hsv = rgbaToHsv(color);
  const hsl = rgbaToHsl(color);
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
  const [open, setOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const skipNextHexBlurCommitRef = useRef(false);
  // Preserve the last non-zero hue so dragging through an achromatic point
  // (s=0 or v=0) doesn't snap hue to 0° when the user drags back to a
  // saturated region. Matches Figma's hue-preservation behavior.
  const lastHueRef = useRef<number>(0);

  // Whole-popover view: the standard picker, or the shader fills panel.
  const [view, setView] = useState<"picker" | "shader">("picker");

  // Self-managed paint-type fallback for when EditPanel doesn't drive it.
  const [localPaintType, setLocalPaintType] = useState<DesignPaintType | null>(
    null,
  );

  // Locally-managed gradient/image/shader state, seeded from the current value
  // so the editors round-trip when EditPanel passes the CSS back through value.
  const [localGradient, setLocalGradient] = useState<GradientValue | null>(
    null,
  );
  const [selectedStopId, setSelectedStopId] = useState<string>("");
  const [imageFill, setImageFill] = useState<ImageFillValue>(
    () => parsedImageFill ?? { url: "", fit: "fill" },
  );
  const [shaderDescriptor, setShaderDescriptor] =
    useState<ShaderDescriptor | null>(null);

  // The user's explicit paint-type click (localPaintType) wins over the
  // EditPanel-driven `paintType` prop so selecting a gradient/image/shader
  // engages its editor even when EditPanel doesn't complete the structural
  // fill switch. localPaintType is reset below when the prop changes (i.e. a
  // different element/fill is selected) so the picker still follows selection.
  const effectivePaintType: DesignPaintType =
    localPaintType ?? paintType ?? inferPaintType(value, effectiveOpacity);

  // Resolve the active gradient: prefer EditPanel-driven props; otherwise parse
  // the live CSS value, falling back to local edit state.
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
    [color.r, color.g, color.b, color.a, effectivePaintType],
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
  }, [color.r, color.g, color.b]);

  // The local override (the user's explicit paint-type click) persists for the
  // life of the open popover so EditPanel bouncing `paintType` back to solid
  // can't wipe a just-selected gradient/image/shader. A new element selection
  // remounts this popover content, which resets the local state naturally.

  // Keep image-fill state synced when the incoming value is an image fill.
  useEffect(() => {
    if (!parsedImageFill) return;
    setImageFill((current) =>
      current.url === parsedImageFill.url && current.fit === parsedImageFill.fit
        ? current
        : parsedImageFill,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedImageFill?.url, parsedImageFill?.fit]);

  // Ensure a selected stop id exists whenever a gradient is active.
  useEffect(() => {
    if (!activeGradient) return;
    const ids = activeGradient.stops.map((s) => s.id);
    if (!ids.includes(selectedStopId)) {
      setSelectedStopId(activeGradient.stops[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeGradient?.stops.map((s) => s.id).join(",")]);

  // ── Emit helpers ────────────────────────────────────────────────────────────

  const emitColor = (nextColor: RgbaColor, nextOpacity = effectiveOpacity) => {
    onChange(rgbaToCss(withColorOpacity(nextColor, nextOpacity)));
  };

  const emitPaintValue = (nextValue: string) => {
    if (onPaintValueChange) onPaintValueChange(nextValue);
    else onChange(nextValue);
  };

  const emitColorFromHsv = (nextHsv: HsvaColor) => {
    emitColor(hsvToRgba({ ...nextHsv, a: opacityToAlpha(effectiveOpacity) }));
  };

  const emitColorFromHsl = (nextHsl: HslaColor) => {
    emitColor(hslToRgba({ ...nextHsl, a: opacityToAlpha(effectiveOpacity) }));
  };

  const commitHex = () => {
    const currentDraft = hexDraftRef.current;
    const parsed = parseCssColor(`#${currentDraft.replace(/^#/, "")}`);
    if (!parsed) {
      const reverted = toDisplayHex(activeGradient ? fieldColor : color);
      hexDraftRef.current = reverted;
      setHexDraft(reverted);
      return;
    }
    if (activeGradient) {
      const hexIncludesAlpha = hasHexAlpha(currentDraft);
      emitStopColor(hexIncludesAlpha ? parsed : { ...parsed, a: fieldColor.a });
      return;
    }
    const hexIncludesAlpha = hasHexAlpha(currentDraft);
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

  // ── Gradient editing ─────────────────────────────────────────────────────────

  const emitGradient = (next: GradientValue) => {
    setLocalGradient(next);
    if (onGradientTypeChange && next.kind !== gradientType) {
      onGradientTypeChange(next.kind as DesignGradientType);
    }
    emitPaintValue(gradientToCss(next));
  };

  const selectedStop =
    activeGradient?.stops.find((s) => s.id === selectedStopId) ??
    activeGradient?.stops[0];

  // The 2D field edits the selected gradient stop's color when in gradient mode.
  const fieldColor: RgbaColor = activeGradient
    ? (parseCssColorExtended(selectedStop?.color ?? "#000000") ??
      FALLBACK_COLOR)
    : color;
  const rawFieldHsv = rgbaToHsv(fieldColor);
  // Preserve the last non-zero hue so dragging through gray doesn't lose it.
  if (rawFieldHsv.s > 0 && rawFieldHsv.v > 0) {
    lastHueRef.current = rawFieldHsv.h;
  }
  const fieldHsv: HsvaColor =
    rawFieldHsv.s === 0
      ? { ...rawFieldHsv, h: lastHueRef.current }
      : rawFieldHsv;
  const fieldHsl = rgbaToHsl(fieldColor);

  // In gradient mode, mirror the selected stop's color into the hex draft.
  const selectedStopColor = selectedStop?.color;
  useEffect(() => {
    if (!activeGradient || !selectedStopColor) return;
    const parsed = parseCssColorExtended(selectedStopColor);
    if (parsed) setHexDraft(toDisplayHex(parsed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStopColor, selectedStopId]);

  const emitStopColor = (nextColor: RgbaColor) => {
    if (!activeGradient || !selectedStop) return;
    emitGradient({
      ...activeGradient,
      stops: activeGradient.stops.map((stop) =>
        stop.id === selectedStop.id
          ? { ...stop, color: rgbaToCss(nextColor) }
          : stop,
      ),
    });
  };

  // Value-row emit helpers: route to the selected stop in gradient mode,
  // else to the solid color (preserving the existing solid behavior).
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

  // ── Image editing ─────────────────────────────────────────────────────────────

  const emitImageFill = (next: ImageFillValue) => {
    setImageFill(next);
    if (onImageFillChange) {
      onImageFillChange(next);
      return;
    }
    emitPaintValue(imageFillToCss(next));
  };

  // ── Shader editing ──────────────────────────────────────────────────────────────

  const emitShader = (descriptor: ShaderDescriptor, css: string) => {
    setShaderDescriptor(descriptor);
    onShaderChange?.(descriptor, css);
    emitPaintValue(css);
  };

  // ── Paint-type switching (does real work for every type) ──────────────────────

  const setPaintType = (nextType: DesignPaintType) => {
    if (disabled) return;

    // Shader opens the dedicated shader fills panel.
    if (nextType === "shader") {
      setLocalPaintType("shader");
      setView("shader");
      return;
    }

    // Defer structural fill changes to EditPanel when it manages layered fills.
    if (onPaintTypeChange) {
      setLocalPaintType(nextType);
      onPaintTypeChange(nextType);
      return;
    }

    setLocalPaintType(nextType);

    if (nextType === "none") {
      onChange("transparent");
      return;
    }
    if (nextType === "solid") {
      emitColor(color, effectiveOpacity > 0 ? effectiveOpacity : 100);
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
      return;
    }
    if (nextType === "video") {
      // No standalone CSS for video; mark the fill type and keep a checker fill
      // until a source is wired. The agent can replace it with a <video> layer.
      emitPaintValue("transparent");
      return;
    }
    if (nextType === "noise") {
      emitPaintValue(NOISE_FALLBACK_CSS);
      return;
    }
    if (nextType === "pattern") {
      emitPaintValue(PATTERN_FALLBACK_CSS);
      return;
    }
  };

  const pickScreenColor = async () => {
    const EyeDropperCtor = (
      window as unknown as {
        EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
      }
    ).EyeDropper;
    if (!EyeDropperCtor || disabled) return;
    setPicking(true);
    try {
      const result = await new EyeDropperCtor().open();
      if (result.sRGBHex) {
        if (activeGradient) {
          // In gradient mode, route to the selected stop (preserving its alpha)
          // like every other color edit — don't replace the whole gradient with
          // a solid hex.
          const parsed = parseCssColor(result.sRGBHex);
          if (parsed) emitStopColor({ ...parsed, a: fieldColor.a });
        } else {
          onChange(result.sRGBHex);
        }
      }
    } catch {
      // Browser cancels are expected; keep the current color.
    } finally {
      setPicking(false);
    }
  };

  const hasEyeDropper = typeof window !== "undefined" && "EyeDropper" in window;

  // ── Value row inputs by mode ─────────────────────────────────────────────────

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
              const reverted = toDisplayHex(color);
              hexDraftRef.current = reverted;
              setHexDraft(reverted);
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
          />
          <ScrubbyNumberInput
            aria-label={copy.saturation}
            value={fieldHsl.s}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(s) => emitFieldHsl({ ...fieldHsl, s })}
          />
          <ScrubbyNumberInput
            aria-label={copy.lightness}
            value={fieldHsl.l}
            min={0}
            max={100}
            disabled={disabled}
            onChange={(l) => emitFieldHsl({ ...fieldHsl, l })}
          />
        </div>
      );
    }
    // hsb
    return (
      <div className="flex gap-1">
        <ScrubbyNumberInput
          aria-label={copy.hue}
          value={fieldHsv.h}
          min={0}
          max={360}
          disabled={disabled}
          onChange={(h) => emitFieldHsv({ ...fieldHsv, h })}
        />
        <ScrubbyNumberInput
          aria-label={copy.saturation}
          value={fieldHsv.s}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(s) => emitFieldHsv({ ...fieldHsv, s })}
        />
        <ScrubbyNumberInput
          aria-label={copy.brightness}
          value={fieldHsv.v}
          min={0}
          max={100}
          disabled={disabled}
          onChange={(v) => emitFieldHsv({ ...fieldHsv, v })}
        />
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* Trigger: compact swatch + hex + opacity% — matches the design editor's fill row */}
          <button
            type="button"
            disabled={disabled}
            aria-label={copy.trigger}
            className={cn(
              "flex h-6 w-full items-center gap-1.5 rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] px-2 !text-[11px] shadow-none",
              "hover:bg-[var(--design-editor-panel-raised-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
              disabled && "pointer-events-none opacity-50",
            )}
          >
            {/* Flat swatch chip — no shadow-inner (the design editor uses a flat chip) */}
            <span
              className="size-4 shrink-0 rounded-[3px] border border-border/60"
              style={triggerSwatchStyle(value, color)}
            />
            <span className="min-w-0 flex-1 truncate text-left tabular-nums uppercase !text-[11px]">
              {triggerLabel(effectivePaintType, color)}
            </span>
            <span className="tabular-nums text-muted-foreground !text-[11px]">
              {effectiveOpacity}%
            </span>
          </button>
        </PopoverTrigger>

        {/* design popover: ~240px wide, uniform 12px padding, tight controls */}
        <PopoverContent
          side="left"
          align="start"
          sideOffset={8}
          className="z-[10000] w-[252px] p-0 shadow-xl"
          // Keep the picker open when the style change triggered by a paint-type
          // switch causes the canvas to re-project the element. Without this,
          // Radix treats the resulting focus shift as an "interact outside" event
          // and closes the popover before the type switch is visible.
          onInteractOutside={(e) => {
            // Allow closing only for genuine pointer clicks on the canvas area
            // (the user clicked somewhere else). Programmatic focus changes from
            // the canvas bridge (element re-projection) should not close the picker.
            if (e.type === "focusoutside") e.preventDefault();
          }}
        >
          <div className="rounded-md bg-popover text-popover-foreground">
            {view === "shader" ? (
              <ShaderFillsPanel
                descriptor={shaderDescriptor ?? undefined}
                applyContext={shaderContext}
                disabled={disabled}
                onApply={emitShader}
                onBack={() => {
                  setView("picker");
                  if (effectivePaintType === "shader") {
                    // No shader chosen — revert to a solid so the row isn't dead.
                    if (!shaderDescriptor) setPaintType("solid");
                  }
                }}
              />
            ) : (
              <>
                {/* ── Paint-type icon row (design-editor, full-width tabs) ─── */}
                {/* 11 types → two rows: first 6, then 5. Each icon is a
                    clearly-hittable 36×32px target with a distinct active
                    accent so the selected mode is immediately obvious. */}
                <div className="border-b border-border/70 px-2 pt-2 pb-1.5">
                  {/* Row 1: Solid · Linear · Radial · Angular · Diamond · Image */}
                  <div className="mb-1 grid grid-cols-6 gap-1">
                    {PAINT_TYPES.slice(0, 6).map(({ type, label, Icon }) => {
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
                                "flex h-8 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded transition-colors",
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
                          <TooltipContent side="bottom" className="text-[10px]">
                            {label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                  {/* Row 2: Video · Shader · Noise · Pattern · None */}
                  <div className="grid grid-cols-5 gap-1">
                    {PAINT_TYPES.slice(6).map(({ type, label, Icon }) => {
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
                                "flex h-8 w-full cursor-pointer flex-col items-center justify-center gap-0.5 rounded transition-colors",
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
                          <TooltipContent side="bottom" className="text-[10px]">
                            {label}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })}
                  </div>
                  {/* Active-type label — shows which mode is selected */}
                  <p className="mt-1 text-center text-[10px] font-medium text-muted-foreground">
                    {PAINT_TYPES.find((p) => p.type === effectivePaintType)
                      ?.label ?? effectivePaintType}
                  </p>
                </div>

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
                          if (url)
                            emitPaintValue(
                              `url("${url}") center / cover no-repeat`,
                            );
                          e.currentTarget.blur();
                        }
                      }}
                      onBlur={(e) => {
                        const url = e.currentTarget.value.trim();
                        if (url)
                          emitPaintValue(
                            `url("${url}") center / cover no-repeat`,
                          );
                      }}
                    />
                  </div>
                )}

                {/* ── Gradient editor (linear / radial / angular / diamond) ── */}
                {activeGradient && (
                  <div>
                    <GradientEditor
                      value={activeGradient}
                      selectedStopId={selectedStopId}
                      disabled={disabled}
                      onSelectStop={setSelectedStopId}
                      onChange={emitGradient}
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
                          <TooltipContent>
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
                            backgroundSize="8px 8px, 8px 8px, 8px 8px, 8px 8px, 100% 100%"
                            backgroundPosition="0 0, 0 4px, 4px -4px, -4px 0, 0 0"
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
                    {(documentColors && documentColors.length > 0
                      ? documentColors
                      : [rgbaToCss(color)]
                    ).map((docColor) => {
                      const currentHex = rgbaToHex(
                        parseCssColor(docColor) ?? color,
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
                                const parsed = parseCssColor(docColor) ?? color;
                                if (activeGradient) emitStopColor(parsed);
                                else emitColor(parsed);
                              }}
                            />
                          </TooltipTrigger>
                          <TooltipContent>{currentHex}</TooltipContent>
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

// ─── Sub-components ────────────────────────────────────────────────────────────

const COLOR_MODES: Array<{ value: DesignColorMode; label: string }> = [
  { value: "hex", label: "Hex" }, // i18n-ignore color mode
  { value: "rgb", label: "RGB" }, // i18n-ignore color mode
  { value: "hsl", label: "HSL" }, // i18n-ignore color mode
  { value: "hsb", label: "HSB" }, // i18n-ignore color mode
];

/**
 * design-editor bare color-model selector: text + small chevron, no border/bg box.
 * Hover reveals a subtle bg tint; active mode is font-semibold.
 * Renders its own lightweight dropdown (no Radix Select overhead).
 */
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

  // Close on outside click.
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
          "!text-[11px] font-semibold text-foreground",
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
}: {
  hsv: HsvaColor;
  label: string;
  disabled: boolean;
  onChange: (color: HsvaColor) => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
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
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      onChange({ ...hsv, s: clamp(hsv.s - step, 0, 100) });
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v + step, 0, 100) });
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onChange({ ...hsv, v: clamp(hsv.v - step, 0, 100) });
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
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || disabled) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      onKeyDown={stepWithKeyboard}
      className={cn(
        "relative h-48 w-full cursor-crosshair overflow-hidden outline-none",
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
  backgroundSize,
  backgroundPosition,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  backgroundImage: string;
  backgroundSize?: string;
  backgroundPosition?: string;
  onChange: (value: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
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
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      onChange(clamp(value - step, min, max));
    }
    if (event.key === "Home") {
      event.preventDefault();
      onChange(min);
    }
    if (event.key === "End") {
      event.preventDefault();
      onChange(max);
    }
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
      onKeyDown={stepWithKeyboard}
      onPointerDown={(event) => {
        if (disabled) return;
        draggingRef.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        updateFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current || disabled) return;
        updateFromPointer(event);
      }}
      onPointerUp={(event) => {
        draggingRef.current = false;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      }}
      onPointerCancel={() => {
        draggingRef.current = false;
      }}
      className={cn(
        "relative h-3.5 cursor-pointer rounded-full border border-border/60 outline-none",
        "ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
        "active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-60",
      )}
      style={{ backgroundImage, backgroundSize, backgroundPosition }}
    >
      {/* Thumb overhangs the track slightly, matching the design editor */}
      <span
        className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_hsl(var(--foreground)/0.6)]"
        style={{ left: `${clamp(percent, 0, 100)}%` }}
      />
    </div>
  );
}

/**
 * A number input with select-on-focus and Esc-to-revert.
 * The `compact` prop removes inner padding for use inside bordered wrappers.
 */
function ScrubbyNumberInput({
  "aria-label": ariaLabel,
  value,
  min,
  max,
  disabled,
  onChange,
  className,
  compact = false,
}: {
  "aria-label": string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
  className?: string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState<string>(() => String(value));
  const draftRef = useRef(draft);
  const skipBlurRef = useRef(false);

  useEffect(() => {
    const nextDraft = String(value);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [value]);

  const commit = () => {
    const parsed = Number(draftRef.current);
    if (!Number.isFinite(parsed)) {
      const reverted = String(value);
      draftRef.current = reverted;
      setDraft(reverted);
      return;
    }
    onChange(clamp(parsed, min, max));
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
        "h-6 w-full rounded-md border border-[var(--design-editor-control-border)] bg-[var(--design-editor-control-bg)] text-center !text-[11px] tabular-nums",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const parsed = Number(draftRef.current);
          const base = Number.isFinite(parsed) ? parsed : value;
          onChange(clamp(base - step, min, max));
        }
      }}
      onBlur={() => {
        if (skipBlurRef.current) {
          skipBlurRef.current = false;
          return;
        }
        commit();
      }}
    />
  );
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

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
      // Diamond fills serialize as a radial gradient (either "closest-corner"
      // from EditPanel or "ellipse closest-side" from GradientEditor). Recognize
      // both so a diamond doesn't silently become a plain radial on reselect.
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
  const parsed = parseCssColor(value);
  if (opacity <= 0 || parsed?.a === 0 || value.trim() === "transparent") {
    return "none";
  }
  return "solid";
}

/** The set of paint types that render a gradient editor. */
export const GRADIENT_PAINT_TYPES: ReadonlySet<DesignPaintType> = new Set([
  "linear",
  "radial",
  "angular",
  "diamond",
]);

/**
 * Pure helper: resolves the effective paint type and which editor panel should
 * be visible given the three-level precedence:
 *
 *   localPaintType (user's explicit click this session)
 *   ?? paintType prop (EditPanel-driven structural type)
 *   ?? inferred from the CSS value string
 *
 * The shader panel is a view-level switch (not just a paint-type), so
 * `showShaderPanel` is derived directly from the effective type.
 *
 * @param paintType       The `paintType` prop from the parent (or undefined).
 * @param localPaintType  The user's explicit in-session selection (or null).
 * @param value           The current CSS fill value string.
 * @param opacity         The current opacity (0–100).
 */
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

function toCssColor(color: RgbaColor): string {
  return rgbaToCss(color);
}

/** Show hex without the leading # for the display field (matches the design editor). */
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
  return `${type[0].toUpperCase()}${type.slice(1)} gradient`;
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
      backgroundSize: "8px 8px",
    };
  }
  if (lower.includes("gradient(") || lower.startsWith("url(")) {
    return swatchStyle(value);
  }
  return swatchStyle(rgbaToCss(color));
}

function swatchStyle(value: string): {
  backgroundColor?: string;
  backgroundImage?: string;
  backgroundSize?: string;
  backgroundPosition?: string;
} {
  const parsed = parseCssColor(value);
  if (parsed && parsed.a < 1) {
    return {
      backgroundImage: `${CHECKERBOARD_IMAGE}, linear-gradient(${rgbaToCss(parsed)}, ${rgbaToCss(parsed)})`,
      backgroundSize: "8px 8px, 8px 8px, 8px 8px, 8px 8px, 100% 100%",
      backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0, 0 0",
    };
  }
  if (parsed) return { backgroundColor: rgbaToCss(parsed) };
  return { backgroundImage: value || "none" };
}

function alphaTrackBackground(color: RgbaColor): string {
  return `${CHECKERBOARD_IMAGE}, linear-gradient(90deg, rgba(${color.r}, ${color.g}, ${color.b}, 0), rgba(${color.r}, ${color.g}, ${color.b}, 1))`;
}

function rgbaToHsv(color: RgbaColor): HsvaColor {
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

function hsvToRgba(color: HsvaColor): RgbaColor {
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

function hasHexAlpha(value: string): boolean {
  return /^#?(?:[0-9a-f]{4}|[0-9a-f]{8})$/i.test(value.trim());
}
