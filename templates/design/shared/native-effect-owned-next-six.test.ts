import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { planEffectGraph } from "./effect-graph";
import { nativeEffectAnimationCapability } from "./native-effect-animation-capability";
import {
  OWNED_NEXT_SIX_DEFINITIONS,
  OWNED_NEXT_SIX_PRESETS,
} from "./native-effect-owned-next-six";
import {
  NATIVE_EFFECT_DEFINITION_CATALOG,
  NATIVE_EFFECT_LATEST_DEFINITIONS,
  NATIVE_EFFECT_PRESETS,
} from "./native-effect-presets";
import { hashEffectDefinition } from "./native-effect-trust";
import { packNativeProperties, validateEffectDocument } from "./native-effects";

const ORIGINAL_172_IDENTITIES = [
  "an-native-ascii-print@1",
  "an-native-barrel-distortion@1",
  "an-native-bloom@2",
  "an-native-brushed-metal@1",
  "an-native-cellular-bloom@1",
  "an-native-chromatic-aberration@1",
  "an-native-color-grade@1",
  "an-native-crosshatch@1",
  "an-native-crt-display@1",
  "an-native-curl-streamlines@1",
  "an-native-dye-transport@1",
  "an-native-eddy-rings@1",
  "an-native-emboss@1",
  "an-native-film-grain@1",
  "an-native-firefly-drift@2",
  "an-native-flow-glass@1",
  "an-native-fractal-cloud@1",
  "an-native-frosted-refraction@1",
  "an-native-frosted-refraction@2",
  "an-native-frosted-refraction@3",
  "an-native-gaussian-blur@2",
  "an-native-gradient-field@1",
  "an-native-grain-gradient@1",
  "an-native-grain-gradient@2",
  "an-native-grain-gradient@3",
  "an-native-halftone@1",
  "an-native-halftone@2",
  "an-native-halftone@3",
  "an-native-hex-tiles@1",
  "an-native-ink-advection@1",
  "an-native-iridescent-surface@1",
  "an-native-kaleidoscope@1",
  "an-native-magnetic-filaments@1",
  "an-native-mandelbrot@1",
  "an-native-mesh-anchors@2",
  "an-native-metaball-field@2",
  "an-native-noise-displacement@1",
  "an-native-ordered-dither@1",
  "an-native-owned-adaptive-threshold@1",
  "an-native-owned-anamorphic-streaks@2",
  "an-native-owned-anamorphic-streaks@3",
  "an-native-owned-aurora-curtains@2",
  "an-native-owned-bevel-light@1",
  "an-native-owned-braided-ribbons@2",
  "an-native-owned-breadth-dielectric-branching@1",
  "an-native-owned-breadth-hyperbolic-geodesics@1",
  "an-native-owned-breadth-isometric-voxel-field@1",
  "an-native-owned-breadth-masonry-bond@1",
  "an-native-owned-breadth-perspective-floor-grid@1",
  "an-native-owned-breadth-polarized-light-sheets@1",
  "an-native-owned-breadth-sand-ripple-bed@1",
  "an-native-owned-breadth-sierpinski-gasket@1",
  "an-native-owned-c-basalt-vesicles@2",
  "an-native-owned-c-catenoid-shell@2",
  "an-native-owned-c-corduroy-ridges@2",
  "an-native-owned-c-crochet-chain@2",
  "an-native-owned-c-dodecahedron-facets@2",
  "an-native-owned-c-dust-storm@1",
  "an-native-owned-c-guilloche-rosettes@2",
  "an-native-owned-c-heat-inversion@1",
  "an-native-owned-c-hypotrochoid-ink@2",
  "an-native-owned-c-ikat-warp@2",
  "an-native-owned-c-knotted-net@2",
  "an-native-owned-c-lissajous-weft@1",
  "an-native-owned-c-logarithmic-spiral-lines@2",
  "an-native-owned-c-marled-yarn@2",
  "an-native-owned-c-menger-cutaway@2",
  "an-native-owned-c-mica-schist@2",
  "an-native-owned-c-parchment-fibrils@2",
  "an-native-owned-c-phyllotaxis-seeds@2",
  "an-native-owned-c-quasicrystal-bands@1",
  "an-native-owned-c-salt-crust@2",
  "an-native-owned-c-sinc-diffraction@2",
  "an-native-owned-c-snow-squall@1",
  "an-native-owned-c-superellipsoid@2",
  "an-native-owned-c-tartan-interlace@2",
  "an-native-owned-c-terrazzo-chips@2",
  "an-native-owned-c-trefoil-tube@2",
  "an-native-owned-c-twin-halo-arcs@2",
  "an-native-owned-c-twisted-prism@2",
  "an-native-owned-c-underwater-sediment@1",
  "an-native-owned-c-wood-endgrain@2",
  "an-native-owned-chroma-key@1",
  "an-native-owned-chromatic-drift@1",
  "an-native-owned-contour-terrain@2",
  "an-native-owned-coral-polyps@2",
  "an-native-owned-coral-polyps@3",
  "an-native-owned-corner-perspective@1",
  "an-native-owned-crystal-lattice@2",
  "an-native-owned-crystal-lattice@3",
  "an-native-owned-detail-boost@1",
  "an-native-owned-directional-smear@1",
  "an-native-owned-edge-ink@1",
  "an-native-owned-edge-neon@1",
  "an-native-owned-ember-drift@2",
  "an-native-owned-emboss-light@1",
  "an-native-owned-etched-diffraction@2",
  "an-native-owned-fog-banks@2",
  "an-native-owned-folded-paper@2",
  "an-native-owned-folded-paper@3",
  "an-native-owned-fresnel-shells@2",
  "an-native-owned-glass-blocks@1",
  "an-native-owned-gyroid-slice@2",
  "an-native-owned-harmonic-band-map@1",
  "an-native-owned-heat-haze@1",
  "an-native-owned-horizon-haze@2",
  "an-native-owned-horizon-haze@3",
  "an-native-owned-ink-bleed@1",
  "an-native-owned-ink-blooms@2",
  "an-native-owned-knit-loops@2",
  "an-native-owned-knit-loops@3",
  "an-native-owned-lace-rosettes@2",
  "an-native-owned-lace-rosettes@3",
  "an-native-owned-leaf-venation@2",
  "an-native-owned-leaf-venation@3",
  "an-native-owned-lens-pinch@1",
  "an-native-owned-lenticular-ribs@2",
  "an-native-owned-lenticular-ribs@3",
  "an-native-owned-mycelium-trails@2",
  "an-native-owned-newton-basins@1",
  "an-native-owned-next-alpha-dilate@1",
  "an-native-owned-next-alpha-erode@1",
  "an-native-owned-next-anisotropic-diffusion@1",
  "an-native-owned-next-aperture-bokeh@1",
  "an-native-owned-next-bounded-canny-contours@1",
  "an-native-owned-next-dark-channel-dehaze@1",
  "an-native-owned-next-dog-ink@1",
  "an-native-owned-next-median-speckle@1",
  "an-native-owned-orbital-lensing@1",
  "an-native-owned-pixel-shift@1",
  "an-native-owned-plate-nodal-lines@1",
  "an-native-owned-pointillist-brush@1",
  "an-native-owned-prism-facets@2",
  "an-native-owned-prism-facets@3",
  "an-native-owned-prism-split@1",
  "an-native-owned-quilted-diamonds@2",
  "an-native-owned-quilted-diamonds@3",
  "an-native-owned-radial-echo@1",
  "an-native-owned-ribbon-warp@1",
  "an-native-owned-sashiko-stitches@2",
  "an-native-owned-sashiko-stitches@3",
  "an-native-owned-shadow-lift@1",
  "an-native-owned-soft-threshold@1",
  "an-native-owned-tide-pool-contours@2",
  "an-native-owned-tilt-focus@1",
  "an-native-owned-tone-ripple@1",
  "an-native-owned-volumetric-cones@2",
  "an-native-owned-water-ring@1",
  "an-native-owned-wire-dome@2",
  "an-native-owned-wire-dome@3",
  "an-native-palette-map@1",
  "an-native-particle-flow@1",
  "an-native-pixelate@1",
  "an-native-plasma-field@1",
  "an-native-plasma-sheets@1",
  "an-native-posterize@1",
  "an-native-reaction-field@1",
  "an-native-reaction-islands@1",
  "an-native-ripple-distortion@1",
  "an-native-sharpen@1",
  "an-native-sobel-edges@1",
  "an-native-starfield@3",
  "an-native-swirl@1",
  "an-native-threshold@1",
  "an-native-truchet-arcs@1",
  "an-native-vignette@1",
  "an-native-voronoi-cells@2",
  "an-native-wake-echo@1",
  "an-native-water-caustics@1",
  "an-native-wave-interference@1",
  "an-native-wave-memory@1",
  "an-native-woven-fabric@1",
] as const;
const FOUR_PRIOR_HASHES = new Map([
  [
    "an-native-owned-bilateral-surface",
    "8d3a30305ba2ddfd985ebfa764eb517ab8f1c79595657eeb601a60b02ed763af",
  ],
  [
    "an-native-owned-local-rank-contrast",
    "693fbf9f80726af99fefd7a6d727c99edea4bb6ae55afc16bbb52336871fcf82",
  ],
  [
    "an-native-owned-alpha-pinhole-repair",
    "7c77e52d7051c5ca3f4a99220ad587cc9cfa5a7cc8de76a72124696b4cb022ac",
  ],
  [
    "an-native-owned-luminance-split-tone",
    "dcfc16ab03882f1d2d09169bb844498db603d9091b6fd2daffeee5209314b03e",
  ],
]);
const SIX_NEW_HASHES = new Map([
  [
    "an-native-owned-patch-affinity-denoise",
    "89b7300a087ad7b30b72d3e8237afe173f3a93e74dfbaad8ba12ad54d4d61ef2",
  ],
  [
    "an-native-owned-quadrant-variance-paint",
    "df8eb6e16edda6e5fe1574db02e7d943b83758ce875d9553abc34b26e4a90145",
  ],
  [
    "an-native-owned-chroma-hold",
    "8dfe971cdfbdca5477eead4d7a11b2fa94b54bafd8b0a549014589c3336bf0b9",
  ],
  [
    "an-native-owned-mosaic-sensor",
    "5eacfc3e528d9cf3f49c3265fd18c87c659e112c80cdc07d7ab6634f93cfc238",
  ],
  [
    "an-native-owned-haar-band-remix",
    "00428759359543c493804fe222ea403e45eaf2d18b543b7bf0cc2f2fe37643f5",
  ],
  [
    "an-native-owned-cassini-field-atlas",
    "64a07c7316061831dafd1b2e478746e05e5d4b462047d4f6d8d18dc46451aac4",
  ],
]);

