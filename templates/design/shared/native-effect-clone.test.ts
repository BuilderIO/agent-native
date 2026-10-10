import { describe, expect, it } from "vitest";

import {
  captureNativeEffectsForClone,
  mergeNativeEffectsForClone,
} from "./native-effect-clone";
import { GRAIN_GRADIENT_EFFECT } from "./native-effect-presets";
import {
  applyNativeEffectToHtml,
  parseEffectsFromHtml,
} from "./native-effects";

const SOURCE =
  '<!doctype html><html><head></head><body><section data-agent-native-node-id="group"><div data-agent-native-node-id="image">Image</div><div data-agent-native-node-id="mask">Mask</div></section></body></html>';
const FRAGMENT =
  '<section data-agent-native-node-id="group"><div data-agent-native-node-id="image">Image</div><div data-agent-native-node-id="mask">Mask</div></section>';

function sourceWithEffect() {
  const applied = applyNativeEffectToHtml(SOURCE, {
    nodeId: "image",
    definition: GRAIN_GRADIENT_EFFECT,
    placement: "fill",
    bindings: {
      mask: { kind: "authored-node", nodeId: "mask", capture: "content" },
    },
  });
  expect(applied.errors).toEqual([]);
  return applied.html;
}

describe("native effect layer clone", () => {
  it("remaps nested targets and authored bindings while preserving effect settings", () => {
    const source = sourceWithEffect();
    const captured = captureNativeEffectsForClone(source, FRAGMENT);
    expect(captured.errors).toEqual([]);
    const destination = source.replace(
      "</body>",
      `${FRAGMENT.split('"group"').join('"group-copy"').split('"image"').join('"image-copy"').split('"mask"').join('"mask-copy"')}</body>`,
    );
    const merged = mergeNativeEffectsForClone(
      destination,
      FRAGMENT,
      captured.snapshot,
      new Map([
        ["group", "group-copy"],
        ["image", "image-copy"],
        ["mask", "mask-copy"],
      ]),
    );
    expect(merged.errors).toEqual([]);
    const instances = parseEffectsFromHtml(merged.html).document?.instances;
    expect(instances).toHaveLength(2);
    expect(instances?.[1]).toMatchObject({
      nodeId: "image-copy",
      definitionId: GRAIN_GRADIENT_EFFECT.id,
      placement: "fill",
      bindings: { mask: { kind: "authored-node", nodeId: "mask-copy" } },
      timing: instances?.[0]?.timing,
      seed: instances?.[0]?.seed,
    });
    expect(instances?.[1]?.id).not.toBe(instances?.[0]?.id);
  });

  it("copies the exact definition into another source without any approval state", () => {
    const captured = captureNativeEffectsForClone(sourceWithEffect(), FRAGMENT);
    const destination = `<!doctype html><html><head></head><body>${FRAGMENT.split('"group"').join('"g2"').split('"image"').join('"i2"').split('"mask"').join('"m2"')}</body></html>`;
    const merged = mergeNativeEffectsForClone(
      destination,
      FRAGMENT,
      captured.snapshot,
      new Map([
        ["group", "g2"],
        ["image", "i2"],
        ["mask", "m2"],
      ]),
    );
    expect(merged.errors).toEqual([]);
    expect(parseEffectsFromHtml(merged.html).document?.definitions).toEqual([
      GRAIN_GRADIENT_EFFECT,
    ]);
    expect(merged.html).not.toMatch(
      /<script[^>]+application\/x-agent-native-effect-approvals/,
    );
  });

  it("rejects stale fragments, external authored bindings, and ambiguous clone targets", () => {
    const source = sourceWithEffect();
    const captured = captureNativeEffectsForClone(source, FRAGMENT);
    expect(
      captureNativeEffectsForClone(
        source,
        '<div data-agent-native-node-id="image">Image</div>',
      ).errors,
    ).toContain("native clone binding mask leaves the subtree");
    const destination = source.replace(
      "</body>",
      '<div data-agent-native-node-id="image-copy"></div><div data-agent-native-node-id="image-copy"></div><div data-agent-native-node-id="mask-copy"></div></body>',
    );
    expect(
      mergeNativeEffectsForClone(
        destination,
        `${FRAGMENT} `,
        captured.snapshot,
        new Map([
          ["image", "image-copy"],
          ["mask", "mask-copy"],
        ]),
      ).errors,
    ).toContain("native clipboard fragment changed");
    expect(
      mergeNativeEffectsForClone(
        destination,
        FRAGMENT,
        captured.snapshot,
        new Map([
          ["image", "image-copy"],
          ["mask", "mask-copy"],
        ]),
      ).errors,
    ).toContain("native clone target image is missing or ambiguous");
  });
});
