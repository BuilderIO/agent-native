import { createPalette, DEFAULT_PALETTE_INPUT } from "../tokens/palette.js";
import {
  FOCUS_RING_TOKENS,
  STANDARD_ROLES,
  STANDARD_SHAPE_TOKENS,
} from "../tokens/roles.js";
import type { ThemeDefinition } from "./types.js";

const scales = createPalette(DEFAULT_PALETTE_INPUT);

/**
 * The Agent-Native baseline: 24px controls on the 16/20/24/32 ramp, roles
 * mapped straight onto the generated Radix scales, density and radius live.
 * A preview of the look the `agent-native` theme moves to; apps do not pick
 * it yet. Its shadcn values are written from the default scales.
 */
export const baselineTheme: ThemeDefinition = {
  name: "baseline",
  label: "Baseline",
  isDefault: false,
  base: { ...STANDARD_ROLES, ...scales.light.legacy },
  dark: { ...STANDARD_ROLES, ...scales.dark.legacy },
  light: { ...STANDARD_ROLES, ...scales.light.legacy },
  tokens: { ...FOCUS_RING_TOKENS, ...STANDARD_SHAPE_TOKENS },
  palette: { light: scales.light, dark: scales.dark },
  readsScales: true,
};
