import { SLAT_SHUTTER_CONTROL_EFFECT } from "./native-effect-owned-p-shutter";
import { INTENSITY_RUN_SORT_EFFECT } from "./native-effect-owned-p2-sort";
import type { EffectDefinition, EffectPreset } from "./native-effects";

export const OWNED_P2_DEFINITIONS: readonly EffectDefinition[] = [
  INTENSITY_RUN_SORT_EFFECT,
  SLAT_SHUTTER_CONTROL_EFFECT,
];

export const OWNED_P2_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-owned-p-intensity-run-sort-1",
    name: "Short bright runs",
    definitionId: INTENSITY_RUN_SORT_EFFECT.id,
    definitionVersion: INTENSITY_RUN_SORT_EFFECT.version,
    placement: "layer",
    params: { threshold: 0.45, blockLength: 6, order: "ascending" },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-p-intensity-run-sort-2",
    name: "Descending bands",
    definitionId: INTENSITY_RUN_SORT_EFFECT.id,
    definitionVersion: INTENSITY_RUN_SORT_EFFECT.version,
    placement: "layer",
    params: {
      threshold: 0.22,
      blockLength: 16,
      order: "descending",
      amount: 0.85,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-p-slat-shutter-1",
    name: "Even shutter",
    definitionId: SLAT_SHUTTER_CONTROL_EFFECT.id,
    definitionVersion: SLAT_SHUTTER_CONTROL_EFFECT.version,
    placement: "layer",
    params: { progress: 0.4, slats: 8, stagger: 0, feather: 0.015 },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-owned-p-slat-shutter-2",
    name: "Staggered reveal",
    definitionId: SLAT_SHUTTER_CONTROL_EFFECT.id,
    definitionVersion: SLAT_SHUTTER_CONTROL_EFFECT.version,
    placement: "layer",
    params: { progress: 0.68, slats: 18, stagger: 0.8, direction: "right" },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
