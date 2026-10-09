import {
  IconCircleOff as IconNoneFill,
  IconDroplet as IconShaderFill,
  IconPhoto as IconImageFill,
  IconSquareFilled as IconSolid,
} from "@tabler/icons-react";
import type { ElementType } from "react";

import type { DesignPaintType } from "./DesignColorPicker";

// The paint types and blend modes the picker offers, with their icons.

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

export type PaintRowId = "solid" | "gradient" | "image" | "shader";

/** The paint row's four types. Gradient stands for all four gradient kinds. */
export const PAINT_ROW_TYPES: Array<{
  id: PaintRowId;
  label: string;
  Icon: ElementType<{ className?: string }>;
  types: DesignPaintType[];
}> = [
  { id: "solid", label: "Solid", Icon: IconSolid, types: ["solid"] }, // i18n-ignore paint type label
  {
    id: "gradient",
    label: "Gradient", // i18n-ignore paint type label
    Icon: IconLinearGradient,
    types: ["linear", "radial", "angular", "diamond"],
  },
  { id: "image", label: "Image", Icon: IconImageFill, types: ["image"] }, // i18n-ignore paint type label
  { id: "shader", label: "Shader", Icon: IconShaderFill, types: ["shader"] }, // i18n-ignore paint type label
];

/**
 * No fill is not one of the four paints, but a background has no other way to
 * clear, so it stays at the end of the row.
 */
export const NO_FILL_PAINT = {
  type: "none" as const,
  label: "None", // i18n-ignore paint type label
  Icon: IconNoneFill,
};

export const GRADIENT_KINDS = [
  "linear",
  "radial",
  "angular",
  "diamond",
] as const satisfies readonly DesignPaintType[];

export const GRADIENT_TYPES = new Set<DesignPaintType>(GRADIENT_KINDS);

export const BLEND_MODE_OPTIONS = [
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

export type BlendModeValue = (typeof BLEND_MODE_OPTIONS)[number]["value"];

/**
 * Figma's blend menu: Normal, then the darken, lighten, contrast, inversion
 * and component modes, each group set apart by a divider.
 */
export const BLEND_MODE_GROUPS: ReadonlyArray<ReadonlyArray<BlendModeValue>> = [
  ["normal"],
  ["darken", "multiply", "color-burn"],
  ["lighten", "screen", "color-dodge"],
  ["overlay", "soft-light", "hard-light"],
  ["difference", "exclusion"],
  ["hue", "saturation", "color", "luminosity"],
];
