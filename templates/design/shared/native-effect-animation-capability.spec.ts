import { describe, expect, it } from "vitest";

import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import { STATEFUL_NINE_DEFINITIONS } from "./native-effect-owned-stateful-nine";
import { NATIVE_EFFECT_DEFINITION_CATALOG } from "./native-effect-presets";

describe("native effect animation capability", () => {
  it("classifies every exact built-in version and keeps static saved versions static", () => {
    expect(
      NATIVE_EFFECT_DEFINITION_CATALOG.every(
        (definition) =>
          nativeEffectAnimationCapability(definition) !== "unknown",
      ),
    ).toBe(true);
    const newClassifications = {
      "an-native-owned-mycelium-trails@3": "animated",
      "an-native-owned-ink-blooms@3": "animated",
      "an-native-owned-tide-pool-contours@3": "animated",
      "an-native-owned-braided-ribbons@3": "animated",
      "an-native-owned-fresnel-shells@3": "animated",
      "an-native-owned-etched-diffraction@3": "animated",
      "an-native-owned-aurora-curtains@3": "animated",
      "an-native-owned-fog-banks@3": "animated",
      "an-native-owned-ember-drift@3": "animated",
      "an-native-owned-volumetric-cones@3": "animated",
      "an-native-owned-contour-terrain@3": "animated",
      "an-native-owned-gyroid-slice@3": "animated",
      "an-native-owned-leaf-venation@4": "static",
      "an-native-owned-coral-polyps@4": "static",
      "an-native-owned-knit-loops@4": "static",
      "an-native-owned-quilted-diamonds@4": "static",
      "an-native-owned-lace-rosettes@4": "static",
      "an-native-owned-sashiko-stitches@4": "static",
      "an-native-owned-prism-facets@4": "static",
      "an-native-owned-lenticular-ribs@4": "static",
      "an-native-owned-anamorphic-streaks@4": "static",
      "an-native-owned-horizon-haze@4": "static",
      "an-native-owned-wire-dome@4": "static",
      "an-native-owned-folded-paper@4": "static",
      "an-native-owned-crystal-lattice@4": "static",
      "an-native-grain-gradient@4": "animated",
      "an-native-luminous-perimeter@1": "animated",
      "an-native-owned-o-edge-light-leak@1": "animated",
      "an-native-owned-o-edge-light-leak@2": "animated",
      "an-native-owned-o-thickness-glass@1": "static",
      "an-native-owned-life-mosaic@1": "animated",
      "an-native-owned-cyclic-chase@1": "animated",
      "an-native-owned-nerve-recovery@1": "animated",
      "an-native-owned-sand-avalanche@1": "animated",
      "an-native-owned-ember-front@1": "animated",
      "an-native-owned-frost-lattice@1": "animated",
      "an-native-owned-buoyant-plumes@1": "animated",
      "an-native-owned-predator-prey@1": "animated",
      "an-native-owned-magnetic-domains@1": "animated",
      "an-native-focal-color-field@1": "static",
    } as const;
    for (const [key, capability] of Object.entries(newClassifications)) {
      const definition = NATIVE_EFFECT_DEFINITION_CATALOG.find(
        (item) => `${item.id}@${item.version}` === key,
      );
      expect(definition, key).toBeDefined();
      expect(nativeEffectAnimationCapability(definition!), key).toBe(
        capability,
      );
    }
    for (const definition of STATEFUL_NINE_DEFINITIONS) {
      expect(nativeEffectAnimationCapability(definition)).toBe("animated");
      expect(
        nativeEffectAnimationCapability({
          ...definition,
          version: definition.version + 1,
        }),
      ).toBe("unknown");
      expect(
        nativeEffectAnimationCapability({
          ...definition,
          passes: [
            {
              ...definition.passes[0]!,
              wgsl: `${definition.passes[0]!.wgsl}\n// changed`,
            },
            ...definition.passes.slice(1),
          ],
        }),
      ).toBe("unknown");
    }
    const newStaticIds = [
      "an-native-owned-o-thickness-glass@1",
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
    const edgeLightLeak = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) =>
        item.id === "an-native-owned-o-edge-light-leak" && item.version === 1,
    );
    expect(edgeLightLeak).toBeDefined();
    expect(edgeLightLeak!.properties.speed?.default).toBeGreaterThan(0);
    expect(edgeLightLeak!.properties.flicker?.default).toBeGreaterThan(0);
    expect(
      edgeLightLeak!.passes.some((pass) =>
        pass.wgsl.includes("globals.clock.x"),
      ),
    ).toBe(true);
    expect(nativeEffectAnimationCapability(edgeLightLeak!)).toBe("animated");
    const thicknessGlass = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) =>
        item.id === "an-native-owned-o-thickness-glass" && item.version === 1,
    );
    expect(thicknessGlass).toBeDefined();
    const glassBody = thicknessGlass!.passes
      .map((pass) => pass.wgsl)
      .join("\n");
    expect(glassBody).toContain("globals.clock.z");
    expect(glassBody).not.toContain("globals.clock.x");
    expect(glassBody).not.toContain("globals.clock.w");
    expect(nativeEffectAnimationCapability(thicknessGlass!)).toBe("static");
    const edgeLightLeakV2 = NATIVE_EFFECT_DEFINITION_CATALOG.find(
      (item) =>
        item.id === "an-native-owned-o-edge-light-leak" && item.version === 2,
    );
    expect(edgeLightLeakV2).toBeDefined();
    expect(nativeEffectAnimationCapability(edgeLightLeakV2!)).toBe("animated");
    expect(
      nativeEffectAnimationCapability({ ...edgeLightLeakV2!, version: 3 }),
    ).toBe("unknown");
    expect(
      nativeEffectAnimationCapability({
        ...thicknessGlass!,
        passes: [
          {
            ...thicknessGlass!.passes[0]!,
            wgsl: `${thicknessGlass!.passes[0]!.wgsl}\n// mutated shader`,
          },
        ],
      }),
    ).toBe("unknown");
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
