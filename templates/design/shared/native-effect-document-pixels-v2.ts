import { lensDistortion, water } from "./native-effect-gallery-additions";
import { GLOWING_WAVES_EFFECT } from "./native-effect-v1-graphics";
import type { EffectDefinition } from "./native-effects";

export const HISTORICAL_DOCUMENT_PIXEL_EFFECTS: readonly EffectDefinition[] = [
  GLOWING_WAVES_EFFECT,
  lensDistortion,
  water,
];

function corrected(
  definition: EffectDefinition,
  replacements: readonly (readonly [string, string])[],
): EffectDefinition {
  return {
    ...definition,
    version: 2,
    passes: definition.passes.map((pass) => {
      let wgsl = pass.wgsl;
      for (const [before, after] of replacements) {
        if (!wgsl.includes(before))
          throw new Error(
            `Missing document pixel expression in ${definition.id}`,
          );
        wgsl = wgsl.replace(before, after);
      }
      return { ...pass, wgsl };
    }),
  };
}

export const GLOWING_WAVES_V2_EFFECT = corrected(GLOWING_WAVES_EFFECT, [
  [
    "let glowWidth = max(globals.params[4].x, 1.0);",
    "let glowWidth = max(globals.params[4].x, 1.0) * globals.clock.z;",
  ],
]);
export const LENS_DISTORTION_V2_EFFECT = corrected(lensDistortion, [
  [
    "* globals.viewport.zw * radiusSquared;",
    "* globals.clock.z * globals.viewport.zw * radiusSquared;",
  ],
]);
export const WATER_V2_EFFECT = corrected(water, [
  ["dpdy(a + b * 0.42));", "dpdy(a + b * 0.42)) * globals.clock.z;"],
  [
    "* globals.viewport.zw * 42.0;",
    "* globals.clock.z * globals.viewport.zw * 42.0;",
  ],
]);
export const DOCUMENT_PIXEL_V2_EFFECTS = [
  GLOWING_WAVES_V2_EFFECT,
  LENS_DISTORTION_V2_EFFECT,
  WATER_V2_EFFECT,
] as const;