describe("Design-owned next six catalog integration", () => {
  it("retains every older exact version and the four preceding processor hashes", async () => {
    const previous = ORIGINAL_172_IDENTITIES.map((identity) => {
      const matches = NATIVE_EFFECT_DEFINITION_CATALOG.filter(
        (definition) => `${definition.id}@${definition.version}` === identity,
      );
      expect(matches, identity).toHaveLength(1);
      return matches[0]!;
    });
    const pins = await Promise.all(
      previous.map(
        async (definition) =>
          `${definition.id}@${definition.version}:${await hashEffectDefinition(definition)}`,
      ),
    );
    expect(
      createHash("sha256").update(pins.sort().join("\n")).digest("hex"),
    ).toBe("f12276299586b07f8b93974ba4bb9018b3d7bd13ad0ec49803acb9723baec093");
    for (const [id, hash] of FOUR_PRIOR_HASHES) {
      const matches = NATIVE_EFFECT_DEFINITION_CATALOG.filter(
        (definition) => definition.id === id && definition.version === 1,
      );
      expect(matches, id).toHaveLength(1);
      expect(await hashEffectDefinition(matches[0]!)).toBe(hash);
    }
  });

  it("adds six exact static effects and twelve authored recipes", async () => {
    expect(NATIVE_EFFECT_LATEST_DEFINITIONS).toHaveLength(223);
    expect(NATIVE_EFFECT_DEFINITION_CATALOG).toHaveLength(268);
    expect(NATIVE_EFFECT_PRESETS).toHaveLength(538);
    expect(OWNED_NEXT_SIX_DEFINITIONS).toHaveLength(6);
    expect(OWNED_NEXT_SIX_PRESETS).toHaveLength(12);
    expect(
      new Set(NATIVE_EFFECT_LATEST_DEFINITIONS.map((value) => value.id)).size,
    ).toBe(223);
    expect(new Set(NATIVE_EFFECT_PRESETS.map((value) => value.id)).size).toBe(
      538,
    );
    for (const definition of OWNED_NEXT_SIX_DEFINITIONS) {
      expect(await hashEffectDefinition(definition)).toBe(
        SIX_NEW_HASHES.get(definition.id),
      );
      expect(nativeEffectAnimationCapability(definition)).toBe("static");
      expect(planEffectGraph(definition).errors, definition.id).toEqual([]);
      const presets = OWNED_NEXT_SIX_PRESETS.filter(
        (preset) => preset.definitionId === definition.id,
      );
      expect(presets, definition.id).toHaveLength(2);
      expect(
        presets.every(
          (preset) =>
            preset.definitionVersion === definition.version &&
            preset.placement ===
              (definition.kind === "generator" ? "fill" : "layer"),
        ),
      ).toBe(true);
      expect(
        validateEffectDocument({
          schemaVersion: 2,
          definitions: [definition],
          instances: [],
          presets,
        }).errors,
        definition.id,
      ).toEqual([]);
      for (const [key, property] of Object.entries(definition.properties)) {
        if (property.type !== "float") continue;
        if (property.min !== undefined)
          expect(() =>
            packNativeProperties(definition, { [key]: property.min! - 1 }),
          ).toThrow();
        if (property.max !== undefined)
          expect(() =>
            packNativeProperties(definition, { [key]: property.max! + 1 }),
          ).toThrow();
      }
    }
  });
});
