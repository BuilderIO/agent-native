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
  /**
   * Optional gesture-lifecycle signal, complementary to `onChange`. The SV
   * field, hue slider, and alpha slider call `onChange` on every pointermove
   * tick for live preview (cheap/throttleable), but only call
   * `onChangeComplete` once per gesture — on pointerup/drag-end — with the
   * final color. Discrete, already-final commits (hex entry, RGB/HSL/HSB
   * field commits, keyboard nudges, document-color swatch clicks, paint-type
   * switches) also fire it once, immediately. Omit this prop to keep the
   * existing every-tick `onChange`-only behavior.
   */
  onChangeComplete?: (value: string) => void;
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
   * Restricts which paint-type tabs are rendered (Solid, Linear, Radial, …).
   * Omit to show every type (default, backward compatible). Callers that
   * can't structurally support layered/gradient/image paints for the
   * property they're editing (e.g. a CSS `border`/`outline` stroke, which
   * has no clean gradient/image equivalent) should pass a restricted list
   * — e.g. `["solid"]` — so the tab is never shown rather than shown and
   * then silently discarded on write.
   */
  supportedPaintTypes?: DesignPaintType[];
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
  /**
   * Context for the code-backed GLSL shader picker. When provided, the
   * Shader paint type opens the GlslShaderPanel (Created by you / Create
   * new (AI) / Presets), which persists real GLSL fragment source into the
   * screen HTML per shared/shader-fills.ts. When absent, the legacy
   * ShaderFillsPanel (CSS-approximation presets) renders instead.
   */
  glslShaderContext?: GlslShaderPanelContext;
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

// `parseCssColorExtended` (from color-utils) extends `parseCssColor` with
// modern CSS Level 4 syntax (space-separated rgb, `oklch(...)`,
// `color(display-p3 ...)`) so that colors arriving from the canvas's
// computed-style bridge are always usable.

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

// ─── Eyedropper (browser EyeDropper API) ────────────────────────────────────
//
// Extracted from the picker's own "pick from screen" button so DesignEditor
// can bind Figma's "I" shortcut to the same flow without duplicating the
// EyeDropper wiring. Pure/standalone: no dependency on component state, so it
// can be called from anywhere a `document`/`window` is available.

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

/** True when the browser exposes the experimental EyeDropper API. */
export function hasEyeDropperSupport(): boolean {
  return typeof window !== "undefined" && "EyeDropper" in window;
}

/**
 * Opens the browser's native eyedropper and resolves with the picked color as
 * a `#rrggbb` hex string, or `null` if the API is unsupported or the user
 * cancels the pick (e.g. by pressing Escape). Never rejects — callers don't
 * need a try/catch to handle the "user cancelled" case.
 */
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

// ─── Main component ────────────────────────────────────────────────────────────

