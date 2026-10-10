import { describe, expect, it } from "vitest";

import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "./native-effect-presets";

describe("native effect animation capability", () => {
  it("classifies every exact built-in version and keeps static saved versions static", () => {
    expect(
      NATIVE_EFFECT_DEFINITION_CATALOG.every(
        (definition) =>
          nativeEffectAnimationCapability(definition) !== "unknown",
      ),
    ).toBe(true);
    const newStaticIds = [
      "an-native-owned-next-median-speckle@1",
      "an-native-owned-next-anisotropic-diffusion@1",
      "an-native-owned-next-aperture-bokeh@1",
      "an-native-owned-next-dark-channel-dehaze@1",
      "an-native-owned-next-bounded-canny-contours@1",
      "an-native-owned-next-dog-ink@1",
      "an-native-owned-next-alpha-dilate@1",
      "an-native-owned-next-alpha-erode@1",
      "an-native-owned-corner-perspective@1",
      "an-native-owned-chroma-key@1",
      "an-native-owned-pointillist-brush@1",
      "an-native-owned-adaptive-threshold@1",
      "an-native-owned-breadth-perspective-floor-grid@1",
      "an-native-owned-breadth-hyperbolic-geodesics@1",
      "an-native-owned-breadth-isometric-voxel-field@1",
      "an-native-owned-breadth-masonry-bond@1",
      "an-native-owned-breadth-sand-ripple-bed@1",
      "an-native-owned-breadth-sierpinski-gasket@1",
      "an-native-owned-breadth-polarized-light-sheets@1",
      "an-native-owned-newton-basins@1",
      "an-native-owned-plate-nodal-lines@1",
    ];
    const staticIds = [
      "an-native-owned-shadow-lift@1",
      "an-native-owned-leaf-venation@2",
      "an-native-halftone@3",
      ...newStaticIds,
    ];
    for (const key of staticIds) {
      const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
        (item) => `${item.id}@${item.version}` === key,
      );
      expect(definition, key).toBeDefined();
      expect(nativeEffectAnimationCapability(definition!)).toBe("static");
      if (newStaticIds.includes(key)) {
        const body = definition!.passes.map((pass) => pass.wgsl).join("\n");
        expect(
          body.includes("globals.clock.x") || body.includes("globals.clock.w"),
          key,
        ).toBe(false);
      }
    }
    const animated = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) => item.id === "an-native-gradient-field" && item.version === 1,
    );
    expect(animated).toBeDefined();
    expect(nativeEffectAnimationCapability(animated!)).toBe("animated");
    const branching = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) =>
        item.id === "an-native-owned-breadth-dielectric-branching" &&
        item.version === 1,
    );
    expect(branching).toBeDefined();
    expect(branching!.properties.pulse?.default).toBe(0.3);
    expect(
      branching!.passes.some((pass) => pass.wgsl.includes("globals.clock.x")),
    ).toBe(true);
    expect(nativeEffectAnimationCapability(branching!)).toBe("animated");
    for (const id of [
      "an-native-owned-orbital-lensing",
      "an-native-owned-harmonic-band-map",
    ]) {
      const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
        (item) => item.id === id && item.version === 1,
      );
      expect(definition, id).toBeDefined();
      expect(
        definition!.passes.some((pass) =>
          pass.wgsl.includes("globals.clock.x"),
        ),
      ).toBe(true);
      expect(nativeEffectAnimationCapability(definition!)).toBe("animated");
    }
  });

  it("does not infer a custom definition's timing from a reused built-in ID", () => {
    const builtin = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) => item.id === "an-native-owned-shadow-lift",
    );
    expect(builtin).toBeDefined();
    expect(
      nativeEffectAnimationCapability({
        ...builtin!,
        name: "Renamed",
        passes: builtin!.passes,
      }),
    ).toBe("static");
    expect(
      nativeEffectAnimationCapability({
        ...builtin!,
        passes: [
          {
            ...builtin!.passes[0]!,
            wgsl: `${builtin!.passes[0]!.wgsl}\n// custom code`,
          },
        ],
      }),
    ).toBe("unknown");
    expect(
      nativeEffectAnimationCapability({ ...builtin!, id: "custom-same-math" }),
    ).toBe("unknown");
    expect(nativeEffectAnimationCapability({ ...builtin!, version: 999 })).toBe(
      "unknown",
    );
  });
});
