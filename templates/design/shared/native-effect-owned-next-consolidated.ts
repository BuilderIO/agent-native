import {
  OWNED_NEXT_PROCESSOR_DEFINITIONS as A_DEFINITIONS,
  OWNED_NEXT_PROCESSOR_PRESETS as A_PRESETS,
} from "./native-effect-owned-next-a";
import {
  OWNED_NEXT_PROCESSOR_DEFINITIONS as B_DEFINITIONS,
  OWNED_NEXT_PROCESSOR_PRESETS as B_PRESETS,
  validateOwnedCornerQuad,
} from "./native-effect-owned-next-b";
import { EDGE_SAMPLING_WGSL } from "./native-effect-owned-next-edge-sampling";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const A = new Set([
  "median-speckle",
  "anisotropic-diffusion",
  "aperture-bokeh",
  "dark-channel-dehaze",
  "bounded-canny-contours",
  "dog-ink",
  "alpha-dilate",
  "alpha-erode",
]);
const B = new Set([
  "owned-corner-perspective",
  "owned-chroma-key",
  "owned-adaptive-threshold",
  "owned-pointillist-brush",
]);

const sourceSampler = /fn sampleSource\(uv: vec2f\) -> vec4f \{[\s\S]*?\n\}/g;
function exactEdgeSampling(definition: EffectDefinition): EffectDefinition {
  return {
    ...definition,
    passes: definition.passes.map((pass) => {
      if (pass.kind !== "render")
        throw new TypeError("Expected an owned render pass");
      const matches = [...pass.wgsl.matchAll(sourceSampler)];
      if (matches.length !== 1)
        throw new TypeError(
          `Expected one source sampler in ${definition.id}/${pass.id}`,
        );
      return {
        ...pass,
        wgsl: pass.wgsl.replace(
          sourceSampler,
          `${EDGE_SAMPLING_WGSL}\nfn sampleSource(uv: vec2f) -> vec4f { return sampleEdgeTexture(sourceTexture, uv, u32(globals.params[0].x)); }`,
        ),
      };
    }),
  };
}

export const OWNED_NEXT_CONSOLIDATED_DEFINITIONS: readonly EffectDefinition[] =
  [
    ...A_DEFINITIONS.filter((definition) =>
      A.has(definition.id.replace("an-native-owned-next-", "")),
    ),
    ...B_DEFINITIONS.filter((definition) =>
      B.has(definition.id.replace("an-native-", "")),
    ).map(exactEdgeSampling),
  ].map((definition) => {
    if (definition.id === "an-native-owned-next-dog-ink")
      return {
        ...definition,
        parameterConstraints: [
          {
            kind: "ordered-floats" as const,
            lesser: "fineRadius",
            greater: "broadRadius",
            minGap: 0.05,
          },
        ],
      };
    if (definition.id === "an-native-owned-corner-perspective")
      return {
        ...definition,
        parameterConstraints: [
          {
            kind: "convex-quad" as const,
            corners: [
              "topLeft",
              "topRight",
              "bottomRight",
              "bottomLeft",
            ] as const,
            minArea: 0.001,
            minCross: 0.00001,
          },
        ],
      };
    return definition;
  });
export const OWNED_NEXT_CONSOLIDATED_PRESETS: readonly EffectPreset[] = [
  ...A_PRESETS.filter((preset) =>
    OWNED_NEXT_CONSOLIDATED_DEFINITIONS.some(
      (definition) => definition.id === preset.definitionId,
    ),
  ),
  ...B_PRESETS.filter((preset) =>
    OWNED_NEXT_CONSOLIDATED_DEFINITIONS.some(
      (definition) => definition.id === preset.definitionId,
    ),
  ),
];

export type OwnedNextPreflightError =
  | { code: "dog-radii-order"; fields: readonly ["fineRadius", "broadRadius"] }
  | {
      code: "perspective-degenerate" | "perspective-nonconvex";
      fields: readonly ["topLeft", "topRight", "bottomRight", "bottomLeft"];
    };

export function preflightOwnedNextParams(
  definition: EffectDefinition,
  params: Readonly<Record<string, unknown>>,
): OwnedNextPreflightError | null {
  const value = (key: string) =>
    params[key] ?? definition.properties[key]?.default;
  if (definition.id === "an-native-owned-next-dog-ink") {
    const fine = value("fineRadius");
    const broad = value("broadRadius");
    if (
      typeof fine !== "number" ||
      typeof broad !== "number" ||
      !Number.isFinite(fine) ||
      !Number.isFinite(broad) ||
      broad <= fine
    ) {
      return { code: "dog-radii-order", fields: ["fineRadius", "broadRadius"] };
    }
  }
  if (definition.id === "an-native-owned-corner-perspective") {
    const keys = ["topLeft", "topRight", "bottomRight", "bottomLeft"] as const;
    const corners = keys.map(value);
    if (
      corners.some(
        (corner) =>
          !Array.isArray(corner) ||
          corner.length !== 2 ||
          corner.some((component) => typeof component !== "number"),
      )
    ) {
      return { code: "perspective-degenerate", fields: keys };
    }
    const result = validateOwnedCornerQuad(
      corners as [number[], number[], number[], number[]] as [
        [number, number],
        [number, number],
        [number, number],
        [number, number],
      ],
    );
    if (!result.ok)
      return {
        code:
          result.code === "corner-quad-degenerate"
            ? "perspective-degenerate"
            : "perspective-nonconvex",
        fields: keys,
      };
  }
  return null;
}
