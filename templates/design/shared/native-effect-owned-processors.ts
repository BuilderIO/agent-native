import { CATALOG_EDGE, catalogShader } from "./native-effect-catalog-kit";
import type {
  EffectDefinition,
  EffectPreset,
  EffectProperty,
} from "./native-effects";

type ProcessorSpec = {
  id: string;
  name: string;
  controls: Record<string, EffectProperty>;
  fragment: (property: (name: string) => string) => string;
  looks: [string, Record<string, number>, string, Record<string, number>];
};

const amount = (label: string, value: number, max = 2): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.01,
});
const distance = (label: string, value: number, max = 32): EffectProperty => ({
  type: "float",
  label,
  default: value,
  min: 0,
  max,
  step: 0.1,
  unit: "px",
});
const speed = (): EffectProperty => ({
  type: "float",
  label: "Speed",
  default: 0.5,
  min: 0,
  max: 3,
  step: 0.01,
});

const specs: ProcessorSpec[] = [
  {
    id: "directional-smear",
    name: "Directional Smear",
    controls: {
      reach: distance("Reach", 9, 36),
      angle: amount("Angle", 0.15, 6.28),
      mix: amount("Blend", 0.7, 1),
    },
    fragment: (
      p,
    ) => `let direction = vec2f(cos(${p("angle")}.x), sin(${p("angle")}.x)) * ${p("reach")}.x * globals.clock.z * globals.viewport.zw;
var sum = vec4f(0.0); for (var i = 0u; i < 13u; i += 1u) { let t = f32(i) / 12.0 - 0.5; sum += sampleSource(input.uv + direction * t); }
return mix(sampleSource(input.uv), sum / 13.0, ${p("mix")}.x);`,
    looks: [
      "Soft motion",
      { reach: 7, mix: 0.65 },
      "Long exposure",
      { reach: 24, mix: 0.9 },
    ],
  },
  {
    id: "radial-echo",
    name: "Radial Echo",
    controls: {
      reach: distance("Reach", 13, 48),
      mix: amount("Blend", 0.7, 1),
    },
    fragment: (
      p,
    ) => `let center = vec2f(0.5); let ray = input.uv - center; var sum = vec4f(0.0);
for (var i = 0u; i < 11u; i += 1u) { let t = f32(i) / 10.0; let displacement = ${p("reach")}.x * globals.clock.z * globals.viewport.zw * t; sum += sampleSource(input.uv - ray * displacement * 3.0); }
return mix(sampleSource(input.uv), sum / 11.0, ${p("mix")}.x);`,
    looks: [
      "Near echo",
      { reach: 9, mix: 0.5 },
      "Far echo",
      { reach: 34, mix: 0.9 },
    ],
  },
  {
    id: "tilt-focus",
    name: "Tilt Focus",
    controls: {
      radius: distance("Blur", 10, 24),
      focus: amount("Focus line", 0.5, 1),
      width: amount("Focus width", 0.2, 1),
    },
    fragment: (
      p,
    ) => `let away = abs(input.uv.y - ${p("focus")}.x); let weight = smoothstep(${p("width")}.x * 0.5, ${p("width")}.x * 0.5 + 0.25, away);
let stepUv = vec2f(${p("radius")}.x * globals.clock.z * globals.viewport.z, 0.0); var sum = vec4f(0.0);
for (var i = 0u; i < 9u; i += 1u) { sum += sampleSource(input.uv + stepUv * (f32(i) - 4.0) * 0.25); }
return mix(sampleSource(input.uv), sum / 9.0, weight);`,
    looks: [
      "Narrow plane",
      { width: 0.09, radius: 13 },
      "Wide plane",
      { width: 0.38, radius: 7 },
    ],
  },
  {
    id: "edge-ink",
    name: "Edge Ink",
    controls: {
      width: distance("Width", 1.5, 6),
      strength: amount("Strength", 0.8, 2),
    },
    fragment: (
      p,
    ) => `let d = ${p("width")}.x * globals.clock.z * globals.viewport.zw; let c = sampleSource(input.uv);
let gx = luminance(straight(sampleSource(input.uv + vec2f(d.x, 0.0)))) - luminance(straight(sampleSource(input.uv - vec2f(d.x, 0.0))));
let gy = luminance(straight(sampleSource(input.uv + vec2f(0.0, d.y)))) - luminance(straight(sampleSource(input.uv - vec2f(0.0, d.y))));
let ink = clamp(length(vec2f(gx, gy)) * ${p("strength")}.x, 0.0, 1.0); return vec4f(c.rgb * (1.0 - ink), c.a);`,
    looks: [
      "Fine outline",
      { width: 0.8, strength: 0.55 },
      "Bold outline",
      { width: 3, strength: 1.6 },
    ],
  },
  {
    id: "edge-neon",
    name: "Edge Neon",
    controls: { width: distance("Width", 2, 8), glow: amount("Glow", 0.8, 3) },
    fragment: (
      p,
    ) => `let d = ${p("width")}.x * globals.clock.z * globals.viewport.zw; let c = sampleSource(input.uv);
let gx = sampleSource(input.uv + vec2f(d.x, 0.0)).rgb - sampleSource(input.uv - vec2f(d.x, 0.0)).rgb;
let gy = sampleSource(input.uv + vec2f(0.0, d.y)).rgb - sampleSource(input.uv - vec2f(0.0, d.y)).rgb;
let rim = length(gx) + length(gy); return vec4f(min(c.rgb + vec3f(rim * ${p("glow")}.x * c.a), vec3f(c.a)), c.a);`,
    looks: [
      "Quiet glow",
      { glow: 0.45, width: 1 },
      "Electric rim",
      { glow: 2.1, width: 4 },
    ],
  },
  {
    id: "emboss-light",
    name: "Emboss Light",
    controls: {
      depth: amount("Depth", 0.5, 2),
      angle: amount("Light angle", 0.6, 6.28),
    },
    fragment: (
      p,
    ) => `let d = vec2f(cos(${p("angle")}.x), sin(${p("angle")}.x)) * globals.viewport.zw * globals.clock.z;
let hi = luminance(straight(sampleSource(input.uv + d))); let lo = luminance(straight(sampleSource(input.uv - d)));
let c = sampleSource(input.uv); return vec4f(clamp(c.rgb + vec3f((hi - lo) * ${p("depth")}.x * c.a), vec3f(0.0), vec3f(c.a)), c.a);`,
    looks: [
      "Pressed",
      { depth: 0.4, angle: 0.7 },
      "Raised",
      { depth: 1.3, angle: 3.8 },
    ],
  },
  {
    id: "bevel-light",
    name: "Bevel Light",
    controls: {
      width: distance("Width", 3, 12),
      shine: amount("Shine", 0.6, 2),
    },
    fragment: (
      p,
    ) => `let d = ${p("width")}.x * globals.clock.z * globals.viewport.zw; let c = sampleSource(input.uv);
let diagonal = sampleSource(input.uv + d).a - sampleSource(input.uv - d).a;
return vec4f(clamp(c.rgb + vec3f(diagonal * ${p("shine")}.x * c.a), vec3f(0.0), vec3f(c.a)), c.a);`,
    looks: [
      "Soft bevel",
      { width: 2, shine: 0.4 },
      "Cut bevel",
      { width: 8, shine: 1.3 },
    ],
  },
  {
    id: "heat-haze",
    name: "Heat Haze",
    controls: {
      amplitude: distance("Amplitude", 4, 18),
      frequency: amount("Frequency", 11, 40),
      speed: speed(),
    },
    fragment: (
      p,
    ) => `let phase = input.uv.y * ${p("frequency")}.x + globals.clock.x * ${p("speed")}.x;
let offset = sin(phase * 6.2831853) * ${p("amplitude")}.x * globals.clock.z * globals.viewport.z;
return sampleSource(input.uv + vec2f(offset, 0.0));`,
    looks: [
      "Warm air",
      { amplitude: 2, frequency: 7 },
      "Desert air",
      { amplitude: 10, frequency: 20 },
    ],
  },
  {
    id: "water-ring",
    name: "Water Ring",
    controls: {
      amplitude: distance("Amplitude", 5, 20),
      frequency: amount("Rings", 15, 45),
      speed: speed(),
    },
    fragment: (
      p,
    ) => `let centered = input.uv - vec2f(0.5); let r = length(centered * globals.viewport.xy / min(globals.viewport.x, globals.viewport.y));
let wave = sin(r * ${p("frequency")}.x * 6.2831853 - globals.clock.x * ${p("speed")}.x * 5.0);
let displacement = normalize(centered + vec2f(0.00001)) * wave * ${p("amplitude")}.x * globals.clock.z * globals.viewport.zw;
return sampleSource(input.uv + displacement);`,
    looks: [
      "Gentle rings",
      { amplitude: 2, frequency: 9 },
      "Deep rings",
      { amplitude: 12, frequency: 27 },
    ],
  },
  {
    id: "glass-blocks",
    name: "Glass Blocks",
    controls: {
      cells: amount("Cells", 12, 64),
      refraction: amount("Refraction", 0.5, 2),
    },
    fragment: (
      p,
    ) => `let count = max(${p("cells")}.x, 1.0); let local = fract(input.uv * count) - vec2f(0.5);
let curve = local * dot(local, local) * ${p("refraction")}.x / count;
return sampleSource(input.uv + curve);`,
    looks: [
      "Small panes",
      { cells: 24, refraction: 0.7 },
      "Heavy glass",
      { cells: 8, refraction: 1.6 },
    ],
  },
  {
    id: "chromatic-drift",
    name: "Chromatic Drift",
    controls: {
      separation: distance("Separation", 4, 24),
      angle: amount("Angle", 0.0, 6.28),
    },
    fragment: (
      p,
    ) => `let d = vec2f(cos(${p("angle")}.x), sin(${p("angle")}.x)) * ${p("separation")}.x * globals.clock.z * globals.viewport.zw;
let a = sampleSource(input.uv - d); let b = sampleSource(input.uv); let c = sampleSource(input.uv + d);
return vec4f(a.r, b.g, c.b, max(a.a, max(b.a, c.a)));`,
    looks: [
      "Fine drift",
      { separation: 1.5 },
      "Wide drift",
      { separation: 13 },
    ],
  },
  {
    id: "prism-split",
    name: "Prism Split",
    controls: {
      separation: distance("Separation", 6, 25),
      rotation: amount("Rotation", 0.5, 6.28),
    },
    fragment: (
      p,
    ) => `let r = ${p("separation")}.x * globals.clock.z * globals.viewport.zw; let angle = ${p("rotation")}.x;
let a = sampleSource(input.uv + r * vec2f(cos(angle), sin(angle)));
let b = sampleSource(input.uv + r * vec2f(cos(angle + 2.094395), sin(angle + 2.094395)));
let c = sampleSource(input.uv + r * vec2f(cos(angle + 4.18879), sin(angle + 4.18879)));
return vec4f(a.r, b.g, c.b, max(a.a, max(b.a, c.a)));`,
    looks: ["Glass edge", { separation: 2 }, "Triad", { separation: 15 }],
  },
  {
    id: "lens-pinch",
    name: "Lens Pinch",
    controls: {
      strength: amount("Strength", 0.6, 2),
      radius: amount("Radius", 0.42, 1),
    },
    fragment: (
      p,
    ) => `let q = input.uv - vec2f(0.5); let r = length(q * globals.viewport.xy / min(globals.viewport.x, globals.viewport.y));
let influence = 1.0 - smoothstep(0.0, max(${p("radius")}.x, 0.0001), r); let scale = 1.0 + ${p("strength")}.x * influence * influence;
return sampleSource(vec2f(0.5) + q / scale);`,
    looks: [
      "Subtle lens",
      { strength: 0.3, radius: 0.55 },
      "Deep lens",
      { strength: 1.5, radius: 0.35 },
    ],
  },
  {
    id: "ribbon-warp",
    name: "Ribbon Warp",
    controls: {
      amplitude: distance("Amplitude", 10, 35),
      folds: amount("Folds", 5, 20),
      speed: speed(),
    },
    fragment: (
      p,
    ) => `let phase = input.uv.x * ${p("folds")}.x * 6.2831853 + globals.clock.x * ${p("speed")}.x;
let y = sin(phase) * sin(phase * 0.37 + 1.2) * ${p("amplitude")}.x * globals.clock.z * globals.viewport.w;
return sampleSource(input.uv + vec2f(0.0, y));`,
    looks: [
      "Silk fold",
      { amplitude: 5, folds: 3 },
      "Ribbon current",
      { amplitude: 23, folds: 9 },
    ],
  },
  {
    id: "pixel-shift",
    name: "Pixel Shift",
    controls: {
      rowHeight: distance("Row height", 8, 48),
      shift: distance("Shift", 9, 40),
      rate: speed(),
    },
    fragment: (
      p,
    ) => `let row = floor(input.uv.y * globals.viewport.y / max(${p("rowHeight")}.x * globals.clock.z, 1.0));
let beat = floor(globals.clock.x * ${p("rate")}.x * 8.0); let n = random(vec2i(i32(row), i32(beat)));
let x = (n - 0.5) * 2.0 * ${p("shift")}.x * globals.clock.z * globals.viewport.z;
return sampleSource(input.uv + vec2f(x, 0.0));`,
    looks: [
      "Quiet skip",
      { shift: 3, rowHeight: 16 },
      "Frame jump",
      { shift: 25, rowHeight: 5 },
    ],
  },
  {
    id: "ink-bleed",
    name: "Ink Bleed",
    controls: {
      radius: distance("Spread", 3, 12),
      strength: amount("Strength", 0.6, 1),
    },
    fragment: (
      p,
    ) => `let d = ${p("radius")}.x * globals.clock.z * globals.viewport.zw; let c = sampleSource(input.uv);
var neighbor = vec4f(0.0); for (var i = 0u; i < 8u; i += 1u) { let a = f32(i) * 0.785398163; let s = sampleSource(input.uv + vec2f(cos(a), sin(a)) * d); if (s.a > neighbor.a) { neighbor = s; } }
return mix(c, neighbor, ${p("strength")}.x * (1.0 - c.a));`,
    looks: [
      "Light bleed",
      { radius: 2, strength: 0.35 },
      "Heavy bleed",
      { radius: 9, strength: 0.9 },
    ],
  },
  {
    id: "soft-threshold",
    name: "Soft Threshold",
    controls: {
      threshold: amount("Threshold", 0.5, 1),
      softness: amount("Softness", 0.18, 0.5),
    },
    fragment: (
      p,
    ) => `let c = sampleSource(input.uv); let light = luminance(straight(c));
let amount = smoothstep(${p("threshold")}.x - ${p("softness")}.x, ${p("threshold")}.x + ${p("softness")}.x + 0.0001, light);
return vec4f(vec3f(amount) * c.a, c.a);`,
    looks: [
      "Soft cut",
      { threshold: 0.42, softness: 0.25 },
      "Hard cut",
      { threshold: 0.65, softness: 0.03 },
    ],
  },
  {
    id: "tone-ripple",
    name: "Tone Ripple",
    controls: {
      bands: amount("Bands", 8, 30),
      strength: amount("Strength", 0.25, 1),
      speed: speed(),
    },
    fragment: (
      p,
    ) => `let c = sampleSource(input.uv); let light = luminance(straight(c));
let phase = light * ${p("bands")}.x * 6.2831853 + globals.clock.x * ${p("speed")}.x;
let gain = 1.0 + sin(phase) * ${p("strength")}.x;
return vec4f(clamp(c.rgb * gain, vec3f(0.0), vec3f(c.a)), c.a);`,
    looks: [
      "Low tide",
      { bands: 5, strength: 0.1 },
      "Bright rings",
      { bands: 15, strength: 0.5 },
    ],
  },
  {
    id: "detail-boost",
    name: "Detail Boost",
    controls: {
      radius: distance("Radius", 2, 8),
      amount: amount("Amount", 0.7, 3),
    },
    fragment: (
      p,
    ) => `let d = ${p("radius")}.x * globals.clock.z * globals.viewport.zw; let c = sampleSource(input.uv);
let blur = (sampleSource(input.uv + vec2f(d.x, 0.0)) + sampleSource(input.uv - vec2f(d.x, 0.0)) + sampleSource(input.uv + vec2f(0.0, d.y)) + sampleSource(input.uv - vec2f(0.0, d.y))) * 0.25;
return vec4f(clamp(c.rgb + (c.rgb - blur.rgb) * ${p("amount")}.x, vec3f(0.0), vec3f(c.a)), c.a);`,
    looks: [
      "Fine detail",
      { radius: 1, amount: 0.4 },
      "Crisp detail",
      { radius: 4, amount: 1.8 },
    ],
  },
  {
    id: "shadow-lift",
    name: "Shadow Lift",
    controls: { lift: amount("Lift", 0.25, 1), pivot: amount("Pivot", 0.4, 1) },
    fragment: (
      p,
    ) => `let c = sampleSource(input.uv); let light = luminance(straight(c));
let shadow = 1.0 - smoothstep(0.0, max(${p("pivot")}.x, 0.0001), light);
return vec4f(min(c.rgb + vec3f(shadow * ${p("lift")}.x * c.a), vec3f(c.a)), c.a);`,
    looks: [
      "Open shadows",
      { lift: 0.16, pivot: 0.5 },
      "Night recovery",
      { lift: 0.55, pivot: 0.3 },
    ],
  },
];

export const OWNED_PROCESSOR_DEFINITIONS: EffectDefinition[] = specs.map(
  (spec) => {
    const definition = catalogShader({
      id: `owned-${spec.id}`,
      name: spec.name,
      kind: "processor",
      backdrop: true,
      properties: { edge: structuredClone(CATALOG_EDGE), ...spec.controls },
      fragment: spec.fragment,
    });
    return {
      ...definition,
      provenance: {
        origin: "design-original",
        note: "Original Design processor with bounded source sampling and premultiplied working color.",
      },
    };
  },
);

export const OWNED_PROCESSOR_PRESETS: EffectPreset[] = specs.flatMap((spec) => {
  const [firstName, firstParams, secondName, secondParams] = spec.looks;
  const make = (
    name: string,
    params: Record<string, number>,
    variant: string,
  ): EffectPreset => ({
    id: `an-preset-owned-${spec.id}-${variant}`,
    name,
    definitionId: `an-native-owned-${spec.id}`,
    definitionVersion: 1,
    placement: "layer",
    params,
    clip: "bounds",
    provenance: { origin: "design-original" },
  });
  return [
    make(firstName, firstParams, "soft"),
    make(secondName, secondParams, "bold"),
  ];
});
