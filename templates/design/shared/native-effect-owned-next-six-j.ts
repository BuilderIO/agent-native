import {
  CATALOG_EDGE,
  catalogColor,
  catalogFloat,
  catalogShader,
  type CatalogShaderSpec,
} from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
  EffectValue,
} from "./native-effects";

type Look = readonly [string, Record<string, EffectValue>];
type Draft = Omit<CatalogShaderSpec, "kind"> & {
  mechanism: string;
  looks: readonly [Look, Look];
  assetFill?: true;
};
const fraction = (label: string, value: number): EffectProperty =>
  catalogFloat(label, value, 0, 1);
const pixel = (label: string, value: number, max: number): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});

export const OWNED_NEXT_SIX_J_DRAFTS: readonly Draft[] = [
  {
    id: "owned-j-photo-contour-relief",
    name: "Photo Contour Relief",
    mechanism:
      "A supplied same-origin image drives quantized luminance terraces and a finite-gradient light response. The image is an actual required texture, not a rendered-source stand-in.",
    assetFill: true,
    properties: {
      image: { type: "texture", label: "Image", default: null, input: "image" },
      fit: {
        type: "enum",
        label: "Image fit",
        default: "cover",
        options: ["cover", "contain", "stretch"],
      },
      bands: catalogFloat("Terrace count", 9, 2, 24, 1),
      contour: fraction("Contour ink", 0.45),
      relief: fraction("Relief light", 0.65),
      lightAzimuth: catalogFloat("Light azimuth", -35, -180, 180, 1),
      amount: fraction("Photo relief", 1),
    },
    helpers: (p) => `
fn imageUv(uv: vec2f) -> vec2f {
  let imageSize = vec2f(textureDimensions(sourceTexture));
  let imageAspect = imageSize.x / max(imageSize.y, 1.0);
  let frameAspect = globals.viewport.x / max(globals.viewport.y, 1.0);
  let fit = u32(${p("fit")}.x);
  if (fit == 2u) { return uv; }
  var scale = vec2f(1.0);
  if (fit == 0u) {
    if (imageAspect > frameAspect) { scale.x = frameAspect / imageAspect; }
    else { scale.y = imageAspect / frameAspect; }
  } else {
    if (imageAspect > frameAspect) { scale.y = imageAspect / frameAspect; }
    else { scale.x = frameAspect / imageAspect; }
  }
  return (uv - vec2f(0.5)) * scale + vec2f(0.5);
}
fn imageTone(uv: vec2f) -> f32 {
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 0.0; }
  let sampled = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  return dot(sampled.rgb, vec3f(0.2126, 0.7152, 0.0722));
}
`,
    fragment: (p) => `
  let uv = imageUv(input.uv);
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return vec4f(0.0); }
  let image = textureSampleLevel(sourceTexture, effectSampler, uv, 0.0);
  if (image.a <= 0.00001) { return vec4f(0.0); }
  let unit = globals.clock.z * globals.viewport.zw;
  let du = vec2f(unit.x, 0.0);
  let dv = vec2f(0.0, unit.y);
  let dx = imageTone(uv + du) - imageTone(uv - du);
  let dy = imageTone(uv + dv) - imageTone(uv - dv);
  let angle = ${p("lightAzimuth")}.x * 0.01745329252;
  let illumination = clamp(0.72 + ${p("relief")}.x * (dx * cos(angle) + dy * sin(angle)) * 2.5, 0.25, 1.25);
  let level = clamp(imageTone(uv), 0.0, 1.0) * ${p("bands")}.x;
  let line = 1.0 - smoothstep(0.0, 0.08, min(fract(level), 1.0 - fract(level)));
  let terrace = floor(level) / max(${p("bands")}.x - 1.0, 1.0);
  let straightImage = image.rgb / max(image.a, 0.00001);
  let sculpted = straightImage * illumination * mix(1.0, 0.65 + 0.35 * terrace, ${p("relief")}.x);
  let inked = sculpted * (1.0 - line * ${p("contour")}.x);
  return vec4f(mix(image.rgb, inked * image.a, ${p("amount")}.x), image.a);`,
    looks: [
      [
        "Soft Topography",
        { bands: 8, contour: 0.22, relief: 0.35, lightAzimuth: -40 },
      ],
      [
        "Etched Elevation",
        { bands: 16, contour: 0.75, relief: 0.85, lightAzimuth: 60 },
      ],
    ],
  },
  {
    id: "owned-j-surround-reflectance",
    name: "Surround Reflectance",
    mechanism:
      "Two bounded spatial luminance surrounds separate local reflectance from illumination by a logarithmic ratio, rather than adding an edge-sharpening residual.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      nearRadius: pixel("Near surround", 3, 16),
      farRadius: pixel("Far surround", 18, 60),
      surroundMix: fraction("Far balance", 0.5),
      compression: fraction("Light compression", 0.65),
      amount: fraction("Reflectance amount", 0.8),
    },
    helpers: () => `
fn logTone(uv: vec2f) -> vec2f {
  let sampled = sampleSource(uv);
  if (sampled.a <= 0.00001) { return vec2f(0.0); }
  return vec2f(log(max(luminance(straight(sampled)), 0.0001)) * sampled.a, sampled.a);
}
fn surround(uv: vec2f, radius: f32, center: f32) -> f32 {
  let d = radius * globals.clock.z * globals.viewport.zw;
  let sum = logTone(uv + vec2f(d.x, 0.0)) + logTone(uv - vec2f(d.x, 0.0)) +
    logTone(uv + vec2f(0.0, d.y)) + logTone(uv - vec2f(0.0, d.y));
  return select(center, sum.x / max(sum.y, 0.00001), sum.y > 0.00001);
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let center = log(max(luminance(straight(original)), 0.0001));
  let near = surround(input.uv, ${p("nearRadius")}.x, center);
  let far = surround(input.uv, ${p("farRadius")}.x, center);
  let illumination = mix(near, far, ${p("surroundMix")}.x);
  let factor = clamp(exp((center - illumination) * ${p("compression")}.x), 0.25, 4.0);
  return premultiply(straight(original) * mix(1.0, factor, ${p("amount")}.x), original.a);`,
    looks: [
      [
        "Open Shadows",
        { nearRadius: 2, farRadius: 14, surroundMix: 0.6, compression: 0.45 },
      ],
      [
        "Reflectance Study",
        {
          nearRadius: 6,
          farRadius: 38,
          surroundMix: 0.7,
          compression: 0.85,
          amount: 1,
        },
      ],
    ],
  },
  {
    id: "owned-j-morphological-top-hat",
    name: "Bright Feature Top-Hat",
    mechanism:
      "A five-point cross erosion followed by cross dilation forms a true bounded morphological opening; the positive source-minus-opening residual isolates bright details by shape rather than a Gaussian frequency band.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: pixel("Feature radius", 2, 10),
      threshold: fraction("Feature threshold", 0.12),
      tint: {
        type: "color",
        label: "Feature tint",
        default: catalogColor(0.97, 0.78, 0.36),
      },
      amount: fraction("Feature emphasis", 0.8),
    },
    helpers: () => `
fn featureTone(uv: vec2f) -> f32 {
  let sampled = sampleSource(uv);
  if (sampled.a <= 0.00001) { return 0.0; }
  return luminance(straight(sampled)) * sampled.a;
}
fn crossErosion(uv: vec2f, d: vec2f) -> f32 {
  var lowest = featureTone(uv);
  lowest = min(lowest, featureTone(uv + vec2f(d.x, 0.0)));
  lowest = min(lowest, featureTone(uv - vec2f(d.x, 0.0)));
  lowest = min(lowest, featureTone(uv + vec2f(0.0, d.y)));
  lowest = min(lowest, featureTone(uv - vec2f(0.0, d.y)));
  return lowest;
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let d = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  var opening = crossErosion(input.uv, d);
  opening = max(opening, crossErosion(input.uv + vec2f(d.x, 0.0), d));
  opening = max(opening, crossErosion(input.uv - vec2f(d.x, 0.0), d));
  opening = max(opening, crossErosion(input.uv + vec2f(0.0, d.y), d));
  opening = max(opening, crossErosion(input.uv - vec2f(0.0, d.y), d));
  let residual = max(featureTone(input.uv) - opening - ${p("threshold")}.x, 0.0);
  let weight = clamp(residual * 3.0, 0.0, 1.0) * ${p("amount")}.x * ${p("tint")}.a;
  return premultiply(mix(straight(original), ${p("tint")}.rgb, weight), original.a);`,
    looks: [
      ["Small Highlights", { radius: 1.5, threshold: 0.08, amount: 0.65 }],
      ["Glint Extraction", { radius: 5, threshold: 0.03, amount: 1 }],
    ],
  },
  {
    id: "owned-j-harris-corner-marks",
    name: "Harris Corner Marks",
    mechanism:
      "A local gradient tensor uses determinant minus k times squared trace to select two-direction corners, rejecting one-direction stripes rather than merely coloring tensor orientation.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      radius: pixel("Corner radius", 2, 10),
      response: fraction("Corner threshold", 0.12),
      markSize: pixel("Mark size", 2, 10),
      tint: {
        type: "color",
        label: "Mark tint",
        default: catalogColor(0.96, 0.34, 0.12),
      },
      amount: fraction("Mark amount", 0.9),
    },
    helpers: () => `
fn cornerTone(uv: vec2f) -> f32 {
  let sampled = sampleSource(uv);
  return luminance(straight(sampled)) * sampled.a;
}
fn cornerGradient(uv: vec2f, d: vec2f) -> vec2f {
  return vec2f(cornerTone(uv + vec2f(d.x, 0.0)) - cornerTone(uv - vec2f(d.x, 0.0)),
    cornerTone(uv + vec2f(0.0, d.y)) - cornerTone(uv - vec2f(0.0, d.y))) * 0.5;
}
`,
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (original.a <= 0.00001 || ${p("amount")}.x <= 0.0) { return original; }
  let d = ${p("radius")}.x * globals.clock.z * globals.viewport.zw;
  let a = cornerGradient(input.uv + vec2f(-d.x, -d.y), d);
  let b = cornerGradient(input.uv + vec2f(d.x, -d.y), d);
  let c = cornerGradient(input.uv + vec2f(-d.x, d.y), d);
  let e = cornerGradient(input.uv + vec2f(d.x, d.y), d);
  let xx = (a.x*a.x + b.x*b.x + c.x*c.x + e.x*e.x) * 0.25;
  let xy = (a.x*a.y + b.x*b.y + c.x*c.y + e.x*e.y) * 0.25;
  let yy = (a.y*a.y + b.y*b.y + c.y*c.y + e.y*e.y) * 0.25;
  let trace = xx + yy;
  let response = max((xx * yy - xy * xy) - 0.04 * trace * trace, 0.0);
  let strength = clamp(response * 48.0 - ${p("response")}.x, 0.0, 1.0);
  let pixel = input.uv * globals.viewport.xy / max(globals.clock.z, 0.01);
  let grid = max(${p("markSize")}.x * 3.0, 1.0);
  let marker = 1.0 - smoothstep(0.12, 0.38, length(fract(pixel / grid) - vec2f(0.5)));
  let weight = strength * marker * ${p("amount")}.x * ${p("tint")}.a;
  return premultiply(mix(straight(original), ${p("tint")}.rgb, weight), original.a);`,
    looks: [
      [
        "Architectural Points",
        { radius: 1.5, response: 0.08, markSize: 1.5, amount: 0.75 },
      ],
      [
        "Dense Corner Map",
        { radius: 4, response: 0.02, markSize: 4, amount: 1 },
      ],
    ],
  },
  {
    id: "owned-j-microlens-grid",
    name: "Microlens Grid",
    mechanism:
      "Each independently bounded cell samples the source through a radial miniature lens and shades its rim; it changes local image coordinates instead of applying a single global pinch or color-site mosaic.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      pitch: pixel("Lens pitch", 30, 120),
      curvature: fraction("Lens curvature", 0.55),
      rim: fraction("Rim shading", 0.28),
      amount: fraction("Lens amount", 0.85),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  if (${p("amount")}.x <= 0.0) { return original; }
  let pitch = max(${p("pitch")}.x * globals.clock.z, 1.0);
  let pixel = input.uv * globals.viewport.xy;
  let cell = floor(pixel / pitch) + vec2f(0.5);
  let local = (pixel / pitch - cell) * 2.0;
  let radius2 = dot(local, local);
  if (radius2 >= 1.0) { return original; }
  let compression = 1.0 - ${p("curvature")}.x * (1.0 - radius2) * 0.45;
  let mapped = (cell * pitch + local * 0.5 * pitch * compression) * globals.viewport.zw;
  let refracted = sampleSource(mapped);
  let illumination = 1.0 - ${p("rim")}.x * smoothstep(0.55, 1.0, sqrt(radius2));
  let lens = vec4f(refracted.rgb * illumination, refracted.a);
  return mix(original, lens, ${p("amount")}.x);`,
    looks: [
      [
        "Fine Lenslets",
        { pitch: 18, curvature: 0.32, rim: 0.12, amount: 0.75 },
      ],
      ["Deep Glass Cells", { pitch: 70, curvature: 0.9, rim: 0.6, amount: 1 }],
    ],
  },
  {
    id: "owned-j-waterline-mirror",
    name: "Waterline Mirror",
    mechanism:
      "A movable horizon separates untouched image from a vertically reflected sample field, with horizontal displacement growing by depth and independently controlled attenuation.",
    properties: {
      edge: structuredClone(CATALOG_EDGE),
      horizon: fraction("Horizon", 0.5),
      wavelength: pixel("Wave length", 48, 180),
      amplitude: pixel("Wave amplitude", 7, 28),
      attenuation: fraction("Depth attenuation", 0.35),
      phase: catalogFloat("Wave phase", 0, -6.28, 6.28),
      amount: fraction("Reflection amount", 1),
    },
    fragment: (p) => `
  let original = sampleSource(input.uv);
  let depth = input.uv.y - ${p("horizon")}.x;
  if (depth <= 0.0 || ${p("amount")}.x <= 0.0) { return original; }
  let wavelength = max(${p("wavelength")}.x * globals.clock.z, 1.0);
  let phase = input.uv.x * globals.viewport.x / wavelength * TAU + depth * 14.0 + ${p("phase")}.x;
  let wave = sin(phase) * ${p("amplitude")}.x * globals.clock.z * globals.viewport.z;
  let mapped = vec2f(input.uv.x + wave * clamp(depth * 3.0, 0.0, 1.0), 2.0 * ${p("horizon")}.x - input.uv.y);
  let reflected = sampleSource(mapped);
  let fade = 1.0 - ${p("attenuation")}.x * clamp(depth / max(1.0 - ${p("horizon")}.x, 0.0001), 0.0, 1.0);
  return mix(original, vec4f(reflected.rgb * fade, reflected.a), ${p("amount")}.x);`,
    looks: [
      [
        "Still Shore",
        { horizon: 0.57, wavelength: 95, amplitude: 2, attenuation: 0.18 },
      ],
      [
        "Ruffled Reflection",
        {
          horizon: 0.42,
          wavelength: 25,
          amplitude: 14,
          attenuation: 0.6,
          phase: 1.3,
        },
      ],
    ],
  },
];

