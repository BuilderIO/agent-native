import { NATIVE_RENDER_GLOBALS } from "./native-effect-wgsl";
import type { EffectDefinition, EffectPreset } from "./native-effects";

const color = (components: [number, number, number], alpha = 1) => ({
  space: "srgb" as const,
  components,
  alpha,
});

const wgsl = `${NATIVE_RENDER_GLOBALS}
fn strandHash(value: f32) -> f32 {
  return fract(sin(value * 127.1 + globals.clock.y * 19.7) * 43758.5453);
}
@fragment fn fs(input: VertexOutput) -> @location(0) vec4f {
  let cssSize = globals.viewport.xy / globals.clock.z;
  let point = input.uv * cssSize;
  let start = globals.params[0].xy * cssSize;
  let end = globals.params[1].xy * cssSize;
  let segment = end - start;
  let segmentLength = max(length(segment), 1.0);
  let tangent = segment / segmentLength;
  let normal = vec2f(-tangent.y, tangent.x);
  let progress = clamp(dot(point - start, tangent) / segmentLength, 0.0, 1.0);
  let centeredIndex = (globals.params[2].x - 1.0) * 0.5;
  let width = globals.params[3].x;
  let spacing = globals.params[4].x;
  let bend = clamp(globals.params[5].x, -segmentLength * 0.35, segmentLength * 0.35);
  let wave = globals.params[6].x;
  let baseline = start + tangent * (progress * segmentLength);
  let reach = centeredIndex * spacing + abs(bend) + wave + width * 0.5 + spacing;
  if (length(point - baseline) > reach) { return vec4f(0.0); }
  let speed = globals.params[7].x;
  let travel = select(-1.0, 1.0, globals.params[8].x < 0.5);
  let time = globals.clock.x * speed * travel;
  let aa = max(0.5 / globals.clock.z, 0.1);
  var result = vec4f(0.0);
  for (var index = 0u; index < 24u; index += 1u) {
    if (f32(index) >= globals.params[2].x) { break; }
    let strand = f32(index);
    let jitter = (strandHash(strand + 1.0) - 0.5) * spacing * 0.16;
    let phase = progress * 12.5663706 - time + strand * 0.62;
    let motion = sin(phase) * wave * sin(progress * 3.14159265);
    let center = start + tangent * (progress * segmentLength)
      + normal * ((strand - centeredIndex) * spacing + jitter + bend * sin(progress * 3.14159265) + motion);
    let distance = length(point - center);
    let coverage = 1.0 - smoothstep(max(width * 0.5 - aa, 0.0), width * 0.5 + aa, distance);
    let blend = clamp(progress * 0.7 + strand / max(globals.params[2].x - 1.0, 1.0) * 0.3, 0.0, 1.0);
    let base = mix(globals.params[9], globals.params[10], blend);
    let accent = pow(0.5 + 0.5 * sin(phase * 0.53 + strand * 2.4), 3.0) * 0.42;
    let ribbon = mix(base, globals.params[11], accent);
    let alpha = ribbon.a * globals.params[12].x * coverage;
    let premultiplied = ribbon.rgb * alpha;
    result = vec4f(premultiplied + result.rgb * (1.0 - alpha), alpha + result.a * (1.0 - alpha));
  }
  return result;
}`;

export const DIRECTED_STRANDS_EFFECT: EffectDefinition = {
  id: "an-native-owned-ci-directed-strands",
  name: "Directed Strands",
  version: 1,
  kind: "generator",
  placements: ["fill"],
  properties: {
    start: {
      type: "vec2",
      label: "Path start",
      default: [0.12, 0.25],
      min: 0,
      max: 1,
    },
    end: {
      type: "vec2",
      label: "Path end",
      default: [0.88, 0.74],
      min: 0,
      max: 1,
    },
    strands: {
      type: "int",
      label: "Strands",
      default: 9,
      min: 1,
      max: 24,
      step: 1,
    },
    width: {
      type: "float",
      label: "Strand width",
      default: 5,
      min: 0.5,
      max: 30,
      step: 0.5,
    },
    spacing: {
      type: "float",
      label: "Strand spacing",
      default: 12,
      min: 2,
      max: 45,
      step: 0.5,
    },
    bend: {
      type: "float",
      label: "Path bend",
      default: 35,
      min: -120,
      max: 120,
      step: 1,
    },
    wave: {
      type: "float",
      label: "Strand wave",
      default: 5,
      min: 0,
      max: 24,
      step: 0.5,
    },
    speed: {
      type: "float",
      label: "Flow speed",
      default: 1,
      min: 0,
      max: 4,
      step: 0.05,
    },
    travel: {
      type: "enum",
      label: "Flow direction",
      default: "Forward",
      options: ["Forward", "Reverse"],
    },
    colorA: {
      type: "color",
      label: "Start color",
      default: color([0.09, 0.69, 0.85]),
    },
    colorB: {
      type: "color",
      label: "End color",
      default: color([0.75, 0.26, 0.92]),
    },
    colorC: {
      type: "color",
      label: "Accent color",
      default: color([1, 0.75, 0.33]),
    },
    opacity: {
      type: "float",
      label: "Opacity",
      default: 1,
      min: 0,
      max: 1,
      step: 0.01,
    },
  },
  outputs: { color: { kind: "texture-2d", resource: "color" } },
  resources: [
    {
      name: "color",
      kind: "texture-2d",
      format: "rgba16float",
      usage: ["render", "sampled"],
      size: "viewport",
    },
  ],
  resourceGraph: { abi: "linear-resource-v1" },
  passes: [
    {
      id: "draw-directed-strands",
      kind: "render",
      reads: [],
      output: "color",
      wgsl,
    },
  ],
  output: "color",
  provenance: {
    origin: "design-original",
    note: "A bounded set of premultiplied multicolor ribbons follows an editable start-to-end path with deterministic strand offsets, directed wave motion, and CSS-pixel geometry.",
  },
};

export const DIRECTED_STRANDS_PRESETS: readonly EffectPreset[] = [
  {
    id: "an-preset-ci-rising-stream",
    name: "Rising Stream",
    definitionId: DIRECTED_STRANDS_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      start: [0.18, 0.9],
      end: [0.8, 0.12],
      strands: 12,
      width: 3.5,
      spacing: 10,
      bend: -42,
      wave: 7,
      speed: 1.4,
      travel: "Forward",
      colorA: color([0.08, 0.72, 0.76]),
      colorB: color([0.27, 0.34, 0.92]),
      colorC: color([0.94, 0.91, 0.5]),
      opacity: 0.94,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
  {
    id: "an-preset-ci-horizontal-braid",
    name: "Horizontal Braid",
    definitionId: DIRECTED_STRANDS_EFFECT.id,
    definitionVersion: 1,
    placement: "fill",
    params: {
      start: [0.06, 0.48],
      end: [0.94, 0.55],
      strands: 5,
      width: 12,
      spacing: 25,
      bend: 65,
      wave: 3,
      speed: 0.6,
      travel: "Reverse",
      colorA: color([0.88, 0.24, 0.19]),
      colorB: color([0.96, 0.69, 0.28]),
      colorC: color([0.46, 0.14, 0.58]),
      opacity: 1,
    },
    clip: "bounds",
    provenance: { origin: "design-original" },
  },
];