export function DesignColorPicker({
  value,
  onChange,
  onChangeComplete,
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
  // Note: fillRows/selectedFillId/onFillSelect/onFillChange/onAddFill/
  // onRemoveFill and gradientStops/selectedStopId/onGradientStopSelect/
  // onGradientStopChange/onAddGradientStop/onRemoveGradientStop are
  // deliberately NOT destructured here — see the "These interfaces remain…"
  // comment on DesignColorPickerProps above. The popover doesn't render a
  // fills/gradient-stops list (fill-properties.tsx in edit-panel owns that
  // UI directly), so binding them to local variables here was dead code.
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
  // Snapshot of value/opacity/paintType captured the instant the popover
  // opens, so Escape can cancel the whole editing session — matching Figma:
  // dragging hue/sat/alpha/gradient stops live-previews the color, but
  // Escaping out reverts everything back to how it was before the popover
  // opened, not just whatever field happens to be focused. Re-snapshotted
  // only on the open transition (see the effect below), never while already
  // open, so it doesn't chase the user's own edits.
  const openSnapshotRef = useRef({
    value,
    opacity: effectiveOpacity,
    paintType,
  });
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

  // Tabs actually rendered — restricted to `supportedPaintTypes` when the
  // caller passes it (e.g. strokes only support "solid": there's no clean
  // CSS border/outline equivalent for gradients or images). Undefined means
  // "no restriction", preserving today's full-tab behavior everywhere else.
  const visiblePaintTypes = supportedPaintTypes
    ? PAINT_TYPES.filter((entry) => supportedPaintTypes.includes(entry.type))
    : PAINT_TYPES;
  const isPaintTypeSupported = (type: DesignPaintType) =>
    !supportedPaintTypes || supportedPaintTypes.includes(type);

  // The user's explicit paint-type click (localPaintType) wins over the
  // EditPanel-driven `paintType` prop so selecting a gradient/image/shader
  // engages its editor even when EditPanel doesn't complete the structural
  // fill switch. localPaintType is reset below when the prop changes (i.e. a
  // different element/fill is selected) so the picker still follows selection.
  // Defense in depth: if a stale `localPaintType`/prop-driven `paintType` (or
  // `inferPaintType`'s guess) ever resolves outside `supportedPaintTypes` —
  // there is no tab to click since it's filtered out of `visiblePaintTypes`
  // above — fall back to "solid" instead of rendering an editor for a type
  // the caller declared unsupported.
  const rawEffectivePaintType: DesignPaintType =
    localPaintType ?? paintType ?? inferPaintType(value, effectiveOpacity);
  const effectivePaintType: DesignPaintType = isPaintTypeSupported(
    rawEffectivePaintType,
  )
    ? rawEffectivePaintType
    : "solid";

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

  useEffect(() => {
    if (open) {
      openSnapshotRef.current = { value, opacity: effectiveOpacity, paintType };
    }
    // Deliberately only depends on `open`: this must capture the value as of
    // the open transition, not re-run on every edit made while already open
    // (that would defeat the point of an Escape-to-cancel snapshot).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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

  // Tracks the last CSS value handed to onChange/onPaintValueChange, so a
  // gesture-end (pointerup on the SV field / hue / alpha tracks) can re-emit
  // that exact value once via onChangeComplete without recomputing it from
  // pointer coordinates after the drag has already ended.
  const lastEmittedValueRef = useRef(value);

  const notifyChangeComplete = () => {
    onChangeComplete?.(lastEmittedValueRef.current);
  };

  const emitColor = (nextColor: RgbaColor, nextOpacity = effectiveOpacity) => {
    const next = rgbaToCss(withColorOpacity(nextColor, nextOpacity));
    lastEmittedValueRef.current = next;
    onChange(next);
  };

  const emitPaintValue = (nextValue: string) => {
    lastEmittedValueRef.current = nextValue;
    if (onPaintValueChange) onPaintValueChange(nextValue);
    else onChange(nextValue);
  };

  const emitColorFromHsv = (nextHsv: HsvaColor) => {
    emitColor(hsvToRgba({ ...nextHsv, a: opacityToAlpha(effectiveOpacity) }));
  };

  const emitColorFromHsl = (nextHsl: HslaColor) => {
    emitColor(hslToRgba({ ...nextHsl, a: opacityToAlpha(effectiveOpacity) }));
  };

  // Shared by the invalid-commit path below and the Escape handler in the hex
  // input: reverts the draft to the currently active color (the selected
  // gradient stop while editing a gradient, otherwise the solid color).
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
      emitStopColor(hexIncludesAlpha ? parsed : { ...parsed, a: fieldColor.a });
      notifyChangeComplete();
      return;
    }
    const hexIncludesAlpha = hasHexAlpha(currentDraft);
    const nextOpacity = hexIncludesAlpha
      ? alphaToOpacity(parsed.a)
      : effectiveOpacity;
    if (hexIncludesAlpha && onOpacityChange) onOpacityChange(nextOpacity);
    emitColor(parsed, nextOpacity);
    notifyChangeComplete();
  };

  const setOpacity = (nextOpacity: number) => {
    // Track the resulting CSS value even when the opacity itself is reported
    // through the separate onOpacityChange prop, so a subsequent
    // notifyChangeComplete() call still reports the current color+opacity —
    // not a stale value from before this opacity edit.
    lastEmittedValueRef.current = rgbaToCss(
      withColorOpacity(color, nextOpacity),
    );
    if (onOpacityChange) onOpacityChange(nextOpacity);
    else onChange(lastEmittedValueRef.current);
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
  // Recorded as an effect (not mutated during render) so the ref update is a
  // render side-effect, not a render-body mutation.
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
    // ImageFillControls has no drag surface of its own (URL entry, file
    // pick, and fit selection are each already a discrete, complete action),
    // so — unlike the SV field / hue / alpha tracks — every onChange call
    // here is itself a final commit, never a live-preview tick.
    emitPaintValue(imageFillToCss(next));
    notifyChangeComplete();
  };

  // ── Shader editing ──────────────────────────────────────────────────────────────

  // Cheap live preview — fires on every ShaderFillsPanel tuning tick. Must
  // not call notifyChangeComplete (that's the expensive-commit signal), or
  // every drag tick would dirty undo history the same way an un-split
  // onChange/onChangeComplete would for color/gradient dragging.
  const previewShader = (descriptor: ShaderDescriptor, css: string) => {
    setShaderDescriptor(descriptor);
    emitPaintValue(css);
  };

  // Fires once per gesture/discrete pick (see ShaderFillsPanel's onCommit).
  const commitShader = (descriptor: ShaderDescriptor, css: string) => {
    setShaderDescriptor(descriptor);
    onShaderChange?.(descriptor, css);
    emitPaintValue(css);
    notifyChangeComplete();
  };

  // ── Paint-type switching (does real work for every type) ──────────────────────

  const setPaintType = (nextType: DesignPaintType) => {
    if (disabled) return;
    // Tabs outside `supportedPaintTypes` aren't rendered, but guard here too
    // in case a caller invokes setPaintType via another path in the future.
    if (!isPaintTypeSupported(nextType)) return;

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

    // Every branch below is a discrete, one-shot commit (a paint-type click),
    // never a live drag tick — so each one notifies onChangeComplete once,
    // immediately, right after the matching onChange/onPaintValueChange call.
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
      // No standalone CSS for video; mark the fill type and keep a checker fill
      // until a source is wired. The agent can replace it with a <video> layer.
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
          // In gradient mode, route to the selected stop (preserving its alpha)
          // like every other color edit — don't replace the whole gradient with
          // a solid hex.
          const parsed = parseCssColor(hex);
          if (parsed) emitStopColor({ ...parsed, a: fieldColor.a });
        } else {
          lastEmittedValueRef.current = hex;
          onChange(hex);
        }
        // The eyedropper pick is a single discrete commit, not a drag tick.
        notifyChangeComplete();
      }
    } finally {
      setPicking(false);
    }
  };

  const hasEyeDropper = hasEyeDropperSupport();

  // Cancels the whole editing session back to the snapshot captured when the
  // popover opened — the Escape-key contract (matches Figma: any live-preview
  // dragging done while the popover was open gets thrown away, not just
  // whatever field currently has focus). Resets every local override so the
  // effective paint type / gradient / shader recompute cleanly from the
  // reverted props on the next render.
  const revertToOpenSnapshot = () => {
    if (disabled) return;
    const snapshot = openSnapshotRef.current;
    setLocalPaintType(null);
    setLocalGradient(null);
    setSelectedStopId("");
    setShaderDescriptor(null);
    setView("picker");
    if (onPaintTypeChange && snapshot.paintType !== undefined) {
      onPaintTypeChange(snapshot.paintType);
    }
    if (onOpacityChange) onOpacityChange(snapshot.opacity);
    lastEmittedValueRef.current = snapshot.value;
    onChange(snapshot.value);
    onChangeComplete?.(snapshot.value);
  };

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
          // Radix fires a dedicated `onFocusOutside` (not `onInteractOutside`
          // with e.type === "focusoutside" — that never matches) whenever focus
          // moves outside the content; suppress it so canvas-driven focus
          // re-projection can't close the popover. Genuine pointer clicks
          // outside still close it via the default onInteractOutside behavior.
          onFocusOutside={(e) => e.preventDefault()}
          // Escape cancels the whole editing session (see revertToOpenSnapshot)
          // and then still closes the popover via Radix's default dismiss
          // behavior — this only reverts the color/opacity/paint-type state,
          // it doesn't call `e.preventDefault()`, so the close still happens.
          onEscapeKeyDown={revertToOpenSnapshot}
        >
          <div className="rounded-md bg-popover text-popover-foreground">
            {view === "shader" && glslShaderContext ? (
              /* Code-backed GLSL shader picker — persists real GLSL source
                 into the screen HTML (Created by you / Create new (AI) /
                 Presets). Rendered whenever the caller provides the
                 persistence context; the legacy CSS-approximation panel
                 below stays for callers that don't. */
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
                    // No shader chosen — revert to a solid so the row isn't dead.
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
                              className="text-[10px]"
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
                      selectedStopId={selectedStopId}
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
                          // Record the dragged hue immediately so the slider
                          // doesn't snap back to a stale hue on the next
                          // render when the color is (or becomes) achromatic
                          // — the round-tripped color's s/v may still be 0,
                          // so the lastHueRef-sync effect's s>0&&v>0 guard
                          // won't fire on its own.
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
                            onCommit={notifyChangeComplete}
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
                    {(documentColors && documentColors.length > 0
                      ? documentColors
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
                                // A swatch click is a discrete, one-shot
                                // commit, not a drag tick.
                                notifyChangeComplete();
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
  onCommit,
}: {
  hsv: HsvaColor;
  label: string;
  disabled: boolean;
  onChange: (color: HsvaColor) => void;
  /**
   * Fired once per gesture with the final value already applied — on
   * pointerup/pointercancel that ends a drag, and after every keyboard step
   * (each arrow press is its own discrete, complete edit). Never fired per
   * pointermove tick.
   */
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
  backgroundSize,
  backgroundPosition,
  onChange,
  onCommit,
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
  /**
   * Fired once per gesture with the final value already applied — on
   * pointerup/pointercancel that ends a drag, and after every keyboard step
   * (each arrow/Home/End press is its own discrete, complete edit). Never
   * fired per pointermove tick.
   */
  onCommit?: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<PointerGestureState>(POINTER_GESTURE_IDLE);
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
 * A number input with select-on-focus, Esc-to-revert, arrow-key nudging, and
 * Figma-style click-drag "scrubbing": pressing down and dragging left/right
 * decrements/increments the value continuously (Shift = 10x coarser step,
 * matching the same shift convention as arrow-key nudges and the SV/hue/alpha
 * tracks) without needing to type. A short press-release with no meaningful
 * movement is treated as an ordinary click so focus + select-on-focus (and
 * therefore typing) keep working exactly as before.
 *
 * The `compact` prop removes inner padding for use inside bordered wrappers.
 */
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
  /**
   * Fires once per discrete, complete edit: a blur/Enter commit (only when
   * the draft actually parsed — not on a revert), each arrow-key step, and
   * once at the end of a scrub drag (not per pointermove tick). Mirrors the
   * `onCommit` contract used by SaturationBrightnessField/ColorTrack so every
   * draggable/steppable control in this picker notifies
   * `onChangeComplete` exactly once per gesture.
   */
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
        // Figma's numeric fields never show the native up/down spinner —
        // hide it in both engines so this reads as a plain scrubbable value,
        // not a browser default number input. (The spinner buttons also
        // bypassed this component's onChange/onCommit contract entirely,
        // since native stepper clicks only mutate the draft string, not the
        // color — hiding them removes that dead, contract-violating path.)
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
        // Don't preventDefault here — a plain click (no subsequent movement
        // past the threshold) must still focus the input normally so typing
        // keeps working. Pointer capture just ensures a real drag keeps
        // routing to this element even once the cursor leaves its bounds.
        scrubRef.current = startScrubGesture(e.clientX, value);
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (disabled || !scrubRef.current.active) return;
        const deltaX = e.clientX - scrubRef.current.startX;
        if (!scrubRef.current.dragging) {
          if (Math.abs(deltaX) < SCRUB_DRAG_THRESHOLD_PX) return;
          scrubRef.current = { ...scrubRef.current, dragging: true };
          // Now that this is a genuine drag (not a click), stop the browser
          // from turning the pointer move into a text-selection drag.
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
          // A drag ended without focusing the field for text entry — match
          // Figma (dragging a number field doesn't leave it in edit mode).
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

// ─── Pointer-drag gesture-commit tracking ──────────────────────────────────────
//
// Pure helper shared by SaturationBrightnessField and ColorTrack: both fields
// call onChange on every pointermove tick for live preview, and must call
// onCommit exactly once when the gesture ends (pointerup/pointercancel),
// covering both an actual drag and a single tap-no-move click. Extracted so
// the "exactly once per gesture" contract is unit-testable without simulating
// real DOM pointer events (this template has no jsdom/testing-library dep).

/** True once a pointerdown has started a gesture that hasn't yet ended. */
export type PointerGestureState = boolean;

export const POINTER_GESTURE_IDLE: PointerGestureState = false;

/** Call on pointerdown: starts tracking a new gesture. */
export function startPointerGesture(): PointerGestureState {
  return true;
}

/**
 * Call on pointerup/pointercancel. Returns the next (idle) state and whether
 * onCommit should fire — true iff a gesture was actually in progress, so a
 * stray pointerup with no matching pointerdown is a no-op.
 */
export function endPointerGesture(state: PointerGestureState): {
  state: PointerGestureState;
  shouldCommit: boolean;
} {
  return { state: POINTER_GESTURE_IDLE, shouldCommit: state };
}

// ─── Click-drag "scrub" tracking for ScrubbyNumberInput ────────────────────────
//
// A plain pointerdown+pointerup with no meaningful movement must behave like
// an ordinary click (focus the input, select-on-focus, allow typing) — it
// only becomes a scrub once the pointer has moved past a small pixel
// threshold, matching Figma's numeric fields (click to type, click-drag to
// scrub). `dragging` flips true exactly once per gesture, the first time the
// threshold is crossed.

const SCRUB_DRAG_THRESHOLD_PX = 3;
/** Pixels of drag per 1 unit of value change at the normal (non-Shift) rate. */
const SCRUB_PIXELS_PER_STEP = 4;

export interface ScrubGestureState {
  /** True from pointerdown until the matching pointerup/pointercancel. */
  active: boolean;
  /** True once the drag has crossed the click-vs-drag threshold. */
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

/** Call on pointerdown: starts tracking a new potential scrub gesture. */
export function startScrubGesture(
  startX: number,
  startValue: number,
): ScrubGestureState {
  return { active: true, dragging: false, startX, startValue };
}

/**
 * Pure math for one scrub tick: converts total horizontal drag distance
 * (from the gesture's start position) into a new clamped value. Shift scales
 * the rate 10x coarser, matching the same shift convention as arrow-key
 * nudges and the SV/hue/alpha track keyboard steps.
 */
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
  const parsed = parseCssColorExtended(value);
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

/** Values that render their own background without needing color parsing. */
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
      backgroundImage: `${CHECKERBOARD_IMAGE}, linear-gradient(${rgbaToCss(parsed)}, ${rgbaToCss(parsed)})`,
      backgroundSize: "8px 8px, 8px 8px, 8px 8px, 8px 8px, 100% 100%",
      backgroundPosition: "0 0, 0 4px, 4px -4px, -4px 0, 0 0",
    };
  }
  if (parsed) return { backgroundColor: rgbaToCss(parsed) };
  if (value && looksLikeImageOrGradient(value)) {
    return { backgroundImage: value };
  }
  // Unparseable and not a gradient/image value (e.g. a stale/invalid document
  // color) — show a neutral checkerboard instead of an invalid `background-image`
  // that would otherwise render as a blank swatch.
  return {
    backgroundImage: CHECKERBOARD_IMAGE,
    backgroundSize: "8px 8px",
  };
}

function alphaTrackBackground(color: RgbaColor): string {
  return `${CHECKERBOARD_IMAGE}, linear-gradient(90deg, rgba(${color.r}, ${color.g}, ${color.b}, 0), rgba(${color.r}, ${color.g}, ${color.b}, 1))`;
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

/**
 * Parses a `ScrubbyNumberInput` draft string into a finite number, or `null`
 * when the draft should be treated as invalid (and thus reverted rather than
 * committed). `Number("")` is `0`, not `NaN`, so an emptied field must be
 * special-cased — otherwise clearing the input and blurring/pressing Enter
 * would silently commit `0` instead of reverting to the last real value.
 */
export function parseNumericDraft(draft: string): number | null {
  const trimmed = draft.trim();
  if (trimmed === "") return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Expands a bare 1-digit hex fragment (e.g. "F") into the standard 3-digit
 * shorthand ("FFF", which `parseCssColor` then doubles up to "FFFFFF") so a
 * single typed hex digit still commits instead of being rejected as
 * unparseable. Standard 3/4/6/8-digit hex (already handled by
 * `parseCssColor`) passes through unchanged.
 */
export function expandHexShorthand(value: string): string {
  const trimmed = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]$/i.test(trimmed)) {
    return trimmed.repeat(3);
  }
  return trimmed;
}
