import { CATALOG_EDGE, catalogShader } from "./native-effect-catalog-kit";
import type { EffectDefinition, EffectProperty } from "./native-effects";

const renderedSurface = catalogShader({
  id: "owned-surface-inspection",
  name: "Surface Inspection",
  version: 1,
  kind: "processor",
  properties: {
    edge: structuredClone(CATALOG_EDGE),
    gain: {
      type: "float",
      label: "Gain",
      default: 1,
      min: 0,
      max: 2,
      step: 0.01,
    },
  },
  fragment: (property) =>
    `let source = sampleSource(input.uv); return vec4f(source.rgb * ${property("gain")}.x, source.a);`,
});

export const OWNED_RENDERED_SURFACE_TEST_EFFECT: EffectDefinition = {
  ...renderedSurface,
  sourceSizing: { uv: "paper-image" },
  provenance: {
    origin: "design-original",
    note: "Design test processor for rendered-surface UV and source edits.",
  },
};

export const OWNED_INTRINSIC_IMAGE_TEST_EFFECT: EffectDefinition = {
  ...OWNED_RENDERED_SURFACE_TEST_EFFECT,
  version: 2,
  sourceSizing: {
    uv: "paper-image",
    intrinsicEncoding: "srgb-encoded-straight",
  },
  resources: OWNED_RENDERED_SURFACE_TEST_EFFECT.resources?.map((resource) =>
    resource.name === "source"
      ? { ...resource, sampleEncoding: "srgb-encoded-straight" }
      : resource,
  ),
  provenance: {
    origin: "design-original",
    note: "Design test processor for a direct intrinsic image source.",
  },
};

const sizedFloat = (
  label: string,
  value: number,
  min: number,
  max: number,
): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min,
  max,
  step: 0.01,
});
export const OWNED_OPTIONAL_IMAGE_SIZING: Record<string, EffectProperty> = {
  fit: {
    type: "enum",
    label: "Fit",
    default: "none",
    options: ["none", "contain", "cover"],
  },
  scale: sizedFloat("Scale", 1, 0.01, 8),
  rotation: sizedFloat("Rotation", 0, 0, 360),
  originX: sizedFloat("Origin X", 0.5, 0, 1),
  originY: sizedFloat("Origin Y", 0.5, 0, 1),
  offsetX: sizedFloat("Offset X", 0, -1, 1),
  offsetY: sizedFloat("Offset Y", 0, -1, 1),
};
