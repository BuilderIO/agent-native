import {
  FROSTED_REFRACTION_EFFECT,
  GRAIN_GRADIENT_EFFECT,
  HALFTONE_EFFECT,
} from "@shared/native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "@shared/native-effects";
import { expect, it } from "vitest";

import { applyFillStyleIntent } from "./native-fill-style-transition";

const html =
  '<html><body><div data-agent-native-node-id="target"></div><div data-agent-native-node-id="other"></div></body></html>';

it("replaces only the target fill while retaining another node", () => {
  const first = applyNativeEffectToHtml(html, {
    nodeId: "target",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  });
  expect(first.errors).toEqual([]);
  const second = applyNativeEffectToHtml(first.html, {
    nodeId: "other",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
  });
  expect(second.errors).toEqual([]);
  const layer = applyNativeEffectToHtml(second.html, {
    nodeId: "target",
    definition: HALFTONE_EFFECT,
    placement: "layer",
  });
  expect(layer.errors).toEqual([]);
  const backdrop = applyNativeEffectToHtml(layer.html, {
    nodeId: "target",
    definition: FROSTED_REFRACTION_EFFECT,
    placement: "backdrop",
  });
  expect(backdrop.errors).toEqual([]);
  const hidden = applyFillStyleIntent(backdrop.html, "target", "hide");
  expect(
    parseEffectsFromHtml(hidden).document?.instances.map(
      (instance) => instance.enabled,
    ),
  ).toEqual([false, true, true, true]);
  const shown = applyFillStyleIntent(hidden, "target", "show");
  expect(
    parseEffectsFromHtml(shown).document?.instances.map(
      (instance) => instance.enabled,
    ),
  ).toEqual([true, true, true, true]);
  const replaced = applyFillStyleIntent(shown, "target", "replace");
  expect(
    parseEffectsFromHtml(replaced).document?.instances.map(
      (instance) => instance.nodeId,
    ),
  ).toEqual(["other", "target", "target"]);
});
