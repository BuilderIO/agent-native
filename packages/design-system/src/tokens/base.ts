import type { Appearance } from "./color/radix-generator.js";

/**
 * Appearance-level literals that are not part of any generated scale: the
 * translucent field fill, the dialog scrim, and the shadow tint ramp. Shadows
 * stay black in both appearances; a tinted gray would lighten them in dark.
 */
export const BASE_BY_APPEARANCE: Record<
  Appearance,
  { field: string; overlay: string; shadowTint: readonly string[] }
> = {
  light: {
    field: "#ffffffe6",
    overlay: "#00000066",
    shadowTint: [
      "#0000000d",
      "#0000001a",
      "#00000026",
      "#00000033",
      "#0000004d",
      "#00000066",
      "#00000080",
    ],
  },
  dark: {
    field: "#00000040",
    overlay: "#00000099",
    shadowTint: [
      "#0000001a",
      "#00000033",
      "#0000004d",
      "#00000066",
      "#00000080",
      "#00000099",
      "#000000b3",
    ],
  },
};

/** Tailwind v4's default shadows, which the app themes reproduce exactly. */
export const TAILWIND_SHADOWS = {
  xs: "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  sm: "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  md: "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  lg: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  xl: "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
} as const;
