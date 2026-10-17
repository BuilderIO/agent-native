import { OCEAN_TUNING } from "./tuning.js";

export interface OceanColors {
  readonly fg: readonly [number, number, number];
  readonly bg: readonly [number, number, number];
}

export const DEFAULT_OCEAN_COLORS: OceanColors = {
  fg: OCEAN_TUNING.present.fgColor,
  bg: OCEAN_TUNING.present.bgColor,
};