const definitionFor = (draft: Draft): EffectDefinition => {
  const definition = catalogShader({
    ...draft,
    kind: draft.assetFill ? "generator" : "processor",
    backdrop: !draft.assetFill,
  });
  return {
    ...definition,
    ...(draft.assetFill
      ? {
          inputs: { image: { kind: "texture-2d", resource: "image" } },
          resources: [
            {
              name: "image",
              kind: "texture-2d",
              usage: ["sampled"],
              external: true,
              size: "viewport",
              sampleEncoding: "srgb-color-premultiplied",
            },
            {
              name: "color",
              kind: "texture-2d",
              format: "rgba16float",
              usage: ["render", "sampled"],
              size: "viewport",
            },
          ],
          passes: definition.passes.map((pass) => ({
            ...pass,
            reads: ["image"],
          })),
        }
      : {
          resources: definition.resources?.map((resource) =>
            resource.name === "color"
              ? { ...resource, format: "rgba16float" }
              : resource,
          ),
        }),
    provenance: { origin: "design-original", note: draft.mechanism },
  } as EffectDefinition;
};

export const OWNED_NEXT_SIX_J_DEFINITIONS: readonly EffectDefinition[] =
  OWNED_NEXT_SIX_J_DRAFTS.map(definitionFor);
export const OWNED_NEXT_SIX_J_PRESETS: readonly EffectPreset[] =
  OWNED_NEXT_SIX_J_DRAFTS.flatMap((draft) =>
    draft.looks.map(([name, params], index) => ({
      id: `an-preset-${draft.id}-${index + 1}`,
      name,
      definitionId: `an-native-${draft.id}`,
      definitionVersion: 1,
      placement: (draft.assetFill ? "fill" : "layer") as "fill" | "layer",
      params,
      clip: "bounds" as const,
      provenance: { origin: "design-original" as const },
    })),
  );
